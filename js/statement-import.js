/**
 * Importação de fatura (CSV / OFX) + categorização.
 * Estrutura pronta para Open Finance: mesma forma de lançamentos (source: "openfinance").
 */
(function () {
  "use strict";

  const CATEGORIES = [
    { id: "alimentacao", label: "Alimentação", icon: "🍽️" },
    { id: "mercado", label: "Mercado", icon: "🛒" },
    { id: "minimercado", label: "Mini-mercado", icon: "🏪" },
    { id: "transporte", label: "Transporte", icon: "🚗" },
    { id: "assinaturas", label: "Assinaturas", icon: "📱" },
    { id: "saude", label: "Saúde", icon: "💊" },
    { id: "casa", label: "Casa", icon: "🏠" },
    { id: "lazer", label: "Lazer", icon: "🎬" },
    { id: "esportes", label: "Esportes", icon: "🏋️" },
    { id: "vestuario", label: "Vestuário", icon: "👕" },
    { id: "educacao", label: "Educação", icon: "📚" },
    { id: "pets", label: "Pets", icon: "🐾" },
    { id: "servicos", label: "Serviços", icon: "🔧" },
    { id: "contasfixas", label: "Outras contas fixas", icon: "🧾" },
    { id: "outros", label: "Outros", icon: "📦" },
  ];

  /** Palavras-chave → categoria (ordem importa: primeira combinação ganha). */
  const RULES = [
    { cat: "alimentacao", words: ["IFOOD", "I FOOD", "RAPPI", "UBER EATS", "UE*", "RESTAURANTE", "RESTAURANT", "LANCHONETE", "PADARIA", "PIZZARIA", "BURGER", "MCDONALDS", "MC DONALD", "BK ", "BURGER KING", "SUBWAY", "HABIBS", "OUTBACK", "STARBUCKS", "CAFE ", "CAFETERIA", "SORVETE", "ACAI", "DELIVERY"] },
    { cat: "minimercado", words: ["MINIMERCADO", "MINI MERCADO", "MINI-MERCADO", "MERCADINHO", "MERCEARIA", "EMPORIO", "EMPÓRIO", "CONVENIENCIA", "CONVENIÊNCIA", "LOJA DE CONVENIENCIA", "HYDE PARK", "62038101SUZANA", "SUZANA"] },
    { cat: "mercado", words: ["SUPERMERCADO", "MERCADO", "ATACADAO", "ATACADÃO", "CARREFOUR", "EXTRA ", "ASSAI", "ASSAÍ", "PÃO DE AÇÚCAR", "PAO DE ACUCAR", "SAMS CLUB", "HORTIFRUTI", "COPA ", "DIA SUPERMERCADO"] },
    { cat: "transporte", words: ["UBER", "99APP", "99 POP", "99*", "CABIFY", "POSTO ", "SHELL", "IPIRANGA", "PETROBRAS", "COMBUSTIVEL", "COMBUSTÍVEL", "ESTACIONAMENTO", "ESTAC ", "PEDAGIO", "PEDÁGIO", "SEM PARAR", "CONECTCAR", "METRO", "Metrô", "CPTМ", "ONIBUS", "ÔNIBUS"] },
    { cat: "assinaturas", words: ["NETFLIX", "SPOTIFY", "DISNEY", "AMAZON PRIME", "PRIME VIDEO", "YOUTUBE", "GOOGLE ONE", "ICLOUD", "APPLE.COM", "MICROSOFT", "ADOBE", "CLARO", "VIVO", "TIM ", "OI ", "NUBANK ULTRAVIOLET", "ANUIDADE"] },
    { cat: "saude", words: ["FARMACIA", "FARMÁCIA", "DROGASIL", "DROGA RAIA", "RAIA", "PACHECO", "PANVEL", "HOSPITAL", "CLINICA", "CLÍNICA", "LABORATORIO", "LABORATÓRIO", "DENTISTA", "ODONTO", "UNIMED", "PLANO DE SAUDE", "PLANO DE SAÚDE"] },
    { cat: "casa", words: ["MAGAZINE LUIZA", "MAGALU", "AMERICANAS", "CASAS BAHIA", "LERoy", "LEROY MERLIN", "TOK&STOK", "TOK STOK", "IKEA", "UTILIDADES", "ELETRICIDADE", "MATERIAL DE CONSTRUCAO"] },
    { cat: "lazer", words: ["CINEMA", "INGRESSO", "SHOW ", "TEATRO", "STEAM", "PLAYSTATION", "XBOX", "NINTENDO", "PARQUE", "VIAGEM", "HOTEL", "AIRBNB", "BOOKING", "DECOLAR", "KINDLE"] },
    { cat: "esportes", words: ["ACADEMIA", "GINASIO", "GINÁSIO", "CROSSFIT", "SMARTFIT", "SMART FIT", "BLUEFIT", "BODYTECH", "NATACAO", "NATAÇÃO", "FUTEBOL", "QUADRA", "ESPORTE", "PERSONAL TRAINER", "YOGA", "PILATES", "JIU JITSU", "JIU-JITSU", "MUAY THAI"] },
    { cat: "vestuario", words: ["ZARA", "RENNER", "CEA ", "C&A", "RIACHUELO", "SHEIN", "NIKE", "ADIDAS", "CENTAURO", "NETSHOES", "AREZZO", "HAVAIANAS"] },
    { cat: "educacao", words: ["ESCOLA", "FACULDADE", "UNIVERSIDADE", "CURSO", "UDACITY", "UDEMY", "ALURA", "HOTMART", "LIVRARIA", "SARAIVA"] },
    { cat: "pets", words: ["PETZ", "PETLOVE", "COBASI", "VETERINAR", "PET SHOP", "PETSHOP", "RACAO", "RAÇÃO"] },
    { cat: "servicos", words: ["SALAO", "SALÃO", "BARBEARIA", "ESPETACULO", "MANICURE", "ESTETICA", "ESTÉTICA", "LAVANDERIA", "CORREIOS"] },
    { cat: "contasfixas", words: ["SEGURO", "CONSORCIO", "CONSÓRCIO", "FINANCIAMENTO", "MENSALIDADE", "PREVIDENCIA", "PREVIDÊNCIA", "ALARME", "MONITORAMENTO", "CONDOMINIO", "CONDOMÍNIO", "RENEGOCIACAO", "RENEGOCIAÇÃO"] },
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizeText(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  }

  function parseMoneyBR(v) {
    if (typeof v === "number") return Math.abs(v);
    let s = String(v ?? "").trim().replace(/R\$\s?/gi, "").replace(/\s/g, "");
    if (!s) return 0;
    if (s.includes(",") && s.includes(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  function parseDateFlex(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const d = m[1].padStart(2, "0");
      const mo = m[2].padStart(2, "0");
      let y = m[3];
      if (y.length === 2) y = "20" + y;
      return `${y}-${mo}-${d}`;
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return "";
  }

  function categorize(label) {
    const t = normalizeText(label);
    for (const rule of RULES) {
      if (rule.words.some((w) => t.includes(normalizeText(w)))) return rule.cat;
    }
    return "outros";
  }

  function categoryMeta(id) {
    return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  }

  function detectDelimiter(line) {
    const commas = (line.match(/,/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    const tabs = (line.match(/\t/g) || []).length;
    if (tabs >= commas && tabs >= semis) return "\t";
    return semis >= commas ? ";" : ",";
  }

  function splitCsvLine(line, delim) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delim && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  }

  function guessColumns(headers) {
    const h = headers.map((x) => normalizeText(x));
    const find = (...needles) => h.findIndex((x) => needles.some((n) => x.includes(n)));
    return {
      date: find("DATA", "DATE", "DT ", "LANCAMENTO", "LANÇAMENTO"),
      label: find("DESCRICAO", "DESCRIÇÃO", "DESCRICAO", "HISTORICO", "HISTÓRICO", "ESTABELECIMENTO", "MEMO", "TITLE", "NOME"),
      amount: find("VALOR", "AMOUNT", "VALUE", "RS", "R$"),
    };
  }

  function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const delim = detectDelimiter(lines[0]);
    const headers = splitCsvLine(lines[0], delim);
    let cols = guessColumns(headers);

    let start = 1;
    if (cols.date < 0 || cols.label < 0 || cols.amount < 0) {
      cols = { date: 0, label: 1, amount: 2 };
      if (headers.length >= 3 && !parseMoneyBR(headers[2]) && !parseDateFlex(headers[0])) {
        /* first row is header-like */
      } else if (parseDateFlex(headers[0]) || parseMoneyBR(headers[headers.length - 1])) {
        start = 0;
        cols = {
          date: 0,
          label: Math.min(1, headers.length - 1),
          amount: headers.length - 1,
        };
      }
    }

    const items = [];
    for (let i = start; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i], delim);
      if (cells.length < 2) continue;
      const date = parseDateFlex(cells[cols.date] || cells[0]);
      const label = String(cells[cols.label] ?? cells[1] ?? "").trim();
      const amount = parseMoneyBR(cells[cols.amount] ?? cells[cells.length - 1]);
      if (!label || amount <= 0) continue;
      if (/^(total|saldo|pagamento|pagto)/i.test(label)) continue;
      items.push({
        id: uid(),
        date: date || "",
        label,
        amount,
        category: categorize(label),
        raw: cells.join(" | "),
      });
    }
    return items;
  }

  function parseOfx(text) {
    const items = [];
    const blocks = text.split(/<STMTTRN>/i).slice(1);
    blocks.forEach((block) => {
      const get = (tag) => {
        const m = block.match(new RegExp("<" + tag + ">([^<\\r\\n]+)", "i"));
        return m ? m[1].trim() : "";
      };
      const amount = parseMoneyBR(get("TRNAMT"));
      const label = get("MEMO") || get("NAME") || "Lançamento";
      const dt = get("DTPOSTED") || get("DTUSER");
      const date = parseDateFlex(dt.slice(0, 8));
      if (amount <= 0) return;
      if (/pagamento|pagto|payment/i.test(label)) return;
      items.push({
        id: uid(),
        date,
        label,
        amount,
        category: categorize(label),
        raw: label,
      });
    });
    return items;
  }

  function isJunkLabel(label) {
    const t = normalizeText(label);
    return /^(TOTAL|SUBTOTAL|SALDO|RESUMO|FATURA|LIMITE|DISPONIVEL|CREDITO|DEBITO|PAGAMENTO|PAGTO|PAYMENT|IOF|JUROS|MULTA|ENCARGOS|ANTERIOR|ATUAL|VENCIMENTO|CLIENTE|PORTADOR|CARTAO|CPF|CNPJ|AGENCIA|CONTA|BANCO|PAGINA|PAGE)\b/.test(t)
      || /\b(TOTAL DA FATURA|VALOR TOTAL|VALOR DA FATURA|LIMITE TOTAL|LIMITE DE CREDITO|LIMITE DISPONIVEL|SALDO ANTERIOR|SALDO ATUAL|PAGAMENTO RECEBIDO|PAGAMENTO EFETUADO|CREDITO EM CONTA|LANCAMENTO FUTURO|COMPRAS NACIONAIS|COMPRAS INTERNACIONAIS|RESUMO DA FATURA|TOTAL DE COMPRAS|TOTAL GERAL)\b/.test(t);
  }

  /** Início/fim da tabela real de compras — ignora simulação de parcelamento, resumo e "próxima fatura". */
  const SECTION_START = /^despesas da fatura$/i;
  const SECTION_END = /^(limite de cr[eé]dito total|pr[oó]xima fatura|encargos financeiros|fale com a gente|como est[aá] distribu[ií]do)/i;

  function parsePdfText(text, yearHint) {
    const year = yearHint || String(new Date().getFullYear());
    const lines = String(text || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const items = [];
    const seen = new Set();

    // Valor no fim: precisa vir com "R$" explícito — evita casar percentuais, código de barras etc.
    const moneyAtEnd = /([+-])?\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*[CD]?\s*$/i;
    const dateStart = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s+(.+)$/;
    // Cobre "12 JAN 2026", "12 de jan. 2026", "12 de janeiro de 2026" etc.
    const dateStartSpaced = /^(\d{1,2})\s*(?:de\s+)?([A-Za-zçÇ]{3})[A-Za-zçÇ]*\.?\s*(?:de\s+)?(\d{2,4})?\s+(.+)$/i;
    const months = { JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06", JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12" };

    // Máximo razoável por compra individual (fatura pessoal)
    const MAX_ITEM = 15000;

    let inSection = false;

    lines.forEach((line) => {
      if (SECTION_START.test(line)) { inSection = true; return; }
      if (SECTION_END.test(line)) { inSection = false; return; }
      if (!inSection) return;

      if (line.length < 8) return;
      if (isJunkLabel(line)) return;

      const moneyM = line.match(moneyAtEnd);
      if (!moneyM) return;
      // "+" no início do valor = crédito (pagamento recebido, estorno) — não é despesa.
      if (moneyM[1] === "+") return;
      const amount = parseMoneyBR(moneyM[2]);
      if (amount <= 0 || amount > MAX_ITEM) return;

      const before = line.slice(0, moneyM.index).trim();
      if (!before || isJunkLabel(before)) return;

      let date = "";
      let label = "";

      let m = before.match(dateStart);
      if (m) {
        const d = m[1].padStart(2, "0");
        const mo = m[2].padStart(2, "0");
        let y = m[3] || year;
        if (y.length === 2) y = "20" + y;
        date = `${y}-${mo}-${d}`;
        label = m[4].trim();
      } else {
        m = before.match(dateStartSpaced);
        const moKey = m ? normalizeText(m[2]).slice(0, 3) : "";
        if (m && months[moKey]) {
          const d = m[1].padStart(2, "0");
          const mo = months[moKey];
          let y = m[3] || year;
          if (y.length === 2) y = "20" + y;
          date = `${y}-${mo}-${d}`;
          label = m[4].trim();
        }
      }

      // Sem data = quase sempre resumo/limite/total — ignora
      if (!date) return;

      label = label
        .replace(/^[-–•*]+\s*/, "")
        .replace(/\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, "")
        .replace(/\s+[-–]\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (label.length < 2 || isJunkLabel(label)) return;
      // Parcelas tipo "01/03" no meio ok; pula só pagamentos
      if (/\b(PAGAMENTO|PAGTO|PAYMENT|ESTORNO|CANCELAMENTO)\b/i.test(label)) return;

      const key = `${date}|${normalizeText(label).slice(0, 40)}|${amount.toFixed(2)}`;
      if (seen.has(key)) return;
      seen.add(key);

      items.push({
        id: uid(),
        date,
        label,
        amount,
        category: categorize(label),
        raw: line,
      });
    });

    return filterInflatedItems(items);
  }

  /** Remove totais que ainda entraram e outliers óbvios. */
  function filterInflatedItems(items) {
    if (!items.length) return items;
    let list = items.slice();

    // Remove item se for >= 40% do total e bem maior que a mediana
    const sum = () => list.reduce((s, i) => s + i.amount, 0);
    const sorted = () => list.map((i) => i.amount).sort((a, b) => a - b);

    for (let pass = 0; pass < 3; pass++) {
      if (list.length < 2) break;
      const total = sum();
      const amts = sorted();
      const median = amts[Math.floor(amts.length / 2)] || 0;
      const biggest = list.reduce((a, b) => (a.amount >= b.amount ? a : b));
      if (
        biggest.amount >= 5000 &&
        biggest.amount >= total * 0.35 &&
        biggest.amount >= median * 8
      ) {
        list = list.filter((i) => i.id !== biggest.id);
        continue;
      }
      break;
    }

    // Se ainda passou de 40 mil, corta itens acima de 8 mil com cara de resumo
    const total2 = sum();
    if (total2 > 40000) {
      list = list.filter((i) => {
        if (i.amount < 8000) return true;
        return !/\b(LIMITE|TOTAL|SALDO|CREDITO|FATURA|DISPONIVEL)\b/i.test(i.label);
      });
    }

    return list;
  }

  /**
   * "Saldo total de compras parceladas" — valor das parcelas que já sabemos
   * que vão cair na PRÓXIMA fatura (a própria fatura documenta isso na seção
   * "Próxima fatura"). Não é o total geral de parcelamentos em aberto.
   */
  function parseNextInvoiceEstimate(text) {
    const lines = String(text || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const moneyAtEnd = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*$/i;
    for (const line of lines) {
      const t = normalizeText(line);
      if (!t.startsWith("SALDO TOTAL DE COMPRAS PARCELADAS")) continue;
      const m = line.match(moneyAtEnd);
      if (m) return parseMoneyBR(m[1]);
    }
    return 0;
  }

  async function extractPdfText(arrayBuffer) {
    if (typeof pdfjsLib === "undefined") {
      throw new Error("Leitor de PDF não carregou. Recarregue a página.");
    }
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      let lastY = null;
      content.items.forEach((item) => {
        const y = item.transform ? item.transform[5] : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 2) {
          parts.push(line.trim());
          line = "";
        }
        line += (item.str || "") + " ";
        if (y != null) lastY = y;
      });
      if (line.trim()) parts.push(line.trim());
      parts.push("\n");
    }
    return parts.join("\n");
  }

  async function parsePdf(arrayBuffer, fileName, yearHint) {
    const text = await extractPdfText(arrayBuffer);
    const items = parsePdfText(text, yearHint);
    return {
      source: "pdf",
      importedAt: Date.now(),
      fileName: fileName || "fatura.pdf",
      items,
      nextInvoiceEstimate: parseNextInvoiceEstimate(text),
      rawTextPreview: text.slice(0, 500),
    };
  }

  function parseFile(text, fileName) {
    const name = (fileName || "").toLowerCase();
    const trimmed = text.trim();
    let source = "csv";
    let items = [];

    if (name.endsWith(".ofx") || name.endsWith(".qfx") || /OFXHEADER|<OFX>/i.test(trimmed)) {
      source = "ofx";
      items = parseOfx(trimmed);
    } else {
      items = parseCsv(trimmed);
    }

    return {
      source,
      importedAt: Date.now(),
      fileName: fileName || "fatura",
      items,
    };
  }

  /**
   * Aceita CSV/OFX (texto) ou PDF (ArrayBuffer).
   */
  async function parseAny(input, fileName, opts) {
    const name = (fileName || "").toLowerCase();
    const yearHint = opts?.yearHint;

    if (name.endsWith(".pdf") || input instanceof ArrayBuffer) {
      return parsePdf(input, fileName, yearHint);
    }
    return parseFile(String(input || ""), fileName);
  }

  function summarizeByCategory(items) {
    const map = {};
    CATEGORIES.forEach((c) => { map[c.id] = 0; });
    let total = 0;
    (items || []).forEach((it) => {
      const cat = it.category || "outros";
      map[cat] = (map[cat] || 0) + (Number(it.amount) || 0);
      total += Number(it.amount) || 0;
    });
    return { byCategory: map, total };
  }

  /**
   * Stub futuro — Open Finance Brasil.
   * Quando integrar, preencher items no mesmo formato e source: "openfinance".
   */
  async function fetchOpenFinance(/* consentId */) {
    throw new Error("Open Finance ainda não configurado. Use importação CSV/OFX por enquanto.");
  }

  window.MinhasDespesasImport = {
    CATEGORIES,
    categoryMeta,
    categorize,
    parseFile,
    parsePdf,
    parsePdfText,
    parseNextInvoiceEstimate,
    parseAny,
    summarizeByCategory,
    fetchOpenFinance,
  };
})();
