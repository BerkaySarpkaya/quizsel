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
