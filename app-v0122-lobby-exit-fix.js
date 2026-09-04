// Quizsel v0.12.2 — pre-game lobby exit hotfix
// Applies after v0.12.1 analytics. A pristine lobby is not a played match:
// no answer/match analytics exists yet, so leaving must never be blocked by
// matchArchive / analyticsDepartures preservation.
(() => {
  "use strict";

  const HOTFIX_VERSION = "0.12.2";
  let installed = false;

  function hasAnyAnswers(game) {
    return Object.values(game?.answers || {}).some(rows =>
      rows && typeof rows === "object" && Object.keys(rows).length > 0
    );
  }

  function isPristineLobby(game) {
    return !!game?.meta &&
      String(game.meta.state || "") === "lobby" &&
      !Number(game.meta.startedAt || 0) &&
      !hasAnyAnswers(game);
  }

  function finishLocalExit(message = "Yarışmadan çıktın.") {
    try { localStorage.removeItem("quizsel_room"); } catch (_) {}
    try { stopRoomWatch(); } catch (err) {
      console.warn("[Quizsel v0.12.2] room cleanup warning:", err);
    }
    try { intentionalRoomExit = false; } catch (_) {}
    try { renderHome(); } catch (err) {
      console.error("[Quizsel v0.12.2] renderHome failed:", err);
    }
    if (typeof toast === "function") toast(message);
  }

  function install() {
    if (installed) return;
    installed = true;

    const analyticsLeaveCompetition = leaveCompetition;
    const analyticsKickPlayer = kickPlayer;
    const analyticsTerminateCompetition = terminateCompetition;

    leaveCompetition = async function quizselV0122LeaveCompetition() {
      const uid = auth.currentUser?.uid;
      const pin = currentRoom;

      if (!uid || !pin || !currentGame || !isPristineLobby(currentGame)) {
        return analyticsLeaveCompetition.apply(this, arguments);
      }

      let freshSnap;
      try {
        freshSnap = await db.ref(`games/${pin}`).get();
      } catch (err) {
        console.error("[Quizsel v0.12.2] lobby exit read failed:", err);
        if (typeof toast === "function") toast("Yarışmadan çıkılamadı. Bağlantını kontrol edip tekrar dene.");
        return;
      }

      if (!freshSnap.exists()) {
        finishLocalExit();
        return;
      }

      const game = freshSnap.val();

      // If the game started between the tap and the fresh read, fall back to
      // the v0.12.1 analytics-preserving path.
      if (!isPristineLobby(game)) {
        return analyticsLeaveCompetition.apply(this, arguments);
      }

      const players = Object.entries(game.players || {})
        .map(([id, p]) => ({ uid: id, ...p }))
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      const remaining = players.filter(p => p.uid !== uid);
      const wasHost = String(game.meta?.hostUid || "") === String(uid);

      try {
        intentionalRoomExit = true;

        if (wasHost) {
          if (remaining.length === 0) {
            await logActivity("game_left", {
              room: pin,
              quizCode: game.meta?.quizCode,
              host: true
            }).catch(() => {});

            await db.ref(`games/${pin}`).remove();
          } else {
            const nextHost = remaining[0];
            const updates = {
              "meta/hostUid": nextHost.uid,
              "meta/hostName": nextHost.name || "Oyuncu",
              "meta/hostOnline": false,
              "meta/hostLastSeenAt": TS,
              [`players/${uid}`]: null
            };

            Object.keys(game.answers || {}).forEach(key => {
              updates[`answers/${key}/${uid}`] = null;
            });

            await db.ref(`games/${pin}`).update(updates);

            await logActivity("game_left", {
              room: pin,
              quizCode: game.meta?.quizCode,
              host: true,
              transferredTo: nextHost.uid
            }).catch(() => {});
          }
        } else {
          if (typeof removeOwnAnswerData === "function") {
            await removeOwnAnswerData(pin, uid, game);
          }
          await db.ref(`games/${pin}/players/${uid}`).remove();

          await logActivity("game_left", {
            room: pin,
            quizCode: game.meta?.quizCode,
            host: false
          }).catch(() => {});
        }

        finishLocalExit();
      } catch (err) {
        try { intentionalRoomExit = false; } catch (_) {}
        console.error("[Quizsel v0.12.2] lobby exit failed:", err);
        if (typeof toast === "function") toast("Yarışmadan çıkılamadı. Tekrar dene.");
      }
    };

    kickPlayer = async function quizselV0122KickPlayer(uid) {
      if (
        isPristineLobby(currentGame) &&
        typeof amHost === "function" &&
        amHost() &&
        uid &&
        uid !== auth.currentUser?.uid &&
        currentRoom
      ) {
        try {
          await db.ref(`games/${currentRoom}/players/${uid}`).remove();
        } catch (err) {
          console.error("[Quizsel v0.12.2] lobby kick failed:", err);
          if (typeof toast === "function") toast("Oyuncu çıkarılamadı. Tekrar dene.");
        }
        return;
      }

      return analyticsKickPlayer.apply(this, arguments);
    };

    terminateCompetition = async function quizselV0122TerminateCompetition() {
      const pin = currentRoom;

      if (
        pin &&
        currentGame &&
        isPristineLobby(currentGame) &&
        typeof amHost === "function" &&
        amHost()
      ) {
        try {
          intentionalRoomExit = true;
          await logActivity("game_terminated", {
            room: pin,
            quizCode: currentGame?.meta?.quizCode
          }).catch(() => {});

          await db.ref(`games/${pin}`).remove();
          finishLocalExit("Yarışma sonlandırıldı.");
        } catch (err) {
          try { intentionalRoomExit = false; } catch (_) {}
          console.error("[Quizsel v0.12.2] lobby terminate failed:", err);
          if (typeof toast === "function") toast("Yarışma sonlandırılamadı. Tekrar dene.");
        }
        return;
      }

      return analyticsTerminateCompetition.apply(this, arguments);
    };

    window.QUIZSEL_LOBBY_EXIT_FIX_VERSION = HOTFIX_VERSION;
    console.info(`[Quizsel] lobby exit hotfix ${HOTFIX_VERSION} active`);
  }

  function boot(attempt = 0) {
    const ready =
      !!window.QUIZSEL_ANALYTICS_VERSION &&
      typeof leaveCompetition === "function" &&
      typeof kickPlayer === "function" &&
      typeof terminateCompetition === "function" &&
      typeof auth !== "undefined" &&
      typeof db !== "undefined";

    if (ready) {
      install();
      return;
    }

    if (attempt >= 240) {
      console.error("[Quizsel] v0.12.2 lobby exit hotfix could not attach.");
      return;
    }

    setTimeout(() => boot(attempt + 1), 50);
  }

  boot();
})();
