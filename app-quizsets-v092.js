// Quizsel v0.9.2 — quiz-set browser
// Runtime grouping:
// - everything before Y.Q103 (and non-YQ legacy quizzes) => Draft Quiz Set
// - Y.Q103–Y.Q132 => First Set
// - Y.Q133–Y.Q162 => Second Set
// - Y.Q163–Y.Q192 => Third Set
// - then automatic 30-quiz blocks.
(() => {
  "use strict";

  const SET_VERSION = "0.9.2";
  const FIRST_SET_START = 103;
  const SET_SIZE = 30;
  const QUIZ_BATCH_SIZE = 12;

  let setObserver = null;
  let activeManifest = null;

  const SET_WORDS = [
    "",
    "First", "Second", "Third", "Fourth", "Fifth",
    "Sixth", "Seventh", "Eighth", "Ninth", "Tenth",
    "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth",
    "Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth", "Twentieth"
  ];

  function stopSetObserver(){
    if (setObserver){
      setObserver.disconnect();
      setObserver = null;
    }
  }

  function cleanDisplayCode(meta){
    return String(meta?.code || meta?.file || "")
      .trim()
      .toUpperCase();
  }

  function yqNumber(meta){
    const source = cleanDisplayCode(meta);
    const match = source.match(/Y\.?Q0*(\d+)/);
    if (match) return Number(match[1]);

    const fileMatch = String(meta?.file || "")
      .toUpperCase()
      .match(/YQ0*(\d+)\.JSON$/);

    return fileMatch ? Number(fileMatch[1]) : null;
  }

  function pad3(n){
    return String(n).padStart(3, "0");
  }

  function setName(setNumber){
    if (SET_WORDS[setNumber]) return `${SET_WORDS[setNumber]} Set`;
    return `Set ${setNumber}`;
  }

  function groupInfo(meta){
    const number = yqNumber(meta);

    if (!Number.isInteger(number) || number < FIRST_SET_START){
      return {
        id: "draft",
        order: -1,
        title: "Draft Quiz Set",
        plannedStart: null,
        plannedEnd: FIRST_SET_START - 1
      };
    }

    const setNumber = Math.floor((number - FIRST_SET_START) / SET_SIZE) + 1;
    const plannedStart = FIRST_SET_START + (setNumber - 1) * SET_SIZE;
    const plannedEnd = plannedStart + SET_SIZE - 1;

    return {
      id: `set-${setNumber}`,
      order: setNumber,
      setNumber,
      title: setName(setNumber),
      plannedStart,
      plannedEnd
    };
  }

  function buildGroups(quizzes){
    const map = new Map();

    quizzes.forEach(meta => {
      const info = groupInfo(meta);

      if (!map.has(info.id)){
        map.set(info.id, {
          ...info,
          quizzes: []
        });
      }

      map.get(info.id).quizzes.push(meta);
    });

    const groups = Array.from(map.values());

    groups.forEach(group => {
      group.quizzes.sort((a, b) => {
        const an = yqNumber(a);
        const bn = yqNumber(b);

        if (Number.isInteger(an) && Number.isInteger(bn)) return an - bn;
        return cleanDisplayCode(a).localeCompare(cleanDisplayCode(b), "tr");
      });
    });

    // Newest production set first; Draft always last.
    groups.sort((a, b) => {
      if (a.id === "draft") return 1;
      if (b.id === "draft") return -1;
      return b.order - a.order;
    });

    return groups;
  }

  function groupRangeLabel(group){
    if (group.id === "draft"){
      return `Y.Q001–Y.Q${pad3(group.plannedEnd)} + eski QZ quizleri`;
    }

    return `Y.Q${pad3(group.plannedStart)}–Y.Q${pad3(group.plannedEnd)}`;
  }

  function setCard(group){
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quizSetCard ${group.id === "draft" ? "draft" : ""}`;
    button.setAttribute("aria-label", `${group.title} klasörünü aç`);

    button.innerHTML = `
      <div class="quizSetFolderIcon" aria-hidden="true"><i></i></div>
      <div class="quizSetMeta">
        <div class="eyebrow">${group.id === "draft" ? "Arşiv" : "Quiz koleksiyonu"}</div>
        <h3>${esc(group.title)}</h3>
        <div class="quizSetSub">${group.quizzes.length} quiz · ${esc(groupRangeLabel(group))}</div>
      </div>
      <div class="quizSetArrow" aria-hidden="true">›</div>
    `;

    button.onclick = () => renderSet(group);
    return button;
  }

  function renderFolders(groups){
    stopSetObserver();

    const list = $("quizList");
    if (!list) return;

    list.classList.add("quizSetGrid");
    list.innerHTML = "";

    if (!groups.length){
      list.innerHTML = '<div class="empty">Gösterilecek quiz bulunamadı.</div>';
      return;
    }

    const intro = document.createElement("div");
    intro.className = "quizSetIntro";
    intro.innerHTML = `
      <div class="eyebrow">Quiz kütüphanesi</div>
      <div class="quizSetIntroText">Bir set seç. Her yeni 30 quiz otomatik olarak sonraki sete eklenir.</div>
    `;
    list.appendChild(intro);

    groups.forEach(group => list.appendChild(setCard(group)));
  }

  function renderSet(group){
    stopSetObserver();

    const list = $("quizList");
    if (!list) return;

    list.classList.remove("quizSetGrid");
    list.innerHTML = "";

    const head = document.createElement("div");
    head.className = "quizSetViewHead";
    head.innerHTML = `
      <button class="back quizSetBack" type="button">Quiz setleri</button>
      <div class="quizSetViewTitleRow">
        <div>
          <div class="eyebrow">Quiz klasörü</div>
          <h3>${esc(group.title)}</h3>
          <div class="muted small">${group.quizzes.length} quiz · ${esc(groupRangeLabel(group))}</div>
        </div>
      </div>
    `;
    head.querySelector(".quizSetBack").onclick = () => {
      const groups = buildGroups(activeManifest?.quizzes || []);
      renderFolders(groups);
    };
    list.appendChild(head);

    let rendered = 0;

    const sentinel = document.createElement("div");
    sentinel.className = "quizSetSentinel";

    const renderBatch = () => {
      const end = Math.min(group.quizzes.length, rendered + QUIZ_BATCH_SIZE);
      const fragment = document.createDocumentFragment();

      for (; rendered < end; rendered++){
        fragment.appendChild(quizCard(group.quizzes[rendered]));
      }

      list.insertBefore(fragment, sentinel);

      if (rendered >= group.quizzes.length){
        stopSetObserver();
        sentinel.remove();
      }else{
        sentinel.innerHTML = '<button class="btn soft sm" type="button">Daha fazla quiz göster</button>';
        sentinel.querySelector("button").onclick = renderBatch;
      }
    };

    list.appendChild(sentinel);
    renderBatch();

    if (sentinel.isConnected && "IntersectionObserver" in window){
      setObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) renderBatch();
      }, { rootMargin: "320px 0px" });

      setObserver.observe(sentinel);
    }

    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }

  openQuizBrowser = async function quizselSetBrowser(){
    go("quizzes");
    clearErr("quizCodeErr");
    stopSetObserver();

    const list = $("quizList");
    list.innerHTML = '<div class="empty">Quiz setleri yükleniyor…</div>';

    try{
      const manifest = await loadManifest();
      const quizzes = Array.isArray(manifest?.quizzes) ? manifest.quizzes : [];

      activeManifest = {
        ...manifest,
        quizzes
      };

      renderFolders(buildGroups(quizzes));
    }catch(e){
      list.classList.remove("quizSetGrid");
      list.innerHTML = `
        <div class="empty">
          ${esc(e.message)}
          <br><span class="tiny">Kodla açma yine kullanılabilir.</span>
        </div>
      `;
    }
  };

  // Expose read-only helpers only in debug mode for easy verification.
  if (new URLSearchParams(location.search).get("debug") === "1"){
    window.QUIZSEL_SET_DEBUG = {
      version: SET_VERSION,
      firstSetStart: FIRST_SET_START,
      setSize: SET_SIZE,
      yqNumber,
      groupInfo,
      buildGroups
    };
  }

  console.info(`[Quizsel] quiz-set browser ${SET_VERSION} active`);
})();
