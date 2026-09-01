# Quizsel Soru Üretim Manueli
## Sürüm 2.0 — Semantic QA & Topic Diversity Standardı

Bu belge Quizsel için yeni soru üretirken uygulanacak kalıcı üretim ve QA sözleşmesidir.
Kullanıcı “aynı sistem”, “beğendiğim yeni soru sistemi” veya benzeri bir ifade kullandığında bu manuel varsayılan standart kabul edilir.

Bu sürüm önceki kuralları korur ve şu kalite katmanlarını ekler:
- Semantic Fact Graph
- Answer-Leakage Graph
- Soru biçimi çeşitliliği
- Topic Diversity & Saturation Control
- Cue / Guessability Detection
- Precision Burden (hassas ezber yükü)

`QUIZSEL_SORU_QA_SPEC.json` bu manuelin makine-okunabilir eşlikçisidir.
Bu authoring metadata’sı üretim/QA içindir; mevcut quiz JSON çalışma şemasını değiştirmez.

## 1. Varsayılan quiz profili
- Kategori: Genel Kültür
- Set başına soru: 10
- Seçenek: 4
- Soru süresi: 20 saniye
- Varsayılan zorluk: 4.5 / 10; kullanıcı farklı bir zorluk belirtirse o değer kullanılır.
- questionType: multiple-choice
- Görsel veya tablo zorunlu değildir; yalnız soruya gerçek değer katıyorsa eklenir.
- Her soru tek başına anlaşılır ve başka soruya ihtiyaç duymaz.
- Amaç “çok soru” değil; bağımsız, dengeli, tekrarsız ve test tekniğine dirençli soru üretmektir.

## 2. Zorluk kalibrasyonu ve Precision Burden

### 2.1 4.5 / 10 ne demektir?
4.5, “çok kolay çocuk sorusu” değildir.
- Genel kültürle ilgilenen ortalama yetişkin cevabı bilebilir veya güçlü biçimde hatırlayabilir.
- Dar uzmanlık, meslek bilgisi veya aşırı spesifik ezber gerekmez.
- Soru çoğunlukla tek aşamalı bilgi çağırır veya hafif bir karşılaştırma/çıkarım ister.
- Çeldiriciler soruyu yapay olarak 2/10 seviyesine düşürmez.
- Cevap bilinmiyorsa yalnız test tekniğiyle doğru şıkkı bulmak belirgin biçimde zor olmalıdır.

### 2.2 Precision Burden
Soru zorluğu yalnız “konu zor mu?” diye değerlendirilmez. Şunlar birlikte değerlendirilir:
1. bilginin genel tanınırlığı,
2. istenen hassasiyet,
3. bilginin ne kadar obscure olduğu,
4. seçeneklerin birbirine yakınlığı.

Hassasiyet sınıfları:
- **P0 / low:** kişi, eser, yer, kavram, ilişki gibi normal bilgi çağırma.
- **P1 / medium:** yüzyıl, dönem, önce/sonra, yaklaşık aralık, makul karşılaştırma.
- **P2 / exact-salient:** yalnız toplumda sembolik/iyi bilinen kesin yıl veya sayı. Kontrollü kullanılabilir.
- **P3 / exact-obscure:** az bilinen kesin yıl, nüfus, uzunluk, adet, derece veya birbirine çok yakın sayısal seçenekler. Varsayılan Genel Kültür 4.5 için **RED**.

Özellikle “bir sayı fazla / bir sayı az” şeklindeki yakın seçenek lotosu varsayılan olarak kullanılmaz.
Bir bilgi yalnız exact recall ile çözülebiliyor ve exact değer geniş kitlece bilinen sembolik bir bilgi değilse soru yeniden yazılır:
- tam yıl yerine dönem/yüzyıl,
- kesin sayı yerine yaklaşık aralık,
- sayı yerine ilişki/karşılaştırma,
- “hangi yıl?” yerine “hangisi önce?” gibi.

Precision Burden soruyu zorlaştırmak için kullanılmaz. Zorluk bilgi ve düşünme kalitesinden gelmelidir; keyfî hassas ezberden değil.

## 3. İçerik taksonomisi

