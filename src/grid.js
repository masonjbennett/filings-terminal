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
import { annualPeriods, pickFact, latestFact, ltmWindows, pickLtm, reportingCurrency, tagsByRun, tagsByIdentity, hasInterim, debtScope, dupCurrentDebt, thinEquity, LEV_ROWS, changeInWorkingCapital, promoteWorkingCapital, NONCURRENT_DEBT, splitEvents, applySplits, alignBalanceSheet, fillMezzanine, BS_LEGS, CAPEX_IMMATERIAL_INDUSTRIES, DERIVED, DERIVED_BY_INDUSTRY, DERIVED_PRICED, PRICED_NEEDS_SHARES, YOY, CAGRS, currentDebtOutside, CURRENT_DEBT_UNPLACED } from "./extract.js";

// The rows rule 31 can rebase — the note on each keys off `v.splitAdjusted`.
const SPLIT_ROWS = ["epsBasic", "epsDil", "dps", "wasoBasic", "wasoDil"];

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
function fillCol(facts, sections, industry, get, scopeOf, pinned, align, r40) {
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
    if (line.preferNonZero) line2 = { ...line2, preferNonZero: true };
    let got = get(line2, isInstant(sec, line));
    // Rule 30. A row may declare that a candidate below another row's figure is not this row's
    // concept — a debt total cannot sit below the current maturities inside it — and the list falls
    // through past it. Only inclusive concepts are tested; a non-current balance can legitimately be
    // the smaller figure (see NONCURRENT_DEBT). The figure set aside travels in `meta.rejected`, so
    // the row can say so: the filer did tag something, and "not tagged" would send a reader to look.
    if (line.notBelow && v[line.notBelow] != null) {
      let tags = line2.tags;
      while (got.value != null && !NONCURRENT_DEBT.has(got.tag) && got.value < v[line.notBelow]) {
        const rejected = { tag: got.tag, value: got.value, form: got.form, filed: got.filed, accn: got.accn, unit: got.unit };
        tags = tags.slice(tags.indexOf(got.tag) + 1);
        got = { ...(tags.length ? get({ ...line2, tags }, isInstant(sec, line)) : { value: null, status: "untagged-this-period" }), rejected };
      }
    }
    v[line.k] = got.value; meta[line.k] = got;
  }
  // Rule 33, per column. The sheet-wide pin (rules 21 and 23) says which concept a row means across
  // the page; where the filer tags BOTH legs of the row's identity for THIS column — gross profit and
  // cost of revenue, for revenue — the filer's own arithmetic settles the column outright, and the
  // pin covers only the columns it cannot test. Capstone Energy Plus is why this is per column: its
  // ASC 606 tag closes gross profit in the five years it WAS the total and `Revenues` in the three
  // after, when the 606 tag became a product-only slice. The concept that is the total changed, the
  // filing says so in every column, and a sheet-wide choice is wrong in three columns either way.
  for (const sec of sections) for (const line of sec.lines) {
    const id = line.pinIdentity; if (!id || !id.plus || !line.tags) continue;
    const part = v[id.equals], whole = v[id.plus]; if (part == null || whole == null) continue;
    const want = part + whole, tol = Math.max(Math.abs(want) * 1e-4, 1000);
    if (v[line.k] != null && Math.abs(v[line.k] - want) <= tol) continue;
    const tags = line.omitFor && line.omitFor[industry] ? line.tags.filter(t => !line.omitFor[industry].includes(t)) : line.tags;
    for (const tag of tags) {
      const got = get({ ...line, tags: [tag] }, isInstant(sec, line));
      if (got.value != null && Math.abs(got.value - want) <= tol) { v[line.k] = got.value; meta[line.k] = { ...got, identity: { equals: id.equals, plus: id.plus } }; break; }
    }
  }
  // Rule 32. The five balance-sheet legs were each fetched from their own newest filing above; if
  // they do not close and the newest filing presenting the whole balance sheet does, every leg is
  // re-read from that one filing. Before the flags and derivations, because `equityThin`,
  // `equityIsParent`, ROE, leverage and the EV bridge all read the legs. `bsAligned` is the column
  // flag the five rows' note keys off; the cells carry which filing they came from and what they displaced.
  const aligned = align ? align(v, meta) : null;
  v.bsAligned = !!aligned;
  // Rule 38's note: a mezzanine total the filer never tags, summed from the classes it does.
  v.mezzSummed = v.tempEquity != null && (meta.tempEquity || {}).closes === "sum";
  // Which long-term debt tag this column actually resolved decides whether the current portion is
  // already inside it — see `debtScope`. Not a displayed line: it is a fact about the tag, so it goes
  // in `v` where the debt derivation can read it and nowhere else. Per column, because a filer can
  // reach a different tag in different years.
  // Rule 30's note is keyed here: a figure the long-term row set aside as impossible.
  v.ltDebtRejected = !!(meta.ltDebt || {}).rejected;
  // Rule 31's: any per-share or share-count cell in this column shown on today's share basis.
  v.splitAdjusted = SPLIT_ROWS.some(k => (meta[k] || {}).status === "split-adjusted");
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
  // Rule 34: which D&A concept filled the row. Only `Depreciation` excludes amortisation by definition,
  // so only a row resolved from it may be summed with the amortisation tagged beside it.
  v.daDepreciationOnly = (meta.da || {}).tag === "Depreciation";
  // Rule 35: a carrier's untagged capex is waived — measured immaterial, see CAPEX_IMMATERIAL_INDUSTRIES
  // — so its free cash flow prints as cash from operations and the row's note says so.
  v.capexWaived = v.capex == null && v.cfo != null && CAPEX_IMMATERIAL_INDUSTRIES.has(industry);
  // Rule 25. A working-capital sum refused for a missing leg gets one reconsideration, now that the
  // leg's BALANCE and the cash flow it would adjust are both on the column. Runs before the
  // derivations, because `ufcf` reads the result.
  promoteWorkingCapital(v, meta);
  const derivations = { ...DERIVED, ...(DERIVED_BY_INDUSTRY[industry] || {}) };
  for (const [k, fn] of Object.entries(derivations)) {
    let out = fn(v);
    // Rule 40, applied HERE rather than after the loop, and to the derivation rather than to the cell:
    // every row below total debt — the leases total, net debt, the bridge, debt/equity, debt/capital,
    // invested capital, ROIC and the two leverage multiples — reads `v.totalDebt`, so correcting or
    // refusing it at the moment it is computed is what keeps a derivation from running on a stale
    // total, with no list of dependent rows to maintain. `totalDebt` is the key in every industry's
    // derivation table as well as the corporate one, so an override is covered by the same line.
    // Only onto a total that already prints (rule 7): a blank total has nothing to correct, and the
    // decision above already required one before refusing.
    if (k === "totalDebt" && r40 && out != null) {
      if (r40.refuse) { v[k] = null; meta[k] = { status: CURRENT_DEBT_UNPLACED, unplaced: r40 }; continue; }
      v[k] = out + r40.add; meta[k] = { status: "computed", outsideTotal: r40 }; continue;
    }
    if (out != null) { v[k] = out; meta[k] = { status: "computed" }; } else if (!(k in v)) { v[k] = null; meta[k] = { status: "computed" }; }
  }
  // Lines a filer of this type does not have are blanked outright, so a derived value can never be
  // built from an inapplicable input — a bank with a computed "EBITDA" would be a fiction.
  for (const k of NOT_APPLICABLE[industry] || []) { v[k] = null; meta[k] = { status: "not-applicable" }; }
  // Rule 39: a debt multiple of a negative EBITDA reads n/m, not blank and not a negative number, and only
  // where the row's own debt figure exists. After the blanking pass, which is what keeps a bank's n/a: every
  // industry whose leverage rows are n/a has its EBITDA blanked too, so this never reaches one (a guard on
  // the rows' own status was tried and could never fire — rule 30's dead code).
  const nm = LEV_ROWS.filter(([, num]) => v.ebitda != null && v.ebitda < 0 && v[num] != null);
  for (const [k] of nm) { v[k] = null; meta[k] = { status: "not-meaningful" }; }
  v.levNegEbitda = nm.length > 0;
  // Rule 22: the gross-profit row is fetched for most filers and computed for the ones reporting the
  // two lines above it and no subtotal. Recorded AFTER the blanking pass, so an industry that has no
  // gross profit at all cannot claim to have derived one. Read by the row's `flagNote`, which is how
  // a figure the engine worked out says so on the page.
  v.grossProfitDerived = v.grossProfit != null && (meta.grossProfit || {}).status === "computed";
  // Rule 25, same obligation: unlevered FCF now subtracts a working-capital movement taken off the
  // filer's own cash flow statement, and a reader who knows the formula will want to know WHICH ΔNWC
  // it is — the balance-sheet delta and the cash flow statement's line are different numbers. Set
  // after the blanking pass so an industry whose sheet has no unlevered FCF cannot claim one.
  v.ufcfFromCashFlow = v.ufcf != null && v.chgNwc != null;
  // Rule 35's two notes-instead-of-blanks, set AFTER the blanking pass and keyed to the FIGURE, for
  // rule 22's reason: a bank whose quick ratio is n/a must not be left explaining a figure it does not
  // show, and neither may a filer with no current liabilities or no share count. (`capexWaived` needs
  // no trim: it already requires cash from operations, which is the whole of the waived figure.)
  v.quickNoInventory = v.quickRatio != null && v.inventory == null;
  v.tbvpsPartial = v.tbvps != null && (v.goodwill == null || v.intangibles == null);
  return { v, meta };
}

