(function () {
  "use strict";

  const STORAGE_PREFIX = "minhas-despesas:";
  const STORAGE_PREFIX_V2 = "minhas-despesas-v2:";

  const BILLS = [
    { id: "itau", label: "Empréstimo (Reneg. Itaú)", icon: "🏦", kind: "fixed" },
    { id: "contrib", label: "Contribuição das", icon: "🤝", kind: "fixed" },
    { id: "cond", label: "Condomínio Boa Vista", icon: "🏠", kind: "fixed" },
    { id: "fin", label: "Financiamento", icon: "📋", kind: "fixed" },
    { id: "cpfl", label: "Luz (CPFL)", icon: "⚡", kind: "variable" },
    { id: "card", label: "Cartão de crédito", icon: "💳", kind: "variable" },
  ];

  const BILLS_FIXED = BILLS.filter((b) => b.kind === "fixed");
  const BILLS_VARIABLE = BILLS.filter((b) => b.kind === "variable");

  function normalizeCustomBill(raw) {
    return {
      id: raw.id || uid(),
      label: String(raw.label || "Nova conta").trim() || "Nova conta",
      icon: raw.icon || "📄",
      kind: raw.kind === "variable" ? "variable" : "fixed",
    };
  }

  function getCustomBills(data) {
    return (data?.customBills || []).map(normalizeCustomBill);
  }

  function getAllBills(data) {
    return BILLS.concat(getCustomBills(data));
  }

  function getAllBillsFixed(data) {
    return getAllBills(data).filter((b) => b.kind === "fixed");
  }

  function getAllBillsVariable(data) {
    return getAllBills(data).filter((b) => b.kind === "variable");
  }

  function ensureMonthShape(data) {
    if (!data.customBills) data.customBills = [];
    if (!data.bills) data.bills = {};
    BILLS.forEach((b) => {
      if (!data.bills[b.id]) data.bills[b.id] = emptyBill();
    });
    data.customBills = data.customBills.map(normalizeCustomBill);
    data.customBills.forEach((cb) => {
      if (!data.bills[cb.id]) data.bills[cb.id] = emptyBill();
    });
    return data;
  }

  const PATCHES_KEY_BASE = "minhas-despesas-patches-done";

  let currentUserId = null;

  const PRESETS = {
    "2026-05": {
      incomes: [
        { id: "salary", label: "Salário", amount: 1600, type: "salary", date: "2026-05-05", received: true },
        { id: "abono", label: "Abono salarial (1x ao ano)", amount: 1621, type: "bonus", date: "2026-05-18", received: true },
      ],
      bills: {
        itau: { amount: 201.2, due: "2026-05-01", status: "pending", paidDate: "", paidPart: 0 },
        contrib: { amount: 86.05, due: "2026-05-20", status: "pending", paidDate: "", paidPart: 0 },
        cond: { amount: 287.42, due: "2026-05-10", status: "pending", paidDate: "", paidPart: 0 },
        cpfl: { amount: 39.93, due: "2026-05-13", status: "pending", paidDate: "", paidPart: 0 },
        card: { amount: 2007.64, due: "2026-05-15", status: "pending", paidDate: "", paidPart: 0 },
        fin: { amount: 439.98, due: "2026-05-24", status: "pending", paidDate: "", paidPart: 0 },
      },
      extras: [],
    },
    "2026-06": {
      incomes: [
        { id: "salary", label: "Salário", amount: 1600, type: "salary", date: "2026-06-05", received: true },
        { id: "marido", label: "Transferência do marido", amount: 2500, type: "partner", date: "2026-06-18", received: true },
      ],
      bills: {
        itau: { amount: 201.2, due: "2026-06-01", status: "pending", paidDate: "", paidPart: 0 },
        contrib: { amount: 86.05, due: "2026-06-20", status: "pending", paidDate: "", paidPart: 0 },
        cond: { amount: 287.42, due: "2026-06-10", status: "pending", paidDate: "", paidPart: 0 },
        cpfl: { amount: 39.93, due: "2026-06-13", status: "pending", paidDate: "", paidPart: 0 },
        card: { amount: 0, due: "2026-06-15", status: "pending", paidDate: "", paidPart: 0 },
        fin: { amount: 439.98, due: "2026-06-24", status: "pending", paidDate: "", paidPart: 0 },
      },
      extras: [
        { id: "nala", label: "Nala (gata) — exames veterinário", amount: 855, date: "2026-06-18", status: "paid", paidDate: "2026-06-18", paidPart: 0 },
        { id: "faxineira", label: "Faxineira (PIX — você pagou)", amount: 180, date: "2026-06-17", status: "paid", paidDate: "2026-06-17", paidPart: 0 },
        { id: "cozinheira", label: "Cozinheira (PIX)", amount: 291.4, date: "2026-06-10", status: "paid", paidDate: "2026-06-10", paidPart: 0 },
      ],
    },
  };

  const $ = (sel) => document.querySelector(sel);
  const refMonth = $("#refMonth");
  let projOpenMonth = null;
  let activeView = "home";

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function storageKey(ym) {
    const scope = currentUserId ? currentUserId + ":" : "";
    return STORAGE_PREFIX_V2 + scope + ym;
  }

  function patchesKey() {
    const scope = currentUserId ? ":" + currentUserId : "";
    return PATCHES_KEY_BASE + scope;
  }

  function cloudSaveMonth(ym, data) {
    if (window.MinhasDespesasCloud?.queueMonthSave) {
      window.MinhasDespesasCloud.queueMonthSave(ym, { ...data, version: 2 });
    }
  }

  function cloudSavePatches() {
    if (window.MinhasDespesasCloud?.queuePatchesSave) {
      window.MinhasDespesasCloud.queuePatchesSave();
    }
  }

  function formatMoney(n) {
    return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseMoney(v) {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function currentYM() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function addMonths(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatMonthTitle(ym) {
    const [y, m] = ym.split("-").map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2400);
  }

  function emptyBill() {
    return { amount: 0, due: "", status: "pending", paidDate: "", paidPart: 0 };
  }

  function normalizeBill(raw) {
    if (raw == null) return emptyBill();
    if (typeof raw === "number") return { ...emptyBill(), amount: Math.max(0, raw) };
    return {
      amount: Math.max(0, parseMoney(raw.amount)),
      due: typeof raw.due === "string" ? raw.due : "",
      status: ["paid", "partial", "pending"].includes(raw.status) ? raw.status : "pending",
      paidDate: typeof raw.paidDate === "string" ? raw.paidDate : "",
      paidPart: Math.max(0, parseMoney(raw.paidPart)),
    };
  }

  function emptyIncome(label = "Nova entrada", type = "other") {
    return { id: uid(), label, amount: 0, type, date: todayISO(), received: false };
  }

  function normalizeIncome(raw) {
    return {
      id: raw.id || uid(),
      label: String(raw.label || "Entrada").trim() || "Entrada",
      amount: Math.max(0, parseMoney(raw.amount)),
      type: ["salary", "bonus", "partner", "other"].includes(raw.type) ? raw.type : "other",
      date: typeof raw.date === "string" ? raw.date : todayISO(),
      received: !!raw.received,
    };
  }

  function emptyExtra() {
    return { id: uid(), label: "", amount: 0, date: todayISO(), status: "pending", paidDate: "", paidPart: 0 };
  }

  function normalizeExtra(raw) {
    return {
      id: raw.id || uid(),
      label: String(raw.label || "").trim(),
      amount: Math.max(0, parseMoney(raw.amount)),
      date: typeof raw.date === "string" ? raw.date : todayISO(),
      status: ["paid", "partial", "pending"].includes(raw.status) ? raw.status : "pending",
      paidDate: typeof raw.paidDate === "string" ? raw.paidDate : "",
      paidPart: Math.max(0, parseMoney(raw.paidPart)),
    };
  }

  function emptyMonth() {
    const bills = {};
    BILLS.forEach((b) => { bills[b.id] = emptyBill(); });
    return { version: 2, incomes: [emptyIncome("Salário", "salary")], bills, extras: [], customBills: [] };
  }

  function migrateLegacy(ym, raw) {
    if (raw.version === 2) return raw;
    const data = emptyMonth();
    if (raw.salary != null && String(raw.salary).trim() !== "") {
      data.incomes = [normalizeIncome({ id: "salary", label: "Salário", amount: raw.salary, type: "salary", received: true })];
    }
    const items = raw.items || raw.amounts || {};
    BILLS.forEach((b) => {
      if (items[b.id] != null) data.bills[b.id] = normalizeBill(items[b.id]);
    });
    return data;
  }

  function monthDataScore(data) {
    const s = summarize(migrateLegacy("", data));
    return s.totalExpenses + s.totalIncome;
  }

  function findOrphanMonth(ym) {
    const keys = [
      STORAGE_PREFIX_V2 + ym,
      STORAGE_PREFIX + ym,
    ];
    let best = null;
    let bestScore = -1;
    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      try {
        const data = migrateLegacy(ym, JSON.parse(raw));
        const score = monthDataScore(data);
        if (score > bestScore) {
          bestScore = score;
          best = data;
        }
      } catch (_) { /* ignore */ }
    });
    return best;
  }

  function recoverAllOrphanMonths(forUid) {
    const uid = forUid || currentUserId;
    if (!uid) return 0;
    const userPrefix = STORAGE_PREFIX_V2 + uid + ":";
    const seen = new Set();
    let recovered = 0;

    Object.keys(localStorage).forEach((key) => {
      let ym = null;
      if (key.startsWith(STORAGE_PREFIX_V2) && !key.startsWith(userPrefix)) {
        const rest = key.slice(STORAGE_PREFIX_V2.length);
        if (/^\d{4}-\d{2}$/.test(rest)) ym = rest;
      } else if (key.startsWith(STORAGE_PREFIX) && !key.startsWith(STORAGE_PREFIX_V2)) {
        const rest = key.slice(STORAGE_PREFIX.length);
        if (/^\d{4}-\d{2}$/.test(rest)) ym = rest;
      }
      if (!ym || seen.has(ym)) return;
      seen.add(ym);

      const orphan = findOrphanMonth(ym);
      if (!orphan) return;

      const userRaw = localStorage.getItem(userPrefix + ym);
      if (!userRaw) {
        saveMonth(ym, orphan, uid);
        recovered++;
        return;
      }
      try {
        const userData = migrateLegacy(ym, JSON.parse(userRaw));
        if (monthDataScore(orphan) > monthDataScore(userData)) {
          saveMonth(ym, orphan, uid);
          recovered++;
        }
      } catch (_) {
        saveMonth(ym, orphan, uid);
        recovered++;
      }
    });

    const patchesOrphan = localStorage.getItem(PATCHES_KEY_BASE);
    const patchesUser = PATCHES_KEY_BASE + ":" + uid;
    if (patchesOrphan && !localStorage.getItem(patchesUser)) {
      localStorage.setItem(patchesUser, patchesOrphan);
    }
    return recovered;
  }

  const SEED_ACCOUNT_EMAIL = "franpp22@gmail.com";

  /** Só preenche mês que nunca foi salvo neste aparelho. */
  function seedKnownAccount(email, uid) {
    if ((email || "").trim().toLowerCase() !== SEED_ACCOUNT_EMAIL) return 0;
    const prevUid = currentUserId;
    currentUserId = uid;
    let seeded = 0;
    Object.keys(PRESETS).forEach((ym) => {
      const userKey = STORAGE_PREFIX_V2 + uid + ":" + ym;
      if (localStorage.getItem(userKey)) return;
      let preset = JSON.parse(JSON.stringify(PRESETS[ym]));
      preset.version = 2;
      preset = applyMonthPatch(ym, preset);
      saveMonth(ym, preset, uid);
      seeded++;
    });
    currentUserId = prevUid;
    return seeded;
  }

  function loadMonth(ym) {
    try {
      const v2 = localStorage.getItem(storageKey(ym));
      if (v2) {
        const data = migrateLegacy(ym, JSON.parse(v2));
        const orphan = findOrphanMonth(ym);
        if (orphan && monthDataScore(orphan) > monthDataScore(data)) {
          saveMonth(ym, orphan);
          return orphan;
        }
        return data;
      }
      const orphan = findOrphanMonth(ym);
      if (orphan) {
        saveMonth(ym, orphan);
        return orphan;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function saveMonth(ym, data, explicitUid) {
    const payload = { ...data, version: 2, savedAt: Date.now() };
    const uid = explicitUid !== undefined ? explicitUid : currentUserId;
    const scope = uid ? uid + ":" : "";
    localStorage.setItem(STORAGE_PREFIX_V2 + scope + ym, JSON.stringify(payload));
    if (uid === currentUserId) cloudSaveMonth(ym, payload);
  }

  function getPatchesDone() {
    try {
      return JSON.parse(localStorage.getItem(patchesKey()) || "[]");
    } catch {
      return [];
    }
  }

  function markPatchDone(id) {
    const list = getPatchesDone();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(patchesKey(), JSON.stringify(list));
      cloudSavePatches();
    }
  }

  /** Correções e lançamentos iniciais por mês. */
  function applyMonthPatch(ym, data) {
    if (ym === "2026-06") {
      if (!getPatchesDone().includes("2026-06-jun2026")) {
        data.incomes = data.incomes.filter((i) => i.id !== "abono");
        const addIncome = (inc) => {
          if (!data.incomes.some((i) => i.id === inc.id)) data.incomes.push(normalizeIncome(inc));
        };
        addIncome({ id: "marido", label: "Transferência do marido", amount: 2500, type: "partner", date: "2026-06-18", received: true });
        const addExtra = (ex) => {
          if (!data.extras.some((e) => e.id === ex.id)) data.extras.push(normalizeExtra(ex));
        };
        addExtra({ id: "nala", label: "Nala (gata) — exames veterinário", amount: 855, date: "2026-06-18", status: "paid", paidDate: "2026-06-18", paidPart: 0 });
        addExtra({ id: "faxineira", label: "Faxineira (PIX — você pagou)", amount: 180, date: "2026-06-17", status: "paid", paidDate: "2026-06-17", paidPart: 0 });
        addExtra({ id: "cozinheira", label: "Cozinheira (PIX)", amount: 291.4, date: "2026-06-10", status: "paid", paidDate: "2026-06-10", paidPart: 0 });
        markPatchDone("2026-06-jun2026");
      }
      if (!getPatchesDone().includes("2026-06-no-abono")) {
        data.incomes = data.incomes.filter((i) => i.id !== "abono");
        markPatchDone("2026-06-no-abono");
      }
    }
    if (ym === "2026-05" && !getPatchesDone().includes("2026-05-abono")) {
      if (!data.incomes.some((i) => i.id === "abono")) {
        data.incomes.push(normalizeIncome({
          id: "abono", label: "Abono salarial (1x ao ano)", amount: 1621, type: "bonus", date: "2026-05-18", received: true,
        }));
      }
      markPatchDone("2026-05-abono");
    }
    return data;
  }

  function ensureMonth(ym) {
    let data = loadMonth(ym);
    if (data) {
      data = ensureMonthShape(data);
      if (!localStorage.getItem(storageKey(ym))) saveMonth(ym, data);
      const snap = JSON.stringify(data);
      data = applyMonthPatch(ym, data);
      if (JSON.stringify(data) !== snap) saveMonth(ym, data);
      return data;
    }
    if (PRESETS[ym]) {
      data = JSON.parse(JSON.stringify(PRESETS[ym]));
      data.version = 2;
      saveMonth(ym, data);
      return data;
    }
    data = emptyMonth();
    saveMonth(ym, data);
    return data;
  }

  function paidAmount(item) {
    if (item.status === "paid") return item.amount;
    if (item.status === "partial") return Math.min(item.amount, item.paidPart);
    return 0;
  }

  function summarize(data) {
    const incomes = (data.incomes || []).map(normalizeIncome);
    const extras = (data.extras || []).map(normalizeExtra);
    let billsFixed = 0;
    let billsVariable = 0;
    let billsPlanned = 0;
    let billsPaid = 0;
    BILLS.forEach((b) => {
      const n = normalizeBill(data.bills?.[b.id]);
      billsPlanned += n.amount;
      billsPaid += paidAmount(n);
      if (b.kind === "variable") billsVariable += n.amount;
      else billsFixed += n.amount;
    });
    getCustomBills(data).forEach((b) => {
      const n = normalizeBill(data.bills?.[b.id]);
      billsPlanned += n.amount;
      billsPaid += paidAmount(n);
      if (b.kind === "variable") billsVariable += n.amount;
      else billsFixed += n.amount;
    });
    let extrasPlanned = 0;
    let extrasPaid = 0;
    extras.forEach((e) => {
      extrasPlanned += e.amount;
      extrasPaid += paidAmount(e);
    });
    const ownIncome = incomes.filter((i) => i.type !== "partner").reduce((s, i) => s + i.amount, 0);
    const partnerIncome = incomes.filter((i) => i.type === "partner").reduce((s, i) => s + i.amount, 0);
    const totalIncome = ownIncome + partnerIncome;
    const totalExpenses = billsPlanned + extrasPlanned;
    const totalPaid = billsPaid + extrasPaid;
    const pending = Math.max(0, totalExpenses - totalPaid);
    const balance = totalIncome - totalExpenses;
    const ask = Math.max(0, totalExpenses - totalIncome);
    const askOwn = Math.max(0, totalExpenses - ownIncome);
    return {
      incomes, extras, billsFixed, billsVariable, billsPlanned, billsPaid,
      extrasPlanned, extrasPaid, ownIncome, partnerIncome, totalIncome,
      totalExpenses, totalPaid, pending, balance, ask, askOwn,
    };
  }

  function getMonth() {
    return refMonth.value || currentYM();
  }

  function readBillsFromDom() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const bills = {};
    getAllBills(data).forEach((b) => {
      bills[b.id] = normalizeBill({
        amount: $(`#bill-${b.id}-amount`)?.value,
        due: $(`#bill-${b.id}-due`)?.value || "",
        status: $(`#bill-${b.id}-status`)?.value || "pending",
        paidDate: $(`#bill-${b.id}-paidDate`)?.value || "",
        paidPart: $(`#bill-${b.id}-paidPart`)?.value,
      });
    });
    return bills;
  }

  function readCustomBillsFromDom(data) {
    return getCustomBills(data).map((cb) =>
      normalizeCustomBill({
        id: cb.id,
        label: $(`#bill-${cb.id}-label`)?.value ?? cb.label,
        kind: $(`#bill-${cb.id}-kind`)?.value ?? cb.kind,
        icon: cb.icon,
      })
    );
  }

  function persistFromDom() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    data.bills = readBillsFromDom();
    if (getCustomBills(data).length) {
      data.customBills = readCustomBillsFromDom(data);
    }
    saveMonth(ym, data);
    renderAll();
  }

  function addCustomBill() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const id = "c_" + uid();
    data.customBills.push(normalizeCustomBill({ id, label: "Nova conta", kind: "fixed" }));
    data.bills[id] = emptyBill();
    saveMonth(ym, data);
    renderBills();
    renderHome();
    renderStatement();
    toast("Conta adicionada");
  }

  function removeCustomBill(id) {
    const ym = getMonth();
    const data = ensureMonth(ym);
    data.customBills = getCustomBills(data).filter((b) => b.id !== id);
    delete data.bills[id];
    saveMonth(ym, data);
    renderAll();
    toast("Conta removida");
  }

  function statusBadge(status) {
    if (status === "paid") return '<span class="badge badge-paid">Pago</span>';
    if (status === "partial") return '<span class="badge badge-partial">Parcial</span>';
    return '<span class="badge badge-pending">Pendente</span>';
  }

  function incomeIcon(type) {
    if (type === "salary") return "💼";
    if (type === "bonus") return "🎁";
    if (type === "partner") return "💑";
    return "💰";
  }

  function billBlockHtml(b, n, isCustom) {
    const overdue = isOverdue(n);
    const kindHint = b.kind === "variable"
      ? '<span class="badge badge-partial">Variável</span>'
      : '<span class="badge badge-paid">Fixa</span>';
    const titleHtml = isCustom
      ? `<div class="expense-title" style="flex:1">
          <input type="text" id="bill-${b.id}-label" class="bill-label-input" value="${escapeAttr(b.label)}" placeholder="Nome da conta" />
          <select id="bill-${b.id}-kind" style="margin-top:0.35rem;width:100%">
            <option value="fixed"${b.kind === "fixed" ? " selected" : ""}>Fixa (todo mês)</option>
            <option value="variable"${b.kind === "variable" ? " selected" : ""}>Variável</option>
          </select>
        </div>
        <button type="button" class="btn btn-danger btn-sm btn-del-bill" data-id="${b.id}" title="Remover conta">✕</button>`
      : `<div class="expense-title">${b.label} ${kindHint}</div>`;
    return `
      <div class="expense-block${overdue ? " overdue" : ""}" data-bill="${b.id}">
        <div class="expense-head">
          <span class="expense-icon">${b.icon}</span>
          ${titleHtml}
        </div>
        <div class="expense-grid">
          <div class="span2">
            <label class="field-label" for="bill-${b.id}-amount">Valor</label>
            <div class="amount-row"><span class="prefix">R$</span>
              <input type="number" id="bill-${b.id}-amount" min="0" step="0.01" value="${n.amount > 0 ? n.amount : ""}" placeholder="0,00" inputmode="decimal" />
            </div>
          </div>
          <div>
            <label class="field-label" for="bill-${b.id}-due">Vencimento</label>
            <input type="date" id="bill-${b.id}-due" value="${n.due || ""}" />
          </div>
          <div>
            <label class="field-label" for="bill-${b.id}-status">Situação</label>
            <select id="bill-${b.id}-status">
              <option value="pending"${n.status === "pending" ? " selected" : ""}>Pendente</option>
              <option value="paid"${n.status === "paid" ? " selected" : ""}>Pago</option>
              <option value="partial"${n.status === "partial" ? " selected" : ""}>Parcial</option>
            </select>
          </div>
          <div class="subfields sub-paid${n.status === "paid" ? " visible" : ""}">
            <div>
              <label class="field-label" for="bill-${b.id}-paidDate">Pago em</label>
              <input type="date" id="bill-${b.id}-paidDate" value="${n.paidDate || ""}" />
            </div>
          </div>
          <div class="subfields sub-partial${n.status === "partial" ? " visible" : ""}">
            <div>
              <label class="field-label" for="bill-${b.id}-paidPart">Já pago (R$)</label>
              <div class="amount-row"><span class="prefix">R$</span>
                <input type="number" id="bill-${b.id}-paidPart" min="0" step="0.01" value="${n.paidPart > 0 ? n.paidPart : ""}" placeholder="0,00" inputmode="decimal" />
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderBills() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const host = $("#billsList");
    if (!host) return;

    const renderGroup = (list, title, isCustom) => {
      if (!list.length) return "";
      const blocks = list.map((b) => billBlockHtml(b, normalizeBill(data.bills[b.id]), isCustom)).join("");
      return `<p class="bills-group-title">${title}</p>${blocks}`;
    };

    const customFixed = getCustomBills(data).filter((b) => b.kind === "fixed");
    const customVariable = getCustomBills(data).filter((b) => b.kind === "variable");

    host.innerHTML =
      renderGroup(BILLS_FIXED, "Fixas — mesmo valor todo mês") +
      renderGroup(BILLS_VARIABLE, "Variáveis — mudam (luz, fatura do cartão)") +
      (customFixed.length ? renderGroup(customFixed, "Suas contas fixas", true) : "") +
      (customVariable.length ? renderGroup(customVariable, "Suas contas variáveis", true) : "") +
      '<p class="hint" style="margin-top:0.65rem">Gastos pontuais (Nala, faxineira, cozinheira…) ficam na aba <strong>Gastos</strong>.</p>';

    host.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("input", onBillInput);
      el.addEventListener("change", onBillChange);
    });

    const s = summarize(data);
    const tot = $("#billsTotals");
    if (tot) {
      tot.innerHTML = `
        <div class="metric-grid" style="margin-top:0.85rem;padding-top:0.85rem;border-top:1px solid var(--line)">
          <div class="metric"><span class="metric-label">Fixas</span><strong class="metric-value">R$ ${formatMoney(s.billsFixed)}</strong></div>
          <div class="metric"><span class="metric-label">Variáveis</span><strong class="metric-value">R$ ${formatMoney(s.billsVariable)}</strong></div>
          <div class="metric"><span class="metric-label">Total contas</span><strong class="metric-value">R$ ${formatMoney(s.billsPlanned)}</strong></div>
          <div class="metric"><span class="metric-label">Já pago</span><strong class="metric-value">R$ ${formatMoney(s.billsPaid)}</strong></div>
        </div>`;
    }
  }

  function isOverdue(item) {
    if (item.status === "paid" || !item.due) return false;
    return new Date(item.due + "T12:00:00") < new Date(new Date().toDateString());
  }

  function onBillInput() { persistFromDom(); }

  function onBillChange(e) {
    const t = e.target;
    if (t.id && t.id.endsWith("-status")) {
      const id = t.id.replace("bill-", "").replace("-status", "");
      const block = document.querySelector(`[data-bill="${id}"]`);
      if (block) {
        block.querySelector(".sub-paid")?.classList.toggle("visible", t.value === "paid");
        block.querySelector(".sub-partial")?.classList.toggle("visible", t.value === "partial");
        if (t.value === "paid") {
          const pd = $(`#bill-${id}-paidDate`);
          if (pd && !pd.value) pd.value = todayISO();
        }
      }
    }
    persistFromDom();
  }

  function renderIncome() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const host = $("#incomeList");
    if (!host) return;

    host.innerHTML = data.incomes.map((inc) => {
      const i = normalizeIncome(inc);
      return `
        <div class="tx-item" data-income="${i.id}">
          <span class="tx-icon income">${incomeIcon(i.type)}</span>
          <div class="tx-body" style="flex:1">
            <input type="text" class="inc-label" value="${escapeAttr(i.label)}" placeholder="Descrição" style="margin-bottom:0.35rem" />
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
              <div class="amount-row amount-row--income"><span class="prefix">R$</span>
                <input type="number" class="inc-amount" min="0" step="0.01" value="${i.amount > 0 ? i.amount : ""}" placeholder="0,00" />
              </div>
              <input type="date" class="inc-date" value="${i.date || ""}" />
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.4rem;align-items:center;flex-wrap:wrap">
              <select class="inc-type" style="flex:1;min-width:7rem">
                <option value="salary"${i.type === "salary" ? " selected" : ""}>Salário</option>
                <option value="bonus"${i.type === "bonus" ? " selected" : ""}>Abono / bônus</option>
                <option value="partner"${i.type === "partner" ? " selected" : ""}>Marido / cônjuge</option>
                <option value="other"${i.type === "other" ? " selected" : ""}>Outro</option>
              </select>
              <label style="font-size:0.75rem;display:flex;align-items:center;gap:0.3rem;cursor:pointer">
                <input type="checkbox" class="inc-received"${i.received ? " checked" : ""} /> Recebido
              </label>
            </div>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-del-income" data-id="${i.id}" title="Remover">✕</button>
        </div>`;
    }).join("") || '<p class="empty-state">Nenhuma entrada. Adicione salário, abono etc.</p>';

    host.querySelectorAll(".inc-label, .inc-amount, .inc-date, .inc-type, .inc-received").forEach((el) => {
      el.addEventListener("change", saveIncomeFromDom);
      el.addEventListener("input", saveIncomeFromDom);
    });
    host.querySelectorAll(".btn-del-income").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const data = ensureMonth(getMonth());
        data.incomes = data.incomes.filter((x) => x.id !== id);
        if (data.incomes.length === 0) data.incomes.push(emptyIncome("Salário", "salary"));
        saveMonth(getMonth(), data);
        renderAll();
      });
    });
  }

  function saveIncomeFromDom() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const items = [];
    document.querySelectorAll("[data-income]").forEach((row) => {
      items.push(normalizeIncome({
        id: row.dataset.income,
        label: row.querySelector(".inc-label")?.value,
        amount: row.querySelector(".inc-amount")?.value,
        date: row.querySelector(".inc-date")?.value,
        type: row.querySelector(".inc-type")?.value,
        received: row.querySelector(".inc-received")?.checked,
      }));
    });
    data.incomes = items.length ? items : [emptyIncome("Salário", "salary")];
    saveMonth(ym, data);
    renderHome();
    renderStatement();
    renderProjection();
  }

  function renderExtras() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const host = $("#extrasList");
    if (!host) return;

    host.innerHTML = data.extras.map((ex) => {
      const e = normalizeExtra(ex);
      return `
        <div class="tx-item${isOverdue(e) ? " overdue" : ""}" data-extra="${e.id}">
          <span class="tx-icon">🛒</span>
          <div class="tx-body" style="flex:1">
            <input type="text" class="ex-label" value="${escapeAttr(e.label)}" placeholder="O que foi?" style="margin-bottom:0.35rem" />
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
              <div class="amount-row"><span class="prefix">R$</span>
                <input type="number" class="ex-amount" min="0" step="0.01" value="${e.amount > 0 ? e.amount : ""}" placeholder="0,00" />
              </div>
              <input type="date" class="ex-date" value="${e.date || ""}" />
            </div>
            <div style="margin-top:0.4rem">
              <select class="ex-status">
                <option value="pending"${e.status === "pending" ? " selected" : ""}>Pendente</option>
                <option value="paid"${e.status === "paid" ? " selected" : ""}>Pago</option>
                <option value="partial"${e.status === "partial" ? " selected" : ""}>Parcial</option>
              </select>
            </div>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-del-extra" data-id="${e.id}">✕</button>
        </div>`;
    }).join("") || '<p class="empty-state">Nenhum gasto extra neste mês.</p>';

    host.querySelectorAll(".ex-label, .ex-amount, .ex-date, .ex-status").forEach((el) => {
      el.addEventListener("change", saveExtrasFromDom);
      el.addEventListener("input", saveExtrasFromDom);
    });
    host.querySelectorAll(".btn-del-extra").forEach((btn) => {
      btn.addEventListener("click", () => {
        const data = ensureMonth(getMonth());
        data.extras = data.extras.filter((x) => x.id !== btn.dataset.id);
        saveMonth(getMonth(), data);
        renderAll();
      });
    });
  }

  function saveExtrasFromDom() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const items = [];
    document.querySelectorAll("[data-extra]").forEach((row) => {
      items.push(normalizeExtra({
        id: row.dataset.extra,
        label: row.querySelector(".ex-label")?.value,
        amount: row.querySelector(".ex-amount")?.value,
        date: row.querySelector(".ex-date")?.value,
        status: row.querySelector(".ex-status")?.value,
      }));
    });
    data.extras = items;
    saveMonth(ym, data);
    renderHome();
    renderStatement();
    renderProjection();
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function statusLabel(status) {
    if (status === "paid") return "Pago";
    if (status === "partial") return "Parcial";
    return "Pendente";
  }

  function buildStatementLines(data) {
    const lines = [];
    (data.incomes || []).map(normalizeIncome).forEach((i) => {
      if (i.amount <= 0) return;
      lines.push({
        kind: "in",
        group: "Entradas",
        date: i.date,
        label: i.label,
        amount: i.amount,
        status: i.received ? "Recebido" : "Previsto",
        icon: incomeIcon(i.type),
      });
    });
    BILLS.forEach((b) => {
      const n = normalizeBill(data.bills?.[b.id]);
      if (n.amount <= 0) return;
      lines.push({
        kind: "out",
        group: b.kind === "fixed" ? "Contas fixas" : "Contas variáveis",
        date: n.due || n.paidDate,
        label: b.label,
        amount: n.amount,
        status: statusLabel(n.status),
        icon: b.icon,
      });
    });
    getCustomBills(data).forEach((b) => {
      const n = normalizeBill(data.bills?.[b.id]);
      if (n.amount <= 0) return;
      lines.push({
        kind: "out",
        group: b.kind === "fixed" ? "Suas contas fixas" : "Suas contas variáveis",
        date: n.due || n.paidDate,
        label: b.label,
        amount: n.amount,
        status: statusLabel(n.status),
        icon: b.icon,
      });
    });
    (data.extras || []).map(normalizeExtra).forEach((e) => {
      if (e.amount <= 0) return;
      lines.push({
        kind: "out",
        group: "Outros gastos",
        date: e.date || e.paidDate,
        label: e.label || "Gasto extra",
        amount: e.amount,
        status: statusLabel(e.status),
        icon: "🛒",
      });
    });
    return lines;
  }

  function renderStatement() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const s = summarize(data);
    const host = $("#statementBody");
    const foot = $("#statementFoot");
    const monthLbl = $("#statementMonthLabel");
    if (monthLbl) monthLbl.textContent = formatMonthTitle(ym);
    if (!host) return;

    const lines = buildStatementLines(data);
    const inLines = lines.filter((l) => l.kind === "in");
    const outLines = lines.filter((l) => l.kind === "out");

    const renderGroup = (title, items) => {
      if (!items.length) return "";
      const sorted = [...items].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      const sub = sorted.map((r) => `
        <tr>
          <td>${r.date ? formatDateBR(r.date) : "—"}</td>
          <td><span class="stmt-icon">${r.icon}</span> ${escapeAttr(r.label)}</td>
          <td class="stmt-status">${r.status}</td>
          <td class="stmt-amt ${r.kind === "in" ? "amt-pos" : "amt-neg"}">${r.kind === "in" ? "+" : "−"} R$ ${formatMoney(r.amount)}</td>
        </tr>`).join("");
      const subtotal = items.reduce((sum, r) => sum + r.amount, 0);
      return `
        <tr class="stmt-section"><td colspan="4">${title}</td></tr>
        ${sub}
        <tr class="stmt-subtotal"><td colspan="3">Subtotal ${title.toLowerCase()}</td>
          <td class="stmt-amt">R$ ${formatMoney(subtotal)}</td></tr>`;
    };

    const inGroups = {};
    inLines.forEach((l) => { (inGroups[l.group] = inGroups[l.group] || []).push(l); });
    const outByGroup = {};
    outLines.forEach((l) => { (outByGroup[l.group] = outByGroup[l.group] || []).push(l); });

    let html = renderGroup("Entradas", inLines);
    ["Contas fixas", "Contas variáveis", "Outros gastos"].forEach((g) => {
      if (outByGroup[g]) html += renderGroup(g, outByGroup[g]);
    });

    host.innerHTML = html || '<tr><td colspan="4" class="empty-state">Nenhum lançamento com valor neste mês.</td></tr>';

    if (foot) {
      foot.innerHTML = `
        <tr class="stmt-total"><td colspan="3">Total entradas</td><td class="stmt-amt amt-pos">R$ ${formatMoney(s.totalIncome)}</td></tr>
        <tr class="stmt-total"><td colspan="3">Total saídas</td><td class="stmt-amt amt-neg">R$ ${formatMoney(s.totalExpenses)}</td></tr>
        <tr class="stmt-total stmt-total--bal"><td colspan="3">Saldo do mês</td>
          <td class="stmt-amt ${s.balance >= 0 ? "amt-pos" : "amt-neg"}">R$ ${formatMoney(s.balance)}</td></tr>
        <tr class="stmt-total"><td colspan="3">Já pago</td><td>R$ ${formatMoney(s.totalPaid)}</td></tr>
        <tr class="stmt-total"><td colspan="3">Falta pagar</td><td>R$ ${formatMoney(s.pending)}</td></tr>`;
    }
  }

  function renderHome() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const s = summarize(data);

    $("#headerSubtitle").textContent = formatMonthTitle(ym);

    const hero = $("#heroAsk");
    const heroVal = $("#heroAskVal");
    if (hero && heroVal) {
      heroVal.textContent = formatMoney(s.ask);
      hero.classList.toggle("need", s.ask > 0);
      hero.classList.toggle("ok", s.ask <= 0);
      hero.querySelector(".hero-label").textContent =
        s.ask > 0 ? "Quanto pedir ao marido" : "Nada a pedir neste mês";
      const note = hero.querySelector(".hero-note");
      if (note) {
        note.innerHTML = s.partnerIncome > 0
          ? `Marido já enviou <strong>R$ ${formatMoney(s.partnerIncome)}</strong>. Falta cobrir <strong>R$ ${formatMoney(s.ask)}</strong> no total do mês.`
          : "Com base em <strong>todas as despesas</strong> menos <strong>toda a renda</strong> do mês.";
      }
    }

    const metrics = $("#homeMetrics");
    if (metrics) {
      const balClass = s.balance >= 0 ? "amt-pos" : "amt-neg";
      metrics.innerHTML = `
        <div class="metric"><span class="metric-label">Sua renda</span><strong class="metric-value amt-pos">R$ ${formatMoney(s.ownIncome)}</strong></div>
        <div class="metric"><span class="metric-label">Do marido</span><strong class="metric-value">R$ ${formatMoney(s.partnerIncome)}</strong></div>
        <div class="metric"><span class="metric-label">Contas fixas</span><strong class="metric-value">R$ ${formatMoney(s.billsFixed)}</strong></div>
        <div class="metric"><span class="metric-label">Variáveis + gastos</span><strong class="metric-value amt-neg">R$ ${formatMoney(s.billsVariable + s.extrasPlanned)}</strong></div>
        <div class="metric"><span class="metric-label">Já pago</span><strong class="metric-value">R$ ${formatMoney(s.totalPaid)}</strong></div>
        <div class="metric"><span class="metric-label">Falta pagar</span><strong class="metric-value">R$ ${formatMoney(s.pending)}</strong></div>
        <div class="metric metric--wide"><span class="metric-label">Sobra do mês</span><strong class="metric-value ${balClass}">R$ ${formatMoney(s.balance)}</strong></div>`;
    }

    const upcoming = $("#upcomingList");
    if (upcoming) {
      const rows = [];
      BILLS.forEach((b) => {
        const n = normalizeBill(data.bills[b.id]);
        if (n.amount > 0 && n.status !== "paid") {
          rows.push({ label: b.label, icon: b.icon, amount: n.amount, due: n.due, type: "bill" });
        }
      });
      getCustomBills(data).forEach((b) => {
        const n = normalizeBill(data.bills[b.id]);
        if (n.amount > 0 && n.status !== "paid") {
          rows.push({ label: b.label, icon: b.icon, amount: n.amount, due: n.due, type: "bill" });
        }
      });
      data.extras.forEach((ex) => {
        const e = normalizeExtra(ex);
        if (e.amount > 0 && e.status !== "paid") {
          rows.push({ label: e.label || "Gasto extra", icon: "🛒", amount: e.amount, due: e.date, type: "extra" });
        }
      });
      rows.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      upcoming.innerHTML = rows.length
        ? rows.slice(0, 6).map((r) => `
          <div class="tx-item">
            <span class="tx-icon">${r.icon}</span>
            <div class="tx-body">
              <div class="tx-title">${r.label}</div>
              <div class="tx-meta">${r.due ? "Vence " + formatDateBR(r.due) : "Sem data"}</div>
            </div>
            <span class="tx-amount expense">R$ ${formatMoney(r.amount)}</span>
          </div>`).join("")
        : '<p class="empty-state">Nenhuma conta pendente com valor.</p>';
    }
  }

  function formatDateBR(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function payloadFromMonthData(data) {
    return summarize(migrateLegacy("", data));
  }

  function getProjectionPayload(ym, baseData) {
    return localStorage.getItem(storageKey(ym)) ? ensureMonth(ym) : baseData;
  }

  function buildProjExpandHtml(m, baseData) {
    const billFields = (list, title) => {
      if (!list.length) return "";
      let html = `<p class="hint" style="margin:0.5rem 0 0.25rem;font-weight:700;color:var(--text)">${title}</p>`;
      list.forEach((b) => {
        html += `<div class="proj-line-field">
          <label class="field-label">${b.icon} ${b.label}</label>
          <div class="amount-row"><span class="prefix">R$</span>
            <input type="number" data-proj="bill" data-id="${b.id}" min="0" step="0.01" placeholder="0,00" />
          </div></div>`;
      });
      return html;
    };

    const customFixed = getCustomBills(baseData).filter((b) => b.kind === "fixed");
    const customVariable = getCustomBills(baseData).filter((b) => b.kind === "variable");

    return `<tr class="proj-expand-row" data-proj-expand="${m}" hidden>
      <td colspan="6">
        <div class="proj-inline-editor" data-proj-editor="${m}">
          <p class="hint" style="margin:0 0 0.6rem;font-weight:700;color:var(--text)">Valores — ${formatMonthTitle(m)}</p>
          <div class="proj-inline-grid">
            <div class="proj-line-field">
              <label class="field-label">💼 Salário</label>
              <div class="amount-row amount-row--income"><span class="prefix">R$</span>
                <input type="number" data-proj="salary" min="0" step="0.01" placeholder="0,00" />
              </div>
            </div>
            <div class="proj-line-field">
              <label class="field-label">🎁 Abono / outras entradas</label>
              <div class="amount-row amount-row--income"><span class="prefix">R$</span>
                <input type="number" data-proj="bonus" min="0" step="0.01" placeholder="0,00" />
              </div>
            </div>
            ${billFields(BILLS_FIXED, "Contas fixas")}
            ${billFields(BILLS_VARIABLE, "Contas variáveis")}
            ${billFields(customFixed, "Suas contas fixas")}
            ${billFields(customVariable, "Suas contas variáveis")}
            <div class="proj-line-field">
              <label class="field-label">🛒 Outros gastos (total)</label>
              <div class="amount-row"><span class="prefix">R$</span>
                <input type="number" data-proj="extras" min="0" step="0.01" placeholder="0,00" />
              </div>
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost btn-proj-copy" data-month="${m}">Igual à tela</button>
            <button type="button" class="btn btn-ghost btn-proj-close" data-month="${m}">Fechar</button>
            <button type="button" class="btn btn-primary btn-proj-save" data-month="${m}">Salvar mês</button>
          </div>
        </div>
      </td>
    </tr>`;
  }

  function incomeParts(data) {
    const incomes = (data.incomes || []).map(normalizeIncome);
    let salary = 0;
    let bonus = 0;
    incomes.forEach((i) => {
      if (i.type === "salary") salary += i.amount;
      else if (i.type !== "partner") bonus += i.amount;
    });
    const extrasTotal = (data.extras || []).reduce((s, e) => s + normalizeExtra(e).amount, 0);
    return { salary, bonus, extrasTotal };
  }

  function fillProjEditor(m) {
    const root = document.querySelector(`[data-proj-editor="${m}"]`);
    if (!root) return;
    const base = ensureMonth(getMonth());
    const data = getProjectionPayload(m, base);
    const parts = incomeParts(data);
    root.querySelector('[data-proj="salary"]').value = parts.salary > 0 ? parts.salary : "";
    root.querySelector('[data-proj="bonus"]').value = parts.bonus > 0 ? parts.bonus : "";
    root.querySelector('[data-proj="extras"]').value = parts.extrasTotal > 0 ? parts.extrasTotal : "";
    getAllBills(data).forEach((b) => {
      const n = normalizeBill(data.bills[b.id]);
      const inp = root.querySelector(`[data-proj="bill"][data-id="${b.id}"]`);
      if (inp) inp.value = n.amount > 0 ? n.amount : "";
    });
  }

  function saveProjMonth(m) {
    const root = document.querySelector(`[data-proj-editor="${m}"]`);
    if (!root) return;
    const prev = localStorage.getItem(storageKey(m)) ? ensureMonth(m) : emptyMonth();
    const salary = parseMoney(root.querySelector('[data-proj="salary"]')?.value);
    const bonus = parseMoney(root.querySelector('[data-proj="bonus"]')?.value);
    const extrasAmt = parseMoney(root.querySelector('[data-proj="extras"]')?.value);

    const incomes = [];
    if (salary > 0) incomes.push(normalizeIncome({ id: "salary", label: "Salário", amount: salary, type: "salary", received: false }));
    if (bonus > 0) incomes.push(normalizeIncome({ id: "bonus", label: "Abono / outras entradas", amount: bonus, type: "bonus", received: false }));
    if (incomes.length === 0) incomes.push(emptyIncome("Salário", "salary"));

    const bills = {};
    getAllBills(prev).forEach((b) => {
      const amt = parseMoney(root.querySelector(`[data-proj="bill"][data-id="${b.id}"]`)?.value);
      const old = normalizeBill(prev.bills?.[b.id]);
      bills[b.id] = { ...old, amount: amt };
    });

    const extras = extrasAmt > 0
      ? [normalizeExtra({ id: "proj-extras", label: "Gastos variáveis (projeção)", amount: extrasAmt, status: "pending" })]
      : [];

    saveMonth(m, { version: 2, incomes, bills, extras, customBills: prev.customBills || [] });
    projOpenMonth = null;
    const row = document.querySelector(`[data-proj-expand="${m}"]`);
    if (row) row.setAttribute("hidden", "");
    renderAll();
    toast("Mês salvo na projeção");
  }

  function renderProjection() {
    const baseYm = getMonth();
    const body = $("#projectionBody");
    if (!body) return;
    const base = ensureMonth(baseYm);
    let html = "";
    for (let i = 1; i <= 6; i++) {
      const m = addMonths(baseYm, i);
      const hasSaved = !!localStorage.getItem(storageKey(m));
      const data = getProjectionPayload(m, base);
      const s = summarize(data);
      const badge = hasSaved ? '<span class="badge badge-paid">Salvo</span>' : '<span class="badge badge-pending">Espelho</span>';
      const askC = s.ask > 0 ? "amt-neg" : "amt-pos";
      const balC = s.balance < 0 ? "amt-neg" : s.balance > 0 ? "amt-pos" : "";
      html += `<tr>
        <td>${formatMonthTitle(m)} ${badge}</td>
        <td class="mono">R$ ${formatMoney(s.totalExpenses)}</td>
        <td class="mono">R$ ${formatMoney(s.totalIncome)}</td>
        <td class="mono ${askC}">R$ ${formatMoney(s.ask)}</td>
        <td class="mono ${balC}">R$ ${formatMoney(s.balance)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm btn-proj-edit" data-month="${m}">Editar</button></td>
      </tr>`;
      html += buildProjExpandHtml(m, base);
    }
    body.innerHTML = html;
    if (projOpenMonth) {
      const row = document.querySelector(`[data-proj-expand="${projOpenMonth}"]`);
      if (row) {
        row.removeAttribute("hidden");
        fillProjEditor(projOpenMonth);
      }
    }
  }

  function userStoragePrefix() {
    return STORAGE_PREFIX_V2 + (currentUserId ? currentUserId + ":" : "");
  }

  function renderDataStats() {
    const el = $("#dataStats");
    const sync = $("#syncStatus")?.textContent || "";
    if (el) {
      const local = window.MinhasDespesasDataStats ? window.MinhasDespesasDataStats() : "";
      el.textContent = `${local}. ${sync}`;
    }
  }

  function exportJson() {
    const out = { exportedAt: new Date().toISOString(), version: 2, months: {} };
    const prefix = userStoragePrefix();
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(prefix)) {
        out.months[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k));
      }
    });
    downloadFile("minhas-despesas-backup.json", JSON.stringify(out, null, 2), "application/json");
    toast("JSON exportado");
  }

  function exportCsv() {
    const rows = [["Mês", "Tipo", "Descrição", "Valor", "Vencimento/Data", "Situação"]];
    const prefix = userStoragePrefix();
    Object.keys(localStorage).filter((k) => k.startsWith(prefix)).sort().forEach((k) => {
      const ym = k.slice(prefix.length);
      const data = JSON.parse(localStorage.getItem(k));
      (data.incomes || []).forEach((i) => {
        const n = normalizeIncome(i);
        const tipo = n.type === "partner" ? "Renda (marido)" : n.type === "salary" ? "Salário" : n.type === "bonus" ? "Abono" : "Renda";
        rows.push([ym, tipo, n.label, n.amount, n.date, n.received ? "Recebido" : "Previsto"]);
      });
      getAllBills(ensureMonthShape(data)).forEach((b) => {
        const n = normalizeBill(data.bills?.[b.id]);
        if (n.amount <= 0) return;
        const isCustom = !BILLS.some((x) => x.id === b.id);
        const tipo = b.kind === "fixed"
          ? (isCustom ? "Conta fixa (sua)" : "Conta fixa")
          : (isCustom ? "Conta variável (sua)" : "Conta variável");
        rows.push([ym, tipo, b.label, n.amount, n.due, n.status]);
      });
      (data.extras || []).forEach((e) => {
        const n = normalizeExtra(e);
        if (n.amount > 0) rows.push([ym, "Gasto extra", n.label, n.amount, n.date, n.status]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    downloadFile("minhas-despesas.csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
    toast("CSV exportado");
  }

  function downloadFile(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const months = data.months || data;
        let count = 0;
        Object.keys(months).forEach((ym) => {
          if (/^\d{4}-\d{2}$/.test(ym)) {
            saveMonth(ym, migrateLegacy(ym, months[ym]));
            count++;
          }
        });
        renderAll();
        toast(`${count} mês(es) importado(s)`);
      } catch {
        toast("Arquivo inválido");
      }
    };
    reader.readAsText(file);
  }

  function exportCsvStatement() {
    const ym = getMonth();
    const data = ensureMonth(ym);
    const rows = [["Data", "Tipo", "Grupo", "Descrição", "Situação", "Valor"]];
    buildStatementLines(data).forEach((r) => {
      rows.push([
        r.date ? formatDateBR(r.date) : "",
        r.kind === "in" ? "Entrada" : "Saída",
        r.group,
        r.label,
        r.status,
        (r.kind === "in" ? "" : "-") + r.amount.toFixed(2).replace(".", ","),
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    downloadFile(`extrato-${ym}.csv`, "\uFEFF" + csv, "text/csv;charset=utf-8");
    toast("Extrato exportado");
  }

  function renderAll() {
    renderHome();
    renderStatement();
    renderBills();
    renderIncome();
    renderExtras();
    renderProjection();
    renderDataStats();
  }

  function switchView(name) {
    activeView = name;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
      b.toggleAttribute("aria-current", b.dataset.view === name ? "page" : false);
    });
    const el = document.getElementById("view-" + name);
    if (el) el.classList.add("active");
  }

  let appWired = false;

  function wireApp() {
    if (appWired) return;
    appWired = true;

    refMonth.addEventListener("change", () => {
      projOpenMonth = null;
      renderAll();
    });

    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    $("#btnAddIncome")?.addEventListener("click", () => {
      const data = ensureMonth(getMonth());
      data.incomes.push(emptyIncome("Nova entrada", "other"));
      saveMonth(getMonth(), data);
      renderIncome();
      renderHome();
    });

    $("#btnAddExtra")?.addEventListener("click", () => {
      const data = ensureMonth(getMonth());
      data.extras.push(emptyExtra());
      saveMonth(getMonth(), data);
      renderExtras();
      renderHome();
    });

    $("#btnAddBill")?.addEventListener("click", addCustomBill);

    document.getElementById("view-bills")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-del-bill");
      if (btn?.dataset.id) removeCustomBill(btn.dataset.id);
    });

    $("#btnExportJson")?.addEventListener("click", exportJson);
    $("#btnExportCsv")?.addEventListener("click", exportCsv);
    $("#btnExportCsvStmt")?.addEventListener("click", exportCsvStatement);
    $("#btnImportJson")?.addEventListener("click", () => $("#importFile")?.click());
    $("#btnRecoverLocal")?.addEventListener("click", () => {
      const n = recoverAllOrphanMonths();
      renderAll();
      toast(n > 0 ? `Recuperados ${n} mês(es) neste aparelho` : "Nenhum dado antigo encontrado aqui");
      if (n > 0 && window.MinhasDespesasCloud?.queuePatchesSave) {
        Object.keys(localStorage).filter((k) => k.startsWith(userStoragePrefix())).forEach((k) => {
          const ym = k.slice(userStoragePrefix().length);
          if (/^\d{4}-\d{2}$/.test(ym)) {
            try {
              cloudSaveMonth(ym, JSON.parse(localStorage.getItem(k)));
            } catch (_) { /* ignore */ }
          }
        });
        window.MinhasDespesasCloud.queuePatchesSave();
      }
    });
    $("#importFile")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) importJson(f);
      e.target.value = "";
    });

    document.getElementById("view-projection")?.addEventListener("click", (e) => {
      const t = e.target;
      const edit = t.closest(".btn-proj-edit");
      if (edit) {
        const m = edit.dataset.month;
        const row = document.querySelector(`[data-proj-expand="${m}"]`);
        if (!row) return;
        const wasOpen = projOpenMonth === m && !row.hasAttribute("hidden");
        document.querySelectorAll("[data-proj-expand]").forEach((r) => r.setAttribute("hidden", ""));
        if (wasOpen) { projOpenMonth = null; return; }
        projOpenMonth = m;
        row.removeAttribute("hidden");
        fillProjEditor(m);
        return;
      }
      if (t.closest(".btn-proj-copy")) { fillProjEditor(t.closest(".btn-proj-copy").dataset.month); return; }
      if (t.closest(".btn-proj-close")) {
        const m = t.closest(".btn-proj-close").dataset.month;
        document.querySelector(`[data-proj-expand="${m}"]`)?.setAttribute("hidden", "");
        if (projOpenMonth === m) projOpenMonth = null;
        return;
      }
      if (t.closest(".btn-proj-save")) saveProjMonth(t.closest(".btn-proj-save").dataset.month);
    });

    buildList();
  }

  window.MinhasDespesasInit = function (uid, email) {
    currentUserId = uid;
    wireApp();
    recoverAllOrphanMonths();
    refMonth.value = currentYM();
    applyMonth();
    renderAll();
  };

  window.MinhasDespesasRecoverLocal = recoverAllOrphanMonths;
  window.MinhasDespesasSeedAccount = seedKnownAccount;
  window.MinhasDespesasRefresh = function () {
    applyMonth();
    renderAll();
  };

  window.MinhasDespesasToast = toast;

  window.MinhasDespesasDataStats = function () {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(userStoragePrefix()));
    return `${keys.length} mês(es) salvos neste aparelho`;
  };

  window.MinhasDespesasSignOut = function () {
    currentUserId = null;
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireApp);
  else wireApp();
})();
