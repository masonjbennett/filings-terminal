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
// Which tag defines the CALENDAR — how many columns the sheet has and what each is dated. This is
// not the same question pickFact answers, and the obvious rules are both wrong:
//
//   "first tag that yields anything" — Lincoln National files
//   RevenueFromContractWithCustomerExcludingAssessedTax exactly once, for 2018, because only a
//   $1.3bn slice of its revenue is in ASC 606 scope. The whole terminal rendered as one 2018 column.
//
//   "tag with the most years" — Equinix tags `Revenues` from 2013 to 2020 and
//   RevenueFromContractWithCustomer from 2019 on. Counting years picks the DEAD tag and renders
//   FY2013-FY2020, five years stale, in 2026.
//
// So: find the newest annual period any candidate tag reaches, keep only the tags that reach it
// (within a year, since fiscal ends drift), and among those take the one with the most years. Recent
// first, then deep. Every failure here produces a sheet that looks entirely healthy and is simply
// about the wrong years, which is why it gets two passes instead of a short-circuit.
export function annualPeriods(facts, tags, limit = 8) {
  const calendars = [];
  for (const tag of tags) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    const found = new Map();
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
      if (!found.has(f.end)) found.set(f.end, { end: f.end, start: f.start, fy: Number(f.end.slice(0, 4)) });
    }
    if (found.size) calendars.push(found);
  }
  if (!calendars.length) return [];
  const newestOf = m => [...m.keys()].sort().pop();
  const newest = calendars.map(newestOf).sort().pop();
  const current = calendars.filter(m => Math.abs(days(newestOf(m), newest)) <= ANNUAL_MAX);
  const best = current.reduce((a, b) => (b.size > a.size ? b : a));
  return [...best.values()].sort((a, b) => b.end.localeCompare(a.end)).slice(0, limit);
}

// Some facts are "as of the latest filing", not "as of a fiscal period". The cover-page share
// count is the one that matters: its date is the COVER date — 2025-10-17 for a year ending
// 2025-09-27 — so matching it against period ends finds nothing, ever. That silently emptied book
// value per share, tangible book, market cap and every multiple built on them. Take the newest.
export function latestFact(facts, tags) {
  let best = null;
  for (const tag of tags || []) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    for (const f of all) if (!best || f.end > best.end) best = { ...f, tag };
  }
  return best ? { value: best.val, unit: best.unit, tag: best.tag, accn: best.accn, form: best.form, filed: best.filed, end: best.end, status: "reported" }
              : { value: null, status: "never-tagged" };
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

// The corporate three-way debt sum, with one guard: the CURRENT PORTION of long-term debt cannot
// be the whole of a company's debt, because the name says there is a long-term balance behind it.
// When that balance did not resolve, the tag is missing rather than zero, and reporting the stub as
// the total is the Progressive "Total debt 0" failure in a quieter register — Equinix printed
// $1.3bn against $33.8bn of real estate, a 4% debt load for one of the most leveraged names in the
// sector. Shared by every industry override, because each one falls back to exactly this.
const corpDebt = v => (v.ltdCur != null && v.ltDebt == null ? null : sum(v.stDebt, v.ltdCur, v.ltDebt));

