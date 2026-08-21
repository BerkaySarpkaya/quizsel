(() => {
  "use strict";

  const DEBUG_PERF = new URLSearchParams(location.search).get("debug") === "1";
  const perfNow = () => performance.now();
  const perfLog = (name, ms, extra = "") => {
    if (!DEBUG_PERF) return;
    const suffix = extra ? ` · ${extra}` : "";
    console.log(`[Quizsel Perf] ${name}: ${Math.round(ms * 10) / 10} ms${suffix}`);
  };

  if (DEBUG_PERF) {
    perfLog("app_boot", perfNow(), `client ${typeof CLIENT_VERSION !== "undefined" ? CLIENT_VERSION : "?"}`);
  }

  // ---------------------------------------------------------------------------
  // Lightweight performance marks for user-triggered flows.
  // ---------------------------------------------------------------------------
  let authFlowAt = 0;
  let joinFlowAt = 0;
  let hostFlowAt = 0;

  const baseSubmitAuth = submitAuth;
  submitAuth = async function quizselPerfSubmitAuth(...args) {
    authFlowAt = perfNow();
    return baseSubmitAuth.apply(this, args);
  };

  const baseRenderHome = renderHome;
  renderHome = function quizselPerfRenderHome(...args) {
    const t = perfNow();
    const result = baseRenderHome.apply(this, args);
    if (authFlowAt) {
      perfLog("auth_home_render", perfNow() - authFlowAt);
      authFlowAt = 0;
    }
    if (DEBUG_PERF) perfLog("home_render", perfNow() - t);
    return result;
  };

  const baseJoinByHomePin = joinByHomePin;
  joinByHomePin = async function quizselPerfJoin(...args) {
    joinFlowAt = perfNow();
    try {
      return await baseJoinByHomePin.apply(this, args);
    } catch (e) {
      joinFlowAt = 0;
      throw e;
    }
  };

  const baseHostQuiz = hostQuiz;
  hostQuiz = async function quizselPerfHostQuiz(...args) {
    hostFlowAt = perfNow();
    try {
      return await baseHostQuiz.apply(this, args);
    } catch (e) {
      hostFlowAt = 0;
      throw e;
    }
  };

  // ---------------------------------------------------------------------------
  // Quiz/manifest instrumentation. Existing RAM caches remain authoritative.
  // ---------------------------------------------------------------------------
  const baseLoadManifest = loadManifest;
  loadManifest = async function quizselPerfLoadManifest(force = false) {
    const cached = !force && !!manifestCache && Date.now() - manifestCacheAt < 30000;
    const t = perfNow();
    const value = await baseLoadManifest.call(this, force);
    perfLog(cached ? "manifest_cache_hit" : "manifest_load", perfNow() - t);
    return value;
  };

  const baseLoadQuiz = loadQuiz;
  loadQuiz = async function quizselPerfLoadQuiz(code) {
    const clean = String(code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "");
    const cached = !!clean && quizCache.has(clean);
    const t = perfNow();
    const value = await baseLoadQuiz.call(this, code);
    perfLog(cached ? "quiz_cache_hit" : "quiz_json_load", perfNow() - t, clean);
    return value;
  };

  // ---------------------------------------------------------------------------
  // Priority 2: next-question preparation and image decode/preload.
  // No quiz JSON is refetched; currentQuiz is already in RAM.
  // ---------------------------------------------------------------------------
  const preparedQuestions = new Map();
  const runIdle = cb => {
    if ("requestIdleCallback" in window) {
      return window.requestIdleCallback(cb, { timeout: 450 });
    }
    return setTimeout(cb, 0);
  };

  function prepareQuestion(index) {
    if (!currentQuiz?.questions?.[index]) return;

    const cacheKey = `${currentQuiz.code || "quiz"}:${index}`;
    if (preparedQuestions.has(cacheKey)) return;

    const q = currentQuiz.questions[index];
    preparedQuestions.set(cacheKey, {
      text: String(q.text || ""),
      options: Array.isArray(q.options) ? q.options.map(x => String(x)) : [],
      escapedOptions: Array.isArray(q.options) ? q.options.map(x => esc(x)) : []
    });

    if (q.image) {
      const img = new Image();
      img.decoding = "async";
      img.src = q.image;
      if (typeof img.decode === "function") img.decode().catch(() => {});
    }
  }

  function scheduleQuestionPreparation() {
    if (!currentGame?.meta || !currentQuiz?.questions?.length) return;
    const m = currentGame.meta;
    let index = null;

    if (m.state === "countdown") index = Number(m.currentIndex || 0);
    else if (m.state === "question" || m.state === "reveal") index = Number(m.currentIndex || 0) + 1;

    if (index === null || index >= currentQuiz.questions.length) return;
    runIdle(() => prepareQuestion(index));
  }

  // ---------------------------------------------------------------------------
  // Priority 3: quiz browser lazy rendering.
  // ---------------------------------------------------------------------------
  let quizObserver = null;
  const QUIZ_BATCH_SIZE = 12;

  openQuizBrowser = async function quizselLazyBrowser() {
    const started = perfNow();
    go("quizzes");
    clearErr("quizCodeErr");

    if (quizObserver) {
      quizObserver.disconnect();
      quizObserver = null;
    }

    const list = $("quizList");
    list.innerHTML = '<div class="empty">Quizler yükleniyor…</div>';

    try {
      const m = await loadManifest();
      const quizzes = Array.isArray(m?.quizzes) ? m.quizzes : [];
      list.innerHTML = "";

      let rendered = 0;
      const sentinel = document.createElement("div");
      sentinel.style.gridColumn = "1 / -1";
      sentinel.style.textAlign = "center";

      const renderBatch = () => {
        const end = Math.min(quizzes.length, rendered + QUIZ_BATCH_SIZE);
        const fragment = document.createDocumentFragment();

        for (; rendered < end; rendered++) {
          fragment.appendChild(quizCard(quizzes[rendered]));
        }

        list.insertBefore(fragment, sentinel);

        if (rendered >= quizzes.length) {
          quizObserver?.disconnect();
          quizObserver = null;
          sentinel.remove();
        } else {
          sentinel.innerHTML = '<button class="btn soft sm" type="button">Daha fazla quiz göster</button>';
          sentinel.querySelector("button").onclick = renderBatch;
        }
      };

      list.appendChild(sentinel);
      renderBatch();
      perfLog("home_quiz_browser", perfNow() - started, `${Math.min(QUIZ_BATCH_SIZE, quizzes.length)} ilk kart`);

      if (sentinel.isConnected && "IntersectionObserver" in window) {
        quizObserver = new IntersectionObserver(entries => {
          if (entries.some(x => x.isIntersecting)) renderBatch();
        }, { rootMargin: "320px 0px" });
        quizObserver.observe(sentinel);
      }
    } catch (e) {
      list.innerHTML = `
        <div class="empty">
          ${esc(e.message)}
          <br><span class="tiny">Kodla açma yine kullanılabilir.</span>
        </div>
      `;
    }
  };

  // ---------------------------------------------------------------------------
  // Priority 4: local-response / Firebase-ack instrumentation.
  // Optimistic behavior is intentionally kept equivalent to v0.9.
  // ---------------------------------------------------------------------------
  toggleReady = async function quizselPerfToggleReady() {
    const user = auth.currentUser;
    const player = myPlayer();
    if (!user || !currentRoom || !player || readyPending) return;

    const started = perfNow();
    const previous = !!player.ready;
    const next = !previous;

    readyPending = true;
    player.ready = next;
    renderLobby();
    perfLog("ready_local_ui", perfNow() - started);

    try {
      await db.ref(`games/${currentRoom}/players/${user.uid}/ready`).set(next);
      perfLog("ready_firebase_ack", perfNow() - started);
    } catch (e) {
      player.ready = previous;
      toast("Hazır durumu güncellenemedi. Tekrar dene.");
    } finally {
      readyPending = false;
      if (currentGame?.meta?.state === "lobby") renderLobby();
    }
  };

  submitAnswer = async function quizselPerfSubmitAnswer(choice) {
    if (currentGame?.meta?.state !== "question" || myAnswer()) return;

    const started = perfNow();
    const uid = auth.currentUser.uid;
    const key = currentGame.meta.currentKey;
    const ref = db.ref(`games/${currentRoom}/answers/${key}/${uid}`);

    currentGame.answers = currentGame.answers || {};
    currentGame.answers[key] = currentGame.answers[key] || {};
    currentGame.answers[key][uid] = {
      choice,
      answeredAt: serverNow(),
      pending: true
    };

    renderGame();
    perfLog("answer_local_ui", perfNow() - started);

    try {
      await ref.set({ choice, answeredAt: TS });
      perfLog("answer_firebase_ack", perfNow() - started);
    } catch (e) {
      const optimistic = currentGame?.answers?.[key]?.[uid];
      if (optimistic?.pending) delete currentGame.answers[key][uid];
      renderGame();
      toast("Cevap gönderilemedi. Tekrar dene.");
    }
  };

  // ---------------------------------------------------------------------------
  // Priority 1: split room listeners (meta / players / current-question answers).
  // The Firebase schema and rules are unchanged.
  // ---------------------------------------------------------------------------
  const baseStopRoomWatch = stopRoomWatch;

  let splitMetaRef = null;
  let splitPlayersRef = null;
  let splitAnswerRef = null;
  let splitMetaListener = null;
  let splitPlayersListener = null;
  let splitAnswerListener = null;
  let splitAnswerKey = "";
  let splitGeneration = 0;
  let splitMetaReady = false;
  let splitPlayersReady = false;
  let splitAnswerReady = true;
  let splitRenderFrame = 0;
  let pendingFirebaseRenderAt = 0;
  let pendingQuestionRenderAt = 0;
  let endedHydrationKey = "";

  function detachSplitListeners() {
    if (splitMetaRef && splitMetaListener) splitMetaRef.off("value", splitMetaListener);
    if (splitPlayersRef && splitPlayersListener) splitPlayersRef.off("value", splitPlayersListener);
    if (splitAnswerRef && splitAnswerListener) splitAnswerRef.off("value", splitAnswerListener);

    splitMetaRef = null;
    splitPlayersRef = null;
    splitAnswerRef = null;
    splitMetaListener = null;
    splitPlayersListener = null;
    splitAnswerListener = null;
    splitAnswerKey = "";
    splitMetaReady = false;
    splitPlayersReady = false;
    splitAnswerReady = true;
    pendingFirebaseRenderAt = 0;
    pendingQuestionRenderAt = 0;
    endedHydrationKey = "";

    if (splitRenderFrame) cancelAnimationFrame(splitRenderFrame);
    splitRenderFrame = 0;
  }

  stopRoomWatch = function quizselSplitStopRoomWatch() {
    splitGeneration++;
    detachSplitListeners();
    baseStopRoomWatch();
  };

  function noteFirebaseUpdate() {
    if (!pendingFirebaseRenderAt) pendingFirebaseRenderAt = perfNow();
  }

  function roomReadyToRender() {
    if (!currentGame?.meta || !currentQuiz || !splitMetaReady || !splitPlayersReady) return false;
    const state = currentGame.meta.state;
    const needsAnswer = state === "question" || state === "reveal";
    return !needsAnswer || splitAnswerReady;
  }

  function scheduleSplitRender() {
    if (!roomReadyToRender() || splitRenderFrame) return;

    splitRenderFrame = requestAnimationFrame(() => {
      splitRenderFrame = 0;
      if (!roomReadyToRender()) return;

      const renderStarted = perfNow();
      renderRoom();
      coordinateHost();
      scheduleQuestionPreparation();

      if (pendingFirebaseRenderAt) {
        perfLog("firebase_room_update_dom", perfNow() - pendingFirebaseRenderAt);
        pendingFirebaseRenderAt = 0;
      }
      if (pendingQuestionRenderAt && currentGame?.meta?.state === "question") {
        perfLog("question_transition_duration", perfNow() - pendingQuestionRenderAt);
        pendingQuestionRenderAt = 0;
      }
      perfLog("room_render", perfNow() - renderStarted, currentGame?.meta?.state || "?");

      if (currentGame?.meta?.state === "lobby") {
        if (joinFlowAt) {
          perfLog("join_lobby_visible", perfNow() - joinFlowAt);
          joinFlowAt = 0;
        }
        if (hostFlowAt) {
          perfLog("host_lobby_visible", perfNow() - hostFlowAt);
          hostFlowAt = 0;
        }
      }
    });
  }

  function closeMissingRoom(pin) {
    if (currentRoom !== pin) return;
    if (!intentionalRoomExit) toast("Yarışma sona erdi veya oda kapandı.");
    localStorage.removeItem("quizsel_room");
    stopRoomWatch();
    renderHome();
  }

  function syncCurrentAnswerListener(pin, generation) {
    const meta = currentGame?.meta;
    const key = meta?.currentKey || "";
    const shouldListen = !!key && (meta.state === "countdown" || meta.state === "question" || meta.state === "reveal");

    if (!shouldListen) {
      if (splitAnswerRef && splitAnswerListener) splitAnswerRef.off("value", splitAnswerListener);
      splitAnswerRef = null;
      splitAnswerListener = null;
      splitAnswerKey = "";
      splitAnswerReady = true;
      return;
    }

    if (splitAnswerKey === key && splitAnswerRef && splitAnswerListener) return;

    if (splitAnswerRef && splitAnswerListener) splitAnswerRef.off("value", splitAnswerListener);
    splitAnswerKey = key;
    splitAnswerReady = false;
    splitAnswerRef = db.ref(`games/${pin}/answers/${key}`);
    splitAnswerListener = splitAnswerRef.on("value", snap => {
      if (generation !== splitGeneration || currentRoom !== pin || splitAnswerKey !== key) return;
      noteFirebaseUpdate();
      currentGame.answers = currentGame.answers || {};
      currentGame.answers[key] = snap.val() || {};
      splitAnswerReady = true;
      scheduleSplitRender();
    });
  }

  async function hydrateEndedAnswers(pin, generation, meta) {
    const hydrateKey = `${pin}:${meta.createdAt || ""}:${meta.currentIndex || 0}`;
    if (endedHydrationKey === hydrateKey) return;
    endedHydrationKey = hydrateKey;

    const snap = await db.ref(`games/${pin}/answers`).get().catch(() => null);
    if (generation !== splitGeneration || currentRoom !== pin) return;
    currentGame.answers = snap?.val() || currentGame.answers || {};
  }

  watchRoom = function quizselSplitWatchRoom(pin) {
    stopRoomWatch();

    const generation = splitGeneration;
    currentRoom = pin;
    currentGame = { meta: null, players: {}, answers: {} };
    roomRef = null;
    roomListener = null;

    splitMetaRef = db.ref(`games/${pin}/meta`);
    splitPlayersRef = db.ref(`games/${pin}/players`);

    splitMetaListener = splitMetaRef.on("value", async snap => {
      if (generation !== splitGeneration || currentRoom !== pin) return;
      noteFirebaseUpdate();

      if (!snap.exists()) {
        closeMissingRoom(pin);
        return;
      }

      const previousState = currentGame?.meta?.state;
      const previousKey = currentGame?.meta?.currentKey;
      currentGame.meta = snap.val();
      splitMetaReady = true;

      try {
        if (!currentQuiz || currentQuiz.code !== currentGame.meta.quizCode) {
          currentQuiz = await loadQuiz(currentGame.meta.quizCode);
          if (generation !== splitGeneration || currentRoom !== pin) return;
        }

        if (previousState !== "question" && currentGame.meta.state === "question") {
          pendingQuestionRenderAt = perfNow();
        } else if (previousKey !== currentGame.meta.currentKey && currentGame.meta.state === "question") {
          pendingQuestionRenderAt = perfNow();
        }

        syncCurrentAnswerListener(pin, generation);

        if (currentGame.meta.state === "ended") {
          await hydrateEndedAnswers(pin, generation, currentGame.meta);
        }

        if (amHost()) {
          await setupHostPresence().catch(() => {});
          if (splitPlayersReady) await maybeResetReadyAfterRosterChange().catch(() => {});
        }
        if (["question", "reveal", "ended"].includes(currentGame.meta.state)) {
          await markQuizSeen().catch(() => {});
        }

        scheduleSplitRender();
      } catch (e) {
        console.error(e);
        toast("Quiz yüklenemedi: " + e.message);
      }
    });

    splitPlayersListener = splitPlayersRef.on("value", async snap => {
      if (generation !== splitGeneration || currentRoom !== pin) return;
      noteFirebaseUpdate();
      currentGame.players = snap.val() || {};
      splitPlayersReady = true;

      if (amHost()) await maybeResetReadyAfterRosterChange().catch(() => {});
      scheduleSplitRender();
    });
  };

  // Keep the static timer label consistent before the first clock tick.
  if ($("gameTimer")) $("gameTimer").textContent = `${Number(CFG.questionSeconds || 20)} sn`;

  // If Firebase Auth restored a room before this layer finished loading, migrate
  // that already-running full-room listener to the split listener architecture.
  if (currentRoom) {
    const pin = currentRoom;
    watchRoom(pin);
  }
})();
