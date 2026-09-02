// Quizsel v0.10.0 — runtime reliability + race flow + quiz-set browser
// Loads after app-v09-performance.js.
// Firebase Rules are intentionally unchanged by this layer.
(() => {
  "use strict";

  const RUNTIME_VERSION = String(CFG?.clientVersion || "0.10.0");
  window.QUIZSEL_RUNTIME_VERSION = RUNTIME_VERSION;

  // ---------------------------------------------------------------------------
  // Defensive quiz validation
  // ---------------------------------------------------------------------------
  function canonicalQuizCode(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "");
  }

  function quizNumber(code) {
    const m = canonicalQuizCode(code).match(/^YQ0*(\d+)$/);
    return m ? Number(m[1]) : null;
  }

  function assertRuntimeQuiz(quiz, requestedCode) {
    if (!quiz || typeof quiz !== "object") {
      throw new Error("Quiz dosyası geçerli bir JSON nesnesi değil.");
    }

    const requested = canonicalQuizCode(requestedCode);
    const actual = canonicalQuizCode(quiz.code);

    if (!actual || (requested && actual !== requested)) {
      throw new Error(`Quiz kodu uyuşmuyor: beklenen ${requested || "?"}, dosya ${actual || "?"}.`);
    }

    if (!Array.isArray(quiz.questions) || quiz.questions.length < 1) {
      throw new Error(`${actual}: questions dizisi boş veya geçersiz.`);
    }

    const ids = new Set();
    quiz.questions.forEach((q, index) => {
      if (!q || typeof q !== "object") {
        throw new Error(`${actual}: soru ${index + 1} nesne değil.`);
      }
      if (!Number.isInteger(Number(q.id))) {
        throw new Error(`${actual}: soru ${index + 1} id geçersiz.`);
      }
      if (ids.has(Number(q.id))) {
        throw new Error(`${actual}: duplicate question id ${q.id}.`);
      }
      ids.add(Number(q.id));

      if (!String(q.text || "").trim()) {
        throw new Error(`${actual}: soru ${q.id} metni boş.`);
      }
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        throw new Error(`${actual}: soru ${q.id} options sayısı geçersiz.`);
      }
      if (q.options.some(x => !String(x ?? "").trim())) {
        throw new Error(`${actual}: soru ${q.id} boş seçenek içeriyor.`);
      }
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
        throw new Error(`${actual}: soru ${q.id} answer index geçersiz.`);
      }
    });

    const n = quizNumber(actual);
    if (Number.isInteger(n) && n >= 133) {
      if (Number(quiz.schemaVersion) !== 2) {
        throw new Error(`${actual}: YQ133+ için schemaVersion 2 zorunlu.`);
      }
      if (quiz.questions.length !== 10) {
        throw new Error(`${actual}: YQ133+ production quiz tam 10 soru olmalı.`);
      }

      quiz.questions.forEach(q => {
        if (q.options.length !== 4) {
          throw new Error(`${actual}: soru ${q.id} tam 4 seçenek içermeli.`);
        }

        const normalizedOptions = q.options.map(x =>
          String(x).trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ")
        );
        if (new Set(normalizedOptions).size !== normalizedOptions.length) {
          throw new Error(`${actual}: soru ${q.id} duplicate seçenek içeriyor.`);
        }
        if (Number(q.time) !== 20) {
          throw new Error(`${actual}: soru ${q.id} time=20 olmalı.`);
        }
        if (q.questionType !== "multiple-choice") {
          throw new Error(`${actual}: soru ${q.id} questionType=multiple-choice olmalı.`);
        }
      });
    }

    return quiz;
  }

  const baseLoadQuiz = loadQuiz;
  loadQuiz = async function quizselV010LoadQuiz(code) {
    const quiz = await baseLoadQuiz.call(this, code);
    return assertRuntimeQuiz(quiz, code);
  };

  // ---------------------------------------------------------------------------
  // Persist real runtime version on lobby player records.
  // app.js still contains the historical base CLIENT_VERSION constant; the
  // authoritative runtime version is CFG.clientVersion from v0.10 onward.
  // ---------------------------------------------------------------------------
  async function stampOwnClientVersion() {
    const uid = auth.currentUser?.uid;
    const pin = currentRoom;
    if (!uid || !pin) return;
    await db.ref(`games/${pin}/players/${uid}/clientVersion`).set(RUNTIME_VERSION);
  }

  const baseHostQuiz = hostQuiz;
  hostQuiz = async function quizselV010HostQuiz(...args) {
    const value = await baseHostQuiz.apply(this, args);
    await stampOwnClientVersion().catch(err =>
      console.warn("[Quizsel] clientVersion stamp failed:", err)
    );
    return value;
  };

  const baseJoinByHomePin = joinByHomePin;
  joinByHomePin = async function quizselV010JoinByHomePin(...args) {
    const value = await baseJoinByHomePin.apply(this, args);
    await stampOwnClientVersion().catch(err =>
      console.warn("[Quizsel] clientVersion stamp failed:", err)
    );
    return value;
  };

  // ---------------------------------------------------------------------------
  // Reliable final persistence
  // - success markers are written only AFTER the atomic profile transaction
  // - retry is allowed after transient Firebase failure
  // - stats + quizHistory + receipt are one profile transaction
  // ---------------------------------------------------------------------------
  let finalSavePromise = Promise.resolve(true);
  let finalSaveFailed = false;
  let pendingFinalRows = null;

  function finalKey() {
    if (!currentRoom || !currentGame?.meta?.createdAt) return "";
    return `${currentRoom}:${currentGame.meta.createdAt}`;
  }

  function finalReceiptId(key) {
    return String(key).replace(/[^A-Za-z0-9:_-]/g, "_");
  }

  function trimReceipts(receipts, max = 200) {
    const entries = Object.entries(receipts || {});
    if (entries.length <= max) return receipts || {};
    entries.sort((a, b) =>
      Number(a[1]?.completedAt || 0) - Number(b[1]?.completedAt || 0)
    );
    return Object.fromEntries(entries.slice(entries.length - max));
  }

  async function persistOwnFinal(rows) {
    const user = auth.currentUser;
    const room = currentRoom;
    const meta = currentGame?.meta;
    if (!user || !room || !meta) return true;

    const key = `${room}:${meta.createdAt}`;
    if (
      finalRecordedKey === key ||
      sessionStorage.getItem("quizsel_final_" + key)
    ) {
      return true;
    }

    const me = rows.find(r => r.uid === user.uid);
    if (!me) return true;

    const winner = rows[0]?.uid === me.uid;
    const now = serverNow();
    const receiptId = finalReceiptId(key);
    const profileRef = db.ref(`profiles/${user.uid}`);

    const tx = await profileRef.transaction(p => {
      p = p || {};
      p.stats = p.stats || { games: 0, wins: 0, points: 0 };
      p.quizHistory = p.quizHistory || {};
      p.finalReceipts = p.finalReceipts || {};

      if (p.finalReceipts[receiptId]) {
        return p; // idempotent replay: do not increment twice.
      }

      p.stats.games = Number(p.stats.games || 0) + 1;
      p.stats.wins = Number(p.stats.wins || 0) + (winner ? 1 : 0);
      p.stats.points = Number(p.stats.points || 0) + Number(me.score || 0);

      const code = String(meta.quizCode || "");
      const h = p.quizHistory[code] || {};
      h.seen = true;
      h.seenCount = Math.max(1, Number(h.seenCount || 0));
      h.completedCount = Number(h.completedCount || 0) +
        (h.lastCompletedRoom === room ? 0 : 1);
      h.lastCompletedRoom = room;
      h.lastCompletedAt = now;
      h.lastSeenAt = Math.max(Number(h.lastSeenAt || 0), now);
      h.lastRoom = h.lastRoom || room;
      p.quizHistory[code] = h;

      p.finalReceipts[receiptId] = {
        room,
        quizCode: code,
        score: Number(me.score || 0),
        won: !!winner,
        completedAt: now
      };
      p.finalReceipts = trimReceipts(p.finalReceipts);

      return p;
    });

    if (!tx.committed) {
      throw new Error("Final profile transaction commit edilmedi.");
    }

    profile = tx.snapshot.val() || profile;

    // Activity log is observability, not the source of stats truth.
    db.ref(`activityLogs/${user.uid}`).push({
      type: "game_finished",
      at: TS,
      room,
      quizCode: meta.quizCode,
      score: Number(me.score || 0),
      won: !!winner
    }).catch(err => console.warn("[Quizsel] final activity log failed:", err));

    finalRecordedKey = key;
    sessionStorage.setItem("quizsel_final_" + key, "1");
    return true;
  }

  recordOwnFinal = function quizselV010RecordOwnFinal(rows) {
    pendingFinalRows = Array.isArray(rows) ? rows : pendingFinalRows;
    const rowsToSave = pendingFinalRows || [];
    finalSaveFailed = false;

    finalSavePromise = persistOwnFinal(rowsToSave)
      .then(() => true)
      .catch(err => {
        finalSaveFailed = true;
        console.error("[Quizsel] Final save failed:", err);
        return false;
      });

    return finalSavePromise;
  };

  finishGame = async function quizselV010FinishGame() {
    const btn = document.querySelector('#view-final button[onclick="finishGame()"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Kaydediliyor…";
    }

    try {
      let saved = await finalSavePromise;

      if (!saved && pendingFinalRows) {
        saved = await recordOwnFinal(pendingFinalRows);
      }

      if (!saved || finalSaveFailed) {
        toast("Sonuç kaydedilemedi · interneti kontrol edip tekrar dene.");
        return;
      }

      localStorage.removeItem("quizsel_room");
      intentionalRoomExit = true;
      stopRoomWatch();
      intentionalRoomExit = false;

      await loadProfile().catch(err =>
        console.warn("[Quizsel] profile refresh after final failed:", err)
      );

      renderHome();
      toast("Oyun tamamlandı · ana sayfaya döndün.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Ana sayfaya dön";
      }
    }
  };

  const finalButton = document.querySelector('#view-final button[onclick="finishGame()"]');
  if (finalButton) finalButton.textContent = "Ana sayfaya dön";

  // ---------------------------------------------------------------------------
  // Race flow: all-answered early reveal with authoritative Firebase re-check
  // and guaranteed deadline fallback.
  // ---------------------------------------------------------------------------
  function activePlayerIds(game = currentGame) {
    return Object.keys(game?.players || {});
  }

  function allActivePlayersAnswered(game = currentGame) {
    const ids = activePlayerIds(game);
    const key = game?.meta?.currentKey;
    if (!ids.length || !key) return false;

    const answers = game?.answers?.[key] || {};
    return ids.every(uid => Number.isInteger(answers?.[uid]?.choice));
  }

  const baseRenderGame = renderGame;
  renderGame = function quizselV010RenderGame() {
    const result = baseRenderGame.apply(this, arguments);

    if (
      currentGame?.meta?.state === "reveal" &&
      allActivePlayersAnswered(currentGame)
    ) {
      const status = $("answerStatus");
      const eyebrow = status?.querySelector(".eyebrow");
      if (eyebrow) eyebrow.textContent = "Herkes cevap verdi";

      if (status && !status.querySelector("[data-all-answered-note]")) {
        const note = document.createElement("div");
        note.dataset.allAnsweredNote = "1";
        note.className = "muted small";
        note.style.marginTop = "8px";
        note.textContent = "Sonuçlar gösteriliyor · ardından diğer soruya geçilecek.";
        status.appendChild(note);
      }
    }

    return result;
  };

  renderCountdown = function quizselV010RenderCountdown() {
    go("game");

    const meta = currentGame.meta;
    const betweenQuestions = Number(meta.currentIndex || 0) > 0;

    const tick = () => {
      const left = Math.max(0, meta.phaseEndsAt - serverNow());
      const num = $("countNum");

      let value;
      let label;

      if (betweenQuestions) {
        value = String(Math.max(1, Math.ceil(left / 1000)));
        label = "Diğer soruya geçiliyor";
      } else {
        const n = Math.max(1, Math.ceil(left / 1000) - 1);
        value = left < 900 ? "BAŞLA" : String(n);
        label = left < 900 ? "Soru geliyor" : "Hazır olun";
      }

      if (num.textContent !== value) {
        num.style.animation = "none";
        void num.offsetWidth;
        num.style.animation = "";
      }

      showCountdown(value, label);
    };

    stopPhaseTimer();
    tick();
    phaseTimer = setInterval(tick, 200);
  };

  nextPhase = async function quizselV010NextPhase(g) {
    const next = Number(g.meta.currentIndex || 0) + 1;

    if (next >= currentQuiz.questions.length) {
      await db.ref(`games/${currentRoom}/meta`).update({
        state: "ended",
        phaseEndsAt: 0
      });
      return;
    }

    const now = serverNow();
    const seconds = Math.max(1, Number(CFG.countdownSeconds || 3));

    await db.ref(`games/${currentRoom}/meta`).update({
      state: "countdown",
      currentIndex: next,
      currentKey: qKey(next),
      phaseStartedAt: now,
      phaseEndsAt: now + seconds * 1000,
      revealCorrect: null
    });
  };

  let earlySuppressedQuestionKey = "";

  async function authoritativeQuestionSnapshot(room, currentKey) {
    const [metaSnap, playersSnap, answersSnap] = await Promise.all([
      db.ref(`games/${room}/meta`).get(),
      db.ref(`games/${room}/players`).get(),
      db.ref(`games/${room}/answers/${currentKey}`).get()
    ]);

    if (!metaSnap.exists()) return null;

    return {
      meta: metaSnap.val(),
      players: playersSnap.val() || {},
      answersForKey: answersSnap.val() || {}
    };
  }

  function scheduleDeadline(metaAtSchedule) {
    const expected = `${metaAtSchedule.state}:${metaAtSchedule.currentIndex}:${metaAtSchedule.phaseEndsAt}`;
    const key = `deadline:${expected}`;
    if (hostTimerKey === key) return;

    stopHostTimer();
    hostTimerKey = key;

    const wait = Math.max(0, Number(metaAtSchedule.phaseEndsAt || 0) - serverNow() + 120);

    hostTimer = setTimeout(async () => {
      const room = currentRoom;
      if (!room) return;

      try {
        const metaSnap = await db.ref(`games/${room}/meta`).get();
        if (!metaSnap.exists()) return;

        const meta = metaSnap.val();
        if (`${meta.state}:${meta.currentIndex}:${meta.phaseEndsAt}` !== expected) return;

        if (meta.state === "countdown") {
          await beginQuestion(meta.currentIndex);
        } else if (meta.state === "question") {
          const snap = await authoritativeQuestionSnapshot(room, meta.currentKey);
          if (!snap || snap.meta.state !== "question") return;

          await revealQuestion({
            meta: snap.meta,
            players: snap.players,
            answers: { [snap.meta.currentKey]: snap.answersForKey }
          });
        } else if (meta.state === "reveal") {
          await nextPhase({ meta });
        }
      } catch (err) {
        console.error("[Quizsel] deadline phase failed, retrying:", err);
        hostTimer = null;
        hostTimerKey = "";
        setTimeout(() => {
          if (currentRoom === room) coordinateHost();
        }, 800);
      }
    }, wait);
  }

  coordinateHost = function quizselV010CoordinateHost() {
    if (!amHost()) return;

    const m = currentGame?.meta;
    if (!m) return;

    if (!["countdown", "question", "reveal"].includes(m.state)) {
      earlySuppressedQuestionKey = "";
      stopHostTimer();
      return;
    }

    if (m.state !== "question") {
      earlySuppressedQuestionKey = "";
      scheduleDeadline(m);
      return;
    }

    if (
      allActivePlayersAnswered(currentGame) &&
      earlySuppressedQuestionKey !== m.currentKey
    ) {
      const earlyKey = `all-answered:${m.currentIndex}:${m.currentKey}`;
      if (hostTimerKey === earlyKey) return;

      stopHostTimer();
      hostTimerKey = earlyKey;

      hostTimer = setTimeout(async () => {
        const room = currentRoom;
        if (!room) return;

        try {
          const snap = await authoritativeQuestionSnapshot(room, m.currentKey);
          if (!snap) return;

          const meta = snap.meta;
          if (meta.state !== "question" || meta.currentKey !== m.currentKey) return;

          const ids = Object.keys(snap.players);
          const authoritativeAllAnswered =
            ids.length > 0 &&
            ids.every(uid => Number.isInteger(snap.answersForKey?.[uid]?.choice));

          if (!authoritativeAllAnswered) {
            earlySuppressedQuestionKey = m.currentKey;
            scheduleDeadline(meta);
            return;
          }

          await revealQuestion({
            meta,
            players: snap.players,
            answers: { [meta.currentKey]: snap.answersForKey }
          });
        } catch (err) {
          // Critical: never lose the ordinary 20s deadline fallback.
          console.error("[Quizsel] early all-answered verification failed:", err);
          earlySuppressedQuestionKey = m.currentKey;
          scheduleDeadline(m);
        }
      }, 180);

      return;
    }

    scheduleDeadline(m);
  };

  // ---------------------------------------------------------------------------
  // Quiz-set browser (consolidates former app-quizsets-v092.js behavior)
  // ---------------------------------------------------------------------------
  const FIRST_SET_START = 103;
  const SET_SIZE = 30;
  const QUIZ_BATCH_SIZE = 12;
  const SET_WORDS = [
    "",
    "First", "Second", "Third", "Fourth", "Fifth",
    "Sixth", "Seventh", "Eighth", "Ninth", "Tenth",
    "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth",
    "Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth", "Twentieth"
  ];

  let setObserver = null;
  let activeManifest = null;

  function stopSetObserver() {
    if (setObserver) {
      setObserver.disconnect();
      setObserver = null;
    }
  }

  function cleanDisplayCode(meta) {
    return String(meta?.code || meta?.file || "").trim().toUpperCase();
  }

  function yqNumber(meta) {
    const source = cleanDisplayCode(meta);
    const m = source.match(/Y\.?Q0*(\d+)/);
    if (m) return Number(m[1]);

    const fileMatch = String(meta?.file || "")
      .toUpperCase()
      .match(/YQ0*(\d+)\.JSON$/);

    return fileMatch ? Number(fileMatch[1]) : null;
  }

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  function setName(setNumber) {
    return SET_WORDS[setNumber]
      ? `${SET_WORDS[setNumber]} Set`
      : `Set ${setNumber}`;
  }

  function groupInfo(meta) {
    const number = yqNumber(meta);

    if (!Number.isInteger(number) || number < FIRST_SET_START) {
      return {
        id: "draft",
        order: -1,
        title: "Draft Quiz Set",
        plannedStart: null,
        plannedEnd: FIRST_SET_START - 1
      };
    }

    const setNumber = Math.floor((number - FIRST_SET_START) / SET_SIZE) + 1;
    const plannedStart = FIRST_SET_START + (setNumber - 1) * SET_SIZE;

    return {
      id: `set-${setNumber}`,
      order: setNumber,
      setNumber,
      title: setName(setNumber),
      plannedStart,
      plannedEnd: plannedStart + SET_SIZE - 1
    };
  }

  function buildGroups(quizzes) {
    const map = new Map();

    quizzes.forEach(meta => {
      const info = groupInfo(meta);
      if (!map.has(info.id)) map.set(info.id, { ...info, quizzes: [] });
      map.get(info.id).quizzes.push(meta);
    });

    const groups = Array.from(map.values());

    groups.forEach(group => {
      group.quizzes.sort((a, b) => {
        const an = yqNumber(a);
        const bn = yqNumber(b);
        if (Number.isInteger(an) && Number.isInteger(bn)) return an - bn;
        return cleanDisplayCode(a).localeCompare(cleanDisplayCode(b), "tr");
      });
    });

    groups.sort((a, b) => {
      if (a.id === "draft") return 1;
      if (b.id === "draft") return -1;
      return b.order - a.order;
    });

    return groups;
  }

  function groupRangeLabel(group) {
    if (group.id === "draft") {
      return `Y.Q001–Y.Q${pad3(group.plannedEnd)} + eski QZ quizleri`;
    }
    return `Y.Q${pad3(group.plannedStart)}–Y.Q${pad3(group.plannedEnd)}`;
  }

  function setCard(group) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quizSetCard ${group.id === "draft" ? "draft" : ""}`;
    button.setAttribute("aria-label", `${group.title} klasörünü aç`);
    button.innerHTML = `
      <div class="quizSetFolderIcon" aria-hidden="true"><i></i></div>
      <div class="quizSetMeta">
        <div class="eyebrow">${group.id === "draft" ? "Arşiv" : "Quiz koleksiyonu"}</div>
        <h3>${esc(group.title)}</h3>
        <div class="quizSetSub">${group.quizzes.length} quiz · ${esc(groupRangeLabel(group))}</div>
      </div>
      <div class="quizSetArrow" aria-hidden="true">›</div>
    `;
    button.onclick = () => renderSet(group);
    return button;
  }

  function renderFolders(groups) {
    stopSetObserver();
    const list = $("quizList");
    if (!list) return;

    list.classList.add("quizSetGrid");
    list.innerHTML = "";

    if (!groups.length) {
      list.innerHTML = '<div class="empty">Gösterilecek quiz bulunamadı.</div>';
      return;
    }

    const intro = document.createElement("div");
    intro.className = "quizSetIntro";
    intro.innerHTML = `
      <div class="eyebrow">Quiz kütüphanesi</div>
      <div class="quizSetIntroText">Bir set seç. Her yeni 30 quiz otomatik olarak sonraki sete eklenir.</div>
    `;
    list.appendChild(intro);

    groups.forEach(group => list.appendChild(setCard(group)));
  }

  function renderSet(group) {
    stopSetObserver();
    const list = $("quizList");
    if (!list) return;

    list.classList.remove("quizSetGrid");
    list.innerHTML = "";

    const head = document.createElement("div");
    head.className = "quizSetViewHead";
    head.innerHTML = `
      <button class="back quizSetBack" type="button">Quiz setleri</button>
      <div class="quizSetViewTitleRow">
        <div>
          <div class="eyebrow">Quiz klasörü</div>
          <h3>${esc(group.title)}</h3>
          <div class="muted small">${group.quizzes.length} quiz · ${esc(groupRangeLabel(group))}</div>
        </div>
      </div>
    `;
    head.querySelector(".quizSetBack").onclick = () =>
      renderFolders(buildGroups(activeManifest?.quizzes || []));
    list.appendChild(head);

    let rendered = 0;
    const sentinel = document.createElement("div");
    sentinel.className = "quizSetSentinel";

    const renderBatch = () => {
      const end = Math.min(group.quizzes.length, rendered + QUIZ_BATCH_SIZE);
      const fragment = document.createDocumentFragment();

      for (; rendered < end; rendered++) {
        fragment.appendChild(quizCard(group.quizzes[rendered]));
      }

      list.insertBefore(fragment, sentinel);

      if (rendered >= group.quizzes.length) {
        stopSetObserver();
        sentinel.remove();
      } else {
        sentinel.innerHTML =
          '<button class="btn soft sm" type="button">Daha fazla quiz göster</button>';
        sentinel.querySelector("button").onclick = renderBatch;
      }
    };

    list.appendChild(sentinel);
    renderBatch();

    if (sentinel.isConnected && "IntersectionObserver" in window) {
      setObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) renderBatch();
      }, { rootMargin: "320px 0px" });
      setObserver.observe(sentinel);
    }

    requestAnimationFrame(() =>
      window.scrollTo({ top: 0, left: 0, behavior: "auto" })
    );
  }

  function updateQuizCodePlaceholder(quizzes) {
    const input = $("quizCodeInput");
    if (!input) return;

    const nums = quizzes.map(yqNumber).filter(Number.isInteger);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    input.placeholder = `Örn. YQ${pad3(next)}`;
  }

  openQuizBrowser = async function quizselV010QuizBrowser() {
    go("quizzes");
    clearErr("quizCodeErr");
    stopSetObserver();

    const list = $("quizList");
    list.innerHTML = '<div class="empty">Quiz setleri yükleniyor…</div>';

    try {
      const manifest = await loadManifest();
      const quizzes = Array.isArray(manifest?.quizzes) ? manifest.quizzes : [];

      activeManifest = { ...manifest, quizzes };
      updateQuizCodePlaceholder(quizzes);
      renderFolders(buildGroups(quizzes));
    } catch (e) {
      list.classList.remove("quizSetGrid");
      list.innerHTML = `
        <div class="empty">
          ${esc(e.message)}
          <br><span class="tiny">Kodla açma yine kullanılabilir.</span>
        </div>
      `;
    }
  };

  if (new URLSearchParams(location.search).get("debug") === "1") {
    window.QUIZSEL_RUNTIME_DEBUG = {
      version: RUNTIME_VERSION,
      assertRuntimeQuiz,
      firstSetStart: FIRST_SET_START,
      setSize: SET_SIZE,
      yqNumber,
      groupInfo,
      buildGroups
    };
  }

  console.info(`[Quizsel] runtime ${RUNTIME_VERSION} active`);
})();
