// Rule 40 — a current debt concept the rows do not ask for is part of the total where the filer's own
// arithmetic says so, at every column of that filer, and a column the rule cannot correct is refused.
// Measured before it shipped over the 180-filer cache: 6 filers moved, 196 values changed, 0 appeared,
// 10 vanished (one column, each cell carrying the refusal KIND), 0 source moved, 0 status, 0 flags, 0
// concept switches; totalDebt 21 changed and 1 vanished. Over the material-weakness frame 2 filers, 148
// values, 14 totalDebt cells, nothing vanished.
//
// Drives the SHIPPING extract, grid and template. Every fixture below is hand-built in the companyfacts
// shape with the real figures named to the filer they came from, so a block that breaks says which
// company's balance sheet it is about. Mutation-tested; each mutation is named beside the block it
// breaks, and the runner that reintroduces each defect is in the private notes beside this rule's
// record (measure/audit4/item9-current-debt/MUTATIONS.md). Cache pins at the end skip cleanly without
// the cache and hold on EITHER population — the 180-filer cache or the material-weakness frame.
import { ok, eq, near, done } from "./_t.mjs";
import { CURRENT_DEBT_UNPLACED } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

const inst = (end, val, filed, accn = `a-${filed}`, form = "10-K") => ({ end, val, fy: +end.slice(0, 4), fp: "FY", filed, form, accn });
const dur = (start, end, val, filed) => ({ start, end, val, fy: +end.slice(0, 4), fp: "FY", filed, form: "10-K", accn: `a-${filed}` });
const tagOf = arr => ({ label: "x", units: { USD: arr } });
const sheet = (facts, sic = "3728") => buildGrid({ cik: "1", name: "X", sicCode: sic, facts, filings: [] }, null, 8);
const at = (g, end) => g.cols.find(c => c.period.end === end);
const M = 1e6;
// A year of revenue for each column, so the calendar exists and the sheet is about these dates. The
// span is measured back from the period end rather than from January, because four of the filers below
// close their year in June, September or late December and `annualPeriods` measures days.
const backYear = e => { const d = new Date(`${e}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 364); return d.toISOString().slice(0, 10); };
const filedFor = e => `${+e.slice(0, 4) + 1}-03-01`;
const years = (ends, rev = 50 * M) => tagOf(ends.map(e => dur(backYear(e), e, rev, filedFor(e))));
const totalDebtLine = SECTIONS.flatMap(s => s.lines).find(l => l.k === "totalDebt");
const noteOn = (col, k) => totalDebtLine.flagNote[k](col);

// ── I1, the series, and the refusal: Air Industries, three columns of one filer ──────────────────
// FY2018 closes on the filer's own `DebtCurrent`: 19,345 = 16,793 of notes payable + 2,552 of related-
// party notes, neither of which any row asks for, against a long-term leg that excludes them. FY2020
// closes the same way. FY2019 is the column between them: that one year the filer tagged `LongTermDebt`
// rather than `LongTermDebtNoncurrent` and tagged no non-current concept beside it, so nothing says
// whether the 15,682 of notes payable is already inside the 3,406 the row resolved — and the sheet
// printed 3,406 against a filed 25,950. It is refused rather than left short between two corrected
// years. All figures $k, from the FY2021 10-K (0001213900-22-015031 R2) and the FY2019 10-K/A.
// MUTATION: dropping the `+ at most two other unasked current concepts` term leaves FY2018 at 5,721;
// dropping the refusal prints 3,406 at FY2019 beside two corrected columns.
{
  const ends = ["2018-12-31", "2019-12-31", "2020-12-31"];
  const g = sheet({
    Revenues: years(ends),
    NotesPayableCurrent: tagOf([inst("2018-12-31", 16793000, filedFor("2018-12-31")), inst("2019-12-31", 15682000, filedFor("2019-12-31")), inst("2020-12-31", 16475000, filedFor("2020-12-31"))]),
    NotesPayableRelatedPartiesClassifiedCurrent: tagOf([inst("2018-12-31", 2552000, filedFor("2018-12-31")), inst("2019-12-31", 6862000, filedFor("2019-12-31"))]),
    DebtCurrent: tagOf([inst("2018-12-31", 19345000, filedFor("2018-12-31")), inst("2020-12-31", 16475000, filedFor("2020-12-31"))]),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 5721000, filedFor("2018-12-31")), inst("2020-12-31", 10798000, filedFor("2020-12-31"))]),
    LongTermDebt: tagOf([inst("2019-12-31", 3406000, filedFor("2019-12-31"))]),
    CashAndCashEquivalentsAtCarryingValue: tagOf(ends.map(e => inst(e, 1294000, filedFor(e)))),
    // Enough of an income statement and a balance sheet that all ten rows built on total debt have a
    // figure to lose — otherwise the refusal would be tested against cells that were blank anyway.
    StockholdersEquity: tagOf(ends.map(e => inst(e, 10206000, filedFor(e)))),
    OperatingIncomeLoss: tagOf(ends.map(e => dur(backYear(e), e, 3000000, filedFor(e)))),
    DepreciationDepletionAndAmortization: tagOf(ends.map(e => dur(backYear(e), e, 330000, filedFor(e)))),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: tagOf(ends.map(e => dur(backYear(e), e, 2000000, filedFor(e)))),
    IncomeTaxExpenseBenefit: tagOf(ends.map(e => dur(backYear(e), e, 400000, filedFor(e)))),
  });
  const c18 = at(g, "2018-12-31"), c19 = at(g, "2019-12-31"), c20 = at(g, "2020-12-31");
  eq(c18.v.totalDebt, 25066000, "FY2018: the long-term balance plus the 19,345 its own DebtCurrent closes over — 5,721 + 19,345, not 5,721");
  eq(c20.v.totalDebt, 27273000, "FY2020 closes the same way: 10,798 + 16,475");
  eq((c18.meta.totalDebt.outsideTotal || {}).concept, "NotesPayableCurrent", "and the cell records which concept the column gained");
  ok((c18.meta.totalDebt.outsideTotal || {}).identity === true, "and that this column closed an identity of its own rather than inheriting one");
  eq(c19.v.totalDebt, null, "FY2019 is refused: the long-term leg's own scope is unreadable and 15,682 of notes payable sits above legs that resolved nothing");
  eq(c19.meta.totalDebt.status, CURRENT_DEBT_UNPLACED, "and the blank says which kind of blank it is (rule 5)");
  eq((c19.meta.totalDebt.unplaced || {}).concept, "NotesPayableCurrent", "naming the figure it could not place");
  for (const k of ["totalDebtLeases", "netDebt", "netDebtBridge", "debtEquity", "debtCap", "investedCap", "roic", "netLev", "grossLev"])
    eq(c19.meta[k] && c19.meta[k].status, CURRENT_DEBT_UNPLACED, `and every row derived from the refused total carries the same KIND — ${k}`);
  eq(c19.v.ltDebt, 3406000, "the long-term row itself still shows what the filer filed — only the TOTAL is refused");
  eq(c19.v.stDebt, null, "and nothing else about the column changed");
  ok(/2019-12-31 is refused/.test(noteOn(c19, "unplaced")) && /15\.7m/.test(noteOn(c19, "unplaced")), `the row's note names the column and the figure: ${noteOn(c19, "unplaced").slice(0, 90)}`);
  // The note has to carry TWO figures and keep them apart: the filer tags 16,793 of notes payable,
  // and the total gains 19,345, which is the `DebtCurrent` that covers the related-party notes too.
  // The first draft printed the ADDED amount as the tagged one ("Includes 19.3m this filer tags as
  // NotesPayableCurrent"), which is false here and at 6 more of the 21 corrected cache columns, and
  // states guard (1) backwards. MUTATION: printing `add` where `tagged` belongs fails all three.
  const n18 = noteOn(c18, "outsideTotal");
  ok(/tags 16\.8m of NotesPayableCurrent/.test(n18), `the note names the figure the FILER tags, 16,793: ${n18.slice(0, 80)}`);
  ok(/gains 19\.3m, more than the tagged figure/.test(n18), `and names the amount the total gains as a different number, 19,345: ${n18.slice(60, 170)}`);
  ok(!/tags 19\.3m/.test(n18) && !/tags 19,345/.test(n18), "and never says the filer tags the added amount — the sentence this note shipped with");
  ok((c20.meta.totalDebt.outsideTotal || {}).trivial === true, "FY2020's identity is ARITHMETIC: the filer's own DebtCurrent equals the concept, so I1 reads DebtCurrent = 0 + (DebtCurrent − 0)");
  ok(/arithmetic rather than a second witness/.test(noteOn(c20, "outsideTotal")), "and the note says so rather than claiming the filer's totals close over it — what carries that column is the long-term leg's scope, not the identity");
  ok((c18.meta.totalDebt.outsideTotal || {}).trivial === false, "FY2018's is not: its DebtCurrent is 19,345 against a concept of 16,793, so the equation says something");
  ok(/tags 15\.7m of NotesPayableCurrent/.test(noteOn(c19, "unplaced")), "and the refused column's note names the TAGGED figure too, not the excess over legs that do not exist here");
}

// ── I2 and I3, and the amount that is NOT the concept: Thermo Fisher FY2018 ──────────────────────
// The face carries ONE current line — "Short-term obligations and current maturities of long-term
// obligations 1,271" — with $693m of commercial paper inside it, and the sheet already counts that 693
// through the short-term row. So the filer's own $18,990m total is $578m more than the sheet's three-way
// sum, and $578m is what the column gains: adding the $1,271m the concept carries would count the
// commercial paper twice.
// MUTATION: adding `m` (the concept, 1,271) instead of `mPrime` (the residual, 578) prints 19,683.
{
  const g = sheet({
    Revenues: years(["2018-12-31"], 24358 * M),
    ShortTermBorrowings: tagOf([inst("2018-12-31", 693 * M, "2019-02-27")]),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 17719 * M, "2019-02-27")]),
    DebtCurrent: tagOf([inst("2018-12-31", 1271 * M, "2019-02-27")]),
    LongTermDebt: tagOf([inst("2018-12-31", 18990 * M, "2019-02-27")]),
  });
  const c = at(g, "2018-12-31");
  eq(c.v.totalDebt, 18990 * M, "total debt is the filer's own 18,990 — the sum's 18,412 plus the 578 it was short, not 19,683");
  eq(c.v.stDebt, 693 * M, "the commercial paper is still on its own row, counted once");
  // And the row note has to say both numbers, because they are different numbers: 1,271 is what the
  // filer tags, 578 is what the total gains, and the 693 between them is already on the row above.
  const nt = noteOn(c, "outsideTotal");
  ok(/tags 1\.27bn of DebtCurrent/.test(nt), `the note names the tagged figure, 1,271: ${nt.slice(0, 70)}`);
  ok(/gains 578\.0m of it/.test(nt) && /rows above already carry 693\.0m/.test(nt), `and the added amount with the reason it is smaller: ${nt.slice(60, 200)}`);
  ok(!/tags 578/.test(nt), "and does not attribute the residual to the filer as a tagged figure");
  const withAllIn = at(sheet({
    Revenues: years(["2018-12-31"], 24358 * M),
    ShortTermBorrowings: tagOf([inst("2018-12-31", 693 * M, "2019-02-27")]),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 17719 * M, "2019-02-27")]),
    DebtCurrent: tagOf([inst("2018-12-31", 1271 * M, "2019-02-27")]),
    DebtAndCapitalLeaseObligations: tagOf([inst("2018-12-31", 18990 * M, "2019-02-27")]),
  }), "2018-12-31");
  eq(withAllIn.v.totalDebt, 18990 * M, "the same column closes on an ALL-IN total (I2) where the filer tags one instead — legs 18,412 + 578");
}

