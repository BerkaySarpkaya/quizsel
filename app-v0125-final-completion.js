// Quizsel v0.12.6 — final completion + hardened home return
// Final terminal actions stay separate from Firebase persistence. Home return is
// guarded at document-capture level, stale Final renders are suppressed for the
// exited match, and a cache-busted same-page restart is the last-resort fallback.
(() => {
  "use strict";

  const VERSION = "0.12.6";
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
    const room = String(currentRoom || "");
    const createdAt = Number(currentGame?.meta?.createdAt || 0);
    return room && createdAt ? `${room}:${createdAt}` : room;
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

  function restoreButtons() {
    const homeBtn = byId("finalHomeBtn");
    const logoutBtn = byId("finalLogoutBtn");
    if (homeBtn) {
      homeBtn.disabled = false;
      homeBtn.textContent = "Tamamla ve ana ekrana dön";
    }
    if (logoutBtn) {
      logoutBtn.disabled = false;
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
      console.error("[Quizsel v0.12.6] direct view switch failed:", err);
      return false;
    }
  }

  function detachFinishedRoom() {
    clearSavedRoom();
    try { intentionalRoomExit = true; } catch (_) {}
    try {
      if (typeof stopRoomWatch === "function") stopRoomWatch();
    } catch (err) {
      console.error("[Quizsel v0.12.6] room cleanup warning:", err);
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
      console.error("[Quizsel v0.12.6] renderHome warning:", err);
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
      console.warn(`[Quizsel v0.12.6] hard home fallback (${reason})`);
      window.location.replace(target);
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.6] location.replace failed:", err);
    }
    try {
      window.location.href = target;
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.6] location.href fallback failed:", err);
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

  function completeAndReturnHome(event) {
    stopEvent(event);
    if (actionInProgress) {
      keepHomeVisible("repeat-tap");
      return false;
    }

    actionInProgress = true;
    armFinalExitLock();
    setButtonsBusy("home");
    detachFinishedRoom();
    renderHomeSafely();

    Promise.resolve().then(() => keepHomeVisible("microtask-watchdog"));
    setTimeout(() => keepHomeVisible("80ms-watchdog"), 80);
    setTimeout(() => keepHomeVisible("300ms-watchdog"), 300);
    setTimeout(() => keepHomeVisible("1200ms-watchdog"), 1200);

    if (typeof toast === "function") toast("Oyun tamamlandı · ana sayfaya döndün.");
    actionInProgress = false;
    return false;
  }

  async function completeAndSignOut(event) {
    stopEvent(event);
    if (actionInProgress) return false;

    actionInProgress = true;
    armFinalExitLock();
    setButtonsBusy("logout");
    detachFinishedRoom();

    try {
      if (!auth || typeof auth.signOut !== "function") throw new Error("Firebase Auth kullanılamıyor.");
      await auth.signOut();
      try { profile = null; } catch (_) {}
      try {
        if (byId("authPassword")) byId("authPassword").value = "";
        if (byId("adminPassword")) byId("adminPassword").value = "";
      } catch (_) {}
      try { if (typeof setAuthMode === "function") setAuthMode("login"); } catch (_) {}
      try { if (typeof go === "function") go("auth"); } catch (_) {}
      if (!authView()?.classList.contains("active")) switchViewDirect(authView());
      if (typeof toast === "function") toast("Oyun tamamlandı · çıkış yapıldı.");
      actionInProgress = false;
      return false;
    } catch (err) {
      console.error("[Quizsel v0.12.6] sign out failed:", err);
      actionInProgress = false;
      restoreButtons();
      renderHomeSafely();
      if (typeof toast === "function") toast("Çıkış yapılamadı · hesabın açık kaldı.");
      return false;
    }
  }

  // The final screen can be repainted by already-queued ended-room callbacks.
  // Suppress only the match that has just been completed. A genuinely new room
  // has a different room/createdAt key and automatically releases the lock.
  const baseRenderFinal = renderFinal;
  renderFinal = function quizselV0126RenderFinalGuard() {
    if (finalExitLock) {
      const key = currentMatchKey();
      if (!key || key === exitedMatchKey) return;
      finalExitLock = false;
      exitedMatchKey = "";
    }
    return baseRenderFinal.apply(this, arguments);
  };

  function captureFinalHomeClick(event) {
    const target = event?.target?.closest?.("#finalHomeBtn");
    if (!target) return;
    completeAndReturnHome(event);
  }

  function install() {
    const homeBtn = byId("finalHomeBtn");
    const logoutBtn = byId("finalLogoutBtn");
    if (!homeBtn || !logoutBtn) {
      console.error("[Quizsel] v0.12.6 final completion buttons not found.");
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

    window.completeAndReturnHome = completeAndReturnHome;
    window.completeAndSignOut = completeAndSignOut;
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
