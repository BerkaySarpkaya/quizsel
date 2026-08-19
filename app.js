const CFG = window.QUIZSEL_CONFIG;

firebase.initializeApp(CFG.firebase);
const auth = firebase.auth();
const db = firebase.database();
const TS = firebase.database.ServerValue.TIMESTAMP;
const $ = id => document.getElementById(id);
const CLIENT_VERSION = "0.8.1";

let authMode = "login";
let profile = null;
let currentRoom = null;
let currentGame = null;
let currentQuiz = null;
let roomRef = null;
let roomListener = null;
let serverOffset = 0;
let phaseTimer = null;
let hostTimer = null;
let hostTimerKey = "";
let finalRecordedKey = "";
let lastLobbyPlayerSignature = null;
let roomPresencePin = null;
let roomPresenceDisconnect = null;
let currentQuestionVisual = null;
let pendingDecisionAction = null;
let intentionalRoomExit = false;
const quizSeenRoomMarks = new Set();

db.ref(".info/connected").on("value", async s => {
  const live = !!s.val();
  $("connDot")?.classList.toggle("live", live);
  if ($("connText")) $("connText").textContent = live ? "Bağlı" : "Çevrimdışı";
  const banner = $("connectionBanner");
  if (banner){
    banner.classList.toggle("show", !live);
    $("connectionBannerText").textContent = live ? "Bağlandı" : "Bağlantı koptu — oyun korunuyor, yeniden bağlanınca devam edecek.";
  }
  if (live && currentRoom && currentGame?.meta && amHost()){
    await setupHostPresence(true).catch(()=>{});
    coordinateHost();
  }
});

db.ref(".info/serverTimeOffset").on("value", s => {
  serverOffset = s.val() || 0;
});

const serverNow = () => Date.now() + serverOffset;

function go(name){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $("view-" + name)?.classList.add("active");
  window.scrollTo({top:0,behavior:"instant"});
}

function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1900);
}

function showErr(id,msg){
  const e = $(id);
  e.textContent = msg;
  e.classList.add("show");
}

function clearErr(id){
  $(id)?.classList.remove("show");
}

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function normalizeUsername(raw){
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replaceAll("ı","i").replaceAll("ş","s").replaceAll("ğ","g")
    .replaceAll("ü","u").replaceAll("ö","o").replaceAll("ç","c")
    .replace(/\s+/g,"_")
    .replace(/[^a-z0-9_]/g,"");
}

function hiddenEmail(rawUsername){
  return `${normalizeUsername(rawUsername)}@${CFG.usernameDomain}`;
}

function initials(name){
  return (name || "?").trim().slice(0,1).toUpperCase();
}

function roomPin(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

function qKey(i){
  return "q" + i;
}

function isAdmin(user = auth.currentUser){
  return !!user && user.email === CFG.adminInternalEmail;
}

function stopPhaseTimer(){
  if (phaseTimer){
    clearInterval(phaseTimer);
    phaseTimer = null;
  }
}

function stopHostTimer(){
  if (hostTimer){
    clearTimeout(hostTimer);
    hostTimer = null;
  }
  hostTimerKey = "";
}

function stopRoomWatch(){
  stopPhaseTimer();
  stopHostTimer();
  if (roomPresenceDisconnect){
    roomPresenceDisconnect.cancel().catch(()=>{});
  }

  if (roomRef && roomListener){
    roomRef.off("value", roomListener);
  }

  roomRef = null;
  roomListener = null;
  currentRoom = null;
  currentGame = null;
  currentQuiz = null;
  lastLobbyPlayerSignature = null;
  roomPresencePin = null;
  roomPresenceDisconnect = null;
}


async function setupHostPresence(force=false){
  if (!currentRoom || !amHost()) return;
  if (roomPresencePin === currentRoom && !force) return;
  roomPresencePin = currentRoom;
  const onlineRef = db.ref(`games/${currentRoom}/meta/hostOnline`);
  roomPresenceDisconnect = onlineRef.onDisconnect();
  await roomPresenceDisconnect.set(false);
  await db.ref(`games/${currentRoom}/meta`).update({hostOnline:true,hostLastSeenAt:TS});
}
function estimateQuizMinutes(){
  if (!currentQuiz?.questions?.length) return 1;
  const qSec=currentQuiz.questions.length * Number(CFG.questionSeconds || 15);
  const tSec=currentQuiz.questions.length*Number(CFG.revealSeconds||5)+Math.max(0,currentQuiz.questions.length-1)*2.2+Number(CFG.countdownSeconds||3);
  return Math.max(1,Math.round((qSec+tSec)/60));
}
async function maybeResetReadyAfterRosterChange(){
  if (!amHost() || currentGame?.meta?.state !== 'lobby') return;
  const ids=Object.keys(currentGame?.players||{}).sort(); const sig=ids.join('|');
  if (lastLobbyPlayerSignature===null){lastLobbyPlayerSignature=sig;return;}
  if (sig===lastLobbyPlayerSignature) return;
  lastLobbyPlayerSignature=sig;
  const updates={}; ids.forEach(uid=>updates[`players/${uid}/ready`]=false);
  if (Object.keys(updates).length){await db.ref(`games/${currentRoom}`).update(updates);toast('Oyuncu listesi değişti · Hazır durumları sıfırlandı.');}
}
async function kickPlayer(uid){
  if (!amHost() || !uid || uid===auth.currentUser?.uid) return;
  await db.ref(`games/${currentRoom}/players/${uid}`).remove();
}
function questionTypeLabel(q){
  if (q?.questionType==='image-choice'||q?.image) return 'Görsel soru';
  if (q?.questionType==='true-false') return 'Doğru / Yanlış';
  return 'Çoktan seçmeli';
}
function openQuestionImage(){
  if (!currentQuestionVisual?.src) return;
  $('imageModalImg').src=currentQuestionVisual.src;$('imageModalImg').alt=currentQuestionVisual.alt||'Soru görseli';$('imageModalCredit').textContent=currentQuestionVisual.credit||'';$('imageModal').classList.add('show');
}
function closeQuestionImage(){$('imageModal').classList.remove('show');}
function playerStats(uid){
  const n=currentQuiz?.questions?.length||currentGame?.meta?.totalQuestions||0;let correct=0,answered=0,totalElapsed=0;
  for(let i=0;i<n;i++){const a=currentGame?.answers?.[qKey(i)]?.[uid];if(!a)continue;answered++;if(a.correct===true)correct++;totalElapsed+=Number(a.elapsedMs||0);}
  return {correct,answered,avgMs:answered?Math.round(totalElapsed/answered):0};
}
function detailedLeaderRows(){return leaderRows().map(r=>({...r,...playerStats(r.uid)}));}
function formatSeconds(ms){return !ms?'—':(ms/1000).toFixed(1).replace('.',',')+' sn';}
function podiumCard(r,place){if(!r)return '<div></div>';const cls=place===1?'first':place===2?'second':'third';return `<div class="podiumCard ${cls}"><div class="podiumPlace">${place}</div><div class="podiumName">${esc(r.name)}</div><div class="podiumScore">${r.score} puan</div><div class="podiumMeta">${r.correct}/${currentGame.meta.totalQuestions} doğru<br>Ort. ${formatSeconds(r.avgMs)}</div></div>`;}
function detailedLeaderHtml(rows){return rows.map((r,i)=>`<li class="${r.uid===auth.currentUser.uid?'me':''}"><span class="rank">${i+1}</span><div><strong>${esc(r.name)}</strong><div class="finalPlayerSub">${r.correct}/${currentGame.meta.totalQuestions} doğru · Ort. ${formatSeconds(r.avgMs)}</div></div><span class="score">${r.score}</span></li>`).join('');}
function celebrateFinal(){const layer=$('confettiLayer');if(!layer)return;layer.innerHTML='';for(let i=0;i<30;i++){const s=document.createElement('i');s.className='confetti';s.style.left=(3+Math.random()*94)+'%';s.style.animationDuration=(2.2+Math.random()*1.8)+'s';s.style.animationDelay=(Math.random()*.55)+'s';s.style.setProperty('--drift',((Math.random()-.5)*180)+'px');layer.appendChild(s);}setTimeout(()=>layer.innerHTML='',4500);}
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||!currentRoom)return;try{const snap=await db.ref(`games/${currentRoom}`).get();if(snap.exists()){currentGame=snap.val();renderRoom();if(amHost()){await setupHostPresence().catch(()=>{});coordinateHost();}}}catch{}});


