# Quizsel Soru Üretim Manueli
## Sürüm 2.4 — Semantic QA, Bilgi Canavarı & Automated Health Standardı

Bu belge Quizsel için yeni soru üretiminde authoritative kalite sözleşmesidir.
`QUIZSEL_SORU_QA_SPEC.json` makine-okunabilir eşlikçidir.
`QUIZSEL_SEMANTIC_INDEX_SPEC.json` YQ133+ semantic-index sözleşmesidir.

Semantic authoring metadata runtime quiz JSON şemasını değiştirmez. v2.4 ile `answerInfo` soru JSON’una backward-compatible bir runtime alanı olarak eklenmiştir.

## 1. Varsayılan quiz profili

- Kategori: Genel Kültür
- Soru sayısı: 10
- Seçenek: 4
- Süre: 20 saniye
- Varsayılan zorluk: 4.5/10; kullanıcı farklı değer isterse o değer kullanılır.
- `questionType`: `multiple-choice`
- YQ253+ her soruda `answerInfo`: doğru cevabı açıklayan veya soruyla ilgili keyifli bir fun-fact veren 1–3 cümle.
- Sorular birbirinden bağımsızdır.
- Görsel/tablo ancak gerçek değer katıyorsa kullanılır.
- Oyuncu soruyu “hileli ifade” yüzünden değil, bilgiyi bilmediği için kaybetmelidir.

## 2. Zorluk ve Precision Burden

4.5/10:
- ortalama yetişkin genel kültür düzeyinde erişilebilir,
- çocukça/basic değil,
- uzmanlık/obscure ezber gerektirmez,
- hafif ilişki/karşılaştırma/çıkarım kabul edilir.

Precision:
- P0: normal kavram/kişi/yer/ilişki → PASS
- P1: dönem/yüzyıl/sıralama/yaklaşık aralık → PASS
- P2: kültürel olarak belirgin kesin yıl/sayı → REVIEW
- P3: obscure kesin yıl/sayı/ölçüm/yakın-sayı lotosu → RED

P3 bilgi mümkünse dönem, yaklaşık aralık, önce-sonra veya ilişki sorusuna dönüştürülür.

## 3. Taksonomi

Scope kategori değildir:
- Türkiye
- Dünya
- Bölgesel
- Yerel
- Karma

Kanonik kategori ve Topic Family listesi `QUIZSEL_SORU_QA_SPEC.json` içindedir.

## 4. Semantic Fact Graph

Her aday için:
- category
- topicFamily
- scope
- subject
- askedProperty
- correctAnswer
- factCluster
- precisionRequired

Duplicate signature:
`subject + askedProperty + correctAnswer`

Aynı fact yalnız cümle değiştirilerek tekrar sorulamaz.
Ters yönlü soru aynı bilgiyi sömürüyorsa aynı factCluster kabul edilir.

Hard:
- aynı quizde aynı factCluster = RED
- mevcut havuzla aynı semantic signature = RED
- mevcut havuzla aynı live factCluster = RED

## 5. Answer-Leakage Graph

Hard-fail:
- başka stem doğru cevabı açıkça söylüyor,
- başka stem cevabı semantik olarak çözdürüyor,
- A→B / B→A ters soru,
- yakın özellik soruları birbirini çözdürüyor,
- seçenekler başka soruya güçlü cevap ipucu oluşturuyor.

Otomatik tool yalnız mekanik leakage adaylarını işaretleyebilir; nihai semantik leakage review zorunludur.

## 6. Question Form Diversity

Kullanılabilir formlar:
- direct_identification
- relationship
- chronology
- comparison
- classification
- cause_effect
- light_inference
- approximation_or_range
- visual_recognition

Hard kota yoktur.
Tek formun bariz monoculture oluşturması kalite uyarısıdır.
Trick question = RED.

## 7. Topic Diversity & Saturation

Hard:
- aynı factCluster: max 1/quiz
- aynı Topic Family: max 2/quiz
- aynı Topic Family art arda gelemez

Soft:
- kategori çeşitliliğini artır
- sabit kategori sırası kullanma
- son 5 Genel Kültür quizinde aşırı kullanılan Topic Family'lere novelty penalty uygula

## 8. Çeldirici ve Cue / Guessability

