// The selection engine. Everything correct or wrong about the numbers happens here.
//
// Four rules, each one learned by probing real filings rather than assumed:
//
// 1. PERIOD SHAPE. Income-statement and cash-flow facts are DURATIONS; balance-sheet facts are
//    INSTANTS. A 10-Q files both discrete-quarter and year-to-date spans for the same tag, so a
//    line must be chosen by how long its period is, not by taking whatever turns up first. Ignore
//    this and EBITDA silently comes out as nine months against a full-year balance sheet.
// 2. LATEST FILED WINS. Seven of Apple's nine annual revenue periods appear in more than one
//    filing, because each 10-K restates the two prior years as comparatives. Picking the first
//    match returns a stale comparative; picking the newest `filed` date returns the figure the
//    company stands behind today, restatements included.
// 3. TAG FALLBACKS ARE ORDERED. Filers tag the same economic line differently — revenue alone has
//    four common spellings. First tag that yields a value wins, and which one it was is recorded so
//    the sheet can show it.
// 4. A BLANK IS NOT ONE THING. "The filer has no such item", "reported inside another line" and
//    "disclosed but untagged" are different answers and only the last is worth hunting by hand.

export const ANNUAL_MIN = 300, ANNUAL_MAX = 400;   // a "year" in filings runs 52-53 weeks
export const QUARTER_MIN = 80, QUARTER_MAX = 100;

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const isDuration = f => !!f.start;

// All facts for one tag, flattened across units, with the unit carried along.
function factsFor(facts, tag) {
  const def = facts[tag];
  if (!def) return null;                      // filer has never used this tag at all
  const out = [];
  for (const [unit, arr] of Object.entries(def.units || {})) for (const f of arr) out.push({ ...f, unit });
  return out;
}

// Pick the single best fact for a template line in a given period.
// `period` is { end, start } for durations, or { end } for instants.
export function pickFact(facts, tags, period, opts = {}) {
  const wantDuration = !!period.start;
  const minD = opts.minDays ?? ANNUAL_MIN, maxD = opts.maxDays ?? ANNUAL_MAX;
  let sawTag = false, sawTagOtherPeriod = false;

  for (const tag of tags || []) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    sawTag = true;
    const matches = all.filter(f => {
      if (wantDuration !== isDuration(f)) return false;
      if (f.end !== period.end) return false;
      if (!wantDuration) return true;
      const d = days(f.start, f.end);
      return d >= minD && d <= maxD;
    });
    if (!matches.length) { if (all.length) sawTagOtherPeriod = true; continue; }
    // Rule 2 — newest filing wins, and among equals prefer the annual report over an 8-K exhibit.
    matches.sort((a, b) => (b.filed || "").localeCompare(a.filed || "") || rank(b.form) - rank(a.form));
    const f = matches[0];
    return { value: f.val, unit: f.unit, tag, accn: f.accn, form: f.form, filed: f.filed, end: f.end, start: f.start, status: "reported" };
  }
  // Nothing landed. Which kind of nothing is it?
  return { value: null, status: sawTagOtherPeriod ? "untagged-this-period" : sawTag ? "untagged-this-period" : "never-tagged" };
}
const rank = form => (form === "10-K" ? 3 : form === "10-Q" ? 2 : 1);

// The fiscal years available, newest first, derived from whichever revenue tag the filer uses.
// Built from facts rather than from a calendar because fiscal years are not calendar years — Apple
// ends in late September and a hardcoded Dec-31 assumption would return nothing at all.
export function annualPeriods(facts, tags, limit = 8) {
  const seen = new Map();
  for (const tag of tags) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    for (const f of all) {
      if (!isDuration(f)) continue;
      const d = days(f.start, f.end);
      if (d < ANNUAL_MIN || d > ANNUAL_MAX) continue;
      // The column label comes from the PERIOD END, never from `fy`. `fy` is the fiscal year of the
      // report a fact was filed in, not of the period it covers: the year to Sept-2018 carries
      // fy=2019 and fy=2020 when it reappears as a comparative, and the oldest year in the file may
      // have no original filing left to carry fy=2018 at all — which labelled two adjacent columns
      // "FY2019". The end date is the only thing that identifies a period uniquely, and it is
      // printed under the label so a filer whose own convention differs is never ambiguous.
      if (!seen.has(f.end)) seen.set(f.end, { end: f.end, start: f.start, fy: Number(f.end.slice(0, 4)) });
    }
    if (seen.size) break;                     // first tag that yields a calendar is the filer's own
  }
  return [...seen.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, limit);
}

// Latest year-to-date period in a 10-Q, used to roll an LTM figure forward from the last 10-K.
export function latestYtd(facts, tags) {
  let best = null;
  for (const tag of tags) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    for (const f of all) {
      if (!isDuration(f) || f.form !== "10-Q") continue;
      const d = days(f.start, f.end);
      if (d < 80 || d > 300) continue;
      if (!best || f.end > best.end) best = { end: f.end, start: f.start, days: d, val: f.val, accn: f.accn };
    }
    if (best) break;
  }
  return best;
}

