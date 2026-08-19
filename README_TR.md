# Quizsel v0.8 — Race Control & Quiz History

Yeni özellikler:
- Eski oyun geçmişi `activityLogs` içinden bir defalık profile taşınır; v0.8 öncesi tamamlanmış quizler de 'daha önce gördü' bilgisinde kullanılabilir.
- Oyuncular yarışmadan onay ekranıyla çıkabilir.
- Kurucu yarışmadan çıkarsa kuruculuk en eski kalan oyuncuya otomatik devredilir; yarışma devam eder.
- Kurucu ayrıca "Yarışmayı sonlandır" ile odayı tamamen kapatabilir.
- Oyuncu çıkarken kendi cevap kayıtları temizlenir.
- Tüm sorular 15 saniyedir.
- Profil bazında quiz görme geçmişi tutulur.
- Lobi, her oyuncunun o quizin sorularını daha önce görüp görmediğini gösterir.
- Avatarlar, canlı sıralama ve final kürsüsü görsel olarak güçlendirildi.
- Finalde daha belirgin kazanan avatarı ve gerçek kürsü görünümü vardır.

Not: database.rules.json değişti. Bu sürüm yüklenince Firebase Realtime Database Rules yeniden Publish edilmelidir.

# Quizsel v0.7 — Experience Pack

1. Oyun hissi geliştirmeleri
2. Gelişmiş lobi ve oyuncu çıkarma
3. Görsel soru sistemi
4. Gelişmiş final/podium
5. Bağlantı ve reload recovery

# Quizsel v0.6.1 — Oda Kurma Hotfix

Bu sürüm Realtime Database `PERMISSION_DENIED` oda kurma hatasını düzeltir.

# Quizsel v0.6 — Spark / Kullanıcı Adı + Şifre

Bu sürüm Spark planında çalışacak şekilde hazırlanmıştır.

## Kullanıcı deneyimi
Kullanıcı ekranda yalnızca:
- kullanıcı adı
- şifre

görür.

Gerçek e-posta istenmez, gösterilmez veya doğrulanmaz.

Firebase Authentication'ın ücretsiz Email/Password altyapısı teknik olarak arka planda kullanılır.
Örneğin `berkay` kullanıcı adı dahili olarak `berkay@quizsel.app` kimliğine çevrilir.
Bu teknik kimlik kullanıcının ekranına çıkmaz.

## 1 — Firebase Authentication
Firebase Console:
Authentication > Sign-in method > Email/Password > Enable

Anonymous açmana gerek yok.

## 2 — Yönetici hesabı
Firebase Console:
Authentication > Users > Add user

E-mail:
quizsel-admin@quizsel.app

Password:
Kendi güçlü yönetici şifreni yaz.

Bu e-posta yalnızca Firebase'in iç teknik kimliğidir.
Quizsel yönetici ekranında sadece şifre sorulur.

## 3 — Database Rules
Firebase Console:
Realtime Database > Rules

Mevcut kuralların tamamını sil.
`database.rules.json` içeriğini yapıştır.
Publish.

## 4 — GitHub
Repo ana dizinine şu dosyaları yükle:
- index.html
- styles.css
- config.js
- app.js
- database.rules.json
- quiz-index.json
- QZ001.json
- QZ002.json
- QZ003.json
- QZ004.json
- QZ005.json
- QZ006.json
- QZ007.json
- QUIZ_TEMPLATE.json

GitHub Pages main / root kullanıyorsa başka deploy işlemi yok.

## 5 — Kullanıcı akışı
İlk kez:
Kayıt Ol > kullanıcı adı > şifre > Hesap oluştur

Sonraki giriş:
Giriş > kullanıcı adı > şifre

Hesabın Firebase UID'si sabit kalır.
Skor, oyun sayısı ve galibiyet verileri `profiles/<uid>` altında tutulur.
Aktivite kayıtları `activityLogs/<uid>` altında tutulur.

Sekme açıkken refresh yapılırsa oturum korunur.
Sekme / browser oturumu kapanınca tekrar kullanıcı adı + şifre gerekir.
Oyun finalinde "Tamamla ve çıkış yap" denince de oturum kapatılır.

## 6 — Yarış
- Her giriş yapan oyuncu oyun kurabilir.
- Hazır quiz seçer.
- 6 haneli oda oluşur.
- Diğer kullanıcılar kodla girer.
- Herkes Hazırım der.
- Herkes hazır olmadan kurucunun Başlat düğmesi aktif olmaz.
- Kurucu başlatır.
- 3-2-1 geri sayım tüm cihazlarda görünür.
- Sorular oda zamanına göre senkron açılır.
- Doğru ve hızlı cevap daha fazla puan getirir.
- Her tur sonunda doğru cevap ve sıralama görünür.

## 7 — Yeni quiz
Ana kodu değiştirmeden:
1. QUIZ_TEMPLATE.json dosyasını kopyala.
2. Örneğin QZ008.json yap.
3. code alanını QZ008 yap.
4. Soruları doldur.
5. GitHub repo köküne yükle.
6. Quizsel > Oyun Kur > Quiz koduyla aç > QZ008.

Hazır listede de görünmesini istersen yalnızca quiz-index.json'a kısa kayıt ekle.

## Hazır quizler
QZ001 — Genel Kültür Tur 1
QZ002 — Genel Kültür Tur 2
QZ003 — Bilim & Doğa
QZ004 — Tarih & Uygarlıklar
QZ005 — Dünya Coğrafyası
QZ006 — Sanat, Sinema & Edebiyat
QZ007 — Mantık & Sayılar

Toplam: 70 soru.
Bazı sorularda dosyaya gömülü hafif SVG görseller vardır.
