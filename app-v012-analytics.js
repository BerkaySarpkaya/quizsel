// Quizsel v0.12.1 — durable analytics + final navigation guard
// Loads after app-v010-runtime.js and waits for the v0.11 reliability layer.
//
// Goals:
// 1) Keep live game state (games/) separate from durable analytics truth.
// 2) Preserve a full immutable match snapshot for every terminal match.
// 3) Preserve player data before leave/kick paths delete live player/answer state.
// 4) Never let a destructive user action silently erase analytics data.
(() => {
  "use strict";

  const ANALYTICS_VERSION = "0.12.1";
  const ARCHIVE_SCHEMA_VERSION = 1;
  const PENDING_ARCHIVE_KEY = "quizsel_pending_match_archives_v1";
  const BACKFILL_SESSION_KEY = "quizsel_analytics_backfill_v1";
  const ADMIN_EMAIL = String(CFG?.adminInternalEmail || "quizsel-admin@quizsel.app");

  const volatilePending = {};
  const archiveInFlight = new Map();
  let installed = false;
  let pendingRetryPromise = null;
  let backfillPromise = null;

  function nowMs() {
    return typeof serverNow === "function" ? Number(serverNow()) : Date.now();
  }

  function finiteNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function integerOrNull(value) {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }

  function safeJsonParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function safeLocalStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn("[Quizsel Analytics] localStorage read unavailable:", err);
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn("[Quizsel Analytics] localStorage write unavailable:", err);
      return false;
    }
  }

  function safeLocalStorageRemove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (err) {
      console.warn("[Quizsel Analytics] localStorage remove unavailable:", err);
      return false;
    }
  }

  function safeSessionStorageGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeSessionStorageSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function isCurrentAdmin() {
    return !!auth.currentUser && auth.currentUser.email === ADMIN_EMAIL;
  }

  function safePathSegment(value) {
    return String(value ?? "")
      .replace(/[.#$\[\]\/]/g, "_")
      .slice(0, 180);
  }

  function matchIdFor(room, createdAt) {
    const r = safePathSegment(room);
    const c = Math.trunc(Number(createdAt || 0));
    if (!r || !c) return "";
    return `${r}_${c}`;
  }

  function pendingKeyFor(room, createdAt) {
    return matchIdFor(room, createdAt);
  }

  function readPendingArchives() {
    const persisted = safeJsonParse(safeLocalStorageGet(PENDING_ARCHIVE_KEY) || "{}", {});
    return { ...persisted, ...volatilePending };
  }

  function writePendingArchives(map) {
    const normalized = Object.fromEntries(
      Object.entries(map || {}).filter(([, item]) => item && typeof item === "object")
    );

    Object.keys(volatilePending).forEach(key => delete volatilePending[key]);
    Object.assign(volatilePending, normalized);

    if (!Object.keys(normalized).length) {
      safeLocalStorageRemove(PENDING_ARCHIVE_KEY);
      return true;
    }

    return safeLocalStorageSet(PENDING_ARCHIVE_KEY, JSON.stringify(normalized));
  }

  function rememberPendingArchive({ room, createdAt, reason, terminalObservedAt = null }) {
    const key = pendingKeyFor(room, createdAt);
    if (!key) return;
    const map = readPendingArchives();
    map[key] = {
      room: String(room),
      createdAt: Number(createdAt),
      reason: String(reason || "completed"),
      terminalObservedAt: finiteNumber(terminalObservedAt, null),
      capturedAt: Date.now()
    };
    writePendingArchives(map);
  }

  function forgetPendingArchive(room, createdAt) {
    const key = pendingKeyFor(room, createdAt);
    if (!key) return;
    const map = readPendingArchives();
    if (!map[key]) return;
    delete map[key];
    writePendingArchives(map);
  }

  function quizFingerprintPayload(quiz) {
    return {
      schemaVersion: finiteNumber(quiz?.schemaVersion, null),
      code: String(quiz?.code || ""),
      version: finiteNumber(quiz?.version, null),
      title: String(quiz?.title || ""),
      questions: (quiz?.questions || []).map(q => ({
        id: integerOrNull(q?.id),
        text: String(q?.text || ""),
        options: Array.isArray(q?.options) ? q.options.map(x => String(x)) : [],
        answer: integerOrNull(q?.answer),
        time: finiteNumber(q?.time, null),
        questionType: String(q?.questionType || "")
      }))
    };
  }

  function fnv1a32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  async function fingerprintQuiz(quiz) {
    const serialized = JSON.stringify(quizFingerprintPayload(quiz));
    if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
      try {
        const digest = await globalThis.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(serialized)
        );
        const hex = Array.from(new Uint8Array(digest))
          .map(byte => byte.toString(16).padStart(2, "0"))
          .join("");
        return { algorithm: "sha256", value: hex };
      } catch (err) {
        console.warn("[Quizsel Analytics] SHA-256 unavailable, using fallback:", err);
      }
    }
    return { algorithm: "fnv1a32-fallback", value: fnv1a32(serialized) };
  }

  function questionTruth(quiz) {
    return (quiz?.questions || []).map((q, index) => ({
      key: qKey(index),
      index,
      id: integerOrNull(q?.id),
      answer: integerOrNull(q?.answer),
      time: finiteNumber(q?.time, finiteNumber(CFG?.questionSeconds, 20)),
      questionType: String(q?.questionType || "multiple-choice"),
      optionCount: Array.isArray(q?.options) ? q.options.length : 0,
      hasImage: !!q?.image
    }));
  }

  function rawAnswerCopy(answer) {
    if (!answer || typeof answer !== "object") return null;
    const out = {};
    if (Number.isInteger(Number(answer.choice))) out.choice = Number(answer.choice);
    if (Number.isFinite(Number(answer.answeredAt))) out.answeredAt = Number(answer.answeredAt);
    if (typeof answer.correct === "boolean") out.correct = answer.correct;
    if (Number.isFinite(Number(answer.points))) out.points = Number(answer.points);
    if (Number.isFinite(Number(answer.elapsedMs))) out.elapsedMs = Number(answer.elapsedMs);
    return Object.keys(out).length ? out : null;
  }

  function collectRawAnswersForUid(game, uid) {
    const out = {};
    for (const [key, rows] of Object.entries(game?.answers || {})) {
      const copied = rawAnswerCopy(rows?.[uid]);
      if (copied) out[key] = copied;
    }
    return out;
  }

  function playerSnapshot(player) {
    if (!player || typeof player !== "object") return null;
    return {
      name: String(player.name || "Oyuncu"),
      ready: !!player.ready,
      score: finiteNumber(player.score, 0),
      totalMs: finiteNumber(player.totalMs, 0),
      joinedAt: finiteNumber(player.joinedAt, 0),
      seenQuizBefore: !!player.seenQuizBefore,
      quizSeenCount: finiteNumber(player.quizSeenCount, 0),
      clientVersion: String(player.clientVersion || "")
    };
  }

  function phaseSnapshot(meta) {
    return {
      state: String(meta?.state || ""),
      currentIndex: finiteNumber(meta?.currentIndex, 0),
      currentKey: String(meta?.currentKey || ""),
      phaseStartedAt: finiteNumber(meta?.phaseStartedAt, 0),
      phaseEndsAt: finiteNumber(meta?.phaseEndsAt, 0)
    };
  }

  async function fetchGame(room) {
    const snap = await db.ref(`games/${room}`).get();
    if (!snap.exists()) return null;
    return snap.val();
  }

  async function fetchDepartureEvents(room, createdAt) {
    const snap = await db.ref(`analyticsDepartures/${room}/${createdAt}`).get();
    return snap.exists() ? snap.val() || {} : {};
  }

  async function captureDepartureEvent(game, room, uid, reason) {
    const meta = game?.meta;
    const player = game?.players?.[uid];
    if (!meta?.createdAt || !player) {
      throw new Error("Ayrılma snapshot'ı için canlı oyuncu verisi bulunamadı.");
    }

    const ref = db.ref(`analyticsDepartures/${room}/${meta.createdAt}`).push();
    const payload = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      eventId: ref.key,
      matchId: matchIdFor(room, meta.createdAt),
      room: String(room),
      createdAt: Number(meta.createdAt),
      uid: String(uid),
      capturedAt: nowMs(),
      reason: String(reason || "left"),
      captureType: "pre_removal",
      phase: phaseSnapshot(meta),
      player: playerSnapshot(player),
      answers: collectRawAnswersForUid(game, uid)
    };

    await ref.set(payload);
    return payload;
  }

  function maxExposedIndexFor(activeAtArchive, terminalGame, departureEvents, questionCount) {
    if (activeAtArchive) {
      const state = String(terminalGame?.meta?.state || "");
      if (state === "ended") return Math.max(-1, questionCount - 1);
      const index = Math.max(0, Number(terminalGame?.meta?.currentIndex || 0));
      return ["question", "reveal"].includes(state) ? index : index - 1;
    }

    let max = -1;
    for (const event of departureEvents || []) {
      const state = String(event?.phase?.state || "");
      const index = Math.max(0, Number(event?.phase?.currentIndex || 0));
      const exposed = ["question", "reveal"].includes(state) ? index : index - 1;
      max = Math.max(max, exposed);
    }
    return Math.min(Math.max(-1, max), Math.max(-1, questionCount - 1));
  }

  function deriveAnswer(raw, truth, phase) {
    if (!raw || !truth || !Number.isInteger(Number(raw.choice))) return null;

    const choice = Number(raw.choice);
    const officialCorrect = typeof raw.correct === "boolean";
    const correct = officialCorrect ? raw.correct : choice === Number(truth.answer);

    let elapsedMs = finiteNumber(raw.elapsedMs, null);
    if (
      elapsedMs === null &&
      finiteNumber(raw.answeredAt, null) !== null &&
      finiteNumber(phase?.phaseStartedAt, null) !== null &&
      String(phase?.currentKey || "") === String(truth.key)
    ) {
      const limit = Math.max(1, Number(truth.time || CFG?.questionSeconds || 20)) * 1000;
      elapsedMs = Math.max(
        0,
        Math.min(limit, Number(raw.answeredAt) - Number(phase.phaseStartedAt))
      );
    }

    let points = finiteNumber(raw.points, null);
    let scoringSource = "official";

    if (!officialCorrect || points === null || finiteNumber(raw.elapsedMs, null) === null) {
      scoringSource = "derived_snapshot";
      if (points === null && correct && elapsedMs !== null) {
        const limit = Math.max(1, Number(truth.time || CFG?.questionSeconds || 20)) * 1000;
        const frac = Math.min(1, Math.max(0, elapsedMs) / limit);
        points = Math.round(500 + 500 * (1 - frac));
      } else if (points === null && !correct) {
        points = 0;
      }
    }

    return {
      questionId: truth.id,
      choice,
      answeredAt: finiteNumber(raw.answeredAt, null),
      correct: !!correct,
      points,
      elapsedMs,
      scoringSource
    };
  }

  function flattenDepartureEvents(rawEvents) {
    return Object.values(rawEvents || {})
      .filter(event => event && typeof event === "object" && event.uid)
      .sort((a, b) => Number(a.capturedAt || 0) - Number(b.capturedAt || 0));
  }

  function participantOutcome(activeAtArchive, terminalStatus, events) {
    if (activeAtArchive) {
      return terminalStatus === "completed" ? "completed" : "present_at_termination";
    }
    const last = events?.[events.length - 1];
    return String(last?.reason || "departed");
  }

  function buildParticipants(game, quiz, departureEvents, terminalStatus) {
    const truths = questionTruth(quiz);
    const byUid = new Map();
    const eventsByUid = new Map();

    for (const event of departureEvents) {
      const uid = String(event.uid || "");
      if (!uid) continue;
      if (!eventsByUid.has(uid)) eventsByUid.set(uid, []);
      eventsByUid.get(uid).push(event);

      if (!byUid.has(uid)) {
        byUid.set(uid, {
          uid,
          player: event.player || null,
          activeAtArchive: false,
          rawAnswers: new Map()
        });
      }

      const rec = byUid.get(uid);
      if (event.player) rec.player = event.player;
      for (const [key, answer] of Object.entries(event.answers || {})) {
        rec.rawAnswers.set(key, { raw: answer, phase: event.phase || {} });
      }
    }

    for (const [uid, player] of Object.entries(game?.players || {})) {
      if (!byUid.has(uid)) {
        byUid.set(uid, { uid, player: null, activeAtArchive: true, rawAnswers: new Map() });
      }
      const rec = byUid.get(uid);
      rec.player = playerSnapshot(player);
      rec.activeAtArchive = true;
      for (const [key, rows] of Object.entries(game?.answers || {})) {
        const answer = rawAnswerCopy(rows?.[uid]);
        if (answer) rec.rawAnswers.set(key, { raw: answer, phase: phaseSnapshot(game.meta) });
      }
    }

    const participants = [];

    for (const [uid, rec] of byUid) {
      const events = eventsByUid.get(uid) || [];
      const answers = {};
      let answeredCount = 0;
      let correctCount = 0;
      let totalElapsedMs = 0;
      let elapsedCount = 0;
      let derivedPotentialPoints = 0;

      truths.forEach(truth => {
        const source = rec.rawAnswers.get(truth.key);
        if (!source) return;
        const normalized = deriveAnswer(source.raw, truth, source.phase);
        if (!normalized) return;
        answers[truth.key] = normalized;
        answeredCount++;
        if (normalized.correct) correctCount++;
        if (normalized.elapsedMs !== null) {
          totalElapsedMs += Number(normalized.elapsedMs);
          elapsedCount++;
        }
        if (normalized.scoringSource !== "official") {
          derivedPotentialPoints += Number(normalized.points || 0);
        }
      });

      const player = rec.player || {};
      const maxExposedIndex = maxExposedIndexFor(
        rec.activeAtArchive,
        game,
        events,
        truths.length
      );

      participants.push({
        uid,
        name: String(player.name || "Oyuncu"),
        activeAtArchive: !!rec.activeAtArchive,
        outcome: participantOutcome(rec.activeAtArchive, terminalStatus, events),
        joinedAt: finiteNumber(player.joinedAt, 0),
        officialScore: finiteNumber(player.score, 0),
        officialTotalMs: finiteNumber(player.totalMs, 0),
        seenQuizBefore: !!player.seenQuizBefore,
        quizSeenCount: finiteNumber(player.quizSeenCount, 0),
        clientVersion: String(player.clientVersion || ""),
        answeredCount,
        correctCount,
        wrongCount: Math.max(0, answeredCount - correctCount),
        accuracy: answeredCount ? correctCount / answeredCount : null,
        avgElapsedMs: elapsedCount ? Math.round(totalElapsedMs / elapsedCount) : null,
        derivedPotentialPoints,
        maxExposedIndex,
        departureEvents: events.map(event => ({
          eventId: String(event.eventId || ""),
          capturedAt: finiteNumber(event.capturedAt, 0),
          reason: String(event.reason || "departed"),
          state: String(event.phase?.state || ""),
          currentIndex: finiteNumber(event.phase?.currentIndex, 0)
        })),
        answers
      });
    }

    const rankable = participants
      .filter(p => p.activeAtArchive)
      .sort((a, b) =>
        Number(b.officialScore || 0) - Number(a.officialScore || 0) ||
        Number(a.officialTotalMs || 0) - Number(b.officialTotalMs || 0) ||
        String(a.name).localeCompare(String(b.name), "tr")
      );

    rankable.forEach((p, index) => {
      p.rankAtArchive = index + 1;
      p.won = terminalStatus === "completed" && index === 0;
    });

    participants.forEach(p => {
      if (!p.rankAtArchive) p.rankAtArchive = null;
      if (typeof p.won !== "boolean") p.won = false;
    });

    return participants.sort((a, b) =>
      (a.rankAtArchive ?? Number.MAX_SAFE_INTEGER) -
        (b.rankAtArchive ?? Number.MAX_SAFE_INTEGER) ||
      Number(a.joinedAt || 0) - Number(b.joinedAt || 0) ||
      String(a.name).localeCompare(String(b.name), "tr")
    );
  }

  function buildQuestionStats(quiz, participants) {
    const truths = questionTruth(quiz);

    return truths.map(truth => {
      const eligible = participants.filter(p => Number(p.maxExposedIndex) >= truth.index);
      const answered = eligible
        .map(p => p.answers?.[truth.key])
        .filter(Boolean);
      const correct = answered.filter(a => a.correct === true);
      const elapsed = answered
        .map(a => finiteNumber(a.elapsedMs, null))
        .filter(v => v !== null);
      const optionCounts = Array.from({ length: Math.max(0, Number(truth.optionCount || 0)) }, () => 0);

      answered.forEach(a => {
        const choice = integerOrNull(a.choice);
        if (choice !== null && choice >= 0 && choice < optionCounts.length) optionCounts[choice]++;
      });

      return {
        key: truth.key,
        questionId: truth.id,
        eligibleCount: eligible.length,
        answeredCount: answered.length,
        unansweredCount: Math.max(0, eligible.length - answered.length),
        correctCount: correct.length,
        wrongCount: Math.max(0, answered.length - correct.length),
        accuracyAmongAnswers: answered.length ? correct.length / answered.length : null,
        successRateAmongEligible: eligible.length ? correct.length / eligible.length : null,
        avgElapsedMs: elapsed.length
          ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length)
          : null,
        optionCounts
      };
    });
  }

  async function buildMatchArchive(game, room, reason, options = {}) {
    const backfilled = !!options.backfilled;
    const meta = game?.meta;
    if (!meta?.createdAt || !meta?.quizCode) {
      throw new Error("Maç arşivi için meta.createdAt / quizCode eksik.");
    }

    const [quiz, departureRaw] = await Promise.all([
      loadQuiz(meta.quizCode),
      fetchDepartureEvents(room, meta.createdAt)
    ]);

    const fingerprint = await fingerprintQuiz(quiz);
    const departureEvents = flattenDepartureEvents(departureRaw);
    const terminalStatus = String(meta.state) === "ended" || String(reason).startsWith("completed")
      ? "completed"
      : "terminated";
    const participants = buildParticipants(game, quiz, departureEvents, terminalStatus);
    const questions = questionTruth(quiz);
    const questionStats = buildQuestionStats(quiz, participants);
    const archivedAt = nowMs();
    const startedAt = finiteNumber(meta.startedAt, null);
    const observedTerminalAt = finiteNumber(options.terminalObservedAt, null);
    const endedAt = finiteNumber(meta.endedAt, null) ??
      (backfilled ? null : (observedTerminalAt ?? archivedAt));
    const rankable = participants.filter(p => p.activeAtArchive && p.rankAtArchive !== null);
    const winner = terminalStatus === "completed" && rankable.length
      ? rankable.find(p => p.rankAtArchive === 1) || null
      : null;
    const clientVersions = Array.from(
      new Set(participants.map(p => p.clientVersion).filter(Boolean))
    ).sort();

    const answersRecorded = participants.reduce(
      (sum, p) => sum + Number(p.answeredCount || 0),
      0
    );
    const correctAnswersRecorded = participants.reduce(
      (sum, p) => sum + Number(p.correctCount || 0),
      0
    );

    const archive = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      matchId: matchIdFor(room, meta.createdAt),
      room: String(room),
      createdAt: Number(meta.createdAt),
      startedAt,
      endedAt,
      archivedAt,
      terminalStatus,
      terminalReason: String(reason || "completed"),
      sourceGameState: String(meta.state || ""),
      backfilled: !!backfilled,
      archivedByUid: String(auth.currentUser?.uid || ""),
      archivedByRole: isCurrentAdmin() ? "admin" : "host",
      runtime: {
        appRuntimeVersion: String(window.QUIZSEL_RUNTIME_VERSION || ""),
        reliabilityVersion: String(window.QUIZSEL_RELIABILITY_VERSION || ""),
        analyticsVersion: ANALYTICS_VERSION,
        clientVersions
      },
      quiz: {
        code: String(quiz.code || meta.quizCode || ""),
        title: String(quiz.title || meta.quizTitle || ""),
        category: String(quiz.category || ""),
        difficulty: finiteNumber(quiz.difficulty, finiteNumber(meta.difficulty, null)),
        version: finiteNumber(meta.quizVersion, finiteNumber(quiz.version, null)),
        schemaVersion: finiteNumber(meta.quizSchemaVersion, finiteNumber(quiz.schemaVersion, null)),
        totalQuestions: questions.length,
        fingerprintAlgorithm: String(meta.quizFingerprintAlgorithm || fingerprint.algorithm),
        fingerprint: String(meta.quizFingerprint || fingerprint.value),
        sourceFingerprintAtArchive: fingerprint.value,
        fingerprintMatchesCurrentSource: meta.quizFingerprint
          ? String(meta.quizFingerprint) === String(fingerprint.value)
          : null,
        questions
      },
      host: {
        uid: String(meta.hostUid || ""),
        name: String(meta.hostName || "")
      },
      summary: {
        participantCount: participants.length,
        activeAtArchiveCount: participants.filter(p => p.activeAtArchive).length,
        departedParticipantCount: participants.filter(p => !p.activeAtArchive).length,
        departureEventCount: departureEvents.length,
        answersRecorded,
        correctAnswersRecorded,
        overallAccuracy: answersRecorded ? correctAnswersRecorded / answersRecorded : null,
        durationMs: startedAt !== null && endedAt !== null
          ? Math.max(0, endedAt - startedAt)
          : null
      },
      winner: winner
        ? {
            uid: winner.uid,
            name: winner.name,
            score: winner.officialScore,
            totalMs: winner.officialTotalMs
          }
        : null,
      participants,
      questionStats
    };

    if (!archive.matchId) throw new Error("Geçerli matchId üretilemedi.");
    return archive;
  }

  async function existingArchive(ref) {
    try {
      const snap = await ref.get();
      return snap.exists() ? snap.val() : null;
    } catch (err) {
      if (String(err?.code || "").toLowerCase().includes("permission")) return null;
      throw err;
    }
  }

  async function persistArchive(room, createdAt, reason, options = {}) {
    const matchId = matchIdFor(room, createdAt);
    if (!matchId) throw new Error("Maç kimliği oluşturulamadı.");

    const existingPromise = archiveInFlight.get(matchId);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      const ref = db.ref(`matchArchive/${matchId}`);
      const existing = await existingArchive(ref);
      if (existing) {
        db.ref(`games/${room}/meta`).update({
          archiveId: String(existing.matchId || matchId),
          archivedAt: finiteNumber(existing.archivedAt, nowMs()),
          archiveSchemaVersion: finiteNumber(existing.schemaVersion, ARCHIVE_SCHEMA_VERSION)
        }).catch(() => {});
        return existing;
      }

      const game = options.game || await fetchGame(room);
      if (!game?.meta) throw new Error(`Canlı maç verisi bulunamadı: ${room}`);
      if (Number(game.meta.createdAt) !== Number(createdAt)) {
        throw new Error("Oda kodu yeniden kullanılmış; createdAt eşleşmiyor.");
      }

      const terminalObservedAt = finiteNumber(options.terminalObservedAt, null);
      if (
        game.meta.state === "ended" &&
        !options.backfilled &&
        !finiteNumber(game.meta.endedAt, null)
      ) {
        const candidateEndedAt = terminalObservedAt ?? nowMs();
        try {
          const tx = await db.ref(`games/${room}/meta/endedAt`).transaction(value =>
            value || candidateEndedAt
          );
          if (tx?.committed) game.meta.endedAt = finiteNumber(tx.snapshot?.val(), candidateEndedAt);
        } catch (err) {
          console.warn("[Quizsel Analytics] endedAt stamp failed; archive keeps observed time:", err);
          game.meta.endedAt = candidateEndedAt;
        }
      }

      const archive = await buildMatchArchive(game, room, reason, options);

      try {
        await ref.set(archive);
      } catch (err) {
        // A concurrent writer may have won the create-only race.
        const after = await existingArchive(ref);
        if (after) return after;
        throw err;
      }

      // Operational marker only. Analytics truth is matchArchive, not games/meta.
      db.ref(`games/${room}/meta`).update({
        archiveId: archive.matchId,
        archivedAt: archive.archivedAt,
        archiveSchemaVersion: ARCHIVE_SCHEMA_VERSION
      }).catch(() => {});

      return archive;
    })().finally(() => {
      archiveInFlight.delete(matchId);
    });

    archiveInFlight.set(matchId, promise);
    return promise;
  }

  function queueCompletedArchive(room, createdAt) {
    if (!room || !createdAt) return;
    const terminalObservedAt = nowMs();
    rememberPendingArchive({ room, createdAt, reason: "completed", terminalObservedAt });

    persistArchive(room, createdAt, "completed", { terminalObservedAt })
      .then(() => {
        forgetPendingArchive(room, createdAt);
      })
      .catch(err => {
        console.warn("[Quizsel Analytics] completed archive deferred:", err);
      });
  }

  async function retryPendingArchives() {
    if (pendingRetryPromise) return pendingRetryPromise;

    pendingRetryPromise = (async () => {
      const user = auth.currentUser;
      if (!user || isCurrentAdmin()) return 0;

      const items = Object.values(readPendingArchives())
        .sort((a, b) => Number(a.capturedAt || 0) - Number(b.capturedAt || 0));
      let completed = 0;

      for (const item of items) {
        try {
          const game = await fetchGame(item.room);
          if (!game?.meta) continue;
          if (Number(game.meta.createdAt) !== Number(item.createdAt)) continue;
          if (String(game.meta.hostUid || "") !== String(user.uid)) continue;

          await persistArchive(item.room, item.createdAt, item.reason || "completed", {
            game,
            terminalObservedAt: finiteNumber(item.terminalObservedAt, null)
          });
          forgetPendingArchive(item.room, item.createdAt);
          completed++;
        } catch (err) {
          console.warn("[Quizsel Analytics] archive retry deferred:", err);
          if (String(err?.code || "").toLowerCase().includes("network")) break;
        }
      }

      return completed;
    })().finally(() => {
      pendingRetryPromise = null;
    });

    return pendingRetryPromise;
  }

  async function requireArchiveBeforeDestructiveAction(room, createdAt, reason, game) {
    try {
      const archive = await persistArchive(room, createdAt, reason, { game });
      forgetPendingArchive(room, createdAt);
      return archive;
    } catch (err) {
      console.error("[Quizsel Analytics] destructive archive gate failed:", err);
      if (typeof toast === "function") {
        toast("Arşiv kaydı korunamadı · işlem yapılmadı. Bağlantıyı / Firebase Rules'u kontrol et.");
      }
      throw err;
    }
  }


  // ---------------------------------------------------------------------------
  // Final navigation guard
  // v0.11.1 intentionally decouples final persistence from navigation, but its
  // finishGame path is still a single synchronous chain. If listener cleanup
  // or renderHome throws, the final button can remain disabled forever.
  //
  // This wrapper preserves the v0.11 persistence/retry behavior, then adds:
  // 1) synchronous exception recovery,
  // 2) a next-microtask verification,
  // 3) short watchdog retries,
  // 4) direct DOM fallback as the last-resort escape hatch.
  // ---------------------------------------------------------------------------
  let finalExitInProgress = false;

  function finalViewActive() {
    return !!document.getElementById("view-final")?.classList?.contains("active");
  }

  function homeViewActive() {
    return !!document.getElementById("view-home")?.classList?.contains("active");
  }

  function directHomeDomFallback() {
    const home = document.getElementById("view-home");
    if (!home) return false;

    try {
      document.querySelectorAll(".view.active").forEach(view =>
        view.classList.remove("active")
      );
      home.classList.add("active");
      if (typeof window.scrollTo === "function") {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      return true;
    } catch (err) {
      console.error("[Quizsel] direct home DOM fallback failed:", err);
      return false;
    }
  }

  function forceHomeAfterFinal(reason = "watchdog") {
    if (homeViewActive() && !finalViewActive()) return true;

    safeLocalStorageRemove("quizsel_room");

    try {
      intentionalRoomExit = true;
    } catch (_) {}

    try {
      if (typeof stopRoomWatch === "function") stopRoomWatch();
    } catch (err) {
      // Cleanup failure must never trap the player on the final screen.
      console.error(`[Quizsel] final cleanup failed (${reason}):`, err);
    } finally {
      try {
        intentionalRoomExit = false;
      } catch (_) {}
    }

    try {
      if (typeof renderHome === "function") renderHome();
    } catch (err) {
      console.error(`[Quizsel] renderHome failed (${reason}):`, err);
    }

    if (homeViewActive() && !finalViewActive()) return true;

    try {
      if (typeof go === "function") go("home");
    } catch (err) {
      console.error(`[Quizsel] go(home) failed (${reason}):`, err);
    }

    if (homeViewActive() && !finalViewActive()) return true;
    return directHomeDomFallback();
  }

  function installFinalNavigationGuard() {
    const baseFinishGame = finishGame;

    finishGame = function quizselV012FinishGameGuard() {
      const btn = document.querySelector(
        '#view-final button[onclick="finishGame()"]'
      );

      if (finalExitInProgress) {
        forceHomeAfterFinal("repeat-tap");
        return;
      }

      finalExitInProgress = true;
      let result;

      try {
        // Keep v0.11's local pending-final + immediate retry behavior.
        result = baseFinishGame.apply(this, arguments);
      } catch (err) {
        console.error("[Quizsel] base final navigation failed:", err);
        forceHomeAfterFinal("base-exception");
      }

      const verifyExit = reason => {
        if (finalViewActive()) forceHomeAfterFinal(reason);

        if (!finalViewActive()) {
          finalExitInProgress = false;
          return true;
        }

        // If even the direct fallback could not move views, re-enable the
        // button rather than leaving a permanently disabled dead-end.
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Ana sayfaya dön";
        }
        finalExitInProgress = false;
        return false;
      };

      Promise.resolve(result)
        .catch(err => {
          console.error("[Quizsel] async final navigation failed:", err);
          forceHomeAfterFinal("base-async-exception");
        })
        .finally(() => verifyExit("promise-finally"));

      Promise.resolve().then(() => verifyExit("microtask-watchdog"));
      setTimeout(() => verifyExit("150ms-watchdog"), 150);
      setTimeout(() => verifyExit("1200ms-watchdog"), 1200);

      return result;
    };
  }

  function installGameLifecycleHooks() {
    const baseHostQuiz = hostQuiz;
    hostQuiz = async function quizselV012HostQuiz() {
      const requestedCode = arguments[0];
      const result = await baseHostQuiz.apply(this, arguments);
      const room = currentRoom;
      let quiz = currentQuiz;
      if (!quiz || (requestedCode && String(quiz.code || "").toUpperCase() !== String(requestedCode).toUpperCase())) {
        quiz = await loadQuiz(requestedCode).catch(() => null);
      }
      if (room && quiz) {
        try {
          const fingerprint = await fingerprintQuiz(quiz);
          await db.ref(`games/${room}/meta`).update({
            quizVersion: finiteNumber(quiz.version, null),
            quizSchemaVersion: finiteNumber(quiz.schemaVersion, null),
            quizCategory: String(quiz.category || ""),
            quizFingerprintAlgorithm: fingerprint.algorithm,
            quizFingerprint: fingerprint.value
          });
        } catch (err) {
          console.warn("[Quizsel Analytics] quiz fingerprint stamp failed:", err);
        }
      }
      return result;
    };

    const baseStartGame = startGame;
    startGame = async function quizselV012StartGame() {
      const room = currentRoom;
      const result = await baseStartGame.apply(this, arguments);
      if (room) {
        const startedAtRef = db.ref(`games/${room}/meta/startedAt`);
        await startedAtRef.transaction(value => value || nowMs()).catch(err =>
          console.warn("[Quizsel Analytics] startedAt stamp failed:", err)
        );
      }
      return result;
    };

    const baseRenderFinal = renderFinal;
    renderFinal = function quizselV012RenderFinal() {
      const room = currentRoom;
      const createdAt = currentGame?.meta?.createdAt;
      const host = typeof amHost === "function" && amHost();
      const result = baseRenderFinal.apply(this, arguments);
      if (host && room && createdAt) queueCompletedArchive(room, createdAt);
      return result;
    };

    const baseLeaveCompetition = leaveCompetition;
    leaveCompetition = async function quizselV012LeaveCompetition() {
      const uid = auth.currentUser?.uid;
      const room = currentRoom;
      if (!uid || !room || !currentGame) return baseLeaveCompetition.apply(this, arguments);

      try {
        const game = await fetchGame(room);
        if (!game?.meta) return baseLeaveCompetition.apply(this, arguments);

        const players = Object.keys(game.players || {});
        const wasHost = String(game.meta.hostUid || "") === String(uid);
        const remaining = players.filter(id => id !== uid);

        if (wasHost && remaining.length === 0) {
          await requireArchiveBeforeDestructiveAction(
            room,
            game.meta.createdAt,
            "last_player_left",
            game
          );
        } else {
          await captureDepartureEvent(
            game,
            room,
            uid,
            wasHost ? "host_left_transferred" : "left"
          );
        }
      } catch (err) {
        console.error("[Quizsel Analytics] leave preservation failed:", err);
        if (typeof toast === "function") {
          toast("Çıkış verisi korunamadı · yarışmadan çıkış yapılmadı.");
        }
        return;
      }

      return baseLeaveCompetition.apply(this, arguments);
    };

    const baseKickPlayer = kickPlayer;
    kickPlayer = async function quizselV012KickPlayer(uid) {
      const room = currentRoom;
      if (!room || !uid || !currentGame || !amHost()) {
        return baseKickPlayer.apply(this, arguments);
      }

      try {
        const game = await fetchGame(room);
        if (game?.players?.[uid]) {
          await captureDepartureEvent(game, room, uid, "kicked");
        }
      } catch (err) {
        console.error("[Quizsel Analytics] kick preservation failed:", err);
        if (typeof toast === "function") {
          toast("Oyuncu verisi korunamadı · çıkarma işlemi yapılmadı.");
        }
        return;
      }

      return baseKickPlayer.apply(this, arguments);
    };

    const baseTerminateCompetition = terminateCompetition;
    terminateCompetition = async function quizselV012TerminateCompetition() {
      const room = currentRoom;
      if (!room || !currentGame || !amHost()) {
        return baseTerminateCompetition.apply(this, arguments);
      }

      try {
        const game = await fetchGame(room);
        if (!game?.meta) return baseTerminateCompetition.apply(this, arguments);
        await requireArchiveBeforeDestructiveAction(
          room,
          game.meta.createdAt,
          "host_terminated",
          game
        );
      } catch (_) {
        return;
      }

      return baseTerminateCompetition.apply(this, arguments);
    };
  }

  async function adminArchiveAndRemove(room) {
    if (!isCurrentAdmin() || !room) return;
    try {
      const game = await fetchGame(room);
      if (!game?.meta) {
        await renderAdmin();
        return;
      }

      await requireArchiveBeforeDestructiveAction(
        room,
        game.meta.createdAt,
        "admin_closed",
        game
      );
      await db.ref(`games/${room}`).remove();
      await renderAdmin();
      if (typeof toast === "function") toast("Oda arşivlendi ve kapatıldı.");
    } catch (err) {
      console.error("[Quizsel Analytics] admin close blocked:", err);
    }
  }

  function rewireAdminCloseButtons() {
    const rows = Array.from(document.querySelectorAll("#adminRooms .room"));
    rows.forEach(row => {
      const label = row.querySelector(".meta b")?.textContent || "";
      const match = label.match(/^\s*(\d{6})\b/);
      const button = row.querySelector("button");
      if (!match || !button) return;
      const room = match[1];
      button.onclick = () => adminArchiveAndRemove(room);
      button.dataset.analyticsArchiveGate = "1";
    });
  }

  async function backfillEndedGames() {
    if (!isCurrentAdmin()) return 0;
    if (backfillPromise) return backfillPromise;

    backfillPromise = (async () => {
      const gamesSnap = await db.ref("games").get();
      const games = gamesSnap.val() || {};
      const ended = Object.entries(games)
        .filter(([, game]) => game?.meta?.state === "ended" && !game?.meta?.archiveId)
        .sort((a, b) => Number(a[1]?.meta?.createdAt || 0) - Number(b[1]?.meta?.createdAt || 0));

      let archived = 0;
      for (const [room, game] of ended) {
        try {
          await persistArchive(room, game.meta.createdAt, "completed_backfill", {
            game,
            backfilled: true
          });
          archived++;
        } catch (err) {
          console.warn(`[Quizsel Analytics] backfill skipped ${room}:`, err);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return archived;
    })().finally(() => {
      backfillPromise = null;
    });

    return backfillPromise;
  }

  function installAdminHooks() {
    const baseRenderAdmin = renderAdmin;
    renderAdmin = async function quizselV012RenderAdmin() {
      const result = await baseRenderAdmin.apply(this, arguments);
      rewireAdminCloseButtons();

      if (isCurrentAdmin() && safeSessionStorageGet(BACKFILL_SESSION_KEY) !== "1") {
        safeSessionStorageSet(BACKFILL_SESSION_KEY, "1");
        setTimeout(() => backfillEndedGames().catch(err =>
          console.warn("[Quizsel Analytics] ended-game backfill failed:", err)
        ), 0);
      }

      return result;
    };

    if (isCurrentAdmin()) {
      setTimeout(() => renderAdmin().catch(() => {}), 0);
    }
  }

  function installRetryHooks() {
    auth.onAuthStateChanged(user => {
      if (user && user.email !== ADMIN_EMAIL) {
        setTimeout(() => retryPendingArchives().catch(() => {}), 400);
      }
    });

    window.addEventListener("online", () => {
      retryPendingArchives().catch(() => {});
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        retryPendingArchives().catch(() => {});
      }
    });
  }

  function exposeDebugApi() {
    if (new URLSearchParams(location.search).get("debug") !== "1") return;
    window.QUIZSEL_ANALYTICS_DEBUG = {
      version: ANALYTICS_VERSION,
      archiveSchemaVersion: ARCHIVE_SCHEMA_VERSION,
      matchIdFor,
      questionTruth,
      fingerprintQuiz,
      buildMatchArchive,
      retryPendingArchives,
      backfillEndedGames,
      forceHomeAfterFinal,
      pendingArchives: readPendingArchives
    };
  }

  function install() {
    if (installed) return;
    installed = true;
    window.QUIZSEL_ANALYTICS_VERSION = ANALYTICS_VERSION;

    installFinalNavigationGuard();
    installGameLifecycleHooks();
    installAdminHooks();
    installRetryHooks();
    exposeDebugApi();

    console.info(`[Quizsel] analytics ${ANALYTICS_VERSION} active`);
  }

  function bootWhenReady(attempt = 0) {
    const ready =
      typeof auth !== "undefined" &&
      typeof db !== "undefined" &&
      typeof loadQuiz === "function" &&
      typeof hostQuiz === "function" &&
      typeof startGame === "function" &&
      typeof renderFinal === "function" &&
      typeof leaveCompetition === "function" &&
      typeof kickPlayer === "function" &&
      typeof terminateCompetition === "function" &&
      typeof renderAdmin === "function" &&
      typeof qKey === "function" &&
      !!window.QUIZSEL_RUNTIME_VERSION &&
      !!window.QUIZSEL_RELIABILITY_VERSION;

    if (ready) {
      install();
      return;
    }

    if (attempt >= 240) {
      console.error("[Quizsel] analytics layer could not attach to runtime.");
      return;
    }

    setTimeout(() => bootWhenReady(attempt + 1), 50);
  }

  bootWhenReady();
})();
