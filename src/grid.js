// Turning one company's slimmed payload into the sheet: which sections exist, and one column per
// annual period with every line fetched, derived, blanked and priced.
//
// This lived inside a useMemo in App.jsx until comps needed to build more than one company at a
// time. Moving it out bought a second thing worth more than the feature: the offline harness used to
// carry a hand-written MIRROR of this logic, kept in sync by hand and commented "mirrors App.jsx
// exactly". Every rule in the README is enforced in here, so a mirror that drifted would test rules
// production no longer had — the tests would pass on code that does not ship. There is now one copy
// and both callers import it.

import { SECTIONS, INDUSTRY, NOT_APPLICABLE, OVERLAY_SECTIONS, PERIOD_TAGS, PERIOD_TAGS_FALLBACK } from "./template.js";
import { annualPeriods, pickFact, latestFact, ltmWindows, pickLtm, reportingCurrency, tagsByRun, hasInterim, debtScope, dupCurrentDebt, thinEquity, DERIVED, DERIVED_BY_INDUSTRY, YOY, CAGRS } from "./extract.js";

// Balance-sheet style lines are INSTANTS (a value at a date); income and cash-flow lines are
// DURATIONS (a value over a span). Getting this wrong is how a full-year balance sheet ends up
// beside nine months of earnings, so it is declared rather than guessed.
// A section declares its own period shape via `instant: true`, and the hardcoded list below is only
// the fallback for the original corporate sections. This started as a set of ids, which meant the
// first industry overlay added a balance-sheet section the set had never heard of: deposits and
// loans were matched as durations, found nothing, and reported "not tagged" for the two largest
// numbers on a bank's balance sheet.
// A LINE can declare it too, for the case a section is otherwise all durations: a health plan's
// medical claims payable is one balance among four flows, and giving it a section of its own to
// carry a flag would read worse on the page than saying so on the row.
const INSTANT_SECTIONS = new Set(["bs", "debtlike", "dilution"]);
const INSTANT_LINES = new Set(["sharesOut", "nol", "taxCredits"]);
export const isInstant = (sec, line) =>
  line.instant === true || INSTANT_LINES.has(line.k) || sec.instant === true || INSTANT_SECTIONS.has(sec.id);

// Overlay sections slot in beside the corporate ones they extend, so the sheet still reads top-down
// rather than appending an industry annex at the bottom.
export function sectionsFor(industry) {
  const extra = OVERLAY_SECTIONS[industry] || [];
  if (!extra.length) return SECTIONS;
  const out = [...SECTIONS];
  for (const sec of extra) {
    // `after` places a section directly below the one it belongs under — underwriting beneath the
    // income statement, reserves beneath the balance sheet — so an insurer's sheet reads I/S →
    // Underwriting → B/S → Reserves → C/F. Without it every overlay lands in one block after the
    // cash flow, which is where the bank sections still sit; that default is kept rather than
    // changed, because moving shipped sections would be a redesign, not a fix.
    if (sec.after) {
      const at = out.findIndex(s => s.id === sec.after);
      out.splice(at >= 0 ? at + 1 : out.length, 0, sec);
      continue;
    }
    const anchor = sec.tab === "ratios" ? "margins" : "sh";
    const at = out.findIndex(s => s.id === anchor);
    out.splice(at >= 0 ? at : out.length, 0, sec);
  }
  return out;
}

// "Did this payload contain a usable sheet at all?" Asked before the grid is built, because a
// holding-company reorganisation leaves the ticker pointing at an entity that has filed nothing and
// the answer decides whether to go looking under a predecessor CIK. Uses the industry's own period
// anchors rather than a fixed list — a bank keyed off `Revenues` would look empty when it is merely
// a bank.
export function hasAnnualPeriods(d) {
  if (!d || !d.facts) return false;
  const ind = INDUSTRY(d.sicCode);
  return annualPeriods(d.facts, [...(PERIOD_TAGS[ind] || PERIOD_TAGS.corporate), ...PERIOD_TAGS_FALLBACK], 1).length > 0;
}

