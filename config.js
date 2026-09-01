window.QUIZSEL_CONFIG = {
  firebase: {
    apiKey: "AIzaSyCNCzHkRbEPAX1_A83MReEd-Nr-hLuDcRI",
    authDomain: "quizfamily-e06a4.firebaseapp.com",
    databaseURL: "https://quizfamily-e06a4-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "quizfamily-e06a4",
    storageBucket: "quizfamily-e06a4.firebasestorage.app",
    messagingSenderId: "913487040824",
    appId: "1:913487040824:web:2c6c16b7ca2e5c36e6b1cd"
  },

  usernameDomain: "quizsel.app",
  adminInternalEmail: "quizsel-admin@quizsel.app",

  questionSeconds: 20,
  countdownSeconds: 3,
  revealSeconds: 5
};

// Stable load order:
// app.js -> v0.9 performance -> v0.9.1 race-flow -> v0.9.2 quiz-set browser.
(() => {
  const loadQuizSets = () => {
    if (document.querySelector('script[data-quizsel-v092-sets]')) return;

    const sets = document.createElement("script");
    sets.src = "app-quizsets-v092.js?v=92";
    sets.dataset.quizselV092Sets = "1";
    sets.onerror = () => console.error("Quizsel v0.9.2 quiz-set layer could not be loaded.");
    document.body.appendChild(sets);
  };

  const loadFlowFix = () => {
    const existing = document.querySelector('script[data-quizsel-v091-flow]');

    if (existing) {
      if (existing.dataset.quizselLoaded === "1") {
        loadQuizSets();
      } else {
        existing.addEventListener("load", loadQuizSets, { once: true });
      }
      return;
    }

    const flow = document.createElement("script");
    flow.src = "app-flow-v091.js?v=92";
    flow.dataset.quizselV091Flow = "1";
    flow.onload = () => {
      flow.dataset.quizselLoaded = "1";
      loadQuizSets();
    };
    flow.onerror = () => console.error("Quizsel v0.9.1 flow layer could not be loaded.");
    document.body.appendChild(flow);
  };

  const loadEnhancements = () => {
    const existing = document.querySelector('script[data-quizsel-v09-performance]');

    if (existing) {
      if (existing.dataset.quizselLoaded === "1") {
        loadFlowFix();
      } else {
        existing.addEventListener("load", loadFlowFix, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "app-v09-performance.js?v=92";
    script.dataset.quizselV09Performance = "1";
    script.onload = () => {
      script.dataset.quizselLoaded = "1";
      loadFlowFix();
    };
    script.onerror = () => console.error("Quizsel v0.9 performance layer could not be loaded.");
    document.body.appendChild(script);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadEnhancements, { once: true });
  } else {
    loadEnhancements();
  }
})();
