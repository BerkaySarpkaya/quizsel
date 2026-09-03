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

  clientVersion: "0.12.1",
  questionSeconds: 20,
  countdownSeconds: 3,
  revealSeconds: 5
};

// Stable load order:
// app.js -> performance layer -> v0.10 runtime -> v0.11 reliability (direct tag)
// -> v0.12 durable analytics. The analytics layer self-gates until reliability is active.
(() => {
  const loadAnalytics = () => {
    const existing = document.querySelector('script[data-quizsel-v012-analytics]');
    if (existing) return;

    const analytics = document.createElement("script");
    analytics.src = "app-v012-analytics.js?v=121";
    analytics.dataset.quizselV012Analytics = "1";
    analytics.onerror = () => console.error("Quizsel v0.12.1 analytics layer could not be loaded.");
    document.body.appendChild(analytics);
  };

  const loadRuntime = () => {
    const existing = document.querySelector('script[data-quizsel-v010-runtime]');

    if (existing) {
      if (existing.dataset.quizselLoaded === "1") {
        loadAnalytics();
      } else {
        existing.addEventListener("load", loadAnalytics, { once: true });
      }
      return;
    }

    const runtime = document.createElement("script");
    runtime.src = "app-v010-runtime.js?v=100";
    runtime.dataset.quizselV010Runtime = "1";
    runtime.onload = () => {
      runtime.dataset.quizselLoaded = "1";
      loadAnalytics();
    };
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
