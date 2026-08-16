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
import { annualPeriods, pickFact, latestFact, DERIVED, DERIVED_BY_INDUSTRY, YOY, CAGRS } from "./extract.js";

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

export function buildGrid(data, quote, limit = 8) {
  if (!data) return null;
  const industry = INDUSTRY(data.sicCode);
  const sections = sectionsFor(industry);
  const facts = data.facts || {};
  // annualPeriods returns newest-first because "the most recent 8 years" is the natural way to take
  // a slice. Models read the other way — oldest on the left, this year on the right, so a growth row
  // reads forward — so the columns are flipped once, here, and everything downstream (the sheet, the
  // Excel export) inherits the right order rather than each fixing it separately.
  const periods = annualPeriods(facts, [...(PERIOD_TAGS[industry] || PERIOD_TAGS.corporate), ...PERIOD_TAGS_FALLBACK], limit).reverse();
  if (!periods.length) return { industry, sections, periods: [], rows: [], empty: true };

  // Column at a time: fetch every tagged line, then derive, so derived lines can read the ones above
  // them in the same column.
  const cols = periods.map(p => {
    const v = {}, meta = {};
    for (const sec of sections) for (const line of sec.lines) {
      if (line.how !== "fetched" || !line.tags) continue;
      const inst = isInstant(sec, line);
      const got = line.latest ? latestFact(facts, line.tags) : pickFact(facts, line.tags, inst ? { end: p.end } : p);
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
    return { period: p, v, meta };
  });

  // Growth lines need the PRIOR year, which now sits to the LEFT. Getting this index backwards would
  // invert every growth rate silently — the number would still look plausible.
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

  // Valuation lands on the NEWEST column only, and that restraint is the point. There is one price —
  // today's — so an EV/EBITDA against FY2019 would be today's enterprise value over a six-year-old
  // profit: a number that looks like a multiple and means nothing. Historical multiples need
  // historical prices, which the free quote tier does not carry.
  if (quote && quote.price && cols.length) {
    const c = cols[cols.length - 1], v = c.v;
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
  return { industry, sections, periods, cols };
}