// Deriving a missing EBIT as revenue − CostsAndExpenses was tried and REMOVED. It looks like the
// operating subtotal and is not one: `CostsAndExpenses` is "total costs and expenses", which for
// most filers includes interest, so the difference is pre-tax income. Welltower derived to MINUS
// $480m and Arthur J. Gallagher to its pre-tax figure — and a wrong EBIT does not stay put, it
// propagates into EBITDA, three margins, NOPAT, ROIC and EV/EBITDA. A filer that never tags
// OperatingIncomeLoss now shows a blank EBIT and a blank EBITDA, which is the true answer.
export const DERIVED = {
  // EBIT is required, not summed. `sum` treats a missing input as zero, so a filer that tagged D&A
  // but no operating income reported its D&A AS its EBITDA: VICI Properties printed EBITDA of $4m
  // against $4.0bn of revenue, and Net debt/EBITDA came out at 4,041x. Its leases are sales-type,
  // so it genuinely has almost no depreciation — the $4m was real, the label on it was not. A
  // missing D&A still yields EBIT, which understates rather than fabricates, so only EBIT is hard.
  ebitda: v => (v.ebit == null ? null : v.ebit + (v.da || 0)),
  ebitdaSbc: v => (v.ebitda == null ? null : v.ebitda - (v.sbc || 0)),
  grossMargin: v => div(v.grossProfit, v.revenue),
  ebitdaMargin: v => div(v.ebitda, v.revenue),
  ebitMargin: v => div(v.ebit, v.revenue),
  netMargin: v => div(v.netIncome, v.revenue),
  fcf: v => (v.cfo == null ? null : v.cfo - (v.capex || 0)),
  fcfMargin: v => div(v.fcf, v.revenue),
  fcfConv: v => div(v.fcf, v.netIncome),
  taxRate: v => div(v.tax, v.pretax),
  // The CURRENT PORTION of long-term debt cannot be the whole of a company's debt: the name says
  // there is a long-term balance behind it. When that is all that resolved, the long-term tag is
  // missing rather than zero, and reporting the stub as the total is the Progressive failure in a
  // quieter register — Equinix printed $1.3bn against $33.8bn of real estate, a 3.8% debt load for
  // one of the most leveraged names in the sector. Blank instead.
  totalDebt: v => corpDebt(v),
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

// Bank-only derivations. Kept separate so they only run for a depository — computing an efficiency
// ratio for Apple would produce a number, and a number that means nothing is worse than a blank.
export const DERIVED_BANK = {
  nii: v => (v.nii != null ? v.nii : v.intIncTotal == null ? null : v.intIncTotal - (v.intExpTotal || 0)),
  totalRevenueBank: v => sum(v.nii, v.noninterestIncome),
  efficiency: v => div(v.noninterestExpense, sum(v.nii, v.noninterestIncome)),
  niiOnAssets: v => div(v.nii, v.totalAssets),
  loansToDeposits: v => div(v.loans, v.deposits),
  loansGross: v => sum(v.loans, v.allowance),
  allowanceToLoans: v => div(v.allowance, sum(v.loans, v.allowance)),
  provisionToLoans: v => div(v.provision, sum(v.loans, v.allowance)),
  depositsToAssets: v => div(v.deposits, v.totalAssets),
  equityToAssets: v => div(v.equity, v.totalAssets),
};

// ── Insurance ──────────────────────────────────────────────────────────────────────────────────
// Three carriers, three different arithmetic sets, because they are three different businesses.
//
// The rule that shapes all of them: a ratio whose denominator is complete but whose NUMERATOR is
// only partly there must return null, not a number. `sum()` treats a missing input as zero, which
// is right for adding up debt-like items and catastrophic here — an expense ratio built from
// acquisition costs alone, with the other-underwriting half never tagged, would print about 12%
// and drag a combined ratio 20 points below the truth. Every combined-ratio input is therefore
// tested for null explicitly before the division happens. Failing to a blank is recoverable;
// failing to a plausible wrong number is not.
const all = (...xs) => xs.every(x => x != null);

// Total incurred losses on the SAME scope as the premium line above it — see the lifeBenefits note
// in the template. lifeBenefits is added as an optional zero rather than required, because for a
// monoline P&C carrier it is correctly absent, and requiring it would blank the combined ratio for
// every filer the ratio is most reliable for.
const pcLosses = v => (v.lossesIncurred == null ? null : v.lossesIncurred + (v.lifeBenefits || 0));

// Overrides DERIVED.totalDebt for every carrier type, and must therefore keep the same key: the
// merge is `{...DERIVED, ...DERIVED_PC}`, so the entry stays in DERIVED's insertion slot and still
// runs before netDebt, debtEquity and debtCap read it. See the debtAllIn note in the template —
// where a filer publishes one all-in figure the three-way corporate sum is not merely incomplete,
// it can resolve to a confident zero.
const carrierDebt = v => (v.debtAllIn != null ? v.debtAllIn : corpDebt(v));

export const DERIVED_PC = {
  totalDebt: carrierDebt,
  lossesTotal: pcLosses,
  lossRatio: v => div(pcLosses(v), v.npe),
  expenseRatio: v => (all(v.dacAmort, v.otherUwExp) ? div(v.dacAmort + v.otherUwExp, v.npe) : null),
  combinedRatio: v => (all(pcLosses(v), v.dacAmort, v.otherUwExp, v.npe) && v.npe !== 0
    ? (pcLosses(v) + v.dacAmort + v.otherUwExp) / v.npe : null),
  uwProfit: v => (all(pcLosses(v), v.npe, v.dacAmort, v.otherUwExp)
    ? v.npe - pcLosses(v) - v.dacAmort - v.otherUwExp : null),
  pyDevRatio: v => div(v.pyDevelopment, v.npe),
  // Float is reserves NET of reinsurance plus unearned premium, less what has been paid away as
  // acquisition cost. The net reserve figure has to be KNOWN, not assumed: Allstate and Cincinnati
  // both stop filing any reinsurance-recoverable tag in recent years, and treating an unknown
  // recoverable as zero silently overstated Allstate's float by billions. Falling back to
  // gross-minus-recoverable only when the recoverable is itself present keeps it honest, and a
  // blank float is a far better answer than a confident wrong one for the metric Berkshire made
  // famous. DAC stays optional — a carrier that expenses acquisition costs as incurred has none.
  float: v => {
    const net = v.lossReservesNet != null ? v.lossReservesNet
      : all(v.lossReserves, v.reinsRecov) ? v.lossReserves - v.reinsRecov : null;
    return all(net, v.unearnedPrem) ? net + v.unearnedPrem - (v.dac || 0) : null;
  },
  premiumLeverage: v => div(v.npw, v.equity),
  reserveLeverage: v => div(v.lossReserves, v.equity),
  cededRatio: v => (all(v.cededPrem, v.npe) ? div(v.cededPrem, v.cededPrem + v.npe) : null),
  investmentYield: v => div(v.invIncome, v.investments),
};

export const DERIVED_LIFE = {
  totalDebt: carrierDebt,
  benefitRatio: v => div(v.benefits, v.premiums),
  creditingRate: v => div(v.interestCredited, v.policyholderAccounts),
  investmentYield: v => div(v.invIncome, v.investments),
  policyReserves: v => sum(v.futurePolicyBenefits, v.policyholderAccounts),
  reserveLeverage: v => div(sum(v.futurePolicyBenefits, v.policyholderAccounts), v.equity),
  // AOCI is subtracted, not sum()'d, and the null check is on EQUITY only: a carrier with no AOCI
  // balance legitimately has none, and treating that as a missing input would blank the line for
  // exactly the filers whose book value needs no adjustment.
  bvpsExAoci: v => (v.equity == null ? null : div(v.equity - (v.aoci || 0), v.sharesOut)),
};

export const DERIVED_HEALTH = {
  totalDebt: carrierDebt,
  mlr: v => div(v.medicalCosts, v.premiums),
  healthSgaRatio: v => div(v.sga, v.revenue),
  daysClaimsPayable: v => (div(v.medicalClaimsPayable, v.medicalCosts) == null ? null
    : div(v.medicalClaimsPayable, v.medicalCosts) * 365),
  premiumMix: v => div(v.premiums, v.revenue),
};

// FFO needs net income to common and D&A. The gain and impairment adjustments are genuinely
// optional — a REIT that sold nothing and impaired nothing has neither — but that asymmetry is
// what lets an untagged gain through, and stripping property gains is the entire job of the
// measure. So there is a consistency check: if no gain is tagged AND net income to common exceeds
// operating income, then material non-operating gains demonstrably exist and demonstrably were not
// removed. Simon Property reported $4.6bn of net income on $3.2bn of operating income and tags no
// property gain at all — FFO came out at $18.54 a share against the ~$13 Simon reports, and
// nothing on the row would have said so. Blank is the honest answer to "we know we missed some".
// Realty Income also earns more than its operating income, but tags its gain, so it is unaffected.
const reitFfo = v => {
  if (v.niToCommon == null || v.da == null) return null;
  if (v.gainOnPropertySale == null && v.ebit != null && v.niToCommon > v.ebit) return null;
  return v.niToCommon + v.da - (v.gainOnPropertySale || 0) + (v.reImpairment || 0);
};

export const DERIVED_REIT = {
  // Same all-in-debt override as the carriers, different tag names. See reitDebt in the template.
  totalDebt: v => (v.reitDebt != null ? v.reitDebt : corpDebt(v)),
  noi: v => (all(v.rentalRevenue, v.propOpex) ? v.rentalRevenue - v.propOpex : null),
  noiMargin: v => (all(v.rentalRevenue, v.propOpex) ? div(v.rentalRevenue - v.propOpex, v.rentalRevenue) : null),
  ffo: reitFfo,
  ffoPerShare: v => div(reitFfo(v), v.wasoDil),
  ffoPayout: v => div(v.dividends, reitFfo(v)),
  reNet: v => (all(v.reGross, v.reAccumDep) ? v.reGross - v.reAccumDep : null),
  debtToGrossRE: v => div(v.reitDebt != null ? v.reitDebt : v.totalDebt, v.reGross),
  accumDepPct: v => div(v.reAccumDep, v.reGross),
};

// Which extra derivations run for which filer type. A lookup rather than a chain of ternaries in
// the component, so adding a set is one line here and nothing in App.
export const DERIVED_BY_INDUSTRY = {
  bank: DERIVED_BANK, pc: DERIVED_PC, life: DERIVED_LIFE, health: DERIVED_HEALTH, reit: DERIVED_REIT,
};

// Year-over-year lines need the column beside them, so they are computed after the grid is built.
export const YOY = {
  revGrowth: "revenue", ebitdaGrowth: "ebitda", epsGrowth: "epsDil",
};
