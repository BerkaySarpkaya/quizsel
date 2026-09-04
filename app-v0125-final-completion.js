// Quizsel v0.12.5 — final completion choices
// Separates "complete + home" from "complete + sign out".
// Home completion never reloads the page and never calls auth.signOut().
(() => {
  "use strict";

  const VERSION = "0.12.5";
  let actionInProgress = false;

  const byId = id => document.getElementById(id);
  const finalView = () => byId("view-final");
  const homeView = () => byId("view-home");
  const authView = () => byId("view-auth");
  const finalIsActive = () => !!finalView()?.classList.contains("active");
  const homeIsActive = () => !!homeView()?.classList.contains("active");

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

    if (mode === "home" && homeBtn) {
      homeBtn.textContent = "Ana sayfaya dönülüyor…";
    }
    if (mode === "logout" && logoutBtn) {
      logoutBtn.textContent = "Çıkış yapılıyor…";
    }
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
      document.querySelectorAll(".view.active").forEach(view => {
        view.classList.remove("active");
      });
      target.classList.add("active");
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.5] direct view switch failed:", err);
      return false;
    }
  }

  function detachFinishedRoom() {
    clearSavedRoom();

    try { intentionalRoomExit = true; } catch (_) {}
    try {
      if (typeof stopRoomWatch === "function") stopRoomWatch();
    } catch (err) {
      console.error("[Quizsel v0.12.5] room cleanup warning:", err);
    } finally {
      try { intentionalRoomExit = false; } catch (_) {}
    }

    // Defensive state clearing. The v0.9 stopRoomWatch wrapper also increments
    // its listener generation, so already-queued stale callbacks are ignored.
    try { currentRoom = null; } catch (_) {}
    try { currentGame = null; } catch (_) {}
    try { currentQuiz = null; } catch (_) {}
  }

  function renderHomeSafely() {
    // First move the UI locally so a rendering exception cannot trap Final.
    switchViewDirect(homeView());

    try {
      if (typeof renderHome === "function") renderHome();
    } catch (err) {
      console.error("[Quizsel v0.12.5] renderHome warning:", err);
      switchViewDirect(homeView());
    }

    return homeIsActive() && !finalIsActive();
  }

  function keepHomeVisible() {
    if (finalIsActive() || !homeIsActive()) renderHomeSafely();
  }

  function completeAndReturnHome(event) {
    stopEvent(event);
    if (actionInProgress) return false;

    actionInProgress = true;
    setButtonsBusy("home");

    // Critical invariant: this path never calls auth.signOut() and never reloads.
    detachFinishedRoom();
    renderHomeSafely();

    // Guard against an already-queued stale render trying to repaint Final.
    Promise.resolve().then(keepHomeVisible);
    setTimeout(keepHomeVisible, 80);
    setTimeout(keepHomeVisible, 300);
    setTimeout(keepHomeVisible, 1000);

    if (typeof toast === "function") {
      toast("Oyun tamamlandı · ana sayfaya döndün.");
    }

    actionInProgress = false;
    return false;
  }

  async function completeAndSignOut(event) {
    stopEvent(event);
    if (actionInProgress) return false;

    actionInProgress = true;
    setButtonsBusy("logout");
    detachFinishedRoom();

    try {
      if (!auth || typeof auth.signOut !== "function") {
        throw new Error("Firebase Auth kullanılamıyor.");
      }

      await auth.signOut();

      try { profile = null; } catch (_) {}
      try {
        if (byId("authPassword")) byId("authPassword").value = "";
        if (byId("adminPassword")) byId("adminPassword").value = "";
      } catch (_) {}
      try {
        if (typeof setAuthMode === "function") setAuthMode("login");
      } catch (_) {}

      try {
        if (typeof go === "function") go("auth");
      } catch (_) {}
      if (!authView()?.classList.contains("active")) switchViewDirect(authView());

      if (typeof toast === "function") toast("Oyun tamamlandı · çıkış yapıldı.");
      return false;
    } catch (err) {
      console.error("[Quizsel v0.12.5] sign out failed:", err);
      actionInProgress = false;
      restoreButtons();
      renderHomeSafely();
      if (typeof toast === "function") {
        toast("Çıkış yapılamadı · hesabın açık kaldı.");
      }
      return false;
    }
  }

  function install() {
    const homeBtn = byId("finalHomeBtn");
    const logoutBtn = byId("finalLogoutBtn");
    if (!homeBtn || !logoutBtn) {
      console.error("[Quizsel] v0.12.5 final completion buttons not found.");
      return;
    }

    homeBtn.onclick = null;
    logoutBtn.onclick = null;
    homeBtn.removeAttribute("onclick");
    logoutBtn.removeAttribute("onclick");

    homeBtn.addEventListener("click", completeAndReturnHome, true);
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
