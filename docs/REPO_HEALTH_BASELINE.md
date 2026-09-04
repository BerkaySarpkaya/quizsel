# Quizsel Repository Health Baseline — 2026-09-02

## İncelenen production baseline

- Repository: `BerkaySarpkaya/quizsel`
- Branch: `main`
- İncelenen HEAD: `d65d20cc2076c5c90ee06dd27dca6d9540873a26`
- HEAD değişikliği: mevcut `Quizsel Health` workflow'unun repository'ye eklenmesi
- Önceki büyük yapısal commit: `32d8424f0e2119cfb25d2b22d3c0d745d467d05b` (`v3 yapısal değişiklik`)

## Doğrulanmış health durumu

Son `Quizsel Health` çalışması PASS verdi:

- JavaScript syntax: PASS
- Repository structure QA: PASS
- Semantic index full source audit: PASS
- Changed-production-quiz strict QA: PASS / ilgili push'ta değişen YQ dosyası yok

QA çıktısı:

- `quiz-index.json`: 229 kayıt
- repo QA: `hard=0`, `review=0`
- semantic index: 900 entry
- complete semantic quiz: 90
- shard: 3
- semantic coverage: `YQ133` → `YQ222`
- mevcut son quiz: `YQ222`
- sıradaki normal quiz kodu: `YQ223`

GitHub Pages build/deployment da aynı HEAD için başarılıdır.

## Sağlık taramasında bulunan noktalar

### H1 — Stale config cache key — PATCHED

Production `config.js` artık v0.10 loader davranışını içeriyor ve sırasıyla `app-v09-performance.js` ile `app-v010-runtime.js` katmanlarını dinamik yüklüyor.
Buna rağmen mevcut `index.html`, `config.js?v=94` çağırıyordu.
Eski cache'i olan bir istemcinin eski config'i kullanmaya devam etme riski vardı.

Bu stabilization paketi yalnız cache key'i `config.js?v=100` yapar.

### H2 — Eski manuel quiz placeholder — PATCHED

`index.html` içindeki manuel quiz kodu örneği `QZ008` olarak kalmıştı.
Mevcut havuz `YQ222`'ye kadar ilerlediği için örnek `Örn. YQ223` olarak güncellenir.
Bu değişiklik davranışsal değildir; yalnız UI metnidir.

### H3 — Root karmaşası / superseded ve geçici dosyalar — DEFERRED

Root'ta eski upload notları, eski batch raporları ve superseded runtime patch dosyaları bulunmaktadır.
Bunlar bu pakette **silinmez**.
Önce stabilization upload'u ve production wiring tekrar doğrulanacak; kesin silme listesi bunun ardından çıkarılacaktır.

### H4 — Public soru/cevap görünürlüğü — KNOWN ARCHITECTURE BOUNDARY

Statik quiz JSON'ları ve semantic authoring shard'ları public Pages artifact'ında bulunduğu sürece istemci tarafından okunabilir.
Bu, repository temizliğiyle çözülecek bir konu değildir; server-side/backend migration gerektirir ve `docs/SECURITY_ARCHITECTURE.md` kapsamındadır.
Bu stabilization paketi backend veya Firebase Rules değiştirmez.

### H5 — GitHub Actions Node uyarısı — NON-BLOCKING

Health workflow başarıyla çalışmaktadır. Runner, bazı GitHub Action sürümlerinin dahili Node runtime'ı için deprecation uyarısı göstermektedir; bu mevcut QA sonucunu başarısız yapmamıştır.
Workflow altyapısı bu browser-upload paketine dahil edilmez.

## Bu paketin değişiklik kapsamı

Production davranışını korumak için değişiklik yüzeyi kasıtlı olarak küçüktür:

- `index.html`: yalnız iki kontrollü satır değişikliği
  - `QZ008` placeholder → `Örn. YQ223`
  - `config.js?v=94` → `config.js?v=100`
- `docs/RUNTIME_ARCHITECTURE.md`: gerçek dinamik loader zincirini açıklaştırır
- `docs/REPO_HYGIENE_POLICY.md`: browser-upload ve cleanup güvenlik politikasını kalıcılaştırır
- `docs/REPO_HEALTH_BASELINE.md`: bu sağlık taramasının baseline kaydı

Aşağıdakiler bu patch'te değiştirilmez:

- `app.js`
- `app-v09-performance.js`
- `app-v010-runtime.js`
- CSS dosyaları
- `config.js` içeriği
- Firebase Rules
- quiz JSON'ları
- `quiz-index.json`
- semantic manifest/shard'lar
- QA/semantic tool kodları
- `.github` workflow içeriği

## Post-upload gate