- seçenekler aynı semantik sınıfta olmalı,
- gramer paralel olmalı,
- saçma çeldirici kullanılmamalı,
- `Hepsi/Hiçbiri` varsayılan değildir,
- doğru cevap benzersiz teknik/uzun/açıklayıcı görünmemeli,
- stem-option lexical echo kontrol edilir,
- sayısal görsel desen kontrol edilir.

Tercih:
- max/min seçenek kelime oranı <= 3
- batch genelinde benzersiz-en-uzun doğru cevap oranı hedef <= %10

Soft ihlal otomatik RED değildir; editoryal review gerektirir.

## 9. Doğru Şık Dağılımı

10 soruda:
- A/B/C/D her biri en az 1 kez,
- tek pozisyon en fazla 5 kez,
- sabit 3/3/2/2 şablonu yok,
- RNG quiz bazında bağımsız.

## 10. Duplicate Retrieval — Güncel Kural

YQ133+ için bütün geçmiş JSON havuzunu baştan okumak varsayılan yöntem değildir.

Sıra:
1. semantic manifest/Bloom route,
2. exact normalized stem,
3. semantic signature,
4. factCluster,
5. subject + askedProperty,
6. subject/answer/retrievalKeys,
7. topic fallback,
8. legacy corpus için hedefli repository search,
9. dönen adaylarda fuzzy + semantic review.

Legacy corpus:
- QZ001–QZ007
- YQ001–YQ132

Legacy için tam semantic backfill zorunlu değildir; fakat hedefli exact/fuzzy/semantic kontrol zorunludur.

Fuzzy stem review threshold: >= 0.84.
Fuzzy eşleşme otomatik duplicate hükmü değil, zorunlu review sinyalidir.

## 11. Gerçeklik ve Kaynak

- Zamana bağlı/değişebilir bilgi güncel kaynaktan doğrulanır.
- Mümkünse birincil/resmî kaynak tercih edilir.
- Birden fazla savunulabilir doğru cevap = RED.
- “ilk/en büyük/en eski” gibi scope belirsiz sorulardan kaçınılır.
- `answerInfo` içindeki olgular da soru kadar doğrulanabilir olmalıdır; değişebilir bilgi içeriyorsa güncel kaynak kontrolü zorunludur.
- `answerInfo` cevap anahtarını tekrar etmekle yetinmemeli; kısa açıklama, bağlam veya ilgili fun-fact sağlamalıdır.
- Kaynak doğrulaması runtime JSON içine kaynak alanı eklemeyi zorunlu kılmaz.
- Değişebilir bilgi için kalıcı kaynak notu gerekiyorsa `QUIZSEL_SOURCE_NOTE_TEMPLATE.md` ile soru-bazlı izlenebilirlik kullanılır.

## 12. Üretim Sırası

1. `quiz-index.json` oku, yeni kodları belirle.
2. Son 5 production quiz topic doygunluğunu çıkar.
3. Geniş aday bankası üret.
4. Semantic Fact Graph metadata üret.
5. Precision Burden uygula; P3'ü ele/rewrite et.
6. Semantic index query ile geçmiş adaylarını daralt.
7. Legacy targeted search yap.
8. Exact/fuzzy/semantic duplicate review yap.
9. Category + Topic Family + Question Form çeşitliliğiyle quizleri kur.
10. Answer-Leakage Graph kontrolü yap.
11. Cue / Guessability QA yap.
12. Cevap pozisyonlarını RNG ile ata.
13. Her soru için 1–3 cümlelik `answerInfo` yaz; doğru cevabı açıkla veya ilgili, doğrulanabilir bir fun-fact ekle.
14. Soru ve `answerInfo` içindeki değişebilir gerçekleri kaynakla doğrula.
15. Quiz JSON + index + semantic batch oluştur.
16. Semantic index `apply`.
17. `quiz-qa-tool.mjs check ...`.
18. `quiz-semantic-index-tool.mjs validate-target ... --source`.
19. Tüm hard kapılar PASS olmadan teslim etme.

## 13. Teknik JSON Kabul Kriterleri

YQ133+:
- `schemaVersion = 2`
- canonical code `YQxxx`
- display code `Y.Qxxx`
- tam 10 soru
- her soruda 4 benzersiz seçenek
- `answer = 0..3`
- `time = 20`
- `questionType = multiple-choice`
- question id benzersiz
- `quiz-index.json` kaydı tam 1 kez
- JSON parse PASS