// ── I3 on an inclusive long-term total: AMD FY2018 ───────────────────────────────────────────────
// `LongTermDebt` 1,250 = the non-current balance 1,114 + the 136 of `DebtCurrent` beside it, and the
// sheet printed 1,114. AMD's FY2018 net cash becomes net debt on this one line.
// MUTATION: accepting a witness that equals `lt + cu` on its own (dropping the `!eq(T, lt + cu)` test)
// admits every filer whose inclusive total is just its non-current balance, and moves this column by 0.
{
  const g = sheet({
    Revenues: years(["2018-12-29"], 6475 * M),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-29", 1114 * M, "2019-01-29")]),
    DebtCurrent: tagOf([inst("2018-12-29", 136 * M, "2019-01-29")]),
    LongTermDebt: tagOf([inst("2018-12-29", 1250 * M, "2019-01-29")]),
    CashAndCashEquivalentsAtCarryingValue: tagOf([inst("2018-12-29", 1156 * M, "2019-01-29")]),
  });
  const c = at(g, "2018-12-29");
  eq(c.v.totalDebt, 1250 * M, "total debt is 1,250 — the filer's own inclusive figure, which is 1,114 + 136");
  ok(c.v.netDebt > 0, "and AMD's net cash is net debt once the 136 due inside a year is counted");
}

