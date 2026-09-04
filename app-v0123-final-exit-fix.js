// Quizsel v0.12.3 — final-screen home navigation hardening
// Directly loaded after the existing runtime overlays. This guard is deliberately
// independent from Firebase writes: leaving the final screen must always be a
// local UI operation, while pending result/archive persistence may retry later.
(() => {
  "use strict";

  const HOTFIX_VERSION = "0.12.3";
  let installed = false;
  let exitInProgress = false;

  function finalViewActive() {
    return !!document.getElementById("view-final")?.classList?.contains("active");
  }

  function homeViewActive() {
    return !!document.getElementById("view-home")?.classList?.contains("active");
  }

  function finalButton() {
    return document.querySelector('#view-final button[onclick="finishGame()"]');
  }

  function directHomeDomFallback() {
    const home = document.getElementById("view-home");
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
      console.error("[Quizsel v0.12.3] direct home fallback failed:", err);
      return false;
    }
  }

  function ensureHome(reason) {
    if (homeViewActive() && !finalViewActive()) return true;

    try {
      localStorage.removeItem("quizsel_room");
    } catch (_) {}

    try {
      intentionalRoomExit = true;
    } catch (_) {}

    try {
      if (typeof stopRoomWatch === "function") stopRoomWatch();
    } catch (err) {
      console.error(`[Quizsel v0.12.3] room cleanup failed (${reason}):`, err);
    } finally {
      try {
        intentionalRoomExit = false;
      } catch (_) {}
    }

    // Navigation happens before home rendering on purpose. A rendering error
    // must never be able to leave the player trapped on the final screen.
    try {
      if (typeof go === "function") go("home");
    } catch (err) {
      console.error(`[Quizsel v0.12.3] go(home) failed (${reason}):`, err);
    }

    if (!homeViewActive() || finalViewActive()) {
      directHomeDomFallback();
    }

    try {
      if (typeof renderHome === "function") renderHome();
    } catch (err) {
      console.error(`[Quizsel v0.12.3] renderHome failed (${reason}):`, err);
    }

    if (!homeViewActive() || finalViewActive()) {
      directHomeDomFallback();
    }

    const moved = homeViewActive() && !finalViewActive();
    if (!moved) {
      const btn = finalButton();
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Ana sayfaya dön";
      }
    }
    return moved;
  }

  function install() {
    if (installed || typeof finishGame !== "function") return;
    installed = true;

    const baseFinishGame = finishGame;

    finishGame = function quizselV0123FinishGame() {
      if (exitInProgress) {
        ensureHome("repeat-tap");
        return;
      }

      exitInProgress = true;
      let result;

      try {
        result = baseFinishGame.apply(this, arguments);
      } catch (err) {
        console.error("[Quizsel v0.12.3] base finishGame failed:", err);
        ensureHome("base-exception");
      }

      const verify = reason => {
        if (finalViewActive()) ensureHome(reason);

        if (!finalViewActive()) {
          exitInProgress = false;
          return true;
        }

        const btn = finalButton();
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Ana sayfaya dön";
        }
        exitInProgress = false;
        return false;
      };

      Promise.resolve(result)
        .catch(err => {
          console.error("[Quizsel v0.12.3] async finishGame failed:", err);
          ensureHome("base-async-exception");
        })
        .finally(() => verify("promise-finally"));

      Promise.resolve().then(() => verify("microtask-watchdog"));
      setTimeout(() => verify("100ms-watchdog"), 100);
      setTimeout(() => verify("500ms-watchdog"), 500);
      setTimeout(() => verify("1500ms-watchdog"), 1500);

      return result;
    };

    window.QUIZSEL_FINAL_EXIT_FIX_VERSION = HOTFIX_VERSION;
    console.info(`[Quizsel] final exit hotfix ${HOTFIX_VERSION} active`);
  }

  function boot(attempt = 0) {
    const ready =
      typeof finishGame === "function" &&
      typeof go === "function" &&
      typeof stopRoomWatch === "function" &&
      typeof renderHome === "function" &&
      !!window.QUIZSEL_RELIABILITY_VERSION;

    if (ready) {
      install();
      return;
    }

    if (attempt >= 240) {
      console.error("[Quizsel] v0.12.3 final exit hotfix could not attach.");
      return;
    }

    setTimeout(() => boot(attempt + 1), 50);
  }

  boot();
})();
