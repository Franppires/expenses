/**
 * Login + sincronização Firestore (dados por usuário, qualquer dispositivo).
 *
 * Regras Firestore (cole em Firebase Console → Firestore → Regras):
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     match /users/{userId}/{document=**} {
 *       allow read, write: if request.auth != null && request.auth.uid == userId;
 *     }
 *   }
 * }
 */
(function () {
  "use strict";

  const cfg = window.FIREBASE_CONFIG || {};
  let auth = null;
  let db = null;
  let pushTimer = null;
  let pendingMonths = new Map();
  let backgroundSyncPromise = null;

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => {
          const err = new Error("Sync timeout");
          err.code = "deadline-exceeded";
          reject(err);
        }, ms);
      }),
    ]);
  }

  function prepareLocalData(user) {
    migrateLegacyLocalToUser(user.uid);
    if (window.MinhasDespesasRecoverLocal) window.MinhasDespesasRecoverLocal(user.uid);
    if (window.MinhasDespesasSeedAccount) window.MinhasDespesasSeedAccount(user.email, user.uid);
  }

  function openApp(user) {
    hideAuth();
    setAuthLoading(false);
    const emailEl = $("#userEmail");
    if (emailEl) emailEl.textContent = user.email || "Conta";
    if (window.MinhasDespesasInit) window.MinhasDespesasInit(user.uid, user.email);
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function showAuth() {
    $("#authScreen")?.classList.remove("hidden");
    $("#appRoot")?.classList.add("hidden");
    document.querySelector(".bottom-nav")?.classList.add("hidden");
  }

  function hideAuth() {
    $("#authScreen")?.classList.add("hidden");
    $("#appRoot")?.classList.remove("hidden");
    document.querySelector(".bottom-nav")?.classList.remove("hidden");
  }

  function setAuthError(msg) {
    const el = $("#authError");
    if (el) {
      el.textContent = msg || "";
      el.hidden = !msg;
    }
  }

  function setAuthLoading(on) {
    $("#authLoading")?.classList.toggle("hidden", !on);
    $("#authForm")?.classList.toggle("hidden", on);
  }

  function setSyncStatus(text, ok) {
    const el = $("#syncStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("sync-ok", !!ok);
    el.classList.toggle("sync-warn", !ok);
    const showRetry = !ok && text && auth?.currentUser;
    $("#btnRetrySync")?.classList.toggle("hidden", !showRetry);
  }

  function firebaseReady() {
    return cfg.configured && cfg.apiKey && !cfg.apiKey.includes("COLE_");
  }

  function initFirebase() {
    if (!firebaseReady() || typeof firebase === "undefined") return false;
    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
        appId: cfg.appId,
      });
    }
    auth = firebase.auth();
    db = firebase.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    return true;
  }

  function stripCloudMeta(data) {
    if (!data || typeof data !== "object") return data;
    const out = JSON.parse(JSON.stringify(data, (_, v) => {
      if (v && typeof v === "object" && typeof v.seconds === "number" && typeof v.nanoseconds === "number") {
        return null;
      }
      return v;
    }));
    delete out.updatedAt;
    return out;
  }

  function sanitizeForFirestore(data) {
    return JSON.parse(JSON.stringify(data, (_, v) => (v === undefined ? null : v)));
  }

  function syncErrorMessage(err) {
    const code = err?.code || "";
    if (code === "permission-denied") {
      return "Sem permissão no Firestore — publique as regras no Firebase Console";
    }
    if (code === "unavailable" || code === "network-request-failed") {
      return "Sem internet — tente de novo quando estiver online";
    }
    if (code === "failed-precondition") {
      return "Firestore indisponível — toque em Sincronizar";
    }
    if (code === "deadline-exceeded") {
      return "Nuvem demorou — dados locais ok, toque em Sincronizar";
    }
    return "Nuvem indisponível — toque em Sincronizar";
  }

  function migrateLegacyLocalToUser(uid) {
    const prefix = "minhas-despesas-v2:" + uid + ":";
    const patchesKey = "minhas-despesas-patches-done:" + uid;
    let migrated = 0;

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("minhas-despesas-v2:") && !key.includes(":" + uid + ":")) {
        const rest = key.slice("minhas-despesas-v2:".length);
        if (/^\d{4}-\d{2}$/.test(rest)) {
          const dest = prefix + rest;
          if (!localStorage.getItem(dest)) {
            localStorage.setItem(dest, localStorage.getItem(key));
            migrated++;
          }
        }
      }
      if (key === "minhas-despesas-patches-done" && !localStorage.getItem(patchesKey)) {
        localStorage.setItem(patchesKey, localStorage.getItem(key));
      }
      if (key.startsWith("minhas-despesas:") && !key.startsWith("minhas-despesas-v2:")) {
        const ym = key.slice("minhas-despesas:".length);
        if (/^\d{4}-\d{2}$/.test(ym)) {
          const dest = prefix + ym;
          if (!localStorage.getItem(dest)) {
            localStorage.setItem(dest, localStorage.getItem(key));
            migrated++;
          }
        }
      }
    });
    return migrated;
  }

  function monthScore(data) {
    if (!data) return 0;
    let s = 0;
    (data.incomes || []).forEach((i) => { s += Number(i.amount) || 0; });
    (data.extras || []).forEach((e) => { s += Number(e.amount) || 0; });
    Object.values(data.bills || {}).forEach((b) => { s += Number(b.amount) || 0; });
    return s;
  }

  async function pullFromCloud(uid) {
    const monthsSnap = await db.collection("users").doc(uid).collection("months").get();
    const prefix = "minhas-despesas-v2:" + uid + ":";
    monthsSnap.forEach((doc) => {
      const key = prefix + doc.id;
      const cloudData = stripCloudMeta(doc.data());
      const localRaw = localStorage.getItem(key);
      if (!localRaw) {
        localStorage.setItem(key, JSON.stringify(cloudData));
        return;
      }
      try {
        const localData = JSON.parse(localRaw);
        if (monthScore(localData) >= monthScore(cloudData)) return;
        localStorage.setItem(key, JSON.stringify(cloudData));
      } catch (_) {
        localStorage.setItem(key, JSON.stringify(cloudData));
      }
    });

    const meta = await db.collection("users").doc(uid).collection("meta").doc("settings").get();
    if (meta.exists && meta.data().patches) {
      localStorage.setItem("minhas-despesas-patches-done:" + uid, JSON.stringify(meta.data().patches));
    }
    return monthsSnap.size;
  }

  async function pushMonthToCloud(uid, ym, data) {
    await db.collection("users").doc(uid).collection("months").doc(ym).set({
      ...sanitizeForFirestore(data),
      version: 2,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  async function pushPatchesToCloud(uid) {
    const key = "minhas-despesas-patches-done:" + uid;
    let patches = [];
    try {
      patches = JSON.parse(localStorage.getItem(key) || "[]");
    } catch (_) { /* ignore */ }
    await db.collection("users").doc(uid).collection("meta").doc("settings").set(
      { patches, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  async function uploadLocalMonths(uid) {
    const prefix = "minhas-despesas-v2:" + uid + ":";
    let count = 0;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const ym = key.slice(prefix.length);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      try {
        const data = sanitizeForFirestore(JSON.parse(localStorage.getItem(key)));
        await db.collection("users").doc(uid).collection("months").doc(ym).set({
          ...data,
          version: 2,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        count++;
      } catch (e) {
        console.error("upload month", ym, e);
        throw e;
      }
    }
    await pushPatchesToCloud(uid);
    return count;
  }

  async function runFullSync(user) {
    setSyncStatus("Baixando seus dados…", true);
    await withTimeout(pullFromCloud(user.uid), 15000);
    if (window.MinhasDespesasRecoverLocal) window.MinhasDespesasRecoverLocal(user.uid);
    if (window.MinhasDespesasSeedAccount) window.MinhasDespesasSeedAccount(user.email, user.uid);
    setSyncStatus("Enviando para nuvem…", true);
    await withTimeout(uploadLocalMonths(user.uid), 15000);
    setSyncStatus("Sincronizado", true);
    if (window.MinhasDespesasRefresh) window.MinhasDespesasRefresh();
  }

  function startBackgroundSync(user) {
    if (backgroundSyncPromise) return backgroundSyncPromise;
    backgroundSyncPromise = runFullSync(user)
      .catch((e) => {
        console.error(e);
        setSyncStatus(syncErrorMessage(e), false);
      })
      .finally(() => {
        backgroundSyncPromise = null;
      });
    return backgroundSyncPromise;
  }

  async function retrySync() {
    const user = auth?.currentUser;
    if (!user || !db) return false;
    if (backgroundSyncPromise) {
      try { await backgroundSyncPromise; } catch (_) { /* ignore */ }
    }
    try {
      await withTimeout(runFullSync(user), 30000);
      return true;
    } catch (e) {
      console.error(e);
      setSyncStatus(syncErrorMessage(e), false);
      return false;
    }
  }

  function flushPendingPush(uid) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (!uid || !db) return;
      setSyncStatus("Salvando na nuvem…", true);
      try {
        for (const [ym, data] of pendingMonths.entries()) {
          await pushMonthToCloud(uid, ym, data);
        }
        pendingMonths.clear();
        await pushPatchesToCloud(uid);
        setSyncStatus("Salvo na nuvem", true);
      } catch (e) {
        console.error(e);
        setSyncStatus("Erro ao salvar na nuvem", false);
      }
    }, 600);
  }

  async function onUserSignedIn(user) {
    setAuthError("");
    setAuthLoading(true);
    prepareLocalData(user);
    openApp(user);
    startBackgroundSync(user);
  }

  function onUserSignedOut() {
    pendingMonths.clear();
    if (window.MinhasDespesasSignOut) window.MinhasDespesasSignOut();
    showAuth();
    setSyncStatus("", false);
  }

  async function signIn(email, password) {
    setAuthError("");
    setAuthLoading(true);
    try {
      await auth.signInWithEmailAndPassword(email.trim(), password);
    } catch (e) {
      setAuthLoading(false);
      const msg =
        e.code === "auth/invalid-credential" || e.code === "auth/wrong-password"
          ? "E-mail ou senha incorretos."
          : e.code === "auth/user-not-found"
            ? "Conta não encontrada. Crie uma conta primeiro."
            : "Não foi possível entrar. Verifique e-mail e senha.";
      setAuthError(msg);
    }
  }

  async function signUp(email, password) {
    setAuthError("");
    setAuthLoading(true);
    try {
      await auth.createUserWithEmailAndPassword(email.trim(), password);
    } catch (e) {
      setAuthLoading(false);
      const msg =
        e.code === "auth/email-already-in-use"
          ? "Este e-mail já tem conta. Use Entrar."
          : e.code === "auth/weak-password"
            ? "Senha fraca. Use pelo menos 6 caracteres."
            : "Não foi possível criar a conta.";
      setAuthError(msg);
    }
  }

  function wireAuthForm() {
    const form = $("#authForm");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#authEmail")?.value;
      const password = $("#authPassword")?.value;
      if (!email || !password) return;
      signIn(email, password);
    });

    $("#btnSignUp")?.addEventListener("click", () => {
      const email = $("#authEmail")?.value;
      const password = $("#authPassword")?.value;
      if (!email || !password) {
        setAuthError("Preencha e-mail e senha para criar conta.");
        return;
      }
      signUp(email, password);
    });

    $("#btnLogout")?.addEventListener("click", () => {
      if (auth) auth.signOut();
    });
    $("#btnLogoutData")?.addEventListener("click", () => {
      if (auth) auth.signOut();
    });
    $("#btnRetrySync")?.addEventListener("click", () => retrySync());
    $("#btnRetrySyncData")?.addEventListener("click", () => retrySync());
  }

  function showSetupInstructions() {
    $("#authSetup")?.classList.remove("hidden");
    $("#authForm")?.classList.add("hidden");
    setAuthError("");
  }

  window.MinhasDespesasCloud = {
    getUserId() {
      return auth?.currentUser?.uid || null;
    },
    queueMonthSave(ym, data) {
      const uid = auth?.currentUser?.uid;
      if (!uid || !db) return;
      pendingMonths.set(ym, data);
      flushPendingPush(uid);
    },
    queuePatchesSave() {
      const uid = auth?.currentUser?.uid;
      if (!uid || !db) return;
      flushPendingPush(uid);
    },
    retrySync,
  };

  function start() {
    wireAuthForm();
    if (!firebaseReady()) {
      showAuth();
      showSetupInstructions();
      return;
    }
    if (!initFirebase()) {
      showAuth();
      showSetupInstructions();
      return;
    }
    showAuth();
    auth.onAuthStateChanged((user) => {
      if (user) onUserSignedIn(user);
      else onUserSignedOut();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
