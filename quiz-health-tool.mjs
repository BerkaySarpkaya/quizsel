#!/usr/bin/env node
// Quizsel Health Tool v1.0
// -----------------------------------------------------------------------------
// Corpus-wide health auditing for the quiz pool.
//
// quiz-qa-tool.mjs enforces the per-file contract and, in `check` /
// `check-changed` mode, compares a CHANGED file against the historical stem
// pool. Nothing runs a corpus-wide sweep on every push, so debt that entered
// the pool before a gate existed stays invisible: `repo` mode reports PASS
// while the pool holds exact duplicate stems.
//
// This tool closes that hole.
//
//   node quiz-health-tool.mjs audit      full report -> markdown + json
//   node quiz-health-tool.mjs gate       hard gates for CI (baseline-aware)
//   node quiz-health-tool.mjs baseline   rewrite the accepted-debt baseline
//
// The baseline is a ratchet: existing violations are recorded once so CI does
// not turn red on legacy debt, while any NEW violation fails the build. Fixing
// debt shrinks the baseline; it can never silently grow.
// -----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const INDEX_FILE = "quiz-index.json";
const MANIFEST_FILE = "QUIZSEL_SEMANTIC_INDEX_MANIFEST.json";
const SHARD_DIR = path.join("semantic-index", "shards");
const BASELINE_FILE = "QUIZSEL_QA_BASELINE.json";
const REPORT_MD = path.join("docs", "QUIZSEL_HEALTH_REPORT.md");
const REPORT_JSON = "quizsel-health-findings.json";

// Manual v2.5 thresholds.
const FUZZY_REVIEW = 0.84;          // §10 fuzzy stem review threshold
const SEMANTIC_SUSPECT = 0.45;      // same answer + this overlap -> review
const ANSWERINFO_MIN = 24;          // §17 backfill technical bound
const ANSWERINFO_MAX = 500;         // §13
const ANSWERINFO_SENTENCES = 3;     // §13 1-3 sentences
const NOVELTY_DEGENERATE = 2;       // <= this many new content tokens = restatement
const NOVELTY_WEAK = 5;             // <= this many = thin
const OPTION_RATIO_MAX = 3.0;       // §8 max/min option word count
const ANSWER_POS_MAX = 5;           // §9 one position at most 5 of 10
const FIRST_INDEXED_QUIZ = 133;     // §16.2 full semantic indexing starts here

// -----------------------------------------------------------------------------
// text helpers
// -----------------------------------------------------------------------------

const TR_MAP = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
                 "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
                 "â": "a", "î": "i", "û": "u", "’": "'", "‘": "'", "“": '"', "”": '"' };

function fold(s) {
  return String(s ?? "").replace(/[ıİşŞğĞüÜöÖçÇâîû’‘“”]/g, ch => TR_MAP[ch] ?? ch);
}

