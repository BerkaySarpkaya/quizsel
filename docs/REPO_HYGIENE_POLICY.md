# Quizsel Repository Hygiene Policy

## Root'ta kalıcı tutulacaklar
- runtime dosyaları
- quiz source/index
- authoritative QA/semantic spec ve tool'lar
- kalıcı proje dokümantasyonu

## Root'ta kalıcı tutulmayacaklar
- tek kullanımlık upload talimatları
- patch SHA manifestleri
- belirli eski batch'e ait Final QA raporları
- telefondan yükleme notları
- geçici handoff dosyaları

Bu tür teslim dosyaları iş tamamlandıktan sonra Git history'de kalır; production root'ta authoritative doküman gibi bırakılmaz.

## Kaynak notları
Değişebilir bilgi kaynakları soru-bazlı izlenebilir olmalıdır. `QUIZSEL_SOURCE_NOTE_TEMPLATE.md` kullanılabilir.

## Release kuralı
Yeni runtime patch'i production'a girmeden önce:
1. syntax PASS,
2. `quiz-qa-tool.mjs repo` PASS,
3. semantic source audit PASS,
4. browser smoke test PASS.
