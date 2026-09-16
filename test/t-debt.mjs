// Rule 30 — a debt total smaller than the current maturities beside it is not the total — and the
// debtScope correction that shipped with it. Both were found on American Tower and both were measured
// across the 180-filer cache before they shipped: the guard moves one filer (AMT, $1.9m → $24,055.4m)
// and the verdict change moves NGL by $2.2m and flags UPS; nothing else changes.
//
// Drives the SHIPPING template, extract and grid. Fixtures are hand-built in the companyfacts shape
// with the real figures named to the filers they came from. Mutation-tested; each mutation is named
// beside the block it breaks.
import { ok, eq, near, done } from "./_t.mjs";
import { debtScope, NONCURRENT_DEBT } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS, OVERLAY_SECTIONS } from "../src/template.js";

const inst = (end, val, filed, form = "10-K") => ({ end, val, fy: +end.slice(0, 4), fp: "FY", filed, form, accn: `a-${filed}` });
const dur = (start, end, val, filed) => ({ start, end, val, fy: +end.slice(0, 4), fp: "FY", filed, form: "10-K", accn: `a-${filed}` });
const tagOf = arr => ({ label: "x", units: { USD: arr } });
const sheet = (facts, sic = "3571") => buildGrid({ cik: "1", name: "X", sicCode: sic, facts, filings: [] }, null, 8);
const M = 1e6;

// ── The American Tower shape: a stray inclusive figure below the current portion ────────────────
// FY2019: `LongTermDebt` $1.9m from the FY2020 10-K (a footnote figure companyfacts carries without
// its member), `LongTermDebtCurrent` $2,928.2m, and the FY2019 10-K's own
// `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities` $24,055.4m two candidates down.
// A REIT (SIC 6798), so the override's `reitDebt` row also reaches `LongTermDebt`.
// MUTATION: removing `notBelow` from the ltDebt row, or the guard loop in fillCol, prints $1.9m again.
{
  const ends = ["2018-12-31", "2019-12-31", "2020-12-31"];
  const facts = {
    Revenues: tagOf(ends.map(e => dur(`${e.slice(0, 4)}-01-01`, e, 7500 * M, `${+e.slice(0, 4) + 1}-02-25`))),
    LongTermDebtCurrent: tagOf([inst("2018-12-31", 2754.8 * M, "2019-02-27"), inst("2019-12-31", 2928.2 * M, "2020-02-25"), inst("2020-12-31", 789.8 * M, "2021-02-25")]),
    // The stray: filed for 2019-12-31 in the FY2020 10-K, newer than anything else at that date.
    LongTermDebt: tagOf([inst("2019-12-31", 1.9 * M, "2021-02-25")]),
    LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: tagOf([inst("2019-12-31", 24055.4 * M, "2020-02-25"), inst("2020-12-31", 29287.5 * M, "2021-02-25")]),
    // The evidence that the inclusive tag really does include current maturities (rule 15's identity),
    // so that the current portion is counted once: 2020 tags the non-current balance beside it.
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 18405.1 * M, "2019-02-27"), inst("2020-12-31", 28497.7 * M, "2021-02-25")]),
    CashAndCashEquivalentsAtCarryingValue: tagOf(ends.map(e => inst(e, 1501.2 * M, `${+e.slice(0, 4) + 1}-02-25`))),
  };
  const g = sheet(facts, "6798");
  const c19 = g.cols.find(c => c.period.end === "2019-12-31");
  eq(c19.meta.ltDebt.tag, "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities", "the $1.9m `LongTermDebt` is set aside and the list falls through to the filer's own inclusive total");
  near(c19.v.ltDebt, 24055.4 * M, 1, "long-term debt reads the $24,055.4m the FY2019 10-K filed");
  near(c19.v.totalDebt, 24055.4 * M, 1, "and total debt is $24,055.4m — the balance sheet's own figure, not $1.9m and not $26,983.6m with the current portion counted twice");
  ok(c19.v.ltdCurInLtDebt, "the current maturities are recognised as already inside the inclusive tag (debtScope from the 2020 evidence year)");
  eq(c19.v.reitDebt, null, "the REIT override's own row set the same stray aside and, with nothing else at that date, is blank rather than $1.9m");
  eq(c19.meta.ltDebt.rejected && c19.meta.ltDebt.rejected.tag, "LongTermDebt", "what was set aside travels with the cell, so the row can say so");
  ok(c19.v.ltDebtRejected, "and the note's key is set on the column");
  const note = SECTIONS.flatMap(s => s.lines).find(l => l.k === "ltDebt").flagNote.ltDebtRejected(c19);
  ok(/1\.9m/.test(note) && /2\.93bn/.test(note) && /LongTermDebt\b/.test(note), `the note names the figure, the tag and the current portion it fell below: ${note.slice(0, 120)}…`);
  near(c19.v.netDebt, (24055.4 - 1501.2) * M, 1, "net debt follows — it was MINUS $1.5bn");
  const c18 = g.cols.find(c => c.period.end === "2018-12-31");
  near(c18.v.totalDebt, (18405.1 + 2754.8) * M, 1, "a year with no stray is untouched: non-current plus current, as before");
}

