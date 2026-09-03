# Quizsel

Quizsel, aynı odadaki oyuncuların aynı soruları eşzamanlı cevapladığı, Firebase Authentication + Realtime Database kullanan web tabanlı quiz uygulamasıdır.

## Güncel production mimarisi

Tarayıcı çalışma sırası:

1. `index.html`
2. `config.js`
3. `app.js` — temel uygulama
4. `app-v09-performance.js` — performans / split-listener katmanı
5. `app-v010-runtime.js` — güncel yarış akışı, quiz doğrulama ve quiz-set browser
6. `app-v011-reliability.js` — reconnect + pending final reliability
7. `app-v012-analytics.js` — kalıcı maç/cevap analytics arşivi

`CFG.clientVersion` v0.12 rollout ile `0.12.1`'dır.

## Güncel yarış akışı

- Soru süresi: 20 saniye.
- Tüm aktif oyuncular cevapladıysa host Firebase üzerinden tekrar doğrular ve reveal erken yapılır.
- Erken-doğrulama isteği hata verirse normal soru deadline fallback'i korunur.
- Reveal süresi: 5 saniye.
- Son soru değilse reveal sonrası 3 → 2 → 1 geçişi vardır.
- Finalden ana sayfaya dönüş Firebase oturumunu kapatmaz.
- Per-user final sonucu bağlantı sorunu yaşarsa v0.11 retry mekanizması devreye girer.

## Final ekranı navigation hotfix — v0.12.1

iOS/Safari dahil bazı istemcilerde finalde `Ana sayfaya dön` akışı, listener cleanup veya home render sırasında oluşan senkron bir exception yüzünden `Ana sayfaya dönülüyor…` durumunda kilitlenebiliyordu.

v0.12.1 analytics overlay mevcut v0.11 final persistence davranışını korur ve final çıkışına dört katmanlı guard ekler:

- base `finishGame()` normal yolu,
- exception halinde zorunlu home recovery,
- microtask + kısa watchdog doğrulaması,
- son çare doğrudan DOM view geçişi.

Cleanup hatası artık kullanıcıyı final ekranında mahsur bırakamaz; en kötü durumda buton tekrar etkinleştirilir.

## Kalıcı analytics / oyun geçmişi — v0.12

Canlı `games/` state'i artık uzun dönem analitik kaynağı olarak kabul edilmez.

Kalıcı data:

```text
matchArchive/{matchId}
analyticsDepartures/{room}/{createdAt}/{eventId}
```

`matchArchive` her terminal maç için şunları korur:

- maç zamanı/durumu/terminal reason,
- quiz sürümü + fingerprint,
- oyuncular ve sıralama,
- her oyuncunun her cevabı,
- doğru/yanlış, puan ve cevap süresi,
- soru bazında option distribution / accuracy / response-time aggregate,
- oyuncu bazında accuracy / response-time aggregate,
- winner ve match summary,
- runtime/client version metadata.

Oyuncu ayrılır veya kicklenirse, live state silinmeden önce `analyticsDepartures` içine immutable snapshot alınır. Böylece daha sonra biten maçta ayrılmış oyuncunun önceki cevapları kaybolmaz.

Normal final archive yazılamazsa retry edilir. Oda/player verisini fiziksel olarak silecek kullanıcı/admin işlemleri analytics snapshot başarıyla yazılmadan devam etmez.

Detay: `docs/ANALYTICS_ARCHITECTURE.md`.

### Kritik deploy notu

`database.rules.json` dosyasını GitHub'a yüklemek Firebase Realtime Database Rules'u otomatik deploy etmez. v0.12 runtime açılmadan önce/aynı rollout sırasında yeni ruleset Firebase Console → Realtime Database → Rules üzerinden ayrıca publish edilmelidir.

## Profil özetleri ile analytics farkı

Aşağıdakiler kullanıcı deneyimi için hızlı özetlerdir ve korunmaya devam eder:

- `profiles/{uid}/stats`
- `profiles/{uid}/quizHistory`
- `finalReceipts`
- `activityLogs`

Bunlar ham analitik dataset'in yerine geçmez. `finalReceipts` son 200 idempotency receipt ile sınırlı olabilir; gerçek `matchArchive` için retention/trimming yoktur.

## Quiz kodları ve setler

Legacy:
- `QZ001`–`QZ007`
- `YQ001`–`YQ102` → Draft Quiz Set

Production setleri:
- `YQ103`–`YQ132` → First Set
- `YQ133`–`YQ162` → Second Set
- `YQ163`–`YQ192` → Third Set
- devamında her 30 quiz otomatik yeni sete gider.

