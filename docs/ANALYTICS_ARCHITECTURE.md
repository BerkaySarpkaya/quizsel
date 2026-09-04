# Quizsel Durable Analytics Architecture — v0.12.1

## Amaç

Quizsel'in canlı oyun verisi ile uzun dönem analiz verisi birbirinden ayrıdır.

- `games/{pin}`: canlı yarışın operasyonel state'i.
- `matchArchive/{matchId}`: terminal maça ait kalıcı, create-only snapshot.
- `analyticsDepartures/{room}/{createdAt}/{eventId}`: oyuncu canlı state'ten silinmeden hemen önce alınan kalıcı snapshot.
- `profiles/{uid}/stats`, `quizHistory`, `finalReceipts`: kullanıcı deneyimi / hızlı özet; analitik ham verinin yerine geçmez.
- `activityLogs`: observability / legacy history; analitik ham verinin yerine geçmez.

`matchArchive` ve `analyticsDepartures` için otomatik retention veya trimming yoktur.

## Neden ayrı arşiv?

Canlı `games/` ağacında oyuncu ayrılırken/kicklenirken player veya answer verileri silinebilir; host tek başına ayrılırsa, yarışma sonlandırılırsa veya admin odayı kapatırsa bütün oda silinebilir. Bu davranış canlı oyun için doğrudur fakat analitik kaynak olarak güvenli değildir.

v0.12 bu nedenle canlı state'i değiştirmek yerine terminal snapshot üretir.

## Match kimliği

Deterministik kimlik:

```text
{room}_{createdAt}
```

Oda PIN'i daha sonra tekrar kullanılsa bile `createdAt` çakışmayı önler. Firebase Rules aynı `matchId` kaydının ikinci kez değiştirilmesine veya silinmesine izin vermez.

## Kalıcı maç snapshot'ı

`matchArchive/{matchId}` özet olarak şunları taşır:

- schema / runtime sürümleri,
- room, createdAt, startedAt, endedAt, archivedAt,
- terminal status ve reason,
- host kimliği,
- quiz code/title/category/difficulty/version/schemaVersion,
- quiz SHA-256 fingerprint (WebCrypto yoksa açıkça işaretli fallback),
- her soru için compact truth reference: question id, correct answer index, süre, tip, option count,
- tüm oyuncuların UID/name, join zamanı, client version, skor, toplam süre, rank/outcome,
- oyuncu bazında her cevap: choice, correct, points, elapsedMs, answeredAt,
- cevap official scoring ile finalize edilmemişse `derived_snapshot` işareti,
- player-level accuracy / average response time,
- question-level eligible/answered/correct/wrong/unanswered, option distribution ve average response time,
- match-level toplamlar ve winner.

Tam soru metni ve seçenekler her maçta tekrar kopyalanmaz. Quiz source Git geçmişinde/versioned source'ta tutulur; snapshot `quiz.version` + fingerprint ile hangi içerikle oynandığını sabitler. Quiz içeriğinde anlamlı değişiklik yapılırken `version` artırılmalıdır.

v0.13 `answerInfo` Bilgi Canavarı sunum içeriğidir ve match archive içine ayrıca kopyalanmaz. `quiz.version` fingerprint payload’ının parçası olduğundan `answerInfo` değişikliğinde version artırılması zorunludur; böylece aynı soru/cevap yapısı korunurken post-quiz içerik değişikliği de farklı quiz sürümü olarak izlenir.

## Ayrılan / kicklenen oyuncular

Mevcut runtime ayrılma yollarında canlı cevaplar silinebildiği için v0.12, silme işleminden **önce** `analyticsDepartures` event'i oluşturur.

Event:

- immutable/create-only'dir,
- canlı player alanlarının kopyasını,
- o ana kadarki cevaplarını,
- phase/state bilgisini,
- `left`, `kicked`, `host_left_transferred` gibi reason bilgisini taşır.

Firebase Rules bu snapshot'ın player ve answer değerlerini canlı `games/` state'iyle karşılaştırır. Böylece sıradan kullanıcı kendi departure kaydına keyfi skor/cevap yazamaz.

Bir oyuncu lobiden ayrılıp tekrar katılırsa birden fazla immutable departure event'i olabilir. Terminal archive aktif player state'ini son durum olarak kullanır, eski event'leri audit trail olarak korur.

## Terminal yollar ve veri kaybı politikası

### Normal final

