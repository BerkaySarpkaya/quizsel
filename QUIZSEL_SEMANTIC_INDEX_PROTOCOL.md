# Quizsel Sharded Incremental Semantic Index — Operasyon Protokolü v2

Authoritative soru politikası `QUIZSEL_SORU_URETIM_MANUELI.md` içindedir.

## Coverage
- Legacy: QZ001–QZ007 + YQ001–YQ132.
- Tam semantic indexing: YQ133 ve sonrası.
- Legacy backfill zorunlu değildir; targeted repository search + source review kullanılır.

## Dosya mimarisi
- `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`: global küçük manifest.
- `semantic-index/shards/YQxxx-YQyyy.json`: 30 quizlik entry shard'ları.
- Tek dev semantic-index JSON dosyası kullanılmaz.

## Her yeni batch
1. `quiz-index.json`, base QA spec, semantic manifest ve index spec okunur.
2. Adaylara semantic metadata atanır.
3. Manifest Bloom yönlendirmesiyle olası semantic shard'lar seçilir.
4. Seçilen shard entries + legacy targeted search ile duplicate QA yapılır.
5. Leakage/topic/cue/precision QA uygulanır.
6. Final quiz JSON'ları oluşturulur.
7. Semantic batch `apply` edilir; tool quiz JSON ile source sync kontrolü yapar.
8. `validate` PASS alınır.
9. Güncel manifest + yalnız değişen/yeni shard'lar quiz paketiyle teslim edilir.

## Fail-safe
`apply`/`replace` batch'i tamamen validate etmeden mevcut dosyalara commit etmez.
Geçersiz işlem mevcut semantic index durumunu değiştirmemelidir.

## Source of truth
Quiz JSON authoritative'dir. Semantic index hızlandırıcı/QA ledger'ıdır.
Index ile quiz JSON çelişirse işlem FAIL olur.

## Revision / deletion
- Quiz sorusu düzenlenirse `replace` ile aynı entry ID güncellenir.
- Quiz silinirse `remove-quiz YQxxx` uygulanır.
- Git geçmişi revision audit trail olarak yeterlidir; index içinde eski revision kopyaları tutulmaz.