### 3.1 Ana kategoriler
Genel Kültür için kabul edilen ana kategoriler:
1. Tarih
2. Coğrafya
3. Bilim & Doğa
4. Edebiyat & Dil
5. Sinema & Televizyon
6. Müzik
7. Görsel Sanatlar & Mimari
8. Spor
9. Teknoloji & İcatlar
10. Toplum & Kültür
11. Yemek & Mutfak
12. Gündelik Yaşam
13. Ekonomi & İş Dünyası
14. Oyun & Eğlence

### 3.2 Scope kategori değildir
“Türkiye” ve “Dünya” ana kategori olarak kullanılmaz; coğrafi/bağlamsal scope etiketidir.
Örnek:
- Tarih → 20. Yüzyıl | scope: Türkiye
- Coğrafya → Şehirler | scope: Türkiye
- Müzik → Müzik Türleri | scope: Dünya

### 3.3 Topic Family
Her aday soru üretim sırasında bir Topic Family ile sınıflandırılır.
Kanonik kırılım `QUIZSEL_SORU_QA_SPEC.json` içinde tutulur.
Kategori “ne kadar geniş alandayız?” sorusunu; Topic Family ise “gerçekte ne hakkında soruyoruz?” sorusunu cevaplar.

## 4. Semantic Fact Graph
Her aday soru için üretim/QA sırasında şu semantik imza çıkarılır:
- category
- topicFamily
- scope
- subject
- askedProperty
- correctAnswer
- factCluster
- precisionRequired

Aynı `subject + askedProperty + correctAnswer` bilgisi yeniden sorulmaz.
Sadece cümleyi değiştirmek yeni soru yaratmaz.

Aynı bilgi kümesinin ters veya yakın türevleri `factCluster` altında birleştirilir.
Örneğin “The Seventh Seal filminin yönetmeni kimdir?” ile “Ingmar Bergman hangi filmi yönetti?”
aynı bilgi kümesini sömürüyorsa aynı fact cluster kabul edilir.

- Aynı quiz içinde aynı fact cluster = RED.
- Mevcut havuzla güçlü fact-cluster çakışması = yeniden yaz / RED.

## 5. Answer-Leakage Graph
Bir quiz içindeki her soru diğer sorulara karşı kontrol edilir.
Grafikte düğüm = soru, kenar = bir sorunun diğerine bilgi sızdırmasıdır.

Hard-fail durumları:
- Bir sorunun doğru cevabı başka soru kökünde açıkça veriliyorsa.
- Başka bir soru kökü doğru cevabı tanımlayıp fiilen ele veriyorsa.
- A→B ve B→A ters soru ilişkisi varsa.
- Aynı kişi/eser/olay üzerinden yakın özellikler birbirini çözdürüyorsa.
- Bir sorunun seçenekleri başka bir soruya güçlü cevap ipucu oluşturuyorsa.

Leakage yalnız birebir kelime eşleşmesi değildir; anlamsal sızıntı da kontrol edilir.
Yeni quiz PASS olmadan önce leakage graph üzerinde kritik kenar kalmamalıdır.

## 6. Soru biçimi çeşitliliği
Quiz yalnız “X nedir / kimdir / nerededir?” tipi doğrudan trivia dizisine dönüşmemelidir.
Uygun olduğunda şu biçimler karıştırılır:
- doğrudan tanıma / identification
- ilişki kurma
- kronoloji / önce-sonra
- karşılaştırma
- sınıflandırma
- neden-sonuç
- hafif çıkarım
- yaklaşık değer/aralık
- görsel tanıma

Negatif kök (“hangisi değildir?”) kullanılabilir fakat seyrek ve açık olmalıdır.
Trick question, kelime oyunu veya yanıltıcı formülasyonla yapay zorluk yaratılmaz.

Hard kota yoktur. Ama 10 soruluk bir sette tek bir soru biçiminin baskın ve monoton hale gelmesi QA uyarısıdır.
- Topic Diversity = ne hakkında soruyoruz?
- Question Form Diversity = nasıl soruyoruz?

## 7. Topic Diversity & Saturation Control

### 7.1 Hard kurallar
- Aynı fact cluster aynı quizde yalnız 1 kez bulunabilir.
- Aynı Topic Family art arda gelemez.
- Aynı Topic Family bir 10 soruluk quizde en fazla 2 kez bulunabilir.