// Growth lines need the PRIOR column, which sits to the LEFT. Getting this index backwards would
// invert every growth rate silently — the number would still look plausible.
function crossColumn(cols) {
  // A 53-week year anywhere on the sheet is a fact about every growth rate on it — the rates into and
  // out of that year carry the extra week, and a CAGR ending on it carries a slice of it. Set on every
  // column so the growth rows' note fires once for the sheet; the column itself is marked in the
  // header from `period.weeks53`. Nothing is blanked and nothing is adjusted: both years are real.
  const anyWeeks53 = cols.some(x => x.period && x.period.weeks53);
  cols.forEach((c, i) => {
    const prev = cols[i - 1];
    c.v.week53Sheet = anyWeeks53;
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
  const priced = Object.keys(DERIVED_PRICED);
  if (ccy && ccy !== PRICE_CURRENCY) {
    for (const k of priced) { v[k] = null; c.meta[k] = { status: "currency-mismatch", ccy }; }
    return;
  }
  // Like the YoY pass, this runs AFTER the inapplicable lines are blanked — and unlike it, this one
  // writes VALUES, not just labels. So a price arriving quietly resurrected every row
  // NOT_APPLICABLE had just deleted: Chubb printed a $155bn enterprise value, 2.62x EV/Revenue and
  // 12.12x EV/FCF, the exact three rows the P&C list exists to suppress, because enterprise value
  // is a category error for a carrier whose liabilities ARE the business. It only appeared in
  // production, since the quote needs FINNHUB_KEY and local dev has none — which is why the
  // blanking is enforced here rather than trusted to have happened earlier.
  const na = new Set(NOT_APPLICABLE[industry] || []);
  // The cover count was refused as stale or filed at zero (rule 26), so every figure built on it is
  // missing for a reason the reader can act on. "needs price" would be false here — the price
  // arrived and is fine — and would send them hunting a quote that is already on the page. Alphabet
  // and Meta reach this through a share count companyfacts does not carry undimensioned; Simon
  // Property and Paramount through one refused as stale or zero.
  const noShares = v.sharesOut == null;
  for (const [k, fn] of Object.entries(DERIVED_PRICED)) {
    if (na.has(k)) { v[k] = null; c.meta[k] = { status: "not-applicable" }; continue; }
    if (noShares && PRICED_NEEDS_SHARES.has(k)) { v[k] = null; c.meta[k] = { status: "no-share-count" }; continue; }
    const out = fn(v, quote.price);
    v[k] = out == null || !isFinite(out) ? null : out;
    c.meta[k] = { status: "market" };
  }
}

// Four windows, because that is what a three-year CAGR spans — the newest LTM column plus the three
// behind it. Deeper would cost a rung per year for rows nothing displays.
const LTM_DEPTH = 4;
// The shortest period that is a 53-week year rather than a 52-week or calendar one — see `weeks53`.
export const WEEKS53_MIN_DAYS = 369;

// Shared by the period loop below and by `announcedSince`. It was a closure-local const declared
// inside buildGrid, fourteen lines after the early return the announcement check now sits in front
// of, so reading it from there would have been a temporal-dead-zone ReferenceError — and this repo
// has no error boundary anywhere (src/main.jsx renders <App /> bare), so that throw blanks the whole
// terminal for as long as the payload that caused it stays cached.
const dayGap = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// The forms a figure on this sheet can come from. Character-identical to periodic() in extract.js
// and to the filter in api/facts.js; test/t-announced.mjs asserts all three still agree, because the
// one time they drifted an entire class of filer — transition reports — went invisible.
const PERIODIC = /^(10-K|10-Q|20-F|40-F)T?(\/A)?$/;
const ISODATE = /^\d{4}-\d{2}-\d{2}$/;

// ── A later filing that this sheet does not read ───────────────────────────────────────────────
// Rule 13 keeps 8-K figures out of the data path, and it is right to: an 8-K's numbers are a press
// release's, and pairing Essential Utilities' 8-K operating income with its 10-K revenue printed an
// EBITDA above revenue for three straight years. But the rule leaves a gap the reader feels. Between
// a company announcing a quarter and filing the 10-Q for it, this page shows the quarter before and
// says nothing at all about the newer filing sitting on EDGAR.
//
// This closes it by LINKING instead of importing. The trigger is SEC's own items field on the
// submissions index — a code the filer selects on a cover page, carried as structured data — so
// nothing untagged enters the data path and the page can point at a filing it has never opened.
//
// What it must never do is describe the DOCUMENT. Item 2.02 is a heading, not a promise about the
// contents: Tesla files its quarterly production and delivery counts under it (vehicle units and
// GWh, no revenue figure anywhere), Apollo a one-line preliminary estimate whose own text says it
// precedes the earnings release, GRAIL a J.P. Morgan conference deck, Erasca a cash balance that
// says it "is not a comprehensive statement of our financial results". 44 filings this rule reaches
// were fetched and read: 27 were results and 17 were not. So the banner names the HEADING, says the
// page has not opened the document, and claims nothing else. Its job is to be true, not to classify.
//
// LAG_MIN is the one threshold and it is arithmetic rather than calibration. The lag is days from
// the newest period any periodic report covers to the 8-K's own event date. A release about a NEW
// period cannot exist until a fiscal boundary has fallen — one quarter, about 91 days — plus the
// time it takes to close the books. Measured on those 44 documents, every one of the 27 results
// releases has a lag of 100 or more and every one of the 17 below 100 is a pre-announcement, a
// conference deck, an operating-metrics release or a restatement; the adjacent pair at the boundary
// is Netflix's Q1 shareholder letter at exactly 100 against an AbbVie guidance table at 99 whose own
// text says the results "have not been finalized". Below 91 no boundary has fallen at all, which is
// why all nine episodes there report a period the sheet ALREADY covers — the one state that would
// make this banner flatly false. Read 100 as somewhere in 98-102, not a knife edge.
//
// The lag is measured from the newest period COVERED, never from the newest report FILED, and the
// difference is load-bearing. Tesla files a Part III 10-K/A every April, which outranks its own
// later 10-Q on filing date; measured from that amendment its July production release has a lag of
// 183 and clears any floor, and measured from the period the sheet actually shows it is 93 and is
// cut. Tesla is a complete single-filer census: four production releases at 92-94 and four real
// earnings 8-Ks at 112-120, separated perfectly by this rule and not at all by the other one.
//
// Deterministic by construction — no clock is read here, for the reason newestFiledDate gives below:
// a cached payload must build the same sheet tomorrow as it does today, and a test must be able to
// assert it without freezing time. Staleness is a separate question, asked once at the render by
// announcedIsCurrent.
export const LAG_MIN = 100;

export function announcedSince(filings) {
  const rows = Array.isArray(filings) ? filings : [];   // a cached payload whose shape has moved

  // Two filers of 180 have no periodic report inside the payload's 120-row window at all, and one of
  // them has live item-2.02 8-Ks. Held out explicitly rather than by a date comparison against
  // undefined, which works today only because '2025-11-07' > undefined coerces to NaN, and stops
  // working the moment somebody normalises a missing date to "".
  const per = rows.filter(f => f && PERIODIC.test(String(f.form)) && ISODATE.test(String(f.filed)));
  if (!per.length) return null;

  // The ORDERING row — newest FILED, the same row newestFiledDate resolves to below, so the two can
  // never disagree about which report is the latest. It decides only whether the 8-K came after.
  const pFiled = per.reduce((a, f) =>
    !a || f.filed > a.filed || (f.filed === a.filed && String(f.accn) > String(a.accn)) ? f : a, null);

  // The COVERAGE row — the newest period any periodic covers. The lag is measured from this and the
  // banner prints this. 19 same-day pairs of periodic filings exist across 17 filers, so the
  // accession tie-break is real; it is descending on both reduces, which makes the answer independent
  // of the order SEC happens to return the list in.
  const dated = per.filter(f => ISODATE.test(String(f.period)));
  if (!dated.length) return null;
  const pMax = dated.reduce((a, f) =>
    f.period > a.period || (f.period === a.period && String(f.accn) > String(a.accn)) ? f : a);

  // Exact form and exact token. 33 filings across 24 filers carry item 2.02 on an 8-K/A, and an
  // amendment is by definition about a period already announced; api/facts.js excludes them one layer
  // earlier and this is belt and braces for the day that regex widens for another reason. Splitting
  // on the comma rather than testing for a substring costs nothing and does not rest on SEC never
  // issuing an item code with "2.02" inside a longer one.
  const ann = rows.filter(f => f && String(f.form) === "8-K"
    && String(f.items ?? "").split(",").map(s => s.trim()).includes("2.02")
    && ISODATE.test(String(f.filed)));
  if (!ann.length) return null;   // also where a payload built before items existed lands
  const e = ann.reduce((a, f) =>
    !a || f.filed > a.filed || (f.filed === a.filed && String(f.accn) > String(a.accn)) ? f : a, null);
  // The 8-K's EVENT date, not its filing date, because the lag is about the period it can be
  // reporting on. No fallback to an older 8-K: that puts a link to the wrong filing on the page.
  if (!ISODATE.test(String(e.period)) || !e.accn) return null;

  // Strictly after, and the census here is smaller than it first looks. 1,261 item-2.02 8-Ks across
  // the 180 cached filers were filed on a date that also carries a periodic report, but the lag gate
  // already cuts all but ONE of them: a company filing its results release beside the 10-K for the
  // same year announces a period the sheet is about to cover, so the lag is ~30 days. The one that
  // needs this comparison is Datacentrex, which filed its FY2025 10-K and its FY2025 results release
  // on 2026-04-13 at a lag of 103 — with >= the banner would appear on the very day the report
  // covering it landed. Apple is the other direction: its release lands the day BEFORE the 10-Q, so
  // it speaks for one day and stops. filingDate carries no time, so a release furnished later on the
  // same day is invisible until tomorrow; one day of silence is the trade, taken deliberately.
  if (!(e.filed > pFiled.filed)) return null;
  if (!(dayGap(pMax.period, e.period) >= LAG_MIN)) return null;

  return { form: pMax.form, filed: pMax.filed, period: pMax.period, annFiled: e.filed,
           annEvent: e.period, annAccn: e.accn };
}

// How old the announcement may be before the banner stops speaking, in days from the 8-K's event
// date. This is the ONE place a clock is read, and it is read at the render with today passed in, so
// the grid stays deterministic and a test can pin any date it likes.
//
// It exists because the predicate above has no way to notice that a filer has STOPPED. FS Specialty
// Lending Fund's last periodic report is a 10-Q filed 2025-08-14; its newest item-2.02 8-K is dated
// 2025-10-15, a lag of 107, and on 2026-09-22 that 8-K is 342 days old and the banner has been on
// screen for eleven months saying a later filing exists. It does — but the sheet is not "behind" in
// any sense a reader would recognise, the filer is delinquent, and a banner that never goes away is
// the stale-content trap this site is built to avoid.
//
// 120 rather than something tighter: across all 363 episodes in a 366-day replay of 180 filers, the
// oldest an announcement ever gets before the next periodic report lands is 50 days (median 6, p90
// 21). A ceiling of 90 would already cut none of them; 120 is that with room for a non-accelerated
// filer that takes the full 90 days for a 10-K and then files late.
export const ANNOUNCED_MAX_AGE = 120;
export const announcedIsCurrent = (ann, today) =>
  !!(ann && ISODATE.test(String(today)) && dayGap(ann.annEvent, today) <= ANNOUNCED_MAX_AGE);

export function buildGrid(data, quote, limit = 8) {
  if (!data) return null;
  const industry = INDUSTRY(data.sicCode);
  const sections = sectionsFor(industry);
  // Rule 31 runs on the raw payload and everything below reads the rebased copy — annual columns,
  // LTM legs, the debt-scope and run-length passes alike see one share basis. A filer with no split
  // gets the payload's own object back.
  const splits = splitEvents(data.facts || {});
  const facts = applySplits(data.facts || {}, splits);
  const periodTags = [...(PERIOD_TAGS[industry] || PERIOD_TAGS.corporate), ...PERIOD_TAGS_FALLBACK];
  // annualPeriods returns newest-first because "the most recent 8 years" is the natural way to take
  // a slice. Models read the other way — oldest on the left, this year on the right, so a growth row
  // reads forward — so the columns are flipped once, here, and everything downstream (the sheet, the
  // Excel export) inherits the right order rather than each fixing it separately.
  const desc = annualPeriods(facts, periodTags, limit);
  const periods = desc.slice().reverse();
  // Computed before the empty-grid return, not after it: a filer with no annual XBRL periods still
  // has a filing list, and "a later filing exists" is the one thing such a page can honestly say.
  const announced = announcedSince(data.filings);
  if (!periods.length) return { industry, sections, periods: [], rows: [], empty: true, announced };

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
  periods.forEach((p, i) => {
    const prev = periods[i - 1];
    p.gapBefore = prev && p.start && dayGap(prev.end, p.start) > 1 ? dayGap(prev.end, p.start) : 0;
    // ── A 53-week year ───────────────────────────────────────────────────────────────────────────
    // A 52/53-week filer adds a week every five or six years and files it as one fiscal year, so the
    // column is a genuine fiscal year and 1.9% longer than the ones beside it. Nothing here adjusts
    // for that — the filer's own 10-K reports the growth rate with the extra week in it — but the
    // sheet has to SAY it, because the rate a reader sees is not the rate they think they see:
    // across the 180 cached filers 30 columns are 370 days, 52 revenue-growth cells have one on a
    // leg, and on five of those the extra week is the whole sign — Kroger's FY2024 revenue grew
    // 1.20% as printed and shrank 0.71% per week, Lowe's +0.84% / −1.06%, J&J +0.64% / −1.26%.
    // Measured column lengths are 363, 364, 365 and 370 days and nothing else (LTM windows 364–366
    // and 371), so 369 is a boundary with nothing near it on either side, not a judgement.
    p.weeks53 = !!(p.start && dayGap(p.start, p.end) >= WEEKS53_MIN_DAYS);
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
  const lineByKey = {};
  for (const sec of sections) for (const line of sec.lines) lineByKey[line.k] = line;
  for (const sec of sections) for (const line of sec.lines) {
    if (!line.pinByRun || !line.tags) continue;
    // The candidates are the row's tags AFTER the industry omission — the same list `fillCol` fetches
    // from — or the pin would hand a bank's revenue row the gross interest income `omitFor` exists to
    // keep off it (US Bancorp: eight years of `InterestAndDividendIncomeOperating` against five of
    // `Revenues`). The pinned list REPLACES the row's tags in fillCol, so the omission has to happen here.
    const tags = line.omitFor && line.omitFor[industry] ? line.tags.filter(t => !line.omitFor[industry].includes(t)) : line.tags;
    // Rule 23 first, because it is the filer's own arithmetic rather than a proxy for it — and it
    // returns null for the filers that tag no subtotal, which is nearly all of them.
    let order = null;
    if (line.pinIdentity) {
      const minus = (lineByKey[line.pinIdentity.minus] || {}).tags;
      const plus = (lineByKey[line.pinIdentity.plus] || {}).tags;
      const equals = (lineByKey[line.pinIdentity.equals] || {}).tags;
      if ((minus || plus) && equals) order = tagsByIdentity(facts, tags, periods, minus, equals, plus);
    }
    pinned[line.k] = order || tagsByRun(facts, tags, calEnds);
  }

  // Rule 32 reads the five leg rows by their own tag lists, so a tag added to a row reaches the
  // re-draw without a second list to keep in step.
  const legLines = Object.fromEntries(BS_LEGS.map(k => [k, lineByKey[k]]));
  // Rule 38 runs first: a column that closes once its mezzanine line is found under a class concept has
  // nothing for rule 32 to re-draw, and rule 32's foot test must see that line.
  const alignAt = end => (v, meta) => { fillMezzanine(facts, v, meta, end, ccy); return alignBalanceSheet(facts, v, meta, legLines, end, ccy); };

  // The filer's own newest periodic report, which is what a cover-page figure is measured as stale
  // against. Taken from the filing list the payload already carries rather than from a clock, so the
  // answer is deterministic: a cached payload builds the same sheet tomorrow as it does today, and a
  // test can assert it without freezing time.
  const newestFiledDate = (data.filings || [])
    .filter(f => /^(10-K|10-Q|20-F|40-F)T?(\/A)?$/.test(f.form)).map(f => f.filed).sort().pop() || null;
  const latestOpts = line => (line.mustBeCurrent ? { mustBeCurrent: true, notBefore: newestFiledDate } : undefined);

  // One annual column, built to order — the same call twice where rule 40 has something to say about
  // it, so the correction runs through this engine rather than beside it.
  const annualCol = (p, r40) => ({ period: p, ...fillCol(facts, sections, industry, (line, inst) =>
    line.wcAggregate ? changeInWorkingCapital(facts, ccy, t => pickFact(facts, [t], p, { ccy }), p.end)
    : line.latest ? latestFact(facts, line.tags, latestOpts(line)) : pickFact(facts, line.tags, inst ? { end: p.end } : p, { ccy, preferNonZero: line.preferNonZero }), scopeOf, pinned, alignAt(p.end), r40) });
  const cols = periods.map(p => annualCol(p, null));

  // ── The trailing-twelve-month columns ────────────────────────────────────────────────────────
  // Built off the SAME sections, derivations and blanking, so an industry rule cannot hold on the
  // fiscal-year sheet and lapse on the LTM one. Only the fetch differs, and it differs in two ways:
  // a flow line is stitched across three periods, while a BALANCE-SHEET line is simply read at the
  // quarter end — a balance is a fact at a date, and adding three of them together would be
  // meaningless. That also makes net debt, and therefore enterprise value, as of the latest quarter
  // rather than as of a year-end that may be eleven months old.
  const wins = ltmWindows(facts, periodTags, desc, LTM_DEPTH);
  const ltmCol = (w, r40) => ({
    period: { end: w.end, fy: Number(w.end.slice(0, 4)), ltm: true, through: w.end, fyEnd: w.fy.end, weeks53: w.days >= WEEKS53_MIN_DAYS,
      basis: `FY to ${w.fy.end} + ${w.cur.start}→${w.cur.end} − ${w.prior.start}→${w.prior.end}` },
    ...fillCol(facts, sections, industry, (line, inst) =>
      line.wcAggregate ? changeInWorkingCapital(facts, ccy, t => pickLtm(facts, [t], w, ccy), w.end)
      : line.latest ? latestFact(facts, line.tags, latestOpts(line))
      : inst ? pickFact(facts, line.tags, { end: w.end }, { ccy, preferNonZero: line.preferNonZero })
      : pickLtm(facts, line.tags, w, ccy), scopeOf, pinned, alignAt(w.end), r40),
  });
  const ltmWinsOldestFirst = wins.slice().reverse();
  const ltmCols = ltmWinsOldestFirst.map(w => ltmCol(w, null));

  // ── Rule 40 ─────────────────────────────────────────────────────────────────────────────────────
  // Decided for the FILER, from the columns as they came out: the legs the sum actually used, the tag
  // the long-term row resolved and the total it printed only exist once `fillCol` has run. It needs
  // BOTH column sets before it can decide — 3M's only two columns that close an identity of their own
  // are trailing-twelve-month ones, and they license five annual corrections — so it sits between the
  // two builds and the cross-column pass. The affected columns are then rebuilt through the SAME
  // `fillCol`, which is what keeps the correction from being a second engine: nothing here knows how
  // total debt is derived, and every row below it is recomputed rather than patched.
  const r40 = currentDebtOutside(facts, sections, ccy, cols, ltmCols);
  if (r40) {
    // A refused total blanks every row derived from it, and rule 5 says a blank must say which kind.
    // Which rows those are is not a list to keep in step — it is whatever went from a figure to a
    // blank between the two builds of the same column.
    const markRefused = (before, after) => {
      for (const k of Object.keys(after.v)) if (typeof before.v[k] === "number" && after.v[k] == null) after.meta[k] = { status: CURRENT_DEBT_UNPLACED, unplaced: after.meta.totalDebt.unplaced };
    };
    cols.forEach((c, i) => { const d = r40.get(c); if (!d) return; cols[i] = annualCol(c.period, d); if (d.refuse) markRefused(c, cols[i]); });
    ltmCols.forEach((c, i) => { const d = r40.get(c); if (!d) return; ltmCols[i] = ltmCol(ltmWinsOldestFirst[i], d); if (d.refuse) markRefused(c, ltmCols[i]); });
  }
  crossColumn(cols);
  applyQuote(cols[cols.length - 1], industry, quote, ccy);
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
  return { industry, sections, periods, cols, ltmCols, ltm: newestLtm, ltmStitched: ltmCols.length > 0, behind, announced, ccy, splits };
}
