// Quizsel v0.13.0 — Bilgi Canavarı post-quiz review
// Adds a read-only final review surface with question, correct answer and answerInfo.
(() => {
  "use strict";

  const VERSION = "0.13.0";
  let knowledgeOpen = false;
  let quizSnapshot = null;

  const byId = id => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function cloneQuiz(quiz) {
    if (!quiz || typeof quiz !== "object") return null;
    try {
      return typeof structuredClone === "function"
        ? structuredClone(quiz)
        : JSON.parse(JSON.stringify(quiz));
    } catch (_) {
      return quiz;
    }
  }

  function correctAnswerFor(question) {
    if (!question || !Array.isArray(question.options)) return "—";
    const index = Number(question.answer);
    if (!Number.isInteger(index) || index < 0 || index >= question.options.length) return "—";
    return String(question.options[index] ?? "—");
  }

  function answerInfoFor(question) {
    const info = String(question?.answerInfo || "").trim();
    if (info) return info;
    return "Bu soru eski Quizsel havuzundan geliyor; bu soru için ek Bilgi Canavarı notu henüz hazırlanmadı.";
  }

  function imageMarkup(question, number) {
    const src = String(question?.image || "").trim();
    if (!src) return "";
    const alt = String(question?.imageAlt || `Soru ${number} görseli`).trim();
    return `<img class="knowledgeImage" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`;
  }

  function questionMarkup(question, index) {
    const number = Number(question?.id) || index + 1;
    return `
      <article class="knowledgeCard">
        <div class="knowledgeQuestionHead">
          <span class="knowledgeNumber">${number}</span>
          <span class="eyebrow">Soru ${number}</span>
        </div>
        ${imageMarkup(question, number)}
        <div class="knowledgeQuestion">${escapeHtml(question?.text || "Soru metni bulunamadı.")}</div>
        <div class="knowledgeAnswerBlock">
          <div class="knowledgeLabel">Doğru cevap</div>
          <div class="knowledgeAnswer">${escapeHtml(correctAnswerFor(question))}</div>
        </div>
        <div class="knowledgeInfoBlock">
          <div class="knowledgeLabel">Bilgi Canavarı</div>
          <p class="knowledgeInfo">${escapeHtml(answerInfoFor(question))}</p>
        </div>
      </article>
    `;
  }

  function renderKnowledge() {
    const quiz = quizSnapshot;
    const list = byId("knowledgeList");
    const title = byId("knowledgeQuizTitle");
    const summary = byId("knowledgeSummary");
    if (!list || !title || !summary) return false;

    const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
    title.textContent = quiz?.title || "Quiz incelemesi";

    const enriched = questions.filter(q => String(q?.answerInfo || "").trim()).length;
    summary.textContent = questions.length
      ? `${questions.length} sorunun doğru cevapları açık. ${enriched}/${questions.length} soruda ek Bilgi Canavarı notu var.`
      : "İncelenecek soru bulunamadı.";

    list.innerHTML = questions.length
      ? questions.map(questionMarkup).join("")
      : '<div class="empty">Bu quiz için soru verisi bulunamadı.</div>';
    return true;
  }

  function openKnowledgeBeast(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (!currentQuiz?.questions?.length) {
      if (typeof toast === "function") toast("Bilgi Canavarı için quiz verisi bulunamadı.");
      return false;
    }

    quizSnapshot = cloneQuiz(currentQuiz);
    knowledgeOpen = true;
    renderKnowledge();
    if (typeof go === "function") go("knowledge");
    return false;
  }

  function closeKnowledgeBeast(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    knowledgeOpen = false;
    if (typeof go === "function") go("final");
    return false;
  }

  // Keep the review view stable while the ended-room listener or visibility
  // recovery path asks the base application to render Final again.
  const baseRenderFinal = renderFinal;
  renderFinal = function quizselV013RenderFinal() {
    if (knowledgeOpen && byId("view-knowledge")?.classList.contains("active")) return;
    const result = baseRenderFinal.apply(this, arguments);
    const button = byId("finalKnowledgeBtn");
    if (button) button.disabled = !currentQuiz?.questions?.length;
    return result;
  };

  function install() {
    const openBtn = byId("finalKnowledgeBtn");
    const backTop = byId("knowledgeBackTop");
    const backBottom = byId("knowledgeBackBottom");

    if (!openBtn || !backTop || !backBottom || !byId("view-knowledge") || !byId("knowledgeList")) {
      console.error("[Quizsel] v0.13.0 Bilgi Canavarı DOM yüzeyi bulunamadı.");
      return;
    }

    openBtn.addEventListener("click", openKnowledgeBeast, true);
    backTop.addEventListener("click", closeKnowledgeBeast, true);
    backBottom.addEventListener("click", closeKnowledgeBeast, true);

    window.openKnowledgeBeast = openKnowledgeBeast;
    window.closeKnowledgeBeast = closeKnowledgeBeast;
    window.QUIZSEL_KNOWLEDGE_VERSION = VERSION;
    document.documentElement.dataset.quizselKnowledge = VERSION;
    console.info(`[Quizsel] Bilgi Canavarı ${VERSION} active`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