// ── I4, the reclassification nobody tags twice: Shopify FY2024 ───────────────────────────────────
// `ConvertibleDebtNoncurrent` falls 916 to 0 while `ConvertibleDebtCurrent` rises 0 to 918 — the notes
// came due, and the row the sheet reads went to zero with them. Total debt printed $0 and total
// debt/EBITDA 0.00x for a company with $918m of convertible notes due inside a year.
// MUTATION: requiring the drop and the rise to match within two reporting units rather than 1% of the
// concept misses the $2m of accretion between them and leaves the total at 0.
{
  const ends = ["2023-12-31", "2024-12-31"];
  const g = sheet({
    Revenues: years(ends, 8880 * M),
    ConvertibleDebtNoncurrent: tagOf([inst("2023-12-31", 916 * M, "2024-02-15"), inst("2024-12-31", 0, "2025-02-11")]),
    ConvertibleDebtCurrent: tagOf([inst("2024-12-31", 918 * M, "2025-02-11")]),
  }, "7372");
  eq(at(g, "2023-12-31").v.totalDebt, 916 * M, "FY2023 is the non-current balance, untouched");
  eq(at(g, "2024-12-31").v.totalDebt, 918 * M, "FY2024 is 918, not 0 — the balance moved from one side of the sheet to the other");
  eq((at(g, "2024-12-31").meta.totalDebt.outsideTotal || {}).concept, "ConvertibleDebtCurrent", "and the column says which concept carries it");
}

