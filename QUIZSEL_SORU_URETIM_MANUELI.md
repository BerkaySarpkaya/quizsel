# Quizsel Soru Üretim Manueli
## Sürüm 1.0 — Doğal Genel Kültür Standardı

Bu belge Quizsel için yeni soru üretirken uygulanacak kalıcı üretim ve QA sözleşmesidir.
Kullanıcı “aynı sistem”, “beğendiğim yeni soru sistemi” veya benzeri bir ifade kullandığında
bu manuel varsayılan standart kabul edilir.

## 1. Varsayılan quiz profili
- Kategori: Genel Kültür
- Set başına soru: 10
- Seçenek: 4
- Soru süresi: 20 saniye
- Varsayılan zorluk: 4.5 / 10; kullanıcı farklı bir zorluk belirtirse o değer kullanılır.
- questionType: multiple-choice
- Görsel veya tablo zorunlu değildir; yalnız soruya gerçek değer katıyorsa eklenir.
- Her soru tek başına anlaşılır ve başka soruya ihtiyaç duymaz.

## 2. 4.5 / 10 zorluk kalibrasyonu
4.5, “çok kolay çocuk sorusu” değildir.
- Genel kültürle ilgilenen ortalama yetişkin cevabı bilebilir veya güçlü biçimde hatırlayabilir.
- Dar uzmanlık, meslek bilgisi veya aşırı spesifik ezber gerekmez.
- Soru çoğunlukla tek aşamalı bilgi çağırır.
- Çeldiriciler soruyu yapay olarak 2/10 seviyesine düşürmez.
- Cevap bilinmiyorsa yalnız test tekniğiyle doğru şıkkı bulmak belirgin biçimde zor olmalıdır.

## 3. İçerik ve sıralama
Türkiye / yakın dönem, dünya coğrafyası, bilim-doğa, teknoloji, sanat-popüler kültür,
edebiyat, spor, yemek-kültür, tarih ve dil gibi alanlar karıştırılabilir.
- Her quiz aynı kategori sırasını izlemez.
- “Önce tarih, sonra bilim, sonra spor” gibi görünür şablon oluşturulmaz.
- Varsayılan olarak aynı quizde bir kategoriden en fazla 2 soru bulunur.
- Yakın Türkiye tarihi ve güncel genel kültür bilgileri dönemsel olarak eklenebilir.
- Güncel bilgiler güvenilir ve tercihen birincil/resmî kaynaktan doğrulanır.

## 4. Soru bağımsızlığı
Bir quiz içindeki sorular birbirine cevap veremez.
- Bir sorunun doğru cevabı başka sorunun soru kökünde açıkça geçmemelidir.
- Başka sorunun seçenekleri de doğrudan cevap ipucu oluşturacak biçimde kurgulanmamalıdır.
- Aynı olgunun A→B ve B→A biçiminde ters çevrilmiş iki sorusu kullanılmaz.
- Aynı kişi, eser veya olayın yakın özellikleri aynı sette gereksiz yere tekrar sorgulanmaz.

## 5. Çeldirici tasarımı ve test tekniğine direnç
- Dört seçenek aynı semantik sınıftan seçilir: kişi-kişi, şehir-şehir, yıl-yıl vb.
- Dilbilgisel yapı mümkün olduğunca paraleldir.
- Doğru cevap sistematik olarak en uzun, en teknik veya en ayrıntılı şık olamaz.
- “Hepsi”, “Hiçbiri”, “Yukarıdakilerin tümü” varsayılan olarak kullanılmaz.
- Saçma veya komik çeldirici kullanılmaz.
- Sorudaki sözcüğün yalnız doğru seçenekte tekrar etmesi gibi eşleşme ipuçları azaltılır.
- Sayısal yanlış cevaplar makul büyüklükte ve aynı formatta olur.
- Özel isim çeldiricileri mümkünse aynı dönem, ülke, sanat dalı veya meslek çevresinden gelir.
- En uzun / en kısa seçenek kelime oranı tercihen 3’ü geçmez.
- Parti genelinde doğru cevabın benzersiz biçimde en uzun şık olması düşük oranda tutulur ve QA’da raporlanır.

