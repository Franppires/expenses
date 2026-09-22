/**
 * Gráficos leves (sem dependências) para o painel Início.
 * Formas seguem o guia interno: listas de barra horizontal p/ categoria e
 * fixas x variáveis, medidor p/ progresso de pagamento, barras pareadas p/
 * evolução mensal. Cores: paleta categórica fixa (--cat-1..8) para
 * identidade, e --income/--expense do próprio app para entradas x saídas.
 */
(function () {
  "use strict";

  const CAT_COLORS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8"];

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function fmtMoney(n) {
    return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Lista de barras horizontais (part-to-whole / comparação).
   * rows: [{ label, amount, icon?, colorVar? }]
   */
  function renderBarList(host, rows, opts) {
    if (!host) return;
    opts = opts || {};
    const items = (rows || []).filter((r) => r.amount > 0);
    if (!items.length) {
      host.innerHTML = `<p class="chart-empty">${esc(opts.emptyMessage || "Sem dados neste mês.")}</p>`;
      return;
    }
    const max = Math.max(...items.map((r) => r.amount));
    host.innerHTML = items
      .map((r, i) => {
        const pct = max > 0 ? Math.max(3, Math.round((r.amount / max) * 100)) : 0;
        const colorVar = r.colorVar || CAT_COLORS[i % CAT_COLORS.length];
        const label = r.icon ? `${r.icon} ${esc(r.label)}` : esc(r.label);
        return `
        <div class="chart-bar-row" title="${esc(r.label)}: R$ ${fmtMoney(r.amount)}">
          <span class="chart-bar-label"><span class="chart-bar-dot" style="background:var(${colorVar})"></span>${label}</span>
          <span class="chart-bar-track"><span class="chart-bar-fill" style="width:${pct}%;background:var(${colorVar})"></span></span>
          <span class="chart-bar-amt">R$ ${fmtMoney(r.amount)}</span>
        </div>`;
      })
      .join("");
  }

  /**
   * Medidor (meter): valor atual sobre um total.
   */
  function renderMeter(host, value, total, opts) {
    if (!host) return;
    opts = opts || {};
    const safeTotal = Math.max(0, total || 0);
    const safeValue = Math.min(Math.max(0, value || 0), safeTotal || value || 0);
    const pct = safeTotal > 0 ? Math.round((safeValue / safeTotal) * 100) : 0;
    if (safeTotal <= 0) {
      host.innerHTML = `<p class="chart-empty">${esc(opts.emptyMessage || "Sem despesas neste mês.")}</p>`;
      return;
    }
    host.innerHTML = `
      <div class="meter-figure">
        <span class="meter-value">${pct}%</span>
        <span class="meter-sub">pago · R$ ${fmtMoney(safeValue)} de R$ ${fmtMoney(safeTotal)}</span>
      </div>
      <div class="meter-track" title="${pct}% pago">
        <span class="meter-fill" style="width:${Math.min(100, pct)}%"></span>
      </div>
      <div class="meter-legend">
        <span>Pago</span>
        <span>Falta R$ ${fmtMoney(Math.max(0, safeTotal - safeValue))}</span>
      </div>`;
  }

  /**
   * Barras pareadas (entradas x saídas) por mês, em SVG.
   * months: [{ label, income, expense }]
   */
  function renderTrendChart(host, months, opts) {
    if (!host) return;
    opts = opts || {};
    const items = months || [];
    if (!items.length || items.every((m) => m.income <= 0 && m.expense <= 0)) {
      host.innerHTML = `<p class="chart-empty">${esc(opts.emptyMessage || "Ainda sem meses salvos para comparar.")}</p>`;
      return;
    }

    const w = 640;
    const h = 200;
    const padL = 8;
    const padR = 8;
    const padT = 12;
    const padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const n = items.length;
    const groupW = plotW / n;
    const barW = Math.min(20, groupW / 3.2);
    const gap = 3;

    const max = Math.max(1, ...items.map((m) => Math.max(m.income, m.expense)));

    let bars = "";
    let labels = "";
    items.forEach((m, i) => {
      const cx = padL + groupW * i + groupW / 2;
      const incH = (m.income / max) * plotH;
      const expH = (m.expense / max) * plotH;
      const incX = cx - barW - gap / 2;
      const expX = cx + gap / 2;
      const baseY = padT + plotH;

      bars += `<rect class="trend-bar" x="${incX.toFixed(1)}" y="${(baseY - incH).toFixed(1)}" width="${barW.toFixed(1)}" height="${incH.toFixed(1)}" rx="4" fill="var(--income)"><title>${esc(m.label)} · Entradas: R$ ${fmtMoney(m.income)}</title></rect>`;
      bars += `<rect class="trend-bar" x="${expX.toFixed(1)}" y="${(baseY - expH).toFixed(1)}" width="${barW.toFixed(1)}" height="${expH.toFixed(1)}" rx="4" fill="var(--expense)"><title>${esc(m.label)} · Saídas: R$ ${fmtMoney(m.expense)}</title></rect>`;
      labels += `<text x="${cx.toFixed(1)}" y="${h - 6}" text-anchor="middle">${esc(m.label)}</text>`;
    });

    const baseline = padT + plotH;

    host.innerHTML = `
      <div class="trend-chart-legend">
        <span><i style="background:var(--income)"></i>Entradas</span>
        <span><i style="background:var(--expense)"></i>Saídas</span>
      </div>
      <div class="trend-chart">
        <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolução mensal de entradas e saídas">
          <line class="trend-baseline" x1="${padL}" y1="${baseline}" x2="${w - padR}" y2="${baseline}" />
          ${bars}
          ${labels}
        </svg>
      </div>`;
  }

  window.MinhasDespesasCharts = { renderBarList, renderMeter, renderTrendChart, CAT_COLORS };
})();