// ── Guard: the residual must be POSITIVE — Nuo Xu Medical FY2025 ─────────────────────────────────
// The long-term leg fell 3,573 while `NotesPayableCurrent` rose 3,573, which is I4's shape exactly — and
// this filer's current maturities row already carries 9,622,547, so the amount the identity would add is
// MINUS 9,610,022. A coincidence of $3,573 on a nano-cap, not a reclassification.
// MUTATION: dropping the sign test subtracts $9.6m from a $9.76m total.
{
  const ends = ["2024-12-31", "2025-12-31"];
  const g = sheet({
    Revenues: years(ends, 2200000),
    LongTermDebtNoncurrent: tagOf([inst("2024-12-31", 140217, "2025-04-15"), inst("2025-12-31", 136644, "2026-04-15")]),
    LongTermDebtCurrent: tagOf([inst("2024-12-31", 9000000, "2025-04-15"), inst("2025-12-31", 9622547, "2026-04-15")]),
    NotesPayableCurrent: tagOf([inst("2024-12-31", 8952, "2025-04-15"), inst("2025-12-31", 12525, "2026-04-15")]),
    DebtCurrent: tagOf([inst("2025-12-31", 12525, "2026-04-15")]),
  });
  const c = at(g, "2025-12-31");
  eq(c.v.totalDebt, 9759191, "the total is the sum as filed — 136,644 + 9,622,547 — and nothing is subtracted from it");
  ok(!c.meta.totalDebt.outsideTotal && c.meta.totalDebt.status === "computed", "no correction is recorded on the column");
  eq(c.meta.totalDebt.status === CURRENT_DEBT_UNPLACED, false, "and nothing is refused: the concepts here sit BELOW the current legs, which is not the shape the refusal is for");
}

// ── Guard: the residual over the legs is the filer's own FINANCE LEASE — Lam Research FY2019 ─────
// `LongTermDebtAndCapitalLeaseObligationsCurrent` and `DebtCurrent` both read 667,131 against a current
// maturities row of 662,308, and the 4,823 between them is the current slice of a finance lease —
// `CapitalLeaseObligationsCurrent` 4,858, a 35 gap that two units of 1e3 cannot see and 1% of the
// residual can. The sheet's 4,430,011 is the debt-only total and is right as debt.
// MUTATION: comparing at two reporting units instead of max(1% of the residual, two units) adds 4,823
// of lease to Lam's debt; so does dropping `CapitalLeaseObligationsCurrent` from api/facts.js's KEEP,
// which is the same failure one layer earlier — the guard reads nothing and fires never.
{
  const g = sheet({
    Revenues: years(["2019-06-30"], 9654 * M),
    LongTermDebtNoncurrent: tagOf([inst("2019-06-30", 3767703000, "2019-08-20")]),
    LongTermDebtCurrent: tagOf([inst("2019-06-30", 662308000, "2019-08-20")]),
    DebtCurrent: tagOf([inst("2019-06-30", 667131000, "2019-08-20")]),
    LongTermDebtAndCapitalLeaseObligationsCurrent: tagOf([inst("2019-06-30", 667131000, "2019-10-29", "a-10q", "10-Q")]),
    CapitalLeaseObligationsCurrent: tagOf([inst("2019-06-30", 4858000, "2019-08-20")]),
  });
  const c = at(g, "2019-06-30");
  eq(c.v.totalDebt, 4430011000, "Lam's total debt is 3,767,703 + 662,308 and does not move");
  ok(!c.meta.totalDebt.outsideTotal, "no correction is recorded");
}

