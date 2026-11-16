/* =========================================================
   GIS Training · Financial Dashboard
   Vanilla JS + Chart.js 4.
   Data: API live (Apps Script, lihat config.js) dengan
   cadangan snapshot window.GIS_DATA (data.js)
   ========================================================= */
(function () {
  "use strict";

  const CFG = Object.assign({ apiUrl: "", token: "", refreshMinutes: 5 }, window.GIS_CONFIG || {});
  // Saat di-hosting oleh Google Apps Script (HtmlService), data diambil lewat google.script.run
  const GAS = typeof google !== "undefined" && google.script && google.script.run ? google.script.run : null;
  const LIVE = !!(GAS || CFG.apiUrl);
  // Server data: Apps Script (google.script.run) atau API JSON via POST (hosting statis).
  const SERVER = !!(GAS || CFG.apiUrl);
  // Login wajib di Apps Script (dicek server). Di mode lokal hanya bila CFG.users diisi.
  const NEED_LOGIN = SERVER || !!(CFG.users && CFG.users.length);
  const SESSION_KEY = "gis-session";
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { /* storage diblokir */ }
  const saveSession = (s) => {
    session = s;
    try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
  };
  const $ = (sel) => document.querySelector(sel);

  // State data (diisi ulang setiap sinkron)
  let D, months, closed, running, byKey, ytd;
  let plPeriod = "ytd", sumKey = null, chMode = "count";
  // Data gaji (khusus BOD) — dimuat saat halaman Gaji dibuka, tidak disimpan di storage
  let payroll = null, payrollError = "";
  const canPayroll = () => !!(session && session.user && session.user.payroll);
  // Input peserta (khusus STAFF) & database peserta (semua akun)
  const canInput = () => !!(session && session.user && session.user.input);
  let inputOpts = null, inputErr = "", people = null, peopleErr = "";
  const db = { q: "", program: "", month: "", source: "", sort: "month-desc", limit: 60, flash: "" };

  /* ---------------- Formatters ---------------- */
  const nf = new Intl.NumberFormat("id-ID");
  const nf1 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const rp = (n) => (n == null ? "—" : (n < 0 ? "-Rp" : "Rp") + nf.format(Math.abs(Math.round(n))));
  const rpShort = (n) => {
    if (n == null) return "—";
    const a = Math.abs(n), s = n < 0 ? "-" : "";
    if (a >= 1e9) return `${s}Rp${nf1.format(a / 1e9)} M`;
    if (a >= 1e6) return `${s}Rp${nf1.format(a / 1e6)} jt`;
    if (a >= 1e3) return `${s}Rp${nf.format(Math.round(a / 1e3))} rb`;
    return `${s}Rp${nf.format(a)}`;
  };
  const juta = (n) => (n == null ? "—" : nf1.format(n / 1e6));
  const pct = (n, d = 1) =>
    n == null || !isFinite(n) ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n * 100) + "%";
  const esc = (str) => String(str).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);

  /* ---------------- Derived data ---------------- */
  const PROGRAM_GROUPS = ["POP", "AK3U", "POM", "Perpanjangan", "Lainnya"];
  const groupOf = (p) =>
    p.startsWith("Perpanjangan") ? "Perpanjangan" : ["POP", "AK3U", "POM"].includes(p) ? p : "Lainnya";
  const fold = (obj) => {
    if (!obj) return null;
    const out = Object.fromEntries(PROGRAM_GROUPS.map((g) => [g, 0]));
    Object.entries(obj).forEach(([k, v]) => (out[groupOf(k)] += v));
    return out;
  };
  const CHANNELS = ["Online", "Referral", "B2B", "Ads"];

  const deriveMonth = (m) => {
    const cogsTotal = m.revenue - m.grossProfit;
    const parts = m.cogs.lsp + m.cogs.trainer + m.cogs.merchandise + m.cogs.shipping;
    const net = m.opex == null ? null : m.grossProfit - m.opex;
    const pTotal = m.participants ? sum(Object.values(m.participants)) : null;
    return {
      ...m,
      cogsTotal,
      adjustment: m.revenue && parts ? cogsTotal - parts : 0,
      net,
      grossMargin: m.revenue ? m.grossProfit / m.revenue : null,
      netMargin: net == null || !m.revenue ? null : net / m.revenue,
      pTotal,
      groups: fold(m.participants),
      revGroups: fold(m.programRevenue),
    };
  };
  const prevOf = (m) => months[months.indexOf(m) - 1] || null;

  const aggregate = (list, label) => {
    const r = {
      key: "ytd", name: label, short: "YTD", status: "closed",
      revenue: sum(list, (m) => m.revenue),
      grossProfit: sum(list, (m) => m.grossProfit),
      opex: sum(list, (m) => m.opex),
      cogs: {
        lsp: sum(list, (m) => m.cogs.lsp),
        trainer: sum(list, (m) => m.cogs.trainer),
        merchandise: sum(list, (m) => m.cogs.merchandise),
        shipping: sum(list, (m) => m.cogs.shipping),
      },
      adjustment: sum(list, (m) => m.adjustment),
    };
    r.cogsTotal = r.revenue - r.grossProfit;
    r.net = r.grossProfit - r.opex;
    r.grossMargin = r.grossProfit / r.revenue;
    r.netMargin = r.net / r.revenue;
    return r;
  };
  const lastClosed = () => closed[closed.length - 1];
  const rangeLabel = (list) => (list.length ? (list.length > 1 ? `${list[0].short} – ` : "") + `${list[list.length - 1].short} ${D.year}` : "");

  function setData(data) {
    D = data;
    months = (data.months || []).map(deriveMonth);
    closed = months.filter((m) => m.status === "closed");
    running = months.find((m) => m.status === "running") || null;
    byKey = Object.fromEntries(months.map((m) => [m.key, m]));
    ytd = aggregate(closed, rangeLabel(closed));
    if (plPeriod !== "ytd" && !byKey[plPeriod]) plPeriod = "ytd";
    if (!sumKey || !byKey[sumKey]) sumKey = lastClosed() ? lastClosed().key : months[0] && months[0].key;
  }

  /* ---------------- Theme tokens ---------------- */
  const tok = () => {
    const cs = getComputedStyle(document.documentElement);
    const g = (v) => cs.getPropertyValue(v).trim();
    return {
      s: [g("--s1"), g("--s2"), g("--s3"), g("--s4")],
      other: g("--s-other"),
      grid: g("--grid"), axis: g("--axis"),
      text: g("--text"), text2: g("--text-2"), muted: g("--muted"),
      surface: g("--surface"), border: g("--border"),
      brand: g("--brand-600"),
    };
  };
  const groupColor = (t, g) => (g === "Lainnya" ? t.other : t.s[PROGRAM_GROUPS.indexOf(g)]);
  const alpha = (hex, a) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /* ---------------- Chart helpers ---------------- */
  const charts = {};
  const make = (id, config) => {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    charts[id] = new Chart(el, config);
  };

  function applyChartDefaults() {
    const t = tok();
    Chart.defaults.font.family = "Poppins, system-ui, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = t.axis;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = reduceMotion() ? 0 : 750;
    Chart.defaults.animation.easing = "easeOutQuart";
    Object.assign(Chart.defaults.plugins.legend, { display: false });
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: t.surface,
      titleColor: t.text,
      bodyColor: t.text2,
      borderColor: t.border,
      borderWidth: 1,
      padding: 12,
      cornerRadius: 10,
      boxPadding: 4,
      usePointStyle: true,
      titleFont: { weight: "600", size: 12.5, family: "Poppins" },
      bodyFont: { size: 12, family: "Poppins" },
    });
  }

  const moneyAxis = (t, extra = {}) => ({
    beginAtZero: true,
    border: { display: false },
    grid: { color: t.grid, drawTicks: false },
    ticks: { padding: 8, callback: (v) => rpShort(v).replace("Rp", ""), maxTicksLimit: 6 },
    ...extra,
  });
  const catAxis = (t, extra = {}) => ({
    border: { color: t.grid },
    grid: { display: false },
    ticks: { padding: 6 },
    ...extra,
  });
  const legendHTML = (items) =>
    items.map(([label, color, line]) => `<span><i class="${line ? "line" : ""}" style="background:${color}"></i>${label}</span>`).join("");

  /* ---------------- KPI tile ---------------- */
  const ICONS = {
    money: '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3V6Zm2 2v8h14V8H5Zm7 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 19h16v2H4v-2Zm1-3 4-5 3 3 5-7 2 1.4-6.7 9.3-3-3-2.7 3.4L5 16Z"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><path d="M4 5h14v3h2v11H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v1h12V7H4Zm0 3v7h14v-2h-4a2 2 0 0 1 0-4h4v-1H4Zm10 3h4v-1h-4v1Z"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm-7 9a7 7 0 0 1 14 0H2Zm15.5-9a3.5 3.5 0 1 0 0-7v7Zm1.4 2.1A6.5 6.5 0 0 1 22 20h-4a9 9 0 0 0-1.6-5.1l2.5-1.8Z"/></svg>',
    receipt: '<svg viewBox="0 0 24 24"><path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2V2Zm3 5v2h8V7H8Zm0 4v2h8v-2H8Z"/></svg>',
    bank: '<svg viewBox="0 0 24 24"><path d="m12 2 10 5v2H2V7l10-5ZM4 11h3v7H4v-7Zm6.5 0h3v7h-3v-7Zm6.5 0h3v7h-3v-7ZM2 20h20v2H2v-2Z"/></svg>',
  };
  const delta = (cur, prev, label = "vs bln lalu") => {
    if (cur == null || prev == null || prev === 0) return "";
    const d = (cur - prev) / Math.abs(prev);
    const up = d >= 0;
    return `<span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${pct(Math.abs(d))}</span><span>${label}</span>`;
  };
  const kpi = ({ label, value, foot = "", icon = "money", hero = false, count = null, fmt = "short" }) => `
    <article class="card kpi ${hero ? "hero" : ""}">
      <div class="kpi-label"><span class="kpi-icon">${ICONS[icon]}</span>${label}</div>
      <div class="kpi-value"${typeof count === "number" ? ` data-count="${count}" data-fmt="${fmt}"` : ""}>${value}</div>
      <div class="kpi-foot">${foot}</div>
    </article>`;

  /* ---------------- Animasi halus ---------------- */
  const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const COUNT_FMT = { short: rpShort, int: (v) => nf.format(Math.round(v)) };
  function animateCounts(root) {
    if (reduceMotion()) return;
    root.querySelectorAll("[data-count]").forEach((el) => {
      const to = +el.dataset.count, f = COUNT_FMT[el.dataset.fmt] || rpShort, final = el.textContent;
      const t0 = performance.now(), dur = 900;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? f(to * e) : final;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  // urutan muncul kartu (stagger) + angka berhitung
  function enter(pageSel) {
    const page = $(pageSel);
    if (!page) return;
    page.querySelectorAll(".card").forEach((c, i) => c.style.setProperty("--i", Math.min(i, 12)));
    animateCounts(page);
  }

  /* =========================================================
     PAGE: DASHBOARD
     ========================================================= */
  function renderDashboard() {
    const t = tok();
    const last = closed[closed.length - 1];
    const prev = prevOf(last);
    // Periode dari dropdown atas: "ytd" = semua bulan, atau satu bulan tertentu
    const sel = plPeriod === "ytd" ? null : byKey[plPeriod] || null;
    const selPrev = sel ? prevOf(sel) : null;
    const scope = sel ? [sel] : closed;
    const fullRange = (list) => (list.length ? `${list[0].name} – ${list[list.length - 1].name} ${D.year}` : "");
    const pMonths = scope.filter((m) => m.pTotal);
    const pRange = pMonths.length ? `${pMonths[0].short} – ${pMonths[pMonths.length - 1].short}` : "";
    const selLabel = sel ? `${sel.name} ${D.year}${sel.status === "running" ? " · berjalan" : ""}` : "";
    $("#trendSub").textContent = `Per bulan, ${fullRange(closed)} (bulan tutup buku)` + (sel && closed.includes(sel) ? ` · ${sel.name} disorot` : "");
    $("#progSub").textContent = sel ? selLabel : `Akumulasi ${pMonths.length ? pMonths[0].name + " – " + pMonths[pMonths.length - 1].name : "—"}`;

    if (sel) {
      $("#dashKpis").innerHTML = [
        kpi({ label: `Omzet ${sel.name} ${D.year}`, value: rpShort(sel.revenue), count: sel.revenue, icon: "money", hero: true,
          foot: selPrev ? delta(sel.revenue, selPrev.revenue, `vs ${selPrev.name}`) : sel.status === "running" ? "Bulan berjalan" : "" }),
        kpi({ label: "Laba Kotor", value: rpShort(sel.grossProfit), count: sel.grossProfit, icon: "chart",
          foot: `Margin kotor <b class="num">${pct(sel.grossMargin)}</b>` }),
        kpi({ label: "Laba Bersih", value: sel.net == null ? "—" : rpShort(sel.net), count: sel.net, icon: "wallet",
          foot: sel.net == null ? "OPEX belum tercatat" : `Margin bersih <b class="num">${pct(sel.netMargin)}</b>` }),
        kpi({ label: `Peserta ${sel.name}`, value: sel.pTotal == null ? "—" : nf.format(sel.pTotal), count: sel.pTotal, fmt: "int", icon: "users",
          foot: sel.pTotal != null && selPrev && selPrev.pTotal ? delta(sel.pTotal, selPrev.pTotal, `vs ${selPrev.name}`) : sel.pTotal == null ? "Tidak ada rincian peserta" : "" }),
      ].join("");
    } else {
      const peserta = sum(closed, (m) => m.pTotal);
      $("#dashKpis").innerHTML = [
        kpi({ label: `Omzet ${ytd.name}`, value: rpShort(ytd.revenue), count: ytd.revenue, icon: "money", hero: true,
          foot: prev ? delta(last.revenue, prev.revenue, `${last.short} vs ${prev.short}`) : "" }),
        kpi({ label: "Laba Kotor", value: rpShort(ytd.grossProfit), count: ytd.grossProfit, icon: "chart",
          foot: `Margin kotor <b class="num">${pct(ytd.grossMargin)}</b>` }),
        kpi({ label: "Laba Bersih", value: rpShort(ytd.net), count: ytd.net, icon: "wallet",
          foot: `Margin bersih <b class="num">${pct(ytd.netMargin)}</b>` }),
        kpi({ label: `Total Peserta${pRange ? ` (${pRange})` : ""}`, value: nf.format(peserta), count: peserta, fmt: "int", icon: "users",
          foot: running ? `+${running.pTotal} peserta ${running.name} (berjalan)` : "" }),
      ].join("");
    }

    // Trend: omzet & laba bersih
    $("#lgTrend").innerHTML = legendHTML([["Omzet", t.s[0], true], ["Laba Bersih", t.s[1], true]]);
    make("chTrend", {
      type: "line",
      data: {
        labels: closed.map((m) => m.short),
        datasets: [
          { label: "Omzet", data: closed.map((m) => m.revenue), borderColor: t.s[0], backgroundColor: alpha(t.s[0], 0.08),
            fill: true, tension: 0.35, borderWidth: 2, pointRadius: closed.map((m) => (m === sel ? 6 : 0)), pointHoverRadius: 5, pointBackgroundColor: t.s[0], pointBorderColor: t.surface, pointBorderWidth: 2 },
          { label: "Laba Bersih", data: closed.map((m) => m.net), borderColor: t.s[1], backgroundColor: "transparent",
            tension: 0.35, borderWidth: 2, pointRadius: closed.map((m) => (m === sel ? 6 : 0)), pointHoverRadius: 5, pointBackgroundColor: t.s[1], pointBorderColor: t.surface, pointBorderWidth: 2 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: catAxis(t), y: moneyAxis(t) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (i) => closed[i[0].dataIndex].name + " " + D.year,
              label: (c) => ` ${c.dataset.label}: ${rp(c.raw)}`,
              afterBody: (i) => {
                const m = closed[i[0].dataIndex];
                return m.netMargin != null ? `Margin bersih ${pct(m.netMargin)}` : "";
              },
            },
          },
        },
      },
      plugins: [crosshair],
    });

    // KPI Q4
    const q = D.kpiQ4;
    $("#q4Card").hidden = !q;
    if (q) {
    const achieved = sum(q.months, (m) => m.value);
    const pctOpt = achieved / q.targetOptimistic;
    const pctReal = achieved / q.targetRealistic;
    $("#q4Body").innerHTML = `
      <div class="q4-big"><strong class="num">${achieved}</strong><span>/ ${q.targetOptimistic} peserta</span></div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${q.targetOptimistic}" aria-valuenow="${achieved}" aria-label="Pencapaian KPI Q4">
        <div class="meter-track">
          <div class="meter-fill" style="width:${Math.min(pctOpt, 1) * 100}%"></div>
          <div class="meter-tick" style="left:${(q.targetRealistic / q.targetOptimistic) * 100}%" title="Target realistis"></div>
        </div>
        <div class="meter-labels"><span>0</span><span>Realistis ${q.targetRealistic}</span><span>${q.targetOptimistic}</span></div>
      </div>
      <div class="q4-targets">
        <div class="q4-target"><div class="t">vs target optimis</div><div class="v num">${pct(pctOpt, 0)}</div></div>
        <div class="q4-target"><div class="t">vs target realistis</div><div class="v num">${pct(pctReal, 0)}</div></div>
      </div>
      <div class="q4-rows">
        ${q.months.map((m) => `
          <div class="q4-row"><span>${m.name} ${m.running ? '<span class="pill">berjalan</span>' : ""}</span>
          <span><b class="num">${m.value}</b> <span class="muted">/ ${Math.round(q.targetOptimistic / q.months.length)}</span></span></div>`).join("")}
      </div>`;
    }

    // Peserta per program (YTD, closed months)
    const ytdGroups = Object.fromEntries(PROGRAM_GROUPS.map((g) => [g, sum(scope, (m) => (m.groups ? m.groups[g] : 0))]));
    toggleEmpty("chProgramYtd", !sum(Object.values(ytdGroups)), "Tidak ada rincian peserta untuk bulan ini.");
    const pgSorted = PROGRAM_GROUPS.filter((g) => g !== "Lainnya").sort((a, b) => ytdGroups[b] - ytdGroups[a]).concat("Lainnya");
    make("chProgramYtd", {
      type: "bar",
      data: {
        labels: pgSorted,
        datasets: [{
          data: pgSorted.map((g) => ytdGroups[g]),
          backgroundColor: pgSorted.map((g) => (g === "Lainnya" ? t.other : t.s[0])),
          borderRadius: 4, borderSkipped: "start", maxBarThickness: 26,
        }],
      },
      options: {
        indexAxis: "y",
        scales: {
          x: { ...moneyAxis(t), ticks: { padding: 6, maxTicksLimit: 6 } },
          y: { ...catAxis(t), ticks: { color: t.text2 } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.raw} peserta · ${pct(c.raw / sum(Object.values(ytdGroups)))}`,
              afterLabel: (c) => (c.label === "Lainnya" ? "POU, TOT, Pra POP, P3K" : c.label === "Perpanjangan" ? "Perpanjangan POP / POM / AK3U" : ""),
            },
          },
        },
      },
      plugins: [barValueLabels((v) => nf.format(v))],
    });

    // Kanal akuisisi: total (kartu) + per bulan (grafik, jumlah / persen)
    const chMonths = sel ? (sel.channels ? [sel] : []) : months.filter((m) => m.channels && m.status === "closed");
    const chTot = Object.fromEntries(CHANNELS.map((c) => [c, sum(chMonths, (m) => m.channels[c])]));
    const chAll = sum(Object.values(chTot));
    const lastCh = chMonths[chMonths.length - 1];
    const prevCh = sel ? (selPrev && selPrev.channels ? selPrev : undefined) : chMonths[chMonths.length - 2];
    $("#chanTotSub").textContent = !chMonths.length ? (sel ? `Kategori peserta belum dicatat untuk ${sel.name}` : "Belum ada data kategori peserta")
      : sel ? `${selLabel} · ${nf.format(chAll)} peserta` : `Akumulasi ${fullRange(chMonths)} · ${nf.format(chAll)} peserta`;
    $("#chanLastPill").hidden = !lastCh || !!sel;
    if (lastCh) $("#chanLastPill").textContent = `${lastCh.name}: ${sum(Object.values(lastCh.channels))} peserta`;
    const chMax = Math.max(1, ...Object.values(chTot));
    $("#chanTotals").innerHTML = chMonths.length ? CHANNELS.map((c, i) => {
      const now = lastCh.channels[c], before = prevCh ? prevCh.channels[c] : null;
      const d = before == null ? "" : now === before ? `<span class="muted">tetap</span>`
        : `<span class="delta ${now > before ? "up" : "down"}">${now > before ? "▲" : "▼"} ${Math.abs(now - before)}</span>`;
      return `
        <div class="bar-row">
          <div class="bar-top"><span><i style="background:${t.s[i]}"></i>${c}</span><span><b>${nf.format(chTot[c])}</b><em>${pct(chTot[c] / chAll, 0)}</em></span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(chTot[c] / chMax) * 100}%;background:${t.s[i]}"></div></div>
          <div class="bar-foot">${lastCh.short}: <b>${now}</b> ${d}${prevCh ? ` <span class="muted">vs ${prevCh.short}</span>` : ""}</div>
        </div>`;
    }).join("") : '<p class="empty">Kategori peserta belum dicatat di sheet.</p>';

    const chAllMonths = months.filter((m) => m.channels);
    const share = chMode === "share";
    $("#chanSub").textContent = chAllMonths.length ? `${share ? "Komposisi" : "Jumlah peserta"} per bulan, ${fullRange(chAllMonths)}` : "Belum ada data kategori peserta";
    $("#lgChannel").innerHTML = legendHTML(CHANNELS.map((c, i) => [c, t.s[i]]));
    document.querySelectorAll("[data-chmode]").forEach((b) => b.classList.toggle("active", b.dataset.chmode === chMode));
    make("chChannel", {
      type: "bar",
      data: {
        labels: chAllMonths.map((m) => m.short + (m.status === "running" ? "*" : "")),
        datasets: CHANNELS.map((c, i) => ({
          label: c,
          data: chAllMonths.map((m) => (share ? m.channels[c] / sum(Object.values(m.channels)) : m.channels[c])),
          raw: chAllMonths.map((m) => m.channels[c]),
          backgroundColor: chAllMonths.map((m) => (sel && m !== sel ? alpha(t.s[i], 0.3) : m.status === "running" && !sel ? alpha(t.s[i], 0.5) : t.s[i])),
          borderColor: t.surface, borderWidth: { top: 2, bottom: 0, left: 0, right: 0 },
          borderRadius: 2, borderSkipped: false, maxBarThickness: 40,
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ...catAxis(t), stacked: true },
          y: share
            ? { stacked: true, max: 1, border: { display: false }, grid: { color: t.grid }, ticks: { callback: (v) => pct(v, 0), maxTicksLimit: 5 } }
            : { stacked: true, beginAtZero: true, border: { display: false }, grid: { color: t.grid }, ticks: { maxTicksLimit: 6, precision: 0 } },
        },
        plugins: {
          tooltip: {
            filter: (c) => c.dataset.raw[c.dataIndex] > 0,
            callbacks: {
              title: (i) => {
                const m = chAllMonths[i[0].dataIndex];
                return `${m.name}${m.status === "running" ? " (berjalan)" : ""} · ${sum(Object.values(m.channels))} peserta`;
              },
              label: (c) => {
                const m = chAllMonths[c.dataIndex], n = c.dataset.raw[c.dataIndex];
                return ` ${c.dataset.label}: ${n} peserta (${pct(n / sum(Object.values(m.channels)), 0)})`;
              },
            },
          },
        },
      },
    });

    // Sorotan (dihitung dari data, aman bila bulan bertambah)
    const ins = [];
    if (closed.length) {
      const best = closed.reduce((a, b) => (b.revenue > a.revenue ? b : a));
      const bestPrev = prevOf(best);
      ins.push(["▲", `<b>${best.name}</b> jadi bulan dengan omzet tertinggi: <b>${rpShort(best.revenue)}</b>` +
        (bestPrev && bestPrev.revenue ? `, ${best.revenue >= bestPrev.revenue ? "naik" : "turun"} ${pct(Math.abs(best.revenue - bestPrev.revenue) / bestPrev.revenue)} dari ${bestPrev.name}.` : ".")]);
      const base = closed.find((m) => m.opex > 0);
      if (base && base !== last && base.revenue)
        ins.push(["×", `Omzet ${last.revenue >= base.revenue ? "tumbuh" : "berubah"} <b>${nf1.format(last.revenue / base.revenue)}×</b> dari ${base.name} (${rpShort(base.revenue)}) ke ${last.name} (${rpShort(last.revenue)}).`]);
      const withOpex = closed.filter((m) => m.opex > 0);
      if (withOpex.length)
        ins.push(["%", `Rata-rata margin bersih ${withOpex[0].short} – ${last.short}: <b>${pct(sum(withOpex, (m) => m.netMargin) / withOpex.length)}</b>.` +
          (last.opex ? ` OPEX ${last.name} ${rpShort(last.opex)} (${pct(last.opex / last.revenue)} omzet).` : "")]);
      const rg = Object.fromEntries(PROGRAM_GROUPS.map((g) => [g, sum(closed, (m) => (m.revGroups ? m.revGroups[g] : 0))]));
      const revAll = sum(Object.values(rg));
      const topG = PROGRAM_GROUPS.slice().sort((a, b) => rg[b] - rg[a]);
      if (revAll) ins.push(["★", `${topG[0]} menyumbang <b>${pct(rg[topG[0]] / revAll)}</b> omzet program ${rangeLabel(closed.filter((m) => m.revGroups))}, disusul ${topG[1]} ${pct(rg[topG[1]] / revAll)}.`]);
      if (last.channels && prev && prev.channels) {
        const ch = CHANNELS.slice().sort((a, b) => (last.channels[b] - prev.channels[b]) - (last.channels[a] - prev.channels[a]))[0];
        const d = last.channels[ch] - prev.channels[ch];
        if (d > 0) ins.push(["↗", `Peserta ${ch.toLowerCase()} naik dari ${prev.channels[ch]} (${prev.short}) ke <b>${last.channels[ch]}</b> peserta di ${last.name}.`]);
      }
      if (last.receivable)
        ins.push(["!", `Piutang akhir ${last.name} <b>${rpShort(last.receivable)}</b> (${pct(last.receivable / last.revenue)} dari omzet) — prioritas penagihan.`]);
    }
    $("#insights").innerHTML = ins.map(([i, h]) => `<li><span class="ico">${i}</span><span>${h}</span></li>`).join("") || '<li class="empty">Belum ada data.</li>';

    const notes = D.dataNotes || [];
    $("#dataNotes").innerHTML = notes.length ? notes.map((n) => `<li>${esc(n)}</li>`).join("") : '<li>Tidak ada selisih yang terdeteksi.</li>';
    enter("#page-dashboard");
  }

  /* =========================================================
     PAGE: LABA RUGI
     ========================================================= */

  function renderPL() {
    const t = tok();
    const m = plPeriod === "ytd" ? ytd : byKey[plPeriod];
    const prev = plPeriod === "ytd" ? null : prevOf(m);
    const isRunning = m.status === "running";
    $("#plPeriodLabel").textContent = plPeriod === "ytd" ? `Periode ${ytd.name}` : `Periode ${m.name} ${D.year}`;
    $("#plBadge").hidden = !isRunning;

    $("#plKpis").innerHTML = [
      kpi({ label: "Pendapatan", value: rpShort(m.revenue), count: m.revenue, icon: "money", hero: true, foot: prev ? delta(m.revenue, prev.revenue) : "Total periode" }),
      kpi({ label: "Laba Kotor", value: rpShort(m.grossProfit), count: m.grossProfit, icon: "chart", foot: `Margin <b class="num">${pct(m.grossMargin)}</b>` }),
      kpi({ label: "Beban Operasional", value: m.opex == null ? "Belum tercatat" : rpShort(m.opex), icon: "receipt",
        foot: m.opex ? `${pct(m.opex / m.revenue)} dari pendapatan` : m.opex === 0 ? "Tidak ada OPEX di rekap" : "Bulan berjalan" }),
      kpi({ label: "Laba Bersih", value: m.net == null ? "—" : rpShort(m.net), icon: "wallet",
        foot: m.net == null ? "Menunggu OPEX" : `Margin <b class="num">${pct(m.netMargin)}</b>${prev && prev.net != null ? " · " + delta(m.net, prev.net) : ""}` }),
    ].join("");

    const share = (v) => (m.revenue ? pct(v / m.revenue) : "");
    const row = (cls, label, v, opts = {}) =>
      `<tr class="${cls}"><td>${label}${opts.hint ? `<span class="hint">${opts.hint}</span>` : ""}</td><td class="${v < 0 ? "neg" : ""}">${opts.text ?? rp(v)}</td><td>${opts.noShare ? "" : share(v)}</td></tr>`;
    const rows = [
      row("section", "Pendapatan", null, { text: "", noShare: true }),
      row("item", "Pendapatan pelatihan", m.revenue),
      row("subtotal", "Total Pendapatan", m.revenue),
      row("section", "Harga Pokok Pelatihan", null, { text: "", noShare: true }),
      row("item", "Biaya LSP / sertifikasi", m.cogs.lsp),
      row("item", "Biaya trainer", m.cogs.trainer),
      row("item", "Merchandise", m.cogs.merchandise),
      row("item", "Ongkos kirim", m.cogs.shipping),
    ];
    if (Math.abs(m.adjustment) > 0) rows.push(row("item", "Penyesuaian", m.adjustment, { hint: "Selisih rincian vs rekap sheet" }));
    rows.push(
      row("subtotal", "Total HPP", m.cogsTotal),
      row("subtotal", "Laba Kotor", m.grossProfit),
      row("section", "Beban Operasional", null, { text: "", noShare: true }),
      row("item", "OPEX (gaji, iklan, operasional)", m.opex, { text: m.opex == null ? "Belum tercatat" : undefined }),
      `<tr class="total"><td>Laba Bersih</td><td class="${m.net < 0 ? "neg" : ""}">${m.net == null ? "—" : rp(m.net)}</td><td>${m.net == null ? "" : share(m.net)}</td></tr>`
    );
    if (m.note) rows.push(`<tr><td colspan="3" class="hint" style="border:0;padding-top:12px;color:var(--muted);font-size:12px">${m.note}</td></tr>`);
    $("#plStatement").innerHTML = rows.join("");

    // Struktur biaya (porsi terhadap omzet)
    const costItems = [
      ["Biaya LSP", m.cogs.lsp], ["Trainer", m.cogs.trainer], ["Merchandise", m.cogs.merchandise],
      ["Ongkos kirim", m.cogs.shipping], ["OPEX", m.opex || 0],
    ];
    $("#costLabel").textContent = `Porsi terhadap pendapatan · ${plPeriod === "ytd" ? ytd.name : m.name}`;
    make("chCostMix", {
      type: "bar",
      data: {
        labels: costItems.map((c) => c[0]),
        datasets: [{
          data: costItems.map((c) => (m.revenue ? c[1] / m.revenue : 0)),
          raw: costItems.map((c) => c[1]),
          backgroundColor: costItems.map((c) => (c[0] === "OPEX" ? t.s[1] : t.s[0])),
          borderRadius: 4, borderSkipped: "start", maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, border: { display: false }, grid: { color: t.grid }, ticks: { callback: (v) => pct(v, 0), maxTicksLimit: 5 } },
          y: { ...catAxis(t), ticks: { color: t.text2 } },
        },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${rp(c.dataset.raw[c.dataIndex])} · ${pct(c.raw)}` } } },
      },
      plugins: [barValueLabels((v) => pct(v))],
    });

    // Margin laba bersih
    const mm = closed.filter((x) => x.key !== "jan");
    make("chMargin", {
      type: "line",
      data: {
        labels: mm.map((x) => x.short),
        datasets: [{
          label: "Margin bersih", data: mm.map((x) => x.netMargin),
          borderColor: t.s[0], backgroundColor: alpha(t.s[0], 0.1), fill: true, tension: 0.35, borderWidth: 2,
          pointRadius: mm.map((x) => (x.key === plPeriod ? 5 : 0)), pointHoverRadius: 5,
          pointBackgroundColor: t.s[0], pointBorderColor: t.surface, pointBorderWidth: 2,
        }],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: catAxis(t),
          y: { beginAtZero: true, border: { display: false }, grid: { color: t.grid }, ticks: { callback: (v) => pct(v, 0), maxTicksLimit: 5 } },
        },
        plugins: { tooltip: { callbacks: { title: (i) => mm[i[0].dataIndex].name, label: (c) => ` Margin bersih ${pct(c.raw)}` } } },
      },
      plugins: [crosshair],
    });

    // Pendapatan vs laba (grouped)
    const series = [["Pendapatan", "revenue", t.s[0]], ["Laba Kotor", "grossProfit", t.s[2]], ["Laba Bersih", "net", t.s[1]]];
    $("#lgPl").innerHTML = legendHTML(series.map(([l, , c]) => [l, c]));
    make("chPl", {
      type: "bar",
      data: {
        labels: closed.map((x) => x.short),
        datasets: series.map(([label, k, c]) => ({
          label, data: closed.map((x) => x[k]), backgroundColor: c,
          borderRadius: 4, borderSkipped: "start", maxBarThickness: 18, categoryPercentage: 0.7, barPercentage: 0.9,
          borderColor: t.surface, borderWidth: { left: 1, right: 1, top: 0, bottom: 0 },
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: catAxis(t), y: moneyAxis(t) },
        plugins: { tooltip: { callbacks: { title: (i) => closed[i[0].dataIndex].name + " " + D.year, label: (c) => ` ${c.dataset.label}: ${rp(c.raw)}` } } },
      },
    });

    // Matriks laba rugi
    const cols = months;
    const line = (label, f, cls = "", fmt = juta) =>
      `<tr class="${cls}"><td>${label}</td>${cols.map((x) => {
        const v = f(x);
        return `<td class="${v < 0 ? "neg" : ""} ${x.status === "running" ? "muted" : ""}">${v == null ? "—" : fmt(v)}</td>`;
      }).join("")}<td class="${f(ytd) < 0 ? "neg" : ""}"><b>${f(ytd) == null ? "—" : fmt(f(ytd))}</b></td></tr>`;
    $("#plMatrix").innerHTML = `
      <thead><tr><th>Juta Rupiah</th>${cols.map((x) => `<th>${x.short}${x.status === "running" ? "*" : ""}</th>`).join("")}<th>Jan – ${closed[closed.length - 1].short}</th></tr></thead>
      <tbody>
        ${line("Pendapatan", (x) => x.revenue, "strong highlight")}
        ${line("Biaya LSP", (x) => x.cogs.lsp)}
        ${line("Biaya trainer", (x) => x.cogs.trainer)}
        ${line("Merchandise", (x) => x.cogs.merchandise)}
        ${line("Ongkos kirim", (x) => x.cogs.shipping)}
        ${line("Penyesuaian", (x) => x.adjustment)}
        ${line("Total HPP", (x) => x.cogsTotal, "strong")}
        ${line("Laba Kotor", (x) => x.grossProfit, "strong highlight")}
        ${line("OPEX", (x) => x.opex)}
        ${line("Laba Bersih", (x) => x.net, "strong highlight")}
        ${line("Margin bersih", (x) => x.netMargin, "", (v) => pct(v))}
      </tbody>`;
    enter("#page-laba-rugi");
  }

  /* =========================================================
     PAGE: NERACA
     ========================================================= */
  function renderBS() {
    const t = tok();
    const b = D.balance || { asOf: "—", cashAccounts: [], receivable: 0, liabilities: [] };
    $("#retSub").textContent = `Laba ditahan berjalan, ${ytd.name}`;
    const cash = sum(b.cashAccounts, (a) => a.amount);
    const totalAssets = cash + b.receivable;
    const liab = sum(b.liabilities, (l) => l.amount);
    const retained = ytd.net;
    const unrecorded = totalAssets - liab - retained;
    const equity = retained + unrecorded;

    $("#bsAsOf1").textContent = `Per ${b.asOf}`;
    $("#bsAsOf2").textContent = `Per ${b.asOf}`;

    $("#bsKpis").innerHTML = [
      kpi({ label: "Total Aset", value: rpShort(totalAssets), count: totalAssets, icon: "bank", hero: true, foot: `Per ${b.asOf}` }),
      kpi({ label: "Kas & Bank", value: rpShort(cash), icon: "wallet", foot: `${b.cashAccounts.length} rekening · ${pct(cash / totalAssets, 0)} aset` }),
      kpi({ label: "Piutang Usaha", value: rpShort(b.receivable), icon: "receipt", foot: `${pct(b.receivable / totalAssets, 0)} dari total aset` }),
      kpi({ label: "Laba Ditahan", value: rpShort(retained), icon: "chart", foot: `Akumulasi laba bersih ${ytd.name}` }),
    ].join("");

    const r = (cls, label, v, hint, showPct = true) =>
      `<tr class="${cls}"><td>${label}${hint ? `<span class="hint">${hint}</span>` : ""}</td><td class="${v < 0 ? "neg" : ""}">${typeof v === "string" ? v : rp(v)}</td><td>${showPct && typeof v === "number" && totalAssets ? pct(v / totalAssets, 0) : ""}</td></tr>`;

    $("#bsAssets").innerHTML = [
      r("section", "Aset Lancar", ""),
      ...b.cashAccounts.map((a) => r("item", a.name, a.amount)),
      r("item", "Piutang usaha (peserta)", b.receivable, "Sisa tagihan DP / pelunasan"),
      r("subtotal", "Total Aset Lancar", totalAssets),
      r("section", "Aset Tidak Lancar", ""),
      r("item", "Peralatan & aset tetap", "Belum tercatat", "Tambahkan di sheet bila ada"),
      `<tr class="total"><td>Total Aset</td><td>${rp(totalAssets)}</td><td>100%</td></tr>`,
    ].join("");

    $("#bsLiab").innerHTML = [
      r("section", "Kewajiban", ""),
      ...(b.liabilities.length
        ? b.liabilities.map((l) => r("item", l.name, l.amount))
        : [r("item", "Utang usaha / LSP", "Belum tercatat", "Sheet belum memuat data utang")]),
      r("subtotal", "Total Kewajiban", liab),
      r("section", "Ekuitas", ""),
      r("item", "Laba ditahan", retained, `Akumulasi laba bersih ${ytd.name}`, false),
      r("item", "Dana keluar belum tercatat", unrecorded, "Prive / distribusi / pengeluaran di luar sheet (selisih)", false),
      r("subtotal", "Total Ekuitas", equity),
      `<tr class="total"><td>Total Kewajiban &amp; Ekuitas</td><td>${rp(liab + equity)}</td><td>100%</td></tr>`,
    ].join("");

    // Piutang per bulan
    const rm = months.filter((m) => m.receivable != null);
    make("chReceivable", {
      type: "bar",
      data: {
        labels: rm.map((m) => m.short + (m.status === "running" ? "*" : "")),
        datasets: [{
          data: rm.map((m) => m.receivable),
          backgroundColor: rm.map((m) => (m.status === "running" ? alpha(t.s[1], 0.45) : t.s[1])),
          borderRadius: 4, borderSkipped: "start", maxBarThickness: 36,
        }],
      },
      options: {
        scales: { x: catAxis(t), y: moneyAxis(t) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (i) => rm[i[0].dataIndex].name + (rm[i[0].dataIndex].status === "running" ? " (berjalan)" : ""),
              label: (c) => ` Piutang: ${rp(c.raw)}`,
              afterLabel: (c) => `${pct(c.raw / rm[c.dataIndex].revenue)} dari omzet bulan itu`,
            },
          },
        },
      },
      plugins: [barValueLabels((v) => rpShort(v).replace("Rp", ""))],
    });

    // Akumulasi laba bersih
    let acc = 0;
    const cum = closed.map((m) => (acc += m.net));
    make("chRetained", {
      type: "line",
      data: {
        labels: closed.map((m) => m.short),
        datasets: [{
          label: "Akumulasi laba bersih", data: cum,
          borderColor: t.s[0], backgroundColor: alpha(t.s[0], 0.12), fill: true, tension: 0.3, borderWidth: 2,
          pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: t.s[0], pointBorderColor: t.surface, pointBorderWidth: 2,
        }],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: catAxis(t), y: moneyAxis(t) },
        plugins: {
          tooltip: {
            callbacks: {
              title: (i) => "s/d " + closed[i[0].dataIndex].name,
              label: (c) => ` Akumulasi: ${rp(c.raw)}`,
              afterLabel: (c) => `Laba bulan ini: ${rp(closed[c.dataIndex].net)}`,
            },
          },
        },
      },
      plugins: [crosshair],
    });
    enter("#page-neraca");
  }

  /* =========================================================
     PAGE: SUMMARY BULANAN
     ========================================================= */

  function renderSummary() {
    const t = tok();
    const m = byKey[sumKey];
    const prev = prevOf(m);

    $("#monthChips").innerHTML = months
      .map((x) => `<button class="chip ${x.key === sumKey ? "active" : ""}" role="tab" aria-selected="${x.key === sumKey}" data-key="${x.key}">${x.name}${x.status === "running" ? "<small>berjalan</small>" : ""}</button>`)
      .join("");
    const chipBox = $("#monthChips"), act = chipBox.querySelector(".active");
    if (act) chipBox.scrollLeft = act.offsetLeft - chipBox.offsetLeft - (chipBox.clientWidth - act.offsetWidth) / 2;

    $("#sumKpis").innerHTML = [
      kpi({ label: `Omzet ${m.name}`, value: rpShort(m.revenue), count: m.revenue, icon: "money", hero: true, foot: prev ? delta(m.revenue, prev.revenue) : "" }),
      kpi({ label: "Laba Kotor", value: rpShort(m.grossProfit), icon: "chart",
        foot: `${prev ? delta(m.grossProfit, prev.grossProfit) : ""} <span>· margin ${pct(m.grossMargin)}</span>` }),
      kpi({ label: "Laba Bersih", value: m.net == null ? "—" : rpShort(m.net), icon: "wallet",
        foot: m.net == null ? "OPEX belum tercatat" : `${prev && prev.net != null ? delta(m.net, prev.net) : ""} <span>· margin ${pct(m.netMargin)}</span>` }),
      kpi({ label: "Peserta", value: m.pTotal == null ? "—" : nf.format(m.pTotal), icon: "users",
        foot: m.pTotal == null ? "Tidak ada rincian peserta" : `${prev && prev.pTotal ? delta(m.pTotal, prev.pTotal) : ""}${m.receivable ? ` <span>· piutang ${rpShort(m.receivable)}</span>` : ""}` }),
    ].join("");

    // Omzet per program (detail, tidak di-fold)
    const label = `${m.name} ${D.year}${m.status === "running" ? " · berjalan" : ""}`;
    $("#sumRevLabel").textContent = label;
    $("#sumPartLabel").textContent = label;
    const hbar = (id, obj, fmt, tipFmt) => {
      if (!obj) {
        if (charts[id]) { charts[id].destroy(); delete charts[id]; }
        document.getElementById(id).parentElement.dataset.empty = "1";
        return;
      }
      const entries = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      make(id, {
        type: "bar",
        data: {
          labels: entries.map((e) => e[0]),
          datasets: [{
            data: entries.map((e) => e[1]),
            backgroundColor: entries.map((e) => groupColor(t, groupOf(e[0]))),
            borderRadius: 4, borderSkipped: "start", maxBarThickness: 22,
          }],
        },
        options: {
          indexAxis: "y",
          scales: {
            x: { ...moneyAxis(t), ticks: { padding: 6, maxTicksLimit: 5, callback: (v) => fmt(v) } },
            y: { ...catAxis(t), ticks: { color: t.text2, autoSkip: false } },
          },
          plugins: { tooltip: { callbacks: { label: (c) => " " + tipFmt(c.raw, sum(entries, (e) => e[1])) } } },
        },
        plugins: [barValueLabels(fmt)],
      });
    };
    toggleEmpty("chSumRevenue", !m.programRevenue, "Tidak ada rincian program untuk bulan ini.");
    toggleEmpty("chSumParticipants", !m.participants, "Tidak ada rincian peserta untuk bulan ini.");
    hbar("chSumRevenue", m.programRevenue, (v) => rpShort(v).replace("Rp", ""), (v, tot) => `${rp(v)} · ${pct(v / tot)}`);
    hbar("chSumParticipants", m.participants, (v) => nf.format(v), (v, tot) => `${v} peserta · ${pct(v / tot)}`);

    // Kanal
    $("#sumChLabel").textContent = label;
    if (m.channels) {
      const tot = sum(Object.values(m.channels));
      const max = Math.max(...Object.values(m.channels));
      $("#sumChannels").innerHTML = CHANNELS.map((c, i) => `
        <div class="bar-row">
          <div class="bar-top"><span><i style="background:${t.s[i]}"></i>${c}</span><span><b>${m.channels[c]}</b><em>${pct(m.channels[c] / tot, 0)}</em></span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${max ? (m.channels[c] / max) * 100 : 0}%;background:${t.s[i]}"></div></div>
        </div>`).join("");
    } else {
      $("#sumChannels").innerHTML = `<p class="empty">Kategori peserta belum dicatat di sheet ${m.name}.</p>`;
    }

    // Peserta per bulan (stacked)
    const pm = months.filter((x) => x.groups);
    $("#lgPartMonthly").innerHTML = legendHTML(PROGRAM_GROUPS.map((g) => [g, groupColor(t, g)]));
    make("chPartMonthly", {
      type: "bar",
      data: {
        labels: pm.map((x) => x.short + (x.status === "running" ? "*" : "")),
        datasets: PROGRAM_GROUPS.map((g) => ({
          label: g,
          data: pm.map((x) => x.groups[g]),
          backgroundColor: pm.map((x) => (x.key === sumKey ? groupColor(t, g) : alpha(groupColor(t, g), 0.55))),
          borderColor: t.surface, borderWidth: { top: 2, bottom: 0, left: 0, right: 0 },
          borderRadius: 2, borderSkipped: false, maxBarThickness: 34,
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        onClick: (_, els) => { if (els.length) { sumKey = pm[els[0].index].key; renderSummary(); } },
        scales: {
          x: { ...catAxis(t), stacked: true },
          y: { stacked: true, beginAtZero: true, border: { display: false }, grid: { color: t.grid }, ticks: { maxTicksLimit: 6 } },
        },
        plugins: {
          tooltip: {
            filter: (c) => c.raw > 0,
            callbacks: {
              title: (i) => `${pm[i[0].dataIndex].name} · ${pm[i[0].dataIndex].pTotal} peserta`,
              label: (c) => ` ${c.dataset.label}: ${c.raw}`,
            },
          },
        },
      },
    });

    // Tabel rekap
    const tot = (f) => sum(closed, f);
    $("#sumTable").innerHTML = `
      <thead><tr><th>Bulan</th><th>Peserta</th><th>Omzet</th><th>Laba Kotor</th><th>OPEX</th><th>Laba Bersih</th><th>Margin</th><th>Piutang</th></tr></thead>
      <tbody>
        ${months.map((x) => `
          <tr data-key="${x.key}" class="${x.key === sumKey ? "active" : ""}">
            <td>${x.name}${x.status === "running" ? '<span class="tag">berjalan</span>' : ""}</td>
            <td>${x.pTotal == null ? '<span class="muted">—</span>' : nf.format(x.pTotal)}</td>
            <td>${rp(x.revenue)}</td>
            <td>${rp(x.grossProfit)}</td>
            <td>${x.opex == null ? '<span class="muted">—</span>' : rp(x.opex)}</td>
            <td class="${x.net < 0 ? "neg" : ""}">${x.net == null ? '<span class="muted">—</span>' : rp(x.net)}</td>
            <td>${pct(x.netMargin)}</td>
            <td>${x.receivable == null ? '<span class="muted">—</span>' : rp(x.receivable)}</td>
          </tr>`).join("")}
      </tbody>
      <tfoot><tr>
        <td>Total Jan – ${closed[closed.length - 1].short}</td>
        <td>${nf.format(tot((x) => x.pTotal))}</td>
        <td>${rp(ytd.revenue)}</td><td>${rp(ytd.grossProfit)}</td><td>${rp(ytd.opex)}</td>
        <td>${rp(ytd.net)}</td><td>${pct(ytd.netMargin)}</td><td></td>
      </tr></tfoot>`;
    enter("#page-summary");
  }

  /* =========================================================
     PAGE: GAJI PEGAWAI (khusus BOD)
     ========================================================= */
  async function loadPayroll() {
    if (!canPayroll()) return;
    if (!SERVER) { payroll = window.GIS_PAYROLL || { ready: false, rows: [], sheet: "Gaji Pegawai" }; return; }
    try {
      const res = await callGas("getPayroll", session && session.token);
      if (res.error === "auth") { const e = new Error("Sesi berakhir"); e.auth = true; throw e; }
      if (res.error) throw new Error(res.error === "forbidden" ? "Akun ini tidak punya akses ke data gaji." : res.error);
      payroll = res;
      payrollError = "";
    } catch (e) {
      if (e.auth) { logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
      payrollError = e.message;
    }
  }

  function renderPayroll() {
    const state = $("#payState"), body = $("#payBody");
    const showState = (html) => { state.innerHTML = html; state.hidden = false; body.hidden = true; };
    if (!payroll && !payrollError) {
      showState('<div class="loading" style="min-height:0"><span class="spinner" aria-hidden="true"></span><span>Mengambil data gaji…</span></div>');
      loadPayroll().then(() => { if (current === "gaji" && D) renderPayroll(); });
      return;
    }
    if (payrollError) return showState(`<h3>Gagal memuat data gaji</h3><p>${esc(payrollError)}</p>`);
    const all = payroll.rows || [];
    if (!payroll.ready || !all.length) {
      const cols = ["Bulan", "Nama Pegawai", "Jabatan", "Gaji Pokok", "Tunjangan", "Bonus", "Potongan", "Total Diterima", "Status", "Tanggal Bayar", "Catatan"];
      return showState(`<h3>Belum ada data gaji</h3>
        <p>Buat tab <code>${esc(payroll.sheet || "Gaji Pegawai")}</code> di Google Sheet laporan keuangan dengan baris judul berikut, lalu isi satu baris per pegawai per bulan:</p>
        <div class="cols">${cols.map((c) => `<code>${c}</code>`).join("")}</div>
        <p class="card-sub">Kolom Bulan diisi nama bulan (mis. Oktober). Total Diterima boleh dikosongkan — dihitung otomatis (pokok + tunjangan + bonus − potongan). Status: “Sudah dibayar” atau “Belum”.</p>`);
    }
    state.hidden = true;
    body.hidden = false;

    const t = tok();
    const sel = plPeriod === "ytd" ? null : byKey[plPeriod] || null;
    const rows = sel ? all.filter((r) => r.month === sel.key) : all;
    const payMonths = months.filter((m) => all.some((r) => r.month === m.key));
    const label = sel ? `${sel.name} ${D.year}` : payMonths.length ? `${payMonths[0].name} – ${payMonths[payMonths.length - 1].name} ${D.year}` : "";
    const total = sum(rows, (r) => r.total);
    const people = new Set(rows.map((r) => r.name)).size;
    const paid = rows.filter((r) => r.paid).length;
    const withOpex = rows.filter((r) => byKey[r.month] && byKey[r.month].opex);
    const opexBase = sum([...new Set(withOpex.map((r) => r.month))], (k) => byKey[k].opex);
    const opexShare = opexBase ? sum(withOpex, (r) => r.total) / opexBase : null;

    $("#payKpis").innerHTML = [
      kpi({ label: `Total Gaji ${label}`, value: rpShort(total), count: total, icon: "wallet", hero: true,
        foot: opexShare != null ? `<b class="num">${pct(opexShare)}</b> dari OPEX` : rows.length ? "" : "Tidak ada data bulan ini" }),
      kpi({ label: "Jumlah Pegawai", value: nf.format(people), count: people, fmt: "int", icon: "users",
        foot: sel ? "" : `${payMonths.length} bulan tercatat` }),
      kpi({ label: sel ? "Rata-rata Gaji" : "Rata-rata Gaji / Bulan", value: rows.length ? rpShort(total / rows.length) : "—", count: rows.length ? total / rows.length : null, icon: "money",
        foot: "per pegawai" }),
      kpi({ label: "Status Pembayaran", value: rows.length ? `${paid}/${rows.length}` : "—", icon: "receipt",
        foot: !rows.length ? "" : rows.length - paid ? `<span class="status-tag wait">${rows.length - paid} belum dibayar</span>` : '<span class="status-tag ok">Semua sudah dibayar</span>' }),
    ].join("");

    // Total gaji per bulan
    $("#payTrendSub").textContent = payMonths.length ? `${payMonths[0].name} – ${payMonths[payMonths.length - 1].name} ${D.year}` + (sel ? ` · ${sel.name} disorot` : "") : "—";
    make("chPayTrend", {
      type: "bar",
      data: {
        labels: payMonths.map((m) => m.short),
        datasets: [{
          data: payMonths.map((m) => sum(all.filter((r) => r.month === m.key), (r) => r.total)),
          backgroundColor: payMonths.map((m) => (sel && m !== sel ? alpha(t.s[0], 0.35) : t.s[0])),
          borderRadius: 4, borderSkipped: "start", maxBarThickness: 36,
        }],
      },
      options: {
        scales: { x: catAxis(t), y: moneyAxis(t) },
        plugins: { tooltip: { callbacks: { title: (i) => payMonths[i[0].dataIndex].name + " " + D.year, label: (c) => ` Total gaji: ${rp(c.raw)}` } } },
      },
      plugins: [barValueLabels((v) => rpShort(v).replace("Rp", ""))],
    });

    // Komposisi
    const parts = [
      ["Gaji pokok", sum(rows, (r) => r.base), t.s[0]],
      ["Tunjangan", sum(rows, (r) => r.allowance), t.s[1]],
      ["Bonus / insentif", sum(rows, (r) => r.bonus), t.s[2]],
      ["Potongan", -sum(rows, (r) => r.deduction), t.s[3]],
    ];
    const gross = parts[0][1] + parts[1][1] + parts[2][1];
    const pmax = Math.max(1, ...parts.map((p) => Math.abs(p[1])));
    $("#payMixSub").textContent = label;
    $("#payMix").innerHTML = parts.map(([n, v, c]) => `
      <div class="bar-row">
        <div class="bar-top"><span><i style="background:${c}"></i>${n}</span><span><b>${rp(v)}</b><em>${gross ? pct(Math.abs(v) / gross, 0) : ""}</em></span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(Math.abs(v) / pmax) * 100}%;background:${c}"></div></div>
      </div>`).join("") + `<div class="bar-foot">Total diterima: <b>${rp(total)}</b></div>`;

    // Tabel
    const statusTag = (ok, n) => (ok ? '<span class="status-tag ok">Sudah dibayar</span>' : `<span class="status-tag wait">${n ? n + " belum" : "Belum"}</span>`);
    if (sel) {
      $("#payTableSub").textContent = `${sel.name} ${D.year} · ${rows.length} pegawai`;
      const list = rows.slice().sort((a, b) => b.total - a.total);
      $("#payTable").innerHTML = `
        <thead><tr><th class="left">Pegawai</th><th>Gaji Pokok</th><th>Tunjangan</th><th>Bonus</th><th>Potongan</th><th>Total Diterima</th><th class="left">Status</th></tr></thead>
        <tbody>${list.map((r) => `<tr>
          <td class="left">${esc(r.name)}${r.role ? `<span class="sub">${esc(r.role)}</span>` : ""}</td>
          <td>${rp(r.base)}</td><td>${rp(r.allowance)}</td><td>${rp(r.bonus)}</td>
          <td class="${r.deduction ? "neg" : ""}">${r.deduction ? "−" + rp(r.deduction) : rp(0)}</td>
          <td><b>${rp(r.total)}</b></td>
          <td class="left">${statusTag(r.paid)}${r.paidAt ? `<span class="sub">${esc(r.paidAt)}</span>` : ""}</td></tr>`).join("") || '<tr><td colspan="7" class="muted left">Tidak ada data gaji untuk bulan ini.</td></tr>'}</tbody>
        <tfoot><tr><td class="left">Total</td><td>${rp(parts[0][1])}</td><td>${rp(parts[1][1])}</td><td>${rp(parts[2][1])}</td><td>${rp(parts[3][1])}</td><td>${rp(total)}</td><td></td></tr></tfoot>`;
    } else {
      const byName = {};
      rows.forEach((r) => {
        const e = byName[r.name] || (byName[r.name] = { name: r.name, role: r.role, n: 0, base: 0, allowance: 0, bonus: 0, deduction: 0, total: 0, unpaid: 0 });
        e.n++; e.base += r.base; e.allowance += r.allowance; e.bonus += r.bonus; e.deduction += r.deduction; e.total += r.total;
        if (!r.paid) e.unpaid++;
        if (r.role) e.role = r.role;
      });
      const list = Object.values(byName).sort((a, b) => b.total - a.total);
      $("#payTableSub").textContent = `Akumulasi ${label} · ${list.length} pegawai`;
      $("#payTable").innerHTML = `
        <thead><tr><th class="left">Pegawai</th><th>Bulan</th><th>Gaji Pokok</th><th>Tunjangan</th><th>Bonus</th><th>Potongan</th><th>Total Diterima</th><th class="left">Status</th></tr></thead>
        <tbody>${list.map((e) => `<tr>
          <td class="left">${esc(e.name)}${e.role ? `<span class="sub">${esc(e.role)}</span>` : ""}</td>
          <td>${e.n}</td><td>${rp(e.base)}</td><td>${rp(e.allowance)}</td><td>${rp(e.bonus)}</td>
          <td class="${e.deduction ? "neg" : ""}">${e.deduction ? "−" + rp(e.deduction) : rp(0)}</td>
          <td><b>${rp(e.total)}</b></td>
          <td class="left">${statusTag(!e.unpaid, e.unpaid)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td class="left">Total</td><td></td><td>${rp(parts[0][1])}</td><td>${rp(parts[1][1])}</td><td>${rp(parts[2][1])}</td><td>${rp(parts[3][1])}</td><td>${rp(total)}</td><td></td></tr></tfoot>`;
    }
    enter("#page-gaji");
  }

  /* =========================================================
     PAGE: DATABASE PESERTA (STAFF & BOD)
     ========================================================= */
  const MONTH_KEYS = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];
  const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const SOURCE_COLOR = { Online: 0, Referral: 1, B2B: 2, Ads: 3 };

  async function loadPeople() {
    if (!SERVER) { people = window.GIS_PEOPLE || null; if (!people) peopleErr = "Database peserta hanya tersedia di versi Apps Script (data dibaca langsung dari Google Sheet)."; return; }
    try {
      const res = await callGas("getParticipants", session && session.token);
      if (res.error === "auth") { logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
      if (res.error) throw new Error(res.error);
      people = res.rows.map((r) => Object.fromEntries(res.fields.map((f, i) => [f, r[i]])));
      people.forEach((p, i) => { p.mi = MONTH_KEYS.indexOf(p.month); p.id = i; });
      peopleErr = "";
    } catch (e) { peopleErr = e.message; }
  }

  function fillSelect(el, opts, value) {
    el.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    el.value = opts.some(([v]) => v === value) ? value : opts[0][0];
  }

  function renderDb() {
    const state = $("#dbState"), body = $("#dbBody");
    const showState = (html) => { state.innerHTML = html; state.hidden = false; body.hidden = true; };
    if (!people && !peopleErr) {
      showState('<div class="loading" style="min-height:0"><span class="spinner" aria-hidden="true"></span><span>Mengambil database peserta\u2026</span></div>');
      loadPeople().then(() => { if (current === "database" && D) renderDb(); });
      return;
    }
    if (peopleErr) return showState(`<h3>Database belum bisa ditampilkan</h3><p>${esc(peopleErr)}</p>`);
    state.hidden = true;
    body.hidden = false;
    const t = tok();

    // pilihan filter
    const count = (key) => people.reduce((m, p) => ((m[p[key]] = (m[p[key]] || 0) + 1), m), {});
    const progs = Object.entries(count("program")).sort((a, b) => b[1] - a[1]);
    const mons = [...new Set(people.map((p) => p.mi))].filter((i) => i >= 0).sort((a, b) => b - a);
    const srcs = Object.entries(count("source")).filter(([k]) => k).sort((a, b) => b[1] - a[1]);
    fillSelect($("#dbProgram"), [["", "Semua kelas"], ...progs.map(([k, n]) => [k, `${k} (${n})`])], db.program);
    fillSelect($("#dbMonth"), [["", "Semua bulan"], ...mons.map((i) => [MONTH_KEYS[i], MONTH_NAMES[i]])], db.month);
    fillSelect($("#dbSource"), [["", "Semua source"], ...srcs.map(([k, n]) => [k, `${k} (${n})`])], db.source);
    $("#dbSort").value = db.sort;
    if ($("#dbSearch").value !== db.q) $("#dbSearch").value = db.q;

    // filter + urut
    const q = db.q.trim().toLowerCase();
    let list = people.filter((p) =>
      (!q || p.name.toLowerCase().includes(q)) &&
      (!db.program || p.program === db.program) &&
      (!db.month || p.month === db.month) &&
      (!db.source || p.source === db.source));
    const [key, dir] = db.sort.split("-");
    const sign = dir === "desc" ? -1 : 1;
    const byName = (a, b) => a.name.localeCompare(b.name, "id");
    // arah urut hanya untuk kolom utama; urutan cadangan selalu A–Z
    const primary = {
      month: (a, b) => a.mi - b.mi,
      cls: (a, b) => a.cls.localeCompare(b.cls, "id"),
      name: byName,
      source: (a, b) => (a.source || "").localeCompare(b.source || "", "id"),
      fee: (a, b) => a.fee - b.fee,
    }[key] || byName;
    const tie = (a, b) => a.cls.localeCompare(b.cls, "id") || (b.mi - a.mi) || byName(a, b);
    list = list.slice().sort((a, b) => sign * primary(a, b) || tie(a, b));

    // ringkasan
    const bySrc = list.reduce((m, p) => ((m[p.source || "Lainnya"] = (m[p.source || "Lainnya"] || 0) + 1), m), {});
    $("#dbChips").innerHTML = `<span class="db-chip">Total <b>${nf.format(list.length)}</b> peserta</span>` +
      Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
        `<span class="db-chip"><i style="background:${SOURCE_COLOR[k] != null ? t.s[SOURCE_COLOR[k]] : t.other}"></i>${esc(k)} <b>${nf.format(n)}</b></span>`).join("") +
      `<span class="db-chip">Omzet <b>${rpShort(sum(list, (p) => p.fee))}</b></span>`;
    $("#dbSub").textContent = `${nf.format(list.length)} dari ${nf.format(people.length)} peserta` +
      (q ? ` · cari \u201c${db.q.trim()}\u201d` : "");

    const hl = (name) => {
      const safe = esc(name);
      if (!q) return safe;
      const i = name.toLowerCase().indexOf(q);
      return i < 0 ? safe : esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length));
    };
    const arrow = (k) => (key === k ? `<span class="arrow">${dir === "desc" ? "\u25bc" : "\u25b2"}</span>` : "");
    const shown = list.slice(0, db.limit);
    const editable = canInput() && SERVER;
    $("#dbTable").innerHTML = `
      <thead><tr>
        <th class="left">No</th>
        <th class="left sortable" data-sort="name">Nama Peserta${arrow("name")}</th>
        <th class="left sortable" data-sort="cls">Kelas${arrow("cls")}</th>
        <th class="left sortable" data-sort="month">Bulan${arrow("month")}</th>
        <th class="left sortable" data-sort="source">Source${arrow("source")}</th>
        <th class="left">Keterangan</th>
        <th class="left">Pembayaran</th>
        <th class="sortable" data-sort="fee">Biaya Pelatihan${arrow("fee")}</th>
        ${editable ? '<th><span class="sr-only">Aksi</span></th>' : ""}
      </tr></thead>
      <tbody>${shown.map((p, i) => `<tr${db.flash && db.flash === p.sheet + "|" + p.row ? ' class="flash"' : ""}>
        <td class="left muted">${i + 1}</td>
        <td class="left"><b>${hl(p.name)}</b></td>
        <td class="left"><span class="prog-tag">${esc(p.program)}</span>${esc(p.cls)}</td>
        <td class="left">${MONTH_NAMES[p.mi] || "\u2014"}</td>
        <td class="left">${esc(p.source || "\u2014")}</td>
        <td class="left">${esc(p.jenis || "\u2014")}</td>
        <td class="left">${p.status ? `<span class="status-tag ${/lunas/i.test(p.status) ? "ok" : "wait"}">${esc(p.status)}</span>` : "\u2014"}</td>
        <td>${p.fee ? rp(p.fee) : "\u2014"}</td>
        ${editable ? `<td class="row-acts"><button class="row-edit" type="button" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">Edit</button><button class="row-del" type="button" data-id="${p.id}" aria-label="Hapus ${esc(p.name)}">Hapus</button></td>` : ""}
      </tr>`).join("") || `<tr><td colspan="${editable ? 9 : 8}" class="left muted">Tidak ada peserta yang cocok.</td></tr>`}</tbody>`;
    if (db.flash) { clearTimeout(renderDb._f); renderDb._f = setTimeout(() => (db.flash = ""), 2500); }
    $("#dbMore").hidden = list.length <= db.limit;
    $("#dbMore").textContent = `Tampilkan lebih banyak (${nf.format(list.length - db.limit)} lagi)`;
    enter("#page-database");
  }

  /* =========================================================
     PAGE: INPUT PESERTA (khusus STAFF)
     ========================================================= */
  const money = (el) => +String(el.value || "").replace(/\D/g, "") || 0;
  let statusTouched = false;

  async function loadInputOpts() {
    if (!canInput()) return;
    if (!SERVER) { inputErr = "Form input hanya berfungsi di versi Apps Script (menulis langsung ke Google Sheet)."; return; }
    try {
      const res = await callGas("getInputOptions", session && session.token);
      if (res.error === "auth") { logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
      if (res.error) throw new Error(res.error === "forbidden" ? "Akun ini tidak punya akses ke form input." : res.error);
      inputOpts = res;
      inputErr = "";
    } catch (e) { inputErr = e.message; }
  }

  function currentMonthOpt() { return inputOpts && inputOpts.months.find((m) => m.sheet === $("#inMonth").value); }
  function currentBlock() { const m = currentMonthOpt(); return m && m.blocks[+$("#inBlock").value]; }

  function fillBlocks(applyDefaults) {
    const m = currentMonthOpt();
    const prev = $("#inBlock").value;
    $("#inBlock").innerHTML = m && m.blocks.length
      ? m.blocks.map((b) => `<option value="${b.i}">${esc(b.title)} \u00b7 ${b.count} peserta</option>`).join("")
      : '<option value="">Tidak ada kelas di sheet ini</option>';
    if (m && m.blocks.some((b) => String(b.i) === prev)) $("#inBlock").value = prev;
    onBlockChange(applyDefaults);
  }

  function onBlockChange(applyDefaults) {
    const b = currentBlock();
    $("#inBlockHint").textContent = !b ? "" : b.free ? `${b.free} baris kosong tersedia \u2014 peserta ditulis ke baris kosong pertama.` : "Kelas penuh \u2014 baris baru akan disisipkan otomatis.";
    if (b && applyDefaults) {
      const d = b.defaults || {};
      [["inFee", d.fee], ["inLsp", d.lsp], ["inShip", d.ship], ["inMerch", d.merch]].forEach(([id, v]) => { $("#" + id).value = v ? nf.format(v) : ""; });
    }
    updateInputSummary();
  }

  function updateInputSummary() {
    const fee = money($("#inFee")), dp = money($("#inDp")), lunas = money($("#inLunas"));
    const lsp = money($("#inLsp")), ship = money($("#inShip")), merch = money($("#inMerch"));
    const paid = dp + lunas, due = fee - paid, gross = fee - lsp - ship - merch;
    if (!statusTouched) $("#inStatus").value = fee > 0 && paid >= fee ? "Lunas" : paid > 0 ? "DP" : "Belum Bayar";
    const set = (id, v, neg) => { const el = $("#" + id); el.textContent = rp(v); el.classList.toggle("neg", !!neg); };
    set("sFee", fee); set("sPaid", paid); set("sDue", Math.max(due, 0), due > 0);
    set("sLsp", lsp); set("sShip", ship); set("sMerch", merch); set("sGross", gross, gross < 0);
    $("#sMargin").textContent = fee ? pct(gross / fee) : "\u2014";
    const b = currentBlock(), name = $("#inName").value.trim();
    $("#sumWho").textContent = (name || "Peserta baru") + (b ? ` \u2192 ${b.title}` : "");
  }

  function renderInput() {
    const state = $("#inState"), form = $("#inForm");
    const showState = (html) => { state.innerHTML = html; state.hidden = false; form.hidden = true; };
    if (!inputOpts && !inputErr) {
      showState('<div class="loading" style="min-height:0"><span class="spinner" aria-hidden="true"></span><span>Memuat daftar kelas\u2026</span></div>');
      loadInputOpts().then(() => { if (current === "input" && D) renderInput(); });
      return;
    }
    if (inputErr) return showState(`<h3>Form belum bisa dipakai</h3><p>${esc(inputErr)}</p>`);
    state.hidden = true;
    form.hidden = false;
    const prevMonth = $("#inMonth").value;
    $("#inMonth").innerHTML = inputOpts.months.map((m) => `<option value="${esc(m.sheet)}">${esc(m.name)}</option>`).join("");
    $("#inMonth").value = inputOpts.months.some((m) => m.sheet === prevMonth) ? prevMonth : inputOpts.current;
    fillBlocks(!$("#inFee").value);
    enter("#page-input");
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 5000);
  }

  async function submitInput(e) {
    e.preventDefault();
    const err = $("#inError"), btn = $("#inSubmit");
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    const b = currentBlock();
    const payload = {
      sheet: $("#inMonth").value, block: b ? b.i : -1, blockTitle: b ? b.title : "",
      name: $("#inName").value.trim(), source: $("#inSource").value, jenis: $("#inJenis").value.trim(),
      tglDp: $("#inTglDp").value, dp: money($("#inDp")), tglLunas: $("#inTglLunas").value, lunas: money($("#inLunas")),
      status: $("#inStatus").value, fee: money($("#inFee")), lsp: money($("#inLsp")), ship: money($("#inShip")), merch: money($("#inMerch")),
    };
    if (!b) return fail("Pilih kelas terlebih dahulu.");
    if (!payload.name) { $("#inName").focus(); return fail("Nama peserta wajib diisi."); }
    if (!payload.fee) { $("#inFee").focus(); return fail("Biaya pelatihan wajib diisi."); }
    if (payload.dp && !payload.tglDp) { $("#inTglDp").focus(); return fail("Isi tanggal DP."); }
    if (payload.lunas && !payload.tglLunas) { $("#inTglLunas").focus(); return fail("Isi tanggal pelunasan."); }
    if (!SERVER) return fail("Form input hanya berfungsi di versi Apps Script.");
    btn.disabled = true; btn.classList.add("busy");
    try {
      const res = await callGas("addParticipant", session && session.token, payload);
      if (res.error === "auth") { logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
      if (res.error) throw new Error(res.error === "forbidden" ? "Akun ini tidak punya akses ke form input." : res.error);
      toast(`\u2713 ${payload.name} tersimpan di sheet ${res.sheet}, kelas ${res.cls} (baris ${res.row}${res.inserted ? ", baris baru" : ""}).`);
      ["inName", "inTglDp", "inDp", "inTglLunas", "inLunas"].forEach((id) => ($("#" + id).value = ""));
      statusTouched = false;
      // muat ulang daftar kelas (slot kosong berubah), database & angka dashboard
      people = null;
      await loadInputOpts();
      if (current === "input") renderInput();
      $("#inName").focus();
      load();
    } catch (ex) {
      fail(ex.message);
    } finally {
      btn.disabled = false; btn.classList.remove("busy");
    }
  }

  /* =========================================================
     EDIT PESERTA dari Database (khusus STAFF)
     ========================================================= */
  let editing = null, edStatusTouched = false, edReturnFocus = null;
  const todayStr = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
  const setMoney = (id, v) => { $("#" + id).value = v ? nf.format(v) : ""; };
  const ensureOption = (sel, v) => {
    if (v && ![...sel.options].some((o) => o.value === v)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)}</option>`);
    sel.value = v || sel.options[0].value;
  };

  async function ensureInputOpts() {
    if (inputOpts) return inputOpts;
    const res = await callGas("getInputOptions", session && session.token);
    if (res && !res.error) inputOpts = res;
    return inputOpts;
  }

  async function openEdit(id) {
    const p = people && people.find((x) => x.id === +id);
    if (!p || !canInput()) return;
    editing = p;
    // pilihan kelas = blok di sheet bulan yang sama
    const sel = $("#edClass");
    sel.innerHTML = `<option value="${esc(p.cls)}">${esc(p.cls)}</option>`;
    sel.value = p.cls;
    try {
      const opts = await ensureInputOpts();
      const m = opts && opts.months.find((x) => x.sheet === p.sheet);
      if (m) sel.innerHTML = m.blocks.map((b) => {
        const cur = b.title === p.cls;
        return `<option value="${esc(b.title)}"${cur ? " selected" : ""}${!cur && !b.free ? " disabled" : ""}>${esc(b.title)} \u00b7 ${b.free} kosong</option>`;
      }).join("");
    } catch (ex) { /* biarkan hanya kelas saat ini */ }
    edStatusTouched = false;
    edReturnFocus = document.activeElement;
    $("#edTitle").textContent = `Edit \u00b7 ${p.name}`;
    $("#edWhere").textContent = `${p.cls} \u00b7 sheet ${p.sheet}, baris ${p.row}`;
    $("#edName").value = p.name;
    ensureOption($("#edSource"), p.source);
    $("#edJenis").value = p.jenis || "";
    $("#edTglDp").value = p.tglDp || "";
    $("#edTglLunas").value = p.tglLunas || "";
    setMoney("edDp", p.dp); setMoney("edLunas", p.lunas);
    setMoney("edFee", p.fee); setMoney("edLsp", p.lsp); setMoney("edShip", p.ship); setMoney("edMerch", p.merch);
    ensureOption($("#edStatus"), p.status);
    $("#edError").hidden = true;
    updateEditSummary(false);
    $("#edModal").hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => $("#edName").focus(), 30);
  }

  function closeEdit() {
    if ($("#edModal").hidden) return;
    $("#edModal").hidden = true;
    document.body.classList.remove("modal-open");
    editing = null;
    if (edReturnFocus && document.contains(edReturnFocus)) edReturnFocus.focus();
  }

  function updateEditSummary(autoStatus) {
    const fee = money($("#edFee")), paid = money($("#edDp")) + money($("#edLunas"));
    const gross = fee - money($("#edLsp")) - money($("#edShip")) - money($("#edMerch"));
    if (autoStatus && !edStatusTouched) $("#edStatus").value = fee > 0 && paid >= fee ? "Lunas" : paid > 0 ? "DP" : "Belum Bayar";
    const set = (id, v, neg) => { const el = $("#" + id); el.textContent = rp(v); el.classList.toggle("neg", !!neg); };
    set("eSPaid", paid); set("eSDue", Math.max(fee - paid, 0), fee - paid > 0); set("eSGross", gross, gross < 0);
  }

  function payOff() {
    const fee = money($("#edFee")), dp = money($("#edDp"));
    if (!fee) { $("#edFee").focus(); return; }
    setMoney("edLunas", Math.max(fee - dp, 0));
    if (!$("#edTglLunas").value) $("#edTglLunas").value = todayStr();
    edStatusTouched = false;
    updateEditSummary(true);
  }

  async function deleteParticipant(id) {
    const p = people && people.find((x) => x.id === +id);
    if (!p || !canInput()) return;
    const ok = window.confirm(`Hapus ${p.name} dari ${p.cls} (sheet ${p.sheet}, baris ${p.row})?\n\nData peserta di Google Sheet akan dikosongkan. Baris tetap ada. Tindakan ini tidak bisa dibatalkan dari aplikasi.`);
    if (!ok) return;
    try {
      const res = await callGas("deleteParticipant", session && session.token, { sheet: p.sheet, row: p.row, origName: p.name });
      if (res.error === "auth") { logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
      if (res.error) throw new Error(res.error === "forbidden" ? "Akun ini tidak punya akses untuk menghapus peserta." : res.error);
      toast(`\u2713 ${p.name} dihapus dari sheet ${res.sheet}, baris ${res.row}.`);
      db.flash = "";
      people = null; inputOpts = null;
      if (current === "database") renderDb();
      load();
    } catch (ex) {
      toast(ex.message);
    }
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editing) return;
    const err = $("#edError"), btn = $("#edSubmit");
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    const payload = {
      sheet: editing.sheet, row: editing.row, origName: editing.name,
      name: $("#edName").value.trim(), source: $("#edSource").value, jenis: $("#edJenis").value.trim(),
      tglDp: $("#edTglDp").value, dp: money($("#edDp")), tglLunas: $("#edTglLunas").value, lunas: money($("#edLunas")),
      status: $("#edStatus").value, fee: money($("#edFee")), lsp: money($("#edLsp")), ship: money($("#edShip")), merch: money($("#edMerch")),
    };
    if (!payload.name) { $("#edName").focus(); return fail("Nama peserta wajib diisi."); }
    if (!payload.fee) { $("#edFee").focus(); return fail("Biaya pelatihan wajib diisi."); }
    // tanggal wajib hanya bila nominalnya diubah (data lama bisa saja tanpa tanggal)
    if (payload.dp && payload.dp !== editing.dp && !payload.tglDp) { $("#edTglDp").focus(); return fail("Isi tanggal DP."); }
    if (payload.lunas && payload.lunas !== editing.lunas && !payload.tglLunas) { $("#edTglLunas").focus(); return fail("Isi tanggal pelunasan."); }
    btn.disabled = true; btn.classList.add("busy");
    let moved = "";
    try {
      const newCls = $("#edClass").value;
      if (newCls && newCls !== editing.cls) {
        const mv = await callGas("moveParticipant", session && session.token, { sheet: editing.sheet, row: editing.row, origName: editing.name, toCls: newCls });
        if (mv.error === "auth") { closeEdit(); logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
        if (mv.error) throw new Error(mv.error === "forbidden" ? "Akun ini tidak punya akses untuk mengedit peserta." : mv.error);
        payload.row = mv.row;
        moved = mv.toCls;
      }
      const res = await callGas("updateParticipant", session && session.token, payload);
      if (res.error === "auth") { closeEdit(); logout("Sesi Anda sudah berakhir. Silakan masuk lagi."); return; }
      if (res.error) throw new Error(res.error === "forbidden" ? "Akun ini tidak punya akses untuk mengedit peserta." : (moved ? "Peserta sudah dipindah ke " + moved + ", tapi perubahan lain gagal: " : "") + res.error);
      closeEdit();
      if (moved) {
        toast(`\u2713 ${payload.name} dipindah ke ${moved} di sheet ${res.sheet}, baris ${res.row}.`);
        db.flash = res.sheet + "|" + res.row;
        people = null; inputOpts = null;
        if (current === "database") renderDb();
        load();
        return;
      }
      if (!res.changed.length) { toast("Tidak ada perubahan \u2014 data di sheet sudah sama."); return; }
      toast(`\u2713 ${payload.name} diperbarui (${res.changed.length} kolom) di sheet ${res.sheet}, baris ${res.row}.`);
      db.flash = res.sheet + "|" + res.row;
      people = null; inputOpts = null;
      if (current === "database") renderDb();
      load();
    } catch (ex) {
      fail(ex.message);
    } finally {
      btn.disabled = false; btn.classList.remove("busy");
    }
  }

  function toggleEmpty(canvasId, isEmpty, msg) {
    const wrap = document.getElementById(canvasId).parentElement;
    let p = wrap.querySelector(".empty");
    if (isEmpty) {
      if (!p) { p = document.createElement("p"); p.className = "empty"; wrap.appendChild(p); }
      p.textContent = msg;
      document.getElementById(canvasId).style.display = "none";
    } else {
      if (p) p.remove();
      document.getElementById(canvasId).style.display = "";
    }
  }

  /* ---------------- Chart plugins ---------------- */
  // Garis vertikal saat hover (line chart)
  const crosshair = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const a = chart.tooltip && chart.tooltip.getActiveElements();
      if (!a || !a.length) return;
      const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = tok().axis;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.restore();
    },
  };
  // Label nilai di ujung bar (bar tunggal saja)
  const barValueLabels = (fmt) => ({
    id: "barValueLabels",
    beforeLayout(chart) {
      // beri ruang agar label di ujung bar tidak terpotong
      chart.options.layout.padding = chart.options.indexAxis === "y" ? { right: 56 } : { top: 20 };
    },
    afterDatasetsDraw(chart) {
      const t = tok(), ctx = chart.ctx, horizontal = chart.options.indexAxis === "y";
      ctx.save();
      ctx.font = "500 11px Poppins, sans-serif";
      ctx.fillStyle = t.text2;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        if (v == null || v === 0) return;
        const s = fmt(v);
        if (horizontal) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(s, bar.x + 6, bar.y); }
        else { ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(s, bar.x, bar.y - 4); }
      });
      ctx.restore();
    },
  });

  /* =========================================================
     Router, controls, theme
     ========================================================= */
  const PAGES = {
    dashboard: { title: "Dashboard", eyebrow: () => `Ringkasan ${D.year}`, render: renderDashboard, period: true },
    "laba-rugi": { title: "Laporan Laba Rugi", eyebrow: () => "Laporan keuangan", render: renderPL, period: true },
    neraca: { title: "Neraca Keuangan", eyebrow: () => (D.balance ? `Posisi per ${D.balance.asOf}` : "Posisi keuangan"), render: renderBS },
    summary: { title: "Summary Bulanan", eyebrow: () => `Kinerja per bulan ${D.year}`, render: renderSummary },
    database: { title: "Database Peserta", eyebrow: () => `Semua kelas \u00b7 ${D.year}`, render: renderDb },
    input: { title: "Input Peserta", eyebrow: () => "Khusus STAFF \u00b7 tersimpan ke Google Sheet", render: renderInput },
    gaji: { title: "Gaji Pegawai", eyebrow: () => `Khusus BOD · ${D.year}`, render: renderPayroll, period: true },
  };
  let current = "dashboard";

  function renderCurrent() {
    if (!D) return;
    applyChartDefaults();
    PAGES[current].render();
  }

  function go(target) {
    const page = typeof target === "string" ? target : (location.hash || "#dashboard").slice(1);
    current = PAGES[page] ? page : "dashboard";
    if ((current === "gaji" && !canPayroll()) || (current === "input" && !canInput())) {
      current = "dashboard";
      try { history.replaceState(null, "", "#dashboard"); } catch (err) { /* iframe sandbox */ }
    }
    const P = PAGES[current];
    if (D) document.querySelectorAll(".page").forEach((s) => (s.hidden = s.dataset.page !== current));
    document.querySelectorAll(".nav-item").forEach((a) => {
      const on = a.dataset.page === current;
      a.classList.toggle("active", on);
      a.setAttribute("aria-selected", on);
    });
    $("#pageTitle").textContent = P.title;
    $("#periodWrap").hidden = !P.period || !D;
    if (D) {
      $("#pageEyebrow").textContent = P.eyebrow();
      document.title = `${P.title} · ${D.company}`;
    }
    renderCurrent();
    window.scrollTo({ top: 0 });
  }

  /* ---------------- Sumber data: live API + cadangan snapshot ---------------- */
  let syncState = "loading", lastSync = null, lastError = "", loadingNow = false;

  function updateStatus() {
    const pill = $("#syncPill"), label = pill.querySelector("span");
    pill.dataset.state = syncState;
    const time = lastSync ? lastSync.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
    const text = {
      loading: "Sinkron…",
      live: `Live · ${time}`,
      stale: "Gagal sinkron",
      snapshot: "Snapshot",
    }[syncState];
    label.textContent = text;
    pill.title = {
      loading: "Mengambil data terbaru dari Google Sheet",
      live: `Data langsung dari Google Sheet, sinkron ${time}. Diperbarui otomatis tiap ${CFG.refreshMinutes} menit.`,
      stale: `Tidak bisa menghubungi API (${lastError}). Menampilkan data terakhir yang berhasil dimuat.`,
      snapshot: LIVE
        ? `API tidak bisa dihubungi (${lastError}). Menampilkan snapshot ${window.GIS_DATA ? window.GIS_DATA.updatedAt : ""}.`
        : "API belum diatur di assets/js/config.js — menampilkan snapshot statis.",
    }[syncState];
    $("#refreshBtn").classList.toggle("spin", syncState === "loading");
    $("#navGaji").hidden = !canPayroll() || !D;
    $("#navInput").hidden = !canInput() || !D;
    $("#navDb").hidden = !D;
    const ub = $("#userBtn"), who = session && session.user;
    ub.hidden = !who || !D;
    if (who) {
      $("#userName").textContent = who.name;
      $("#userAvatar").textContent = String(who.name).slice(0, 2);
      ub.title = `Masuk sebagai ${who.label || who.name} — klik untuk keluar`;
    }
    if (D) {
      $("#sourceTitle").textContent = syncState === "live" ? "Google Sheet · Live" : "Google Sheet · Snapshot";
      $("#updatedAt").textContent = `Data per ${D.updatedAt}`;
      if (D.sourceUrl) $("#sourceLink").href = D.sourceUrl;
      document.querySelector(".source .dot").dataset.state = syncState;
    }
  }

  function refreshControls() {
    const sel = $("#periodSelect");
    sel.innerHTML =
      `<option value="ytd">Semua bulan · ${ytd.name}</option>` +
      months.map((m) => `<option value="${m.key}">${m.name} ${D.year}${m.status === "running" ? " (berjalan)" : ""}</option>`).join("");
    sel.value = plPeriod;
  }

  function callGas(fn, ...args) {
    if (GAS) {
      return new Promise((resolve, reject) => {
        GAS.withSuccessHandler((text) => {
          try { resolve(typeof text === "string" ? JSON.parse(text) : text); } catch (e) { reject(e); }
        }).withFailureHandler((err) => reject(new Error((err && err.message) || "Tidak bisa menghubungi server")))[fn](...args);
      });
    }
    // Hosting statis: POST text/plain (tanpa preflight) ke URL Apps Script
    return fetch(CFG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ fn, args }),
      cache: "no-store",
    }).then((r) => {
      if (!r.ok) throw new Error("Server error " + r.status);
      return r.json();
    }).catch(() => { throw new Error("Tidak bisa menghubungi server"); });
  }

  async function fetchGas() {
    const json = await callGas("getDashboardData", session && session.token, true);
    if (json && json.error === "auth") { const err = new Error("Sesi berakhir"); err.auth = true; throw err; }
    if (json && json.error) throw new Error(json.error);
    return json;
  }

  async function fetchLive() {
    if (SERVER) return fetchGas();
    const params = new URLSearchParams({ t: Date.now() });
    if (CFG.token) params.set("token", CFG.token);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${CFG.apiUrl}${CFG.apiUrl.includes("?") ? "&" : "?"}${params}`, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (!Array.isArray(json.months) || !json.months.length) throw new Error("format data tidak dikenal");
      return json;
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "timeout" : e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  async function load() {
    if (loadingNow) return;
    loadingNow = true;
    const hadData = !!D;
    if (NEED_LOGIN && !session) {
      loadingNow = false;
      showLogin();
      return;
    }
    if (LIVE) {
      syncState = "loading";
      updateStatus();
      try {
        setData(await fetchLive());
        syncState = "live";
        lastSync = new Date();
      } catch (e) {
        if (e.auth) {
          loadingNow = false;
          logout("Sesi Anda sudah berakhir. Silakan masuk lagi.");
          return;
        }
        console.warn("[GIS] gagal sinkron:", e.message);
        lastError = e.message;
        if (!hadData && window.GIS_DATA) setData(window.GIS_DATA);
        if (!D) {
          loadingNow = false;
          $("#loading").innerHTML = `<span>Gagal memuat data: ${esc(e.message)}. Coba muat ulang halaman.</span>`;
          syncState = "stale";
          updateStatus();
          return;
        }
        syncState = hadData && D !== window.GIS_DATA ? "stale" : "snapshot";
      }
    } else {
      setData(window.GIS_DATA);
      syncState = "snapshot";
    }
    loadingNow = false;
    finishLoad(hadData);
  }

  function finishLoad(hadData) {
    $("#loading").hidden = true;
    refreshControls();
    updateStatus();
    if (!hadData) go();
    else { $("#pageEyebrow").textContent = PAGES[current].eyebrow(); renderCurrent(); }
  }

  /* ---------------- Login ---------------- */
  const sha256Hex = async (text) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  function setAuthError(msg, info) {
    const el = $("#authError");
    el.textContent = msg || "";
    el.hidden = !msg;
    el.classList.toggle("info", !!info);
    $("#authPass").setAttribute("aria-invalid", msg && !info ? "true" : "false");
  }

  function showLogin(msg, info) {
    document.body.classList.add("locked");
    document.querySelectorAll(".page").forEach((s) => (s.hidden = true));
    $("#loading").hidden = true;
    $("#periodWrap").hidden = true;
    $("#auth").hidden = false;
    setAuthError(msg, info);
    updateStatus();
    const chosen = document.querySelector('input[name="who"]:checked');
    setTimeout(() => (chosen ? $("#authPass") : document.querySelector('input[name="who"]')).focus(), 60);
  }

  function unlock() {
    document.body.classList.remove("locked");
    $("#auth").hidden = true;
    $("#authPass").value = "";
    setAuthError("");
  }

  async function submitLogin(e) {
    e.preventDefault();
    const picked = document.querySelector('input[name="who"]:checked');
    const u = picked ? picked.value : "";
    const p = $("#authPass").value.trim(); // spasi di awal/akhir diabaikan
    const card = $("#authForm"), btn = $("#authSubmit");
    const fail = (msg) => {
      setAuthError(msg);
      card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
    };
    if (!u) return fail("Pilih dulu: BOD atau STAFF.");
    if (!p) return fail("Password wajib diisi.");
    btn.disabled = true; btn.classList.add("busy"); setAuthError("");
    try {
      if (SERVER) {
        // dicek di server; data hanya dikirim bila login benar
        const res = await callGas("login", u, p);
        if (res.error) throw new Error(res.error);
        saveSession({ token: res.token, user: res.user });
        setData(res.data);
        syncState = "live";
        lastSync = new Date();
        unlock();
        finishLoad(false);
      } else {
        const h = await sha256Hex(`${CFG.authSalt || "gis-dash-v1"}:${p}`);
        const found = (CFG.users || []).find((x) => String(x.username).toUpperCase() === u && x.hash === h);
        if (!found) throw new Error("Username atau password salah.");
        saveSession({ token: null, user: { name: u, label: found.label || u, payroll: !!found.payroll, input: !!found.input } });
        unlock();
        load();
      }
    } catch (err) {
      fail(err.message);
      $("#authPass").select();
    } finally {
      btn.disabled = false; btn.classList.remove("busy");
    }
  }

  function logout(msg, info) {
    closeEdit();
    if (SERVER && session && session.token) callGas("logout", session.token).catch(() => {});
    saveSession(null);
    D = null;
    payroll = null;
    payrollError = "";
    inputOpts = null; inputErr = ""; people = null; peopleErr = "";
    Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; });
    syncState = "loading";
    lastSync = null;
    showLogin(msg, info);
  }

  function initControls() {
    const sel = $("#periodSelect");
    sel.addEventListener("change", () => { plPeriod = sel.value; renderCurrent(); });

    $("#monthChips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (b) { sumKey = b.dataset.key; renderSummary(); }
    });
    $("#sumTable").addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-key]");
      if (tr) { sumKey = tr.dataset.key; renderSummary(); $("#monthChips").scrollIntoView({ behavior: "smooth", block: "center" }); }
    });

    $("#refreshBtn").addEventListener("click", () => {
      payroll = null; payrollError = ""; people = null; peopleErr = ""; inputOpts = null; inputErr = "";
      load();
    });

    // Database peserta
    let qTimer;
    $("#dbSearch").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { db.q = e.target.value; db.limit = 60; renderDb(); }, 150);
    });
    [["dbProgram", "program"], ["dbMonth", "month"], ["dbSource", "source"], ["dbSort", "sort"]].forEach(([id, k]) =>
      $("#" + id).addEventListener("change", (e) => { db[k] = e.target.value; db.limit = 60; renderDb(); }));
    $("#dbTable").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const k = th.dataset.sort, [ck, cd] = db.sort.split("-");
      db.sort = `${k}-${ck === k ? (cd === "asc" ? "desc" : "asc") : k === "month" || k === "fee" ? "desc" : "asc"}`;
      renderDb();
    });
    $("#dbMore").addEventListener("click", () => { db.limit += 100; renderDb(); });
    $("#dbTable").addEventListener("click", (e) => {
      const b = e.target.closest(".row-edit");
      if (b) openEdit(b.dataset.id);
      const d = e.target.closest(".row-del");
      if (d) deleteParticipant(d.dataset.id);
    });

    // Edit peserta
    $("#edForm").addEventListener("submit", submitEdit);
    $("#edClose").addEventListener("click", closeEdit);
    $("#edCancel").addEventListener("click", closeEdit);
    $("#edPayOff").addEventListener("click", payOff);
    $("#edModal").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) closeEdit(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEdit(); });
    $("#edStatus").addEventListener("change", () => { edStatusTouched = true; });
    document.querySelectorAll("#edForm .money").forEach((el) => el.addEventListener("input", () => {
      const n = money(el);
      el.value = n ? nf.format(n) : "";
      updateEditSummary(true);
    }));

    // Input peserta
    $("#inForm").addEventListener("submit", submitInput);
    $("#inMonth").addEventListener("change", () => fillBlocks(true));
    $("#inBlock").addEventListener("change", () => onBlockChange(true));
    $("#inStatus").addEventListener("change", () => { statusTouched = true; });
    document.querySelectorAll("#inForm .money").forEach((el) => el.addEventListener("input", () => {
      const n = money(el);
      el.value = n ? nf.format(n) : "";
      updateInputSummary();
    }));
    ["inName", "inTglDp", "inTglLunas"].forEach((id) => $("#" + id).addEventListener("input", updateInputSummary));
    $("#authForm").addEventListener("submit", submitLogin);
    $("#pwToggle").addEventListener("click", () => {
      const i = $("#authPass"), show = i.type === "password";
      i.type = show ? "text" : "password";
      $("#pwToggle").setAttribute("aria-pressed", String(show));
      $("#pwToggle").setAttribute("aria-label", show ? "Sembunyikan password" : "Tampilkan password");
      i.focus();
    });
    $("#userBtn").addEventListener("click", () => logout("Anda sudah keluar.", true));
    // pilihan akun: ingat pilihan terakhir, lalu fokus ke password
    try {
      const last = localStorage.getItem("gis-who");
      const r = last && document.querySelector(`input[name="who"][value="${last}"]`);
      if (r) r.checked = true;
    } catch (e) { /* abaikan */ }
    document.querySelectorAll('input[name="who"]').forEach((r) =>
      r.addEventListener("change", () => {
        try { localStorage.setItem("gis-who", r.value); } catch (e) { /* abaikan */ }
        setAuthError("");
        $("#authPass").focus();
      }));
    const caps = (e) => { $("#capsHint").hidden = !(e.getModifierState && e.getModifierState("CapsLock")); };
    $("#authPass").addEventListener("keydown", caps);
    $("#authPass").addEventListener("keyup", caps);
    document.querySelectorAll("[data-chmode]").forEach((b) =>
      b.addEventListener("click", () => { chMode = b.dataset.chmode; renderDashboard(); }));

    $("#themeToggle").addEventListener("click", () => {
      const root = document.documentElement;
      const isDark = getComputedStyle(root).getPropertyValue("color-scheme").trim() === "dark";
      const next = isDark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("gis-theme", next); } catch (e) {}
      syncThemeButton();
      renderCurrent();
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCurrent);

    window.addEventListener("hashchange", () => go());
    document.querySelectorAll(".nav-item").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const page = a.dataset.page;
        try { history.replaceState(null, "", "#" + page); } catch (err) { /* iframe sandbox */ }
        go(page);
      }));

    // Sinkron otomatis saat tab terlihat
    if (LIVE && CFG.refreshMinutes > 0) {
      setInterval(() => { if (!document.hidden && D) load(); }, CFG.refreshMinutes * 60000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && D && lastSync && Date.now() - lastSync > CFG.refreshMinutes * 60000) load();
      });
    }
  }

  function syncThemeButton() {
    const green = document.documentElement.getAttribute("data-theme") !== "light";
    const b = $("#themeToggle");
    const label = green ? "Ganti ke tema terang" : "Ganti ke tema hijau";
    b.setAttribute("aria-label", label);
    b.title = label;
  }

  initControls();
  syncThemeButton();
  updateStatus();
  load();
})();
