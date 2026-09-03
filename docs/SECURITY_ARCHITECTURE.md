# Quizsel Security Architecture / Backend Migration Boundary

## Current question-privacy boundary

Current GitHub Pages runtime loads quiz files in the browser with `fetch("YQxxx.json")`. Therefore a user can inspect browser-delivered quiz content through DevTools/Network. A private authoring repository alone does not make deployed Pages assets secret.

Semantic shards are authoring artifacts and contain `correctAnswer`; in a future paid/private question architecture they should not be part of the public production artifact.

## Current durable-analytics boundary — v0.12

v0.12 adds two Realtime Database roots:

- `matchArchive/{matchId}` — terminal full-match snapshot,
- `analyticsDepartures/{room}/{createdAt}/{eventId}` — immutable pre-removal player snapshot.

Security properties in `database.rules.json`:

- archive records are create-only; clients cannot update/delete an existing match archive,
- the admin account can read analytics history,
- ordinary users cannot enumerate/read the global archive,
- a current host may read only the existing archive associated with its own still-live room for idempotency,
- departure events are create-only,
- self/host departure writes require that the referenced player still exists in the live game,
- departure player/answer values are validated against the current `games/` data before the live record can be removed.

This significantly improves accidental-loss and casual-tamper resistance, but it does not turn the browser into a trusted server. The current host is already trusted to advance phases and calculate scores in the client runtime. A malicious host with a modified client can therefore still influence live game state before it is archived.

For authoritative anti-tamper analytics, scoring must eventually move server-side.

## Target secure architecture

```text
Private question store
        |
Server-side Firebase Function / backend
        |
Current-question payload only
        |
Browser
```

Server-side responsibilities should eventually include:

- answer truth,
- scoring,
- phase authority,
- match finalization,
- durable analytics write,
- entitlement/premium mapping.

Browser receives only the current question payload before reveal.

## Deployment separation target

### 1. Authoring repository
- quiz source,
- semantic shards,
- QA metadata,
- source notes.

### 2. Public frontend artifact
- HTML,
- CSS,
- client JS,
- public quiz metadata.

### 3. Private backend data
- question text/options/answers,
- match/scoring authority,
- durable analytics warehouse/export source,
- entitlement mapping.

## Firebase Rules are operational infrastructure

`database.rules.json` in Git is source control for the intended ruleset; GitHub Pages does not publish those rules to Firebase. Any change to analytics permissions requires an explicit Realtime Database Rules publish/deploy.
