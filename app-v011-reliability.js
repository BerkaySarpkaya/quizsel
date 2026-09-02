// Quizsel v0.11.0 — reliability overlay
// Scope:
// 1) Final screen can always return home even if Firebase result persistence fails.
// 2) Pending final results retry idempotently after reconnect / next authenticated load.
// 3) Active games self-heal after reconnect, foreground restore, or stale phase detection.
(() => {
  "use strict";

  const RELIABILITY_VERSION = "0.11.0";
  const PENDING_KEY = "quizsel_pending_finals_v1";
  const MAX_PENDING = 20;
  const RECOVERY_THROTTLE_MS = 3000;
  const STALE_GRACE_MS = 2500;
  const WATCHDOG_MS = 2000;

  let installed = false;
  let lastRecoveryAt = 0;
  let recoveryResetTimer = null;
  let recoveryInFlight = false;
  let firebaseConnected = null;
  let hiddenAt = 0;
  let pendingRetryPromise = null;
  let lastStaleRecoveryKey = "";

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readPending() {
    return safeParse(localStorage.getItem(PENDING_KEY) || "{}", {});
  }

  function writePending(map) {
    const entries = Object.entries(map || {})
      .filter(([, value]) => value && typeof value === "object")
      .sort((a, b) => Number(a[1].capturedAt || 0) - Number(b[1].capturedAt || 0));

    const kept = entries.slice(Math.max(0, entries.length - MAX_PENDING));
    if (!kept.length) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(Object.fromEntries(kept)));
  }

  function upsertPending(payload) {
    if (!payload?.key) return;
    const map = readPending();
    map[payload.key] = payload;
    writePending(map);
  }

  function removePending(key) {
    if (!key) return;
    const map = readPending();
    if (!map[key]) return;
    delete map[key];
    writePending(map);
  }

  function finalReceiptId(key) {
    return String(key || "").replace(/[^A-Za-z0-9:_-]/g, "_");
  }

  function trimReceipts(receipts, max = 200) {
    const entries = Object.entries(receipts || {});
    if (entries.length <= max) return receipts || {};
    entries.sort((a, b) =>
      Number(a[1]?.completedAt || 0) - Number(b[1]?.completedAt || 0)
    );
    return Object.fromEntries(entries.slice(entries.length - max));
  }

  function captureOwnFinal(rows) {
    const user = auth.currentUser;
    const room = currentRoom;
    const meta = currentGame?.meta;
    if (!user || !room || !meta?.createdAt || !Array.isArray(rows)) return null;

    const me = rows.find(row => row?.uid === user.uid);
    if (!me) return null;

    const key = `${room}:${meta.createdAt}`;
    return {
      version: 1,
      key,
      uid: user.uid,
      room,
      createdAt: Number(meta.createdAt),
      quizCode: String(meta.quizCode || ""),
      score: Number(me.score || 0),
      won: rows[0]?.uid === user.uid,
      capturedAt: Date.now()
    };
  }

  async function persistPendingFinal(payload) {
    const user = auth.currentUser;
    if (!user || !payload || payload.uid !== user.uid) return false;

    const receiptId = finalReceiptId(payload.key);
    const now = serverNow();
    const profileRef = db.ref(`profiles/${user.uid}`);

    const tx = await profileRef.transaction(profileValue => {
      const p = profileValue || {};
      p.stats = p.stats || { games: 0, wins: 0, points: 0 };
      p.quizHistory = p.quizHistory || {};
      p.finalReceipts = p.finalReceipts || {};

      if (p.finalReceipts[receiptId]) return p;

      p.stats.games = Number(p.stats.games || 0) + 1;
      p.stats.wins = Number(p.stats.wins || 0) + (payload.won ? 1 : 0);
      p.stats.points = Number(p.stats.points || 0) + Number(payload.score || 0);

      const code = String(payload.quizCode || "");
      if (code) {
        const h = p.quizHistory[code] || {};
        h.seen = true;
        h.seenCount = Math.max(1, Number(h.seenCount || 0));
        h.completedCount = Number(h.completedCount || 0) +
          (h.lastCompletedRoom === payload.room ? 0 : 1);
        h.lastCompletedRoom = payload.room;
        h.lastCompletedAt = now;
        h.lastSeenAt = Math.max(Number(h.lastSeenAt || 0), now);
        h.lastRoom = h.lastRoom || payload.room;
        p.quizHistory[code] = h;
      }

      p.finalReceipts[receiptId] = {
        room: payload.room,
        quizCode: code,
        score: Number(payload.score || 0),
        won: !!payload.won,
        completedAt: now
      };
      p.finalReceipts = trimReceipts(p.finalReceipts);
      return p;
    });

    if (!tx.committed) throw new Error("Pending final transaction commit edilmedi.");

    profile = tx.snapshot.val() || profile;
    finalRecordedKey = payload.key;
    sessionStorage.setItem("quizsel_final_" + payload.key, "1");

    db.ref(`activityLogs/${user.uid}`).push({
      type: "game_finished",
      at: TS,
      room: payload.room,
      quizCode: payload.quizCode,
      score: Number(payload.score || 0),
      won: !!payload.won
    }).catch(err => console.warn("[Quizsel] pending final activity log failed:", err));

    return true;
  }

  async function refreshHomeProfile() {
    const home = document.getElementById("view-home");
    if (!home?.classList.contains("active")) return;
    if (typeof loadProfile !== "function" || typeof renderHome !== "function") return;

    await loadProfile().catch(err =>
      console.warn("[Quizsel] profile refresh after pending final failed:", err)
    );
    if (home.classList.contains("active")) renderHome();
  }

  async function retryPendingFinals({ announce = false } = {}) {
    if (pendingRetryPromise) return pendingRetryPromise;

    pendingRetryPromise = (async () => {
      const user = auth.currentUser;
      if (!user || (typeof isAdmin === "function" && isAdmin(user))) return 0;

      const map = readPending();
      const mine = Object.values(map)
        .filter(item => item?.uid === user.uid)
        .sort((a, b) => Number(a.capturedAt || 0) - Number(b.capturedAt || 0));

      let completed = 0;
      for (const payload of mine) {
        try {
          const ok = await persistPendingFinal(payload);
          if (ok) {
            removePending(payload.key);
            completed++;
          }
        } catch (err) {
          console.warn("[Quizsel] pending final retry deferred:", err);
          break;
        }
      }

      if (completed) {
        await refreshHomeProfile();
        if (announce && typeof toast === "function") {
          toast("Bekleyen oyun sonucu kaydedildi.");
        }
      }
      return completed;
    })().finally(() => {
      pendingRetryPromise = null;
    });

    return pendingRetryPromise;
  }

  function installFinalReliability() {
    const baseRecordOwnFinal = recordOwnFinal;

    recordOwnFinal = function quizselV011RecordOwnFinal(rows) {
      const payload = captureOwnFinal(rows);
      if (payload) upsertPending(payload);

      let result;
      try {
        result = baseRecordOwnFinal.apply(this, arguments);
      } catch (err) {
        console.error("[Quizsel] final save start failed:", err);
        return Promise.resolve(false);
      }

      return Promise.resolve(result)
        .then(saved => {
          if (saved && payload) {
            removePending(payload.key);
            refreshHomeProfile().catch(() => {});
          }
          return !!saved;
        })
        .catch(err => {
          console.error("[Quizsel] final save failed:", err);
          return false;
        });
    };

    finishGame = function quizselV011FinishGame() {
      const btn = document.querySelector('#view-final button[onclick="finishGame()"]');
      const user = auth.currentUser;
      const pendingBeforeExit = user
        ? Object.values(readPending()).some(item => item?.uid === user.uid)
        : false;

      if (btn) {
        btn.disabled = true;
        btn.textContent = "Ana sayfaya dönülüyor…";
      }

      // Navigation is intentionally independent from Firebase persistence.
      // recordOwnFinal already started the primary save and v0.11 keeps an
      // idempotent local pending receipt if that save cannot finish now.
      localStorage.removeItem("quizsel_room");
      intentionalRoomExit = true;
      stopRoomWatch();
      intentionalRoomExit = false;
      renderHome();

      if (typeof toast === "function") {
        toast(
          pendingBeforeExit
            ? "Ana sayfaya döndün · sonuç kaydı arka planda tamamlanacak."
            : "Oyun tamamlandı · ana sayfaya döndün."
        );
      }

      // Do not block navigation. Retry immediately when possible and again on
      // Firebase reconnect / authenticated page restore.
      setTimeout(() => retryPendingFinals({ announce: false }), 0);
    };
  }

  function stalePhaseKey() {
    const meta = currentGame?.meta;
    if (!currentRoom || !meta || firebaseConnected === false) return "";
    if (!["countdown", "question", "reveal"].includes(meta.state)) return "";

    const endsAt = Number(meta.phaseEndsAt || 0);
    if (!endsAt || serverNow() <= endsAt + STALE_GRACE_MS) return "";
    return `${currentRoom}:${meta.state}:${meta.currentIndex}:${meta.currentKey || ""}:${endsAt}`;
  }

  function recoverRoom(reason, { force = false } = {}) {
    const pin = currentRoom;
    if (!pin || typeof watchRoom !== "function") return false;

    const now = Date.now();
    if (recoveryInFlight) return false;
    if (!force && now - lastRecoveryAt < RECOVERY_THROTTLE_MS) return false;

    recoveryInFlight = true;
    lastRecoveryAt = now;

    if (reason === "reconnect" && typeof toast === "function") {
      toast("Bağlantı geri geldi · oyun senkronize ediliyor…");
    }

    try {
      // The v0.9 performance layer owns the split Firebase listeners. Calling
      // its public watchRoom wrapper is the safest way to discard potentially
      // stale listener state and rehydrate meta + players + current answers.
      watchRoom(pin);
    } catch (err) {
      console.warn("[Quizsel] room recovery restart failed:", err);
    }

    clearTimeout(recoveryResetTimer);
    recoveryResetTimer = setTimeout(() => {
      recoveryInFlight = false;
      if (currentRoom === pin && typeof amHost === "function" && amHost()) {
        try {
          coordinateHost();
        } catch (err) {
          console.warn("[Quizsel] host recovery coordination failed:", err);
        }
      }
    }, 700);

    return true;
  }

  function installReconnectRecovery() {
    db.ref(".info/connected").on("value", snap => {
      const live = !!snap.val();
      if (firebaseConnected === false && live) {
        recoverRoom("reconnect", { force: true });
        retryPendingFinals({ announce: true }).catch(() => {});
      }
      firebaseConnected = live;
    });

    window.addEventListener("online", () => {
      recoverRoom("browser-online");
      retryPendingFinals({ announce: false }).catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }

      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (hiddenFor >= 1200) recoverRoom("foreground");
      retryPendingFinals({ announce: false }).catch(() => {});
    });

    window.addEventListener("pageshow", event => {
      if (event.persisted) recoverRoom("pageshow", { force: true });
      retryPendingFinals({ announce: false }).catch(() => {});
    });

    setInterval(() => {
      const key = stalePhaseKey();
      if (!key || key === lastStaleRecoveryKey) return;
      lastStaleRecoveryKey = key;
      recoverRoom("stale-phase");
    }, WATCHDOG_MS);
  }

  function install() {
    if (installed) return;
    installed = true;
    window.QUIZSEL_RELIABILITY_VERSION = RELIABILITY_VERSION;

    installFinalReliability();
    installReconnectRecovery();

    auth.onAuthStateChanged(user => {
      if (user && !(typeof isAdmin === "function" && isAdmin(user))) {
        setTimeout(() => retryPendingFinals({ announce: false }), 250);
      }
    });

    console.info(`[Quizsel] reliability ${RELIABILITY_VERSION} active`);
  }

  function bootWhenReady(attempt = 0) {
    const ready =
      typeof auth !== "undefined" &&
      typeof db !== "undefined" &&
      typeof recordOwnFinal === "function" &&
      typeof finishGame === "function" &&
      typeof watchRoom === "function" &&
      typeof stopRoomWatch === "function" &&
      typeof renderHome === "function" &&
      typeof serverNow === "function" &&
      !!window.QUIZSEL_RUNTIME_VERSION;

    if (ready) {
      install();
      return;
    }

    if (attempt >= 200) {
      console.error("[Quizsel] reliability layer could not attach to runtime.");
      return;
    }
    setTimeout(() => bootWhenReady(attempt + 1), 50);
  }

  bootWhenReady();
})();
