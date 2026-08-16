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
import { annualPeriods, pickFact, latestFact, ltmWindows, pickLtm, hasInterim, DERIVED, DERIVED_BY_INDUSTRY, YOY, CAGRS } from "./extract.js";

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
function fillCol(facts, sections, industry, get) {
  const v = {}, meta = {};
  for (const sec of sections) for (const line of sec.lines) {
    if (line.how !== "fetched" || !line.tags) continue;
    // A tag can be right for most filers and wrong for one industry, and the industry sets so far
    // have only ever been able to blank a whole LINE (`NOT_APPLICABLE`) — which is too blunt when the
    // line is right and one candidate on it is not. `InterestAndDividendIncomeOperating` is a
    // mortgage REIT's top line and a bank's GROSS interest income, and for a bank it also suppressed
    // the reconstruction that produces the correct one.
    const line2 = line.omitFor && line.omitFor[industry]
      ? { ...line, tags: line.tags.filter(t => !line.omitFor[industry].includes(t)) } : line;
    const got = get(line2, isInstant(sec, line));
    v[line.k] = got.value; meta[line.k] = got;
  }
  const derivations = { ...DERIVED, ...(DERIVED_BY_INDUSTRY[industry] || {}) };
  for (const [k, fn] of Object.entries(derivations)) {
    const out = fn(v);
    if (out != null) { v[k] = out; meta[k] = { status: "computed" }; } else if (!(k in v)) { v[k] = null; meta[k] = { status: "computed" }; }
  }
  // Lines a filer of this type does not have are blanked outright, so a derived value can never be
  // built from an inapplicable input — a bank with a computed "EBITDA" would be a fiction.
  for (const k of NOT_APPLICABLE[industry] || []) { v[k] = null; meta[k] = { status: "not-applicable" }; }
  return { v, meta };
}

// Growth lines need the PRIOR column, which sits to the LEFT. Getting this index backwards would
// invert every growth rate silently — the number would still look plausible.
function crossColumn(cols) {
  cols.forEach((c, i) => {
    const prev = cols[i - 1];
    for (const [k, src] of Object.entries(YOY)) {
      const a = c.v[src], b = prev && prev.v[src];
      c.v[k] = a != null && b != null && b !== 0 ? a / b - 1 : null;
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
      c.v[k] = a != null && b != null && a > 0 && b > 0 ? Math.pow(a / b, 1 / n) - 1 : null;
      if (c.meta[k] && c.meta[k].status === "not-applicable") continue;
      c.meta[k] = { status: "computed" };
    }
  });
}

// Valuation lands on the NEWEST column only, and that restraint is the point. There is one price —
// today's — so an EV/EBITDA against FY2019 would be today's enterprise value over a six-year-old
// profit: a number that looks like a multiple and means nothing. Historical multiples need
// historical prices, which the free quote tier does not carry.
function applyQuote(c, industry, quote) {
  if (!c || !quote || !quote.price) return;
  const v = c.v;
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

  const cols = periods.map(p => ({ period: p, ...fillCol(facts, sections, industry, (line, inst) =>
    line.latest ? latestFact(facts, line.tags) : pickFact(facts, line.tags, inst ? { end: p.end } : p)) }));
  crossColumn(cols);
  applyQuote(cols[cols.length - 1], industry, quote);

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
      : inst ? pickFact(facts, line.tags, { end: w.end })
      : pickLtm(facts, line.tags, w)),
  }));
  crossColumn(ltmCols);
  applyQuote(ltmCols[ltmCols.length - 1], industry, quote);

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
  const carry = !ltmCols.length && cols.length && !hasInterim(facts, periodTags, desc[0]);
  const last = cols[cols.length - 1];
  const newestLtm = ltmCols.length ? ltmCols[ltmCols.length - 1]
    : carry ? { period: { ...last.period, ltm: true, through: last.period.end, fyEnd: last.period.end }, v: { ...last.v }, meta: { ...last.meta } }
    : null;
  return { industry, sections, periods, cols, ltmCols, ltm: newestLtm, ltmStitched: ltmCols.length > 0 };
}
