/**
 * DATA LAPORAN KEUANGAN GIS TRAINING 2026
 * Sumber: Google Sheet "LAPORAN KEUANGAN GIS TRAINING"
 * (sheet Februari s/d November, rekap Omzet/GP/OPEX, KPI Q4)
 * Ditarik: 15 November 2026
 *
 * Semua nominal dalam Rupiah (angka bulat).
 * - revenue      : Omzet (total "Biaya Pelatihan")
 * - cogs.*       : Harga pokok per komponen, dijumlah dari baris "Total" tiap program
 * - grossProfit  : Laba kotor setelah biaya trainer (sesuai rekap sheet)
 * - opex         : Biaya operasional (rekap sheet). null = belum tercatat
 * - participants : jumlah peserta per program (dari blok SUMMARY tiap sheet)
 * - programRevenue : omzet per program (dari baris "Total" tiap program)
 * - channels     : kategori peserta (Online/Referral/B2B/Ads). null = tidak dicatat
 * - receivable   : piutang (sisa tagihan) di akhir bulan
 *
 * Untuk menyambungkan ke data live, ganti isi objek ini dengan hasil fetch
 * (mis. Google Sheets API / Apps Script JSON) dengan bentuk yang sama.
 */
window.GIS_DATA = {
  company: "GIS Training",
  year: 2026,
  updatedAt: "15 November 2026",
  sourceUrl:
    "https://docs.google.com/spreadsheets/d/1H_0wjEIel-OnVFmg_eZaQGycpMUT_FMBJy-Y9JrS0-U/edit",

  months: [
    {
      key: "jan", name: "Januari", short: "Jan", status: "closed",
      revenue: 14000000,
      cogs: { lsp: 0, shipping: 0, merchandise: 0, trainer: 0 },
      grossProfit: 14000000, opex: 0,
      participants: null, programRevenue: null, channels: null, receivable: null,
      note: "Tidak ada sheet rincian; angka diambil dari tabel rekap.",
    },
    {
      key: "feb", name: "Februari", short: "Feb", status: "closed",
      revenue: 15700000,
      cogs: { lsp: 4800000, shipping: 122000, merchandise: 650000, trainer: 5000000 },
      grossProfit: 5128000, opex: 0,
      participants: { POP: 3, P3K: 2 },
      programRevenue: { POP: 9900000, P3K: 5800000 },
      channels: null, receivable: null,
    },
    {
      key: "mar", name: "Maret", short: "Mar", status: "closed",
      revenue: 10300000,
      cogs: { lsp: 3000000, shipping: 227100, merchandise: 390000, trainer: 3000000 },
      grossProfit: 3682900, opex: 0,
      participants: { POP: 3 },
      programRevenue: { POP: 10300000 },
      channels: null, receivable: null,
    },
    {
      key: "apr", name: "April", short: "Apr", status: "closed",
      revenue: 65500000,
      cogs: { lsp: 20000000, shipping: 61000, merchandise: 3000000, trainer: 5000000 },
      grossProfit: 37439000, opex: 15573128,
      participants: { POP: 17, AK3U: 3, TOT: 12, "Perpanjangan POP": 1 },
      programRevenue: { POP: 53500000, AK3U: 5500000, TOT: 4500000, "Perpanjangan POP": 2000000 },
      channels: { Online: 14, Referral: 19, B2B: 0, Ads: 0 },
      receivable: null,
    },
    {
      key: "mei", name: "Mei", short: "Mei", status: "closed",
      revenue: 87396000,
      cogs: { lsp: 28800000, shipping: 1529500, merchandise: 4650000, trainer: 6000000 },
      grossProfit: 46416500, opex: 14071369,
      participants: { POP: 16, AK3U: 9, POM: 3, "Pra POP": 2 },
      programRevenue: { POP: 50697000, AK3U: 22799000, POM: 12900000, "Pra POP": 1000000 },
      channels: { Online: 21, Referral: 5, B2B: 4, Ads: 0 },
      receivable: null,
    },
    {
      key: "jun", name: "Juni", short: "Jun", status: "closed",
      revenue: 104029999,
      cogs: { lsp: 33500000, shipping: 1082000, merchandise: 4840000, trainer: 10000000 },
      grossProfit: 54607999, opex: 15606000,
      participants: { POP: 20, AK3U: 8, POM: 7, "Perpanjangan POP": 1, "Pra POP": 3 },
      programRevenue: { POP: 51186000, AK3U: 17544999, POM: 31299000, "Perpanjangan POP": 2500000, "Pra POP": 1500000 },
      channels: { Online: 26, Referral: 1, B2B: 12, Ads: 0 },
      receivable: 2496000,
    },
    {
      key: "jul", name: "Juli", short: "Jul", status: "closed",
      revenue: 116144910,
      cogs: { lsp: 45000000, shipping: 2347500, merchandise: 6750000, trainer: 4000000 },
      grossProfit: 60513410, opex: 22287015,
      participants: { POP: 22, AK3U: 22, "Perpanjangan POP": 1, "Pra POP": 1 },
      programRevenue: { POP: 68292910, AK3U: 44852000, "Perpanjangan POP": 2500000, "Pra POP": 500000 },
      channels: { Online: 40, Referral: 3, B2B: 1, Ads: 2 },
      receivable: 657001,
    },
    {
      key: "agu", name: "Agustus", short: "Agu", status: "closed",
      revenue: 139249000,
      cogs: { lsp: 54000000, shipping: 3439000, merchandise: 8100000, trainer: 9700000 },
      grossProfit: 64010000, opex: 27439829,
      participants: { POP: 24, AK3U: 27, "Perpanjangan POP": 2, POU: 1, "Pra POP": 1 },
      programRevenue: { POP: 72677000, AK3U: 54573000, "Perpanjangan POP": 5000000, POU: 6499000, "Pra POP": 500000 },
      channels: { Online: 41, Referral: 8, B2B: 1, Ads: 5 },
      receivable: 3764461,
    },
    {
      key: "sep", name: "September", short: "Sep", status: "closed",
      revenue: 191707459,
      cogs: { lsp: 71500000, shipping: 4830000, merchandise: 10900000, trainer: 12700000 },
      grossProfit: 91777459, opex: 33922850,
      participants: { POP: 30, AK3U: 27, POM: 7, POU: 2, "Perpanjangan POP": 2, "Perpanjangan AK3U": 1 },
      programRevenue: { POP: 94084459, AK3U: 54824000, POM: 28998000, POU: 12300000, "Perpanjangan POP": 5000000, "Perpanjangan AK3U": 1500000 },
      channels: { Online: 40, Referral: 9, B2B: 12, Ads: 8 },
      receivable: 9528604,
    },
    {
      key: "okt", name: "Oktober", short: "Okt", status: "closed",
      revenue: 251631000,
      cogs: { lsp: 88250000, shipping: 5740000, merchandise: 12750000, trainer: 12000000 },
      grossProfit: 132891000, opex: 37678052,
      participants: { POP: 40, AK3U: 34, POM: 5, POU: 2, TOT: 3, "Pra POP": 2, "Perpanjangan POP": 2, "Perpanjangan POM": 2, "Perpanjangan AK3U": 1 },
      programRevenue: { POP: 124061000, AK3U: 72175000, POM: 20296000, POU: 11999000, TOT: 9600000, "Pra POP": 1000000, "Perpanjangan POP": 5000000, "Perpanjangan POM": 6000000, "Perpanjangan AK3U": 1500000 },
      channels: { Online: 44, Referral: 36, B2B: 2, Ads: 9 },
      receivable: 31277000,
    },
    {
      key: "nov", name: "November", short: "Nov", status: "running",
      revenue: 74885000,
      cogs: { lsp: 16200000, shipping: 1190000, merchandise: 2550000, trainer: 0 },
      grossProfit: 46329000, opex: null,
      participants: { POP: 16, AK3U: 4, POU: 3, TOT: 1, "Perpanjangan POP": 2, "Perpanjangan AK3U": 1 },
      programRevenue: { POP: 60288000, AK3U: 8597000, "Perpanjangan POP": 4500000, "Perpanjangan AK3U": 1500000 },
      channels: { Online: 14, Referral: 5, B2B: 7, Ads: 1 },
      receivable: 7703000,
      note: "Bulan berjalan (data s/d 15 Nov). OPEX belum tercatat.",
    },
  ],

  /** Posisi kas & piutang per 31 Oktober 2026 (blok "Duit Akhir Bulan" di sheet Oktober) */
  balance: {
    asOf: "31 Oktober 2026",
    cashAccounts: [
      { name: "Kas / Rekening utama", amount: 26490000 },
      { name: "Rekening 2", amount: 7098000 },
      { name: "Rekening 3", amount: 15995000 },
    ],
    receivable: 31277000,
    liabilities: [], // belum ada pencatatan utang di sheet
  },

  kpiQ4: {
    targetOptimistic: 250,
    targetRealistic: 200,
    months: [
      { name: "Oktober", value: 91 },
      { name: "November", value: 27, running: true },
      { name: "Desember", value: 0 },
    ],
  },

  /** Hal yang ditemukan saat membaca sheet - tampil di Dashboard */
  dataNotes: [
    "Rekap \"Nett Profit\" April tertulis -Rp27.634.128; hasil Gross Profit − OPEX seharusnya Rp21.865.872. Dashboard memakai hasil hitung ulang.",
    "Nett Profit Juni, Juli, Agustus, dan September di rekap juga tidak sama dengan Gross Profit − OPEX (selisih Rp83 rb s/d Rp5,8 jt).",
    "Omzet September: blok SUMMARY sheet September Rp196.706.459, tabel rekap Rp191.707.459. Dashboard memakai angka rekap.",
    "Baris \"Oktober\" di rekap sheet November berisi angka November (Rp74,9 jt). Angka Oktober yang benar Rp251,6 jt.",
    "Juli: rincian HPP per komponen selisih Rp2,47 jt dari rekap; ditampilkan sebagai baris \"Penyesuaian\".",
  ],
};