// One column: fetch every tagged line, then derive, so derived lines can read the ones above them in
// the same column. `get` is the only thing that differs between a fiscal year and a trailing twelve
// months — everything after it, the derivations and the industry blanking, has to be identical or
// the LTM column would be a second engine with its own bugs.
function fillCol(facts, sections, industry, get, scopeOf, pinned) {
  const v = {}, meta = {};
  for (const sec of sections) for (const line of sec.lines) {
    if (line.how !== "fetched" || !line.tags) continue;
    // A tag can be right for most filers and wrong for one industry, and the industry sets so far
    // have only ever been able to blank a whole LINE (`NOT_APPLICABLE`) — which is too blunt when the
    // line is right and one candidate on it is not. `InterestAndDividendIncomeOperating` is a
    // mortgage REIT's top line and a bank's GROSS interest income, and for a bank it also suppressed
    // the reconstruction that produces the correct one.
    let line2 = line.omitFor && line.omitFor[industry]
      ? { ...line, tags: line.tags.filter(t => !line.omitFor[industry].includes(t)) } : line;
    // Rule 21: a row whose candidates were ranked once for this filer uses that ranking in every
    // column, because a line cannot mean one concept in 2021 and another in 2022. See `tagsByRun`.
    if (pinned && pinned[line.k]) line2 = { ...line2, tags: pinned[line.k] };
    const got = get(line2, isInstant(sec, line));
    v[line.k] = got.value; meta[line.k] = got;
  }
  // Which long-term debt tag this column actually resolved decides whether the current portion is
  // already inside it — see `debtScope`. Not a displayed line: it is a fact about the tag, so it goes
  // in `v` where the debt derivation can read it and nowhere else. Per column, because a filer can
  // reach a different tag in different years.
  v.ltdCurInLtDebt = scopeOf ? scopeOf((meta.ltDebt || {}).tag) === "includes" : false;
  // Rule 16's companion, and unlike the one above it is decided from THIS column alone: the two
  // current-debt rows filed at the same non-zero value are one line the filer tagged twice, so the
  // sum takes it once. Per column because a filer's balance sheet changes shape — AMD presents one
  // line today and presented two in 2011.
  v.stDebtIsLtdCur = dupCurrentDebt(v);
  // Equity has nearly cancelled, so every ratio dividing by it is measuring a residual. Set here
  // rather than in DERIVED because it is a property of the column that the NOTES read, not a value
  // any row displays — and because nothing about it may change a number. See `thinEquity`.
  v.equityThin = thinEquity(v);
  // Which equity tag filled the row, because the `nciBs` derivation is only valid when `equity` is the
  // PARENT figure. A filer that tags only the all-in concept fills `equity` from it via the second
  // fallback, and there the difference from `equityAll` is zero by construction — deriving from it
  // would print a confident 0 for a company that has a real minority interest.
  v.equityIsParent = (meta.equity || {}).tag === "StockholdersEquity";
  const derivations = { ...DERIVED, ...(DERIVED_BY_INDUSTRY[industry] || {}) };
  for (const [k, fn] of Object.entries(derivations)) {
    const out = fn(v);
    if (out != null) { v[k] = out; meta[k] = { status: "computed" }; } else if (!(k in v)) { v[k] = null; meta[k] = { status: "computed" }; }
  }
  // Lines a filer of this type does not have are blanked outright, so a derived value can never be
  // built from an inapplicable input — a bank with a computed "EBITDA" would be a fiction.
  for (const k of NOT_APPLICABLE[industry] || []) { v[k] = null; meta[k] = { status: "not-applicable" }; }
  // Rule 22: the gross-profit row is fetched for most filers and computed for the ones reporting the
  // two lines above it and no subtotal. Recorded AFTER the blanking pass, so an industry that has no
  // gross profit at all cannot claim to have derived one. Read by the row's `flagNote`, which is how
  // a figure the engine worked out says so on the page.
  v.grossProfitDerived = v.grossProfit != null && (meta.grossProfit || {}).status === "computed";
  return { v, meta };
}

