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

// ── How long a fiscal year is, and what lives in the slack ──────────────────────────────────────
// A "year" in filings runs 52–53 weeks, and this window was originally drawn at 300–400 days to be
// safely wider than that. Nothing had ever landed in the slack until the Chapter 11 frame, where
// FRESH-START ACCOUNTING splits the year of emergence into a predecessor stub and a successor stub —
// neither twelve months, both filed under the same annual tags. Six of them sat inside 300–400 and
// rendered as fiscal years: CBL's 303-day period ran 1 Jan to 31 Oct 2021 and was labelled FY2021,
// ten months of a company in a column beside twelve-month ones, with a growth rate against it.
//
// 358 is the measured boundary, not a round number, and it is a JUDGEMENT in the sense the
// near-cancelled-equity note is — but a better-evidenced one, because the population below it is
// small enough to enumerate rather than describe. Across every duration fact filed under a
// period-anchor tag in the cached filers, 44,728 of 44,897 are 363/364/365/370 days (a 52-week year,
// a calendar year, a leap year, a 53-week year) and 43 distinct (filer, period) pairs are shorter
// than 358. Every one of the 43 was identified: Chapter 11 stubs (CBL, California Resources, Chord,
// Noble, Seadrill, Expand, Weatherford's year to its 13 Dec 2019 emergence), fiscal-year transition
// stubs (Greif, MediaCo, Jefferies, Zhanling — all on 10-KT), inception and IPO periods (Kinder
// Morgan 2011, Shoals, UWM, Vroom), and CleanSpark, which tags two years seven days short and never
// reaches a column with them.
//
// **363 is the number that looks principled and is wrong.** 52 weeks is 364 calendar days, so "at
// least 52 weeks" reads as the definition of a fiscal year — and 362 carries Kraft Heinz's FY2016
// and H.B. Fuller's FY2024, both genuine 52-week years at two real companies, because the year
// before each was a 53-week year that ate a day. A rule drawn on what a fiscal year *is* would have
// dropped a mega-cap's year to fix a stub.
//
// ANNUAL_MAX is deliberately NOT tightened to match. Nothing in 2,834 rendered columns exceeds 370
// days and only 4 facts anywhere exceed 372, so there is no population to measure a tighter maximum
// against — and `annualPeriods` reuses ANNUAL_MAX for something else entirely (whether a candidate
// tag reaches the newest period at all), so moving it would change a rule this evidence says nothing
// about.
export const ANNUAL_MIN = 358, ANNUAL_MAX = 400;
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

// ── The sheet has ONE currency, and it is the filer's ───────────────────────────────────────────
// A companyfacts unit is `USD`, `EUR`, `shares`, `USD/shares`, `pure`, or a count the filer invented
// (`property`, `numberOfProperty`). Only an ISO-4217-shaped code is money, and only money and the
// per-share figures built on it have to agree across a sheet.
const isCurrency = u => /^[A-Z]{3}$/.test(String(u));
const currencyOf = u => (isCurrency(u) ? String(u) : /^[A-Z]{3}\/shares$/.test(String(u)) ? String(u).slice(0, 3) : null);

// Which currency this filer reports in, read from the facts that BUILD THE CALENDAR — the period
// anchors of rule 6. The currency of the top line is the currency of the sheet, which is the same
// reasoning that makes those tags the anchors in the first place: whatever else a filer does, the
// figure it reports revenue in is the figure it reports in.
//
// Needed because `factsFor` flattens `def.units` in OBJECT-KEY ORDER and `pickFact` sorts only on
// filed date and form rank — so where a filer files one line in two currencies, which one wins was
// decided by the order SEC happened to serialise the units map, independently per tag. That is not a
// labelling problem, it is a wrong number: All In FutureTech tags `ShortTermBorrowings` at BOTH
// `JPY 948.2m` and `USD 6.3m` for the same instant, JPY first, so the sheet reported 948,200,000 of
// short-term debt for a company with $6.3m of it. 45 of 426 filers swept carry a second currency,
// and a foreign private issuer publishing a USD convenience translation beside its own statements is
// the ordinary case rather than the exotic one.
export function reportingCurrency(facts, tags) {
  const byEnd = new Map();
  for (const tag of tags || []) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    for (const f of all) {
      if (!isDuration(f) || !periodic(f.form)) continue;
      const d = days(f.start, f.end);
      if (d < ANNUAL_MIN || d > ANNUAL_MAX) continue;
      const c = currencyOf(f.unit);
      if (!c) continue;
      if (!byEnd.has(f.end)) byEnd.set(f.end, new Map());
      const m = byEnd.get(f.end);
      m.set(c, (m.get(c) || 0) + 1);
    }
  }
  if (!byEnd.size) return null;
  // ── Recent first, which is rule 6 again ────────────────────────────────────────────────────────
  // Decided on the NEWEST anchor period alone, not on a majority across all history, because a filer
  // that CHANGES reporting currency has more of the old one on file and reports today in the new one.
  // BetterLife Pharma files 21 USD annual anchors against 14 CAD and its newest year is CAD only: a
  // majority picked USD and blanked 90 cells, the newest column among them — the one the valuation
  // divides into. Silver North is the same shape. The newest period is also the only one whose
  // currency a reader can check against the filing they are most likely to open.
  const newest = [...byEnd.keys()].sort().pop();
  const m = byEnd.get(newest);
  // ── A USD figure filed BESIDE a local one is the translation, not the statements ───────────────
  // A foreign private issuer publishing a convenience translation files both for every period, so the
  // newest period is a tie and the tie-break decides the whole sheet. USD is the wrong half to keep:
  // the translation is what gets added, and Futu, Vipshop, Recon and SFHG all file their statements
  // in HKD or CNY with a USD column beside them. A filer that genuinely reports in USD — Israeli tech,
  // shipping — files USD alone at the anchors and never reaches this line.
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] === "USD" ? 1 : b[0] === "USD" ? -1 : a[0].localeCompare(b[0])))[0][0];
}

// Pick the single best fact for a template line in a given period.
// `period` is { end, start } for durations, or { end } for instants.
export function pickFact(facts, tags, period, opts = {}) {
  const wantDuration = !!period.start;
  const minD = opts.minDays ?? ANNUAL_MIN, maxD = opts.maxDays ?? ANNUAL_MAX;
  let sawTag = false, sawTagOtherPeriod = false, otherCcy = null, zeroHit = null;

  for (const tag of tags || []) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    sawTag = true;
    const matches = all.filter(f => {
      // Money must be in the sheet's currency. Anything that is not money — share counts, ratios,
      // the filer's own count units — is unaffected, and a fact in the wrong currency is skipped
      // rather than converted: there is no exchange rate anywhere in this data path and there is not
      // going to be one. Mixing them is what would make `revenue − cogs` wrong by an FX rate while
      // both figures still looked like the numbers the filer reported.
      //
      // Tested AFTER the period tests, not before, so that what gets remembered in `otherCcy` is a
      // fact this line would OTHERWISE HAVE USED. Ordered the other way it remembers any fact in
      // another currency anywhere in the filer's history, and the row then claims a figure exists for
      // a year it does not — the note would be a worse lie than the blank it replaces.
      if (wantDuration !== isDuration(f)) return false;
      if (f.end !== period.end) return false;
      // Rule 32 reads a row INSIDE one filing — the same tag order, the same period and currency
      // tests, restricted to one accession — so a balance sheet can be re-drawn from a single
      // presentation with the row's own fallbacks intact.
      if (opts.accn && f.accn !== opts.accn) return false;
      if (wantDuration) { const d = days(f.start, f.end); if (d < minD || d > maxD) return false; }
      if (opts.ccy) {
        const c = currencyOf(f.unit);
        if (c && c !== opts.ccy) { if (periodic(f.form)) otherCcy = c; return false; }
      }
      return true;
      // ── Only the periodic reports ──────────────────────────────────────────────────────────
      // A 10-K or 10-Q IS the financial statements. An 8-K exhibit is a press release, a pro-forma
      // or a recast of a combination, and a DEF 14A carries `NetIncomeLoss` inside the
      // pay-versus-performance table. All three are filed under the same tags for the same periods,
      // and rule 2 — newest filed wins — was handing them the sheet.
      //
      // Black Diamond Therapeutics reported net income of MINUS $69.68bn from a proxy statement
      // against a real minus $70m, printing an ROE of −83,660%, which the small/mid-cap sweep had
      // filed under "correct for a biotech". Essential Utilities is subtler and worse: its FY2023
      // operating income is $0.692bn in three successive 10-Ks and $1.504bn in an 8-K filed a month
      // after the newest, with D&A and net income doubled to match — a bigger entity than the one it
      // reports. The sheet paired the 10-K's revenue with the 8-K's operating income and printed
      // EBITDA ABOVE REVENUE for three straight years. That impossibility was first read as a
      // revenue-tag problem, and "fixing" it by reordering the rule 9 list would have made revenue
      // wrong as well.
      //
      // Preferring periodic filings is not enough, because a concept can appear ONLY outside them:
      // Essential Utilities files `NetIncomeLossAvailableToCommonStockholdersBasic` in the 8-K and
      // nowhere else, and the Schwab repair below then lifted it straight into net income. So they
      // are excluded outright. Measured across 167 filers: 864 values corrected, 39 lost — seven
      // cells in total, all in the oldest column of two sheets and all minor lines.
    }).filter(f => periodic(f.form));
    if (!matches.length) { if (all.length) sawTagOtherPeriod = true; continue; }
    // Rule 2 — newest filing wins, and among equals prefer the annual report over a quarterly one.
    // Everything reaching here is already a periodic report, so the filed date is deciding between
    // a 10-K and the 10-Q that restated it, which is exactly what it should decide.
    matches.sort((a, b) => (b.filed || "").localeCompare(a.filed || "") || rank(b.form) - rank(a.form));
    const f = descaled(matches, matches[0]);
    const hit = { value: f.val, unit: f.unit, tag, accn: f.accn, form: f.form, filed: f.filed, end: f.end, start: f.start, status: "reported",
      // Rule 31: a fact rebased for a split says so, and carries what the filing actually shows.
      ...(f.splitFactor ? { status: "split-adjusted", filedValue: f.filedVal, splitFactor: f.splitFactor, splitMark: f.splitMark, splits: f.splits } : {}) };
    // ── Rule 24: a ZERO is a fact, and on some rows it is not evidence of absence ─────────────────
    // `pickFact` takes the first candidate with a fact for the period, and a fact of 0 is a fact — the
    // mechanism behind rule 7's Progressive case, which tagged `LongTermDebtCurrent` as literally 0
    // while reporting its real $6.9bn under another concept, and printed "Total debt 0".
    //
    // Opt-in per row, because a zero is usually the reported truth and displacing it would be worse.
    // See the row that declares it for the evidence, and the README for the counter-example that keeps
    // this off the debt rows: `LongTermDebtNoncurrent` filed as 0 by a company in Chapter 11 is
    // CORRECT — its debt has been reclassified — and taking the non-zero sibling there would put
    // $15.2bn of iHeartMedia's debt back on a line the filing had deliberately emptied.
    if (opts.preferNonZero && f.val === 0) { if (!zeroHit) zeroHit = hit; continue; }
    return hit;
  }
  // Every candidate that had a fact for this period reported zero, so zero is what the filer says.
  if (zeroHit) return zeroHit;
  // Nothing landed. Which kind of nothing is it? Rule 5 — and rule 20 added a fifth kind.
  //
  // "Not tagged" means *disclosed in the filing but never tagged — go and look*, which is the one
  // blank worth spending time on. A line the filer DID tag, for THIS period, in another currency is
  // not that: it is tagged, it is findable, and it is in dollars on a sheet denominated in yuan.
  // Sending a reader into a 20-F to hunt for a figure that is sitting there in the wrong unit is the
  // same wasted trip rule 5 exists to prevent, and it is the ordinary case rather than the rare one —
  // a foreign issuer quotes its ADS option strikes and dividends per share in USD while reporting the
  // statements in its own currency. 112 cells across 11 filers, against 2 columns on one filer for
  // the whole-column version of this (a filer that actually CHANGED reporting currency, which is
  // BetterLife Pharma and nobody else in 389 filers — too rare to have earned a mechanism of its own,
  // and it falls out of this one anyway as a column of these).
  if (otherCcy) return { value: null, status: "other-currency", ccy: otherCcy };
  return { value: null, status: sawTagOtherPeriod ? "untagged-this-period" : sawTag ? "untagged-this-period" : "never-tagged" };
}
const rank = form => (form === "10-K" ? 3 : form === "10-Q" ? 2 : 1);