### 7.2 Soft hedefler
- Kategori çeşitliliği mümkün olduğunca artırılır.
- Her quizde zorunlu “8 farklı kategori” gibi sert minimum kota **YOKTUR**.
- Bir ana kategori 3 soruya çıkabilir; ancak bu yalnız toplam kaliteyi artırıyorsa ve Topic Family çeşitliliği korunuyorsa kabul edilir.
- Aynı kategori sırası farklı quizlerde görünür şablona dönüştürülmez.

### 7.3 Yakın geçmiş doygunluğu
Son 5 Genel Kültür quizinde aşırı kullanılan Topic Family’ler yeni üretimde soft novelty penalty alır.
Bu yasak değildir; yalnız daha az kullanılmış topic family’lere öncelik verir.
Amaç havuzu zaman içinde başkentler, gezegenler, savaşlar gibi birkaç güvenli alana sıkıştırmamaktır.

## 8. Çeldirici tasarımı ve Cue / Guessability Detection

### 8.1 Çeldirici standardı
- Dört seçenek aynı semantik sınıftan seçilir: kişi-kişi, şehir-şehir, dönem-dönem vb.
- Dilbilgisel yapı mümkün olduğunca paraleldir.
- Saçma veya komik çeldirici kullanılmaz.
- “Hepsi”, “Hiçbiri”, “Yukarıdakilerin tümü” varsayılan olarak kullanılmaz.
- Özel isim çeldiricileri mümkünse aynı dönem, ülke, sanat dalı veya meslek çevresinden gelir.
- Sayısal seçenekler kullanılıyorsa Precision Burden ayrıca kontrol edilir.

### 8.2 Cue kontrolü
Doğru cevabı bilmeyen bir oyuncunun yalnız seçenek biçiminden cevap tahmin etmesini kolaylaştıran işaretler aranır:
- doğru seçeneğin benzersiz biçimde çok uzun/kısa olması,
- doğru seçeneğin diğerlerinden daha teknik veya daha spesifik olması,
- yalnız doğru seçenekte soru köküyle belirgin kelime eşleşmesi,
- gramer uyumunun yalnız doğru seçenekte düzgün olması,
- üç seçeneğin aynı sınıfta, bir seçeneğin başka sınıfta olması,
- sayı/yıl seçeneklerinde doğru değerin görsel olarak “ortada” veya aşırı aykırı görünmesi,
- doğru cevabın diğerlerinden daha açıklayıcı bir cümle olması.

En uzun / en kısa seçenek kelime oranı tercihen 3’ü geçmez.
Parti genelinde doğru cevabın benzersiz en uzun seçenek olma oranı düşük tutulur; hedef **<= %10**’dur.
Cue tespit edilirse önce çeldiriciler yeniden yazılır.

## 9. Doğru şık dağılımı
3A-3B-2C-2D gibi sabit bir kota YOKTUR.
- Her quiz için cevap konumları ayrı RNG ile üretilir.
- Dağılımlar quizden quize doğal olarak değişir.
- 10 soruda dört harfin her biri en az 1 kez görünür.
- Tek bir harf 5’ten fazla doğru cevap olamaz.
- Ardışık aynı harfler doğal biçimde oluşabilir; sırf desen kırmak için cevap değiştirilmez.

## 10. Tekrar ve çakışma kontrolü
Üretimden önce `quiz-index.json` ve mevcut Quizsel soru JSON havuzu okunur.

### 10.1 Exact duplicate
Küçük/büyük harf, noktalama ve fazla boşluk normalize edilir.
Tam aynı soru = RED.

### 10.2 Fuzzy duplicate
Soru kökleri benzerlik metriğiyle karşılaştırılır.
Varsayılan eşik >= 0.84: manuel/semantik inceleme gerektirir.
Aynı bilginin yalnız cümlesi değiştirilmiş hâli kabul edilmez.

### 10.3 Semantic duplicate
Semantic Fact Graph, string benzerliği düşük olsa bile aynı bilgi/fact cluster tekrarını yakalamak için kullanılır.
Yeni üretim partisi kendi içinde ve mevcut havuza karşı aynı kontrollerden geçer.