Bu ZIP yüklendikten sonra **henüz hiçbir eski dosya silinmemelidir**.
Önce yeni `main` HEAD tekrar taranmalı, GitHub Health ve Pages sonucu doğrulanmalı ve aktif runtime zincirinin production'da yüklendiği kontrol edilmelidir.
Silme listesi ancak bu gate sonrasında kesinleştirilir.

---

## 2026-09-04 — Bilgi Canavarı geliştirme başlangıç baseline'ı

Feature geliştirmesi başlamadan önce production `main` HEAD:

- `5636fac76b769e30907dc9cba5d4981085f7e339`
- `Quizsel Health` run #23: PASS
- GitHub Pages deployment run #53: PASS
- semantic coverage: YQ253 dahil production ile senkron

v0.13 Bilgi Canavarı değişiklik yüzeyi:

- yeni `app-v013-knowledge.js`
- yeni `styles-v013-knowledge.css`
- `index.html` final üçüncü aksiyon + review view + cache-busted wiring
- YQ253+ `answerInfo` içerik sözleşmesi
- `QUIZ_TEMPLATE.json`, QA spec/manual ve `quiz-qa-tool.mjs` senkronizasyonu
- `.github/workflows/quizsel-health.yml` yeni JS syntax gate'i
- `YQ253.json` ilk tam `answerInfo` örneği / version bump

Değişmeyen sınırlar:

- Firebase Rules
- scoring
- room state machine
- durable analytics root'ları
- semantic index entry schema / shard formatı

Post-feature kabul kapıları:

1. JavaScript syntax PASS.
2. `node quiz-qa-tool.mjs repo` → hard=0.
3. `node quiz-qa-tool.mjs check YQ253.json` → hard=0, review=0.
4. `node quiz-semantic-index-tool.mjs validate --source` → PASS.
5. Headless Bilgi Canavarı smoke: final → review → final, 10/10 doğru cevap ve 10/10 `answerInfo` render.

---

## 2026-09-04 — Legacy Bilgi Canavarı backfill gate

YQ223–YQ252 için retroactive `answerInfo` zenginleştirmesi sırasında mevcut changed-file strict QA'nın, soru metinleri değişmemiş olsa bile legacy exact/fuzzy duplicate borçlarını yeniden blocker yaptığı görüldü.

Kalıcı çözüm:

- `quiz-qa-tool.mjs check-changed BASE_REF ...` eklendi.
- Git baseline'ı ile mevcut quiz JSON'u karşılaştırılır.
- Yalnız `version + questions[].answerInfo` değişmişse dosya `knowledge-backfill` olarak route edilir.
- Soru metni, seçenek, doğru cevap, süre, questionType, görsel, soru sırası/sayısı veya başka metadata değişirse backfill route reddedilir ve mevcut strict production QA çalışır.
- Backfill'de version tam `+1`; her soruda `answerInfo` 1–3 cümle ve 24–500 karakter zorunludur.
- Semantic manifest/shard değiştirilmez; `validate --source` yine zorunlu gate'tir.

Amaç QA'yı gevşetmek değil, **semantik olarak değişmeyen legacy içeriği açıklama zenginleştirmesi ile güvenli biçimde güncelleyebilmek** ve eski duplicate borçlarını bu işlemden ayırmaktır.


---

## 2026-09-04 — Final → Home navigation regression / v0.12.6 hardening

Canlı sonuç ekranında `Tamamla ve ana ekrana dön` yolunun güvenilir olmadığı tekrar gözlendi. İncelemede analytics içindeki eski final-navigation guard'ın hâlâ `button[onclick="finishGame()"]` yüzeyini hedeflediği, güncel DOM'daki `#finalHomeBtn` üzerinde inline `finishGame()` bulunmadığı için bu guard'ın fiilen gerçek butonu korumadığı görüldü.

Düzeltme:

- `app-v0125-final-completion.js` runtime damgası `0.12.6` olarak sertleştirildi.
- `#finalHomeBtn` document-capture seviyesinde sahiplenildi; eski/stale target listener'lar bu yolu gölgeleyemez.
- Çıkılan maçın `room + createdAt` anahtarına bağlı `finalExitLock` eklendi; gecikmiş ended callbacks aynı Final ekranını tekrar boyayamaz.
- Local DOM/home geçişi birincil yol olarak korunur. Başarısızsa auth session'ını kapatmadan cache-busted same-page hard fallback uygulanır.
- GitHub Health artık final-completion JS syntax'ını da kontrol eder.
- Repo QA, yalnız kaynakta eski guard marker'ı bulunmasını değil gerçek `#finalHomeBtn` capture + stale-render lock + hard fallback invariantlarını da doğrular.

Bu patch scoring, Firebase Rules, quiz JSON, semantic index veya analytics archive şemasını değiştirmez.
