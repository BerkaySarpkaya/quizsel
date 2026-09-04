# Quizsel

Quizsel, aynı odadaki oyuncuların aynı soruları eşzamanlı cevapladığı, Firebase Authentication + Realtime Database kullanan web tabanlı quiz uygulamasıdır.

## Güncel production mimarisi

Production katmanları:

1. `index.html` / `config.js` — wiring ve loader
2. `app.js` — temel uygulama
3. `app-v09-performance.js` — performans / split-listener
4. `app-v010-runtime.js` — yarış akışı, quiz doğrulama, quiz-set browser
5. `app-v011-reliability.js` — reconnect + pending final reliability
6. `app-v012-analytics.js` — kalıcı maç/cevap analytics arşivi
7. `app-v0122-lobby-exit-fix.js` — lobby/yarış çıkışı patch
8. `app-v0125-final-completion.js` (runtime 0.12.7 hard-return + terminal-button reset guard) — final home / logout ayrımı
9. `app-v013-knowledge.js` + `styles-v013-knowledge.css` — Bilgi Canavarı final-review katmanı

Kesin browser yükleme sırası `docs/RUNTIME_ARCHITECTURE.md` içindedir. `CFG.clientVersion` v0.12 runtime/analytics için `0.12.1` olarak kalır; Bilgi Canavarı kendi `0.13.0` katman sürümünü taşır.

## Güncel yarış akışı

- Soru süresi: 20 saniye.
- Tüm aktif oyuncular cevapladıysa host Firebase üzerinden tekrar doğrular ve reveal erken yapılır.
- Erken-doğrulama isteği hata verirse normal soru deadline fallback'i korunur.
- Reveal süresi: 5 saniye.
- Son soru değilse reveal sonrası 3 → 2 → 1 geçişi vardır.
- Final ekranında üç seçenek vardır: `Bilgi Canavarı`, `Tamamla ve ana ekrana dön`, `Tamamla ve çıkış yap`.
- Ana ekrana dönüş gerçek `#finalHomeBtn` üzerinde document-capture ile sahiplenilir; stale Final repaint engellenir ve local dönüş başarısızsa session koruyan hard fallback vardır.
- Bilgi Canavarı soru + doğru cevap + kısa açıklama/fun-fact listesini açar; terminal aksiyon değildir.
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


## Final butonu kilitlenmesi hotfix — v0.12.7

`#view-final` her maçta yeniden kullanılan kalıcı bir DOM düğümüdür; buton elementi yeniden üretilmez.

v0.12.6'da `setButtonsBusy("home")` butonu `disabled` yapıyor, başarılı dönüş yolunda ise `restoreButtons()` hiç çağrılmıyordu. Sonuç: aynı sayfa oturumunda ilk maçın çıkışı çalışıyor, sonraki her maçta `Tamamla ve ana ekrana dön` butonu `disabled` ve "Ana sayfaya dönülüyor…" metniyle geliyordu. Disabled bir buton hiç `click` eventi üretmediği için document-capture listener'ı da devreye giremiyor, kullanıcı final ekranında kilitleniyordu.

Eski katmanlardaki `btn.disabled = false` kurtarma yolları bu senaryoyu yakalayamıyordu: v0.10 / v0.11 / v0.12 butonu `#view-final button[onclick="finishGame()"]` selector'ü ile arıyor, `#finalHomeBtn` üzerinde `onclick` attribute'u bulunmadığı (ve v0.12.6 kurulumda `removeAttribute("onclick")` çağırdığı) için selector daima `null` dönüyordu.

v0.12.7 terminal butonları dört ayrı noktada geri açar:

- çıkış akışının `finally` bloğunda,
- her watchdog adımında (`settleHomeReturn`),
- her `renderFinal()` boyamasında,
- `#view-final` yeniden `active` olduğunda (`observeFinalViewActivation` — Bilgi Canavarı `Sonuçlara dön` yolu dahil).

Ek olarak: `completeAndReturnHome` / `completeAndSignOut` artık try/finally ile sarılıdır, `toast()` çağrıları izole edilmiştir (fırlatan bir toast artık `actionInProgress` bayrağını kalıcı olarak kilitleyemez) ve biten maça ait geç watchdog'lar yeni başlamış bir maçı final ekranından çekip alamaz.


## Bilgi Canavarı — v0.13

Final ekranındaki `Bilgi Canavarı` butonu tamamlanan quizin sorularını read-only olarak açar. Her kartta soru metni, varsa soru görseli, doğru cevap ve `answerInfo` bulunur.

YQ253+ için `answerInfo` her soruda zorunludur ve 1–3 cümlelik kısa açıklama veya soruyla ilgili doğrulanabilir bir fun-fact olmalıdır. YQ001–YQ252 backward-compatible kalır; ek bilgi alanı olmayan eski sorularda review ekranı açık bir fallback mesajı gösterir.

`answerInfo` aynı `YQxxx.json` dosyasında yaşar; ayrı Firebase tablosu veya semantic-index kopyası yoktur.

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

YQ133 ve sonrasında her soru semantic index kaydına sahip olmalıdır. YQ253+ sorular ayrıca `answerInfo` taşır. Quiz JSON dosyası soru metni, doğru cevap ve Bilgi Canavarı içeriği için authoritative kaynaktır; semantic index authoring/QA hızlandırıcısıdır ve `answerInfo` kopyalamaz.

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
node --check app-v013-knowledge.js
node --check quiz-semantic-index-tool.mjs
node --check quiz-qa-tool.mjs

