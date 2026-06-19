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
  let lastSignedInUid = null;
  let lastSyncError = "";

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

  function updateDataStats() {
    const el = $("#dataStats");
    if (!el || !window.MinhasDespesasDataStats) return;
    el.textContent = window.MinhasDespesasDataStats() + (lastSyncError ? " · " + lastSyncError : "");
  }

  function setSyncStatus(text, ok) {
    const el = $("#syncStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("sync-ok", !!ok);
    el.classList.toggle("sync-warn", !ok);
    const showRetry = !ok && text && auth?.currentUser;
    $("#btnRetrySync")?.classList.toggle("hidden", !showRetry);
    if (ok) lastSyncError = "";
    updateDataStats();
  }

  function reportSyncError(e) {
    lastSyncError = syncErrorMessage(e);
    setSyncStatus(lastSyncError, false);
    if (window.MinhasDespesasToast) window.MinhasDespesasToast(lastSyncError);
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
    db.settings({
      ignoreUndefinedProperties: true,
      experimentalAutoDetectLongPolling: true,
    });
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    return true;
  }

  async function ensureAuthReady() {
    const user = auth?.currentUser;
    if (!user) {
      const err = new Error("Não autenticado");
      err.code = "unauthenticated";
      throw err;
    }
    await user.getIdToken(true);
    return user;
  }

  function stripCloudMeta(data) {
    if (!data || typeof data !== "object") return data;
    const out = { ...data };
    delete out.updatedAt;
    return out;
  }

  function sanitizeForFirestore(data) {
    return JSON.parse(JSON.stringify(data, (key, v) => {
      if (v === undefined) return null;
      if (typeof v === "number" && !Number.isFinite(v)) return 0;
      return v;
    }));
  }

  function syncErrorMessage(err) {
    const code = err?.code || "";
    const msg = err?.message || "";
    if (code === "permission-denied" || msg.includes("insufficient permissions")) {
      return "Sem permissão — publique as Regras do Firestore (veja aba Dados)";
    }
    if (code === "unauthenticated") {
      return "Sessão expirada — saia e entre de novo";
    }
    if (code === "unavailable" || code === "network-request-failed") {
      return "Sem internet — tente de novo";
    }
    if (code === "deadline-exceeded") {
      return "Nuvem demorou — tente Sincronizar de novo";
    }
    if (code === "invalid-argument") {
      return "Dado inválido — tente Exportar JSON e reimportar";
    }
    if (code) return `Erro: ${code}`;
    if (msg) return msg.slice(0, 80);
    return "Erro na nuvem";
  }

  function migrateLegacyLocalToUser(uid) {
    const prefix = "minhas-despesas-v2:" + uid + ":";
    const patchesKey = "minhas-despesas-patches-done:" + uid;

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("minhas-despesas-v2:") && !key.includes(":" + uid + ":")) {
        const rest = key.slice("minhas-despesas-v2:".length);
        if (/^\d{4}-\d{2}$/.test(rest)) {
          const dest = prefix + rest;
          if (!localStorage.getItem(dest)) {
            localStorage.setItem(dest, localStorage.getItem(key));
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
          }
        }
      }
    });
  }

  function monthScore(data) {
    if (!data) return 0;
    let s = 0;
    (data.incomes || []).forEach((i) => { s += Number(i.amount) || 0; });
    (data.extras || []).forEach((e) => { s += Number(e.amount) || 0; });
    Object.values(data.bills || {}).forEach((b) => { s += Number(b.amount) || 0; });
    if ((data.customBills || []).length) s += 1;
    if ((data.extras || []).length) s += 1;
    return s;
  }

  /** Nunca apaga edição local sem prova de que a nuvem é mais nova. */
  function mergeMonths(localData, cloudData) {
    if (!cloudData) return localData;
    if (!localData) return monthScore(cloudData) > 0 ? cloudData : localData;

    const localTs = Number(localData.savedAt) || 0;
    const cloudTs = Number(cloudData.savedAt) || 0;

    if (localTs && cloudTs) return localTs >= cloudTs ? localData : cloudData;
    if (localTs && !cloudTs) return localData;
    if (!localTs && cloudTs) return cloudData;
    if (monthScore(cloudData) === 0) return localData;
    if (monthScore(localData) === 0) return cloudData;
    return localData;
  }

  async function pullFromCloud(uid) {
    await ensureAuthReady();
    const monthsSnap = await db.collection("users").doc(uid).collection("months").get();
    const prefix = "minhas-despesas-v2:" + uid + ":";
    let updated = 0;

    monthsSnap.forEach((doc) => {
      const key = prefix + doc.id;
      const cloudData = stripCloudMeta(doc.data());
      const localRaw = localStorage.getItem(key);

      if (!localRaw) {
        if (monthScore(cloudData) > 0) {
          localStorage.setItem(key, JSON.stringify(cloudData));
          updated++;
        }
        return;
      }

      try {
        const localData = JSON.parse(localRaw);
        const merged = mergeMonths(localData, cloudData);
        const mergedJson = JSON.stringify(merged);
        if (mergedJson !== localRaw) {
          localStorage.setItem(key, mergedJson);
          updated++;
        }
      } catch (_) { /* keep local */ }
    });

    try {
      const meta = await db.collection("users").doc(uid).collection("meta").doc("settings").get();
      if (meta.exists && meta.data().patches) {
        localStorage.setItem("minhas-despesas-patches-done:" + uid, JSON.stringify(meta.data().patches));
      }
    } catch (_) { /* ignore */ }

    return { cloudCount: monthsSnap.size, updated };
  }

  async function pushMonthToCloud(uid, ym, data) {
    await ensureAuthReady();
    const clean = sanitizeForFirestore(data);
    delete clean.updatedAt;
    await db.collection("users").doc(uid).collection("months").doc(ym).set({
      ...clean,
      version: 2,
      savedAt: Number(clean.savedAt) || Date.now(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  async function pushPatchesToCloud(uid) {
    try {
      await ensureAuthReady();
      const key = "minhas-despesas-patches-done:" + uid;
      let patches = [];
      try {
        patches = JSON.parse(localStorage.getItem(key) || "[]");
      } catch (_) { /* ignore */ }
      await db.collection("users").doc(uid).collection("meta").doc("settings").set(
        { patches, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn("patches sync", e);
    }
  }

  async function uploadLocalMonths(uid) {
    const prefix = "minhas-despesas-v2:" + uid + ":";
    let count = 0;
    let lastError = null;
    const months = Object.keys(localStorage).filter((key) => {
      if (!key.startsWith(prefix)) return false;
      return /^\d{4}-\d{2}$/.test(key.slice(prefix.length));
    });

    for (const key of months) {
      const ym = key.slice(prefix.length);
      try {
        const data = JSON.parse(localStorage.getItem(key));
        await pushMonthToCloud(uid, ym, data);
        count++;
      } catch (e) {
        console.error("upload", ym, e);
        lastError = e;
      }
    }

    await pushPatchesToCloud(uid);

    if (count === 0 && months.length > 0 && lastError) throw lastError;
    return count;
  }

  async function flushToCloud(uid) {
    clearTimeout(pushTimer);
    pendingMonths.clear();
    return uploadLocalMonths(uid);
  }

  async function runFullSync(user) {
    if (window.MinhasDespesasRecoverLocal) window.MinhasDespesasRecoverLocal(user.uid);

    setSyncStatus("Enviando para nuvem…", true);
    const uploaded = await withTimeout(flushToCloud(user.uid), 25000);

    setSyncStatus("Baixando outros aparelhos…", true);
    const pulled = await withTimeout(pullFromCloud(user.uid), 25000);

    if (pulled.updated > 0) {
      setSyncStatus("Atualizando…", true);
      await withTimeout(uploadLocalMonths(user.uid), 25000);
    }

    setSyncStatus(`Sincronizado · ${uploaded} mês(es)`, true);
    if (window.MinhasDespesasRefresh) window.MinhasDespesasRefresh();
    return { uploaded, pulled };
  }

  function startBackgroundSync(user) {
    if (backgroundSyncPromise) return backgroundSyncPromise;
    backgroundSyncPromise = runFullSync(user)
      .catch((e) => {
        console.error("sync", e);
        reportSyncError(e);
        throw e;
      })
      .finally(() => {
        backgroundSyncPromise = null;
      });
    return backgroundSyncPromise;
  }

  async function retrySync() {
    const user = auth?.currentUser;
    if (!user || !db) {
      setSyncStatus("Entre na conta primeiro", false);
      return false;
    }
    if (backgroundSyncPromise) {
      try { await backgroundSyncPromise; } catch (_) { /* continue */ }
    }
    try {
      await withTimeout(runFullSync(user), 45000);
      if (window.MinhasDespesasToast) window.MinhasDespesasToast("Sincronizado com sucesso");
      return true;
    } catch (e) {
      console.error(e);
      reportSyncError(e);
      return false;
    }
  }

  function scheduleCloudPush(uid) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      flushToCloud(uid)
        .then((n) => setSyncStatus(`Salvo na nuvem · ${n} mês(es)`, true))
        .catch((e) => reportSyncError(e));
    }, 800);
  }

  function queueMonthSave(ym, data) {
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) return;
    const payload = { ...data, savedAt: data.savedAt || Date.now() };
    pendingMonths.set(ym, payload);
    setSyncStatus("Salvando…", true);
    pushMonthToCloud(uid, ym, payload)
      .then(() => setSyncStatus("Salvo na nuvem", true))
      .catch((e) => {
        reportSyncError(e);
        scheduleCloudPush(uid);
      });
  }

  async function signOutSafe() {
    const user = auth?.currentUser;
    if (user && db) {
      setSyncStatus("Salvando antes de sair…", true);
      try {
        await withTimeout(flushToCloud(user.uid), 15000);
        setSyncStatus("Salvo na nuvem", true);
      } catch (e) {
        console.error(e);
        reportSyncError(e);
      }
    }
    lastSignedInUid = null;
    if (auth) await auth.signOut();
  }

  async function onUserSignedIn(user) {
    setAuthError("");
    setAuthLoading(true);
    prepareLocalData(user);
    openApp(user);

    if (lastSignedInUid !== user.uid) {
      lastSignedInUid = user.uid;
      startBackgroundSync(user);
    } else {
      setSyncStatus("Dados neste aparelho", true);
    }
  }

  function onUserSignedOut() {
    pendingMonths.clear();
    lastSignedInUid = null;
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

    $("#btnLogout")?.addEventListener("click", () => { signOutSafe(); });
    $("#btnLogoutData")?.addEventListener("click", () => { signOutSafe(); });
    $("#btnRetrySync")?.addEventListener("click", () => retrySync());
    $("#btnRetrySyncData")?.addEventListener("click", () => retrySync());

    document.addEventListener("visibilitychange", () => {
      const uid = auth?.currentUser?.uid;
      if (document.visibilityState === "hidden" && uid && db && pendingMonths.size) {
        flushToCloud(uid).catch(() => {});
      }
    });
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
      queueMonthSave(ym, data);
    },
    queuePatchesSave() {
      const uid = auth?.currentUser?.uid;
      if (!uid || !db) return;
      pushPatchesToCloud(uid)
        .then(() => setSyncStatus("Salvo na nuvem", true))
        .catch((e) => reportSyncError(e));
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