// ── The counter-population: a NON-CURRENT balance genuinely below the current portion ───────────
// Air Industries carries $1.5m of long-term debt against $23.7m due within a year (a revolver
// classified current); iHeartMedia's non-current debt is 0 in Chapter 11 against $46m current, rule
// 24's own witness. 31 columns on 9 filers have this shape and every one but American Tower's is a
// non-current concept. They must not move, which is why the guard is confined to inclusive tags.
// MUTATION: dropping `LongTermDebtNoncurrent` from NONCURRENT_DEBT blanks Air Industries here.
{
  ok(NONCURRENT_DEBT.has("LongTermDebtNoncurrent") && NONCURRENT_DEBT.has("ConvertibleDebtNoncurrent"), "the unambiguous non-current concepts are exempt from the guard");
  const facts = {
    Revenues: tagOf([dur("2025-01-01", "2025-12-31", 50 * M, "2026-03-25")]),
    LongTermDebtNoncurrent: tagOf([inst("2025-12-31", 1.512 * M, "2026-03-25")]),
    LongTermDebtCurrent: tagOf([inst("2025-12-31", 23.721 * M, "2026-03-25")]),
  };
  const c = sheet(facts).cols[0];
  near(c.v.ltDebt, 1.512 * M, 1, "Air Industries keeps its $1.5m non-current balance below a $23.7m current portion");
  near(c.v.totalDebt, (1.512 + 23.721) * M, 1, "and its total is the sum of the two, as filed");
  ok(!c.v.ltDebtRejected, "nothing was set aside, so the note does not fire");
  const ch11 = sheet({
    Revenues: tagOf([dur("2018-01-01", "2018-12-31", 6300 * M, "2019-03-01")]),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 0, "2019-03-01")]),
    LongTermDebtCurrent: tagOf([inst("2018-12-31", 46.105 * M, "2019-03-01")]),
    LongTermDebt: tagOf([inst("2018-12-31", 15195.582 * M, "2019-03-01")]),
  }).cols[0];
  eq(ch11.v.ltDebt, 0, "iHeartMedia's filed zero under the non-current tag stands in Chapter 11 — rule 24's witness, untouched by rule 30");
}

// ── The all-in total has the same floor ─────────────────────────────────────────────────────────
// An all-in total that is smaller than the current maturities is not a total either; it falls back
// to the corporate sum exactly as one smaller than the long-term debt inside it already did.
// MUTATION: removing the `ltdCur` clause from `allIn` prints $5m here.
{
  const facts = {
    Revenues: tagOf([dur("2025-01-01", "2025-12-31", 900 * M, "2026-02-20")]),
    DebtLongtermAndShorttermCombinedAmount: tagOf([inst("2025-12-31", 5 * M, "2026-02-20")]),
    LongTermDebtCurrent: tagOf([inst("2025-12-31", 40 * M, "2026-02-20")]),
    LongTermDebtNoncurrent: tagOf([inst("2025-12-31", 700 * M, "2026-02-20")]),
  };
  const c = sheet(facts).cols[0];
  near(c.v.totalDebt, 740 * M, 1, "a $5m all-in figure below $40m of current maturities is set aside and the corporate sum prints: 40 + 700");
  eq(c.v.debtAllIn, null, "and the all-in row itself is blank, having set its only candidate aside");
}

