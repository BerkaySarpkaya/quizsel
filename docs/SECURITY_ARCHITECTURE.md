# Quizsel Question Privacy / Backend Migration Boundary

## Mevcut durum

Mevcut GitHub Pages runtime'ı quiz dosyasını tarayıcıdan:

```text
fetch("YQxxx.json")
```

ile yükler.

Bu nedenle kullanıcı DevTools/Network üzerinden o quizin tarayıcıya gönderilen içeriğini görebilir.
Repo'nun private olması, Pages üzerinde yayınlanan asset'leri otomatik olarak gizli yapmaz.

Semantic shard'lar da authoring içindir ve `correctAnswer` içerir. Public production artifact'ında uzun vadede yer almamalıdır.

## Hedef güvenli mimari

```text
Private question store
        |
Server-side Firebase Function / backend
        |
Current-question payload only
        |
Browser
```

Browser'a soru aşamasında:
- soru metni
- seçenekler
- görsel metadata
- question id

gönderilir.

Browser'a reveal öncesi:
- doğru cevap index'i
- gelecek sorular
- bütün quiz JSON'u

gönderilmez.

Scoring ve answer truth server-side olmalıdır.

## Deployment separation

Uzun vadede üç artifact ayrılmalıdır:

### 1. Authoring repository
- quiz source
- semantic shards
- QA metadata
- source notes

### 2. Public frontend artifact
- HTML
- CSS
- client JS
- public quiz metadata

### 3. Private backend data
- soru metinleri
- seçenekler
- doğru cevaplar
- entitlement/premium mapping

## Bu health paketinde ne yapıldı?

- Bu sınır authoritative dokümana işlendi.
- Public statik yapının “gizli” olmadığı açıklandı.
- Runtime reliability ve QA geliştirildi.

## Bu health paketinde ne yapılmadı?

Backend migration **aktif edilmedi**.
Bunun nedeni migration'ın yalnız GitHub'a dosya yükleyerek tamamlanamamasıdır; Firebase Functions/private store deploy ve veri taşıma gerekir.

`database.rules.json` da bu paket kapsamında değiştirilmemiştir.
