/**
 * Importação de fatura (CSV / OFX) + categorização.
 * Estrutura pronta para Open Finance: mesma forma de lançamentos (source: "openfinance").
 */
(function () {
  "use strict";

  const CATEGORIES = [
    { id: "alimentacao", label: "Alimentação", icon: "🍽️" },
    { id: "mercado", label: "Mercado", icon: "🛒" },
    { id: "transporte", label: "Transporte", icon: "🚗" },
    { id: "assinaturas", label: "Assinaturas", icon: "📱" },
    { id: "saude", label: "Saúde", icon: "💊" },
    { id: "casa", label: "Casa", icon: "🏠" },
    { id: "lazer", label: "Lazer", icon: "🎬" },
    { id: "vestuario", label: "Vestuário", icon: "👕" },
    { id: "educacao", label: "Educação", icon: "📚" },
    { id: "pets", label: "Pets", icon: "🐾" },
    { id: "servicos", label: "Serviços", icon: "🔧" },
    { id: "outros", label: "Outros", icon: "📦" },
  ];

  /** Palavras-chave → categoria (ordem importa: primeira combinação ganha). */
  const RULES = [
    { cat: "alimentacao", words: ["IFOOD", "I FOOD", "RAPPI", "UBER EATS", "UE*", "RESTAURANTE", "RESTAURANT", "LANCHONETE", "PADARIA", "PIZZARIA", "BURGER", "MCDONALDS", "MC DONALD", "BK ", "BURGER KING", "SUBWAY", "HABIBS", "OUTBACK", "STARBUCKS", "CAFE ", "CAFETERIA", "SORVETE", "ACAI", "DELIVERY"] },
    { cat: "mercado", words: ["SUPERMERCADO", "MERCADO", "ATACADAO", "ATACADÃO", "CARREFOUR", "EXTRA ", "ASSAI", "ASSAÍ", "PÃO DE AÇÚCAR", "PAO DE ACUCAR", "SAMS CLUB", "HORTIFRUTI", "MINIMERCADO", "COPA ", "DIA SUPERMERCADO"] },
    { cat: "transporte", words: ["UBER", "99APP", "99 POP", "99*", "CABIFY", "POSTO ", "SHELL", "IPIRANGA", "PETROBRAS", "COMBUSTIVEL", "COMBUSTÍVEL", "ESTACIONAMENTO", "ESTAC ", "PEDAGIO", "PEDÁGIO", "SEM PARAR", "CONECTCAR", "METRO", "Metrô", "CPTМ", "ONIBUS", "ÔNIBUS"] },
    { cat: "assinaturas", words: ["NETFLIX", "SPOTIFY", "DISNEY", "AMAZON PRIME", "PRIME VIDEO", "YOUTUBE", "GOOGLE ONE", "ICLOUD", "APPLE.COM", "MICROSOFT", "ADOBE", "CLARO", "VIVO", "TIM ", "OI ", "NUBANK ULTRAVIOLET", "ANUIDADE"] },
    { cat: "saude", words: ["FARMACIA", "FARMÁCIA", "DROGASIL", "DROGA RAIA", "RAIA", "PACHECO", "PANVEL", "HOSPITAL", "CLINICA", "CLÍNICA", "LABORATORIO", "LABORATÓRIO", "DENTISTA", "ODONTO", "UNIMED", "PLANO DE SAUDE", "PLANO DE SAÚDE"] },
    { cat: "casa", words: ["MAGAZINE LUIZA", "MAGALU", "AMERICANAS", "CASAS BAHIA", "LERoy", "LEROY MERLIN", "TOK&STOK", "TOK STOK", "IKEA", "UTILIDADES", "ELETRICIDADE", "MATERIAL DE CONSTRUCAO"] },
    { cat: "lazer", words: ["CINEMA", "INGRESSO", "SHOW ", "TEATRO", "STEAM", "PLAYSTATION", "XBOX", "NINTENDO", "PARQUE", "VIAGEM", "HOTEL", "AIRBNB", "BOOKING", "DECOLAR"] },
    { cat: "vestuario", words: ["ZARA", "RENNER", "CEA ", "C&A", "RIACHUELO", "SHEIN", "NIKE", "ADIDAS", "CENTAURO", "NETSHOES", "AREZZO", "HAVAIANAS"] },
    { cat: "educacao", words: ["ESCOLA", "FACULDADE", "UNIVERSIDADE", "CURSO", "UDACITY", "UDEMY", "ALURA", "HOTMART", "LIVRARIA", "SARAIVA"] },
    { cat: "pets", words: ["PETZ", "PETLOVE", "COBASI", "VETERINAR", "PET SHOP", "PETSHOP", "RACAO", "RAÇÃO"] },
    { cat: "servicos", words: ["SALAO", "SALÃO", "BARBEARIA", "ESPETACULO", "MANICURE", "ESTETICA", "ESTÉTICA", "LAVANDERIA", "CORREIOS"] },
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
    summarizeByCategory,
    fetchOpenFinance,
  };
})();