YQ253+:
- her soruda `answerInfo` zorunlu,
- `answerInfo` 1–3 cümle, en fazla 500 karakter,
- bilgi doğru cevabı açıklamalı veya soruyla doğrudan ilişkili bir fun-fact vermeli,
- user-visible `answerInfo` değişirse quiz `version` artırılmalı.

YQ001–YQ252 backward compatibility için `answerInfo` olmadan çalışmaya devam eder; Bilgi Canavarı ekranı bu sorularda açıkça fallback mesajı gösterir.

Image yoksa canonical alanlar:
- `image: null`
- `imageAlt: null`
- `imageCredit: null`
- `imagePosition: "top"`
- `imageFit: "cover"`

## 14. QA Kapıları

Hard:
- JSON/schema
- index integrity
- exact duplicate
- semantic signature/fact duplicate
- fuzzy >=0.84 adaylarının review edilmesi
- leakage review
- P3 yok
- tek savunulabilir doğru
- doğru şık dağılımı
- Topic Family adjacency/max2
- current-info source review
- YQ253+ `answerInfo` varlığı / 1–3 cümle teknik kontrolü / editoryal gerçeklik kontrolü
- semantic source-sync

Soft:
- kategori çeşitliliği
- form çeşitliliği
- son-5 saturation
- unique-longest-correct
- option length ratio
- cue anomalileri
- P0/P1/P2 dağılımı

## 15. Otomasyon ve Değişiklik Politikası

Yeni kural mevcut hard kapıları sessizce zayıflatamaz.
Manuel ve `QUIZSEL_SORU_QA_SPEC.json` senkron tutulur.

Repository health otomasyonu:
- `quiz-qa-tool.mjs`
- `quiz-semantic-index-tool.mjs`
- `.github/workflows/quizsel-health.yml`

Otomatik tool'un PASS vermesi semantik/editoryal değerlendirmeyi ortadan kaldırmaz.

## 16. Incremental Semantic Index

### 16.1 Source of truth

Quiz JSON authoritative'dir. Soru metni, seçenekler, doğru cevap ve `answerInfo` aynı authoritative quiz dosyasında yaşar.
Semantic index:
- authoring/QA lookup hızlandırıcısı,
- runtime kaynağı değildir,
- public product backend yerine geçmez,
- `answerInfo` metnini indekslemez; bu alan runtime sunum içeriğidir ve duplicate/fact graph kaynağı değildir.

### 16.2 Coverage

Full semantic indexing `YQ133` ile başlar.
Her YQ133+ soru semantic entry alır.

### 16.3 Sharding

30 quiz / shard:
- YQ133–YQ162
- YQ163–YQ192
- YQ193–YQ222
- ...

Manifest:
`QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`

Shard:
`semantic-index/shards/YQ{start}-YQ{end}.json`

### 16.4 Entry alanları

En az:
- id
- quizCode
- questionId
- stem
- correctAnswer
- category
- topicFamily
- scope
- subject
- askedProperty
- factCluster
- questionForm
- precisionRequired
- retrievalKeys
- status

`semanticSignature` tool tarafından türetilir.

### 16.5 Bloom routing

Typed tokenlar:
- stem
- signature
- fact
- subject+property
- subject
- answer
- retrieval key

False positive kabul edilir.
False negative kabul edilmez.

### 16.6 Atomiklik

`apply` / `replace`:
- tüm input/source/duplicate doğrulaması önce,
- disk mutation sonra,
- hata varsa mevcut index değiştirilmez.

`remove-quiz`:
- entry'leri kaldırır,
- shard boşaldıysa manifest kaydını ve fiziksel shard dosyasını birlikte kaldırır.

### 16.7 Coverage completeness

Bir quiz “complete” sayılmak için index entry sayısının source `YQxxx.json` içindeki gerçek `questions.length` değeriyle eşleşmesi gerekir.
Soru sayısı tool içinde sabit `10` varsayımına bağlanmaz.

### 16.8 Validation modları

Tam audit:
`node quiz-semantic-index-tool.mjs validate --source`

Hedef shard:
`node quiz-semantic-index-tool.mjs validate-target YQ223 --source`

Query:
`node quiz-semantic-index-tool.mjs query QUERY.json`

### 16.9 Kullanıcı işi

Kullanıcı semantic index'i elle güncellemez.
Yeni quiz teslimi quiz JSON + `quiz-index.json` + semantic index güncellemesini birlikte taşır.
