# Quizsel — Türkçe Dokümantasyon

Bu dosya eski bağlantıları bozmamak için tutulur.

**Güncel ve authoritative proje dokümantasyonu `README.md` dosyasındadır.**

Eski v0.6/v0.7/v0.8 kurulum talimatları artık geçerli değildir. Güncel temel noktalar:

- soru süresi 20 saniyedir,
- final `Ana sayfaya dön` ile oturumu korur,
- production quiz kodları `YQxxx` standardındadır,
- YQ133+ semantic index zorunludur,
- yarış/runtime katmanı `app-v010-runtime.js`,
- reconnect/final reliability katmanı `app-v011-reliability.js`,
- kalıcı maç/cevap analytics katmanı `app-v012-analytics.js` dosyasıdır,
- durable analytics modeli `docs/ANALYTICS_ARCHITECTURE.md` içinde tanımlıdır.

v0.12 ile `database.rules.json` değişmiştir. GitHub Pages bu dosyayı Firebase'e otomatik deploy etmez; yeni ruleset Realtime Database Rules ekranında ayrıca publish edilmelidir.


## v0.12.1 final çıkış düzeltmesi

Bazı iOS/Safari oturumlarında final ekranındaki `Ana sayfaya dön` akışı cleanup/render exception'ı sonrası `Ana sayfaya dönülüyor…` halinde kilitlenebiliyordu. v0.12.1 analytics overlay normal v0.11 davranışını korur; exception recovery, watchdog ve direct DOM fallback ile kullanıcıyı final ekranında mahsur bırakmaz.
