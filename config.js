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

  clientVersion: "0.10.0",
  questionSeconds: 20,
  countdownSeconds: 3,
  revealSeconds: 5
};

// Stable load order:
// app.js -> performance layer -> v0.10 runtime/reliability + quiz-set browser.
(() => {
  const loadRuntime = () => {
    if (document.querySelector('script[data-quizsel-v010-runtime]')) return;

    const runtime = document.createElement("script");
    runtime.src = "app-v010-runtime.js?v=100";
    runtime.dataset.quizselV010Runtime = "1";
    runtime.onerror = () => console.error("Quizsel v0.10 runtime layer could not be loaded.");
    document.body.appendChild(runtime);
  };

  const loadPerformance = () => {
    const existing = document.querySelector('script[data-quizsel-v09-performance]');

    if (existing) {
      if (existing.dataset.quizselLoaded === "1") {
        loadRuntime();
      } else {
        existing.addEventListener("load", loadRuntime, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "app-v09-performance.js?v=92";
    script.dataset.quizselV09Performance = "1";
    script.onload = () => {
      script.dataset.quizselLoaded = "1";
      loadRuntime();
    };
    script.onerror = () => console.error("Quizsel performance layer could not be loaded.");
    document.body.appendChild(script);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPerformance, { once: true });
  } else {
    loadPerformance();
  }
})();
