#!/usr/bin/env node
"use strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MANIFEST_FILE = "QUIZSEL_SEMANTIC_INDEX_MANIFEST.json";
const SPEC_FILE = "QUIZSEL_SEMANTIC_INDEX_SPEC.json";
const BASE_QA_FILE = "QUIZSEL_SORU_QA_SPEC.json";

function fail(msg){ throw new Error(msg); }
function die(e){ console.error("FAIL:", e?.message || e); process.exit(1); }
function readJson(file){ return JSON.parse(fs.readFileSync(file,"utf8")); }
function clone(v){ return structuredClone(v); }
function nfc(v){ return String(v ?? "").normalize("NFC").trim().replace(/\s+/g," "); }
function norm(v){
  return String(v ?? "").trim().toLocaleLowerCase("tr-TR").normalize("NFKD")
    .replace(/\p{M}/gu,"").replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
}
function semanticSignature(e){ return [e.subject,e.askedProperty,e.correctAnswer].map(norm).join("|"); }
function sourceQuizNumber(code){ const m=String(code||"").match(/^YQ0*(\d+)$/i); return m?Number(m[1]):null; }
function entryIdParts(id){ const m=String(id||"").match(/^YQ(\d+)-Q(\d{2})$/); return m?{quiz:Number(m[1]),question:Number(m[2])}:null; }
function shardRange(n,spec){
  const first=Number(spec.sharding.firstShardStart), size=Number(spec.sharding.quizBlockSize);
  if(!Number.isInteger(n)||n<first) fail(`quiz ${n}: below semantic start ${first}`);
  const start=first+Math.floor((n-first)/size)*size;
  return {start,end:start+size-1,id:`YQ${start}-YQ${start+size-1}`,path:`semantic-index/shards/YQ${start}-YQ${start+size-1}.json`};
}
function sha256Text(text){ return crypto.createHash("sha256").update(text).digest("hex"); }
function stableJson(v){ return JSON.stringify(v,null,2)+"\n"; }

function bloomPositions(token,bits,k){
  const d=crypto.createHash("sha256").update(token).digest();
  const h1=d.readUInt32BE(0), raw=d.readUInt32BE(4), h2=raw===0?0x9e3779b1:raw;
  const out=[]; for(let i=0;i<k;i++) out.push((h1 + Math.imul(i,h2)) >>> 0);
  return out.map(x=>x%bits);
}
function bloomCreate(tokens,bits,k){
  const buf=Buffer.alloc(Math.ceil(bits/8));
  for(const token of new Set(tokens)) for(const p of bloomPositions(token,bits,k)) buf[p>>3] |= 1 << (p&7);
  return buf.toString("base64");
}
function bloomHas(base64,token,bits,k){
  if(!base64) return false;
  const buf=Buffer.from(base64,"base64");
  for(const p of bloomPositions(token,bits,k)) if((buf[p>>3] & (1 << (p&7)))===0) return false;
  return true;
}
function entryTokens(e){
  const keys=[];
  const add=(prefix,value)=>{const x=norm(value);if(x)keys.push(`${prefix}:${x}`);};
  add("stem",e.stem);
  add("sig",e.semanticSignature || semanticSignature(e));
  add("fact",e.factCluster);
  add("sp",`${e.subject}|${e.askedProperty}`);
  add("subject",e.subject);
  add("answer",e.correctAnswer);
  for(const rk of (e.retrievalKeys||[])) add("rk",rk);
  return [...new Set(keys)];
}
function queryTokens(q){
  const temp={...q,semanticSignature:q.subject&&q.askedProperty&&q.correctAnswer?semanticSignature(q):""};
  return entryTokens(temp);
}
function topicKey(e){ return norm(`${e.category}|${e.topicFamily}`); }

