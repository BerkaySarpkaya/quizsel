QUIZSEL v0.9.1 — FLOW FIX

GitHub repo ROOT dizinine İKİ DOSYAYI BİRLİKTE yükle:

1) config.js
   - mevcut config.js dosyasının üzerine yaz.

2) app-flow-v091.js
   - yeni dosya olarak ekle.

Başka dosyaya dokunma.

BEKLENEN DAVRANIŞ
- Finalde mevcut buton otomatik olarak "Ana sayfaya dön" olur.
- Butona basınca Firebase Auth oturumu kapanmaz; login ekranına atmaz.
- Final istatistik/geçmiş kaydı bitmeden oda state'i temizlenmez.
- Her aktif oyuncu cevap verirse 20 saniyenin kalan kısmı beklenmez.
- Cevap vermeyen oyuncu varsa mevcut 20 saniyelik süre fallback olarak aynen çalışır.
- Reveal ekranında "Herkes cevap verdi" bilgisi görünür.
- Sonuçtan sonra "Diğer soruya geçiliyor" + 3 → 2 → 1 gösterilir.
- Son sorudan sonra gereksiz yeni-soru countdown'u yapılmaz; finale geçilir.

DEĞİŞMEYENLER
- app.js
- app-v09-performance.js
- index.html
- styles.css
- Firebase Rules
- quiz JSON dosyaları
- skor formülü
