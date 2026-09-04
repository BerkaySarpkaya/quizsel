# Quizsel Runtime Architecture — v0.13.1 Final Navigation Hardening

## Authoritative production wiring

`index.html` doğrudan şu browser katmanlarını yükler:

```text
config.js?v=121
app.js?v=90
app-v011-reliability.js?v=112
app-v0122-lobby-exit-fix.js?v=122
app-v0125-final-completion.js?v=126
app-v013-knowledge.js?v=130
```

Ayrıca `config.js` kontrollü olarak şu zinciri dinamik yükler:

```text
app-v09-performance.js?v=92
→ app-v010-runtime.js?v=100
→ app-v012-analytics.js?v=121
```

`app-v011-reliability.js` v0.10 runtime hazır olana kadar self-gate eder. `app-v012-analytics.js` hem runtime hem reliability katmanlarının hazır olmasını bekler. `app-v013-knowledge.js` yalnız final-review UI sahipliğindedir; analytics veya Firebase yazı yolunu değiştirmez.

`CFG.clientVersion` analytics/runtime rollout için `0.12.1` olarak kalır. Bilgi Canavarı katmanı ayrıca `window.QUIZSEL_KNOWLEDGE_VERSION = "0.13.0"` damgasını yayınlar.

## Ownership

### `app.js`
Historical base application; DOM/auth/room/game primitives ve `renderFinal()` temel davranışı.

### `app-v09-performance.js`
- split Firebase room listeners,
- optimistic ready/answer behavior,
- next-question preload,
- performance instrumentation,
- final-state full-answer hydration.

### `app-v010-runtime.js`
- defensive production-quiz validation,
- runtime-version stamping,
- idempotent/retryable per-user final stats persistence,
- authoritative all-answered recheck,
- between-question flow,
- quiz-set browser.

### `app-v011-reliability.js`
- local pending final-result recovery,
- reconnect/auth retry,
- final navigation/persistence ayrımı,
- active-game reconnect/foreground/stale-phase recovery.

### `app-v0122-lobby-exit-fix.js`
Lobby/competition exit UX patch surface.

### `app-v0125-final-completion.js`
Final ekranındaki iki terminal aksiyonun sahibi (runtime damgası `0.12.6`):
- `Tamamla ve ana ekrana dön`
- `Tamamla ve çıkış yap`

Home dönüşü document-capture seviyesinde gerçek `#finalHomeBtn` üzerinden sahiplenilir. Çıkılan maç için geç gelen `renderFinal()` çağrıları kilitlenir; local home geçişi başarısız kalırsa auth session'ını koruyan cache-busted same-page hard fallback devreye girer. Room cleanup ile auth sign-out davranışı ayrı kalır.

### `app-v012-analytics.js`
- durable immutable `matchArchive`,
- pre-removal `analyticsDepartures`,
- archive retry markers,
- destructive işlemler öncesi fail-closed archive gate,
- quiz fingerprint ve answer-level analytics snapshot,
- admin close archive gate,
- legacy ended-game backfill.

### `app-v013-knowledge.js`
Bilgi Canavarı final-review katmanı:
- final ekranına üçüncü, non-terminal `Bilgi Canavarı` aksiyonunu bağlar,
- aktif quizin read-only snapshot'ını alır,
- her soru için soru metni, varsa görsel, doğru cevap ve `answerInfo` gösterir,
- YQ001–YQ252 gibi eski quizlerde `answerInfo` yoksa açık fallback metni gösterir,
- review ekranı açıkken ended-room listener veya foreground recovery'nin tekrar `renderFinal()` çağırmasıyla ekranın kapanmasını engeller,
- Firebase state, scoring, archive ve profil istatistiklerini değiştirmez.

### `styles-v013-knowledge.css`
Bilgi Canavarı butonu ve review kartlarının mobil-first sunum katmanı.

## Quiz content boundary

Quiz JSON authoritative runtime kaynağıdır.

YQ253+ için her soru ayrıca:

```json
"answerInfo": "Doğru cevabı açıklayan veya ilgili bir fun-fact veren 1-3 cümle."
```

taşır. `answerInfo` scoring'e katılmaz ve semantic index'e kopyalanmaz. User-visible `answerInfo` değişikliği quiz content version değişikliğidir; ilgili quiz `version` değeri artırılmalıdır.

YQ001–YQ252 için backward compatibility korunur; alan zorunlu değildir.

## Data ownership boundary

`games/` operasyonel state'tir, analytics history değildir.

Long-term analytics truth:

```text
matchArchive/{room_createdAt}
analyticsDepartures/{room}/{createdAt}/{eventId}
```

Bilgi Canavarı yeni Firebase root'u veya kalıcı kullanıcı verisi oluşturmaz.

See `docs/ANALYTICS_ARCHITECTURE.md`.

## Function-critical production files

- `index.html`
- `config.js`
- `app.js`
- `app-v09-performance.js`
- `app-v010-runtime.js`
- `app-v011-reliability.js`
- `app-v012-analytics.js`
- `app-v0122-lobby-exit-fix.js`
- `app-v0125-final-completion.js`
- `app-v013-knowledge.js`
- `styles.css`
- `styles-quizsets-v092.css`
- `styles-v013-knowledge.css`
- `database.rules.json`
- `quiz-index.json`
- `QZxxx.json` / `YQxxx.json`
- `QUIZ_TEMPLATE.json`
- `QUIZSEL_SORU_URETIM_MANUELI.md`
- `QUIZSEL_SORU_QA_SPEC.json`
- `quiz-qa-tool.mjs`
- `quiz-semantic-index-tool.mjs`
- `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`
- `semantic-index/shards/*.json`

## QA

`node quiz-qa-tool.mjs repo` doğrular:
- mevcut analytics runtime wiring/schema/navigation guard'ları,
- gerçek `#finalHomeBtn` üzerinde v0.12.6 document-capture / stale-render lock / hard-fallback invariantlarını,
- Bilgi Canavarı JS/CSS/DOM wiring'i,
- `QUIZ_TEMPLATE.json` içinde `answerInfo` alanını,
- YQ253+ her soruda `answerInfo` varlığını,
- `answerInfo` için 1–3 cümle, min 24 / max 500 karakter teknik sınırını,
- semantic coverage ve index integrity'yi.

GitHub Health ayrıca `node --check app-v0125-final-completion.js` ve `node --check app-v013-knowledge.js` çalıştırır.

Changed production quiz strict QA ve semantic full-source audit mevcut şekilde devam eder.

## Final navigation invariant

Bilgi Canavarı **terminal aksiyon değildir**. Review ekranına girmek:
- room listener'ını sökmez,
- auth session'ını kapatmaz,
- analytics archive gate'i tetiklemez,
- final stats persistence davranışını değiştirmez.

Kullanıcı `Sonuçlara dön` ile final ekranına gelir ve ancak mevcut `Tamamla ve ana ekrana dön` / `Tamamla ve çıkış yap` aksiyonlarından biriyle final session'ı tamamlar.

## Deployment boundary

Bu v0.13 feature Firebase Rules değişikliği gerektirmez. GitHub Pages'e repo dosyalarının yüklenmesi yeterlidir. Mevcut v0.12 analytics rules gereksinimleri aynen devam eder.
