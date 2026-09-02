# Quizsel

Quizsel, aynı odadaki oyuncuların aynı soruları eşzamanlı cevapladığı, Firebase Authentication + Realtime Database kullanan web tabanlı quiz uygulamasıdır.

## Güncel production mimarisi

Tarayıcı çalışma sırası:

1. `index.html`
2. `config.js`
3. `app.js` — temel uygulama
4. `app-v09-performance.js` — performans / split-listener katmanı
5. `app-v010-runtime.js` — güncel yarış akışı, reliability guard'ları ve quiz-set tarayıcısı

`app-v010-runtime.js` v0.9.1 yarış-akışı patch'ini ve v0.9.2 quiz-set browser davranışını tek güncel runtime katmanında birleştirir.

> `database.rules.json` bu health paketinde değiştirilmemiştir.

## Güncel yarış akışı

- Soru süresi: 20 saniye.
- Tüm aktif oyuncular cevapladıysa host Firebase üzerinden tekrar doğrular ve reveal erken yapılır.
- Erken-doğrulama isteği hata verirse normal soru deadline fallback'i korunur; oyun askıda kalmaz.
- Reveal süresi: 5 saniye.
- Son soru değilse reveal sonrası `Diğer soruya geçiliyor` ekranında 3 → 2 → 1 gösterilir.
- Son soruda doğrudan finale gidilir.
- Final kaydı başarılı olmadan oda state'i temizlenmez.
- Finalden `Ana sayfaya dön` Firebase oturumunu kapatmaz.

## Quiz kodları ve setler

Legacy:
- `QZ001`–`QZ007`
- `YQ001`–`YQ102` → Draft Quiz Set

Production setleri:
- `YQ103`–`YQ132` → First Set
- `YQ133`–`YQ162` → Second Set
- `YQ163`–`YQ192` → Third Set
- devamında her 30 quiz otomatik yeni sete gider.

Görünen kod `Y.Q223` olabilir; canonical runtime/file kodu `YQ223` biçimindedir.

## Yeni quiz üretimi

Authoritative kalite sözleşmeleri:

- `QUIZSEL_SORU_URETIM_MANUELI.md`
- `QUIZSEL_SORU_QA_SPEC.json`
- `QUIZSEL_SEMANTIC_INDEX_SPEC.json`
- `QUIZSEL_SEMANTIC_INDEX_PROTOCOL.md`

YQ133 ve sonrasında her soru semantic index kaydına sahip olmalıdır. Quiz JSON dosyası soru metni ve doğru cevap için authoritative kaynaktır; semantic index authoring/QA hızlandırıcısıdır.

Önerilen akış:

```text
quiz-index.json oku
→ yeni YQ kodlarını belirle
→ geçmiş duplicate/fact adaylarını semantic index ile daralt
→ yeni quiz JSON'larını üret
→ semantic batch oluştur
→ semantic index apply
→ quiz QA
→ source-sync validate
→ commit
```

## Yerel QA komutları

Node.js 20 LTS önerilir.

```bash
node --check app.js
node --check app-v09-performance.js
node --check app-v010-runtime.js
node --check quiz-semantic-index-tool.mjs
node --check quiz-qa-tool.mjs

node quiz-qa-tool.mjs repo
node quiz-semantic-index-tool.mjs validate --source
```

Yeni/değişen quizler için:

```bash
node quiz-qa-tool.mjs check YQ223.json YQ224.json
node quiz-semantic-index-tool.mjs validate-target YQ223 --source
```

GitHub Actions içindeki `Quizsel Health` workflow'u push/PR sırasında aynı temel kapıları otomatik çalıştırır.

## Runtime quiz doğrulaması

Güncel runtime, quiz JSON'unu yalnız `code + questions var mı` seviyesinde kabul etmez. YQ133+ için ayrıca:

- canonical code eşleşmesi,
- schemaVersion 2,
- tam 10 soru,
- benzersiz question id,
- tam 4 benzersiz seçenek,
- `answer` 0..3,
- `time = 20`,
- `questionType = multiple-choice`

kontrol edilir. Bozuk production quiz oyun açılmadan reddedilir.

## Semantic index

Semantic index sharded'dır. Her shard 30 quizlik blok taşır:

```text
semantic-index/shards/YQ133-YQ162.json
semantic-index/shards/YQ163-YQ192.json
semantic-index/shards/YQ193-YQ222.json
...
```

Manifest:

`QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`

Tool:

`quiz-semantic-index-tool.mjs`

Tool artık boşalan shard'ı fiziksel olarak da kaldırır, quiz completeness hesabını source JSON'daki gerçek soru sayısından üretir ve hedef-shard doğrulaması destekler.

## Soru gizliliği hakkında kritik not

Mevcut production runtime statik quiz JSON'larını tarayıcıya yükler. Bu nedenle GitHub repo private yapılsa bile GitHub Pages üzerinde deploy edilen quiz dosyaları kullanıcı tarafından görülebilir.

Aynı şekilde semantic shard'lar authoring verisidir ve `correctAnswer` taşır; gerçek ücretli/gizli soru mimarisinde public web artifact'ına dahil edilmemelidir.

Hedef backend mimarisi `docs/SECURITY_ARCHITECTURE.md` içinde tanımlıdır. Bu repo-health paketi backend migration'ını **aktif etmez**.

## Firebase

- Authentication: Email/Password
- Realtime Database: canlı oda/state
- Firebase browser config'in frontend'de görünmesi normaldir.
- Yetkilendirme güvenliği `database.rules.json` ve ileride server-side backend sınırına bağlıdır.

Bu health sürümünde Firebase Rules bilinçli olarak değiştirilmemiştir.

## Authoritative dosya prensibi

- Runtime soru kaynağı: `YQxxx.json` / `QZxxx.json`
- Quiz listesi: `quiz-index.json`
- Soru üretim standardı: `QUIZSEL_SORU_URETIM_MANUELI.md`
- Makine-okunabilir QA standardı: `QUIZSEL_SORU_QA_SPEC.json`
- Semantic index sözleşmesi: `QUIZSEL_SEMANTIC_INDEX_SPEC.json`
- Semantic coverage/yönlendirme: `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`

Eski upload notları ve batch'e özel QA/source raporları authoritative kabul edilmez.