// Growth lines need the PRIOR column, which sits to the LEFT. Getting this index backwards would
// invert every growth rate silently — the number would still look plausible.
function crossColumn(cols) {
  cols.forEach((c, i) => {
    const prev = cols[i - 1];
    // A growth rate across a break in the calendar is not a growth rate — see `gapBefore`. Refused
    // rather than printed, which is rule 7's "a partial total is worse than no total" applied to a
    // comparison: the number would look exactly like the ones beside it and mean something else.
    const broken = !!(c.period && c.period.gapBefore);
    for (const [k, src] of Object.entries(YOY)) {
      const a = c.v[src], b = prev && prev.v[src];
      c.v[k] = !broken && a != null && b != null && b !== 0 ? a / b - 1 : null;
      // This pass runs AFTER the inapplicable lines are blanked, so writing "computed"
      // unconditionally erased that verdict: a P&C insurer's EBITDA row said "n/a for a P&C insurer"
      // while the EBITDA growth row directly under it said "not tagged" — pointing the reader at a
      // filing to go hunt for the growth rate of a figure the sheet had just explained does not exist.
      if (c.meta[k] && c.meta[k].status === "not-applicable") continue;
      c.meta[k] = { status: "computed" };
    }
    // Same cross-column pass, further back. Both ends must be positive: a CAGR through zero or a
    // sign change is not a growth rate, it is a fraction raised to a third power, and it would print
    // as a confident percentage. Guarding here rather than trusting revenue to be positive, because
    // the same map will one day be pointed at a line that is not.
    for (const [k, [src, n]] of Object.entries(CAGRS)) {
      const a = c.v[src], b = cols[i - n] && cols[i - n].v[src];
      // A CAGR spans n boundaries, so ANY break inside the span disqualifies it, not just the one
      // immediately behind this column.
      const span = cols.slice(Math.max(0, i - n + 1), i + 1).some(x => x.period && x.period.gapBefore);
      c.v[k] = !span && a != null && b != null && a > 0 && b > 0 ? Math.pow(a / b, 1 / n) - 1 : null;
      if (c.meta[k] && c.meta[k].status === "not-applicable") continue;
      c.meta[k] = { status: "computed" };
    }
  });
}

// Valuation lands on the NEWEST column only, and that restraint is the point. There is one price —
// today's — so an EV/EBITDA against FY2019 would be today's enterprise value over a six-year-old
// profit: a number that looks like a multiple and means nothing. Historical multiples need
// historical prices, which the free quote tier does not carry.
// The price is in the currency of the LISTING — Finnhub quotes a US-listed line in dollars, and
// api/quote.js returns a number with no currency on it because there was never a second one. Every
// row below divides that price into, or adds it to, a figure taken from the filing: market cap is
// price × the cover-page share count, and enterprise value then adds the filer's own debt and
// subtracts its own cash. If the filer reports in euros, `mktCap + totalDebt − cash` is three
// currencies in one sum and `price / epsDil` is a P/E built from two.
//
// There is no exchange rate in this data path and there is not going to be one, so the answer is the
// same one `NOT_APPLICABLE` gives a carrier's enterprise value: the block is suppressed, with a
// status of its own so the page can say WHICH currency rather than reading "needs price" — which
// would be false, since the price arrived and is fine.
const PRICE_CURRENCY = "USD";
function applyQuote(c, industry, quote, ccy) {
  if (!c || !quote || !quote.price) return;
  const v = c.v;
  if (ccy && ccy !== PRICE_CURRENCY) {
    for (const k of ["price", "mktCap", "ev", "evRev", "evEbitda", "evEbit", "evFcf", "pe", "pb", "fcfYield", "divYield"]) {
      v[k] = null; c.meta[k] = { status: "currency-mismatch", ccy };
    }
    return;
  }
  // Like the YoY pass above, this runs AFTER the inapplicable lines are blanked — and unlike it,
  // this one writes VALUES, not just labels. So a price arriving quietly resurrected every row
  // NOT_APPLICABLE had just deleted: Chubb printed a $155bn enterprise value, 2.62x EV/Revenue and
  // 12.12x EV/FCF, the exact three rows the P&C list exists to suppress, because enterprise value
  // is a category error for a carrier whose liabilities ARE the business. It only appeared in
  // production, since the quote needs FINNHUB_KEY and local dev has none — which is why the
  // blanking is enforced here rather than trusted to have happened earlier.
  const na = new Set(NOT_APPLICABLE[industry] || []);
  const mark = (k, val) => {
    if (na.has(k)) { v[k] = null; c.meta[k] = { status: "not-applicable" }; return; }
    v[k] = val == null || !isFinite(val) ? null : val;
    c.meta[k] = { status: "market" };
  };
  mark("price", quote.price);
  const mktCap = v.sharesOut != null ? quote.price * v.sharesOut : null;
  mark("mktCap", mktCap);
  const ev = mktCap == null || v.totalDebt == null ? null
    : mktCap + v.totalDebt + (v.preferred || 0) + (v.nciBs || 0) - (v.cash || 0) - (v.sti || 0);
  mark("ev", ev);
  mark("evRev", ev && v.revenue ? ev / v.revenue : null);
  mark("evEbitda", ev && v.ebitda ? ev / v.ebitda : null);
  mark("evEbit", ev && v.ebit ? ev / v.ebit : null);
  mark("evFcf", ev && v.fcf ? ev / v.fcf : null);
  mark("pe", v.epsDil ? quote.price / v.epsDil : null);
  mark("pb", mktCap && v.equity ? mktCap / v.equity : null);
  mark("fcfYield", mktCap && v.fcf != null ? v.fcf / mktCap : null);
  mark("divYield", v.dps ? v.dps / quote.price : null);
}