## 11. Gerçeklik, belirsizlik ve kaynak kontrolü
- Zamandan bağımsız bilgiler güvenilir referans bilgisine dayanır.
- Güncel/değişebilir bilgi web üzerinden yeniden doğrulanır.
- Türkiye’nin yakın dönem gelişmelerinde resmî kurum, organizasyon veya birincil kaynak tercih edilir.
- Birden fazla makul cevabı olan veya kapsamı belirsiz “ilk / en büyük / en eski” soruları kullanılmaz.
- Tartışmalı sınıflandırmalar 4.5 seviyesinde soru yapılmaz.
- Doğru cevabın “bir kaynakta öyle yazıyor” olması yetmez; diğer seçeneklerin makul biçimde doğru savunulamadığı da kontrol edilir.
- Kesin yıl/sayı içeren sorular ayrıca Precision Burden kontrolünden geçer.

## 12. Quiz oluşturma sırası
1. `quiz-index.json` okunur ve yeni kod aralığı belirlenir.
2. Mevcut soru JSON’larından eski stem/answer/fact havuzu çıkarılır.
3. Son 5 Genel Kültür quizinin Topic Family doygunluğu değerlendirilir.
4. Geniş aday soru bankası oluşturulur.
5. Her aday için Semantic Fact Graph metadata’sı çıkarılır.
6. Precision Burden değerlendirilir; P3 adaylar elenir veya yeniden yazılır.
7. Exact, fuzzy ve semantic fact/fact-cluster tekrarları elenir.
8. Adaylar Category + Topic Family + Question Form çeşitliliği gözetilerek quizlere dağıtılır.
9. Answer-Leakage Graph kurulup kritik kenarlar temizlenir.
10. Çeldiriciler Cue / Guessability kontrolünden geçirilir.
11. Doğru cevap pozisyonları ayrı RNG ile atanır.
12. Şıklar ve kategori/soru sırası son kez kontrol edilir.
13. Güncel/değişebilir bilgiler kaynakla doğrulanır.
14. Teknik JSON/schema ve `quiz-index.json` bütünlüğü kontrol edilir.
15. Paket ancak tüm hard QA kapıları PASS ise teslim edilir.

## 13. Teknik JSON kabul kriterleri
- schemaVersion = 2
- code ve displayCode benzersiz
- difficulty talep edilen değere eşit
- questions = tam 10
- her soruda 4 benzersiz options
- answer = 0..3
- time = 20
- questionType = multiple-choice
- JSON parse = PASS
- `quiz-index.json` her yeni dosyayı tam bir kez içermeli
- quiz üretimi Firebase Rules, app.js, config.js veya uygulama çalışma şemasını değiştirmez
- Semantic Fact Graph / Topic Family / Question Form gibi authoring metadata’sı QA sırasında tutulabilir; public quiz JSON’una eklenmesi zorunlu değildir.

## 14. Son QA kapısı

### Hard PASS
- JSON/schema
- exact duplicate
- fuzzy >= 0.84 review
- semantic fact/fact-cluster duplicate
- answer leakage graph
- Precision Burden: P3 yok
- tek savunulabilir doğru cevap
- seçenek semantik sınıf / gramer paralelliği
- doğru şık dağılımı kuralları
- aynı Topic Family art arda yok
- aynı Topic Family quiz içinde <= 2
- güncel bilgi kaynak doğrulaması
- `quiz-index.json` bütünlüğü

### Soft kalite raporu
- kategori çeşitliliği
- Topic Family çeşitliliği
- soru biçimi çeşitliliği
- son 5 quiz topic doygunluğu
- benzersiz-en-uzun doğru cevap oranı
- diğer cue/guessability anomalileri
- Precision dağılımı P0/P1/P2

Soft hedef ihlali tek başına otomatik RED değildir; editoryal kalite değerlendirmesi gerektirir.

## 15. Değişiklik politikası
Yeni bir kalite kuralı eklendiğinde mevcut hard kurallar zayıflatılmaz.
Yeni kurallar önce bu manuelde tanımlanır; makine-okunabilir karşılığı varsa
`QUIZSEL_SORU_QA_SPEC.json` ile senkron tutulur.
