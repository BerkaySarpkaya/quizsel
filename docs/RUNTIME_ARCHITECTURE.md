# Quizsel Runtime Architecture — v0.12.1 Durable Analytics + Final Navigation Guard

## Authoritative load order

Effective browser order:

```text
index.html
→ config.js
→ app.js
→ app-v09-performance.js
→ app-v010-runtime.js
→ app-v011-reliability.js (direct tag; waits for v0.10 runtime)
→ app-v012-analytics.js (config loader; waits for v0.11 reliability)
```

`config.js?v=121` dynamically loads performance, v0.10 runtime and then v0.12 analytics. `app-v011-reliability.js?v=112` remains a direct script tag but self-gates until `window.QUIZSEL_RUNTIME_VERSION` exists. v0.12 in turn self-gates until both runtime and reliability versions exist.

## Ownership

### `app.js`
Historical base application and DOM/auth/room/game primitives.

### `app-v09-performance.js`
- split Firebase room listeners,
- optimistic ready/answer behavior,
- next-question preload,
- performance instrumentation,
- final-state full-answer hydration.

### `app-v010-runtime.js`
- defensive production-quiz validation,
- runtime-version stamping from `CFG.clientVersion`,
- idempotent/retryable per-user final stats persistence,
- authoritative all-answered recheck with deadline fallback,
- between-question flow,
- final return-home behavior,
- quiz-set browser.

### `app-v011-reliability.js`
- local pending final-result recovery,
- retry after reconnect / auth restore,
- final navigation independent from profile persistence,
- active-game reconnect/foreground/stale-phase recovery.

### `app-v012-analytics.js`
- durable immutable `matchArchive`,
- pre-removal `analyticsDepartures`,
- final archive retry markers,
- fail-closed archive gates before destructive room/player operations,
- quiz fingerprint and answer-level analytics snapshot,
- admin close archive gate,
- legacy `ended` game backfill.

## Data ownership boundary

`games/` remains **operational state**, not analytics history.

Long-term analytics truth:

```text
matchArchive/{room_createdAt}
analyticsDepartures/{room}/{createdAt}/{eventId}
```

User-facing profile counters and `activityLogs` are secondary summaries/observability, not the canonical raw analytics dataset.

See `docs/ANALYTICS_ARCHITECTURE.md`.

## Compatibility boundary

`app-flow-v091.js` and `app-quizsets-v092.js` remain superseded cleanup candidates. They must not be deleted merely as part of the analytics rollout. `styles-quizsets-v092.css` remains active.

## Function-critical production files

Do not move/rename during this rollout:

- `index.html`
- `config.js`
- `app.js`
- `app-v09-performance.js`
- `app-v010-runtime.js`
- `app-v011-reliability.js`
- `app-v012-analytics.js`
- `styles.css`
- `styles-quizsets-v092.css`
- `database.rules.json`
- `quiz-index.json`
- `QZxxx.json` / `YQxxx.json`
- `quiz-qa-tool.mjs`
- `quiz-semantic-index-tool.mjs`
- `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`
- `semantic-index/shards/*.json`

## QA

`node quiz-qa-tool.mjs repo` now also verifies:

- v0.12 analytics script existence and JavaScript parseability,
- `config.js?v=121` wiring,
- `CFG.clientVersion = 0.12.1`,
- analytics loader presence,
- `matchArchive` / `analyticsDepartures` Firebase rule roots,
- create-only archive guards,
- destructive lifecycle hook markers.

This makes the existing GitHub Health `Repository structure QA` gate cover the new analytics layer without changing `.github` in the browser-upload package.

## Deployment boundary

GitHub Pages deploy does **not** deploy Firebase Realtime Database Rules. `database.rules.json` must be published separately in Firebase before/with v0.12 runtime rollout. See `docs/ANALYTICS_ARCHITECTURE.md`.


## Final navigation guard — v0.12.1

`app-v011-reliability.js` final persistence'i navigation'dan ayırır, ancak base `finishGame()` içinde cleanup ve `renderHome()` aynı senkron zincirdedir. Bir exception final butonunu disabled halde bırakabilir.

`app-v012-analytics.js` v0.12.1 bu base fonksiyonu wrap eder. Önce v0.11 davranışını çalıştırır; final view aktif kalırsa exception recovery, microtask watchdog, 150 ms / 1200 ms watchdog ve direct DOM fallback ile home view zorlanır. Bu guard analytics write başarısından bağımsızdır.
