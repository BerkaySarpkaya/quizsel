# Quizsel Runtime Architecture — v0.10 Stable Wiring

## Authoritative load order

Effective browser order is:

`index.html`
→ `config.js`
→ `app.js`
→ `app-v09-performance.js`
→ `app-v010-runtime.js`

The last two files are **not** required as direct `<script>` tags in `index.html`.
`config.js` intentionally waits for `DOMContentLoaded`, injects `app-v09-performance.js`, and only after that script loads injects `app-v010-runtime.js`.
This keeps the historical `app.js` base available before the overlay layers execute.

Current direct script wiring in `index.html` is therefore intentionally limited to Firebase libraries plus:

- `config.js?v=100`
- `app.js?v=90`

`v=100` is a cache-busting key for the v0.10 config/loader transition. Reusing the old `v=94` key can leave previously cached clients on the pre-v0.10 loader behavior.

## Ownership

### `app.js`
Historical base application and DOM/auth/room/game primitives.

### `app-v09-performance.js`
- split Firebase room listeners,
- optimistic ready/answer behavior,
- next-question preload,
- performance instrumentation.

### `app-v010-runtime.js`
- defensive production-quiz validation,
- current runtime-version stamping,
- idempotent/retryable final persistence,
- authoritative all-answered recheck with deadline fallback,
- 3 → 2 → 1 between-question transition,
- final return-home behavior without forced sign-out,
- current quiz-set/folder browser behavior.

## Compatibility boundary

`app-flow-v091.js` and `app-quizsets-v092.js` are superseded by `app-v010-runtime.js` in the verified v0.10 chain.
They are **cleanup candidates**, but must not be deleted until a post-upload verification confirms the v0.10 loader is live on `main` and the health workflow + Pages deployment remain green.

`styles-quizsets-v092.css` remains an active stylesheet and must **not** be treated as obsolete merely because its filename contains `v092`.

## Files that are function-critical in the current production chain

Do not move, rename, or delete during the stabilization upload:

- `index.html`
- `config.js`
- `app.js`
- `app-v09-performance.js`
- `app-v010-runtime.js`
- `styles.css`
- `styles-quizsets-v092.css`
- `database.rules.json`
- `quiz-index.json`
- `QZxxx.json` / `YQxxx.json`
- `quiz-qa-tool.mjs`
- `quiz-semantic-index-tool.mjs`
- `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`
- `semantic-index/shards/*.json`

## Change discipline

Repository cleanup is a separate operation from runtime migration.
The safe order is:

1. stabilize wiring/documentation,
2. verify GitHub Health,
3. verify Pages deployment,
4. perform a browser smoke test,
5. only then delete confirmed superseded/temporary files.

No quiz-source relocation and no runtime-layer consolidation is authorized by this stabilization patch.
