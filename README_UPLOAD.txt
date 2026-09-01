QUIZSEL SORU POLİTİKASI v2.0 — UPLOAD

GitHub repo ROOT dizinine bu 3 dosyayı birlikte yükle:

1) QUIZSEL_SORU_URETIM_MANUELI.md
   - mevcut dosyanın üstüne yaz
   - yeni authoritative soru üretim standardı

2) QUIZSEL_SORU_QA_SPEC.json
   - yeni dosya
   - taksonomi + Semantic Fact Graph + Answer Leakage + Question Form
     + Topic Diversity + Precision Burden + Cue/Guessability makine-okunabilir kuralları

3) QUIZ_TEMPLATE.json
   - mevcut dosyanın üstüne yaz
   - eski 15 sn / difficulty 6 değerlerini 20 sn / 4.5 standardına getirir

UYGULAMA KODUNA DOKUNMA:
- app.js
- config.js
- styles.css
- Firebase rules
- mevcut quiz JSONları
değişmeyecek.

Bu paket mevcut runtime quiz şemasını değiştirmez.