// ── Rule 17: an AMENDMENT can carry the right digits at the wrong scale ─────────────────────────
// Rule 13 shut the door on the pay-versus-performance table by excluding DEF 14A. The restatement
// frame found the same failure with a second door: an amendment IS a periodic report by rule 13's own
// regex, and rule 2 gives it the sheet. **Identiv filed FY2021 net income as $1,620,000 in three
// consecutive 10-Ks and as $1,620,000,000,000 in a 10-K/A** — the same digits with six extra zeros —
// and the terminal printed a $1.62 TRILLION net income for a company with $110m of revenue.
//
// Two hypotheses were measured first and both failed, which is why this one is so narrow.
// "A Part III amendment carries no financial statements, so it supplies few tags" does not separate
// them at all: the amendments that disagree wildly supply a MEDIAN OF 46 template tags, because they
// are genuine re-filings. And amendments that disagree are overwhelmingly LEGITIMATE — of 109 sheet
// cells where one overrode a periodic report with a different value, 108 are restatements that a
// reader wants, and rule 2 is right about every one of them.
//
// What separates the one is that a restatement changes the DIGITS and a scale error moves the decimal
// point. So the test is an exact power of ten — and that alone is still not enough, because it fires
// in both directions: Middlesex Water tags its share count in thousands in some filings and in units
// in others, and there the AMENDMENT is the correct one. The discriminator is corroboration. Across
// all 29 power-of-ten disagreements in the frame, Identiv's is the only one where **no periodic filing
// anywhere agrees with the amendment's value** while two or more agree with the other. Middlesex's
// amended scale is corroborated by two; National HealthCare's by two, and there the amendment is right
// and rule 2 already takes it.
//
// So: uncorroborated, off by exactly a power of ten, and outvoted. Anything less than all three leaves
// the sort exactly as it was, which is what 108 of the 109 get.
const POW10 = (a, b) => {
  if (!a || !b) return false;
  const e = Math.log10(Math.abs(a) / Math.abs(b));
  return Math.abs(e - Math.round(e)) < 1e-9 && Math.round(e) !== 0;
};
function descaled(matches, winner) {
  if (!/\/A$/.test(winner.form || "")) return winner;
  const accns = v => new Set(matches.filter(m => !/\/A$/.test(m.form || "") && m.val === v).map(m => m.accn));
  if (accns(winner.val).size) return winner;            // some report agrees with it — not a scale slip
  const rival = matches.find(m => !/\/A$/.test(m.form || "") && POW10(winner.val, m.val)
    && accns(m.val).size >= 2);
  return rival || winner;
}
// The periodic reports, their transition-period variants and their amendments — the filings that ARE
// the financial statements. Everything else is supplementary, and this engine does not read it.
const periodic = form => (/^(10-K|10-Q|20-F|40-F)T?(\/A)?$/.test(String(form)) ? 1 : 0);

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
// ── A line item is a SERIES, and the tag carrying the series IS the line ────────────────────────
// Rule 21. Where a filer files two concepts for the same row, which one the sheet shows was decided
// by the order of the tag list — and no fixed order can be right, because the filers that file both
// do not agree about which is the total.
//
// Caterpillar files `CostOfRevenue` every year from 2018 at $35–45bn, and from 2022 ALSO files
// `CostOfGoodsAndServicesSold` at $413m, $160m, $33m — a component, roughly 0.1% of revenue. The list
// put the component first, so the sheet showed 1% of Caterpillar's cost of sales for four straight
// years, and a gross margin of 99%. Nothing caught it: the identity that would (gross profit =
// revenue − cost) needs a TAGGED gross profit, and Caterpillar does not tag one.
//
// Reordering the list was measured and rejected — of the filers that file both with different values,
// ten have `CostOfRevenue` larger and six have `CostOfGoodsAndServicesSold` larger, so either order is
// right for one group and wrong for the other. Tronox Uplift and Fortitude Gold file `CostOfRevenue`
// as literally zero.
//
// The filer settles it, which is rule 15's shape and rule 6's measure: a row is a series, and a tag
// appearing for the last four years at 1% of the incumbent's magnitude is not the same line. So the
// candidates are ranked ONCE per sheet by their longest unbroken run across the sheet's own calendar,
// ties keeping the list's order, and the winner is used for every column — a row cannot change which
// concept it means halfway across the page. Across all six frames only three filers have two cost
// concepts that disagree in the newest column, and this changes two: Caterpillar, from 0.1% of revenue
// to 66.2%, and B.O.S. Better Online by 1.7%.
// Rule 23. Rule 21's run length is a proxy for "which concept is this row", and a proxy loses to the
// filer's own arithmetic wherever the filer supplies it. Where a company tags a SUBTOTAL that the row
// participates in — gross profit, for the cost row — the candidate that makes the identity close is
// the line, and nothing else needs deciding.
//
// It exists because run length picks the wrong one at Air Industries: it tags
// `CostOfGoodsAndServicesSold` at $0.1m for 2019 and 2020 and at $45m from 2021, so the PLACEHOLDER's
// unbroken run (5) beats `CostOfRevenue`'s (4) and the sheet showed $0.1m of cost against $50m of
// revenue. Ranking by coverage instead was measured and REJECTED — it fixes Air Industries and breaks
// AIOS Tech, whose tagged gross profit says `CostOfRevenue` is right there (386.7 − 346.7 = 40.0, to
// the dollar). One filer traded for another is rule 11's trap, and the identity settles both.
//
// Scored across the sheet rather than per column, because rule 21's claim is that a row means one
// concept for the whole page. A filer tagging no subtotal scores every candidate zero and falls
// through to the run-length ranking unchanged, which is every filer but two.
// The revenue row (rule 33) uses the same identity from the other end: the candidate is the MINUEND,
// so `plusTags` names the row to add back — revenue = grossProfit + cogs — and `minusTags` is unused.
// Capstone Energy Plus is why: its `Revenues` closes gross profit to the dollar in every year while the
// ASC 606 tag it also files is a product-only slice, and run length alone would have picked the slice.
export function tagsByIdentity(facts, tags, periods, minusTags, equalsTags, plusTags) {
  if (!tags || tags.length < 2) return null;
  const score = new Map(tags.map(t => [t, 0]));
  let evidence = 0;
  for (const p of periods) {
    const whole = pickFact(facts, plusTags || minusTags, p, {});
    const part = pickFact(facts, equalsTags, p, {});
    if (whole.value == null || part.value == null) continue;
    const want = plusTags ? part.value + whole.value : whole.value - part.value;
    const tol = Math.max(Math.abs(want) * 1e-4, 1000);
    for (const t of tags) {
      const got = pickFact(facts, [t], p, {});
      if (got.value == null) continue;
      evidence++;
      if (Math.abs(got.value - want) <= tol) score.set(t, score.get(t) + 1);
    }
  }
  if (!evidence || ![...score.values()].some(n => n > 0)) return null;
  return [...tags].sort((a, b) => score.get(b) - score.get(a));
}

export function tagsByRun(facts, tags, ends) {
  if (!tags || tags.length < 2 || !ends || !ends.length) return tags;
  const order = new Map(tags.map((t, i) => [t, i]));
  const runOf = tag => {
    const all = factsFor(facts, tag);
    if (!all) return 0;
    const have = new Set();
    for (const f of all) {
      if (!isDuration(f) || !periodic(f.form)) continue;
      const d = days(f.start, f.end);
      if (d >= ANNUAL_MIN && d <= ANNUAL_MAX) have.add(f.end);
    }
    let best = 0, cur = 0;
    for (const e of ends) { cur = have.has(e) ? cur + 1 : 0; if (cur > best) best = cur; }
    return best;
  };
  const runs = new Map(tags.map(t => [t, runOf(t)]));
  // Rule 33: a concept that does not reach the NEWEST column ranks below every one that does, whatever
  // its run — rule 6's "recent first, then deep", on the pin. Alphabet's ASC 606 tag runs seven years
  // and stops before FY2025 while `Revenues` reaches it; pinned by run alone, the newest column fell
  // through to `Revenues` regardless, and the LTM stitch, which reads only the concept the annual
  // column chose, found no interim facts under the 606 tag and went blank.
  const newest = ends[ends.length - 1];
  const reaches = new Map(tags.map(t => [t, (factsFor(facts, t) || []).some(f => isDuration(f) && periodic(f.form) && f.end === newest && days(f.start, f.end) >= ANNUAL_MIN && days(f.start, f.end) <= ANNUAL_MAX) ? 1 : 0]));
  // Only reorders where a LONGER run exists further down the list; a tag nothing reaches keeps its
  // place, so a filer that files one concept resolves exactly as it did before.
  return [...tags].sort((a, b) => reaches.get(b) - reaches.get(a) || runs.get(b) - runs.get(a) || order.get(a) - order.get(b));
}

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
      // Rule 13 applies HERE too, and it did not. `pickFact` refuses to fill a cell from anything but
      // a periodic report, but this function — which decides that a column EXISTS — took any form at
      // all, so the two halves of the engine disagreed about which filings count. A period only a
      // proxy statement reports is not a fiscal year the sheet has a column for.
      //
      // Invisible until the annual window tightened, because the same end date was also carried by a
      // fresh-start stub that got there first. Seadrill files its 2022 as a 311-day successor period
      // in the 20-F and as a full 364-day year in a DEF 14A; Vroom's 2025 is the same shape. With the
      // stub excluded, the proxy's period was the only one left, so both rendered a column the whole
      // of rule 13 then refused to fill — every duration line blank under a populated equity balance,
      // which reads as "the filer did not tag this" when the truth is that the year does not exist in
      // this shape at all. Rule 5's complaint, arriving on a whole column.
      if (!periodic(f.form)) continue;
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
  // "Deepest" has to mean deepest WITHOUT A HOLE, or a discontinuous tag wins on a count of years it
  // does not actually cover. Thermo Fisher tags `NetIncomeLoss` for 2007–2013 and again for 2021–2025
  // and nothing in between, which is twelve periods against the ten contiguous ones its ASC 606
  // revenue tag reaches — so counting years picked the tag with the hole and the sheet rendered
  // FY2011, FY2012, FY2013, FY2021 … FY2025: three of its eight columns twelve years old, on a
  // mega-cap. Rule 6 already says recent first, then deep; this is what "deep" had to mean, and the
  // measure is the run back from the newest period rather than the size of the set.
  const contiguous = m => {
    const ps = [...m.values()].sort((a, b) => b.end.localeCompare(a.end));
    let n = 1;
    // "Adjacent" has a lower bound as well as an upper one, and it did not. `<= 1` accepts a gap of a
    // day (filers differ on whether the next year starts on the previous end date or the day after)
    // and it also accepted a gap of MINUS 273 days — an overlap — so a ladder of rolling twelve-month
    // periods counted as one unbroken run. Amazon files `NetIncomeLoss` for the trailing twelve months
    // to every quarter end in every 10-Q, 74 annual-length periods overlapping by nine months each,
    // and that scored 74 against the ten calendar years its revenue tag reaches. The sheet rendered
    // eight columns ending 30 June with a blank income statement in all of them, because the periods
    // exist only for net income and `nonOverlapping` then kept one in four. A day either side is the
    // slack; anything past it is an overlap, and an overlap is what a rolling ladder IS. Measured over
    // the 180 cached filers: exactly one calendar changes, Amazon's, to its December years.
    while (n < ps.length && ps[n - 1].start && Math.abs(days(ps[n].end, ps[n - 1].start)) <= 1) n++;
    return n;
  };
  const best = current.reduce((a, b) => {
    const [ca, cb] = [contiguous(a), contiguous(b)];
    return cb > ca || (cb === ca && b.size > a.size) ? b : a;
  });
  // Filter BEFORE the slice, or a discarded calendar eats column slots the real one needed.
  return dedupeLabels(nonOverlapping([...best.values()].sort((a, b) => b.end.localeCompare(a.end))).slice(0, limit));
}

// ── Two calendars at once ───────────────────────────────────────────────────────────────────────
// A filer that CHANGES ITS FISCAL YEAR END reports on both calendars for the years either side of
// the change, and the periods are keyed above by END DATE, so both survive as distinct entries and
// the sheet interleaves them. Powerfleet moved from December to March and rendered eight annual
// columns whose periods were 2021-01-01→2021-12-31, 2021-04-01→2022-03-31, 2022-01-01→2022-12-31,
// 2022-04-01→2023-03-31 … — each pair overlapping by NINE MONTHS, eight "years" spanning about five,
// and every growth rate between adjacent columns comparing a period with itself. Republic Airways
// and three others are the same. It is rule 6's failure a third way: a sheet that foots, reconciles
// and is not about the years it says.
//
// The duplicate FY labels were only the symptom, and the label cascade is why it was visible at all —
// with two calendars in play it produced "2021 2022 2021 2022 2023", running BACKWARDS, which is the
// one thing a reader cannot miss. Renaming them would have hidden the overlap instead of fixing it.
//
// The rule is structural and needs no fiscal-year convention, which matters because filers do not
// share one: walking NEWEST to OLDEST, keep a period only if it ends on or before the start of the
// last one kept. That anchors on the current calendar — the same "recent first, then deep" discipline
// as the tag selection above — and the abandoned calendar falls away on its own. Touching periods are
// kept (`<=`), because some filers tag the next year as starting on the previous year's end date and
// a strict test would silently drop a real column.
//
// The stub period the change creates is already excluded by the 300–400 day window, so a gap can
// remain where it sat: Republic keeps years to Sep-2022 and Dec-2023 with the three-month transition
// between them absent, which is correct — it is not twelve months and nothing on this sheet pretends
// a period is longer than it is.
function nonOverlapping(desc) {
  const out = [];
  for (const p of desc) {
    if (!p.start) continue;
    if (!out.length || p.end <= out[out.length - 1].start) out.push(p);
  }
  return out;
}

// A 52/53-week filer drifts backwards through the calendar until a fiscal year ends on 1 January,
// and then TWO periods end in the same year: J&J's ran to 2023-01-01 and 2023-12-31, so the sheet
// printed "FY2023" over both. Labelling from the period end already fixed this for its other cause
// (XBRL's `fy`, which is the year of the REPORT a fact was filed in) — this is the same wrong label
// arriving by a different route, and it is worse than it looks, because the two columns are a full
// year apart and nothing on the page says which is which.
//
// The label is NOT recomputed from a fiscal-year convention, because filers do not share one:
// Walmart calls the year ending 31 Jan 2026 "fiscal 2026" and Home Depot calls the year ending
// 1 Feb 2026 "fiscal 2025". Picking either rule would mislabel the other company. All that is
// enforced is uniqueness — the earlier of a colliding pair drops a year, which is the convention a
// 52/53-week filer uses anyway (J&J's year to 1 Jan 2023 is its fiscal 2022) — and the exact period
// end stays printed underneath, which is what actually disambiguates.
// Walks NEWEST to OLDEST so a decrement cascades into the pair behind it. Running the other way
// fixes the first collision and creates a second: J&J's 2023-01-01 became FY2022 and promptly
// collided with the real 2022-01-02, printing "FY2022" twice instead of "FY2023" twice.
function dedupeLabels(periods) {
  for (let i = 1; i < periods.length; i++) {               // the list arrives newest-first
    if (periods[i].fy === periods[i - 1].fy) periods[i] = { ...periods[i], fy: periods[i].fy - 1 };
  }
  return periods;
}

// Some facts are "as of the latest filing", not "as of a fiscal period". The cover-page share
// count is the one that matters: its date is the COVER date — 2025-10-17 for a year ending
// 2025-09-27 — so matching it against period ends finds nothing, ever. That silently emptied book
// value per share, tangible book, market cap and every multiple built on them. Take the newest.
// `notBefore` is the filer's OWN newest periodic report, not a wall clock. The cover-page share
// count is the one input market capitalisation is built on, and companyfacts carries only the
// UNDIMENSIONED `dei` fact — so a filer that moved to a per-class cover page simply stops appearing
// here, and `latestFact` goes on returning whatever it last filed. UPS's count is from **2010**
// (713,924,267 against ~848m today) and Comcast's from 2010 (2.06bn against ~3.7bn); Nike's is from
// 2015 and Sony's from 2019. Those printed market caps, enterprise values, P/E and P/B that were
// wrong by a decade of buybacks and issuance and looked entirely ordinary.
//
// **The population separates, which is why this is a rule and not a judgement.** Across 148 filers
// the lag between that fact's filing date and the filer's newest report is 0 days at the median,
// 91 at p90 — and then jumps straight to **2,557 days**. Nothing at all lands between 200 days and
// seven years. 400 days is chosen inside that gap: comfortably past an annual-only filer plus a late
// filing, and nowhere near the cliff. It blanks 9 of 148.
//
// A count of **ZERO** is rejected outright and is a different failure: Simon Property, Paramount and
// iHeartMedia all file 0, which made market capitalisation $0 and left enterprise value silently
// equal to net debt — SPG showed a $28.91bn EV with no equity in it. A listed company cannot have
// zero shares, so this is a tagging artifact rather than a fact, and rule 24's `preferNonZero` is no
// help: for SPG the next non-zero candidate is from 2009, which trades a visibly broken number for
// an invisibly wrong one. Both cases fail CLOSED.
export const COVER_STALE_DAYS = 400;
export function latestFact(facts, tags, opts = {}) {
  let best = null, rejected = null;
  for (const tag of tags || []) {
    const all = factsFor(facts, tag);
    if (!all) continue;
    for (const f of all) if (!best || f.end > best.end) best = { ...f, tag };
  }
  if (!best) return { value: null, status: "never-tagged" };
  if (opts.mustBeCurrent) {
    if (best.val === 0) rejected = "cover-zero";
    else if (opts.notBefore && best.filed && days(best.filed, opts.notBefore) > COVER_STALE_DAYS) rejected = "cover-stale";
    if (rejected) return { value: null, status: rejected, filed: best.filed, staleValue: best.val, tag: best.tag };
  }
  return { value: best.val, unit: best.unit, tag: best.tag, accn: best.accn, form: best.form, filed: best.filed, end: best.end, status: "reported" };
}