Host final state'i gördüğünde `matchArchive` yazılır. Yazma ağ yüzünden başarısız olursa küçük bir local pending marker saklanır ve auth restore / online / foreground durumlarında tekrar denenir. Normal `ended` oyun zaten Firebase'de kaldığı için kaynak veri retry sırasında yeniden okunabilir.

### Veri silen işlemler

Aşağıdaki işlemler analytics snapshot başarıyla yazılmadan devam etmez:

- son oyuncu/host odadan ayrılıyor ve oda silinecekse,
- host yarışmayı sonlandırıyorsa,
- admin aktif odayı kapatıyorsa,
- oyuncu kicklenmeden önce departure snapshot alınamıyorsa,
- oyuncu ayrılmadan önce departure snapshot alınamıyorsa.

Bu kasıtlı fail-closed davranıştır: analytics altyapısı erişilemiyorsa uygulama sessizce veri silmez.

## Legacy ended-game backfill

Admin v0.12 sonrasında giriş yaptığında, `games/` altında hâlâ duran `state="ended"` eski oyunlar create-only `matchArchive` içine best-effort backfill edilir.

Sistem daha önce fiziksel olarak silinmiş eski terminate/leave kayıtlarını sihirli biçimde geri oluşturamaz. Backfill yalnız Firebase'de hâlâ mevcut ham oyunlar için mümkündür.

## Veri bilimi için neden ham data tutuluyor?

Profilde binlerce türetilmiş aggregate tutmak yerine ham cevap düzeyi veri saklanır. Daha sonra offline/warehouse analizinde yeniden üretilebilir:

- soru güçlüğü / discrimination,
- distractor seçilme oranları,
- cevap süresi dağılımları,
- quiz/category performansı,
- oyuncu gelişimi,
- first-seen vs repeat exposure etkisi,
- speed vs accuracy ilişkisi,
- dropout / termination davranışı,
- rekabet yoğunluğu ve skor farkları.

Ham data source-of-truth; türetilmiş dashboard tabloları ileride rebuild edilebilir.

## Güvenlik sınırı

Arşiv normal oyuncular tarafından topluca okunamaz; admin tüm archive'ı okuyabilir. Host yalnız kendi canlı odasına ait mevcut archive kaydını idempotency kontrolü için okuyabilir.

Bu yine browser-client mimarisidir. Host oyun state'ini yönettiği için mutlak anti-tamper analitik ancak gelecekte server-side scoring/backend migration ile sağlanabilir. Bu sınır `docs/SECURITY_ARCHITECTURE.md` içinde ayrıca tanımlıdır.

## Firebase Rules deployment zorunluluğu

`database.rules.json` GitHub'a yüklenince Firebase Realtime Database'e otomatik uygulanmaz. Repo'da Firebase Rules deploy pipeline'ı yoktur.

v0.12 production'a alınırken yeni `database.rules.json` Firebase Realtime Database **Rules** ekranında ayrıca publish edilmelidir. Güvenli sıra:

1. Yeni `database.rules.json` kurallarını Firebase'de publish et.
2. Sonra GitHub/Pages runtime dosyalarını yükle.
3. GitHub Health PASS kontrol et.
4. İki oyunculu test maçı oyna.
5. Firebase'de `matchArchive/{matchId}` ve gerekli ise `analyticsDepartures/...` oluştuğunu admin olarak doğrula.

Kurallar deploy edilmeden runtime deploy edilirse normal final arşivi retry'ya kalır; veri silen işlemler fail-closed biçimde engellenir.

## Bilinen gözlem sınırı

v0.12 explicit `leave`, host transfer leave ve `kick` yollarını kaydeder. Normal oyuncular için ayrı presence/heartbeat modeli henüz yoktur; bir oyuncu sekmeyi/cihazı kapatıp canlı player kaydı Firebase'de kalırsa sistem bunu kesin bir "disconnect/dropout" olayı olarak ayırt edemez. Bu durumda terminal snapshot oyuncuyu roster'da aktif fakat cevapsız görebilir. Gelecekte gerçek disconnect analizi istenirse player-presence telemetry ayrı bir sürüm olarak eklenmelidir.

`matchArchive` üzerinde `createdAt`, `terminalStatus` ve `quiz/code` indexleri tanımlıdır; binlerce maçta tarih/sonuç/quiz bazlı admin export veya backend sorguları için temel ölçekleme zemini hazırdır.
