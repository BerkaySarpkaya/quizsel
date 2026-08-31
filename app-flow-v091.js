// Quizsel v0.9.1 — race flow fix
// - Final returns to Home without Firebase sign-out.
// - All players answered => reveal immediately.
// - Between questions => "Diğer soruya geçiliyor" + 3 → 2 → 1.
(() => {
  "use strict";

  const FLOW_VERSION = "0.9.1";
  let finalSavePromise = Promise.resolve();
  let finalSaveFailed = false;

  function activePlayerIds(game = currentGame){
    return Object.keys(game?.players || {});
  }

  function allActivePlayersAnswered(game = currentGame){
    const ids = activePlayerIds(game);
    const key = game?.meta?.currentKey;
    if (!ids.length || !key) return false;

    const answers = game?.answers?.[key] || {};
    return ids.every(uid => Number.isInteger(answers?.[uid]?.choice));
  }

  // Final result recording is async. Track it so the Home button cannot clear
  // currentRoom/currentGame before stats/history writes finish.
  const baseRecordOwnFinal = recordOwnFinal;
  recordOwnFinal = function quizselFlowRecordOwnFinal(rows){
    finalSaveFailed = false;
    finalSavePromise = Promise.resolve(baseRecordOwnFinal.call(this, rows))
      .catch(err => {
        finalSaveFailed = true;
        console.error("[Quizsel] Final save failed:", err);
      });
    return finalSavePromise;
  };

  // Completed game: leave room state, keep Firebase Auth session, return Home.
  finishGame = async function quizselFlowFinishGame(){
    const btn = document.querySelector('#view-final button[onclick="finishGame()"]');
    if (btn){
      btn.disabled = true;
      btn.textContent = "Kaydediliyor…";
    }

    try{
      await finalSavePromise;

      localStorage.removeItem("quizsel_room");
      intentionalRoomExit = true;
      stopRoomWatch();
      intentionalRoomExit = false;

      await loadProfile().catch(err => {
        console.error("[Quizsel] Profile refresh after final failed:", err);
      });

      renderHome();

      toast(
        finalSaveFailed
          ? "Ana sayfaya dönüldü · bazı sonuç kayıtları doğrulanamadı."
          : "Oyun tamamlandı · ana sayfaya döndün."
      );
    }finally{
      if (btn){
        btn.disabled = false;
        btn.textContent = "Ana sayfaya dön";
      }
    }
  };

  // No HTML edit needed: rename the existing final button at runtime.
  const finalButton = document.querySelector('#view-final button[onclick="finishGame()"]');
  if (finalButton) finalButton.textContent = "Ana sayfaya dön";

  // Preserve the normal reveal UI, adding explicit all-answered feedback.
  const baseRenderGame = renderGame;
  renderGame = function quizselFlowRenderGame(){
    const result = baseRenderGame.apply(this, arguments);

    if (
      currentGame?.meta?.state === "reveal" &&
      allActivePlayersAnswered(currentGame)
    ){
      const status = $("answerStatus");
      const eyebrow = status?.querySelector(".eyebrow");
      if (eyebrow) eyebrow.textContent = "Herkes cevap verdi";

      if (status && !status.querySelector("[data-all-answered-note]")){
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

  // Initial game countdown stays as-is. Between questions use exact 3 → 2 → 1.
  renderCountdown = function quizselFlowRenderCountdown(){
    go("game");

    const meta = currentGame.meta;
    const betweenQuestions = Number(meta.currentIndex || 0) > 0;

    const tick = () => {
      const left = Math.max(0, meta.phaseEndsAt - serverNow());
      const num = $("countNum");

      let value;
      let label;

      if (betweenQuestions){
        value = String(Math.max(1, Math.ceil(left / 1000)));
        label = "Diğer soruya geçiliyor";
      }else{
        const n = Math.max(1, Math.ceil(left / 1000) - 1);
        value = left < 900 ? "BAŞLA" : String(n);
        label = left < 900 ? "Soru geliyor" : "Hazır olun";
      }

      if (num.textContent !== value){
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

  // Replace old hard-coded 2200 ms inter-question transition with configured 3 s.
  nextPhase = async function quizselFlowNextPhase(g){
    const next = Number(g.meta.currentIndex || 0) + 1;

    if (next >= currentQuiz.questions.length){
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

  // Host coordinator:
  // timer remains fallback, but last answer triggers immediate authoritative reveal.
  coordinateHost = function quizselFlowCoordinateHost(){
    if (!amHost()) return;

    const m = currentGame?.meta;
    if (!m) return;

    if (!["countdown", "question", "reveal"].includes(m.state)){
      stopHostTimer();
      return;
    }

    if (m.state === "question" && allActivePlayersAnswered(currentGame)){
      const earlyKey = `all-answered:${m.currentIndex}:${m.currentKey}`;
      if (hostTimerKey === earlyKey) return;

      stopHostTimer();
      hostTimerKey = earlyKey;

      // Debounce very briefly, then re-read Firebase before closing the question.
      hostTimer = setTimeout(async () => {
        const room = currentRoom;
        if (!room) return;

        const [metaSnap, playersSnap, answersSnap] = await Promise.all([
          db.ref(`games/${room}/meta`).get(),
          db.ref(`games/${room}/players`).get(),
          db.ref(`games/${room}/answers/${m.currentKey}`).get()
        ]);

        if (!metaSnap.exists()) return;

        const meta = metaSnap.val();
        if (meta.state !== "question" || meta.currentKey !== m.currentKey) return;

        const players = playersSnap.val() || {};
        const answersForKey = answersSnap.val() || {};
        const ids = Object.keys(players);

        const authoritativeAllAnswered =
          ids.length > 0 &&
          ids.every(uid => Number.isInteger(answersForKey?.[uid]?.choice));

        if (!authoritativeAllAnswered){
          hostTimer = null;
          hostTimerKey = "";
          coordinateHost();
          return;
        }

        await revealQuestion({
          meta,
          players,
          answers: {
            [meta.currentKey]: answersForKey
          }
        });
      }, 180);

      return;
    }

    // Original phase-deadline behavior remains as fallback.
    const key = `${m.state}:${m.currentIndex}:${m.phaseEndsAt}`;
    if (key === hostTimerKey) return;

    stopHostTimer();
    hostTimerKey = key;

    const wait = Math.max(0, m.phaseEndsAt - serverNow() + 120);

    hostTimer = setTimeout(async () => {
      const room = currentRoom;
      if (!room) return;

      const metaSnap = await db.ref(`games/${room}/meta`).get();
      if (!metaSnap.exists()) return;

      const meta = metaSnap.val();
      if (`${meta.state}:${meta.currentIndex}:${meta.phaseEndsAt}` !== key) return;

      if (meta.state === "countdown"){
        await beginQuestion(meta.currentIndex);

      }else if (meta.state === "question"){
        const [playersSnap, answersSnap] = await Promise.all([
          db.ref(`games/${room}/players`).get(),
          db.ref(`games/${room}/answers/${meta.currentKey}`).get()
        ]);

        await revealQuestion({
          meta,
          players: playersSnap.val() || {},
          answers: {
            [meta.currentKey]: answersSnap.val() || {}
          }
        });

      }else if (meta.state === "reveal"){
        await nextPhase({ meta });
      }
    }, wait);
  };

  console.info(`[Quizsel] race flow fix ${FLOW_VERSION} active`);
})();