Görünen kod `Y.Q223` olabilir; canonical runtime/file kodu `YQ223` biçimindedir.

## Yeni quiz üretimi

Authoritative kalite sözleşmeleri:

- `QUIZSEL_SORU_URETIM_MANUELI.md`
- `QUIZSEL_SORU_QA_SPEC.json`
- `QUIZSEL_SEMANTIC_INDEX_SPEC.json`
- `QUIZSEL_SEMANTIC_INDEX_PROTOCOL.md`

YQ133 ve sonrasında her soru semantic index kaydına sahip olmalıdır. Quiz JSON dosyası soru metni ve doğru cevap için authoritative kaynaktır; semantic index authoring/QA hızlandırıcısıdır.

Önerilen akış:

```text
quiz-index.json oku
→ yeni YQ kodlarını belirle
→ geçmiş duplicate/fact adaylarını semantic index ile daralt
→ yeni quiz JSON'larını üret
→ semantic batch oluştur
→ semantic index apply
→ quiz QA
→ source-sync validate
→ commit
```

## Yerel QA komutları

Node.js 20 LTS önerilir.

```bash
node --check app.js
node --check app-v09-performance.js
node --check app-v010-runtime.js
node --check app-v011-reliability.js
node --check app-v012-analytics.js
node --check quiz-semantic-index-tool.mjs
node --check quiz-qa-tool.mjs

node quiz-qa-tool.mjs repo
node quiz-semantic-index-tool.mjs validate --source
```

`quiz-qa-tool.mjs repo` v0.12 itibarıyla analytics runtime wiring'ini, analytics JS parse kontrolünü ve archive Firebase Rules guard'larını da denetler. Bu nedenle mevcut GitHub Health workflow'unun `Repository structure QA` adımı yeni analytics katmanını da kapsar.

Yeni/değişen quizler için:

```bash
node quiz-qa-tool.mjs check YQ223.json YQ224.json
node quiz-semantic-index-tool.mjs validate-target YQ223 --source
```

## Runtime quiz doğrulaması

YQ133+ için runtime ayrıca:

- canonical code eşleşmesi,
- schemaVersion 2,
- tam 10 soru,
- benzersiz question id,
- tam 4 benzersiz seçenek,
- `answer` 0..3,
- `time = 20`,
- `questionType = multiple-choice`

kontrol eder.

## Semantic index

Semantic index 30 quizlik shard'lara ayrılır:

```text
semantic-index/shards/YQ133-YQ162.json
semantic-index/shards/YQ163-YQ192.json
semantic-index/shards/YQ193-YQ222.json
...
```

Manifest: `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`

Tool: `quiz-semantic-index-tool.mjs`

## Soru gizliliği ve trust boundary

Mevcut production runtime statik quiz JSON'larını tarayıcıya yükler. Dolayısıyla Pages üzerinde yayınlanan soru/cevap verisi istemci tarafından görülebilir. Aynı şekilde scoring hâlen browser/host trust boundary'sindedir.

v0.12 analytics arşivi append-only/create-only korunur ve normal kullanıcılar tarafından global olarak okunamaz; fakat mutlak anti-tamper doğruluk için scoring/finalization'ın gelecekte server-side'a taşınması gerekir.

Detay: `docs/SECURITY_ARCHITECTURE.md`.

## Firebase

- Authentication: Email/Password
- Realtime Database: canlı oda/state + durable analytics archive
- Firebase browser config'in frontend'de görünmesi normaldir.
- Yetkilendirme `database.rules.json` ile korunur.
- GitHub Pages deploy'u Firebase Rules deploy etmez.

## Authoritative dosya prensibi

- Runtime soru kaynağı: `YQxxx.json` / `QZxxx.json`
- Quiz listesi: `quiz-index.json`
- Soru üretim standardı: `QUIZSEL_SORU_URETIM_MANUELI.md`
- Makine-okunabilir QA standardı: `QUIZSEL_SORU_QA_SPEC.json`
- Semantic index sözleşmesi: `QUIZSEL_SEMANTIC_INDEX_SPEC.json`
- Semantic coverage/yönlendirme: `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`
- Runtime layering: `docs/RUNTIME_ARCHITECTURE.md`
- Durable analytics data model: `docs/ANALYTICS_ARCHITECTURE.md`
- Security/backend boundary: `docs/SECURITY_ARCHITECTURE.md`

Eski upload notları ve batch'e özel QA/source raporları authoritative kabul edilmez.
