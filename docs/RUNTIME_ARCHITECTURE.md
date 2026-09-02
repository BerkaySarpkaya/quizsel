# Quizsel Runtime Architecture — v0.10

## Load order

`index.html`
→ `config.js`
→ `app.js`
→ `app-v09-performance.js`
→ `app-v010-runtime.js`

`app-v010-runtime.js` consolidates:
- former v0.9.1 race-flow behavior,
- former v0.9.2 quiz-set browser JS behavior,
- v0.10 reliability guards.

The performance layer remains separate intentionally because it owns split Firebase listeners, optimistic UI and performance instrumentation rather than product-state rules.

## Ownership

### app.js
Historical base application and DOM/auth/room primitives.

### app-v09-performance.js
- split room listeners,
- optimistic ready/answer,
- next-question preload,
- debug performance marks.

### app-v010-runtime.js
- defensive quiz validation,
- current runtime version stamp,
- idempotent final persistence,
- all-answered authoritative recheck + deadline fallback,
- 3→2→1 between questions,
- final return-home behavior,
- set/folder browser.

## Compatibility

Old `app-flow-v091.js` and `app-quizsets-v092.js` are superseded after `config.js` v0.10 is verified live.
Their behavior is included in `app-v010-runtime.js`.

`styles-quizsets-v092.css` remains active styling and is not obsolete merely because its filename contains v092.