// ── debtScope: a year that satisfies both identities decides nothing ────────────────────────────
// American Tower tags the inclusive tag, the non-current balance and the current portion for ten
// years. Eight say T = Noncurrent + Current by billions; in two the current portion was inside the
// 0.5% tolerance, so T = Noncurrent ALSO held and the verdict came out conflicting. Measured: three
// filers gain `includes` (AMT, NGL, UPS) and Cigna loses an `excludes` whose only evidence was such a
// year — which changes nothing, since excluding is the sum's default.
// MUTATION: restoring the `if / else if` without the `ex && inc` skip returns null here.
{
  const T = "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities";
  const facts = {
    [T]: tagOf([inst("2013-12-31", 14300 * M, "2014-02-25"), inst("2020-12-31", 29287.5 * M, "2021-02-25"), inst("2023-12-31", 38801.3 * M, "2024-02-27")]),
    LongTermDebtNoncurrent: tagOf([inst("2013-12-31", 14250 * M, "2014-02-25"), inst("2020-12-31", 28497.7 * M, "2021-02-25"), inst("2023-12-31", 35734 * M, "2024-02-27")]),
    LongTermDebtCurrent: tagOf([inst("2013-12-31", 50 * M, "2014-02-25"), inst("2020-12-31", 789.8 * M, "2021-02-25"), inst("2023-12-31", 3067.3 * M, "2024-02-27")]),
  };
  eq(debtScope(facts, T), "includes", "two informative years say `includes`; the 2013 year, where a $50m current portion sits inside the tolerance of a $14.3bn balance, is skipped rather than counted for both sides");
  const only = { [T]: tagOf([inst("2013-12-31", 14300 * M, "2014-02-25")]), LongTermDebtNoncurrent: tagOf([inst("2013-12-31", 14250 * M, "2014-02-25")]), LongTermDebtCurrent: tagOf([inst("2013-12-31", 50 * M, "2014-02-25")]) };
  eq(debtScope(only, T), null, "a filer whose only evidence year is uninformative gets no verdict — Cigna's shape");
  const conflict = { [T]: tagOf([inst("2019-12-31", 1000 * M, "2020-02-25"), inst("2020-12-31", 1200 * M, "2021-02-25")]),
    LongTermDebtNoncurrent: tagOf([inst("2019-12-31", 1000 * M, "2020-02-25"), inst("2020-12-31", 1100 * M, "2021-02-25")]),
    LongTermDebtCurrent: tagOf([inst("2019-12-31", 100 * M, "2020-02-25"), inst("2020-12-31", 100 * M, "2021-02-25")]) };
  eq(debtScope(conflict, T), null, "genuinely conflicting years (T = NC in one, T = NC + cur in another, both informative) still decide nothing");
}

// ── Rule 7 on the leases row: no total debt, nothing to add the leases to ───────────────────────
// `sum` treats a missing input as zero, so "Total debt incl. leases" printed the LEASE liabilities alone
// wherever total debt was blank — 109 cells on 24 filers of the cache, 70 on 15 of the material-weakness
// frame. The row is an addition to the debt figure; without one it has nothing to add to.
// MUTATION: dropping the null check prints 2.0m below.
{
  const ends = ["2019-12-31", "2020-12-31"];
  const facts = {
    Revenues: tagOf(ends.map(e => dur(`${e.slice(0, 4)}-01-01`, e, 40 * M, `${+e.slice(0, 4) + 1}-02-20`))),
    OperatingLeaseLiabilityCurrent: tagOf(ends.map(e => inst(e, 0.8 * M, `${+e.slice(0, 4) + 1}-02-20`))),
    OperatingLeaseLiabilityNoncurrent: tagOf(ends.map(e => inst(e, 1.2 * M, `${+e.slice(0, 4) + 1}-02-20`))),
  };
  const c = sheet(facts).cols.pop();
  eq(c.v.totalDebt, null, "a filer that tags no debt at all has no total debt (the Anterix shape)");
  eq(c.v.totalDebtLeases, null, "and its lease liabilities are not printed as a debt total");
  const withDebt = sheet({ ...facts, LongTermDebtNoncurrent: tagOf(ends.map(e => inst(e, 5 * M, `${+e.slice(0, 4) + 1}-02-20`))) }).cols.pop();
  eq(withDebt.v.totalDebt, 5 * M, "with debt tagged the total prints");
  eq(withDebt.v.totalDebtLeases, 7 * M, "and the leases are added to it: 5.0m + 0.8m + 1.2m");
}

// ── The rows that opted in, and the ones that must not ──────────────────────────────────────────
{
  const lines = [...SECTIONS.flatMap(s => s.lines), ...Object.values(OVERLAY_SECTIONS).flatMap(ss => ss.flatMap(s => s.lines))];
  const guarded = lines.filter(l => l.notBelow).map(l => `${l.k}:${l.notBelow}`).sort().join(" ");
  eq(guarded, "debtAllIn:ltdCur ltDebt:ltdCur reitDebt:ltdCur", "exactly the three debt-total rows declare the floor, each against the current portion");
  ok(!lines.find(l => l.k === "ltdCur").notBelow, "the current-portion row itself is never guarded against itself");
}

done("t-debt");
