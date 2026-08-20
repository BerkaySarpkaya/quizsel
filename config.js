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

  // Kullanıcı hiçbir zaman e-posta görmez.
  // Firebase Auth için kullanıcı adı arka planda teknik bir dahili kimliğe çevrilir.
  usernameDomain: "quizsel.app",

  // Yönetici de ekranda yalnızca şifre girer.
  // Bu adres sadece Firebase Auth iç kimliğidir.
  adminInternalEmail: "quizsel-admin@quizsel.app",

  questionSeconds: 20,
  countdownSeconds: 3,
  revealSeconds: 5
};

// v0.9 performance/UX layer is intentionally loaded separately so the stable
// app.js remains easy to roll back during live testing on v0.9-test.
(() => {
  const loadEnhancements = () => {
    if (document.querySelector('script[data-quizsel-v09-performance]')) return;
    const script = document.createElement("script");
    script.src = "app-v09-performance.js?v=91";
    script.dataset.quizselV09Performance = "1";
    script.onerror = () => console.error("Quizsel v0.9 performance layer could not be loaded.");
    document.body.appendChild(script);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadEnhancements, { once: true });
  } else {
    loadEnhancements();
  }
})();