// Four windows, because that is what a three-year CAGR spans — the newest LTM column plus the three
// behind it. Deeper would cost a rung per year for rows nothing displays.
const LTM_DEPTH = 4;

export function buildGrid(data, quote, limit = 8) {
  if (!data) return null;
  const industry = INDUSTRY(data.sicCode);
  const sections = sectionsFor(industry);
  const facts = data.facts || {};
  const periodTags = [...(PERIOD_TAGS[industry] || PERIOD_TAGS.corporate), ...PERIOD_TAGS_FALLBACK];
  // annualPeriods returns newest-first because "the most recent 8 years" is the natural way to take
  // a slice. Models read the other way — oldest on the left, this year on the right, so a growth row
  // reads forward — so the columns are flipped once, here, and everything downstream (the sheet, the
  // Excel export) inherits the right order rather than each fixing it separately.
  const desc = annualPeriods(facts, periodTags, limit);
  const periods = desc.slice().reverse();
  if (!periods.length) return { industry, sections, periods: [], rows: [], empty: true };

  // The overlap rule in `annualPeriods` made the calendar honest; it did not make it CONTINUOUS. A
  // filer that changes its fiscal year end leaves a stub between two columns that is not twelve months
  // and so belongs to neither: Republic Airways runs to Sep-2022 and then to Dec-2023, with October to
  // December 2022 in no column at all. Each column is right. Anything computed ACROSS that boundary is
  // not — a growth rate there divides a September year by a December year fifteen months later, and
  // the sheet printed 169.1% for Republic, 841.9% for CEA Industries and 32,960.1% for Frequency.
  // 32 of 2,896 adjacent pairs across the four sweep frames are like this, on 27 filers, and one of
  // them is e.l.f. Beauty — this is not a shell-company problem.
  //
  // Recorded on the period so the growth pass can refuse the comparison and the column header can say
  // why once, rather than every affected row explaining it separately. A day's slack because filers
  // differ on whether the next period starts on the previous end date or the day after.
  const dayGap = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  periods.forEach((p, i) => {
    const prev = periods[i - 1];
    p.gapBefore = prev && p.start && dayGap(prev.end, p.start) > 1 ? dayGap(prev.end, p.start) : 0;
  });

  // The verdict is a property of the FILER, not of a column, so it is read once from the whole facts
  // document and memoised per tag — every column asks about at most one or two of them.
  const scopeCache = new Map();
  const scopeOf = tag => {
    if (!scopeCache.has(tag)) scopeCache.set(tag, debtScope(facts, tag));
    return scopeCache.get(tag);
  };
  // Read once, from the same tags that built the calendar, and threaded into every fetch below — see
  // `reportingCurrency`. One currency per sheet is what stops a filer's USD convenience translation
  // being mixed into its own statements line by line.
  const ccy = reportingCurrency(facts, periodTags);

  // Rule 21, resolved ONCE for the whole sheet against its own calendar — oldest first, which is the
  // order `tagsByRun` counts runs in. Lines opt in with `pinByRun`, so this is the cost row and
  // nothing else today; the rule is general and the other candidates are any row whose tag list holds
  // two concepts a filer might file together, but each needs its own measurement before it opts in.
  const calEnds = periods.map(p => p.end);
  const pinned = {};
  for (const sec of sections) for (const line of sec.lines)
    if (line.pinByRun && line.tags) pinned[line.k] = tagsByRun(facts, line.tags, calEnds);

  const cols = periods.map(p => ({ period: p, ...fillCol(facts, sections, industry, (line, inst) =>
    line.latest ? latestFact(facts, line.tags) : pickFact(facts, line.tags, inst ? { end: p.end } : p, { ccy }), scopeOf, pinned) }));
  crossColumn(cols);
  applyQuote(cols[cols.length - 1], industry, quote, ccy);

  // ── The trailing-twelve-month columns ────────────────────────────────────────────────────────
  // Built off the SAME sections, derivations and blanking, so an industry rule cannot hold on the
  // fiscal-year sheet and lapse on the LTM one. Only the fetch differs, and it differs in two ways:
  // a flow line is stitched across three periods, while a BALANCE-SHEET line is simply read at the
  // quarter end — a balance is a fact at a date, and adding three of them together would be
  // meaningless. That also makes net debt, and therefore enterprise value, as of the latest quarter
  // rather than as of a year-end that may be eleven months old.
  const wins = ltmWindows(facts, periodTags, desc, LTM_DEPTH);
  const ltmCols = wins.slice().reverse().map(w => ({
    period: { end: w.end, fy: Number(w.end.slice(0, 4)), ltm: true, through: w.end, fyEnd: w.fy.end,
      basis: `FY to ${w.fy.end} + ${w.cur.start}→${w.cur.end} − ${w.prior.start}→${w.prior.end}` },
    ...fillCol(facts, sections, industry, (line, inst) =>
      line.latest ? latestFact(facts, line.tags)
      : inst ? pickFact(facts, line.tags, { end: w.end }, { ccy })
      : pickLtm(facts, line.tags, w, ccy), scopeOf, pinned),
  }));
  crossColumn(ltmCols);
  applyQuote(ltmCols[ltmCols.length - 1], industry, quote, ccy);

  // A filer whose fiscal year has just closed with nothing filed since has no stitch to make, and
  // its newest annual column already IS the trailing twelve months — Microsoft's year to 30 Jun 2026
  // is the twelve months to 30 Jun 2026. Saying so keeps a comps set whole: six of the 97 filers
  // swept are in exactly that position, all of them RECENT rather than stale, and blanking them
  // would empty the column for the companies whose data is freshest.
  //
  // Gated on `hasInterim` rather than on the window list being empty, because a failed stitch
  // produces the same empty list and is not the same claim: relabelling a nine-month-old fiscal year
  // "LTM" would be the exact misdating the rest of this engine exists to prevent. No interim period
  // on file, so nothing to add — versus there is one and it could not be used.
  // ── Is this sheet about the years the filer has actually reported? ──────────────────────────────
  // Rule 6 is about tags being retired INSIDE us-gaap. This is the filer leaving us-gaap altogether,
  // which rule 6 cannot see and which produces the same failure it exists to prevent: a sheet that
  // foots, reconciles and looks entirely healthy while being about a different decade. National Steel
  // (SID) has filed a 20-F every year since, and every us-gaap fact it carries stops at 2009-12-31 —
  // its later filings are IFRS, and companyfacts carries only the us-gaap and dei taxonomies. The
  // terminal rendered FY2007–FY2009 for a company with a 2025 annual report on file.
  //
  // The filer's own submissions list answers it and the payload already carries it. Measured over all
  // 198 filers in the three sweep frames: 196 are behind by EXACTLY ZERO months and the other two by
  // 36 and 192, so this is a gap rather than a threshold. Any gap at all is reported.
  //
  // It also reads correctly in the benign case it can fire on — the day a filer's new annual report
  // lands before the facts document is regenerated — because what it claims is only what it knows:
  // an annual report exists for a period these figures do not cover.
  // `T` before `/A`, matching `periodic()` in extract.js — written the other way round this rejected
  // `10-KT/A`, an amended transition report, which is the one form that carries both provisions.
  const annual = (data.filings || []).filter(f => /^(10-K|20-F|40-F)T?(\/A)?$/.test(f.form) && f.period);
  const newestReport = annual.reduce((a, f) => (!a || f.period > a.period ? f : a), null);
  const behind = newestReport && cols.length && newestReport.period > cols[cols.length - 1].period.end
    ? { period: newestReport.period, form: newestReport.form, accn: newestReport.accn } : null;

  const carry = !ltmCols.length && cols.length && !hasInterim(facts, periodTags, desc[0]);
  const last = cols[cols.length - 1];
  const newestLtm = ltmCols.length ? ltmCols[ltmCols.length - 1]
    : carry ? { period: { ...last.period, ltm: true, through: last.period.end, fyEnd: last.period.end }, v: { ...last.v }, meta: { ...last.meta } }
    : null;
  return { industry, sections, periods, cols, ltmCols, ltm: newestLtm, ltmStitched: ltmCols.length > 0, behind, ccy };
}