// ── Guard: a FAMILY total is not a claim about the whole debt — Sanmina FY2018 ───────────────────
// `OtherNotesPayable` 17,667 = the long-term leg 14,346 + `OtherNotesPayableCurrent` 3,321, which settles
// the other-notes family and says nothing about the 593,321 of current debt beside it. A witness has to
// be big enough to hold the long-term leg AND the largest current debt figure the filer tags.
// MUTATION: dropping the `whole` test admits the family total and prints 17,667 here.
{
  const g = sheet({
    Revenues: years(["2018-09-29"], 7110 * M),
    LongTermDebtNoncurrent: tagOf([inst("2018-09-29", 14346000, "2018-11-16")]),
    OtherNotesPayableCurrent: tagOf([inst("2018-09-29", 3321000, "2018-11-16")]),
    OtherNotesPayable: tagOf([inst("2018-09-29", 17667000, "2018-11-16")]),
    DebtCurrent: tagOf([inst("2018-09-29", 593321000, "2018-11-16")]),
  });
  const c = at(g, "2018-09-29");
  eq(c.v.totalDebt, 14346000, "nothing is proved at this column on its own, so the total is the sum as filed");
  ok(!c.meta.totalDebt.outsideTotal, "and the family total did not license a correction");
}

// ── Guard: terms are read from the SAME FILING as the long-term leg — Thermo Fisher FY2020 ───────
// `LongTermDebt` for 2020-12-31 is 21,735 in the filing the long-term leg came from and 21,728 as later
// restated. Read at rule 2's newest, the identity misses by $7m on a $21.7bn total and the column is left
// $2.63bn short between two corrected years; read inside the leg's own filing, it closes exactly.
// MUTATION: reading the witness at rule 2's newest (dropping the `same` preference) leaves 19,107 here.
{
  const g = sheet({
    Revenues: years(["2020-12-31"], 32218 * M),
    LongTermDebtNoncurrent: tagOf([inst("2020-12-31", 19107 * M, "2021-08-06", "a-leg", "10-Q")]),
    DebtCurrent: tagOf([inst("2020-12-31", 2628 * M, "2021-08-06", "a-leg", "10-Q")]),
    LongTermDebt: tagOf([inst("2020-12-31", 21735 * M, "2021-08-06", "a-leg", "10-Q"), inst("2020-12-31", 21728 * M, "2022-02-23", "a-later")]),
  });
  const c = at(g, "2020-12-31");
  eq(c.meta.ltDebt.accn, "a-leg", "the long-term leg came from the 10-Q filed 2021-08-06");
  eq(c.v.totalDebt, 21735 * M, "and the witness is read inside that filing: 19,107 + 2,628 = 21,735, not the 21,728 of the later restatement");
}