node quiz-qa-tool.mjs repo
node quiz-semantic-index-tool.mjs validate --source
```

`quiz-qa-tool.mjs repo` analytics runtime wiring'ini ve archive Firebase Rules guard'larını; v0.13 ile ayrıca Bilgi Canavarı JS/CSS/DOM wiring'ini, template alanını ve YQ253+ `answerInfo` kurallarını denetler. Bu nedenle mevcut GitHub Health workflow'unun `Repository structure QA` adımı yeni analytics katmanını da kapsar.

Yeni/değişen quizler için:

```bash
node quiz-qa-tool.mjs check YQ223.json YQ224.json
node quiz-semantic-index-tool.mjs validate-target YQ223 --source
```

## Corpus health gate

`quiz-qa-tool.mjs` dosya bazlı sözleşmeyi denetler ve `check` / `check-changed` modunda **yalnız o push'ta değişen** quizi geçmiş stem havuzuyla karşılaştırır. Her push'ta koşan `repo` modu corpus geneli bir karşılaştırma yapmaz. Sonuç: bir kural yürürlüğe girmeden önce havuza girmiş borç hiçbir zaman yüzeye çıkmaz.

`quiz-health-tool.mjs` bu boşluğu kapatır ve tüm havuzu her push'ta tarar:

```bash
node quiz-health-tool.mjs audit      # tam rapor -> docs/QUIZSEL_HEALTH_REPORT.md + quizsel-health-findings.json
node quiz-health-tool.mjs gate       # CI kapısı (baseline farkı)
node quiz-health-tool.mjs baseline   # kabul edilmiş borcu yeniden yaz
```

Kapsanan hard kapılar: corpus geneli birebir ve fuzzy (>=0.84) stem duplicate, **anchor duplicate**, `answerInfo` bilgi içeriği, `answerInfo` teknik sınırları, doğru şık pozisyon dağılımı, şık uzunluk oranı, semantic coverage, Topic Family max-2 / adjacency, semantic signature ve factCluster çakışması.

### Anchor duplicate kapısı

`semanticSignature = subject|askedProperty|correctAnswer` ve `askedProperty` serbest metindir. "besteci" ile "bestecisi" aynı özelliğin iki yazımı; "ressam" ile "sanatçısı" ise eşanlamlı. Her iki durumda da aynı olgu iki farklı signature üretir ve duplicate kapısı o fact için kör kalır.

`anchorKey = subject|correctAnswer` alanı `askedProperty`'yi tamamen devre dışı bırakır: iki soru aynı özneyi aynı cevapla soruyorsa, yazar hangi kelimeyi seçmiş olursa olsun aynı şeyi soruyordur. Mevcut havuzda bu, ne signature'ın ne de lexical katmanın gördüğü **26 duplicate** buldu.

Çakışma otomatik hata değil — bir özne meşru olarak aynı cevaplı iki soru taşıyabilir — bu yüzden 0.84 fuzzy eşiği gibi davranır: baseline üzerinden geçen zorunlu review sinyali.

Review seviyesinde raporlananlar: aynı cevaplı semantik duplicate şüphelileri, stem-option echo, benzersiz-en-uzun doğru cevap, aşırı kullanılan cevaplar, çıplak sayı/yıl cevapları (precision burden adayı), zamana bağlı ifadeler (kaynak doğrulaması adayı) ve `askedProperty` yazım varyantları.

### Baseline ratchet

`QUIZSEL_QA_BASELINE.json` mevcut borcu bir kez kaydeder; böylece CI eski borç yüzünden kırmızıya dönüp geliştirmeyi bloke etmez. **Yeni** ihlal build'i kırar. Borç düzeldikçe `baseline` komutuyla liste daraltılır — liste yalnızca küçülmelidir.

### Bilinen sınır

`answerInfo` bilgi-içeriği metriği, metnin sorunun ve cevabın **tekrarı** olup olmadığını ölçer. Gözlenen bozulma tam olarak buydu. Ama soruyla ilgisiz ama yeni kelimeler içeren içi boş dolgu cümlelerini yakalamaz. Manuel §15 gereği tool PASS'i editoryal değerlendirmenin yerine geçmez.

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

YQ253+ `answerInfo` zorunluluğu build/repository QA katmanında denetlenir; eski quizler runtime uyumluluğu için değişmeden kalır.

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

- Runtime soru + doğru cevap + Bilgi Canavarı kaynağı: `YQxxx.json` / `QZxxx.json`
- Quiz listesi: `quiz-index.json`
- Soru üretim standardı: `QUIZSEL_SORU_URETIM_MANUELI.md`
- Makine-okunabilir QA standardı: `QUIZSEL_SORU_QA_SPEC.json`
- Semantic index sözleşmesi: `QUIZSEL_SEMANTIC_INDEX_SPEC.json`
- Semantic coverage/yönlendirme: `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`
- Runtime layering: `docs/RUNTIME_ARCHITECTURE.md`
- Durable analytics data model: `docs/ANALYTICS_ARCHITECTURE.md`
- Security/backend boundary: `docs/SECURITY_ARCHITECTURE.md`

Eski upload notları ve batch'e özel QA/source raporları authoritative kabul edilmez.