function loadBaseQa(){ return fs.existsSync(BASE_QA_FILE)?readJson(BASE_QA_FILE):null; }
function validateEntryShape(e,spec,baseQa,{allowExisting=false}={}){
  const req=spec.entrySchema.required||[];
  for(const f of req){ const v=e[f]; if(v===undefined||v===null||v===""||(Array.isArray(v)&&v.length===0)) fail(`${e.id||"entry"}: missing ${f}`); }
  const idp=entryIdParts(e.id); if(!idp) fail(`${e.id}: invalid id`);
  const qn=sourceQuizNumber(e.quizCode); if(qn===null) fail(`${e.id}: invalid quizCode`);
  if(idp.quiz!==qn) fail(`${e.id}: id/quizCode mismatch`);
  if(idp.question!==Number(e.questionId)) fail(`${e.id}: id/questionId mismatch`);
  if(qn<Number(spec.coveragePolicy.fullSemanticIndexFromQuizNumber)) fail(`${e.id}: semantic indexing starts at YQ${spec.coveragePolicy.fullSemanticIndexFromQuizNumber}`);
  if(!(spec.entrySchema.precisionAllowed||[]).includes(e.precisionRequired)) fail(`${e.id}: invalid precision ${e.precisionRequired}`);
  if(e.precisionRequired==="P3") fail(`${e.id}: P3 hard-fail`);
  if(!(spec.entrySchema.questionFormsAllowed||[]).includes(e.questionForm)) fail(`${e.id}: invalid questionForm`);
  if(!(spec.entrySchema.statusAllowed||[]).includes(e.status)) fail(`${e.id}: invalid status`);
  if(!Array.isArray(e.retrievalKeys)||!e.retrievalKeys.map(norm).filter(Boolean).length) fail(`${e.id}: retrievalKeys empty`);
  if(new Set(e.retrievalKeys.map(norm)).size!==e.retrievalKeys.map(norm).filter(Boolean).length) fail(`${e.id}: duplicate/empty retrievalKeys`);
  const base=loadBaseQa();
  if(base?.taxonomy?.categories){
    const topics=base.taxonomy.categories[e.category];
    if(!Array.isArray(topics)) fail(`${e.id}: category not in base QA taxonomy: ${e.category}`);
    if(!topics.includes(e.topicFamily)) fail(`${e.id}: topicFamily not allowed for ${e.category}: ${e.topicFamily}`);
    const scopes=base.taxonomy.scopes||[];
    if(scopes.length&&!scopes.includes(e.scope)) fail(`${e.id}: invalid scope ${e.scope}`);
  }
}
function sourceFileForQuiz(code){ return `${String(code).toUpperCase()}.json`; }
function sourceQuestion(e){
  const file=sourceFileForQuiz(e.quizCode);
  if(!fs.existsSync(file)) fail(`${e.id}: source quiz missing: ${file}`);
  const quiz=readJson(file);
  if(String(quiz.code||"").toUpperCase()!==String(e.quizCode).toUpperCase()) fail(`${e.id}: source quiz code mismatch`);
  const q=(quiz.questions||[]).find(x=>Number(x.id)===Number(e.questionId));
  if(!q) fail(`${e.id}: source questionId ${e.questionId} missing`);
  if(nfc(q.text)!==nfc(e.stem)) fail(`${e.id}: source stem mismatch`);
  if(!Array.isArray(q.options)||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length) fail(`${e.id}: source answer invalid`);
  const correct=q.options[q.answer];
  if(nfc(correct)!==nfc(e.correctAnswer)) fail(`${e.id}: source correctAnswer mismatch`);
  return {quiz,q,file};
}
function completeQuizBatchCheck(entries){
  const byQuiz=new Map(); for(const e of entries){if(!byQuiz.has(e.quizCode))byQuiz.set(e.quizCode,[]);byQuiz.get(e.quizCode).push(e);}
  for(const [code,list] of byQuiz){
    const file=sourceFileForQuiz(code), quiz=readJson(file), sourceIds=(quiz.questions||[]).map(q=>Number(q.id)).sort((a,b)=>a-b);
    const batchIds=list.map(e=>Number(e.questionId)).sort((a,b)=>a-b);
    if(sourceIds.length!==batchIds.length||sourceIds.some((v,i)=>v!==batchIds[i])) fail(`${code}: batch must contain all source questions (${sourceIds.length})`);
  }
}