// ── The series: a column with no identity of its own — 3M FY2018 ─────────────────────────────────
// 3M's only two columns that close an identity are trailing-twelve-month ones. Its eight annual columns
// close nothing, and per column the rule would correct two LTM cells and none of the annual ones — a row
// that moves in two columns and not in the six beside them. The filed face closes on the extended
// figures: FY2018 14,622 = 13,411 + 1,211 and FY2019 20,313 = 17,518 + 2,795 (0000066740-20-000581 R4).
// MUTATION: dropping the class-(iv) branch of the series leaves FY2018 at 13,411 beside a corrected 2020.
{
  const ends = ["2018-12-31", "2019-12-31", "2020-12-31"];
  const g = sheet({
    Revenues: years(ends, 32136 * M),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 13411 * M, "2019-02-07"), inst("2019-12-31", 17518 * M, "2020-02-06"), inst("2020-12-31", 17989 * M, "2021-02-09")]),
    DebtCurrent: tagOf([inst("2018-12-31", 1211 * M, "2019-02-07"), inst("2019-12-31", 2795 * M, "2020-02-06"), inst("2020-12-31", 806 * M, "2021-02-09")]),
    // Only the newest column tags the inclusive total that closes the identity.
    LongTermDebt: tagOf([inst("2020-12-31", 18795 * M, "2021-02-09")]),
  });
  eq(at(g, "2020-12-31").v.totalDebt, 18795 * M, "the column that closes an identity gains its own residual");
  eq(at(g, "2018-12-31").v.totalDebt, 14622 * M, "FY2018 has no identity of its own and gains the same shape: 13,411 + 1,211, the filed face");
  eq(at(g, "2019-12-31").v.totalDebt, 20313 * M, "and FY2019: 17,518 + 2,795");
  eq((at(g, "2018-12-31").meta.totalDebt.outsideTotal || {}).identity, false, "the extended columns say so on the cell — they inherited the filer's convention rather than proving it");
  ok(/closes no identity of its own/.test(noteOn(at(g, "2018-12-31"), "outsideTotal")), "and the note says so rather than claiming this column's own arithmetic");
  // The other half of the note's job: at this column the tagged figure and the added amount ARE the
  // same 806, because the sheet has no current debt row for any of it to be inside. The note says it
  // once and does not invent a second figure. TMO FY2018 above is the same test where they differ.
  const n20 = noteOn(at(g, "2020-12-31"), "outsideTotal");
  ok(/tags 806\.0m of DebtCurrent/.test(n20) && /gains that figure in full/.test(n20), `tagged and gained are one number here, and the note prints it once: ${n20.slice(0, 120)}`);
  ok(/tags 1\.21bn of DebtCurrent/.test(noteOn(at(g, "2018-12-31"), "outsideTotal")), "and the extended column names its own tagged figure, not the one from the column that closed the identity");
}

// ── A filer that proves nothing is not touched ───────────────────────────────────────────────────
// The same 3M shape with no inclusive total anywhere: `DebtCurrent` sits above the legs at every column
// and nothing says whether it is inside the long-term figure. 196 cache columns on 40 filers are in
// exactly this position and every one of them still prints. The refusal is for row CONSISTENCY — a
// column left short beside its corrected siblings — not for data quality.
// MUTATION: refusing on the class-(iv) shape alone (dropping the "this filer proved it somewhere" gate)
// blanks 196 columns of the cache instead of 1.
{
  const ends = ["2018-12-31", "2019-12-31"];
  const g = sheet({
    Revenues: years(ends, 32136 * M),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 13411 * M, "2019-02-07"), inst("2019-12-31", 17518 * M, "2020-02-06")]),
    DebtCurrent: tagOf([inst("2018-12-31", 1211 * M, "2019-02-07"), inst("2019-12-31", 2795 * M, "2020-02-06")]),
  });
  eq(at(g, "2018-12-31").v.totalDebt, 13411 * M, "nothing proved, nothing added");
  eq(at(g, "2019-12-31").meta.totalDebt.status, "computed", "and nothing refused");
}

