// Quizsel v0.12.7 — final completion + hardened home return
// Final terminal actions stay separate from Firebase persistence. Home return is
// guarded at document-capture level, stale Final renders are suppressed for the
// exited match, and a cache-busted same-page restart is the last-resort fallback.
//
// v0.12.7 fixes the permanently-dead Home button:
// #view-final is a persistent DOM node reused by every match, so the disabled
// state set by setButtonsBusy() survived the whole page session. The first exit
// worked, every later match found an already-disabled button and a disabled
// button emits no click event at all, so no capture listener could recover it.
// Terminal buttons are now always restored: after the exit settles, in a
// finally block, on every Final repaint, and whenever #view-final becomes
// active again (Bilgi Canavarı return included).
(() => {
  "use strict";

  const VERSION = "0.12.7";
  const RETURN_PARAM = "quizsel_return";
  let actionInProgress = false;
  let finalExitLock = false;
  let exitedMatchKey = "";

  const byId = id => document.getElementById(id);
  const finalView = () => byId("view-final");
  const homeView = () => byId("view-home");
  const authView = () => byId("view-auth");
  const finalIsActive = () => !!finalView()?.classList.contains("active");
  const homeIsActive = () => !!homeView()?.classList.contains("active");

  function currentMatchKey() {
    let room = "";
    let createdAt = 0;
    try { room = String(currentRoom || ""); } catch (_) {}
    try { createdAt = Number(currentGame?.meta?.createdAt || 0); } catch (_) {}
    return room && createdAt ? `${room}:${createdAt}` : room;
  }

  function safeToast(message) {
    try {
      if (typeof toast === "function") toast(message);
    } catch (err) {
      console.error("[Quizsel v0.12.7] toast failed:", err);
    }
  }

  function stopEvent(event) {
    if (!event) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
  }

  function setButtonsBusy(mode) {
    const homeBtn = byId("finalHomeBtn");
    const logoutBtn = byId("finalLogoutBtn");
    if (homeBtn) homeBtn.disabled = true;
    if (logoutBtn) logoutBtn.disabled = true;

    if (mode === "home" && homeBtn) homeBtn.textContent = "Ana sayfaya dönülüyor…";
    if (mode === "logout" && logoutBtn) logoutBtn.textContent = "Çıkış yapılıyor…";
  }

  // Idempotent. This is the single invariant that keeps Final usable across
  // repeated matches in the same page session.
  function restoreButtons() {
    const homeBtn = byId("finalHomeBtn");
    const logoutBtn = byId("finalLogoutBtn");
    if (homeBtn) {
      homeBtn.disabled = false;
      homeBtn.removeAttribute("disabled");
      homeBtn.textContent = "Tamamla ve ana ekrana dön";
    }
    if (logoutBtn) {
      logoutBtn.disabled = false;
      logoutBtn.removeAttribute("disabled");
      logoutBtn.textContent = "Tamamla ve çıkış yap";
    }
  }

  function clearSavedRoom() {
    try { localStorage.removeItem("quizsel_room"); } catch (_) {}
  }

  function switchViewDirect(target) {
    if (!target) return false;
    try {
      document.querySelectorAll(".view.active").forEach(view => view.classList.remove("active"));
      target.classList.add("active");
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.7] direct view switch failed:", err);
      return false;
    }
  }

  function detachFinishedRoom() {
    clearSavedRoom();
    try { intentionalRoomExit = true; } catch (_) {}
    try {
      if (typeof stopRoomWatch === "function") stopRoomWatch();
    } catch (err) {
      console.error("[Quizsel v0.12.7] room cleanup warning:", err);
    } finally {
      try { intentionalRoomExit = false; } catch (_) {}
    }
    try { currentRoom = null; } catch (_) {}
    try { currentGame = null; } catch (_) {}
    try { currentQuiz = null; } catch (_) {}
  }

  function renderHomeSafely() {
    switchViewDirect(homeView());
    try {
      if (typeof renderHome === "function") renderHome();
    } catch (err) {
      console.error("[Quizsel v0.12.7] renderHome warning:", err);
      switchViewDirect(homeView());
    }
    return homeIsActive() && !finalIsActive();
  }

  function cleanReturnMarkerFromAddress() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(RETURN_PARAM)) return;
      url.searchParams.delete(RETURN_PARAM);
      const clean = url.pathname + (url.search ? url.search : "") + url.hash;
      history.replaceState(history.state, "", clean);
    } catch (_) {}
  }

  function freshHomeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set(RETURN_PARAM, String(Date.now()));
    url.hash = "";
    return url.toString();
  }

  function hardNavigateHome(reason) {
    if (homeIsActive() && !finalIsActive()) return true;
    clearSavedRoom();
    const target = freshHomeUrl();
    try {
      console.warn(`[Quizsel v0.12.7] hard home fallback (${reason})`);
      window.location.replace(target);
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.7] location.replace failed:", err);
    }
    try {
      window.location.href = target;
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.7] location.href fallback failed:", err);
    }
    return switchViewDirect(homeView());
  }

  function armFinalExitLock() {
    exitedMatchKey = currentMatchKey();
    finalExitLock = true;
  }

  function keepHomeVisible(reason) {
    if (homeIsActive() && !finalIsActive()) return true;
    renderHomeSafely();
    if (homeIsActive() && !finalIsActive()) return true;
    return hardNavigateHome(reason);
  }

  // Every watchdog also re-arms the terminal buttons. If the exit succeeded the
  // Final view is hidden and the reset is invisible; if it failed the player
  // gets a live button back instead of a dead end.
  function settleHomeReturn(reason) {
    // A watchdog queued by a finished match must never drag a newly started
    // match out of its own Final screen. detachFinishedRoom() clears the room,
    // so an empty key still means "the exit is still settling".
    const key = currentMatchKey();
    if (key && key !== exitedMatchKey) {
      restoreButtons();
      return true;
    }
    const ok = keepHomeVisible(reason);
    restoreButtons();
    return ok;
  }

  function completeAndReturnHome(event) {
    stopEvent(event);
    if (actionInProgress) {
      settleHomeReturn("repeat-tap");
      return false;
    }

    actionInProgress = true;

    try {
      armFinalExitLock();
      setButtonsBusy("home");
      detachFinishedRoom();
      renderHomeSafely();

      Promise.resolve().then(() => settleHomeReturn("microtask-watchdog"));
      setTimeout(() => settleHomeReturn("80ms-watchdog"), 80);
      setTimeout(() => settleHomeReturn("300ms-watchdog"), 300);
      setTimeout(() => settleHomeReturn("1200ms-watchdog"), 1200);

      safeToast("Oyun tamamlandı · ana sayfaya döndün.");
    } catch (err) {
      console.error("[Quizsel v0.12.7] home return failed:", err);
      hardNavigateHome("sync-exception");
    } finally {
      // Never leave the session with a disabled terminal button, whatever
      // happened above. This is the actual regression fix.
      actionInProgress = false;
      restoreButtons();
    }

    return false;
  }

  async function completeAndSignOut(event) {
    stopEvent(event);
    if (actionInProgress) return false;

    actionInProgress = true;
    let signedOut = false;

    try {
      armFinalExitLock();
      setButtonsBusy("logout");
      detachFinishedRoom();

      if (!auth || typeof auth.signOut !== "function") throw new Error("Firebase Auth kullanılamıyor.");
      await auth.signOut();
      signedOut = true;

      try { profile = null; } catch (_) {}
      try {
        if (byId("authPassword")) byId("authPassword").value = "";
        if (byId("adminPassword")) byId("adminPassword").value = "";
      } catch (_) {}
      try { if (typeof setAuthMode === "function") setAuthMode("login"); } catch (_) {}
      try { if (typeof go === "function") go("auth"); } catch (_) {}
      if (!authView()?.classList.contains("active")) switchViewDirect(authView());
      safeToast("Oyun tamamlandı · çıkış yapıldı.");
    } catch (err) {
      console.error("[Quizsel v0.12.7] sign out failed:", err);
      renderHomeSafely();
      safeToast("Çıkış yapılamadı · hesabın açık kaldı.");
    } finally {
      actionInProgress = false;
      restoreButtons();
    }

    return signedOut ? false : false;
  }

  // The final screen can be repainted by already-queued ended-room callbacks.
  // Suppress only the match that has just been completed. A genuinely new room
  // has a different room/createdAt key and automatically releases the lock.
  const baseRenderFinal = renderFinal;
  renderFinal = function quizselV0127RenderFinalGuard() {
    if (finalExitLock) {
      const key = currentMatchKey();
      if (!key || key === exitedMatchKey) return;
      finalExitLock = false;
      exitedMatchKey = "";
    }
    const result = baseRenderFinal.apply(this, arguments);
    // A freshly painted Final screen must always ship live terminal buttons.
    restoreButtons();
    return result;
  };

  function captureFinalHomeClick(event) {
    const target = event?.target?.closest?.("#finalHomeBtn");
    if (!target) return;
    completeAndReturnHome(event);
  }

  // Some paths show Final without going through renderFinal() — most notably
  // the Bilgi Canavarı "Sonuçlara dön" action, which is a plain go('final').
  // Watch the view itself so those paths cannot inherit a stale disabled state.
  function observeFinalViewActivation() {
    const view = finalView();
    if (!view || typeof MutationObserver !== "function") return;

    const observer = new MutationObserver(() => {
      if (view.classList.contains("active") && !actionInProgress) restoreButtons();
    });

    observer.observe(view, { attributes: true, attributeFilter: ["class"] });
    if (view.classList.contains("active")) restoreButtons();
  }

  function install() {
    const homeBtn = byId("finalHomeBtn");
    const logoutBtn = byId("finalLogoutBtn");
    if (!homeBtn || !logoutBtn) {
      console.error("[Quizsel] v0.12.7 final completion buttons not found.");
      return;
    }

    cleanReturnMarkerFromAddress();

    // Own Home at document-capture level. This fires before any stale target
    // listener left by an older overlay and therefore gives one authoritative
    // escape path from Final.
    homeBtn.onclick = null;
    homeBtn.removeAttribute("onclick");
    document.addEventListener("click", captureFinalHomeClick, true);

    logoutBtn.onclick = null;
    logoutBtn.removeAttribute("onclick");
    logoutBtn.addEventListener("click", completeAndSignOut, true);

    restoreButtons();
    observeFinalViewActivation();

    window.completeAndReturnHome = completeAndReturnHome;
    window.completeAndSignOut = completeAndSignOut;
    window.quizselRestoreFinalButtons = restoreButtons;
    window.QUIZSEL_FINAL_COMPLETION_VERSION = VERSION;
    document.documentElement.dataset.quizselFinalCompletion = VERSION;
    console.info(`[Quizsel] final completion ${VERSION} active`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