function avatarHue(name){
  let h = 0;
  const s = String(name || "?");
  for (let i=0;i<s.length;i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function avatarHtml(name, {size="", host=false, mark=""} = {}){
  const cls = ["avatarWrap", size, host ? "host" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" style="--avatar-h:${avatarHue(name)}">
    <div class="avatar">${esc(initials(name))}</div>
    ${mark ? `<span class="avatarMark">${esc(mark)}</span>` : ""}
  </div>`;
}


async function backfillLegacyQuizHistory(){
  const user = auth.currentUser;
  if (!user || isAdmin(user) || profile?.historyMigratedAt) return;

  const snap = await db.ref(`activityLogs/${user.uid}`).get().catch(()=>null);
  const logs = Object.values(snap?.val() || {});
  const byQuiz = {};

  logs.forEach(log => {
    if (log?.type !== "game_finished" || !log.quizCode) return;
    const code = String(log.quizCode).toUpperCase();
    byQuiz[code] = byQuiz[code] || {
      seenCount:0,
      completedCount:0,
      lastAt:0,
      lastRoom:""
    };
    byQuiz[code].seenCount += 1;
    byQuiz[code].completedCount += 1;
    if (Number(log.at || 0) >= byQuiz[code].lastAt){
      byQuiz[code].lastAt = Number(log.at || 0);
      byQuiz[code].lastRoom = String(log.room || "").slice(0,12);
    }
  });

  for (const [code, legacy] of Object.entries(byQuiz)){
    await db.ref(`profiles/${user.uid}/quizHistory/${code}`).transaction(h => {
      h = h || {};
      h.seen = true;
      h.seenCount = Math.max(Number(h.seenCount || 0), legacy.seenCount);
      h.completedCount = Math.max(Number(h.completedCount || 0), legacy.completedCount);
      h.lastSeenAt = Math.max(Number(h.lastSeenAt || 0), legacy.lastAt || serverNow());
      h.lastCompletedAt = Math.max(Number(h.lastCompletedAt || 0), legacy.lastAt || serverNow());
      h.lastRoom = h.lastRoom || legacy.lastRoom || "legacy";
      h.lastCompletedRoom = h.lastCompletedRoom || legacy.lastRoom || "legacy";
      return h;
    });
  }

  await db.ref(`profiles/${user.uid}/historyMigratedAt`).set(TS);
  const refreshed = await db.ref(`profiles/${user.uid}`).get();
  profile = refreshed.val() || profile;
}

function priorQuizInfo(code){
  const h = profile?.quizHistory?.[code] || {};
  return {
    seen: !!h.seen,
    seenCount: Number(h.seenCount || 0),
    completedCount: Number(h.completedCount || 0)
  };
}

async function markQuizSeen(){
  const user = auth.currentUser;
  const code = currentGame?.meta?.quizCode;
  if (!user || !code || !currentRoom || isAdmin(user)) return;

  const markKey = `${currentRoom}:${code}:${user.uid}`;
  if (quizSeenRoomMarks.has(markKey)) return;
  quizSeenRoomMarks.add(markKey);

  const ref = db.ref(`profiles/${user.uid}/quizHistory/${code}`);
  const room = currentRoom;
  const now = serverNow();

  const tx = await ref.transaction(h => {
    h = h || {};
    const isNewRoom = h.lastRoom !== room;
    h.seen = true;
    h.seenCount = Number(h.seenCount || 0) + (isNewRoom ? 1 : 0);
    h.lastSeenAt = now;
    h.lastRoom = room;
    h.completedCount = Number(h.completedCount || 0);
    return h;
  });

  if (tx.committed){
    profile = profile || {};
    profile.quizHistory = profile.quizHistory || {};
    profile.quizHistory[code] = tx.snapshot.val();
  }
}

async function markQuizCompleted(){
  const user = auth.currentUser;
  const code = currentGame?.meta?.quizCode;
  if (!user || !code || !currentRoom || isAdmin(user)) return;

  const room = currentRoom;
  const ref = db.ref(`profiles/${user.uid}/quizHistory/${code}`);
  const now = serverNow();

  const tx = await ref.transaction(h => {
    h = h || {};
    h.seen = true;
    h.seenCount = Math.max(1, Number(h.seenCount || 0));
    if (h.lastCompletedRoom !== room){
      h.completedCount = Number(h.completedCount || 0) + 1;
    }
    h.lastCompletedRoom = room;
    h.lastCompletedAt = now;
    h.lastSeenAt = h.lastSeenAt || now;
    h.lastRoom = h.lastRoom || room;
    return h;
  });

  if (tx.committed){
    profile = profile || {};
    profile.quizHistory = profile.quizHistory || {};
    profile.quizHistory[code] = tx.snapshot.val();
  }
}

function openDecision({kicker="Yarışma", title, message, confirmLabel, danger=false, action}){
  pendingDecisionAction = action || null;
  $("decisionKicker").textContent = kicker;
  $("decisionTitle").textContent = title;
  $("decisionMessage").textContent = message;
  $("decisionActions").innerHTML = `
    <button class="btn ${danger ? "danger" : "primary"}" onclick="runDecision()">${esc(confirmLabel)}</button>
  `;
  $("decisionModal").classList.add("show");
  $("decisionModal").setAttribute("aria-hidden","false");
}

function closeDecision(){
  pendingDecisionAction = null;
  $("decisionModal").classList.remove("show");
  $("decisionModal").setAttribute("aria-hidden","true");
}

async function runDecision(){
  const action = pendingDecisionAction;
  closeDecision();
  if (typeof action === "function") await action();
}

function confirmLeaveCompetition(){
  if (!currentRoom || !currentGame) return renderHome();

  const remaining = playersArray().filter(p => p.uid !== auth.currentUser?.uid);
  const host = amHost();

  const message = host
    ? (remaining.length
        ? "Kuruculuk odadaki başka bir oyuncuya geçecek. Sen yarışmadan çıkacaksın ama yarışma devam edecek."
        : "Odada senden başka oyuncu yok. Çıkarsan bu oda kapanacak.")
    : (currentGame.meta.state === "lobby"
        ? "Lobiden ayrılacaksın. İstersen oyun başlamadan önce kodla tekrar katılabilirsin."
        : "Yarışmadan ayrılacaksın. Oyun başladıktan sonra bu odaya tekrar katılamazsın.");

  openDecision({
    title:"Yarışmadan çıkılsın mı?",
    message,
    confirmLabel:"Evet, yarışmadan çık",
    danger:false,
    action:leaveCompetition
  });
}

function confirmTerminateCompetition(){
  if (!amHost()) return;
  openDecision({
    title:"Yarışma sonlandırılsın mı?",
    message:"Oda tamamen kapanacak ve tüm oyuncular yarışmadan çıkarılacak. Bu işlem geri alınamaz.",
    confirmLabel:"Evet, yarışmayı sonlandır",
    danger:true,
    action:terminateCompetition
  });
}

async function removeOwnAnswerData(pin, uid, game){
  const keys = Object.keys(game?.answers || {});
  await Promise.all(keys.map(k =>
    db.ref(`games/${pin}/answers/${k}/${uid}`).remove().catch(()=>{})
  ));
}

async function leaveCompetition(){
  const uid = auth.currentUser?.uid;
  const pin = currentRoom;
  if (!uid || !pin || !currentGame) return renderHome();

  intentionalRoomExit = true;
  const freshSnap = await db.ref(`games/${pin}`).get().catch(()=>null);

  if (!freshSnap?.exists()){
    localStorage.removeItem("quizsel_room");
    stopRoomWatch();
    intentionalRoomExit = false;
    return renderHome();
  }

  const game = freshSnap.val();
  const wasHost = game.meta?.hostUid === uid;
  const players = Object.entries(game.players || {})
    .map(([id,p]) => ({uid:id,...p}))
    .sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0));
  const remaining = players.filter(p => p.uid !== uid);

  if (wasHost){
    if (remaining.length === 0){
      await logActivity("game_left", {room:pin, quizCode:game.meta?.quizCode, host:true});
      await db.ref(`games/${pin}`).remove();
    }else{
      const nextHost = remaining[0];
      const updates = {
        "meta/hostUid": nextHost.uid,
        "meta/hostName": nextHost.name || "Oyuncu",
        "meta/hostOnline": false,
        "meta/hostLastSeenAt": TS,
        [`players/${uid}`]: null
      };

      Object.keys(game.answers || {}).forEach(k => {
        updates[`answers/${k}/${uid}`] = null;
      });

      await db.ref(`games/${pin}`).update(updates);
      await logActivity("game_left", {
        room:pin,
        quizCode:game.meta?.quizCode,
        host:true,
        transferredTo:nextHost.uid
      });
    }
  }else{
    await removeOwnAnswerData(pin, uid, game);
    await db.ref(`games/${pin}/players/${uid}`).remove();
    await logActivity("game_left", {room:pin, quizCode:game.meta?.quizCode, host:false});
  }

  localStorage.removeItem("quizsel_room");
  stopRoomWatch();
  intentionalRoomExit = false;
  renderHome();
  toast("Yarışmadan çıktın.");
}

async function terminateCompetition(){
  if (!amHost() || !currentRoom) return;
  const pin = currentRoom;
  const quizCode = currentGame?.meta?.quizCode;

  intentionalRoomExit = true;
  await logActivity("game_terminated", {room:pin, quizCode});
  await db.ref(`games/${pin}`).remove();

  localStorage.removeItem("quizsel_room");
  stopRoomWatch();
  intentionalRoomExit = false;
  renderHome();
  toast("Yarışma sonlandırıldı.");
}

function togglePassword(id, btn){
  const input = $(id);
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.textContent = show ? "Gizle" : "Göster";
}

function firebaseErrorMessage(e){
  const c = e?.code || "";

  if (
    c.includes("invalid-credential") ||
    c.includes("wrong-password") ||
    c.includes("user-not-found") ||
    c.includes("invalid-login-credentials")
  ){
    return "Kullanıcı adı veya şifre yanlış.";
  }

  if (c.includes("email-already-in-use")){
    return "Bu kullanıcı adı alınmış.";
  }

  if (c.includes("weak-password")){
    return "Şifre en az 6 karakter olmalı.";
  }

  if (c.includes("too-many-requests")){
    return "Çok fazla giriş denemesi yapıldı. Bir süre sonra tekrar dene.";
  }

  if (c.includes("network-request-failed")){
    return "İnternet bağlantısı kurulamadı.";
  }

  if (c.includes("operation-not-allowed")){
    return "Firebase Authentication'da Email/Password henüz açılmamış.";
  }

  return e?.message || "Bir hata oluştu.";
}

function setAuthMode(mode){
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
  $("authBtn").textContent = mode === "login" ? "Giriş yap" : "Hesap oluştur";
  $("authPassword").setAttribute(
    "autocomplete",
    mode === "login" ? "current-password" : "new-password"
  );
  clearErr("authErr");
}

async function submitAuth(){
  clearErr("authErr");

  const rawUsername = $("authUsername").value.trim();
  const usernameKey = normalizeUsername(rawUsername);
  const password = $("authPassword").value;

  if (usernameKey.length < 3 || usernameKey.length > 20){
    return showErr("authErr","Kullanıcı adı 3–20 karakter olmalı.");
  }

  if (["admin","yonetici","quizsel-admin"].includes(usernameKey)){
    return showErr("authErr","Bu kullanıcı adı ayrılmıştır.");
  }

  if (password.length < 6){
    return showErr("authErr","Şifre en az 6 karakter olmalı.");
  }

  $("authBtn").disabled = true;

  try{
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

    if (authMode === "register"){
      const cred = await auth.createUserWithEmailAndPassword(
        hiddenEmail(usernameKey),
        password
      );

      const display = rawUsername || usernameKey;

      await cred.user.updateProfile({displayName: display});

      await db.ref("profiles/" + cred.user.uid).set({
        username: display,
        usernameKey,
        createdAt: TS,
        lastSeenAt: TS,
        stats: {
          games: 0,
          wins: 0,
          points: 0
        }
      });

      await db.ref(`activityLogs/${cred.user.uid}`).push({
        type: "account_created",
        at: TS
      });

      profile = {
        username: display,
        usernameKey,
        stats: {games:0,wins:0,points:0}
      };

    }else{
      await auth.signInWithEmailAndPassword(
        hiddenEmail(usernameKey),
        password
      );

      await loadProfile();

      await db.ref(`profiles/${auth.currentUser.uid}/lastSeenAt`).set(TS);
      await logActivity("login");
    }

    await restoreRoomOrHome();

  }catch(e){
    showErr("authErr", firebaseErrorMessage(e));
  }finally{
    $("authBtn").disabled = false;
  }
}

function openAdminLogin(){
  clearErr("adminErr");
  $("adminPassword").value = "";
  go("adminlogin");
}

async function adminLogin(){
  clearErr("adminErr");

  const password = $("adminPassword").value;
  if (!password){
    return showErr("adminErr","Yönetici şifresini gir.");
  }

  $("adminBtn").disabled = true;

  try{
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    await auth.signOut();

    await auth.signInWithEmailAndPassword(
      CFG.adminInternalEmail,
      password
    );

    if (!isAdmin()){
      await auth.signOut();
      throw new Error("Yönetici hesabı doğrulanamadı.");
    }

    await renderAdmin();
    go("admin");

  }catch(e){
    showErr("adminErr", firebaseErrorMessage(e));
  }finally{
    $("adminBtn").disabled = false;
  }
}

async function logoutToAuth(){
  stopRoomWatch();
  localStorage.removeItem("quizsel_room");
  profile = null;
  await auth.signOut().catch(() => {});
  $("authPassword").value = "";
  $("adminPassword").value = "";
  setAuthMode("login");
  go("auth");
}

async function loadProfile(){
  const user = auth.currentUser;
  if (!user || isAdmin(user)) return;

  const snap = await db.ref("profiles/" + user.uid).get();

  profile = snap.val() || {
    username: user.displayName || "Oyuncu",
    usernameKey: "",
    stats: {games:0,wins:0,points:0}
  };

  await backfillLegacyQuizHistory().catch(()=>{});
}

async function logActivity(type, extra = {}){
  const user = auth.currentUser;
  if (!user || isAdmin(user)) return;

  await db.ref(`activityLogs/${user.uid}`).push({
    type,
    at: TS,
    ...extra
  }).catch(() => {});
}

function renderHome(){
  const name = profile?.username || auth.currentUser?.displayName || "Oyuncu";
  const stats = profile?.stats || {games:0,wins:0,points:0};

  $("profileCard").innerHTML = `
    ${avatarHtml(name,{host:false})}
    <div class="grow">
      <div class="name">${esc(name)}</div>
      <div class="sub">Quizsel hesabı</div>
    </div>
    <span class="badge green">Giriş yapıldı</span>
  `;

  $("profileStats").innerHTML = `
    <div class="profileStat"><b>${stats.games || 0}</b><span>OYUN</span></div>
    <div class="profileStat"><b>${stats.wins || 0}</b><span>BİRİNCİLİK</span></div>
    <div class="profileStat"><b>${stats.points || 0}</b><span>PUAN</span></div>
  `;

  $("homePin").value = "";
  go("home");
}

async function restoreRoomOrHome(){
  const saved = JSON.parse(localStorage.getItem("quizsel_room") || "null");

  if (saved?.pin){
    const snap = await db.ref("games/" + saved.pin + "/meta").get().catch(() => null);

    if (snap?.exists()){
      watchRoom(saved.pin);
      return;
    }

    localStorage.removeItem("quizsel_room");
  }

  renderHome();
}

async function loadManifest(){
  const r = await fetch(`quiz-index.json?t=${Date.now()}`, {cache:"no-store"});
  if (!r.ok) throw new Error("Quiz listesi yüklenemedi.");
  return r.json();
}

async function loadQuiz(code){
  const clean = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g,"");

  if (!clean) throw new Error("Quiz kodu boş.");

  const r = await fetch(`${clean}.json?t=${Date.now()}`, {cache:"no-store"});

  if (!r.ok) throw new Error(`${clean} bulunamadı.`);

  const q = await r.json();

  if (!q.code || !Array.isArray(q.questions) || q.questions.length < 1){
    throw new Error("Quiz dosyası geçerli değil.");
  }

  return q;
}

async function openQuizBrowser(){
  go("quizzes");
  clearErr("quizCodeErr");

  const list = $("quizList");
  list.innerHTML = '<div class="empty">Quizler yükleniyor…</div>';

  try{
    const m = await loadManifest();
    list.innerHTML = "";

    m.quizzes.forEach(meta => list.appendChild(quizCard(meta)));

  }catch(e){
    list.innerHTML = `
      <div class="empty">
        ${esc(e.message)}
        <br><span class="tiny">Kodla açma yine kullanılabilir.</span>
      </div>
    `;
  }
}

function quizCard(meta){
  const d = document.createElement("div");
  d.className = "quizCard";

  d.innerHTML = `
    <div class="quizTop">
      <div class="quizMeta">
        <div class="code">${esc(meta.code)}</div>
        <h3>${esc(meta.title)}</h3>
        <div class="quizBadges">
          <span class="badge">${esc(meta.category || "Quiz")}</span>
          <span class="badge blue">${meta.difficulty}/10</span>
          <span class="badge">${meta.questions} soru</span>
        </div>
      </div>
    </div>
    <div class="quizActions">
      <button class="btn primary">Oda kur</button>
    </div>
  `;

  d.querySelector("button").onclick = () => hostQuiz(meta.code);
  return d;
}

async function openQuizByCode(){
  clearErr("quizCodeErr");
  const code = $("quizCodeInput").value.trim().toUpperCase();

  try{
    await hostQuiz(code);
  }catch(e){
    showErr("quizCodeErr", e.message);
  }
}

async function hostQuiz(code){
  if (!auth.currentUser || !profile) return logoutToAuth();

  const quiz = await loadQuiz(code);
  const user = auth.currentUser;

  for (let i=0; i<12; i++){
    const pin = roomPin();
    const exists = await db.ref("games/" + pin + "/meta").get();

    if (exists.exists()) continue;

    const now = serverNow();

    const roomData = {
      meta: {
        hostUid: user.uid,
        hostName: profile.username,
        quizCode: quiz.code,
        quizTitle: quiz.title,
        difficulty: quiz.difficulty || 6,
        totalQuestions: quiz.questions.length,
        state: "lobby",
        currentIndex: 0,
        currentKey: "q0",
        phaseStartedAt: 0,
        phaseEndsAt: 0,
        revealCorrect: null,
        createdAt: now
      },
      players: {
        [user.uid]: {
          name: profile.username,
          ready: false,
          score: 0,
          totalMs: 0,
          joinedAt: now,
          seenQuizBefore: priorQuizInfo(quiz.code).seen,
          quizSeenCount: priorQuizInfo(quiz.code).seenCount,
          clientVersion: CLIENT_VERSION
        }
      }
    };

    await db.ref(`games/${pin}`).set(roomData);

    await logActivity("game_created", {
      room: pin,
      quizCode: quiz.code
    });

    localStorage.setItem("quizsel_room", JSON.stringify({pin}));
    watchRoom(pin);
    return;
  }

  throw new Error("Oda kodu oluşturulamadı.");
}

async function joinByHomePin(){
  if (!auth.currentUser || !profile) return logoutToAuth();

  const pin = $("homePin").value.replace(/\D/g,"").slice(0,6);

  if (pin.length !== 6){
    return toast("6 haneli oda kodunu gir.");
  }

  const metaSnap = await db.ref("games/" + pin + "/meta").get();

  if (!metaSnap.exists()){
    return toast("Bu oda bulunamadı.");
  }

  const meta = metaSnap.val();

  if (meta.state !== "lobby"){
    return toast("Bu oyun zaten başladı.");
  }

  const user = auth.currentUser;
  const exists = await db.ref(`games/${pin}/players/${user.uid}`).get();

  if (!exists.exists()){
    const prior = priorQuizInfo(meta.quizCode);
    try{
      await db.ref(`games/${pin}/players/${user.uid}`).set({
        name: profile.username,
        ready: false,
        score: 0,
        totalMs: 0,
        joinedAt: serverNow(),
        seenQuizBefore: prior.seen,
        quizSeenCount: prior.seenCount,
        clientVersion: CLIENT_VERSION
      });
    }catch(e){
      if (String(e?.code || e?.message || "").toLowerCase().includes("permission")){
        throw new Error("Odaya katılım izni reddedildi. Sayfayı Ctrl+F5 ile yenileyip tekrar dene.");
      }
      throw e;
    }
  }

  await logActivity("game_joined", {
    room: pin,
    quizCode: meta.quizCode
  });

  localStorage.setItem("quizsel_room", JSON.stringify({pin}));
  watchRoom(pin);
}

function watchRoom(pin){
  stopRoomWatch();

  currentRoom = pin;
  roomRef = db.ref("games/" + pin);

  roomListener = roomRef.on("value", async snap => {
    if (!snap.exists()){
      if (!intentionalRoomExit) toast("Yarışma sona erdi veya oda kapandı.");
      localStorage.removeItem("quizsel_room");
      stopRoomWatch();
      renderHome();
      return;
    }

    currentGame = snap.val();

    try{
      if (!currentQuiz || currentQuiz.code !== currentGame.meta.quizCode){
        currentQuiz = await loadQuiz(currentGame.meta.quizCode);
      }
      if (amHost()){
        await setupHostPresence().catch(()=>{});
        await maybeResetReadyAfterRosterChange().catch(()=>{});
      }
      if (["question","reveal","ended"].includes(currentGame.meta.state)){
        await markQuizSeen().catch(()=>{});
      }
      renderRoom();
      coordinateHost();

    }catch(e){
      console.error(e);
      toast("Quiz yüklenemedi: " + e.message);
    }
  });
}

function amHost(){
  return currentGame?.meta?.hostUid === auth.currentUser?.uid;
}

function myPlayer(){
  return currentGame?.players?.[auth.currentUser?.uid] || null;
}

function playersArray(){
  return Object.entries(currentGame?.players || {})
    .map(([uid,p]) => ({uid,...p}));
}

function allReady(){
  const a = playersArray();
  return a.length > 0 && a.every(p => p.ready === true);
}

function renderRoom(){
  const s = currentGame.meta.state;

  if (s === "lobby") renderLobby();
  else if (s === "countdown") renderCountdown();
  else if (s === "question" || s === "reveal") renderGame();
  else if (s === "ended") renderFinal();
}

function renderLobby(){
  stopPhaseTimer();
  hideCountdown();
  go("lobby");

  $("hostBadge").style.display = amHost() ? "inline-flex" : "none";
  $("lobbyCode").textContent = currentRoom;
  $("lobbyQuizTitle").textContent = currentGame.meta.quizTitle;

  const estimated = currentQuiz?.estimatedMinutes || estimateQuizMinutes();
  $("lobbyQuizMeta").innerHTML = `
    <span class="badge">${currentGame.meta.totalQuestions} soru</span>
    <span class="badge blue">${currentGame.meta.difficulty}/10 zorluk</span>
    <span class="badge">≈ ${estimated} dk</span>
    <span class="badge">${esc(currentQuiz?.category || "Quiz")}</span>
  `;

  const hostStatus = $("hostStatusBanner");
  if (amHost()){
    hostStatus.className = "hostStatus online";
    hostStatus.textContent = "Kurucu sensin · bağlantı aktif.";
  }else if (currentGame.meta.hostOnline === false){
    hostStatus.className = "hostStatus offline";
    hostStatus.textContent = "Kurucu değişiyor veya bağlantısı koptu. Oda korunuyor.";
  }else{
    hostStatus.className = "hostStatus online";
    hostStatus.textContent = "Kurucu bağlı · oyun başlatılmaya hazır.";
  }

  const me = myPlayer();
  $("readyBtn").textContent = me?.ready ? "Hazırım ✓" : "Hazırım";
  $("readyBtn").className = me?.ready ? "btn primary" : "btn soft";

  const arr = playersArray()
    .sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0));

  $("lobbyPlayerCount").textContent = `${arr.length} oyuncu`;

  const seenCount = arr.filter(p => p.seenQuizBefore === true).length;
  const exposure = $("quizExposureSummary");

  if (seenCount === 0){
    exposure.className = "exposureSummary allFresh";
    exposure.textContent = "Bu lobideki herkes bu quizin sorularını ilk kez görüyor.";
  }else{
    exposure.className = "exposureSummary hasSeen";
    exposure.textContent = `${seenCount} oyuncu bu quizin sorularını daha önce gördü. Oyuncu kartlarında kim olduğu işaretli.`;
  }

  const list = $("playersList");
  list.innerHTML = "";

  arr.forEach(p => {
    const d = document.createElement("div");
    d.className = "player playerIn" + (p.uid === auth.currentUser.uid ? " me" : "");

    const isRoomHost = p.uid === currentGame.meta.hostUid;
    const role = isRoomHost ? "Kurucu" : "Oyuncu";
    const historyBadge = p.seenQuizBefore
      ? `<span class="badge seenQuiz">Daha önce gördü${p.quizSeenCount ? ` · ${p.quizSeenCount} kez` : ""}</span>`
      : `<span class="badge freshQuiz">İlk kez</span>`;

    const remove = amHost() && p.uid !== auth.currentUser.uid
      ? `<button class="kickBtn" onclick="kickPlayer('${p.uid}')">Çıkar</button>`
      : "";

    d.innerHTML = `
      ${avatarHtml(p.name,{host:isRoomHost,mark:isRoomHost ? "K" : ""})}
      <div>
        <div class="playerName">${esc(p.name)}</div>
        <div class="playerSub">${role}</div>
      </div>
      <div class="playerActions">
        ${historyBadge}
        <span class="badge ${p.ready ? "green" : ""}">${p.ready ? "Hazır" : "Bekliyor"}</span>
        ${remove}
      </div>
    `;

    list.appendChild(d);
  });

  const readyCount = arr.filter(p => p.ready).length;
  $("readyState").textContent = allReady()
    ? "Herkes hazır · Kurucu oyunu başlatabilir."
    : `${readyCount} / ${arr.length} kişi hazır`;

  $("hostStartArea").style.display = amHost() ? "block" : "none";
  $("hostStartBtn").disabled = !allReady();
  $("hostStartBtn").textContent = allReady()
    ? "Herkes hazır · Oyunu başlat"
    : "Oyunu başlat";
}

async function toggleReady(){
  const user = auth.currentUser;
  if (!user || !currentRoom) return;

  await db.ref(`games/${currentRoom}/players/${user.uid}/ready`)
    .set(!myPlayer()?.ready);
}

async function startGame(){
  if (!amHost() || !allReady()) return;

  const now = serverNow();
  const sec = CFG.countdownSeconds || 3;

  await db.ref(`games/${currentRoom}/meta`).update({
    state: "countdown",
    currentIndex: 0,
    currentKey: "q0",
    phaseStartedAt: now,
    phaseEndsAt: now + (sec + 1) * 1000,
    revealCorrect: null
  });
}

function showCountdown(value,label="Hazır olun"){
  $("countOverlay").classList.add("show");
  $("countNum").textContent = value;
  $("countLabel").textContent = label;
}

function hideCountdown(){
  $("countOverlay").classList.remove("show");
}

function renderCountdown(){
  go("game");

  const meta = currentGame.meta;

  const tick = () => {
    const left = Math.max(0, meta.phaseEndsAt - serverNow());
    const n = Math.max(1, Math.ceil(left / 1000) - 1);

    const value=left<900?'BAŞLA':String(n);const num=$('countNum');if(num.textContent!==value){num.style.animation='none';void num.offsetWidth;num.style.animation='';}
    showCountdown(value,left<900?'Soru geliyor':(meta.currentIndex>0?`Soru ${meta.currentIndex+1}`:'Hazır olun'));
  };

  stopPhaseTimer();
  tick();
  phaseTimer = setInterval(tick, 120);
}

function currentQuestion(){
  return currentQuiz?.questions?.[currentGame.meta.currentIndex] || null;
}

function myAnswer(){
  return currentGame.answers?.[currentGame.meta.currentKey]?.[auth.currentUser.uid] || null;
}

function renderGame(){
  hideCountdown();
  go("game");

  const meta = currentGame.meta;
  const q = currentQuestion();

  if (!q) return;

  $("gameHostBadge").style.display = amHost() ? "inline-flex" : "none";
  $("gameTerminateBtn").style.display = amHost() ? "inline-flex" : "none";
  $("gameRoomBadge").textContent = "Oda " + currentRoom;
  $("gameProgress").textContent =
    `Soru ${meta.currentIndex + 1} / ${meta.totalQuestions}`;

  const gameHostStatus = $("gameHostStatus");
  if (!amHost() && meta.hostOnline === false){
    gameHostStatus.className = "hostStatus offline";
    gameHostStatus.textContent = "Kurucunun bağlantısı koptu. Oyun durumu korunuyor; kurucu geri gelince otomatik devam edecek.";
  }else{
    gameHostStatus.style.display = "none";
    gameHostStatus.className = "hostStatus";
  }
  $("questionText").textContent=q.text;$("questionTypeBadge").textContent=questionTypeLabel(q);$("questionVisualHint").textContent=q.image?"Görseli büyütmek için tıkla":"";
  if(q.image){$("questionImage").src=q.image;$("questionImage").alt=q.imageAlt||"Soru görseli";$("questionImage").style.objectPosition=q.imagePosition||"center";$("questionImage").style.objectFit=q.imageFit||"cover";$("questionImage").style.display="block";$("questionImageCredit").textContent=q.imageCredit||"";$("questionImageCredit").style.display=q.imageCredit?"block":"none";currentQuestionVisual={src:q.image,alt:q.imageAlt||"Soru görseli",credit:q.imageCredit||""};}
  else{$("questionImage").style.display="none";$("questionImageCredit").style.display="none";currentQuestionVisual=null;}

  const answer = myAnswer();
  const grid = $("answerGrid");
  grid.innerHTML = "";

  q.options.forEach((opt,i) => {
    const b = document.createElement("button");
    b.className = "answer";

    if (answer){
      if (answer.choice === i) b.classList.add("selected");
      else b.classList.add("dim");
    }

    if (meta.state === "reveal"){
      b.classList.remove("dim");

      if (i === meta.revealCorrect){
        b.classList.add("correct");
      }else if (answer?.choice === i){
        b.classList.add("wrong");
      }
    }

    b.disabled = meta.state !== "question" || !!answer;

    b.innerHTML = `
      <span class="key">${String.fromCharCode(65+i)}</span>
      <span>${esc(opt)}</span>
    `;

    if (!b.disabled){
      b.onclick = () => submitAnswer(i);
    }

    grid.appendChild(b);
  });

  const status = $("answerStatus");
  const board = $("roundBoard");

  if(meta.state==="question"){board.style.display="none";status.style.display=answer?"block":"none";status.className="status";if(answer){status.innerHTML=`<div class="waitingLine"><span>Cevabın kaydedildi</span><span class="waitingDots"><i></i><i></i><i></i></span></div><div class="muted small" style="margin-top:5px">Diğer oyuncular bekleniyor.</div>`;}}
  else{status.style.display="block";board.style.display="block";const a=myAnswer();const good=a?.correct===true;status.className="status "+(good?"revealGood":"revealBad");status.innerHTML=`<div class="eyebrow">Tur sonucu</div><div class="resultBig">${a?(good?"Doğru":"Yanlış"):"Cevap yok"}</div><div class="points">${a?.points?`+${a.points} puan`:""}</div><div class="muted small" style="margin-top:5px">Doğru cevap: ${esc(q.options[meta.revealCorrect])}</div>`;

    board.innerHTML =
      `<h3>Sıralama</h3><ol class="leader">${leaderHtml()}</ol>`;
  }

  startGameClock();
}

function startGameClock(){
  stopPhaseTimer();

  const meta = currentGame.meta;
  const total = Math.max(1, meta.phaseEndsAt - meta.phaseStartedAt);

  const tick = () => {
    const left = Math.max(0, meta.phaseEndsAt - serverNow());

    $("gameTimer").textContent =
      meta.state === "question"
        ? `${Math.ceil(left / 1000)} sn`
        : "Sonraki soru";

    $("gameBar").style.width = (left / total * 100) + "%";

    if (left <= 0){
      stopPhaseTimer();
    }
  };

  tick();
  phaseTimer = setInterval(tick, 120);
}

async function submitAnswer(choice){
  if (currentGame?.meta?.state !== "question") return;

  const uid = auth.currentUser.uid;
  const key = currentGame.meta.currentKey;
  const ref = db.ref(`games/${currentRoom}/answers/${key}/${uid}`);

  const exists = await ref.get();

  if (exists.exists()) return;

  await ref.set({
    choice,
    answeredAt: TS
  });
}

function leaderRows(){
  return playersArray()
    .map(p => ({
      uid:p.uid,
      name:p.name,
      score:p.score || 0,
      totalMs:p.totalMs || 0
    }))
    .sort((a,b) =>
      b.score - a.score ||
      a.totalMs - b.totalMs ||
      a.name.localeCompare(b.name,"tr")
    );
}

function leaderHtml(){
  return leaderRows()
    .map((r,i) => `
      <li class="${r.uid === auth.currentUser.uid ? "me" : ""}">
        <span class="rank">${i+1}</span>
        <div class="leaderIdentity">
          ${avatarHtml(r.name,{size:"micro",mark:i===0 ? "1" : ""})}
          <div class="leaderIdentityText"><strong>${esc(r.name)}</strong></div>
        </div>
        <span class="score">${r.score}</span>
      </li>
    `)
    .join("");
}

function renderFinal(){
  stopPhaseTimer();hideCountdown();go('final');const rows=detailedLeaderRows();$('finalQuiz').textContent=currentGame.meta.quizTitle;
  if(rows[0]){$('finalWinnerAvatar').innerHTML=avatarHtml(rows[0].name,{size:"hero",mark:"1"});$('winnerText').textContent=`${rows[0].name} kazandı`;const gap=rows[1]?rows[0].score-rows[1].score:null;$('finalGap').textContent=gap===null?`${rows[0].score} puan`:gap===0?'Puanlar eşit · daha hızlı toplam süre sıralamayı belirledi.':`${gap} puan farkla birinci.`;}else{$('finalWinnerAvatar').innerHTML='';$('winnerText').textContent='Oyun tamamlandı';$('finalGap').textContent='';}
  $('finalPodium').innerHTML=podiumCard(rows[1]||null,2)+podiumCard(rows[0]||null,1)+podiumCard(rows[2]||null,3);$('finalBoard').innerHTML=detailedLeaderHtml(rows);celebrateFinal();recordOwnFinal(rows);
}

async function recordOwnFinal(rows){
  const key = `${currentRoom}:${currentGame.meta.createdAt}`;

  if (
    finalRecordedKey === key ||
    sessionStorage.getItem("quizsel_final_" + key)
  ){
    return;
  }

  finalRecordedKey = key;
  sessionStorage.setItem("quizsel_final_" + key,"1");

  const me = rows.find(r => r.uid === auth.currentUser.uid);
  if (!me) return;

  const isWinner = rows[0]?.uid === me.uid;

  await db.ref(`profiles/${me.uid}/stats`).transaction(s => {
    s = s || {games:0,wins:0,points:0};
    s.games = (s.games || 0) + 1;
    s.wins = (s.wins || 0) + (isWinner ? 1 : 0);
    s.points = (s.points || 0) + (me.score || 0);
    return s;
  }).catch(() => {});

  await markQuizCompleted().catch(()=>{});

  await logActivity("game_finished", {
    room: currentRoom,
    quizCode: currentGame.meta.quizCode,
    score: me.score || 0,
    won: isWinner
  });
}

async function finishGame(){
  localStorage.removeItem("quizsel_room");
  stopRoomWatch();

  await auth.signOut().catch(() => {});
  profile = null;
  $("authPassword").value = "";

  toast("Oyun kaydedildi. Yeni yarış için tekrar giriş yap.");
  setAuthMode("login");
  go("auth");
}

async function leaveLobby(){
  confirmLeaveCompetition();
}

function copyRoomCode(){
  navigator.clipboard?.writeText(currentRoom)
    .then(() => toast("Oda kodu kopyalandı."));
}

function coordinateHost(){
  if (!amHost()) return;

  const m = currentGame.meta;

  if (!["countdown","question","reveal"].includes(m.state)){
    stopHostTimer();
    return;
  }

  const key = `${m.state}:${m.currentIndex}:${m.phaseEndsAt}`;

  if (key === hostTimerKey) return;

  stopHostTimer();
  hostTimerKey = key;

  const wait = Math.max(0, m.phaseEndsAt - serverNow() + 120);

  hostTimer = setTimeout(async () => {
    const snap = await db.ref(`games/${currentRoom}`).get();

    if (!snap.exists()) return;

    const g = snap.val();
    const meta = g.meta;

    if (`${meta.state}:${meta.currentIndex}:${meta.phaseEndsAt}` !== key){
      return;
    }

    if (meta.state === "countdown"){
      await beginQuestion(meta.currentIndex);
    }else if (meta.state === "question"){
      await revealQuestion(g);
    }else if (meta.state === "reveal"){
      await nextPhase(g);
    }
  }, wait);
}

async function beginQuestion(index){
  const q = currentQuiz.questions[index];
  const now = serverNow();

  await db.ref(`games/${currentRoom}/meta`).update({
    state: "question",
    currentIndex: index,
    currentKey: qKey(index),
    phaseStartedAt: now,
    phaseEndsAt: now + Number(CFG.questionSeconds || 15) * 1000,
    revealCorrect: null
  });
}

async function revealQuestion(g){
  const meta = g.meta;
  const index = meta.currentIndex;
  const q = currentQuiz.questions[index];
  const key = meta.currentKey;
  const players = g.players || {};
  const answers = g.answers?.[key] || {};
  const updates = {};

  Object.entries(players).forEach(([uid,p]) => {
    const a = answers[uid];

    if (!a) return;

    const elapsed = Math.max(
      0,
      (a.answeredAt || meta.phaseEndsAt) - meta.phaseStartedAt
    );

    const limit = Number(CFG.questionSeconds || 15) * 1000;
    const frac = Math.min(1, elapsed / limit);
    const correct = a.choice === q.answer;
    const points = correct
      ? Math.round(500 + 500 * (1 - frac))
      : 0;

    updates[`answers/${key}/${uid}/correct`] = correct;
    updates[`answers/${key}/${uid}/points`] = points;
    updates[`answers/${key}/${uid}/elapsedMs`] = elapsed;
    updates[`players/${uid}/score`] = (p.score || 0) + points;
    updates[`players/${uid}/totalMs`] =
      (p.totalMs || 0) + (correct ? elapsed : limit);
  });

  const now = serverNow();

  updates["meta/state"] = "reveal";
  updates["meta/revealCorrect"] = q.answer;
  updates["meta/phaseStartedAt"] = now;
  updates["meta/phaseEndsAt"] =
    now + (CFG.revealSeconds || 5) * 1000;

  await db.ref(`games/${currentRoom}`).update(updates);
}

async function nextPhase(g){
  const next = (g.meta.currentIndex || 0) + 1;

  if (next >= currentQuiz.questions.length){
    await db.ref(`games/${currentRoom}/meta`).update({
      state:"ended",
      phaseEndsAt:0
    });

  }else{
    const now = serverNow();

    await db.ref(`games/${currentRoom}/meta`).update({
      state:"countdown",
      currentIndex:next,
      currentKey:qKey(next),
      phaseStartedAt:now,
      phaseEndsAt:now + 2200,
      revealCorrect:null
    });
  }
}

async function renderAdmin(){
  const [profilesSnap, gamesSnap] = await Promise.all([
    db.ref("profiles").get(),
    db.ref("games").get()
  ]);

  const profiles = profilesSnap.val() || {};
  const games = gamesSnap.val() || {};

  $("adminUserCount").textContent = Object.keys(profiles).length;

  const active = Object.entries(games)
    .filter(([,x]) => x?.meta?.state !== "ended");

  $("adminRoomCount").textContent = active.length;

  const box = $("adminRooms");
  box.innerHTML = "";

  if (!active.length){
    box.innerHTML = '<div class="empty">Aktif oda yok.</div>';
    return;
  }

  active.forEach(([pin,x]) => {
    const d = document.createElement("div");
    d.className = "room";

    d.innerHTML = `
      <div class="meta">
        <b>${esc(pin)} · ${esc(x.meta?.quizTitle || "Quiz")}</b>
        <span>${esc(x.meta?.hostName || "")} · ${esc(x.meta?.state || "")}</span>
      </div>
      <button class="btn sm danger">Kapat</button>
    `;

    d.querySelector("button").onclick = async () => {
      await db.ref("games/" + pin).remove();
      await renderAdmin();
    };

    box.appendChild(d);
  });
}

auth.onAuthStateChanged(async user => {
  if (!user){
    profile = null;
    stopRoomWatch();
    setAuthMode("login");
    go("auth");
    return;
  }

  if (isAdmin(user)){
    await renderAdmin().catch(() => {});
    go("admin");
    return;
  }

  try{
    await loadProfile();
    await restoreRoomOrHome();
  }catch(e){
    console.error(e);
    await auth.signOut().catch(() => {});
    showErr("authErr","Profil açılamadı. Database Rules'u kontrol et.");
  }
});

(async function boot(){
  try{
    // Aynı sekmede refresh yapılırsa oyun bozulmasın;
    // sekme/oturum kapanınca kullanıcı tekrar giriş yapmak zorunda kalsın.
    await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
  }catch(e){
    console.warn(e);
  }
})();

document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeQuestionImage();closeDecision();}});
