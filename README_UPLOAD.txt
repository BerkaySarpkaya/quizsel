QUIZSEL v0.9.2 — QUIZ SET / FOLDER BROWSER

GitHub repo ROOT dizinine bu 4 dosyayı birlikte yükle:

1) index.html
   - mevcut dosyanın üstüne yaz
   - config cache anahtarı v=94
   - yeni quiz-set CSS dosyasını yükler

2) config.js
   - mevcut dosyanın üstüne yaz
   - mevcut load order korunur:
     app.js -> app-v09-performance.js -> app-flow-v091.js -> app-quizsets-v092.js

3) app-quizsets-v092.js
   - YENİ DOSYA
   - Quiz seçme ekranını klasör/set görünümüne çevirir
   - 12'şerli lazy rendering korunur

4) styles-quizsets-v092.css
   - YENİ DOSYA
   - sadece quiz-set / folder UI stilleri

GRUPLAMA KURALI
- Draft Quiz Set:
  Y.Q001–Y.Q102 + eski QZ quizleri
- First Set:
  Y.Q103–Y.Q132
- Second Set:
  Y.Q133–Y.Q162
- Third Set:
  Y.Q163–Y.Q192
- Sonraki her 30 quiz otomatik sonraki sete gider.

ÖNEMLİ
Aşağıdaki dosyalara DOKUNULMADI:
- app.js
- app-v09-performance.js
- app-flow-v091.js
- styles.css
- quiz-index.json
- database.rules.json
- mevcut quiz JSONları

Dolayısıyla:
- herkes cevap verince erken reveal,
- reveal sonrası 3 -> 2 -> 1,
- finalde logout olmadan ana sayfaya dönüş
akışları korunur.
