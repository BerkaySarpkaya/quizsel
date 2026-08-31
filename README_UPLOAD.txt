QUIZSEL v0.9.1 — CACHE-SAFE FLOW FIX

GitHub repo ROOT dizininde bu 3 dosyayı birlikte yükle:
- index.html          -> mevcut dosyanın üstüne yaz
- config.js           -> mevcut dosyanın üstüne yaz
- app-flow-v091.js   -> mevcut dosyanın üstüne yaz

Bu paket özellikle cache riskini kapatır:
- index.html -> config.js?v=93
- config.js -> app-flow-v091.js?v=92
- final buton metni HTML içinde doğrudan "Ana sayfaya dön"

Başka dosyaya dokunma.