## 6. Doğru şık dağılımı
3A-3B-2C-2D gibi sabit bir kota YOKTUR.
- Her quiz için cevap konumları ayrı RNG ile üretilir.
- Dağılımlar quizden quize doğal olarak değişir.
- 10 soruda dört harfin her biri en az 1 kez görünür.
- Tek bir harf 5’ten fazla doğru cevap olamaz.
- Ardışık aynı harfler doğal biçimde oluşabilir; sırf desen kırmak için cevap değiştirilmez.

## 7. Tekrar ve çakışma kontrolü
Üretimden önce mevcut Quizsel JSON soru havuzu okunur ve yeni partiyle karşılaştırılır.

### 7.1 Exact duplicate
Küçük/büyük harf, noktalama ve fazla boşluk normalize edilir.
Tam aynı soru = RED.

### 7.2 Fuzzy duplicate
Soru kökleri benzerlik metriğiyle karşılaştırılır.
Varsayılan eşik >= 0.84: manuel inceleme gerektirir.
Aynı bilginin yalnız cümlesi değiştirilmiş hâli kabul edilmez.

### 7.3 Fact / topic signature
Aynı “özne + sorulan özellik” kombinasyonu yeniden sorulmaz.
Örneğin daha önce “X filminin yönetmeni?” sorulduysa aynı bilgi yeni kelimelerle tekrar sorulmaz.

Yeni üretim partisi kendi içinde de aynı üç kontrolden geçer.

## 8. Gerçeklik ve kaynak kontrolü
- Zamandan bağımsız bilgiler güvenilir referans bilgisine dayanır.
- Güncel / değişebilir bilgi web üzerinden yeniden doğrulanır.
- Türkiye’nin yakın dönem gelişmelerinde resmî kurum, organizasyon veya birincil kaynak tercih edilir.
- Birden fazla makul cevabı olan veya kapsamı belirsiz “ilk / en büyük / en eski” soruları kullanılmaz.
- Tartışmalı sınıflandırmalar 4.5 seviyesinde soru yapılmaz.

## 9. Quiz oluşturma sırası
1. Mevcut quiz-index.json okunur ve yeni kod aralığı belirlenir.
2. Mevcut soru JSON’larından eski soru/fact havuzu çıkarılır.
3. Geniş aday soru bankası oluşturulur.
4. Exact, fuzzy ve fact/topic tekrarları elenir.
5. Sorular kategori çeşitliliği gözetilerek quizlere dağıtılır.
6. Çatışma grafiğiyle soru bağımsızlığı kontrol edilir.
7. Doğru cevap pozisyonları ayrı RNG ile atanır.
8. Çeldiriciler karıştırılır.
9. Test-tekniği QA uygulanır.
10. quiz-index.json güncellenir ve paket ancak tüm kritik kontroller PASS ise teslim edilir.

## 10. Teknik JSON kabul kriterleri
- schemaVersion = 2
- code ve displayCode benzersiz
- difficulty talep edilen değere eşit
- questions = tam 10
- her soruda 4 benzersiz options
- answer = 0..3
- time = 20
- questionType = multiple-choice
- JSON parse = PASS
- quiz-index.json her yeni dosyayı tam bir kez içermeli
- quiz üretimi Firebase Rules, app.js, config.js veya uygulama şemasını değiştirmez

## 11. Son QA kapısı
Teslimden önce:
- JSON/schema
- exact duplicate
- fuzzy duplicate
- fact/topic tekrar
- soru bağımsızlığı ve answer leakage
- seçenek uzunluğu / gramer paralelliği
- doğru şık dağılımında sabit şablon olmaması
- kategori sırasının kalıp olmaması
- güncel bilgi kaynak doğrulaması
- quiz-index bütünlüğü
kontrolleri tamamlanır.

Kullanıcı yeni bir kalite kuralı eklediğinde mevcut kuralları zayıflatmadan bu manuel güncellenir.
