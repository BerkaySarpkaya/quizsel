// Quizsel v0.12.4 — final hard-return handler
// Final -> Home is deliberately independent from finishGame(), Firebase writes,
// analytics wrappers and runtime overlay order. The final button performs a
// cache-busted same-page restart after clearing the saved room. Firebase Auth
// SESSION persistence restores the signed-in user and restoreRoomOrHome() lands
// on Home because quizsel_room has already been removed.
(() => {
  "use strict";

  const VERSION = "0.12.4";
  const RETURN_PARAM = "quizsel_return";
  let installed = false;
  let leaving = false;

  function finalView() {
    return document.getElementById("view-final");
  }

  function homeView() {
    return document.getElementById("view-home");
  }

  function finalIsActive() {
    return !!finalView()?.classList.contains("active");
  }

  function forceHomeDom() {
    const home = homeView();
    if (!home) return false;

    try {
      document.querySelectorAll(".view.active").forEach(view => {
        view.classList.remove("active");
      });
      home.classList.add("active");
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      return true;
    } catch (err) {
      console.error("[Quizsel v0.12.4] direct home switch failed:", err);
      return false;
    }
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

  function clearSavedRoom() {
    try { localStorage.removeItem("quizsel_room"); } catch (_) {}
  }

  function detachRoomBestEffort() {
    try { intentionalRoomExit = true; } catch (_) {}
    try {
      if (typeof stopRoomWatch === "function") stopRoomWatch();
    } catch (err) {
      // Page navigation below is authoritative; cleanup failure is non-blocking.
      console.error("[Quizsel v0.12.4] room cleanup warning:", err);
    } finally {
      try { intentionalRoomExit = false; } catch (_) {}
    }
  }

  function hardNavigateHome() {
    const target = freshHomeUrl();

    try {
      window.location.replace(target);
      return;
    } catch (err) {
      console.error("[Quizsel v0.12.4] location.replace failed:", err);
    }

    try {
      window.location.href = target;
      return;
    } catch (err) {
      console.error("[Quizsel v0.12.4] location.href fallback failed:", err);
    }

    // Extremely defensive last resort if browser navigation itself is blocked.
    forceHomeDom();
  }

  function returnHomeFromFinal(event) {
    if (event) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
    }

    if (leaving) return false;
    leaving = true;

    const btn = document.getElementById("finalHomeBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Ana sayfaya dönülüyor…";
    }

    // Give immediate visual feedback before the restart and ensure even a
    // blocked navigation cannot leave the user staring at the final screen.
    forceHomeDom();
    clearSavedRoom();
    detachRoomBestEffort();

    // Do not await any Firebase work here. v0.11 reliability already captures
    // the final result locally before persistence; authenticated reload retries
    // pending final/archive work if necessary.
    setTimeout(hardNavigateHome, 0);

    // A stale callback may repaint Final in the tiny window before navigation.
    Promise.resolve().then(() => {
      if (finalIsActive()) forceHomeDom();
    });
    setTimeout(() => {
      if (finalIsActive()) forceHomeDom();
    }, 80);

    return false;
  }

  function install() {
    if (installed) return;
    const btn = document.getElementById("finalHomeBtn");
    if (!btn) {
      console.error("[Quizsel] v0.12.4 final button not found; hard-return not installed.");
      return;
    }

    installed = true;
    cleanReturnMarkerFromAddress();

    // Own the DOM event directly. No later assignment to global finishGame()
    // can alter this button's behavior.
    btn.onclick = null;
    btn.removeAttribute("onclick");
    btn.addEventListener("click", returnHomeFromFinal, true);

    window.returnHomeFromFinal = returnHomeFromFinal;
    window.QUIZSEL_FINAL_HARD_RETURN_VERSION = VERSION;
    document.documentElement.dataset.quizselFinalReturn = VERSION;
    console.info(`[Quizsel] final hard-return ${VERSION} active`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
