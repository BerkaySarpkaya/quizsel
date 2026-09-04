#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const INDEX_FILE = "quiz-index.json";
const MANIFEST_FILE = "QUIZSEL_SEMANTIC_INDEX_MANIFEST.json";
const QA_SPEC_FILE = "QUIZSEL_SORU_QA_SPEC.json";
const ANALYTICS_FILE = "app-v012-analytics.js";
const KNOWLEDGE_FILE = "app-v013-knowledge.js";
const KNOWLEDGE_STYLE = "styles-v013-knowledge.css";
const QUIZ_TEMPLATE_FILE = "QUIZ_TEMPLATE.json";
const DB_RULES_FILE = "database.rules.json";

const hard = [];
const review = [];
const info = [];

function norm(v){
  return String(v ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function words(v){ return norm(v).split(" ").filter(Boolean); }
function sentenceCount(v){
  const s = String(v ?? "").trim();
  if (!s) return 0;
  return s.split(/(?<=[.!?])\s+/u).map(x => x.trim()).filter(Boolean).length;
}
function fail(msg){ hard.push(msg); }
function warn(msg){ review.push(msg); }
function note(msg){ info.push(msg); }
function readJson(file){ return JSON.parse(fs.readFileSync(file, "utf8")); }
function stableValue(value){
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
  }
  return value;
}
function stableJson(value){ return JSON.stringify(stableValue(value)); }
function readJsonFromGit(ref, file){
  try {
    const raw = execFileSync("git", ["show", `${ref}:${file}`], { encoding:"utf8", stdio:["ignore","pipe","pipe"] });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function validateAnswerInfo(file, q){
  const text = String(q?.answerInfo || "").trim();
  if (!text) { fail(`${file}: q${q?.id ?? "?"} answerInfo required for knowledge backfill`); return; }
  const sentences = sentenceCount(text);
  if (sentences < 1 || sentences > 3) fail(`${file}: q${q.id} answerInfo must be 1-3 sentences (found ${sentences})`);
  if (text.length < 24) fail(`${file}: q${q.id} answerInfo too short (<24 chars)`);
  if (text.length > 500) fail(`${file}: q${q.id} answerInfo too long (>500 chars)`);
}
function strippedKnowledgeComparable(quiz){
  const out = JSON.parse(JSON.stringify(quiz));
  delete out.version;
  for (const q of (out.questions || [])) delete q.answerInfo;
  return out;
}
function knowledgeBackfillDelta(baseQuiz, currentQuiz){
  if (!baseQuiz || !currentQuiz) return { candidate:false, eligible:false, reason:"baseline/current quiz unavailable" };
  if (stableJson(strippedKnowledgeComparable(baseQuiz)) !== stableJson(strippedKnowledgeComparable(currentQuiz))) {
    return { candidate:false, eligible:false, reason:"changes extend beyond version + answerInfo" };
  }
  if (!Array.isArray(currentQuiz.questions) || !currentQuiz.questions.length) {
    return { candidate:false, eligible:false, reason:"questions missing" };
  }
  const changed = currentQuiz.questions.some((q,i) => String(q?.answerInfo || "") !== String(baseQuiz.questions?.[i]?.answerInfo || ""));
  if (!changed) return { candidate:false, eligible:false, reason:"answerInfo did not change" };
  const baseVersion = Number(baseQuiz.version || 1);
  const currentVersion = Number(currentQuiz.version || 1);
  if (!Number.isInteger(baseVersion) || !Number.isInteger(currentVersion) || currentVersion !== baseVersion + 1) {
    return { candidate:true, eligible:false, reason:`version must increment exactly once (${baseVersion} -> ${baseVersion+1})` };
  }
  return { candidate:true, eligible:true, reason:"answerInfo-only backfill" };
}

function canonicalCode(v){ return String(v || "").toUpperCase().replace(/[^A-Z0-9_-]/g, ""); }
function yqNumber(code){
  const m = canonicalCode(code).match(/^YQ0*(\d+)$/);
  return m ? Number(m[1]) : null;
}
function bigrams(s){
  const t = ` ${norm(s)} `;
  const out = [];
  for (let i=0; i<t.length-1; i++) out.push(t.slice(i, i+2));
  return out;
}
function dice(a,b){
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length && !B.length) return 1;
  const counts = new Map();
  for (const x of A) counts.set(x, (counts.get(x)||0)+1);
  let intersection = 0;
  for (const x of B) {
    const n = counts.get(x)||0;
    if (n > 0) {
      intersection++;
      counts.set(x, n-1);
    }
  }
  return (2 * intersection) / (A.length + B.length);
}
function loadIndex(){
  if (!fs.existsSync(INDEX_FILE)) throw new Error(`${INDEX_FILE} missing`);
  const index = readJson(INDEX_FILE);
  if (!Array.isArray(index.quizzes)) throw new Error("quiz-index quizzes array missing");
  return index;
}
function findSemanticEntries(code){
  if (!fs.existsSync(MANIFEST_FILE)) return [];
  const manifest = readJson(MANIFEST_FILE);
  const n = yqNumber(code);
  if (!Number.isInteger(n)) return [];
  const rec = (manifest.shards||[]).find(r => n >= Number(r.startQuiz) && n <= Number(r.endQuiz));
  if (!rec || !fs.existsSync(rec.path)) return [];
  const shard = readJson(rec.path);
  return Object.values(shard.entries||{})
    .filter(e => e.quizCode === canonicalCode(code) && e.status !== "retired")
    .sort((a,b) => Number(a.questionId)-Number(b.questionId));
}
function validateBasicQuiz(file, meta=null){
  let quiz;
  try { quiz = readJson(file); }
  catch (e) { fail(`${file}: JSON parse failed: ${e.message}`); return null; }

  const code = canonicalCode(quiz.code);
  if (!code) fail(`${file}: code missing`);
  if (!Array.isArray(quiz.questions) || !quiz.questions.length) {
    fail(`${file}: questions missing/empty`);
    return quiz;
  }
  if (meta) {
    if (canonicalCode(meta.code) !== code) fail(`${file}: index code != quiz code`);
    if (Number(meta.questions) !== quiz.questions.length) fail(`${file}: index questions count mismatch`);
    if (String(meta.file) !== path.basename(file)) fail(`${file}: index file mismatch`);
  }

  const ids = new Set();
  const productionNumber = yqNumber(code);
  quiz.questions.forEach((q, i) => {
    if (!Number.isInteger(Number(q.id))) fail(`${file}: q${i+1} invalid id`);
    if (ids.has(Number(q.id))) fail(`${file}: duplicate id ${q.id}`);
    ids.add(Number(q.id));
    if (!String(q.text||"").trim()) fail(`${file}: q${q.id} empty text`);
    if (!Array.isArray(q.options) || q.options.length < 2) fail(`${file}: q${q.id} options invalid`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options?.length||0)) {
      fail(`${file}: q${q.id} answer invalid`);
    }

    if (Number.isInteger(productionNumber) && productionNumber >= 253) {
      const info = String(q.answerInfo || "").trim();
      if (!info) {
        fail(`${file}: q${q.id} YQ253+ answerInfo required`);
      } else {
        const sentences = sentenceCount(info);
        if (sentences < 1 || sentences > 3) {
          fail(`${file}: q${q.id} answerInfo must be 1-3 sentences (found ${sentences})`);
        }
        if (info.length < 24) fail(`${file}: q${q.id} answerInfo too short (<24 chars)`);
        if (info.length > 500) fail(`${file}: q${q.id} answerInfo too long (>500 chars)`);
      }
    }
  });

  return quiz;
}
function validateStrictProduction(file, quiz, historyStems){
  const code = canonicalCode(quiz.code);
  const n = yqNumber(code);
  if (!Number.isInteger(n) || n < 133) return;

  if (Number(quiz.schemaVersion) !== 2) fail(`${file}: YQ133+ schemaVersion must be 2`);
  if (quiz.questions.length !== 10) fail(`${file}: YQ133+ must contain 10 questions`);

  const counts = [0,0,0,0];
  let uniqueLongestCorrect = 0;

  quiz.questions.forEach(q => {
    if (q.options.length !== 4) fail(`${file}: q${q.id} must have 4 options`);
    if (Number(q.time) !== 20) fail(`${file}: q${q.id} time must be 20`);
    if (q.questionType !== "multiple-choice") fail(`${file}: q${q.id} questionType must be multiple-choice`);

    const opts = q.options.map(norm);
    if (new Set(opts).size !== opts.length) fail(`${file}: q${q.id} duplicate options`);
    if (q.answer >= 0 && q.answer <= 3) counts[q.answer]++;

    const lens = q.options.map(x => words(x).length);
    const max = Math.max(...lens);
    const min = Math.max(1, Math.min(...lens));
    const correctLen = lens[q.answer];

    if (max / min > 3) warn(`${file}: q${q.id} option word-count ratio ${(max/min).toFixed(2)} > 3`);
    if (correctLen === max && lens.filter(x => x === max).length === 1) uniqueLongestCorrect++;

    const stem = norm(q.text);
    if (historyStems.has(stem)) fail(`${file}: q${q.id} exact historical stem duplicate`);

    for (const old of historyStems.values()) {
      if (!old || old === stem) continue;
      const sim = dice(stem, old);
      if (sim >= 0.84) {
        warn(`${file}: q${q.id} fuzzy stem REVIEW >=0.84 (${sim.toFixed(3)})`);
        break;
      }
    }
  });

  counts.forEach((c,i) => {
    if (c < 1) fail(`${file}: answer position ${String.fromCharCode(65+i)} never used`);
    if (c > 5) fail(`${file}: answer position ${String.fromCharCode(65+i)} used ${c} times (>5)`);
  });

  const rate = uniqueLongestCorrect / Math.max(1, quiz.questions.length);
  if (rate > 0.10) {
    warn(`${file}: unique-longest-correct ${(rate*100).toFixed(0)}% > 10% target`);
  }

  // Mechanical leakage candidates only; semantic verdict remains manual.
  for (let i=0; i<quiz.questions.length; i++) {
    const answer = norm(quiz.questions[i].options[quiz.questions[i].answer]);
    if (answer.length < 5) continue;
    for (let j=0; j<quiz.questions.length; j++) {
      if (i === j) continue;
      const stem = norm(quiz.questions[j].text);
      if (stem.includes(answer)) {
        warn(`${file}: possible answer leakage q${quiz.questions[i].id} -> q${quiz.questions[j].id}`);
      }
    }
  }

  const entries = findSemanticEntries(code);
  if (entries.length !== quiz.questions.length) {
    fail(`${file}: semantic entries ${entries.length}/${quiz.questions.length}`);
  } else {
    const topicCounts = new Map();
    for (let i=0; i<entries.length; i++) {
      const topic = `${entries[i].category}|${entries[i].topicFamily}`;
      topicCounts.set(topic, (topicCounts.get(topic)||0)+1);
      if (i && entries[i-1].topicFamily === entries[i].topicFamily) {
        fail(`${file}: adjacent same Topic Family at q${entries[i-1].questionId}/q${entries[i].questionId}`);
      }
    }
    for (const [topic,c] of topicCounts) {
      if (c > 2) fail(`${file}: Topic Family >2 (${topic}: ${c})`);
    }
  }

  if (quiz.questions.some(q => /\b20\d{2}\b|günümüzde|şu anda|halen|son dönemde/i.test(String(q.text)))) {
    warn(`${file}: changing/current fact signal detected; manual source verification required`);
  }
}
function buildHistoricalStems(index, excludedFiles=new Set()){
  const stems = new Map();
  for (const meta of index.quizzes) {
    const file = String(meta.file || "");
    if (!file || excludedFiles.has(file) || !fs.existsSync(file)) continue;
    try {
      const q = readJson(file);
      for (const item of (q.questions||[])) {
        const s = norm(item.text);
        if (s) stems.set(s, s);
      }
    } catch {}
  }
  return stems;
}

function validateAnalyticsRuntime(){
  const required = [
    "app-v09-performance.js",
    "app-v010-runtime.js",
    "app-v011-reliability.js",
    ANALYTICS_FILE,
    KNOWLEDGE_FILE,
    KNOWLEDGE_STYLE,
    QUIZ_TEMPLATE_FILE,
    "config.js",
    "index.html",
    DB_RULES_FILE,
    "docs/ANALYTICS_ARCHITECTURE.md",
    "docs/RUNTIME_ARCHITECTURE.md"
  ];
  required.forEach(file => {
    if (!fs.existsSync(file)) fail(`${file} missing`);
  });
  if (required.some(file => !fs.existsSync(file))) return;

  try {
    // Parse as classic scripts without executing browser globals.
    new Function(fs.readFileSync(ANALYTICS_FILE, "utf8"));
  } catch (e) {
    fail(`${ANALYTICS_FILE}: JavaScript syntax failed: ${e.message}`);
  }
  try {
    new Function(fs.readFileSync(KNOWLEDGE_FILE, "utf8"));
  } catch (e) {
    fail(`${KNOWLEDGE_FILE}: JavaScript syntax failed: ${e.message}`);
  }

  const indexHtml = fs.readFileSync("index.html", "utf8");
  const configJs = fs.readFileSync("config.js", "utf8");

  if (!indexHtml.includes('config.js?v=121')) {
    fail("index.html: config cache key must be v=121 for analytics rollout");
  }
  if (!indexHtml.includes('app-v011-reliability.js?v=112')) {
    fail("index.html: v0.11 reliability direct tag missing");
  }
  if (!configJs.includes('clientVersion: "0.12.1"')) {
    fail("config.js: clientVersion must be 0.12.1");
  }
  if (!configJs.includes('app-v012-analytics.js?v=121')) {
    fail("config.js: v0.12 analytics loader missing");
  }
  [
    'styles-v013-knowledge.css?v=130',
    'id="finalKnowledgeBtn"',
    'id="view-knowledge"',
    'id="knowledgeList"',
    'app-v013-knowledge.js?v=130'
  ].forEach(marker => {
    if (!indexHtml.includes(marker)) fail(`index.html: Bilgi Canavarı wiring missing: ${marker}`);
  });
  try {
    const template = readJson(QUIZ_TEMPLATE_FILE);
    const sample = template?.questions?.[0];
    if (!String(sample?.answerInfo || "").trim()) {
      fail(`${QUIZ_TEMPLATE_FILE}: answerInfo template field missing`);
    }
  } catch (e) {
    fail(`${QUIZ_TEMPLATE_FILE}: JSON/schema check failed: ${e.message}`);
  }

  try {
    const rules = readJson(DB_RULES_FILE)?.rules || {};
    const match = rules.matchArchive?.["$matchId"] || {};
    const departures = rules.analyticsDepartures?.["$room"]?.["$createdAt"]?.["$eventId"] || {};

    if (!rules.matchArchive) fail(`${DB_RULES_FILE}: matchArchive rules missing`);
    if (!rules.analyticsDepartures) fail(`${DB_RULES_FILE}: analyticsDepartures rules missing`);
    if (!String(match[".write"] || "").includes("!data.exists()")) {
      fail(`${DB_RULES_FILE}: matchArchive must be create-only/immutable`);
    }
    if (!String(departures[".write"] || "").includes("!data.exists()")) {
      fail(`${DB_RULES_FILE}: analyticsDepartures events must be create-only`);
    }
    if (!String(rules.matchArchive?.[".read"] || "").includes("quizsel-admin@quizsel.app")) {
      fail(`${DB_RULES_FILE}: matchArchive admin read boundary missing`);
    }
  } catch (e) {
    fail(`${DB_RULES_FILE}: JSON/schema check failed: ${e.message}`);
  }

  const analyticsSource = fs.readFileSync(ANALYTICS_FILE, "utf8");
  const lifecycleHooks = [
    "hostQuiz = async function quizselV012HostQuiz",
    "startGame = async function quizselV012StartGame",
    "renderFinal = function quizselV012RenderFinal",
    "leaveCompetition = async function quizselV012LeaveCompetition",
    "kickPlayer = async function quizselV012KickPlayer",
    "terminateCompetition = async function quizselV012TerminateCompetition",
    "renderAdmin = async function quizselV012RenderAdmin"
  ];
  lifecycleHooks.forEach(marker => {
    if (!analyticsSource.includes(marker)) fail(`${ANALYTICS_FILE}: lifecycle hook missing: ${marker}`);
  });

  if (!analyticsSource.includes("matchArchive/")) fail(`${ANALYTICS_FILE}: matchArchive write path missing`);
  if (!analyticsSource.includes("analyticsDepartures/")) fail(`${ANALYTICS_FILE}: analyticsDepartures write path missing`);
  if (!analyticsSource.includes("requireArchiveBeforeDestructiveAction")) {
    fail(`${ANALYTICS_FILE}: destructive archive gate missing`);
  }
  [
    "installFinalNavigationGuard",
    "forceHomeAfterFinal",
    "microtask-watchdog",
    "directHomeDomFallback"
  ].forEach(marker => {
    if (!analyticsSource.includes(marker)) {
      fail(`${ANALYTICS_FILE}: final navigation guard missing: ${marker}`);
    }
  });

  note("analytics runtime: v0.12.1 wiring/schema/navigation guards present");
  note("Bilgi Canavarı runtime: v0.13.0 wiring/template present");
}

function repoCheck(){
  const index = loadIndex();
  const codes = new Set();
  const files = new Set();

  for (const meta of index.quizzes) {
    const code = canonicalCode(meta.code);
    const file = String(meta.file || "");
    if (!code || !file) { fail("quiz-index entry missing code/file"); continue; }
    if (codes.has(code)) fail(`quiz-index duplicate code ${code}`);
    if (files.has(file)) fail(`quiz-index duplicate file ${file}`);
    codes.add(code); files.add(file);

    if (!fs.existsSync(file)) {
      fail(`quiz-index file missing: ${file}`);
      continue;
    }
    validateBasicQuiz(file, meta);
  }

  const diskQuizFiles = fs.readdirSync(".")
    .filter(f => /^(QZ|YQ)\d+\.json$/i.test(f));
  for (const file of diskQuizFiles) {
    if (!files.has(file)) fail(`orphan quiz JSON not in quiz-index: ${file}`);
  }

  if (fs.existsSync(MANIFEST_FILE)) {
    const manifest = readJson(MANIFEST_FILE);
    const maxIndexed = Number(String(manifest.semantic?.contiguousThroughQuiz||"").replace(/\D/g,"") || 0);
    const productionNums = index.quizzes.map(x => yqNumber(x.code)).filter(n => Number.isInteger(n) && n >= 133);
    if (productionNums.length) {
      const maxProduction = Math.max(...productionNums);
      if (maxIndexed < maxProduction) {
        fail(`semantic contiguous coverage YQ${maxIndexed} behind production YQ${maxProduction}`);
      }
    }
  } else {
    fail(`${MANIFEST_FILE} missing`);
  }

  validateAnalyticsRuntime();

  note(`repo index entries: ${index.quizzes.length}`);
}
function checkFiles(targets){
  const index = loadIndex();
  const byFile = new Map(index.quizzes.map(x => [String(x.file), x]));
  const excluded = new Set(targets.map(x => path.basename(x)));
  const historical = buildHistoricalStems(index, excluded);

  for (const input of targets) {
    const file = path.basename(input);
    if (!fs.existsSync(file)) { fail(`${file}: target missing`); continue; }
    const meta = byFile.get(file);
    if (!meta) fail(`${file}: target not present in quiz-index`);
    const quiz = validateBasicQuiz(file, meta || null);
    if (quiz) validateStrictProduction(file, quiz, historical);
  }
}
function checkChangedFiles(baseRef, targets){
  const index = loadIndex();
  const byFile = new Map(index.quizzes.map(x => [String(x.file), x]));
  const excluded = new Set(targets.map(x => path.basename(x)));
  const historical = buildHistoricalStems(index, excluded);
  let backfillCount = 0;
  let strictCount = 0;

  for (const input of targets) {
    const file = path.basename(input);
    if (!fs.existsSync(file)) { fail(`${file}: target missing`); continue; }
    const meta = byFile.get(file);
    if (!meta) fail(`${file}: target not present in quiz-index`);
    const current = validateBasicQuiz(file, meta || null);
    if (!current) continue;

    const baseline = readJsonFromGit(baseRef, file);
    const delta = knowledgeBackfillDelta(baseline, current);
    if (delta.candidate) {
      backfillCount++;
      if (!delta.eligible) fail(`${file}: invalid knowledge backfill: ${delta.reason}`);
      for (const q of current.questions) validateAnswerInfo(file, q);
      if (delta.eligible) note(`${file}: knowledge backfill invariant PASS (only version + answerInfo changed)`);
    } else {
      strictCount++;
      validateStrictProduction(file, current, historical);
      note(`${file}: strict production QA (${delta.reason})`);
    }
  }
  note(`changed-file routing: knowledge-backfill=${backfillCount} · strict=${strictCount}`);
}

function printAndExit(){
  if (hard.length) {
    console.error("\nHARD FAILS");
    hard.forEach(x => console.error(" -", x));
  }
  if (review.length) {
    console.log("\nREVIEW / SOFT");
    review.forEach(x => console.log(" -", x));
  }
  if (info.length) {
    console.log("\nINFO");
    info.forEach(x => console.log(" -", x));
  }
  console.log(`\nRESULT: ${hard.length ? "FAIL" : "PASS"} · hard=${hard.length} · review=${review.length}`);
  process.exit(hard.length ? 1 : 0);
}

try {
  const cmd = process.argv[2] || "repo";
  if (!fs.existsSync(QA_SPEC_FILE)) throw new Error(`${QA_SPEC_FILE} missing`);

  if (cmd === "repo") {
    repoCheck();
  } else if (cmd === "check") {
    const targets = process.argv.slice(3);
    if (!targets.length) throw new Error("usage: check YQxxx.json [YQyyy.json ...]");
    repoCheck();
    checkFiles(targets);
  } else if (cmd === "check-changed") {
    const baseRef = process.argv[3];
    const targets = process.argv.slice(4);
    if (!baseRef || !targets.length) throw new Error("usage: check-changed BASE_REF YQxxx.json [YQyyy.json ...]");
    repoCheck();
    checkChangedFiles(baseRef, targets);
  } else {
    throw new Error("commands: repo | check YQxxx.json [YQyyy.json ...] | check-changed BASE_REF YQxxx.json [...]");
  }

  printAndExit();
} catch (e) {
  console.error("FAIL:", e?.message || e);
  process.exit(1);
}
