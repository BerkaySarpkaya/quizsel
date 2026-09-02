# Quizsel Semantic Index Protocol — v2.1 Tool Policy

Authoritative soru kaynağı quiz JSON dosyalarıdır. Semantic index yalnız authoring/QA retrieval katmanıdır.

## Kapsam

- Legacy: QZ001–QZ007 + YQ001–YQ132
- Full semantic: YQ133+
- Shard: 30 quiz
- Manifest: `QUIZSEL_SEMANTIC_INDEX_MANIFEST.json`
- Tool: `quiz-semantic-index-tool.mjs`

## Yeni quiz

1. Quiz JSON ve `quiz-index.json` hazırlanır.
2. Semantic batch bütün source soruları kapsar.
3. `node quiz-semantic-index-tool.mjs query QUERY.json` ile geçmiş adayları daralt.
4. Legacy targeted search ayrıca yapılır.
5. `node quiz-semantic-index-tool.mjs apply BATCH.json`
6. `node quiz-semantic-index-tool.mjs validate-target YQxxx --source`
7. `node quiz-qa-tool.mjs check YQxxx.json`
8. Commit.

## Replace

Quiz sorusu değişirse semantic source kaydı da aynı teslimde değiştirilir:

```bash
node quiz-semantic-index-tool.mjs replace BATCH.json
```

## Remove

```bash
node quiz-semantic-index-tool.mjs remove-quiz YQxxx
```

Quiz shard içindeki son entry grubuyduysa tool:
- manifest shard kaydını kaldırır,
- fiziksel boş shard dosyasını da atomik transaction kapsamında kaldırır.

## Validation

Tam audit:

```bash
node quiz-semantic-index-tool.mjs validate --source
```

Hedef shard:

```bash
node quiz-semantic-index-tool.mjs validate-target YQ223 --source
```

Hedef validation yeni batch tesliminde tercih edilir; tam validation CI/audit sırasında kullanılabilir.

## Coverage

Coverage artık `10 soru` sabitine bağlı değildir.
Bir quiz ancak:

`indexed entry count == source YQxxx.json questions.length`

ise complete sayılır.

## Atomiklik

Apply/replace/remove:
- mutation öncesi validation,
- temp + backup,
- commit,
- hata durumunda rollback

mantığıyla çalışır.

## Node

Minimum Node 18; önerilen Node 20 LTS.

## Kullanıcı işi

Semantic index elle düzenlenmez.