function norm(s) {
  return fold(s).toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Function words plus the scaffolding that every Turkish quiz stem carries.
// These are stripped before measuring how much NEW information an answerInfo
// adds, so "X, Y tarafindan yazilmistir" scores as the restatement it is.
const STOP = new Set(`
ama ancak arasinda arasindaki ait aittir adi adiyla adli altinda anlaminda
baglar bagli baglidir baslayan bilinen bir birinci biri bu bunlardan bunun
buyuk cok da de daha dahil dir edilen edilir eden eserdir eseri eserin
gecer gecen gelen gelir gibi gore hangi hangisi hangisidir her icin iki
ile ilgili iliskili iliskilidir isim ismi kabul kadar kimdir kimin
nedir olan olarak olup once onemli ortaya sahip sonra su sunlardan tarafindan
uzerinde uzerine var verilen ve veya ya yani yer yil yilinda
alir bulunan bulunur dokulur gectigi konusu sayilan sayilir tanimlanan
tanimlanir yapilan yapilmis yapilmistir yazilan yazilmis yazilmistir
bestelenen bestelenmis bestelenmistir cizilen resmedilen kurulan kurulmus
kurulmustur insa insaa edilmis edilmistir dunyanin turkiyenin
`.trim().split(/\s+/));

function contentTokens(s) {
  return norm(s).split(" ").filter(t => t.length > 2 && !STOP.has(t));
}

function trigrams(s) {
  const p = ` ${s} `;
  const out = new Set();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

function jaccard(a, b) {
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function sentenceCount(s) {
  return String(s).split(/[.!?]+/).map(x => x.trim()).filter(Boolean).length;
}

function wordCount(s) {
  return norm(s).split(" ").filter(Boolean).length;
}

function quizNumber(code) {
  const m = /^YQ(\d+)$/i.exec(String(code || ""));
  return m ? Number(m[1]) : null;
}

// -----------------------------------------------------------------------------
// loading
// -----------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCorpus() {
  const index = readJson(INDEX_FILE);
  const quizzes = [];
  const questions = [];

  for (const meta of index.quizzes || []) {
    const file = String(meta.file || "");
    if (!file || !fs.existsSync(file)) continue;
    const quiz = readJson(file);
    const code = String(quiz.code || meta.code || path.basename(file, ".json"));
    const qs = Array.isArray(quiz.questions) ? quiz.questions : [];
    quizzes.push({ code, file, title: quiz.title || "", quiz, questions: qs });

    for (const q of qs) {
      const options = Array.isArray(q.options) ? q.options : [];
      const ansIdx = Number.isInteger(q.answer) ? q.answer : -1;
      const correct = ansIdx >= 0 && ansIdx < options.length ? options[ansIdx] : "";
      const nstem = norm(q.text || "");
      questions.push({
        code, file, id: q.id, ref: `${code}#${q.id}`,
        text: q.text || "", nstem, tri: trigrams(nstem),
        options, ansIdx, correct, ncorrect: norm(correct),
        answerInfo: q.answerInfo ?? null,
        time: q.time, questionType: q.questionType,
        num: quizNumber(code)
      });
    }
  }
  return { index, quizzes, questions };
}

function loadSemanticIndex() {
  const entries = new Map();
  if (!fs.existsSync(SHARD_DIR)) return entries;
  for (const f of fs.readdirSync(SHARD_DIR).filter(x => x.endsWith(".json"))) {
    const shard = readJson(path.join(SHARD_DIR, f));
    for (const [key, e] of Object.entries(shard.entries || {})) {
      entries.set(key, e);
    }
  }
  return entries;
}

// -----------------------------------------------------------------------------
// findings
// -----------------------------------------------------------------------------

const findings = [];

function add(gate, severity, fingerprint, message, extra = {}) {
  findings.push({ gate, severity, fingerprint, message, ...extra });
}

// -----------------------------------------------------------------------------
// checks
// -----------------------------------------------------------------------------

// H1 / H2 / S2 — corpus-wide stem similarity.
// Candidates come from rare trigrams only (a trigram present in more than 15%
// of stems carries no signal and would make this quadratic for nothing), then
// every candidate pair gets an exact Jaccard score.
function checkStemSimilarity(questions) {
  const N = questions.length;
  const df = new Map();
  for (const q of questions) for (const t of q.tri) df.set(t, (df.get(t) || 0) + 1);
  const maxDf = Math.max(8, Math.floor(N * 0.15));

  const buckets = new Map();
  questions.forEach((q, i) => {
    for (const t of q.tri) {
      if (df.get(t) > maxDf) continue;
      if (!buckets.has(t)) buckets.set(t, []);
      buckets.get(t).push(i);
    }
  });

  const exactGroups = new Map();
  questions.forEach(q => {
    if (!q.nstem) return;
    if (!exactGroups.has(q.nstem)) exactGroups.set(q.nstem, []);
    exactGroups.get(q.nstem).push(q);
  });

  for (const [stem, group] of exactGroups) {
    if (group.length < 2) continue;
    const refs = group.map(x => x.ref).sort();
    add("DUP_EXACT", "hard", `DUP_EXACT|${refs.join(",")}`,
        `Birebir aynı stem: ${refs.join(" ↔ ")}`,
        { stem: group[0].text, refs });
  }

  const seen = new Set();
  const fuzzy = [];
  const suspects = [];

  for (let i = 0; i < N; i++) {
    const a = questions[i];
    if (!a.nstem) continue;
    const cand = new Set();
    for (const t of a.tri) {
      if (df.get(t) > maxDf) continue;
      for (const j of buckets.get(t) || []) if (j > i) cand.add(j);
    }
    for (const j of cand) {
      const b = questions[j];
      if (a.nstem === b.nstem) continue;
      const key = `${a.ref}|${b.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sim = jaccard(a.tri, b.tri);
      if (sim >= FUZZY_REVIEW) fuzzy.push({ sim, a, b });
      else if (sim >= SEMANTIC_SUSPECT && a.ncorrect && a.ncorrect === b.ncorrect) {
        suspects.push({ sim, a, b });
      }
    }
  }

  fuzzy.sort((x, y) => y.sim - x.sim);
  for (const { sim, a, b } of fuzzy) {
    add("DUP_FUZZY", "hard", `DUP_FUZZY|${a.ref}|${b.ref}`,
        `Fuzzy stem ${sim.toFixed(2)} (>=${FUZZY_REVIEW}): ${a.ref} ↔ ${b.ref}`,
        { sim: Number(sim.toFixed(3)), a: a.text, b: b.text });
  }

  suspects.sort((x, y) => y.sim - x.sim);
  for (const { sim, a, b } of suspects) {
    add("DUP_SEMANTIC_SUSPECT", "review", `DUP_SEM|${a.ref}|${b.ref}`,
        `Aynı doğru cevap + stem örtüşmesi ${sim.toFixed(2)}: ${a.ref} ↔ ${b.ref} (cevap: ${a.correct})`,
        { sim: Number(sim.toFixed(3)), a: a.text, b: b.text, answer: a.correct });
  }
}

// H3 / H6 / S1 — answerInfo substance and technical bounds.
// The technical bounds already existed in quiz-qa-tool; what was missing is a
// measure of whether the text says anything the question did not already say.
function checkAnswerInfo(questions) {
  for (const q of questions) {
    const needsInfo = q.num !== null && q.num >= 253;
    if (q.answerInfo == null || String(q.answerInfo).trim() === "") {
      if (needsInfo) {
        add("ANSWERINFO_MISSING", "hard", `AI_MISSING|${q.ref}`,
            `YQ253+ zorunlu answerInfo eksik: ${q.ref}`);
      }
      continue;
    }

    const ai = String(q.answerInfo).trim();
    if (ai.length < ANSWERINFO_MIN || ai.length > ANSWERINFO_MAX) {
      add("ANSWERINFO_LENGTH", "hard", `AI_LEN|${q.ref}`,
          `answerInfo uzunluğu ${ai.length}, izinli aralık ${ANSWERINFO_MIN}-${ANSWERINFO_MAX}: ${q.ref}`);
    }
    const sc = sentenceCount(ai);
    if (sc < 1 || sc > ANSWERINFO_SENTENCES) {
      add("ANSWERINFO_SENTENCES", "hard", `AI_SENT|${q.ref}`,
          `answerInfo ${sc} cümle, izinli 1-${ANSWERINFO_SENTENCES}: ${q.ref}`);
    }

    const source = new Set([...contentTokens(q.text), ...contentTokens(q.correct)]);
    const tokens = contentTokens(ai);
    if (!tokens.length) continue;
    const fresh = tokens.filter(t => !source.has(t));

    if (fresh.length <= NOVELTY_DEGENERATE) {
      add("ANSWERINFO_DEGENERATE", "hard", `AI_DEGEN|${q.ref}`,
          `answerInfo soruyu/cevabı tekrar ediyor, ${fresh.length} yeni bilgi kelimesi: ${q.ref}`,
          { answerInfo: ai, question: q.text, answer: q.correct, novelTokens: fresh.length });
    } else if (fresh.length <= NOVELTY_WEAK) {
      add("ANSWERINFO_WEAK", "review", `AI_WEAK|${q.ref}`,
          `answerInfo zayıf, ${fresh.length} yeni bilgi kelimesi: ${q.ref}`,
          { answerInfo: ai, novelTokens: fresh.length });
    }
  }
}

// H4 — §9 correct-answer position distribution.
function checkAnswerDistribution(quizzes) {
  for (const qz of quizzes) {
    if (qz.questions.length !== 10) continue;
    const counts = [0, 0, 0, 0];
    for (const q of qz.questions) {
      if (Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4) counts[q.answer]++;
    }
    const missing = counts.map((c, i) => [c, i]).filter(([c]) => c === 0).map(([, i]) => "ABCD"[i]);
    if (missing.length) {
      add("ANSWER_POSITION_UNUSED", "hard", `POS_UNUSED|${qz.code}`,
          `${qz.code}: ${missing.join("/")} şıkkı hiç doğru cevap değil (dağılım ${counts.join("/")})`);
    }
    const over = counts.findIndex(c => c > ANSWER_POS_MAX);
    if (over >= 0) {
      add("ANSWER_POSITION_SKEW", "hard", `POS_SKEW|${qz.code}`,
          `${qz.code}: ${"ABCD"[over]} şıkkı ${counts[over]} kez doğru, üst sınır ${ANSWER_POS_MAX} (dağılım ${counts.join("/")})`);
    }
  }
}

// H5 / S8 / S10 / S11 — §8 cue and guessability surface.
function checkCues(quizzes, questions) {
  for (const q of questions) {
    if (q.options.length < 2) continue;
    const wc = q.options.map(wordCount).filter(n => n > 0);
    if (wc.length === q.options.length) {
      const ratio = Math.max(...wc) / Math.min(...wc);
      if (ratio > OPTION_RATIO_MAX) {
        add("OPTION_LENGTH_RATIO", "hard", `OPT_RATIO|${q.ref}`,
            `Şık uzunluk oranı ${ratio.toFixed(1)} > ${OPTION_RATIO_MAX}: ${q.ref}`,
            { options: q.options });
      }
    }

    const hasAllNone = q.options.some(o => /^(hepsi|hicbiri|hepsi de|hicbiri degil)/.test(norm(o)));
    if (hasAllNone) {
      add("OPTION_ALL_NONE", "review", `OPT_ALLNONE|${q.ref}`,
          `"Hepsi/Hiçbiri" şıkkı kullanılmış (varsayılan değil): ${q.ref}`);
    }

    const stemTokens = new Set(contentTokens(q.text));
    const echo = contentTokens(q.correct).filter(t => stemTokens.has(t));
    const distractorEcho = q.options
      .filter((_, i) => i !== q.ansIdx)
      .some(o => contentTokens(o).some(t => stemTokens.has(t)));
    if (echo.length && !distractorEcho) {
      add("STEM_OPTION_ECHO", "review", `ECHO|${q.ref}`,
          `Doğru şık stem ile kelime paylaşıyor, çeldiriciler paylaşmıyor (${echo.join(",")}): ${q.ref}`);
    }
  }

  for (const qz of quizzes) {
    let uniqueLongest = 0;
    for (const q of qz.questions) {
      const opts = Array.isArray(q.options) ? q.options : [];
      if (!Number.isInteger(q.answer) || opts.length < 2) continue;
      const lens = opts.map(o => String(o).length);
      const max = Math.max(...lens);
      if (lens[q.answer] === max && lens.filter(l => l === max).length === 1) uniqueLongest++;
    }
    if (qz.questions.length && uniqueLongest / qz.questions.length > 0.30) {
      add("UNIQUE_LONGEST_CORRECT", "review", `LONGEST|${qz.code}`,
          `${qz.code}: ${uniqueLongest}/${qz.questions.length} soruda doğru şık benzersiz en uzun seçenek`);
    }
  }
}

// S3 — answer concentration across the whole pool.
function checkAnswerRepetition(questions) {
  const byAnswer = new Map();
  for (const q of questions) {
    if (!q.ncorrect) continue;
    if (!byAnswer.has(q.ncorrect)) byAnswer.set(q.ncorrect, []);
    byAnswer.get(q.ncorrect).push(q.ref);
  }
  const heavy = [...byAnswer.entries()].filter(([, refs]) => refs.length >= 8)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [answer, refs] of heavy) {
    add("ANSWER_OVERUSED", "review", `ANS_OVERUSED|${answer}`,
        `"${answer}" ${refs.length} kez doğru cevap`,
        { count: refs.length, refs: refs.slice(0, 40) });
  }
}

// S4 / S5 / S6 — semantic index coverage and the graph rules it makes checkable.
function checkSemantic(quizzes, semantic) {
  const byQuiz = new Map();
  for (const e of semantic.values()) {
    if (!byQuiz.has(e.quizCode)) byQuiz.set(e.quizCode, []);
    byQuiz.get(e.quizCode).push(e);
  }

  for (const qz of quizzes) {
    const n = quizNumber(qz.code);
    if (n === null || n < FIRST_INDEXED_QUIZ) continue;
    const entries = byQuiz.get(qz.code) || [];
    if (entries.length !== qz.questions.length) {
      add("SEMANTIC_COVERAGE", "hard", `SEM_COV|${qz.code}`,
          `${qz.code}: ${entries.length} semantic entry / ${qz.questions.length} soru`);
    }
  }

  const unindexed = quizzes.filter(qz => {
    const n = quizNumber(qz.code);
    return (n === null || n < FIRST_INDEXED_QUIZ) && !(byQuiz.get(qz.code) || []).length;
  });
  if (unindexed.length) {
    add("SEMANTIC_UNINDEXED", "review", `SEM_UNINDEXED`,
        `${unindexed.length} quiz semantic index dışında (${unindexed.reduce((s, q) => s + q.questions.length, 0)} soru) — duplicate koruması bu bölgede yok`,
        { quizzes: unindexed.map(q => q.code) });
  }

  // §7 topic diversity, computable only where entries exist.
  for (const [code, entries] of byQuiz) {
    const ordered = [...entries].sort((a, b) => a.questionId - b.questionId);
    const famCount = new Map();
    for (const e of ordered) {
      if (!e.topicFamily) continue;
      famCount.set(e.topicFamily, (famCount.get(e.topicFamily) || 0) + 1);
    }
    for (const [fam, c] of famCount) {
      if (c > 2) {
        add("TOPIC_FAMILY_MAX", "hard", `TF_MAX|${code}|${fam}`,
            `${code}: "${fam}" topic family ${c} kez (üst sınır 2)`);
      }
    }
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].topicFamily && ordered[i].topicFamily === ordered[i - 1].topicFamily) {
        add("TOPIC_FAMILY_ADJACENT", "hard", `TF_ADJ|${code}|${ordered[i].questionId}`,
            `${code}: q${ordered[i - 1].questionId} ve q${ordered[i].questionId} art arda aynı topic family ("${ordered[i].topicFamily}")`);
      }
    }
  }

  // §4 duplicate signature / factCluster across the indexed pool.
  const bySig = new Map();
  const byFact = new Map();
  for (const e of semantic.values()) {
    if (e.status && e.status !== "live") continue;
    if (e.semanticSignature) {
      if (!bySig.has(e.semanticSignature)) bySig.set(e.semanticSignature, []);
      bySig.get(e.semanticSignature).push(e.id);
    }
    if (e.factCluster) {
      const k = norm(e.factCluster);
      if (!byFact.has(k)) byFact.set(k, []);
      byFact.get(k).push(e.id);
    }
  }
  for (const [sig, ids] of bySig) {
    if (ids.length > 1) {
      add("SEMANTIC_SIGNATURE_DUP", "hard", `SIG_DUP|${ids.slice().sort().join(",")}`,
          `Aynı semantic signature: ${ids.join(" ↔ ")} (${sig})`);
    }
  }
  for (const [fact, ids] of byFact) {
    if (ids.length > 1) {
      const sameQuiz = new Set(ids.map(i => i.split("-")[0])).size < ids.length;
      add("FACT_CLUSTER_DUP", sameQuiz ? "hard" : "review", `FACT_DUP|${ids.slice().sort().join(",")}`,
          `Aynı factCluster "${fact}": ${ids.join(" ↔ ")}`);
    }
  }

  // semanticSignature = subject|askedProperty|correctAnswer, so the duplicate
  // gate only fires when two authors spell askedProperty identically. Variants
  // of one property ("yazar" / "yazarı" / "author") silently split the graph
  // and let the same fact through twice. This surfaces that drift before it
  // costs a duplicate.
  const propVariants = new Map();
  for (const e of semantic.values()) {
    const raw = String(e.askedProperty || "").trim();
    if (!raw) continue;
    const stem = norm(raw).replace(/\s+/g, " ")
      .replace(/(sinin|sının|sunun|sunun|nin|nın|nun|nun|si|sı|su|su|in|ın|un|un|i|ı|u)$/u, "");
    if (!propVariants.has(stem)) propVariants.set(stem, new Map());
    const m = propVariants.get(stem);
    m.set(raw, (m.get(raw) || 0) + 1);
  }
  for (const [stem, variants] of propVariants) {
    if (variants.size < 2 || !stem) continue;
    const desc = [...variants.entries()].sort((a, b) => b[1] - a[1])
      .map(([v, c]) => `"${v}" x${c}`).join(", ");
    add("SEMANTIC_PROPERTY_VARIANTS", "review", `PROP_VAR|${stem}`,
        `askedProperty tek bir özellik için ${variants.size} farklı yazımda: ${desc} — signature bölünüyor, duplicate kapısı bu fact için kör`,
        { stem, variants: Object.fromEntries(variants) });
  }

  // ---------------------------------------------------------------------------
  // Anchor key — the layer that actually catches re-asked facts.
  //
  // semanticSignature is subject|askedProperty|correctAnswer, and askedProperty
  // is free text. "besteci" and "bestecisi" are the same property spelled two
  // ways; "ressam" and "sanatçısı" are synonyms. Either split produces two
  // different signatures for one fact, and the duplicate gate goes blind.
  //
  // Dropping askedProperty entirely gives subject|correctAnswer: if two
  // questions share a subject and a correct answer, they are asking the same
  // thing whatever words the author reached for. On the current pool this finds
  // 26 duplicates that neither the signature nor the lexical layer sees.
  //
  // A collision is not automatically wrong — one subject can legitimately carry
  // two questions with the same answer — so this behaves like the 0.84 fuzzy
  // threshold: a mandatory review signal, gated through the baseline.
  // ---------------------------------------------------------------------------
  const byAnchor = new Map();
  for (const e of semantic.values()) {
    if (e.status && e.status !== "live") continue;
    if (!e.subject || !e.correctAnswer) continue;
    const key = `${norm(e.subject)}|${norm(e.correctAnswer)}`;
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key).push(e);
  }
  for (const [key, entries] of byAnchor) {
    if (entries.length < 2) continue;
    const ids = entries.map(e => e.id).sort();
    const props = entries.map(e => `${e.id}="${e.askedProperty}"`).join(", ");
    add("SEMANTIC_ANCHOR_DUP", "hard", `ANCHOR|${ids.join(",")}`,
        `Aynı subject+answer: ${ids.join(" ↔ ")} — "${entries[0].subject}" → "${entries[0].correctAnswer}" (askedProperty: ${props})`,
        { subject: entries[0].subject, answer: entries[0].correctAnswer, ids });
  }
}

// S9 / S12 — targeting hints for the phases that need judgment or sources.
function checkPrecisionAndVolatility(questions) {
  for (const q of questions) {
    const bareYear = /^\d{3,4}$/.test(String(q.correct).trim());
    const bareNumber = /^[\d.,]+$/.test(String(q.correct).trim());
    if (bareYear || bareNumber) {
      const allNumeric = q.options.every(o => /^[\d.,\s]+$/.test(String(o).trim()));
      if (allNumeric) {
        add("PRECISION_NUMERIC", "review", `PREC_NUM|${q.ref}`,
            `Doğru cevap çıplak sayı/yıl, precision burden P2/P3 riski: ${q.ref} → ${q.correct}`,
            { question: q.text, options: q.options });
      }
    }
    const volatile = /(şu an|şu anda|günümüzde|halen|hâlen|en son|güncel|kaç.*(nüfus|kişi)|rekor|dünya rekoru|en fazla|en çok|en büyük|en yüksek|en uzun|en kalabalık|ilk kez)/i;
    if (volatile.test(q.text)) {
      add("SOURCE_REVIEW_NEEDED", "review", `SRC|${q.ref}`,
          `Zamana bağlı / superlatif ifade, kaynak doğrulaması gerekli: ${q.ref}`,
          { question: q.text });
    }
  }
}

// -----------------------------------------------------------------------------
// baseline ratchet
// -----------------------------------------------------------------------------

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return { accepted: [] };
  return readJson(BASELINE_FILE);
}

function runAllChecks() {
  const { index, quizzes, questions } = loadCorpus();
  const semantic = loadSemanticIndex();
  findings.length = 0;
  checkStemSimilarity(questions);
  checkAnswerInfo(questions);
  checkAnswerDistribution(quizzes);
  checkCues(quizzes, questions);
  checkAnswerRepetition(questions);
  checkSemantic(quizzes, semantic);
  checkPrecisionAndVolatility(questions);
  return { index, quizzes, questions, semantic };
}

function groupByGate() {
  const g = new Map();
  for (const f of findings) {
    if (!g.has(f.gate)) g.set(f.gate, []);
    g.get(f.gate).push(f);
  }
  return g;
}

// -----------------------------------------------------------------------------
// report
// -----------------------------------------------------------------------------

function writeReport(ctx) {
  const { quizzes, questions, semantic } = ctx;
  const groups = groupByGate();
  const hard = findings.filter(f => f.severity === "hard");
  const review = findings.filter(f => f.severity === "review");

  const L = [];
  L.push("# Quizsel Corpus Health Report");
  L.push("");
  L.push(`Üretim: \`node quiz-health-tool.mjs audit\` · ${new Date().toISOString().slice(0, 10)}`);
  L.push("");
  L.push("Bu rapor otomatik üretilir. Mekanik olarak ölçülebilen kuralları kapsar;");
  L.push("leakage, precision burden, tek savunulabilir doğru ve olgu doğruluğu");
  L.push("editoryal review gerektirir ve burada yalnızca aday olarak işaretlenir.");
  L.push("");
  L.push("## Özet");
  L.push("");
  L.push(`- Quiz: **${quizzes.length}** · Soru: **${questions.length}**`);
  L.push(`- Semantic index kapsamı: **${semantic.size}** entry`);
  L.push(`- answerInfo taşıyan soru: **${questions.filter(q => q.answerInfo).length}**`);
  L.push(`- Hard bulgu: **${hard.length}** · Review bulgusu: **${review.length}**`);
  L.push("");
  L.push("| Kapı | Seviye | Adet |");
  L.push("|---|---|---|");
  for (const [gate, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`| \`${gate}\` | ${list[0].severity} | ${list.length} |`);
  }
  L.push("");

  for (const [gate, list] of [...groups].sort((a, b) => {
    if (a[1][0].severity !== b[1][0].severity) return a[1][0].severity === "hard" ? -1 : 1;
    return b[1].length - a[1].length;
  })) {
    L.push(`## ${gate} — ${list.length} bulgu (${list[0].severity})`);
    L.push("");
    for (const f of list.slice(0, 60)) {
      L.push(`- ${f.message}`);
      if (f.answerInfo) L.push(`  - mevcut: \`${f.answerInfo}\``);
      if (f.a && f.b) {
        L.push(`  - A: ${f.a}`);
        L.push(`  - B: ${f.b}`);
      }
      if (f.stem) L.push(`  - stem: ${f.stem}`);
    }
    if (list.length > 60) L.push(`- … ve ${list.length - 60} bulgu daha (tam liste: \`${REPORT_JSON}\`)`);
    L.push("");
  }

  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, L.join("\n"), "utf8");
  fs.writeFileSync(REPORT_JSON, JSON.stringify({
    generated: new Date().toISOString(),
    totals: { quizzes: quizzes.length, questions: questions.length, hard: hard.length, review: review.length },
    findings
  }, null, 2), "utf8");
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

const cmd = process.argv[2] || "audit";

try {
  const ctx = runAllChecks();
  const hard = findings.filter(f => f.severity === "hard");
  const review = findings.filter(f => f.severity === "review");

  if (cmd === "audit") {
    writeReport(ctx);
    const groups = groupByGate();
    console.log(`Quiz ${ctx.quizzes.length} · Soru ${ctx.questions.length} · Semantic entry ${ctx.semantic.size}\n`);
    for (const [gate, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${list[0].severity === "hard" ? "HARD  " : "review"}  ${String(list.length).padStart(4)}  ${gate}`);
    }
    console.log(`\nHARD ${hard.length} · REVIEW ${review.length}`);
    console.log(`Rapor: ${REPORT_MD}\nJSON : ${REPORT_JSON}`);
    process.exit(0);
  }

  if (cmd === "baseline") {
    const accepted = hard.map(f => f.fingerprint).sort();
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({
      note: "Kabul edilmiş mevcut borç. Yeni ihlaller CI'ı kırar; bu liste yalnızca küçülmelidir.",
      generated: new Date().toISOString(),
      acceptedCount: accepted.length,
      accepted
    }, null, 2), "utf8");
    console.log(`Baseline yazıldı: ${accepted.length} kabul edilmiş hard bulgu → ${BASELINE_FILE}`);
    process.exit(0);
  }

  if (cmd === "gate") {
    const baseline = new Set(loadBaseline().accepted || []);
    const fresh = hard.filter(f => !baseline.has(f.fingerprint));
    const fixed = [...baseline].filter(fp => !hard.some(f => f.fingerprint === fp));

    console.log(`Corpus health gate: hard ${hard.length} · baseline ${baseline.size} · yeni ${fresh.length} · düzelmiş ${fixed.length}`);
    if (fixed.length) {
      console.log(`\n${fixed.length} baseline kaydı artık ihlal değil. 'node quiz-health-tool.mjs baseline' ile daralt.`);
    }
    if (fresh.length) {
      console.log("\nYENİ İHLALLER:");
      for (const f of fresh.slice(0, 50)) console.log(`  - [${f.gate}] ${f.message}`);
      if (fresh.length > 50) console.log(`  … ve ${fresh.length - 50} tane daha`);
      console.log("\nRESULT: FAIL");
      process.exit(1);
    }
    console.log("\nRESULT: PASS");
    process.exit(0);
  }

  console.error("komutlar: audit | gate | baseline");
  process.exit(1);
} catch (e) {
  console.error("FAIL:", e?.stack || e?.message || e);
  process.exit(1);
}