// ── Rule 31: a stock split restates only the years the newest filing reaches ────────────────────
// `epsBasic`, `epsDil`, `dps` and the two share counts are fetched per period, and rule 2 takes each
// period from the NEWEST filing carrying it. A 10-K restates two prior years as comparatives, so after
// a split the years inside the newest filings are on the new share basis and older years keep the
// pre-split figures from their own filings. Every cell is correct and the SERIES is a fabrication:
// NVIDIA read 6.63 | 1.13 | 1.73 | 3.85 | 0.17 | 1.19 | 2.94 | 4.90 with EPS growth of −83.0% and
// −95.6% at its two split boundaries; Alphabet 49.16 → 2.93; Netflix's LTM column −6.80 for a company
// that has never lost money, because its three legs sat on two bases.
//
// The data to fix it is in the payload. A split is the one restatement that moves EPS and the share
// count by the SAME ratio in OPPOSITE directions and leaves net income where it was — and companyfacts
// carries every period as filed by every filing, so where two filings state one period on two bases
// the ratio between them IS the split factor. The evidence is asked for three ways, measured over the
// 830 double-filed per-share and count observations across 180 cached filers:
//   · the share count moved by a clean ratio, to 0.5% (real splits sit within 0.46%; the nearest
//     refused record is 0.86% off, and it is not a split), and a per-share row moved by its inverse
//     inside the rounding of two 2dp figures — BOTH, or nothing. Alphabet is the one exception: its
//     counts are filed per class, so companyfacts carries none, and there two per-share rows over two
//     periods are accepted where the counts are silent and the ratio is not a power of ten (Brown &
//     Brown files a quarter's EPS at the wrong decimal, ×100, with no count moving);
//   · net income for that period is unchanged between the two filings where both carry it — every
//     real split has it, every restatement moves it (AIG 2021 ×1.10, Caterpillar 2015 ×1.19, Allstate
//     2017 ×1.12 are one-witness clean-looking ratios that this test refuses);
//   · the new basis PERSISTS in every later filing of that period — a quarter re-filed once and then
//     re-filed back is noise, not a basis.
// Admissible ratios are whole numbers and 3-for-2 and 5-for-4 (Old Dominion, Raymond James, W. R.
// Berkley, Essential Utilities); 4/3, 6/5, 9/8, 11/10 and 7/2 are every one a restatement in the
// census and never qualify, and a count moving by a thousand (units against thousands) is not on the
// list either, so a scale shift can never read as a split. Applied over the cache this finds 33 filers and 47 events, every
// one checked against the filer's own split history; Tulip's 1-for-7 is the one real split it
// declines, because Tulip restated the same years afterwards and the new basis does not persist.
//
// WHAT IS DONE WITH IT is a carry-back, not an adjustment of the newest figures: a per-share fact
// filed before the first post-split filing is divided by the factor and a count multiplied, cumulative
// across events (NVIDIA's FY2019 EPS is ÷40: 4-for-1 in 2021, 10-for-1 in 2024). That is rule 2's own
// principle — the figure the company stands behind today, restatements included — reaching the years
// the newest filing does not, using the factor the filer itself established. It is applied to the
// FACTS, once, before anything reads them, so annual columns, LTM legs and comps all inherit one basis.
// The cell keeps its tag, accession and filing date — the link opens the filing that shows the figure
// as reported — and gains a status, the filed value and the factor, so every surface can say what was
// done: the cell carries a marker, the row a note, the workbook a line. The header's promise that
// every figure is the value the company filed is kept by saying, wherever this fires, that this one is
// the value the company filed on another share basis.
export const SPLIT_PER_SHARE = ["EarningsPerShareBasic", "EarningsPerShareDiluted", "CommonStockDividendsPerShareDeclared"];
export const SPLIT_COUNTS = ["WeightedAverageNumberOfSharesOutstandingBasic", "WeightedAverageNumberOfDilutedSharesOutstanding"];
const SPLIT_NI = ["NetIncomeLoss", "ProfitLoss"];
const SPLIT_KS = [...Array.from({ length: 99 }, (_, i) => i + 2), 1.5, 1.25];
const pow10 = k => { const e = Math.log10(k); return Math.abs(e - Math.round(e)) < 1e-9; };
// Every filing of one tag for one period, oldest filing first, periodic reports only.
function splitObs(facts, tag) {
  const def = facts[tag], m = new Map();
  if (!def) return m;
  for (const [unit, arr] of Object.entries(def.units || {})) for (const f of arr) {
    if (!periodic(f.form) || f.val == null) continue;
    const key = `${f.start || ""}|${f.end}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push({ val: f.val, filed: f.filed || "", accn: f.accn, unit });
  }
  for (const arr of m.values()) arr.sort((a, b) => a.filed.localeCompare(b.filed) || String(a.accn).localeCompare(String(b.accn)));
  return m;
}
const nearestSplitK = r => { let best = null; for (const k of SPLIT_KS) for (const K of [k, 1 / k]) { const dev = Math.abs(r / K - 1); if (!best || dev < best.dev) best = { K: k, dev }; } return best; };
// The admissible ratios inside the rounding interval of two 2dp figures — a $0.05 EPS that became
// $0.45 is ×9 to the digit and ×10 within rounding, and the count decides which.
const splitKSet = (a, b) => { const lo = (Math.abs(a) - 0.005) / (Math.abs(b) + 0.005), hi = (Math.abs(a) + 0.005) / Math.max(Math.abs(b) - 0.005, 0.0001); const out = new Set(); for (const k of SPLIT_KS) for (const K of [k, 1 / k]) if (K >= lo * 0.995 && K <= hi * 1.005) out.add(k); return [...out]; };
function splitSteps(facts, tag, isCount) {
  const out = [];
  for (const [key, arr] of splitObs(facts, tag)) for (let i = 1; i < arr.length; i++) {
    const a = arr[i - 1], b = arr[i];
    if (a.val === b.val || !a.val || !b.val || Math.sign(a.val) !== Math.sign(b.val)) continue;
    const r = Math.abs(a.val / b.val);
    const n = nearestSplitK(r);
    const ks = isCount ? (n.dev <= 0.005 ? [n.K] : []) : splitKSet(a.val, b.val);
    if (!ks.length) continue;
    const near = (x, y) => Math.abs(x - y) <= Math.abs(y) * 0.005 + (isCount ? 0 : 0.005);
    const persists = arr.slice(i + 1).every(x => near(x.val, b.val));
    // ...and a value the period was filed at BEFORE is a correction back, not a new basis: a quarter
    // filed at 1.00, re-filed at 0.50 and filed at 1.00 again is noise in both directions.
    const reverts = arr.slice(0, i).some(x => near(x.val, b.val));
    if (!persists || reverts) continue;
    out.push({ key, tag, K: ks.length === 1 ? ks[0] : n.K, ks, forward: isCount ? r < 1 : r > 1, from: a, to: b });
  }
  return out;
}
function splitNiSame(facts, key, accnA, accnB) {
  for (const tag of SPLIT_NI) {
    const m = splitObs(facts, tag).get(key); if (!m) continue;
    const a = m.find(x => x.accn === accnA), b = m.find(x => x.accn === accnB);
    if (a && b) return Math.abs(a.val - b.val) <= Math.abs(a.val) * 0.001;
  }
  return null;
}
export function splitEvents(facts) {
  const counts = SPLIT_COUNTS.flatMap(t => splitSteps(facts, t, true));
  const shares = SPLIT_PER_SHARE.flatMap(t => splitSteps(facts, t, false));
  if (!counts.length && !shares.length) return [];
  const byFiled = (a, b) => a.to.filed.localeCompare(b.to.filed);
  const fits = (c, x) => x.forward === c.forward && c.from.filed < x.newFrom && c.to.filed > x.oldUntil
    && Math.abs(Date.parse(c.to.filed) - Date.parse(x.newFrom)) < 400 * 86400000;
  const clusters = [];
  // Count steps seed the clusters, because a count is exact; a per-share step joins the cluster whose
  // ratio its rounding interval admits, and seeds one only when that interval admits exactly one.
  for (const c of [...counts.sort(byFiled), ...shares.sort(byFiled)]) {
    const isCount = SPLIT_COUNTS.includes(c.tag);
    const ni = splitNiSame(facts, c.key, c.from.accn, c.to.accn);
    if (ni === false) continue;
    let cl = clusters.find(x => (isCount ? x.K === c.K : c.ks.includes(x.K)) && fits(c, x));
    if (!cl && !isCount && c.ks.length !== 1) continue;
    if (!cl) { cl = { K: c.K, forward: c.forward, oldUntil: c.from.filed, newFrom: c.to.filed, count: 0, perShare: 0, rows: new Set(), periods: new Set(), niSame: 0 }; clusters.push(cl); }
    if (c.from.filed > cl.oldUntil) cl.oldUntil = c.from.filed;
    if (c.to.filed < cl.newFrom) cl.newFrom = c.to.filed;
    if (isCount) cl.count++; else { cl.perShare++; cl.rows.add(c.tag); }
    cl.periods.add(c.key); if (ni === true) cl.niSame++;
  }
  const countSilent = cl => !counts.some(st => st.from.filed < cl.newFrom && st.to.filed > cl.oldUntil && st.K !== cl.K);
  return clusters.filter(cl => cl.oldUntil < cl.newFrom && (
    (cl.count > 0 && cl.perShare > 0) ||
    (cl.count === 0 && countSilent(cl) && cl.rows.size >= 2 && cl.periods.size >= 2 && cl.niSame >= 2 && !pow10(cl.K))))
    .map(cl => ({ K: cl.K, forward: cl.forward, oldUntil: cl.oldUntil, newFrom: cl.newFrom, count: cl.count, perShare: cl.perShare, periods: cl.periods.size }))
    .sort((a, b) => a.newFrom.localeCompare(b.newFrom));
}
const fmtK = k => (Number.isInteger(k) ? String(k) : String(+k.toFixed(2)));
// One sentence naming the events, for the row note, the workbook and the TSV.
export const describeSplits = events => events.map(e => `${e.forward ? `${fmtK(e.K)}-for-1 split` : `1-for-${fmtK(e.K)} reverse split`} (first reported ${e.newFrom})`).join(", ");
// Rebase the five tags' facts filed before each event's first post-split filing. Returns a NEW facts
// object; the payload is never mutated, and a filer with no event gets the same object back.
export function applySplits(facts, events) {
  if (!events || !events.length) return facts;
  const out = { ...facts };
  for (const tag of [...SPLIT_PER_SHARE, ...SPLIT_COUNTS]) {
    const def = facts[tag]; if (!def) continue;
    const perShare = SPLIT_PER_SHARE.includes(tag);
    const units = {};
    for (const [unit, arr] of Object.entries(def.units || {})) units[unit] = arr.map(f => {
      let factor = 1; const applied = [];
      for (const e of events) if (f.filed && f.filed < e.newFrom) { factor *= e.forward ? e.K : 1 / e.K; applied.push(e); }
      if (factor === 1) return f;
      const up = factor >= 1;
      return { ...f, val: perShare ? f.val / factor : f.val * factor, filedVal: f.val, splitFactor: factor, splits: applied,
        splitMark: `${perShare === up ? "÷" : "×"}${fmtK(up ? factor : 1 / factor)}` };
    });
    out[tag] = { ...def, units };
  }
  return out;
}

// ── Trailing twelve months ─────────────────────────────────────────────────────────────────────
// A comps set built on each company's OWN fiscal year is comparing different twelve-month windows.
// Across the 97-filer corporate sample the fiscal-year ends spread over ELEVEN months — Intuit's
// year to 31 Jul 2025 sitting in the same table as Microsoft's to 30 Jun 2026 — and printing those
// side by side under one heading is the most common way a comps page misleads. Stitching each
// company forward to its most recent quarter closes that spread to three months.
//
// LTM = last full year + this year's year-to-date − last year's same year-to-date. The differencing
// is not optional: income and cash-flow figures in a 10-Q are CUMULATIVE from the fiscal year start,
// so adding a Q3 figure to a full year would double-count nine months of it.
//
// A sketch of this lived here unused since the first version, and both of its rules were wrong in
// ways that would have printed a confident number:
//
//   It took the FIRST tag with any 10-Q match and stopped — the Lincoln National / Equinix failure
//   of rule 6, in the interim data. Microsoft stopped tagging `Revenues` years ago, so it resolved a
//   year-to-date period ending 2010-12-31 and would have stitched a 2026 sheet onto a 2010 quarter.
//
//   It took whichever span turned up first at that period end. A 10-Q files BOTH the discrete
//   quarter and the year-to-date span under the same tag with the same end date, and the discrete
//   quarter is not a valid leg: FY + Q3 − prior Q3 keeps three quarters of the OLD year and drops
//   three of the new one. Same units, plausible magnitude, wrong twelve months.
const shift = (d, n) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);
const YTD_MIN = 60, YTD_MAX = 320;     // one quarter to three, allowing for 52/53-week drift

// One rung of the ladder: the year-to-date span inside the fiscal year that FOLLOWS `fy`, ending as
// close to `wantEnd` as the filer's own quarter dates allow. `span` pins the shape — it is null for
// the newest rung, which is what DEFINES the shape for every rung behind it.
// Longest-at-that-end is what separates the year-to-date span from the discrete quarter filed beside
// it; matching the START to the fiscal year is what proves it is a year-to-date span at all.
function ytdRung(facts, tags, fy, { wantEnd = null, span = null, interimOnly = false } = {}) {
  const yStart = shift(fy.end, 1);
  let best = null;
  for (const tag of tags) {
    for (const f of factsFor(facts, tag) || []) {
      if (!isDuration(f)) continue;
      if (interimOnly && f.form !== "10-Q") continue;
      if (f.end <= fy.end) continue;                                  // must be past the year end
      if (Math.abs(days(yStart, f.start)) > 10) continue;             // must start at the fiscal year
      const d = days(f.start, f.end);
      if (d < YTD_MIN || d > YTD_MAX) continue;
      if (span != null && Math.abs(d - span) > 8) continue;           // same shape as the newest rung
      const off = wantEnd ? Math.abs(days(f.end, wantEnd)) : 0;
      if (wantEnd && off > 35) continue;
      const cand = { end: f.end, start: f.start, days: d, off };
      if (!best) { best = cand; continue; }
      // Newest rung: the latest quarter, and the LONGEST span at it. Earlier rungs: the one whose
      // end lands closest to a whole year back, since that is what keeps the windows twelve months
      // apart rather than merely adjacent.
      if (wantEnd ? cand.off < best.off : cand.end > best.end || (cand.end === best.end && cand.days > best.days)) best = cand;
    }
  }
  return best;
}

// The ladder of year-to-date periods, newest first, one per fiscal year going back.
//
// It is a ladder rather than a pair of lookups because window k's PRIOR leg is window k+1's CURRENT
// leg — the same period, seen from either side — so a series of trailing-twelve-month columns costs
// one extra rung each rather than a fresh pair. That is what lets the LTM column carry a growth rate
// and a three-year CAGR through the same cross-column pass the fiscal-year columns use, rather than
// borrowing those rows from a window it is not on.
// Has the filer reported ANY interim period past its last full year? Two very different situations
// both produce an empty window list — "the fiscal year closed last month and there is nothing yet to
// add", which is Microsoft in August, and "there is a quarter but the stitch could not be built",
// which is a gap. The first means the newest annual column already IS the trailing twelve months;
// the second means there is no honest LTM column at all. Asked separately because presenting a
// nine-month-stale fiscal year as an LTM is precisely the misdating this whole file exists to avoid.
export function hasInterim(facts, tags, period) {
  return !!(period && ytdRung(facts, tags, period, { interimOnly: true }));
}

export function ltmWindows(facts, tags, periods, count = 4) {
  if (!periods || !periods.length) return [];
  const rungs = [ytdRung(facts, tags, periods[0], { interimOnly: true })];
  if (!rungs[0]) return [];
  for (let k = 1; k <= count && periods[k]; k++) {
    const r = ytdRung(facts, tags, periods[k], { wantEnd: shift(rungs[0].end, -k * 365), span: rungs[0].days });
    if (!r) break;
    rungs.push(r);
  }
  const out = [];
  for (let k = 0; k + 1 < rungs.length; k++)
    out.push({ fy: periods[k], prevFy: periods[k + 1], cur: rungs[k], prior: rungs[k + 1],
      end: rungs[k].end, days: rungs[k].days });
  return out;                                                          // newest first, like annualPeriods
}

const pickSpan = (facts, tags, y, ccy) =>
  pickFact(facts, tags, { end: y.end, start: y.start }, { minDays: y.days - 8, maxDays: y.days + 8, ccy });

// One line, stitched. The three legs must come from the SAME TAG, and specifically from the tag the
// ANNUAL column already chose — not from whichever tag happens to resolve all three.
//
// That restriction is rule 9 again. A filer that tags `Revenues` in its 10-K and only the ASC 606
// slice in its 10-Qs would otherwise stitch a total onto the change in a component of itself:
// MetLife's 606 revenue is $2.4bn against $77.1bn of total, so the interim legs would move the total
// by a rounding error on the wrong base and the result would look entirely reasonable. Falling
// through to whichever tag resolves is how the sheet ends up with a number instead of a blank, which
// is the trade this file keeps refusing to make.
// Every filed version of one tag for one period shape, OLDEST filing first — the opposite order to
// pickFact, which wants the newest. Used to ask whether a figure has been re-presented since it was
// first reported, which is a question about the history rather than about the current answer.
function history(facts, tag, end, minD, maxD) {
  return (factsFor(facts, tag) || [])
    .filter(f => isDuration(f) && f.end === end && days(f.start, f.end) >= minD && days(f.start, f.end) <= maxD)
    .sort((a, b) => (a.filed || "").localeCompare(b.filed || ""));
}
const moved = (a, b) => a != null && b != null && Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) > 0.005;

// Rule 2 — latest filed wins — is applied to each leg independently, and that is what usually keeps
// the three of them on one basis: a divestiture re-presents prior periods, and taking the newest
// version of each picks up the re-presentation everywhere at once. Honeywell's first half of 2025
// was filed at $20.17bn and re-filed at $18.25bn after the Solstice spin; Occidental's at $13.22bn
// and $10.96bn after OxyChem. In both the annual figure had ALREADY moved to the new basis, so the
// stitch is coherent — Occidental's 10-K restated its own 2024 comparative from $26.7bn to $22.0bn.
//
// But that is a fact about those two filers, not a rule. The interim legs pick up a re-presentation
// at the next 10-Q while the annual leg only catches up at the next 10-K, so a divestiture completed
// mid-year leaves a window of two or three quarters where the annual leg is the OLD basis and the
// two interim legs are the new one. FY(including a sold business) + Δ(excluding it) is neither, and
// it is wrong by that business's half-year — a number with the right units and the wrong company in
// it, which is the shape of error this engine keeps refusing to print.
//
// It is detectable, because a re-presentation always sweeps the comparatives with it: if the prior
// leg has moved since it was first filed, then the annual leg is on the same basis only if ITS OWN
// filing also restated the year before it. Checked against that accession specifically, not against
// "was it ever restated". No evidence either way fails closed — this fires for 2 of 89 filers swept,
// so a blank here is rare enough to be worth its certainty.
// Rule 37 (the second door). The test above asks whether the annual leg's OWN filing restated the year
// before it — the right question when that filing is the 10-K that straddled the re-presentation, and
// the wrong one when rule 2 has taken the annual leg from a LATER 10-K: a report filed after the
// re-presentation is on the re-presented basis by construction (a discontinued operation or a spin is
// recast in every period the later report presents), and a 10-K two years on carries no comparative
// for the year before the window at all, so the old test found nothing and refused. 442 LTM cells on
// the cache were refused this way, and 361 of them have the annual leg filed after the prior leg's
// newest re-presentation — GE's FY2023 from its FY2025 10-K, on the post-Vernova basis with both interim
// legs; AIG, MetLife, Prudential, J&J, 3M, Intel the same shape. So: an annual leg filed after the prior
// leg's newest version agrees with it. The 81 whose annual leg predates the re-presentation stay refused,
// which is the divestiture-in-progress case the guard exists for.
function basisAgrees(facts, tag, win, fy) {
  const pri = history(facts, tag, win.prior.end, win.days - 8, win.days + 8);
  if (pri.length < 2 || !moved(pri[0].val, pri[pri.length - 1].val)) return true;   // nothing re-presented
  if ((fy.filed || "") >= (pri[pri.length - 1].filed || "")) return true;           // the annual leg post-dates (or IS) the re-presentation
  if (!win.prevFy) return false;
  const prev = history(facts, tag, win.prevFy.end, ANNUAL_MIN, ANNUAL_MAX);
  const inFy = prev.filter(f => f.accn === fy.accn).pop();
  return !!(inFy && prev.length > 1 && moved(prev[0].val, inFy.val));
}

// Rule 33's companion. "Only the tag the annual column chose" is rule 9's guard against stitching a
// total onto a slice, and it is kept — but a filer whose 10-K tags one revenue concept and whose 10-Qs
// tag the other, with the SAME figure under both, has legs on one basis and was getting a blank for it.
// Comcast and RTX file `Revenues` in their 2023 10-Qs and the ASC 606 tag in their 10-Ks; Oracle the
// other way round. So a sibling concept may supply the interim legs when its OWN annual figure equals
// the column's to one part in ten thousand: equality is what a slice can never satisfy (MetLife's 606
// revenue is 3% of its total), and it is the same test rule 23 uses for the filer's own arithmetic.
// The cell carries which concept the legs came from.
const sameFigure = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(Math.abs(a), 1) * 1e-4;
export function pickLtm(facts, tags, win, ccy) {
  const fy = pickFact(facts, tags, win.fy, { ccy });
  if (fy.value == null) return { value: null, status: fy.status };
  let legTag = fy.tag;
  let cur = pickSpan(facts, [fy.tag], win.cur, ccy), pri = pickSpan(facts, [fy.tag], win.prior, ccy);
  if (cur.value == null || pri.value == null || cur.unit !== fy.unit || pri.unit !== fy.unit) {
    for (const t of tags || []) {
      if (t === fy.tag) continue;
      const alt = pickFact(facts, [t], win.fy, { ccy });
      if (!sameFigure(alt.value, fy.value) || alt.unit !== fy.unit) continue;
      const c2 = pickSpan(facts, [t], win.cur, ccy), p2 = pickSpan(facts, [t], win.prior, ccy);
      if (c2.value == null || p2.value == null || c2.unit !== fy.unit || p2.unit !== fy.unit) continue;
      cur = c2; pri = p2; legTag = t; break;
    }
    if (cur.value == null || pri.value == null || cur.unit !== fy.unit || pri.unit !== fy.unit)
      return { value: null, status: "no-interim", tag: fy.tag };
  }
  if (!basisAgrees(facts, legTag, win, fy)) return { value: null, status: "restated-basis", tag: fy.tag };
  const hit = { value: fy.value + cur.value - pri.value, unit: fy.unit, tag: fy.tag, status: "ltm",
    end: win.end, start: shift(win.end, -364), accn: fy.accn, form: fy.form, filed: fy.filed,
    ...(legTag !== fy.tag ? { legTag } : {}),
    basis: `FY to ${win.fy.end} + ${win.cur.start}→${win.cur.end} − ${win.prior.start}→${win.prior.end}` };
  return hit;
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
const corpDebt = v => (v.ltdCur != null && v.ltDebt == null ? null
  // Two independent verdicts, each dropping one row from the SUM while leaving it on the sheet as the
  // filed figure it is. `stDebtIsLtdCur` is rule 16 — the two rows are one line the filer tagged
  // twice, so the figure enters once, through `ltdCur`. `ltdCurInLtDebt` is rule 15's per-filer
  // verdict from `debtScope` below — the current maturities are already inside the long-term tag.
  // They compose: a filer with both drops the figure from the sum entirely, because the one line it
  // describes is already inside `ltDebt`, which is exactly right.
  : sum(v.stDebtIsLtdCur ? null : v.stDebt, v.ltdCurInLtDebt ? null : v.ltdCur, v.ltDebt));

// ── Rule 16 ────────────────────────────────────────────────────────────────────────────────────
// Two debt rows filed at the same non-zero value on the same date are ONE line, not two.
//
// Iridium tags `ShortTermBorrowings` and `LongTermDebtCurrent` at the same $3m and the three-way sum
// counted it twice. Its balance sheet has a single current-liability debt line — "Short-Term Debt
// 3,402" — carrying both tags, and so does every other filer this fires for: UPS files "Current
// maturities of long-term debt and commercial paper", AMD "Current portion of long-term debt, net",
// Target "Unsecured debt and other borrowings". One line, two tags, one figure.
//
// Equality is the whole test, and it is safe because the population is not close. Across the 167
// filers swept, at every date either concept was ever filed: **20 non-zero equal observations against
// 1,548 differing**. A filer with two genuinely distinct balances is nowhere near — Exxon $201m
// against $348m, Walmart $1.51bn against $5.85bn — so there is no near-miss regime for a coincidence
// to hide in. All seven filers producing an equal pair were checked against their rendered balance
// sheets and all seven have a single line.
//
// Zero is excluded because it is not evidence: 38 observations have both rows at zero, which says
// nothing about whether they are the same line.
//
// Two other tests were measured and are NOT what shipped, because each reaches only part of it:
// asking whether the filer ever files the two differently (rule 15's shape) is over-strict — AMD's
// interim quarters differ by $3m because one leg is the balance sheet and the other the debt
// footnote, and its statement still carries one line; and checking that the filer's own
// `LiabilitiesCurrent` has no room for the figure twice misses Iridium, whose operating lease
// liability is tagged separately and also sits inside the accrued line.
export const dupCurrentDebt = v => v.stDebt != null && v.ltdCur != null && v.stDebt === v.ltdCur && v.stDebt !== 0;

// ── A near-cancelled denominator ────────────────────────────────────────────────────────────────
// Colgate's ROE reads 3948% and is arithmetically correct: its parent equity really is $54m after
// decades of buybacks. Nothing here suppresses a correctly derived number — that is the one thing
// this page must not do — but nothing said why either, and on a household name it reads as a broken
// tool rather than as a fact about the company.
//
// The mark is NOT keyed to how big the ratio came out, which would catch the wrong thing. A biotech's
// −5,041% EBITDA margin is huge and correct and is a different situation entirely: its denominator is
// $3m of revenue, which genuinely IS the company's revenue, and the ratio means exactly what it says.
// Equity is a RESIDUAL — assets less liabilities — and when it has nearly cancelled the ratio stops
// describing returns and starts describing buyback history, because a 1% revision anywhere on the
// balance sheet moves it by tens of percent. That is a fact about STABILITY, not about magnitude.
//
// So the test is |equity| against total assets, and the threshold is a JUDGEMENT rather than a
// reading, which is worth saying plainly because most numbers in this file are the other kind. The
// segment gate could point at a distribution with nothing in the middle; this one is smooth —
// measured over 1,193 filer-columns the median is 34.3% of assets, p10 9.3%, p5 5.7%, p1 0.9%, with
// no gap anywhere. 2% is chosen because it is the point where a 1% move in the balance sheet moves
// the ratio by more than half (assets/equity > 50x), and the note prints the filer's ACTUAL
// percentage so the threshold only decides when to speak, never what is claimed.
//
// It is not one filer. 23 columns across 13, and they are not obscure: McKesson's FY2021 ROE is
// 21,614% on MINUS $21m of equity against $65bn of assets, Boeing's FY2018 3,085%, Home Depot's
// FY2024 1,450%, Oracle's FY2023 792%, HCA's FY2020 656%.
export const THIN_EQUITY = 0.02;
// ── Rule 39: debt as a multiple of a LOSS is not a leverage figure ───────────────────────────────
// Shopify's $916m of debt over its FY2023 EBITDA loss of $1,348m printed −0.68x, and the sign carries no
// meaning: a smaller loss prints a LARGER negative multiple, and net cash over a loss prints a POSITIVE
// one that reads as ordinary leverage — Shopify's FY2019 net debt/EBITDA read 23.27x on a company holding
// net cash. The comps convention is "n/m", and that is what the sheet says: `fillCol` marks both cells
// `not-meaningful` after the blanking pass, the cell prints n/m, and the row's note names the loss. The
// debt and the EBITDA stay on the sheet. The derivations themselves are untouched, because the pass
// blanks every cell they could produce over a loss. Each row is listed with the debt figure it divides:
// a cell is n/m only where that figure exists, since a blank numerator is a blank for its own reason.
export const LEV_ROWS = [["netLev", "netDebt"], ["grossLev", "totalDebt"]];
export const thinEquity = v => v.equity != null && v.totalAssets != null && v.totalAssets !== 0
  && Math.abs(v.equity) / Math.abs(v.totalAssets) < THIN_EQUITY;

// ── Rule 11's open question, answered ───────────────────────────────────────────────────────────
// Does the tag that filled the long-term debt row already contain the current maturities? It decides
// whether adding `LongTermDebtCurrent` on top is required or is a double count, and it was left
// unfixed because no tag answers it. THE TAG NAME DOES NOT ANSWER IT EITHER, which is the finding:
// Chevron and Verizon both use `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities`,
// whose name says outright that it does, and at Chevron it does NOT — $33.57bn against a $33.48bn
// non-current balance, with $6.72bn of current maturities sitting outside it. A repair keyed on the
// name would have stripped $6.7bn from a filer that was already right.
//
// The FILER answers it, on its own filings. Where it tags both the resolving tag T and
// `LongTermDebtNoncurrent` at the same date, T == Noncurrent means T excludes the current portion and
// T == Noncurrent + Current means it includes it. That is a fact about the filer's own convention, so
// it is read from ANY period it ever filed both — usually an older year, because a filer that still
// tagged the unambiguous tag today would never reach the ambiguous one — and applied to the periods
// where only T resolves. Every reading must agree; a filer that changed convention gets no verdict.
//
// It fails CLOSED in both directions. No evidence, conflicting evidence, or a tag that is already
// unambiguous all leave the sum exactly as it was, which is what 165 of the 167 filers swept get.
const nearly = (a, b) => a != null && b != null && Math.abs(a - b) <= Math.max(Math.abs(b), 1) * 0.005;
export function debtScope(facts, tag) {
  if (!tag || tag === "LongTermDebtNoncurrent" || tag === "ConvertibleDebtNoncurrent") return null;
  const at = t => {
    const d = factsFor(facts, t), m = new Map();
    for (const f of d || []) {
      if (isDuration(f) || !periodic(f.form)) continue;
      const p = m.get(f.end);
      if (!p || (f.filed || "") > (p.filed || "")) m.set(f.end, f);
    }
    return m;
  };
  const T = at(tag), nc = at("LongTermDebtNoncurrent"), cu = at("LongTermDebtCurrent");
  const seen = new Set();
  for (const [end, t] of T) {
    const n = nc.get(end);
    if (!n) continue;
    const c = cu.get(end);
    // A year in which the current portion is inside the tolerance satisfies BOTH identities and
    // decides nothing, and counting it as evidence for each side made the whole verdict conflicting.
    // American Tower tags both for ten years; in eight of them T = Noncurrent + Current by billions,
    // and in 2013 and 2015 its current portion was small enough that T = Noncurrent also held within
    // 0.5%. Two uninformative years were vetoing eight informative ones. Skipping them changes three
    // verdicts to `includes` (American Tower, NGL, UPS) and un-decides Cigna, whose only evidence year
    // was of this kind — and `excludes` is the sum's default, so nothing moves there.
    const ex = nearly(t.val, n.val), inc = !!c && nearly(t.val, n.val + c.val);
    if (ex && inc) continue;
    if (ex) seen.add("excludes"); else if (inc) seen.add("includes");
  }
  return seen.size === 1 ? [...seen][0] : null;      // conflicting or absent evidence decides nothing
}

// An industry's own all-in debt tag is preferred over the three-way corporate sum — but a "total"
// that is SMALLER than the long-term debt inside it is not a total, and rule 7 says a partial total
// is worse than none. The small/mid-cap sweep found the REIT override doing exactly that: both
// `NotesPayable` and `LongTermDebt` are in the REIT debt list, `NotesPayable` resolves first, and at
// some filers it is only part of the stack. BrightSpire reported **$414m against $2.47bn** of
// long-term debt it had already tagged, and Regency $4.62bn against $4.74bn — a total smaller than
// a component of itself, which is impossible on its own terms rather than merely wrong.
//
// Falling back rather than taking the larger of the two: the corporate sum is a defined quantity
// (short-term + current maturities + long-term), and "whichever number is bigger" is how a
// tax-inclusive or gross-of-eliminations tag wins an argument it should lose.
// The REIT override took American Tower's $1.9m as the filer's all-in total as well, and the test
// above held trivially because both sides were the same stray fact. That is closed on the ROWS
// (`reitDebt` and `debtAllIn` declare rule 30's floor below), not here: a second floor inside this
// helper could never fire once the rows have theirs, and a guard nothing can reach is dead code.
const allIn = (total, v) => (total != null && (v.ltDebt == null || total >= v.ltDebt) ? total : null);

// ── Rule 30: a debt total smaller than the current maturities beside it is not the total ──────────
// American Tower's FY2019 total debt read $1.9m against a filed $24,055m. The FY2020 10-K tags a
// footnote figure under `LongTermDebt` for 31 Dec 2019, once with a member and once without, and only
// the undimensioned copy reaches companyfacts — where rule 2 (newest filing wins) hands it the row over
// the $21,127m the FY2019 10-K filed under the non-current tag two candidates further down. Every
// figure built on it was then ordinary-looking and wrong: net debt MINUS $1.5bn, debt/equity 0.00x,
// net debt/EBITDA -0.34x, on a tower REIT.
//
// The tag list cannot fix it (rule 11: reordering moves eight filers) and rule 21's run length cannot
// see it (one stray year). What CAN is the same shape as rule 7 and rule 24 — a fact on the row is not
// always the row's concept — decided by an identity the row itself supplies: a figure that INCLUDES the
// current maturities cannot be smaller than the current maturities. So a candidate below `ltdCur` at
// the same date is set aside and the list falls through to the next one, on the rows that declare
// `notBelow`. The row still says what happened, because the filer did tag something.
//
// It is confined to the concepts that carry current maturities inside them, and the counter-population
// is why: a NON-CURRENT balance genuinely can be smaller than the current portion. Air Industries
// carries $1.5m of long-term debt against $23.7m due within a year (a revolver classified current),
// iHeartMedia's non-current debt is literally 0 in Chapter 11 against $46m current — rule 24's own
// witness — and Fluent, Hycroft and Old Dominion are the same shape. 31 columns on 9 filers have the
// resolved long-term figure below the current portion, and only American Tower's is an inclusive
// concept. Everything else is left exactly as filed.
export const NONCURRENT_DEBT = new Set(["LongTermDebtNoncurrent", "ConvertibleDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"]);

// ── Rule 35: a derivation that subtracts a blank input prints the row it was meant to adjust ─────
// Seven derivations were written `x − (y || 0)`, and each one, when y is untagged, prints x under
// y's label: `fcf` printed cash from operations as free cash flow on 241 cells of the 180-filer cache
// (Verizon $37.1bn against a real $20.1bn, Dominion +$5.4bn against −$7.3bn — a sign flip); `fccr`
// printed EBITDA over interest as fixed-charge coverage; `ufcf` carried the same `(v.capex || 0)` on
// the row rule 25 had just repaired; `cashTaxRate` printed the effective rate on 156 cells;
// `ebitdaSbc` duplicated the EBITDA row above it on 94; `quickRatio` the current ratio on 267;
// `tbvps` book value per share on 393. Six of the seven sit directly beside the row they duplicate.
// Rule 7 exactly, and the fix is rule 25's: the row's own formula refusing a missing input.
//
// Two of the seven keep their figure and gain a note instead, because their counter-population is a
// filer that genuinely has nothing to deduct — a software company carries no inventory, and its
// quick ratio IS its current ratio; a company with no goodwill has a tangible book equal to book —
// and companyfacts cannot tell "none" from "untagged". A blank there would delete a correct figure
// on most of the population to fix a wrong one on a few, so the note says what was and was not
// deducted and the reader decides. `ebitda = ebit + (da || 0)` is a recorded decision (a missing D&A
// understates rather than fabricates) and is not touched; `ufcf`'s `(v.da || 0)` is the same decision.
//
// And ONE industry keeps free cash flow with capex untagged, by measurement rather than preference.
// Rule 27 kept the FCF family for the carriers because an insurer's operating cash flow is an
// operating flow; none of them tags capital expenditure under any concept (Chubb, Travelers, MetLife,
// Prudential file nothing capex-like at all), and at the P&C carriers that do tag it, capex is 3.8% of
// operating cash flow at the median and 8.2% at the 90th percentile (30 columns, five filers; AIG's
// 2020 at 34% is one year of depressed cash flow). So for `pc` and `life` a blank capex is waived, the
// row prints cash from operations, and the note says so. Not for health plans — Cigna and
// UnitedHealth run 11–18% where they tag it, and Cigna tags nothing after 2019 — and a REIT never
// reaches it: its capex concepts mean a different thing at each filer, so NOT_APPLICABLE.reit blanks
// the whole free-cash-flow family before the waiver could apply.
export const CAPEX_IMMATERIAL_INDUSTRIES = new Set(["pc", "life"]);

// ── Rule 32: a balance sheet whose legs do not close is re-drawn from ONE filing ─────────────────
// `pickFact` resolves every row on its own under rule 2, so nothing makes assets, liabilities and
// equity come from the same document — and mostly it does not matter (README, *The balance sheet's
// three legs*): a balance sheet presents two years while the statement of equity presents three, so
// the oldest column's equity routinely arrives from a filing a year newer than its assets, and
// 1,106 of the 1,441 three-legged columns on the cache are split this way and close just as often as
// the rest. The mechanism only bites when the newer filing is on a NEW BASIS for that date: an
// opening balance restated under LDTI (Allstate's FY2020 equity read **minus $298m against
// $30.2bn**; MetLife FY2021 $50.0bn against $67.7bn; Prudential $30.0bn against $62.6bn; Chubb,
// Cincinnati, Jackson), a restatement that reached the equity statement before the balance sheet
// (H.B. Fuller, Riot, Urban One, Inspired's four years, GE 2021), or a CIK that carries two
// registrants' histories after a de-SPAC — Core Scientific's FY2020 pairs the SPAC shell's $15,000
// of assets with legacy Core's $89.2m of equity, and Hycroft, Nuride, Orchestra BioMed and OppFi are
// the same shape with the shell's redeemable shares arriving as the mezzanine leg. Two more are a
// stray: a FOOTNOTE figure filed undimensioned under `Assets` in a later 10-Q (Fluent) or 10-K
// (Hubbell), which rule 2 hands the row exactly as it handed American Tower's debt (rule 30).
//
// The trigger is the identity, not the tags. A same-tag witness — "does the filing that supplied one
// leg carry another leg at a different value?" — was measured first and finds 16 columns on the
// cache, but it cannot see Chubb (whose older 10-K tags only the parent concept while the newer
// equity statement tags the all-in one) and it would fire on three columns that already close,
// rolling GE's FY2022 and Inspired's FY2022 back from a restatement that reached assets and equity
// but left liabilities alone. So: the column does not close within 0.5% of assets, its legs come
// from more than one filing, and the NEWEST filing that presents the whole balance sheet at that
// instant — assets AND liabilities, in the sheet's currency — closes on its own. Then every leg is
// read from that one filing, by each row's own tag order, and a leg it does not carry (GE's
// mezzanine, which the restated presentation reclassified) is blank rather than borrowed.
//
// It fails CLOSED three ways, and the population that reaches each is named. A column that closes is
// never touched, whatever its filings say about each other (3 columns). A column whose legs all come
// from one filing has nothing to re-draw — Instacart, iQSTEL, Farmland Partners: a mezzanine tagged
// only inside a dimension, rule 28's residue, 33 columns. And the rule stands down when the newest
// presentation cannot be read whole or does not close itself: OppFi's FY2020 balance sheet tags an
// LLC's `MembersEquity`, which no row asks for, so the shell's older 10-Q must NOT be reached behind
// it; Symbotic's FY2021 closes on its face only through $836m of redeemable units tagged with
// class-member dimensions. Never an older filing behind a newer whole presentation: rule 2 gives way
// only to a filing that presents the statement the column claims to be.
//
// Measured over every annual and LTM column of the 180-filer cache and the 36-filer material-weakness
// frame: 17 columns move on the cache and 10 on the frame, every one closes afterwards, and no column
// that closed before is touched. Read against the rendered statements (the shell's FY2021 10-K for
// Core Scientific, SmartKem's 10-K/A carrying SmartKem Limited's 2020 balance sheet, Allstate's and
// MetLife's LDTI opening balances) before it shipped. `test/t-legs.mjs`.
export const BS_LEGS = ["totalAssets", "totalLiab", "equity", "equityAll", "tempEquity"];
export const BS_FOOT_TOL = 0.005;
export const bsFoots = (a, l, e, m) => a != null && l != null && e != null && Math.abs(a - (l + e + (m || 0))) <= BS_FOOT_TOL * Math.abs(a);
export function alignBalanceSheet(facts, v, meta, legLines, end, ccy) {
  const eqK = v.equityAll != null ? "equityAll" : "equity";
  const legs = ["totalAssets", "totalLiab", eqK].map(k => meta[k]);
  if (legs.some(m => !m || m.status !== "reported" || !m.accn)) return null;
  if (bsFoots(v.totalAssets, v.totalLiab, v[eqK], v.tempEquity)) return null;
  // No "legs from more than one filing" test, on purpose: a column whose legs all came from one filing
  // X and does not close finds X again below as the newest whole presentation, reads the same values,
  // and stands down on the foot test — so the guard could never fire, and a guard nothing can exercise
  // is dead code (the second floor rule 30 deleted). Instacart's class falls out of the identity.
  // Every periodic filing carrying an assets figure at this instant, newest first — the same order
  // rule 2 sorts by, so the first one that also carries liabilities is the newest whole presentation.
  const seen = new Map();
  for (const tag of legLines.totalAssets.tags || []) for (const f of factsFor(facts, tag) || []) {
    if (isDuration(f) || f.end !== end || !periodic(f.form)) continue;
    const c = currencyOf(f.unit);
    if (ccy && c && c !== ccy) continue;
    if (!seen.has(f.accn)) seen.set(f.accn, { accn: f.accn, form: f.form, filed: f.filed });
  }
  const at = (k, accn) => pickFact(facts, legLines[k].tags, { end }, { ccy, accn });
  const ordered = [...seen.values()].sort((a, b) => (b.filed || "").localeCompare(a.filed || "") || rank(b.form) - rank(a.form));
  const R = ordered.find(r => at("totalLiab", r.accn).value != null);
  if (!R) return null;
  const got = Object.fromEntries(BS_LEGS.map(k => [k, at(k, R.accn)]));
  const E = got.equityAll.value != null ? got.equityAll.value : got.equity.value;
  if (E == null) return null;                                                     // a balance sheet the template cannot read whole
  if (!bsFoots(got.totalAssets.value, got.totalLiab.value, E, got.tempEquity.value)) return null;
  const from = { accn: R.accn, form: R.form, filed: R.filed };
  const moved = [];
  for (const k of BS_LEGS) {
    const was = meta[k];
    const displaced = was && was.status === "reported" && was.accn && was.accn !== R.accn
      ? { value: was.value, tag: was.tag, form: was.form, filed: was.filed, accn: was.accn } : null;
    if (displaced) moved.push(k);
    v[k] = got[k].value;
    meta[k] = { ...got[k], aligned: from, ...(displaced ? { displaced } : {}) };
  }
  return { ...from, moved };
}
// ── Rule 38: a mezzanine line under a name the row does not ask for, taken only where it closes ─────
// The mezzanine row asks for four temporary-equity totals, first hit. Where it resolves none, a filer
// can still present its redeemable noncontrolling interests on the face under the CLASS concepts —
// General Mills' `RedeemableNoncontrollingInterestEquityOtherFairValue` ($551.7m, $544.6m, $604.9m),
// Farmland Partners' preferred units under `…PreferredCarryingAmount` — and the column then misses the
// identity by exactly that line (1.8% at General Mills, 9.5–24% at Farmland). Appended as four more
// first-hit tags, the list prints Farmland's $120.5m preferred units as the whole of a $264m mezzanine
// in FY2018–20, which is rule 7's partial-as-whole. So these are not tags; they are candidates, and one
// is taken only where the balance sheet then CLOSES on it — in list order, then the sum of the class
// components read inside ONE filing (Farmland's preferred plus its Series B "other", $120.5m + $143.8m,
// to the dollar). Nothing closes, nothing is taken.
//
// Measured over every annual and LTM column of the 180-filer cache and the material-weakness frame
// (the private notes' measure/audit4/item2): 40 candidates, 40 taken — 37 single spellings (Common 20,
// Preferred 9, OtherFairValue 8), 3 sums — every one closing its column to a residual of $0; 0 columns
// that closed before are opened; the ungated list's three partial cells are the three the sum replaces.
// Because every accepted candidate closes to the dollar, the gate is the filer's own arithmetic at
// rule 33's precision (1e-4 of assets), not rule 32's 0.5% foot test: a candidate that merely lands
// inside half a percent of a large balance sheet is a coincidence, not the line.
//
// Four more spellings the census tried reach nothing and are not listed; the dimensioned class
// (Instacart, Erasca, Nuride, Symbotic — mezzanine tagged only on a class-of-stock axis) is not
// reachable from companyfacts at all, and 0 of 7 such columns ever reappear undimensioned in a later
// filing, so rule 28's argument against an instance-reading path stands. Rule 32's in-filing re-read
// does not use these candidates: 0 columns reach that path, and a guard nothing exercises is dead code.
export const MEZZ_CANDIDATES = ["RedeemableNoncontrollingInterestEquityCommonCarryingAmount",
  "RedeemableNoncontrollingInterestEquityPreferredCarryingAmount", "RedeemableNoncontrollingInterestEquityOtherFairValue"];
export const MEZZ_COMPONENTS = ["RedeemableNoncontrollingInterestEquityCommonCarryingAmount",
  "RedeemableNoncontrollingInterestEquityPreferredCarryingAmount", "RedeemableNoncontrollingInterestEquityOtherCarryingAmount"];
export const MEZZ_GATE_TOL = 1e-4;
export function fillMezzanine(facts, v, meta, end, ccy) {
  if (v.tempEquity != null) return null;
  const E = v.equityAll != null ? v.equityAll : v.equity;
  if (v.totalAssets == null || v.totalLiab == null || E == null) return null;
  const residual = v.totalAssets - (v.totalLiab + E), tol = MEZZ_GATE_TOL * Math.abs(v.totalAssets);
  const closes = m => m != null && Math.abs(residual - m) <= tol;
  for (const tag of MEZZ_CANDIDATES) {
    const got = pickFact(facts, [tag], { end }, { ccy });
    if (closes(got.value)) { v.tempEquity = got.value; meta.tempEquity = { ...got, closes: "single" }; return meta.tempEquity; }
  }
  // The components inside one filing: the newest periodic filing that carries two or more of them at
  // this instant, in the sheet's currency. Never mixed across filings — a sum of two filings' classes
  // is a figure no filing presents.
  const byAccn = new Map();
  for (const tag of MEZZ_COMPONENTS) for (const f of factsFor(facts, tag) || []) {
    if (isDuration(f) || f.end !== end || !periodic(f.form)) continue;
    const c = currencyOf(f.unit);
    if (ccy && c && c !== ccy) continue;
    if (!byAccn.has(f.accn)) byAccn.set(f.accn, { accn: f.accn, form: f.form, filed: f.filed, unit: f.unit, parts: {} });
    byAccn.get(f.accn).parts[tag] = f.val;
  }
  const R = [...byAccn.values()].filter(r => Object.keys(r.parts).length >= 2)
    .sort((a, b) => (b.filed || "").localeCompare(a.filed || "") || rank(b.form) - rank(a.form))[0];
  if (!R) return null;
  const sum = Object.values(R.parts).reduce((s, x) => s + x, 0);
  if (!closes(sum)) return null;
  v.tempEquity = sum;
  // Computed, not reported: no filing presents this total, so the cell carries no single accession to
  // link to, and the row's note names the parts and the filing they were read from.
  meta.tempEquity = { value: sum, status: "computed", closes: "sum", parts: R.parts, from: { accn: R.accn, form: R.form, filed: R.filed }, unit: R.unit };
  return meta.tempEquity;
}

// The sentence the workbook and the TSV carry, since neither has a tooltip or a row note.
export const describeAligned = cols => {
  const hit = (cols || []).filter(c => c.v && c.v.bsAligned);
  if (!hit.length) return "";
  const one = c => `${c.period.ltm ? "LTM " : "FY"}${c.period.fy} from the ${c.meta.totalAssets.aligned.form} filed ${c.meta.totalAssets.aligned.filed}`;
  return `Balance-sheet totals in ${hit.map(one).join("; ")} are all taken from that one filing — the newest presenting the whole balance sheet at the date — because taken each from its own newest filing they did not close; every figure is as filed there.`;
};

// ── The change in working capital, as the FILER reported it ─────────────────────────────────────
//
// Rule 25. `chgNwc` was declared `how: "computed"` with the formula `nwc - nwc[-1]` and implemented
// NOWHERE, so it rendered blank on every sheet ever served — and `ufcf`, which the template declares
// as `nopat + da - capex - chgNwc`, was silently computing `nopat + da - capex`. The reverse DCF
// divides into that figure and its plate told the reader it was "NOPAT + D&A − capex − change in
// NWC": a formula the code did not implement, on the newest feature on the site. Rule 22's defect
// class exactly — a blank cannot be mis-computed, so nothing could fail.
//
// **The balance-sheet delta was the obvious fix and is not the right one.** `nwc - nwc[-1]` is two
// balance sheets subtracted, so it carries acquisitions, disposals, FX translation and
// reclassifications the filer never called working capital. The figure a cash flow statement
// reports is the OPERATING movement alone, and it is a number the filer tagged — which is what this
// tool promises on every other row.
//
// **There is no universal subtotal.** Across the 160 filers swept, the movement is filed as a long
// tail of 159 distinct `IncreaseDecreaseIn*` tags; `IncreaseDecreaseInOperatingCapital`, the
// filer's own total, appears at just 8 of them. So the movement has to be summed from components,
// and rule 7 applies with full force: `sum()` treats a missing input as zero, and a filer that tags
// payables but not receivables reports a FRACTION of its own movement that looks exactly like the
// whole of it. Measured, ungated: Target FY2023 would contribute a partial ΔWC of $2.44bn against a
// UFCF of $0.30bn, Alphabet FY2018 −$6.68bn against −$0.91bn. Worse than the omission it fixes.
//
// Hence three rules, in order:
//  1. **The filer's own subtotal wins** where it files one — rule 23's principle, one level up.
//     Coca-Cola files BOTH the subtotal and its components; summing them read exactly 2x.
//  2. **Otherwise the classified components**, but only where the set is structurally capable of
//     being complete: receivables AND payables/accruals AND (inventory, or a filer carrying none).
//     Not a proof of completeness — a refusal of the sets measurably missing a leg.
//  3. **Otherwise blank**, and `ufcf` blanks with it rather than quietly reverting to a figure that
//     means something else. Rule 21: a row may not mean one concept on one sheet and another on the
//     next. The reverse DCF already falls back to cash from operations less capex, saying on the
//     plate that it is levered, which is the honest answer and was already built.
//
// **The CFO reconciliation was measured as a gate and REJECTED.** `netIncome + D&A + SBC + deferred
// tax − ΔWC ≈ CFO` looks like the decisive test and does not separate: the residual is continuous
// (p50 5.4%, p75 15.3%, p90 32.8% of the reconciliation's own magnitude) because it is dominated by
// non-cash items this engine does not fetch — impairments, gains on sale, equity-method income,
// provisions. Any threshold refuses honest reconstructions without proving the rest complete.
// Waiving the gate for a filer tagging only an aggregate net line was also measured: 18 filer-years,
// all of them Goldman and AIG, both already excluded from the DCF. It buys nothing.
//
// Sign: a POSITIVE value means the balance GREW. An asset growing uses cash, a liability growing
// sources it, so ΔWC = assets − liabilities + net. Verified to the dollar against the two filers
// that tag their own subtotal AND its components — Chevron FY2018 ($718m) and Coca-Cola FY2018
// through FY2023 — which is the only place the convention can be checked rather than asserted.
export const WC_SUBTOTAL = "IncreaseDecreaseInOperatingCapital";
export const WC_ASSET = [
  "IncreaseDecreaseInAccountsReceivable", "IncreaseDecreaseInReceivables", "IncreaseDecreaseInAccountsAndNotesReceivable",
  "IncreaseDecreaseInAccountsAndOtherReceivables", "IncreaseDecreaseInOtherReceivables", "IncreaseDecreaseInIncomeTaxesReceivable",
  "IncreaseDecreaseInNotesReceivables", "IncreaseDecreaseInUnbilledReceivables", "IncreaseDecreaseInAccountsReceivableRelatedParties",
  "IncreaseDecreaseInLongTermReceivablesCurrent", "IncreaseDecreaseInDeferredRentReceivables", "IncreaseDecreaseInInsuranceSettlementsReceivable",
  "IncreaseDecreaseInAccountsReceivableAndOtherOperatingAssets",
  "IncreaseDecreaseInInventories", "IncreaseDecreaseInRetailRelatedInventories", "IncreaseDecreaseInMaterialsAndSupplies",
  "IncreaseDecreaseInRawMaterialsPackagingMaterialsAndSuppliesInventories", "IncreaseDecreaseInFinishedGoodsAndWorkInProcessInventories",
  "IncreaseDecreaseInFossilFuelInventories", "IncreaseDecreaseInPrepaidSupplies",
  "IncreaseDecreaseInPrepaidDeferredExpenseAndOtherAssets", "IncreaseDecreaseInPrepaidExpense", "IncreaseDecreaseInPrepaidExpensesOther",
  "IncreaseDecreaseInPrepaidTaxes", "IncreaseDecreaseInOtherOperatingAssets", "IncreaseDecreaseInOtherCurrentAssets",
  "IncreaseDecreaseInOtherNoncurrentAssets", "IncreaseDecreaseInContractWithCustomerAsset", "IncreaseDecreaseInDeferredCharges",
  "IncreaseDecreaseInAssetsHeldForSale", "IncreaseDecreaseInIntangibleAssetsCurrent", "IncreaseDecreaseInOperatingAssets",
  "IncreaseDecreaseInDueFromRelatedParties", "IncreaseDecreaseInDueFromRelatedPartiesCurrent", "IncreaseDecreaseInDueFromAffiliatesCurrent",
];
export const WC_LIAB = [
  "IncreaseDecreaseInAccountsPayable", "IncreaseDecreaseInAccountsPayableTrade", "IncreaseDecreaseInAccountsPayableRelatedParties",
  "IncreaseDecreaseInOtherAccountsPayable", "IncreaseDecreaseInAccountsPayableAndOtherOperatingLiabilities",
  "IncreaseDecreaseInAccruedLiabilities", "IncreaseDecreaseInOtherAccruedLiabilities", "IncreaseDecreaseInAccruedIncomeTaxesPayable",
  "IncreaseDecreaseInAccruedTaxesPayable", "IncreaseDecreaseInIncomeTaxes", "IncreaseDecreaseInIncomeTaxesPayableNetOfIncomeTaxesReceivable",
  "IncreaseDecreaseInEmployeeRelatedLiabilities", "IncreaseDecreaseInOtherEmployeeRelatedLiabilities", "IncreaseDecreaseInAccruedSalaries",
  "IncreaseDecreaseInInterestPayableNet", "IncreaseDecreaseInRestructuringReserve", "IncreaseDecreaseInSelfInsuranceReserve",
  "IncreaseDecreaseInContractWithCustomerLiability", "IncreaseDecreaseInDeferredRevenue", "IncreaseDecreaseInDeferredRevenueAndCustomerAdvancesAndDeposits",
  "IncreaseDecreaseInCustomerAdvances", "IncreaseDecreaseInCustomerDeposits", "IncreaseDecreaseInBillingInExcessOfCostOfEarnings",
  "IncreaseDecreaseInOtherOperatingLiabilities", "IncreaseDecreaseInOtherCurrentLiabilities", "IncreaseDecreaseInOtherNoncurrentLiabilities",
  "IncreaseDecreaseInDueToRelatedParties", "IncreaseDecreaseInDueToRelatedPartiesCurrent", "IncreaseDecreaseInDueToAffiliates",
  "IncreaseDecreaseInDeferredLiabilities", "IncreaseDecreaseInOtherDeferredLiability", "IncreaseDecreaseInDeferredCompensation",
  "IncreaseDecreaseInPensionAndPostretirementObligations", "IncreaseDecreaseInPensionPlanObligations", "IncreaseDecreaseInPostretirementObligations",
  "IncreaseDecreaseInAssetRetirementObligations", "IncreaseDecreaseInOperatingLeaseLiability", "IncreaseDecreaseInOperatingLiabilities",
  "IncreaseDecreaseInRegulatoryLiabilities", "IncreaseDecreaseInManagementAndIncentiveFeesPayable",
];
// Already net of both sides, so the sign follows "operating capital grew" — a use of cash, like an asset.
export const WC_NET = [
  "IncreaseDecreaseInOtherOperatingCapitalNet", "IncreaseDecreaseInOtherNoncurrentAssetsAndLiabilitiesNet",
  "IncreaseDecreaseInOtherCurrentAssetsAndLiabilitiesNet", "IncreaseDecreaseInDerivativeAssetsAndLiabilities",
  "IncreaseDecreaseInCommodityContractAssetsAndLiabilities", "IncreaseDecreaseInRiskManagementAssetsAndLiabilities",
];
// A combined tag is taken ONLY where neither of its parts is tagged, or the filer's own line is
// counted twice. The same shape as rule 21's component-beating-the-total, one statement over.
export const WC_COMBINED = {
  IncreaseDecreaseInAccountsPayableAndAccruedLiabilities: ["IncreaseDecreaseInAccountsPayable", "IncreaseDecreaseInAccruedLiabilities"],
  IncreaseDecreaseInAccruedLiabilitiesAndOtherOperatingLiabilities: ["IncreaseDecreaseInAccruedLiabilities", "IncreaseDecreaseInOtherOperatingLiabilities"],
  IncreaseDecreaseInOtherAccountsPayableAndAccruedLiabilities: ["IncreaseDecreaseInAccountsPayable", "IncreaseDecreaseInAccruedLiabilities"],
};
// Everything else in the census is deliberately OUT, each for a reason a reader can check: a bank's
// or broker's balance-sheet movements are its business rather than its working capital (deposits,
// trading books, repo, securities lending, loans held for sale), an insurer's reserves likewise,
// restricted cash is not working capital, and deferred income taxes are a non-cash addback counted
// as one. Those filers are blanked from the DCF by NOT_APPLICABLE in any case.
const RECV_RE = /Receivable/, INVT_RE = /Inventor|MaterialsAndSupplies/, PAYS_RE = /Payable|Accrued/;

// The gate needs to know whether this filer carries inventory AT ALL — demanding an inventory tag
// from a services company would blank it for not reporting something it does not have. Read from
// the balance sheet rather than from the resolved column, because this runs during the fetch pass.
const carriesInventory = (facts, instantEnd, ccy) => {
  const f = pickFact(facts, ["InventoryNet"], { end: instantEnd }, { ccy });
  return !!(f && f.value != null && Math.abs(f.value) > 0);
};

// `fetchFlow` is injected rather than assumed, because every component here is a DURATION and the
// trailing-twelve-month column stitches durations across three periods. Hard-coding `pickFact` would
// have given the LTM sheet a working-capital change measured over the fiscal year while every other
// flow beside it was measured over the last twelve months — rule 12's failure, one row down, and
// invisible because the number would look entirely ordinary.
export function changeInWorkingCapital(facts, ccy, fetchFlow, instantEnd) {
  const hit = t => { const f = fetchFlow(t); return f && f.value != null ? f : null; };
  const sub = hit(WC_SUBTOTAL);
  // The filer's own total. Carries its accession, so the cell still links to the filing.
  if (sub) return { value: sub.value, unit: sub.unit, tag: sub.tag, accn: sub.accn, form: sub.form, filed: sub.filed, wcSource: "subtotal" };
  let assets = 0, liabs = 0, net = 0, used = 0;
  let hasRecv = false, hasPays = false, hasInv = false;
  for (const t of WC_ASSET) {
    const f = hit(t); if (!f) continue;
    assets += f.value; used++;
    if (RECV_RE.test(t)) hasRecv = true;
    if (INVT_RE.test(t)) hasInv = true;
  }
  for (const t of WC_LIAB) {
    const f = hit(t); if (!f) continue;
    liabs += f.value; used++;
    if (PAYS_RE.test(t)) hasPays = true;
  }
  for (const [combo, parts] of Object.entries(WC_COMBINED)) {
    const f = hit(combo); if (!f) continue;
    if (parts.some(p => hit(p))) continue;
    liabs += f.value; used++; hasPays = true;
  }
  for (const t of WC_NET) { const f = hit(t); if (!f) continue; net += f.value; used++; }
  if (!used) return { value: null, status: "not-tagged" };
  const needsInv = carriesInventory(facts, instantEnd, ccy);
  const missing = [!hasRecv && "ar", !hasPays && "ap", needsInv && !hasInv && "inventory"].filter(Boolean);
  // Rule 7: a partial total is worse than no total, and this one would be subtracted from a cash
  // flow the valuation divides into. The raw sum and the names of the missing legs travel with the
  // refusal, because whether a missing leg MATTERS depends on its balance against the cash flow it
  // would adjust — and neither is known yet. `promoteWorkingCapital` decides, after the fetch pass.
  if (missing.length) return { value: null, status: "wc-partial", wcRaw: assets - liabs + net, wcMissing: missing, wcTags: used };
  return { value: assets - liabs + net, status: "computed", wcSource: "components", wcTags: used };
}

// A leg a filer never tagged is not automatically a leg that matters. Costco tags no receivables
// movement and Alphabet no inventory movement, and both are refused by the presence test above —
// but Alphabet's entire inventory is 0.6% of its revenue, and a leg cannot move by more than it is.
// So a refusal is reconsidered against the BALANCE of what is missing, measured as a share of the
// cash flow the row adjusts. That denominator is the point: Costco's receivables are 1.2% of revenue
// and **68% of its unlevered cash flow**, because its margins are thin — scaling by revenue would
// wave through the filer this test most needs to stop.
//
// **The threshold is a judgement, like THIN_EQUITY, and the population does not separate**: the
// missing leg's balance runs p25 10%, p50 30%, p75 80% of that cash flow, with no gap to cut at.
// 10% is chosen to be tight — it recovers 21 of the 86 measurable refusals and still declines
// Costco (68%), Comcast (69%), Colgate (83%) and Paramount (142%). A leg whose BALANCE is untagged
// is never promoted: an unbounded leg cannot be shown to be small, and that is 78 of the 164
// refusals — the larger half, left refused.
export const WC_IMMATERIAL = 0.10;
export function promoteWorkingCapital(v, meta) {
  const m = meta.chgNwc;
  if (!m || m.status !== "wc-partial" || m.wcRaw == null) return;
  if (v.ebit == null) return;
  const taxRate = v.tax != null && v.pretax ? v.tax / v.pretax : null;
  if (taxRate == null) return;
  const scale = Math.abs(v.ebit * (1 - taxRate) + (v.da || 0) - (v.capex || 0));
  if (!scale) return;
  const legs = { ar: v.ar, ap: v.ap, inventory: v.inventory };
  for (const name of m.wcMissing) {
    const bal = legs[name];
    if (bal == null || Math.abs(bal) / scale > WC_IMMATERIAL) return;   // unbounded, or big enough to matter
  }
  v.chgNwc = m.wcRaw;
  meta.chgNwc = { value: m.wcRaw, status: "computed", wcSource: "components", wcTags: m.wcTags, wcImmaterial: m.wcMissing.join(" and ") };
}

// Deriving a missing EBIT as revenue − CostsAndExpenses was tried and REMOVED. It looks like the
// operating subtotal and is not one: `CostsAndExpenses` is "total costs and expenses", which for
// most filers includes interest, so the difference is pre-tax income. Welltower derived to MINUS
// $480m and Arthur J. Gallagher to its pre-tax figure — and a wrong EBIT does not stay put, it
// propagates into EBITDA, three margins, NOPAT, ROIC and EV/EBITDA. A filer that never tags
// OperatingIncomeLoss now shows a blank EBIT and a blank EBITDA, which is the true answer.
export const DERIVED = {
  // A no-op that exists purely to RESERVE THE SLOT. Industry overrides are merged as
  // `{...DERIVED, ...DERIVED_BANK}`, so a key only present in the industry set is appended at the
  // END — after every margin and multiple that divides by it has already run and seen a null.
  // Occupying the first position here means DERIVED_BANK's `revenue` reconstruction lands before
  // netMargin, revGrowth, assetTurn and EV/Revenue read it. Same reason `totalDebt` is overridden
  // in place rather than added.
  // Reserves a slot the same way `revenue` below does, and for a dependency between the two. A key
  // only present in an industry set is APPENDED, so `DERIVED_BANK.nii` used to land at the end of the
  // merged table — after `revenue` at slot 0 had already read `v.nii` and found nothing. The two rows
  // computing a bank's top line from the identical expression then disagreed purely by position:
  // "Total revenue" read $30bn of fee income while "Total revenue (bank)" two rows down read the full
  // $90bn, because only the second ran after the reconstruction. Reserving the slot puts the
  // reconstruction first and makes the sheet answer the question once.
  nii: () => null,
  revenue: () => null,
  // Net income cannot be SMALLER than net income available to common — the second is the first
  // less preferred dividends. Where that invariant breaks, the `NetIncomeLoss` fact is a
  // dimensionless residual rather than the consolidated figure, and the tag list cannot tell:
  // Charles Schwab tags it at $8.85m against $8.4bn available to common, which printed a 0.0% net
  // margin and a 0.0% ROE for a company earning eight billion dollars. Repairing from the line
  // directly beneath it is safe because both are already on the sheet and visibly disagree.
  // Runs before netMargin, ROE and ROA read it — hence the position.
  netIncome: v => (v.netIncome != null && v.niToCommon != null && v.netIncome < v.niToCommon
    ? v.niToCommon : null),
  // EBIT is required, not summed. `sum` treats a missing input as zero, so a filer that tagged D&A
  // but no operating income reported its D&A AS its EBITDA: VICI Properties printed EBITDA of $4m
  // against $4.0bn of revenue, and Net debt/EBITDA came out at 4,041x. Its leases are sales-type,
  // so it genuinely has almost no depreciation — the $4m was real, the label on it was not. A
  // missing D&A still yields EBIT, which understates rather than fabricates, so only EBIT is hard.
  // The flag has to be computed BEFORE the row it describes is filled, or it can never see that the
  // row was empty. Object order is the execution order here, the same reason `revenue` reserves the
  // first slot. Returning null leaves nothing behind, so an unaffected filer carries no flag.
  // A ZERO difference is not a derivation, it is the absence of one — the two totals are equal
  // because the filer has no minority interest, and printing "Noncontrolling interest 0" on a sheet
  // denominated in billions reads as a broken tool exactly the way an exported "Preferred dividends
  // 0.00" does. It cost 700-odd cells across 100 filers before this test went in, and the blank it
  // replaced was already the right answer.
  nciDerived: v => (v.nciBs == null && v.equityIsParent && v.equityAll != null && v.equity != null
    && v.equityAll !== v.equity ? true : null),
  // Fills the non-controlling interest from the filer's own two equity totals when it has stopped
  // tagging the interest directly. Only where `equity` is the PARENT figure — otherwise the two totals
  // are the same fact and the difference is a meaningless zero. See the template row for what the
  // residual can contain besides NCI.
  nciBs: v => (v.nciBs == null && v.equityIsParent && v.equityAll != null && v.equity != null
    && v.equityAll !== v.equity ? v.equityAll - v.equity : null),
  // ── Rule 34: depreciation plus separately tagged amortisation, where the filer tags no total ────
  // The row's last candidate, `Depreciation`, EXCLUDES amortisation by definition, and 188 cells on the
  // cache resolve it — 110 of them on filers that tag `AmortizationOfIntangibleAssets` for the same
  // period and no D&A total under any concept. AbbVie's D&A read $471m against $1.29bn of amortisation
  // beside it in 2018 and $762m against $7.38bn in 2025, its EBITDA 31.8% low; AMD 35.3%, Broadcom
  // 23.6%, Thermo Fisher, Oracle, Intel, Microsoft. Where the two are tagged in place of a total, the
  // row is their sum and says so (`daSummed`, read by the row's note). It is a FLOOR, not the total:
  // where filers tag a total AND both parts, the parts reproduce it 184 times in 400 and fall 2–5%
  // short in most of the rest — capitalised software, finance-lease assets and other amortisation sit
  // in neither concept — which is why a filed total, under any of the three names above it, still wins
  // outright and this never displaces one. `AdjustmentForAmortization` was measured as a second
  // amortisation concept and rejected: equal to intangible amortisation in 51 of 130 periods, 3.5x it at
  // Allstate and negative at AMD, it is not one quantity. The flag precedes the sum so the note can see
  // it, and `v.daDepreciationOnly` is set by fillCol from the resolved tag before any derivation runs.
  daSummed: v => (v.daDepreciationOnly && v.amort ? true : null),
  da: v => (v.daDepreciationOnly && v.amort ? v.amort + v.da : null),
  ebitda: v => (v.ebit == null ? null : v.ebit + (v.da || 0)),
  ebitdaSbc: v => (v.ebitda == null || v.sbc == null ? null : v.ebitda - v.sbc),
  // ── Gross profit, where the filer reports the two lines above it and not the subtotal ──────────
  // The template has declared `fallback: "revenue - cogs"` on this row since the first version and
  // NOTHING EVER IMPLEMENTED IT — the same defect as `revCagr3`/`revCagr5`, which were also written
  // in the template as formulas, rendered to a reader as the line's definition, and never wired to
  // anything. A blank cannot be mis-computed, so nothing could fail and nothing did.
  //
  // It is 446 cells on 84 filers, 15.8% of all columns, and they are not obscure: Chevron, Conoco,
  // Walmart, Costco, Target, P&G, Pfizer, Merck, Lilly, AbbVie, Amgen and Caterpillar all report
  // revenue and cost of revenue and no gross-profit subtotal, so the row and the gross margin under
  // it were empty on every one of them.
  //
  // This is an identity over two rows directly above it, not a subtotal inferred from a tag that
  // means something else — which is exactly what separates it from rule 8's rejected
  // `revenue − CostsAndExpenses` derivation. Checked where the filer tags gross profit AND both
  // inputs: 1,051 columns agree to within 0.5% and 49 do not, and the 49 are a population rather
  // than a rate — near-zero-revenue shells where a percentage is meaningless, plus the excise-tax
  // category (Altria, RLX) which presents a third line between cost and gross profit. Every one of
  // those tags its own gross profit, so the derivation never fires on them.
  //
  // Returns null when the row was fetched, so the fetched value keeps its "reported" status and its
  // link to the filing: a derivation that returned the existing figure would overwrite `meta` with
  // `computed` and silently break the per-cell EDGAR link on every filer that does tag it.
  grossProfit: v => (v.grossProfit == null && v.revenue != null && v.cogs != null
    ? v.revenue - v.cogs : null),
  grossMargin: v => div(v.grossProfit, v.revenue),
  ebitdaMargin: v => div(v.ebitda, v.revenue),
  ebitMargin: v => div(v.ebit, v.revenue),
  netMargin: v => div(v.netIncome, v.revenue),
  // Rule 35: capex is required, except where fillCol has waived it for a carrier (`capexWaived`).
  fcf: v => (v.cfo == null || (v.capex == null && !v.capexWaived) ? null : v.cfo - (v.capex || 0)),
  fcfMargin: v => div(v.fcf, v.revenue),
  fcfConv: v => div(v.fcf, v.netIncome),
  taxRate: v => div(v.tax, v.pretax),
  // The CURRENT PORTION of long-term debt cannot be the whole of a company's debt: the name says
  // there is a long-term balance behind it. When that is all that resolved, the long-term tag is
  // missing rather than zero, and reporting the stub as the total is the Progressive failure in a
  // quieter register — Equinix printed $1.3bn against $33.8bn of real estate, a 3.8% debt load for
  // one of the most leveraged names in the sector. Blank instead.
  totalDebt: v => { const a = allIn(v.debtAllIn, v); return a != null ? a : corpDebt(v); },
  debtLikeTotal: v => sum(v.olCur, v.olNon, v.flCur, v.flNon, v.pensionUnderfunded, v.deferredComp, v.assetRetirement),
  // Rule 7 again, on a row nobody had looked at: `sum` treats a missing input as zero, so where total debt is
  // blank this printed the LEASE liabilities alone under the label "Total debt incl. leases" — 109 cells on 24
  // filers of the cache and 70 on 15 of the material-weakness frame (Axon, Anterix, AIOS…), a lease total read
  // as a debt total. The leases are an ADDITION to the debt figure, so without it the row has nothing to add to.
  // Found by item 9's measurement of the current-debt concepts (the private notes' measure/audit4/item9-current-debt).
  totalDebtLeases: v => (v.totalDebt == null ? null : sum(v.totalDebt, v.olCur, v.olNon, v.flCur, v.flNon)),
  netDebt: v => (v.totalDebt == null ? null : v.totalDebt - (v.cash || 0) - (v.sti || 0)),
  // The DCF tab's equity-bridge restatement of the row above. The SAME quantity by construction — the
  // template declares this row's formula as `netDebt` and that is exactly what it returns — and it
  // exists because the bridge from enterprise to equity value is where a reader looks for the figure,
  // which is a different tab from the credit ratios. Declared since the row was written and
  // implemented NOWHERE, so "Net debt (equity bridge)" rendered blank on every sheet ever served,
  // under a ƒ marker whose tooltip advertised the formula and a status deliberately suppressed to
  // null: rule 25's class exactly, found by `t-declared` rather than by anything going wrong.
  // Order matters — derivations run in insertion order over one shared `v`, so this must stay AFTER
  // `netDebt` or it would read undefined. No NOT_APPLICABLE list carries `netDebt`, so this makes no
  // claim for any industry the row above does not already make, and inherits its null.
  netDebtBridge: v => (v.netDebt == null ? null : v.netDebt),
  netLev: v => div(v.netDebt, v.ebitda),
  grossLev: v => div(v.totalDebt, v.ebitda),
  intCover: v => div(v.ebitda, v.intExp),
  fccr: v => (v.ebitda == null || v.capex == null ? null : div(v.ebitda - v.capex, v.intExp)),
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
  // Rule 25. The change in working capital is REQUIRED, not summed — the same distinction EBIT
  // draws two hundred lines up, and for the same reason. `nopat + da - capex` is a real quantity but
  // it is not unlevered free cash flow, and shipping it under that label put a figure on the
  // Valuation tab that the plate beside it described as something else. Where ΔWC is unavailable the
  // row blanks and the reverse DCF falls back to cash from operations less capex, saying so.
  ufcf: v => (v.nopat == null || v.chgNwc == null || v.capex == null ? null : v.nopat + (v.da || 0) - v.capex - v.chgNwc),
  // Rule 36: taxes paid over pre-tax income, and NO fallback to the current-expense proxy — the two sit
  // 10 points apart at the 10th and 90th percentiles (817 columns), so a row that meant one on some sheets
  // and the other on the rest would be rule 21's failure under a single label. Rule 35's refusal stands
  // on the proxy, which keeps its own row.
  cashTaxRate: v => div(v.taxesPaid, v.pretax),
  currentTaxRate: v => (v.tax == null || v.deferredTax == null ? null : div(v.tax - v.deferredTax, v.pretax)),
};

// Bank-only derivations. Kept separate so they only run for a depository — computing an efficiency
// ratio for Apple would produce a number, and a number that means nothing is worse than a blank.
// A bank's top line is net interest income PLUS fees, and BOTH legs are required — which `sum` does
// not enforce, because it treats a missing argument as zero and returns a total when only one leg is
// present. Three rows shared that expression and all three could therefore print fee income alone as
// a bank's revenue: a filer tagging `NoninterestIncome` and no net interest income read $30bn against
// a real $90bn in the fixture that found it. That is rule 7's partial total, in the register the
// template's own first comment describes for MetLife — 3% of the top line, with every margin, growth
// rate and EV/Revenue built on it. Named once so the three cannot drift apart again.
// The two legs are NOT symmetric, and the first version of this helper got that wrong by requiring
// both. Net interest income is the DEFINITIONAL core of the line — a depository with no fee income at
// all is an ordinary thrift, and it is also the leg the engine can RECONSTRUCT from gross interest
// income and expense. Noninterest income is additive and has no reconstruction. So: no `nii`, no top
// line, because fees alone are not a bank's revenue and printing them as one is what this helper was
// written to stop ($30bn against a real $90bn). With `nii` present, fees are added when tagged.
// Requiring both instead blanked the top line — and netMargin, revGrowth, assetTurn and EV/Revenue
// with it — for any lender that files no fee tag, which is a regression rather than a refusal.
const bankTopLine = v => (v.nii == null ? null : v.nii + (v.noninterestIncome || 0));

export const DERIVED_BANK = {
  // Returns NULL where the filer tagged it, not the fetched figure. `fillCol` writes
  // `meta[k] = { status: "computed" }` for ANY derivation returning non-null, so handing back the
  // value it was given destroys the meta entry carrying the tag, the form and the ACCESSION — and
  // this row is net interest income, the top line of a bank's income statement. Measured across the
  // eight bank fixtures: **0 of 64 columns carried a link to the filing**, against 64 of 64 on the
  // Deposits row beside it, on a page whose entire argument is that every reported figure opens the
  // document it came from. The rule was already written for rule 22's gross profit ("it returns null
  // when the row was fetched") and the `revenue` reconstruction directly below does it correctly;
  // this line was the one that did not, and it reconstructs only where the filer tagged nothing.
  nii: v => (v.nii != null ? null : v.intIncTotal == null ? null : v.intIncTotal - (v.intExpTotal || 0)),
  // A bank's total revenue IS net interest income plus fees — the identity holds exactly at
  // JPMorgan, whose `Revenues` tag ($182.4bn) equals NII $95.4bn + noninterest income $87.0bn. So
  // where a bank tags no revenue total at all this reconstructs it rather than leaving the top line
  // of the income statement blank: Truist files neither `Revenues` nor `RevenuesNetOfInterestExpense`.
  // Returns null when the filer did tag one, leaving the reported figure untouched.
  revenue: v => (v.revenue != null ? null : bankTopLine(v)),
  totalRevenueBank: bankTopLine,
  efficiency: v => div(v.noninterestExpense, bankTopLine(v)),
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

export const DERIVED_PC = {
  // No `lossesTotal` row here. It existed as `lossesTotal: pcLosses` and computed on every column of
  // every P&C insurer for nothing: no template line declares that key, so no row displayed it, and no
  // `flagNote` keyed off it — every derivation below calls the `pcLosses` helper directly rather than
  // reading `v.lossesTotal`. The mirror of rule 22, which is a declared formula with no implementation;
  // this was an implementation with no declaration. Found by `t-declared`, which asserts the class in
  // both directions. Sep 12 2026.
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

export const DERIVED_ADVISORY = {
  compRatio: v => div(v.compExpense, v.revenue),
  pretaxMargin: v => div(v.pretax, v.revenue),
  tangibleEquity: v => (v.equity == null ? null : v.equity - (v.goodwill || 0) - (v.intangibles || 0)),
  rote: v => (v.equity == null ? null : div(v.netIncome, v.equity - (v.goodwill || 0) - (v.intangibles || 0))),
};

export const DERIVED_REIT = {
  // Same all-in-debt override as the carriers, different tag names. See reitDebt in the template.
  totalDebt: v => { const a = allIn(v.reitDebt, v); return a != null ? a : corpDebt(v); },
  noi: v => (all(v.rentalRevenue, v.propOpex) ? v.rentalRevenue - v.propOpex : null),
  noiMargin: v => (all(v.rentalRevenue, v.propOpex) ? div(v.rentalRevenue - v.propOpex, v.rentalRevenue) : null),
  ffo: reitFfo,
  ffoPerShare: v => div(reitFfo(v), v.wasoDil),
  ffoPayout: v => div(v.dividends, reitFfo(v)),
  reNet: v => (all(v.reGross, v.reAccumDep) ? v.reGross - v.reAccumDep : null),
  // Reads `totalDebt`, which the override above has already resolved, rather than preferring
  // `reitDebt` a second time — otherwise this row would keep using the partial figure that the
  // total had just rejected, and the two would disagree on the same sheet.
  debtToGrossRE: v => div(v.totalDebt, v.reGross),
  accumDepPct: v => div(v.reAccumDep, v.reGross),
};

// Which extra derivations run for which filer type. A lookup rather than a chain of ternaries in
// the component, so adding a set is one line here and nothing in App.
export const DERIVED_BY_INDUSTRY = {
  bank: DERIVED_BANK, pc: DERIVED_PC, life: DERIVED_LIFE, health: DERIVED_HEALTH, reit: DERIVED_REIT,
  advisory: DERIVED_ADVISORY,
};

// Year-over-year lines need the column beside them, so they are computed after the grid is built.
export const YOY = {
  revGrowth: "revenue", ebitdaGrowth: "ebitda", epsGrowth: "epsDil",
};

// ── The PRICED layer ─────────────────────────────────────────────────────────────────────────────
// Every figure that needs today's share price, as a table with the same contract as DERIVED — a
// function of the column, returning a value or null — plus the price as a second argument, because
// it is the one input that is not on the column.
//
// It is a TABLE rather than a run of statements inside `applyQuote` for the reason DERIVED is one:
// the audit can import it and check it the way it checks the other four, instead of recovering the
// layer by regexing `mark("…")` out of grid.js and then having to assert that the regex still
// matched anything. It also gives the next priced row somewhere to go: `treasuryMethod` had no home
// and sat declared-and-unimplemented for the life of the project partly because of that.
//
// ORDER IS BEHAVIOUR, exactly as in DERIVED. `applyQuote` walks this in insertion order over one
// shared `v`, so a later entry reads an earlier one's result: the four multiples read `v.ev`, and
// `pb`/`fcfYield` read `v.mktCap`. Reading the WRITTEN value rather than a local is deliberate — a
// multiple must never be built from an enterprise value the sheet has just refused to show, which
// is what `NOT_APPLICABLE` blanking means, and the audit asserts that chain.
export const DERIVED_PRICED = {
  price: (v, price) => price,
  mktCap: (v, price) => (v.sharesOut == null ? null : price * v.sharesOut),
  // The Goldman EA-proxy bridge: market cap plus debt, preferred and minority interest, less cash
  // and short-term investments. Blank without total debt rather than assuming a debt-free company.
  ev: v => (v.mktCap == null || v.totalDebt == null ? null
    : v.mktCap + v.totalDebt + (v.preferred || 0) + (v.nciBs || 0) - (v.cash || 0) - (v.sti || 0)),
  evRev: v => (v.ev && v.revenue ? v.ev / v.revenue : null),
  evEbitda: v => (v.ev && v.ebitda ? v.ev / v.ebitda : null),
  evEbit: v => (v.ev && v.ebit ? v.ev / v.ebit : null),
  evFcf: v => (v.ev && v.fcf ? v.ev / v.fcf : null),
  pe: (v, price) => (v.epsDil ? price / v.epsDil : null),
  pb: v => (v.mktCap && v.equity ? v.mktCap / v.equity : null),
  fcfYield: v => (v.mktCap && v.fcf != null ? v.fcf / v.mktCap : null),
  divYield: (v, price) => (v.dps ? v.dps / price : null),
  // The treasury stock method. All three award inputs or nothing — a count built from options while
  // the RSUs are untagged is a partial total under a label that says "fully diluted", and the row's
  // NAME is the claim. `Math.max(0, …)` is the in-the-money floor: a weighted-average strike cannot
  // say which tranches are in the money, so at or above the price the assumed buyback absorbs the
  // whole grant, and without the floor an out-of-the-money grant would SUBTRACT shares and print a
  // diluted count below basic.
  treasuryMethod: (v, price) => (v.sharesOut == null || v.optionsOut == null || v.optionsStrike == null || v.rsuOut == null
    ? null
    : v.sharesOut + Math.max(0, v.optionsOut - (v.optionsOut * v.optionsStrike) / price) + v.rsuOut),
};

// The entries whose value comes, directly or through another entry, from the cover-page share count.
// They get their own status when that count is refused as stale or filed at zero (rule 26), because
// "needs price" would be false — the price arrived and is fine — and would send a reader hunting a
// quote that is already on the page. Declared rather than derived from the function bodies, and the
// audit checks it against the transitive closure of what they actually read.
export const PRICED_NEEDS_SHARES = new Set(
  ["mktCap", "ev", "evRev", "evEbitda", "evEbit", "evFcf", "pb", "fcfYield", "treasuryMethod"]);

// Multi-year CAGRs, as [source key, years back]. Separate from YOY and from DERIVED because a
// derivation only ever sees ONE column: `v` is a single year, so a rate spanning three of them
// cannot be expressed there. Both of these have been declared in the template with a formula since
// the first version and were never implemented, which is worse than absent — the row rendered
// permanently blank on every sheet, and a blank on a computed line says nothing about why. The
// comps set is where it finally showed, because a three-year CAGR is a column an analyst expects.
export const CAGRS = {
  revCagr3: ["revenue", 3],
  revCagr5: ["revenue", 5],
};