function emptyShard(range){ return {schemaVersion:2,range:{startQuiz:range.start,endQuiz:range.end},entries:{}}; }
function loadShardByRecord(rec){ if(!fs.existsSync(rec.path)) fail(`shard missing: ${rec.path}`); return readJson(rec.path); }
function shardRecord(shard,range,spec){
  const entries=Object.values(shard.entries||{}).filter(e=>e.status!=="retired");
  const quizCounts={}; for(const e of entries) quizCounts[e.quizCode]=(quizCounts[e.quizCode]||0)+1;
  const topics=[...new Set(entries.map(topicKey).filter(Boolean))].sort();
  const tokens=entries.flatMap(entryTokens);
  const bloom=bloomCreate(tokens,Number(spec.bloom.bits),Number(spec.bloom.hashFunctions));
  const text=stableJson(shard);
  const nums=Object.keys(quizCounts).map(sourceQuizNumber).filter(Number.isInteger).sort((a,b)=>a-b);
  return {
    id:range.id,path:range.path,startQuiz:range.start,endQuiz:range.end,
    entryCount:entries.length,quizQuestionCounts:quizCounts,
    firstIndexedQuiz:nums.length?`YQ${nums[0]}`:null,lastIndexedQuiz:nums.length?`YQ${nums.at(-1)}`:null,
    topics,bloomBase64:bloom,sha256:sha256Text(text)
  };
}
function recById(manifest,id){ return (manifest.shards||[]).find(r=>r.id===id); }
function recIndex(manifest,id){ return (manifest.shards||[]).findIndex(r=>r.id===id); }
function updateCoverage(manifest){
  const counts={}; let total=0;
  for(const rec of manifest.shards||[]){ total+=Number(rec.entryCount||0); for(const [q,c] of Object.entries(rec.quizQuestionCounts||{})) counts[q]=Number(c||0); }
  const complete=Object.entries(counts).filter(([,c])=>c===10).map(([q])=>sourceQuizNumber(q)).filter(Number.isInteger).sort((a,b)=>a-b);
  const completeSet=new Set(complete); let cont=null; for(let n=133;completeSet.has(n);n++)cont=n;
  const max=complete.length?Math.max(...complete):null;
  manifest.semantic.indexedQuestionCount=total;
  manifest.semantic.indexedQuizCount=complete.length;
  manifest.semantic.lastIndexedQuiz=max?`YQ${max}`:null;
  manifest.semantic.contiguousThroughQuiz=cont?`YQ${cont}`:null;
  manifest.generatedAt=new Date().toISOString();
}
function validateShard(shard,rec,spec,{source=false}={}){
  if(Number(shard?.range?.startQuiz)!==Number(rec.startQuiz)||Number(shard?.range?.endQuiz)!==Number(rec.endQuiz)) fail(`${rec.id}: shard range mismatch`);
  const seenStem=new Map(),seenSig=new Map(),seenFact=new Map();
  for(const [id,e0] of Object.entries(shard.entries||{})){
    if(id!==e0.id) fail(`${rec.id}/${id}: key != id`);
    const e={...e0}; validateEntryShape(e,spec);
    if(e.semanticSignature!==semanticSignature(e)) fail(`${e.id}: semanticSignature mismatch`);
    if(source) sourceQuestion(e);
    if(e.status==="retired") continue;
    const checks=[["stem",norm(e.stem),seenStem],["signature",e.semanticSignature,seenSig],["factCluster",norm(e.factCluster),seenFact]];
    for(const [label,key,map] of checks){ if(map.has(key)) fail(`${e.id}: duplicate ${label} with ${map.get(key)}`); map.set(key,e.id); }
  }
  const range={start:rec.startQuiz,end:rec.endQuiz,id:rec.id,path:rec.path};
  const rebuilt=shardRecord(shard,range,spec);
  for(const f of ["entryCount","firstIndexedQuiz","lastIndexedQuiz","bloomBase64","sha256"]){ if(JSON.stringify(rebuilt[f])!==JSON.stringify(rec[f])) fail(`${rec.id}: ${f} metadata mismatch`); }
  if(JSON.stringify(rebuilt.quizQuestionCounts)!==JSON.stringify(rec.quizQuestionCounts)) fail(`${rec.id}: quizQuestionCounts mismatch`);
  if(JSON.stringify(rebuilt.topics)!==JSON.stringify(rec.topics)) fail(`${rec.id}: topics mismatch`);
}
function fullValidate(manifest,spec,{source=false}={}){
  if(String(manifest.specVersion)!==String(spec.version)) fail("manifest/spec version mismatch");
  const globalStem=new Map(),globalSig=new Map(),globalFact=new Map();
  for(const rec of manifest.shards||[]){
    const shard=loadShardByRecord(rec); validateShard(shard,rec,spec,{source});
    for(const e of Object.values(shard.entries||{})){
      if(e.status==="retired")continue;
      for(const [label,key,map] of [["stem",norm(e.stem),globalStem],["signature",e.semanticSignature,globalSig],["factCluster",norm(e.factCluster),globalFact]]){
        if(map.has(key)) fail(`${e.id}: global duplicate ${label} with ${map.get(key)}`); map.set(key,e.id);
      }
    }
  }
  const copy=clone(manifest); updateCoverage(copy);
  for(const f of ["indexedQuestionCount","indexedQuizCount","lastIndexedQuiz","contiguousThroughQuiz"]){ if(JSON.stringify(copy.semantic[f])!==JSON.stringify(manifest.semantic[f])) fail(`manifest semantic.${f} mismatch`); }
  console.log(`PASS: ${manifest.semantic.indexedQuestionCount} semantic entries / ${manifest.semantic.indexedQuizCount} complete quiz(es) / ${manifest.shards.length} shard(s)`);
}
function candidateShardRecords(manifest,spec,entry){
  const tokens=entryTokens(entry), bits=Number(spec.bloom.bits),k=Number(spec.bloom.hashFunctions),out=[];
  for(const rec of manifest.shards||[]){
    const hits=tokens.filter(t=>bloomHas(rec.bloomBase64,t,bits,k));
    if(hits.length)out.push({rec,hits});
  }
  return out;
}
function hardDuplicateCheck(manifest,spec,newEntries,{excludeIds=new Set()}={}){
  const local={stem:new Map(),sig:new Map(),fact:new Map()};
  for(const e of newEntries){
    const values={stem:norm(e.stem),sig:e.semanticSignature,fact:norm(e.factCluster)};
    for(const [label,key] of Object.entries(values)){ if(local[label].has(key)) fail(`${e.id}: batch duplicate ${label} with ${local[label].get(key)}`); local[label].set(key,e.id); }
    const candidates=candidateShardRecords(manifest,spec,e);
    for(const {rec} of candidates){
      const shard=loadShardByRecord(rec);
      for(const old of Object.values(shard.entries||{})){
        if(old.status==="retired"||excludeIds.has(old.id))continue;
        if(norm(old.stem)===values.stem) fail(`${e.id}: duplicate stem with ${old.id}`);
        if(old.semanticSignature===values.sig) fail(`${e.id}: duplicate semantic signature with ${old.id}`);
        if(norm(old.factCluster)===values.fact) fail(`${e.id}: duplicate factCluster with ${old.id}`);
      }
    }
  }
}
function writeTransaction(files){
  const staged=[],backs=[];
  try{
    for(const [target,text] of files){ fs.mkdirSync(path.dirname(target),{recursive:true}); const tmp=`${target}.tmp-${process.pid}-${Date.now()}`; fs.writeFileSync(tmp,text); staged.push([target,tmp]); }
    for(const [target,tmp] of staged){ const bak=`${target}.bak-${process.pid}-${Date.now()}`; if(fs.existsSync(target)){fs.renameSync(target,bak);backs.push([target,bak]);} fs.renameSync(tmp,target); }
    for(const [,bak] of backs) if(fs.existsSync(bak))fs.unlinkSync(bak);
  }catch(e){
    for(const [target,bak] of backs.reverse()){ if(fs.existsSync(target))fs.unlinkSync(target); if(fs.existsSync(bak))fs.renameSync(bak,target); }
    for(const [,tmp] of staged) if(fs.existsSync(tmp))fs.unlinkSync(tmp);
    throw e;
  }
}
function prepareEntries(rawEntries,spec){
  if(!Array.isArray(rawEntries)||!rawEntries.length) fail("batch.entries empty");
  const entries=rawEntries.map(raw=>{const e=clone(raw);validateEntryShape(e,spec);e.semanticSignature=semanticSignature(e);sourceQuestion(e);return e;});
  return entries;
}
function applyBatch(manifest,spec,batch,{replace=false}={}){
  const entries=prepareEntries(batch.entries,spec); if(!replace)completeQuizBatchCheck(entries);
  const ids=new Set(entries.map(e=>e.id));
  if(ids.size!==entries.length) fail("batch duplicate entry ids");
  if(!replace) hardDuplicateCheck(manifest,spec,entries);
  else hardDuplicateCheck(manifest,spec,entries,{excludeIds:ids});

  const nextManifest=clone(manifest), shardMap=new Map(), ranges=new Map();
  for(const e of entries){
    const range=shardRange(sourceQuizNumber(e.quizCode),spec); ranges.set(range.id,range);
    if(!shardMap.has(range.id)){
      const rec=recById(nextManifest,range.id); shardMap.set(range.id,rec?loadShardByRecord(rec):emptyShard(range));
    }
    const shard=shardMap.get(range.id);
    const exists=!!shard.entries[e.id];
    if(replace&&!exists) fail(`${e.id}: replace target missing`);
    if(!replace&&exists) fail(`${e.id}: entry already exists`);
    shard.entries[e.id]=e;
  }
  const writes=[];
  for(const [id,shard] of shardMap){
    const range=ranges.get(id),rec=shardRecord(shard,range,spec),idx=recIndex(nextManifest,id);
    if(idx>=0)nextManifest.shards[idx]=rec;else nextManifest.shards.push(rec);
    nextManifest.shards.sort((a,b)=>a.startQuiz-b.startQuiz);
    // Validate new shard in memory (metadata/source) before any file write.
    validateShard(shard,rec,spec,{source:true});
    writes.push([range.path,stableJson(shard)]);
  }
  updateCoverage(nextManifest);
  // coverage + global duplicate integrity is checked against candidate state. For unchanged shards, manifest Bloom metadata is trusted from prior validate.
  writes.push([MANIFEST_FILE,stableJson(nextManifest)]);
  writeTransaction(writes);
  console.log(`PASS: ${replace?"replaced":"applied"} ${entries.length} entries; contiguous through ${nextManifest.semantic.contiguousThroughQuiz||"none"}`);
}
function removeQuiz(manifest,spec,code){
  const qn=sourceQuizNumber(code); if(qn===null) fail("usage: remove-quiz YQxxx");
  const range=shardRange(qn,spec),rec=recById(manifest,range.id); if(!rec) fail(`${code}: shard not found`);
  const shard=loadShardByRecord(rec),ids=Object.values(shard.entries||{}).filter(e=>e.quizCode===code).map(e=>e.id); if(!ids.length)fail(`${code}: no entries`);
  for(const id of ids)delete shard.entries[id];
  const next=clone(manifest),idx=recIndex(next,range.id),writes=[];
  if(Object.keys(shard.entries).length){ const nr=shardRecord(shard,range,spec); next.shards[idx]=nr; validateShard(shard,nr,spec,{source:false}); writes.push([range.path,stableJson(shard)]); }
  else { next.shards.splice(idx,1); }
  updateCoverage(next); writes.push([MANIFEST_FILE,stableJson(next)]); writeTransaction(writes);
  console.log(`PASS: removed ${code} (${ids.length} entries)`);
}
function query(manifest,spec,q){
  const tokens=queryTokens(q),bits=Number(spec.bloom.bits),k=Number(spec.bloom.hashFunctions),topic=topicKey(q),rows=[];
  for(const rec of manifest.shards||[]){
    const hits=tokens.filter(t=>bloomHas(rec.bloomBase64,t,bits,k)); const topicHit=topic&&rec.topics?.includes(topic);
    if(hits.length||topicHit)rows.push({path:rec.path,exactTokenHits:hits,topicFallback:!!topicHit});
  }
  console.log(JSON.stringify({candidateShards:rows,legacyFallbackRequired:true},null,2));
}

try{
  const cmd=process.argv[2]||"validate";
  if(!fs.existsSync(MANIFEST_FILE)||!fs.existsSync(SPEC_FILE)) fail("manifest/spec file missing");
  const manifest=readJson(MANIFEST_FILE),spec=readJson(SPEC_FILE);
  if(cmd==="validate") fullValidate(manifest,spec,{source:process.argv.includes("--source")});
  else if(cmd==="apply"){const f=process.argv[3];if(!f)fail("usage: apply BATCH.json");applyBatch(manifest,spec,readJson(f),{replace:false});}
  else if(cmd==="replace"){const f=process.argv[3];if(!f)fail("usage: replace BATCH.json");applyBatch(manifest,spec,readJson(f),{replace:true});}
  else if(cmd==="remove-quiz"){const code=String(process.argv[3]||"").toUpperCase();removeQuiz(manifest,spec,code);}
  else if(cmd==="query"){const f=process.argv[3];if(!f)fail("usage: query QUERY.json");query(manifest,spec,readJson(f));}
  else fail("commands: validate [--source] | apply BATCH.json | replace BATCH.json | remove-quiz YQxxx | query QUERY.json");
}catch(e){die(e);}