// ── Already accounted for: the three containment tests ───────────────────────────────────────────
// A concept equal to a leg is that line tagged twice (rule 16's shape); one the filer's own all-in total
// already covers is inside it; one the long-term leg's non-current sibling leaves as the difference is
// inside THAT. None of the three is missing from the total, and treating any of them as missing is the
// double count this rule exists not to create.
// MUTATION: removing any containment test moves one of the three columns below.
{
  const dupLeg = at(sheet({
    Revenues: years(["2020-12-31"], 900 * M),
    LongTermDebtNoncurrent: tagOf([inst("2020-12-31", 700 * M, "2021-02-20")]),
    LongTermDebtCurrent: tagOf([inst("2020-12-31", 40 * M, "2021-02-20")]),
    DebtCurrent: tagOf([inst("2020-12-31", 40 * M, "2021-02-20")]),
    LongTermDebt: tagOf([inst("2020-12-31", 740 * M, "2021-02-20")]),
  }), "2020-12-31");
  eq(dupLeg.v.totalDebt, 740 * M, "a concept equal to the current maturities row is that row again: 700 + 40, counted once");
  const insideAllIn = at(sheet({
    Revenues: years(["2020-12-31"], 900 * M),
    DebtLongtermAndShorttermCombinedAmount: tagOf([inst("2020-12-31", 800 * M, "2021-02-20")]),
    LongTermDebtNoncurrent: tagOf([inst("2020-12-31", 700 * M, "2021-02-20")]),
    ConvertibleDebtCurrent: tagOf([inst("2020-12-31", 100 * M, "2021-02-20")]),
  }), "2020-12-31");
  eq(insideAllIn.v.totalDebt, 800 * M, "the filer's own all-in total already covers every current debt concept — 800, not 900");
  const insideLt = at(sheet({
    Revenues: years(["2020-12-31"], 900 * M),
    LongTermDebt: tagOf([inst("2020-12-31", 800 * M, "2021-02-20")]),
    ConvertibleDebtNoncurrent: tagOf([inst("2020-12-31", 700 * M, "2021-02-20")]),
    ConvertibleDebtCurrent: tagOf([inst("2020-12-31", 100 * M, "2021-02-20")]),
  }), "2020-12-31");
  eq(insideLt.v.ltDebt, 800 * M, "the long-term row resolved the filer's inclusive figure");
  eq(insideLt.v.totalDebt, 800 * M, "and the convertible due inside a year is the difference between that figure and the non-current balance beside it — inside the leg, not missing from it");
}