// LTM = full year + this year's YTD − last year's same YTD. The differencing is not optional:
// cash-flow figures in a 10-Q are CUMULATIVE from the fiscal year start, so adding a Q3 number to a
// full year would double-count nine months of it.
export function ltm(facts, tags) {
  const ytd = latestYtd(facts, tags);
  if (!ytd) return null;
  const all = factsFor(facts, tags.find(t => facts[t])) || [];
  const priorYtd = all.find(f => isDuration(f) && Math.abs(days(f.start, f.end) - ytd.days) <= 6 &&
    Math.abs(days(f.end, ytd.end) - 365) <= 20);
  const periods = annualPeriods(facts, tags, 1);
  if (!periods.length || !priorYtd) return null;
  const fy = pickFact(facts, tags, periods[0]);
  if (fy.value == null) return null;
  return { value: fy.value + ytd.val - priorYtd.val, through: ytd.end, basis: `FY${periods[0].fy} + YTD to ${ytd.end} − prior-year YTD` };
}

// ── Derived lines ──────────────────────────────────────────────────────────────────────────────
// Deliberately a small explicit table rather than eval of the formula strings in the template:
// those strings are documentation for a human reading the sheet, and turning user-visible text into
// executable code is how a typo becomes a wrong number nobody can trace.
const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const sum = (...xs) => (xs.every(x => x == null) ? null : xs.reduce((n, x) => n + (x || 0), 0));

export const DERIVED = {
  ebitda: v => sum(v.ebit, v.da),
  ebitdaSbc: v => (v.ebitda == null ? null : v.ebitda - (v.sbc || 0)),
  grossMargin: v => div(v.grossProfit, v.revenue),
  ebitdaMargin: v => div(v.ebitda, v.revenue),
  ebitMargin: v => div(v.ebit, v.revenue),
  netMargin: v => div(v.netIncome, v.revenue),
  fcf: v => (v.cfo == null ? null : v.cfo - (v.capex || 0)),
  fcfMargin: v => div(v.fcf, v.revenue),
  fcfConv: v => div(v.fcf, v.netIncome),
  taxRate: v => div(v.tax, v.pretax),
  totalDebt: v => sum(v.stDebt, v.ltdCur, v.ltDebt),
  debtLikeTotal: v => sum(v.olCur, v.olNon, v.flCur, v.flNon, v.pensionUnderfunded, v.deferredComp, v.assetRetirement),
  totalDebtLeases: v => sum(v.totalDebt, v.olCur, v.olNon, v.flCur, v.flNon),
  netDebt: v => (v.totalDebt == null ? null : v.totalDebt - (v.cash || 0) - (v.sti || 0)),
  netLev: v => div(v.netDebt, v.ebitda),
  grossLev: v => div(v.totalDebt, v.ebitda),
  intCover: v => div(v.ebitda, v.intExp),
  fccr: v => (v.ebitda == null ? null : div(v.ebitda - (v.capex || 0), v.intExp)),
  debtEquity: v => div(v.totalDebt, v.equity),
  debtCap: v => div(v.totalDebt, sum(v.totalDebt, v.equity)),
  currentRatio: v => div(v.curAssets, v.curLiab),
  quickRatio: v => (v.curAssets == null ? null : div(v.curAssets - (v.inventory || 0), v.curLiab)),
  nopat: v => (v.ebit == null || v.taxRate == null ? null : v.ebit * (1 - v.taxRate)),
  investedCap: v => (v.totalDebt == null ? null : sum(v.totalDebt, v.equity) - (v.cash || 0)),
  roic: v => div(v.nopat, v.investedCap),
  roe: v => div(v.netIncome, v.equity),
  roa: v => div(v.netIncome, v.totalAssets),
  assetTurn: v => div(v.revenue, v.totalAssets),
  dso: v => (div(v.ar, v.revenue) == null ? null : div(v.ar, v.revenue) * 365),
  dio: v => (div(v.inventory, v.cogs) == null ? null : div(v.inventory, v.cogs) * 365),
  dpo: v => (div(v.ap, v.cogs) == null ? null : div(v.ap, v.cogs) * 365),
  ccc: v => (v.dso == null ? null : v.dso + (v.dio || 0) - (v.dpo || 0)),
  nwc: v => (v.curAssets == null || v.curLiab == null ? null :
    (v.curAssets - (v.cash || 0) - (v.sti || 0)) - (v.curLiab - (v.stDebt || 0) - (v.ltdCur || 0))),
  nwcPctRev: v => div(v.nwc, v.revenue),
  capexPctRev: v => div(v.capex, v.revenue),
  daPctRev: v => div(v.da, v.revenue),
  sbcPctRev: v => div(v.sbc, v.revenue),
  bvps: v => div(v.equity, v.sharesOut),
  tbvps: v => (v.equity == null ? null : div(v.equity - (v.goodwill || 0) - (v.intangibles || 0), v.sharesOut)),
  ufcf: v => (v.nopat == null ? null : v.nopat + (v.da || 0) - (v.capex || 0)),
  cashTaxRate: v => (v.tax == null ? null : div(v.tax - (v.deferredTax || 0), v.pretax)),
};

// Year-over-year lines need the column beside them, so they are computed after the grid is built.
export const YOY = {
  revGrowth: "revenue", ebitdaGrowth: "ebitda", epsGrowth: "epsDil",
};
