# Quizsel v0.9 — Performance & UX

Odak: daha az gereksiz istek, daha hızlı hissedilen hamleler ve sabit sayfa geçişleri.

Bu sürümde DEĞİŞMEYENLER:
- Firebase Realtime Database veri yapısı
- Mevcut kullanıcı/istatistik/quiz-history verileri
- database.rules.json
- config.js
- quiz-index.json
- Tüm QZ / YQ quiz dosyaları
- Puanlama ve yarışma kuralları

Geliştirmeler:
- Aynı ekran tekrar render edildiğinde scroll artık en üste sıfırlanmıyor.
- Lobide bir oyuncu Hazırım dediğinde diğer oyuncuların ekranı yerinden oynamıyor.
- Lobby oyuncu kartları komple yeniden yaratılmıyor; mevcut DOM satırları korunuyor.
- Soru cevap butonları diğer oyuncuların Firebase eventlerinde gereksiz yeniden oluşturulmuyor.
- Hazırım ve cevap aksiyonlarında optimistic UI ile ekranda anında tepki veriliyor.
- Cevap göndermeden önce yapılan gereksiz Firebase GET kaldırıldı.
- Host zamanlayıcısı her faz geçişinde tüm odayı okumak yerine yalnız gereken yolları okuyor.
- Sekmeye geri dönüldüğünde gereksiz tam oda GET kaldırıldı.
- Quiz manifesti 30 saniye RAM cache kullanıyor.
- Açılmış quiz JSON'ları oturum içinde tekrar indirilmeden RAM'den kullanılıyor.
- Date.now() cache-busting yerine HTTP no-cache revalidation kullanılıyor.
- Mobil alt/üst overscroll sekmesi azaltıldı.
- DOM timer güncellemeleri 120 ms yerine 200 ms aralıkla yapılıyor.
- Firebase CDN ve Realtime Database için preconnect eklendi.
