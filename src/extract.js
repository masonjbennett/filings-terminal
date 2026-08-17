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
    const hit = { value: f.val, unit: f.unit, tag, accn: f.accn, form: f.form, filed: f.filed, end: f.end, start: f.start, status: "reported" };
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
export function tagsByIdentity(facts, tags, periods, minusTags, equalsTags) {
  if (!tags || tags.length < 2) return null;
  const score = new Map(tags.map(t => [t, 0]));
  let evidence = 0;
  for (const p of periods) {
    const whole = pickFact(facts, minusTags, p, {});
    const part = pickFact(facts, equalsTags, p, {});
    if (whole.value == null || part.value == null) continue;
    const want = whole.value - part.value;
    const tol = Math.max(Math.abs(whole.value) * 1e-4, 1000);
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
  // Only reorders where a LONGER run exists further down the list; a tag nothing reaches keeps its
  // place, so a filer that files one concept resolves exactly as it did before.
  return [...tags].sort((a, b) => runs.get(b) - runs.get(a) || order.get(a) - order.get(b));
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
    while (n < ps.length && ps[n - 1].start && days(ps[n].end, ps[n - 1].start) <= 1) n++;
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
function basisAgrees(facts, tag, win, fy) {
  const pri = history(facts, tag, win.prior.end, win.days - 8, win.days + 8);
  if (pri.length < 2 || !moved(pri[0].val, pri[pri.length - 1].val)) return true;   // nothing re-presented
  if (!win.prevFy) return false;
  const prev = history(facts, tag, win.prevFy.end, ANNUAL_MIN, ANNUAL_MAX);
  const inFy = prev.filter(f => f.accn === fy.accn).pop();
  return !!(inFy && prev.length > 1 && moved(prev[0].val, inFy.val));
}

export function pickLtm(facts, tags, win, ccy) {
  const fy = pickFact(facts, tags, win.fy, { ccy });
  if (fy.value == null) return { value: null, status: fy.status };
  const cur = pickSpan(facts, [fy.tag], win.cur, ccy), pri = pickSpan(facts, [fy.tag], win.prior, ccy);
  if (cur.value == null || pri.value == null || cur.unit !== fy.unit || pri.unit !== fy.unit)
    return { value: null, status: "no-interim", tag: fy.tag };
  if (!basisAgrees(facts, fy.tag, win, fy)) return { value: null, status: "restated-basis", tag: fy.tag };
  return { value: fy.value + cur.value - pri.value, unit: fy.unit, tag: fy.tag, status: "ltm",
    end: win.end, start: shift(win.end, -364), accn: fy.accn, form: fy.form, filed: fy.filed,
    basis: `FY to ${win.fy.end} + ${win.cur.start}→${win.cur.end} − ${win.prior.start}→${win.prior.end}` };
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
    if (nearly(t.val, n.val)) seen.add("excludes");
    else if (c && nearly(t.val, n.val + c.val)) seen.add("includes");
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
const allIn = (total, v) => (total != null && (v.ltDebt == null || total >= v.ltDebt) ? total : null);

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
  ebitda: v => (v.ebit == null ? null : v.ebit + (v.da || 0)),
  ebitdaSbc: v => (v.ebitda == null ? null : v.ebitda - (v.sbc || 0)),
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
  fcf: v => (v.cfo == null ? null : v.cfo - (v.capex || 0)),
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
  // A bank's total revenue IS net interest income plus fees — the identity holds exactly at
  // JPMorgan, whose `Revenues` tag ($182.4bn) equals NII $95.4bn + noninterest income $87.0bn. So
  // where a bank tags no revenue total at all this reconstructs it rather than leaving the top line
  // of the income statement blank: Truist files neither `Revenues` nor `RevenuesNetOfInterestExpense`.
  // Returns null when the filer did tag one, leaving the reported figure untouched.
  revenue: v => (v.revenue != null ? null : sum(v.nii, v.noninterestIncome)),
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

export const DERIVED_PC = {
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