// ── Inside the leg by the filer's CONVENTION, not by this column's arithmetic — Thermo Fisher ────
// From FY2021 Thermo Fisher's long-term row resolves an inclusive `LongTermDebt` and it tags no
// non-current balance beside it, so nothing in that column says whether its `DebtCurrent` is inside.
// The filer's OWN earlier years do: 18,990 = 17,719 + 1,271 is the convention, read once and applied.
// Nine Thermo Fisher cells are class (ii) on this verdict — and the shipping `debtScope` returns
// `excludes` for the same tag, because it only counts `LongTermDebtCurrent` as the current piece and
// this filer tags `DebtCurrent`. Reading that verdict here instead would move a filer that is right.
// MUTATION: reading `debtScope` in place of this rule's own convention adds 5,579 to FY2022.
{
  const ends = ["2018-12-31", "2022-12-31"];
  const g = sheet({
    Revenues: years(ends, 44915 * M),
    LongTermDebtNoncurrent: tagOf([inst("2018-12-31", 17719 * M, "2019-02-27")]),
    DebtCurrent: tagOf([inst("2018-12-31", 1271 * M, "2019-02-27"), inst("2022-12-31", 5579 * M, "2023-02-22")]),
    LongTermDebt: tagOf([inst("2018-12-31", 18990 * M, "2019-02-27"), inst("2022-12-31", 34278 * M, "2023-02-22")]),
  });
  eq(at(g, "2018-12-31").v.totalDebt, 18990 * M, "the evidence year closes its own identity and is corrected");
  eq(at(g, "2022-12-31").meta.ltDebt.tag, "LongTermDebt", "the later column's long-term row resolves the inclusive concept");
  eq(at(g, "2022-12-31").v.totalDebt, 34278 * M, "and its DebtCurrent is already inside that figure — 34,278, not 39,857");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
// These hold on either population: the 180-filer cache or the 36-filer material-weakness frame, which
// is where Sanmina and Lyft live. A ticker the cache does not carry is skipped, but the LAST check is
// the one that cannot be skipped — no filer outside this list may gain a rule-40 decision anywhere.
if (needFixtures("t-r40 cache pins")) {
  const MOVED = [
    ["AIRI", "2018-12-31", 5721000, 25066000], ["AIRI", "2020-12-31", 10798000, 27273000], ["AIRI", "2021-12-31", 9298000, 23362000],
    ["AMD", "2018-12-29", 1114 * M, 1250 * M],
    ["MMM", "2018-12-31", 13411 * M, 14622 * M], ["MMM", "2019-12-31", 17518 * M, 20313 * M], ["MMM", "2020-12-31", 18783 * M, 18795 * M],
    ["MMM", "2021-12-31", 17347 * M, 17363 * M], ["MMM", "2023-12-31", 14240 * M, 16035 * M],
    ["NPHC", "2018-12-31", 1617843, 3389986], ["NPHC", "2019-12-31", 907912, 8260866], ["NPHC", "2021-12-31", 369401, 7969847],
    ["SHOP", "2024-12-31", 0, 918 * M],
    ["TMO", "2018-12-31", 18412 * M, 18990 * M], ["TMO", "2019-12-31", 17076 * M, 17752 * M], ["TMO", "2020-12-31", 19107 * M, 21735 * M],
    ["SANM", "2018-09-29", 14346000, 607667000], ["SANM", "2021-10-02", 311572000, 330322000], ["SANM", "2025-09-27", 282974000, 300474000],
    ["LYFT", "2024-12-31", 604872000, 995047000],
  ];
  // Columns that must NOT move, each for its own reason: the filed total is already right (MMM FY2022),
  // the residual is a finance lease (LRCX), the filer closes no identity anywhere (Deere, $32.89bn
  // against a filed $48.41bn — the open half of this question, not this rule's), and the residual is
  // negative (NPHC FY2025).
  const STILL = [["MMM", "2022-12-31", 15939 * M], ["LRCX", "2019-06-30", 4430011000], ["DE", "2021-10-31", 32888 * M], ["NPHC", "2025-12-31", 9759191]];
  const have = new Set(fixtureTickers());
  const grids = new Map();
  const gridOf = t => { if (!grids.has(t)) { let g = null; try { g = buildGrid(loadFixture(t), null, 8); } catch { g = null; } grids.set(t, g && !g.empty ? g : null); } return grids.get(t); };
  let pinned = 0;
  for (const [t, end, before, after] of MOVED) {
    if (!have.has(t)) continue;
    const g = gridOf(t), c = g && at(g, end);
    ok(!!c, `${t} ${end} is a column of the cached sheet`);
    if (!c) continue;
    pinned++;
    near(c.v.totalDebt, after, Math.max(1, Math.abs(after) * 1e-9), `${t} ${end} total debt is ${after.toLocaleString()} — it read ${before.toLocaleString()}`);
    ok(!!c.meta.totalDebt.outsideTotal, `and the column records what it gained — ${t} ${end}`);
  }
  for (const [t, end, still] of STILL) {
    if (!have.has(t)) continue;
    const g = gridOf(t), c = g && at(g, end);
    if (!c) continue;
    pinned++;
    near(c.v.totalDebt, still, Math.max(1, Math.abs(still) * 1e-9), `${t} ${end} does not move: ${still.toLocaleString()}`);
    ok(!c.meta.totalDebt.outsideTotal && c.meta.totalDebt.status !== CURRENT_DEBT_UNPLACED, `and carries no rule-40 decision — ${t} ${end}`);
  }
  ok(pinned >= 4, `the pins above ran against real filers (${pinned} columns) rather than skipping into silence`);
  if (have.has("AIRI")) {
    const c = at(gridOf("AIRI"), "2019-12-31");
    eq(c.v.totalDebt, null, "Air Industries FY2019 is the one refused column on either population — it printed 3,406 against a filed 25,950");
    eq(c.meta.totalDebt.status, CURRENT_DEBT_UNPLACED, "with the KIND on it");
    for (const k of ["totalDebtLeases", "netDebt", "netDebtBridge", "debtEquity", "debtCap", "investedCap", "roic", "netLev", "grossLev"])
      eq(c.meta[k] && c.meta[k].status, CURRENT_DEBT_UNPLACED, `and on every row derived from it — ${k}. Ten cells, ten reasons`);
  }
  // The whole population, so a rule that started firing somewhere new is caught by the suite rather
  // than by the next full-diff.
  const touched = new Set(), refused = [];
  for (const t of fixtureTickers()) {
    const g = gridOf(t); if (!g) continue;
    for (const c of [...g.cols, ...g.ltmCols]) {
      const m = c.meta.totalDebt || {};
      if (m.outsideTotal) touched.add(t);
      if (m.status === CURRENT_DEBT_UNPLACED) { touched.add(t); refused.push(`${t} ${c.period.ltm ? "LTM " : ""}${c.period.end}`); }
    }
  }
  const expected = fixtureTickers().length > 100 ? "AIRI AMD MMM NPHC SHOP TMO" : "LYFT SANM";
  eq([...touched].sort().join(" "), expected, `exactly the filers the measurement names carry a rule-40 decision on this population (${fixtureTickers().length} fixtures)`);
  eq(refused.join(" "), fixtureTickers().length > 100 ? "AIRI 2019-12-31" : "", "and the refusal fires on one column of the cache and none of the frame");
}

done("t-r40");
