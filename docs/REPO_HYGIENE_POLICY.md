# Quizsel Repository Hygiene Policy

## Root'ta kalıcı tutulacaklar

- aktif runtime dosyaları,
- quiz source dosyaları ve `quiz-index.json`,
- authoritative QA / semantic spec ve tool'lar,
- kalıcı proje dokümantasyonu,
- production için gerçekten kullanılan stil ve Firebase kural dosyaları.

## Root'ta kalıcı tutulmayacaklar

- tek kullanımlık upload talimatları,
- patch SHA manifestleri,
- belirli eski batch'e ait final QA raporları,
- telefondan/yüklemeden kalmış geçici notlar,
- artık başka bir runtime katmanı tarafından tamamen supersede edilmiş eski patch dosyaları.

Bu dosyalar silinmeden önce aktif runtime zinciri ve GitHub Health tekrar doğrulanır. Git geçmişi eski sürümlerin audit trail'idir.

## Browser-upload paket kuralı

Manuel GitHub web upload için hazırlanan ZIP'lerde **nokta ile başlayan klasör veya dosya adı kullanılmaz**.
Örnek olarak `.github`, `.gitignore`, `.config` benzeri yollar upload paketine konmaz.

Bu kural `.github` klasörünün repository'de yanlış olduğu anlamına gelmez. Quizsel'de mevcut `.github/workflows/quizsel-health.yml` geçerli altyapıdır ve korunur; yalnızca browser-upload ZIP'ine yeniden paketlenmez.

Upload ZIP'i görünür isimli bir `UPLOAD_ROOT` taşıyabilir. Repository'ye `UPLOAD_ROOT` klasörünün kendisi değil, onun **içeriği** yüklenir.

## Kaynak notları

Değişebilir bilgi kaynakları soru-bazlı izlenebilir olmalıdır. `QUIZSEL_SOURCE_NOTE_TEMPLATE.md` kullanılabilir.

## Release / cleanup sırası

Yeni runtime veya wiring patch'i production'a girmeden / cleanup yapılmadan önce:

1. JavaScript syntax PASS,
2. `quiz-qa-tool.mjs repo` PASS,
3. semantic source audit PASS,
4. GitHub Pages deployment PASS,
5. browser smoke test PASS,
6. cleanup adayları tek tek doğrulanır,
7. ancak bundan sonra silme yapılır.

Temizlik sırasında aynı turda quiz dosyalarını klasöre taşıma, runtime refactor etme veya Firebase Rules değiştirme yapılmaz; bunlar ayrı kontrollü migrasyonlardır.
