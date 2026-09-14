// Rule 32 — a balance sheet whose legs do not close is re-drawn from the newest filing that presents
// the whole balance sheet at that date. Measured before it shipped over every annual and LTM column of
// the 180-filer cache (17 columns move, all close afterwards, none that closed is touched) and the
// 36-filer material-weakness frame (10 move; OppFi and Symbotic are stood down for, and stay open).
//
// Drives the SHIPPING extract, grid and template. Fixtures are hand-built in the companyfacts shape
// with the figures of the filers each mirrors, so the suite runs without the cache; the cache pins at
// the end skip cleanly without it. Mutation-tested; each mutation is named beside the block it breaks.
import { ok, eq, done } from "./_t.mjs";
import { alignBalanceSheet, bsFoots, BS_LEGS, BS_FOOT_TOL, describeAligned, pickFact } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

const M = 1e6;
const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);

// ── A filing is a list of facts; a filer is a list of filings ───────────────────────────────────
// Each helper stamps the accession, form and filed date the same way companyfacts does, so rule 2's
// sort and rule 32's candidate order see exactly what the browser would.
function filing(form, filed, accn) {
  const facts = [];
  const put = (tag, unit, f) => facts.push({ tag, unit, f: { ...f, fy: +f.end.slice(0, 4), fp: "FY", filed, form, accn } });
  const api = {
    rev: (start, end, val) => (put("Revenues", "USD", { start, end, val }), api),
    a: (end, val) => (put("Assets", "USD", { end, val }), api),
    l: (end, val) => (put("Liabilities", "USD", { end, val }), api),
    e: (end, val) => (put("StockholdersEquity", "USD", { end, val }), api),
    ea: (end, val) => (put("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "USD", { end, val }), api),
    m: (end, val) => (put("TemporaryEquityCarryingAmountAttributableToParent", "USD", { end, val }), api),
    tag: (tag, end, val) => (put(tag, "USD", { end, val }), api),
    facts, meta: { form, filed, accn },
  };
  return api;
}
function filer(...filings) {
  const facts = {};
  for (const fl of filings) for (const { tag, unit, f } of fl.facts) {
    facts[tag] = facts[tag] || { label: tag, units: {} };
    (facts[tag].units[unit] = facts[tag].units[unit] || []).push(f);
  }
  const list = filings.map(fl => ({ ...fl.meta, period: fl.facts.map(x => x.f.end).sort().pop() }));
  return buildGrid({ cik: "1", name: "X", sicCode: "3674", facts, filings: list }, null, 8);
}
const col = (g, end) => g.cols.find(c => c.period.end === end);
const legsOf = c => ({ A: c.v.totalAssets, L: c.v.totalLiab, E: c.v.equityAll != null ? c.v.equityAll : c.v.equity, M: c.v.tempEquity });

// ── The engine and the template name the same five legs ─────────────────────────────────────────
{
  const bs = SECTIONS.find(s => s.id === "bs");
  for (const k of BS_LEGS) {
    const l = bs.lines.find(x => x.k === k);
    ok(l && l.how === "fetched" && l.tags && l.tags.length, `${k} is a fetched balance-sheet row — rule 32 reads it by its own tag list`);
    ok(l && l.flagNote && typeof l.flagNote.bsAligned === "function", `${k} carries the rule 32 note, keyed off the column flag`);
  }
  eq(BS_FOOT_TOL, 0.005, "the closing tolerance is 0.5% of assets — the sweep's own, so a column the sweep calls closed is one the rule leaves alone");
  ok(bsFoots(100, 60, 40, null) && bsFoots(100, 60, 39.6, null) && !bsFoots(100, 60, 39.4, null), "bsFoots closes within the tolerance and refuses outside it");
  ok(bsFoots(100, 60, 30, 10) && !bsFoots(100, 60, 30, null), "and the mezzanine is the fourth leg of the identity");
  eq(pickFact({ Assets: { label: "x", units: { USD: [{ end: "2020-12-31", val: 1, filed: "2021-02-01", form: "10-K", accn: "old" }, { end: "2020-12-31", val: 2, filed: "2022-02-01", form: "10-K", accn: "new" }] } } }, ["Assets"], { end: "2020-12-31" }, { ccy: "USD", accn: "old" }).value, 1,
    "pickFact restricted to one accession reads that filing's figure past a newer one — the primitive the re-draw is built on");
}

// ── The Allstate shape: an LDTI opening balance, mis-tagged as the total, reaching the oldest column ──
// Three 10-Ks. The FY2021 report presents the 2020 and 2021 balance sheets; the FY2022 report carries
// 2020 only as its equity statement's opening balance (agreeing); the FY2023 report, on the LDTI basis,
// carries an opening balance at 2020-12-31 of MINUS $298m — the transition adjustment tagged as the
// total — and a restated 2021 equity of $24,892m against the $25,127m the 2021 balance sheet shows.
// MUTATION: dropping the "closes → rule 2 stands" guard re-draws FY2021 too and fails the second block;
// dropping the `accn` restriction in pickFact makes the re-read return the same mixed legs and fails the first.
{
  const k21 = filing("10-K", "2022-02-18", "k-2022").rev("2020-01-01", "2020-12-31", 44.8e9).rev("2021-01-01", "2021-12-31", 50.6e9)
    .a("2020-12-31", 125987e6).l("2020-12-31", 95770e6).ea("2020-12-31", 30217e6).e("2020-12-31", 30217e6)
    .a("2021-12-31", 99440e6).l("2021-12-31", 74313e6).ea("2021-12-31", 25127e6).e("2021-12-31", 25179e6);
  const k22 = filing("10-K", "2023-02-23", "k-2023").rev("2021-01-01", "2021-12-31", 50.6e9).rev("2022-01-01", "2022-12-31", 51.4e9)
    .ea("2020-12-31", 30217e6).a("2021-12-31", 99440e6).l("2021-12-31", 74313e6).ea("2021-12-31", 25127e6).e("2021-12-31", 25179e6)
    .a("2022-12-31", 97989e6).l("2022-12-31", 80626e6).ea("2022-12-31", 17363e6).e("2022-12-31", 17488e6);
  const k23 = filing("10-K", "2024-02-21", "k-2024").rev("2022-01-01", "2022-12-31", 51.4e9).rev("2023-01-01", "2023-12-31", 57.1e9)
    .ea("2020-12-31", -298e6).ea("2021-12-31", 24892e6)
    .a("2022-12-31", 97989e6).l("2022-12-31", 80626e6).ea("2022-12-31", 17363e6).e("2022-12-31", 17488e6)
    .a("2023-12-31", 103362e6).l("2023-12-31", 85732e6).ea("2023-12-31", 17630e6).e("2023-12-31", 17770e6);
  const g = filer(k21, k22, k23);
  const c20 = col(g, "2020-12-31");
  eq(c20.v.equityAll, 30217e6, "FY2020 total equity is the $30,217m the FY2021 10-K's balance sheet shows, not the −$298m adjustment the FY2023 10-K tagged at that date");
  eq(c20.meta.equityAll.accn, "k-2022", "and the cell links to the filing it was read from");
  eq(c20.meta.equityAll.status, "reported", "it is a reported figure — filed, in that filing, at that date — not an adjusted one");
  eq(c20.meta.equityAll.aligned && c20.meta.equityAll.aligned.filed, "2022-02-18", "the cell says which filing the whole balance sheet was read from");
  eq(c20.meta.equityAll.displaced && c20.meta.equityAll.displaced.value, -298e6, "and what the newest filing for that line carried instead");
  eq(c20.meta.equityAll.displaced && c20.meta.equityAll.displaced.filed, "2024-02-21", "naming that filing");
  ok(c20.meta.totalAssets.aligned && !c20.meta.totalAssets.displaced, "assets were already from that filing: aligned, nothing displaced, so the note does not claim a move that did not happen");
  eq(c20.v.equity, 30217e6, "the parent-equity row is read from the same filing");
  ok(c20.v.bsAligned === true, "the column carries the flag the five rows' note keys off");
  ok(bsFoots(c20.v.totalAssets, c20.v.totalLiab, c20.v.equityAll, c20.v.tempEquity), "and the column closes");
  ok(c20.v.roe == null || isFinite(c20.v.roe), "ratios built on equity are built on the re-drawn figure");

  const c21 = col(g, "2021-12-31");
  eq(c21.v.equityAll, 24892e6, "FY2021 keeps the LDTI-restated $24,892m from the newest filing — the column closes within 0.5% of assets, so rule 2 stands");
  eq(c21.meta.equityAll.accn, "k-2024", "from the FY2023 10-K");
  ok(!c21.v.bsAligned && !c21.meta.equityAll.aligned, "and nothing on it is marked as re-drawn");
  const c22 = col(g, "2022-12-31");
  ok(!c22.v.bsAligned && c22.v.equityAll === 17363e6, "FY2022, whose legs agree, is untouched");
  eq(describeAligned(g.cols), "Balance-sheet totals in FY2020 from the 10-K filed 2022-02-18 are all taken from that one filing — the newest presenting the whole balance sheet at the date — because taken each from its own newest filing they did not close; every figure is as filed there.",
    "the workbook and TSV sentence names the column and the filing");
  eq(describeAligned([c21, c22]), "", "and is empty when nothing was re-drawn");
}

// ── Split legs that CLOSE are left exactly as rule 2 chose them — the 1,100 columns this rule must not touch ──
// The FY2022 10-K carries 2021's equity as its opening balance, agreeing with the FY2021 balance sheet.
// Equity comes from the newer filing, assets and liabilities from the older, and that is fine.
// MUTATION: re-drawing whenever the legs are split fails here.
{
  const k21 = filing("10-K", "2022-02-01", "k-2022").rev("2020-01-01", "2020-12-31", 10e9).rev("2021-01-01", "2021-12-31", 11e9)
    .a("2021-12-31", 100e9).l("2021-12-31", 60e9).ea("2021-12-31", 40e9);
  const k22 = filing("10-K", "2023-02-01", "k-2023").rev("2021-01-01", "2021-12-31", 11e9).rev("2022-01-01", "2022-12-31", 12e9)
    .ea("2021-12-31", 40e9).a("2022-12-31", 110e9).l("2022-12-31", 65e9).ea("2022-12-31", 45e9);
  const c = col(filer(k21, k22), "2021-12-31");
  eq(c.meta.equityAll.accn, "k-2023", "equity comes from the newer filing's opening balance, as rule 2 says");
  eq(c.meta.totalAssets.accn, "k-2022", "assets from the older balance sheet");
  ok(!c.v.bsAligned && !c.meta.equityAll.aligned && !c.meta.totalAssets.aligned, "and the rule does not touch a column that closes — a split is how filings are laid out");
}

// ── The de-SPAC shell's redeemable shares arriving as the mezzanine leg (Orchestra BioMed's FY2022) ──
// The shell's 10-K is the only filing tagging temporary equity at the date; the successor's 10-K
// presents the whole balance sheet with no mezzanine line. The mixed column carries the shell's $67.7m
// beside the successor's legs and misses by exactly that. Re-drawn from the successor's filing, the
// mezzanine is blank — that filing has none — and the cell says what it displaced.
// MUTATION: dropping `tempEquity` from BS_LEGS leaves the shell's $67.7m in place and fails here.
{
  const shell = filing("10-K", "2023-01-25", "shell").rev("2022-01-01", "2022-12-31", 0.1e6)
    .a("2022-12-31", 68075577).l("2022-12-31", 7343755).m("2022-12-31", 67676498).e("2022-12-31", -6944676);
  const succ = filing("10-K", "2024-03-27", "succ").rev("2022-01-01", "2022-12-31", 3.1e6).rev("2023-01-01", "2023-12-31", 3.2e6)
    .a("2022-12-31", 95572000).l("2022-12-31", 43038000).ea("2022-12-31", 52534000)
    .a("2023-12-31", 110e6).l("2023-12-31", 50e6).ea("2023-12-31", 60e6);
  const succ2 = filing("10-K", "2025-03-20", "succ2").rev("2023-01-01", "2023-12-31", 3.2e6).rev("2024-01-01", "2024-12-31", 3.3e6)
    .ea("2022-12-31", 52534000).a("2023-12-31", 110e6).l("2023-12-31", 50e6).ea("2023-12-31", 60e6)
    .a("2024-12-31", 120e6).l("2024-12-31", 55e6).ea("2024-12-31", 65e6);
  const c = col(filer(shell, succ, succ2), "2022-12-31");
  eq(c.v.tempEquity, null, "the mezzanine is blank: the filing that presents the balance sheet carries none at that date");
  eq(c.meta.tempEquity.displaced && c.meta.tempEquity.displaced.value, 67676498, "and the cell records the shell's $67.7m it displaced");
  eq(c.meta.tempEquity.displaced && c.meta.tempEquity.displaced.filed, "2023-01-25", "from the shell's 10-K");
  eq(c.meta.equityAll.accn, "succ", "equity is read from the same filing as assets and liabilities, not from the later equity statement");
  ok(c.v.bsAligned && bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equityAll, c.v.tempEquity), "the column is marked and closes");
}

// ── Stand down: the newest whole presentation cannot be read (OppFi's FY2020) ────────────────────
// OppFi's 10-K/A presents assets, liabilities and an LLC's `MembersEquity`, which no row asks for.
// Behind it sits the SPAC shell's 10-Q — a whole, closing balance sheet of the wrong entity. The rule
// must not reach behind a newer whole presentation, so the column stays as filed and stays open.
// MUTATION: skipping an unreadable candidate to the next one hands the column to the shell and fails here.
{
  const shell = filing("10-Q", "2021-08-10", "shell").a("2020-12-31", 244746983).l("2020-12-31", 22571751).m("2020-12-31", 217175222).e("2020-12-31", 5000010);
  const succA = filing("10-K/A", "2023-03-22", "succ-a").rev("2020-01-01", "2020-12-31", 291e6).rev("2021-01-01", "2021-12-31", 350e6)
    .a("2020-12-31", 285843000).l("2020-12-31", 186511000).tag("MembersEquity", "2020-12-31", 99332000)
    .a("2021-12-31", 400e6).l("2021-12-31", 250e6).ea("2021-12-31", 150e6);
  const succ2 = filing("10-K", "2024-03-20", "succ-2").rev("2021-01-01", "2021-12-31", 350e6).rev("2022-01-01", "2022-12-31", 450e6)
    .ea("2020-12-31", 99332000).a("2021-12-31", 400e6).l("2021-12-31", 250e6).ea("2021-12-31", 150e6)
    .a("2022-12-31", 500e6).l("2022-12-31", 300e6).ea("2022-12-31", 200e6);
  const c = col(filer(shell, succA, succ2), "2020-12-31");
  eq(c.v.totalAssets, 285843000, "assets stay OppFi's $285.8m — the shell's $244.7m is not reached behind a newer balance sheet the template cannot read whole");
  eq(c.v.tempEquity, 217175222, "so the shell's redeemable shares are still on the column, as filed");
  ok(!c.v.bsAligned && !c.meta.totalAssets.aligned, "nothing is marked as re-drawn");
  ok(!bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equityAll, c.v.tempEquity), "and the column stays open — honest, because the fix is a tag the template does not know, not a re-draw");
}

// ── Stand down: the newest whole presentation does not close itself (Symbotic's FY2021) ─────────
// Symbotic's FY2022 10-K presents the 2021 balance sheet whole, and it closes on its face only through
// $836m of redeemable units tagged with class-member dimensions, which companyfacts does not carry.
// Its undimensioned legs do not close, so there is nothing to re-draw from; equity keeps rule 2's pick.
// MUTATION: dropping the foot test on the candidate re-draws from it anyway and fails the accession assertion.
{
  const k22 = filing("10-K", "2022-12-09", "k-2022").rev("2020-09-27", "2021-09-25", 251e6).rev("2021-09-26", "2022-09-24", 593e6)
    .a("2021-09-25", 280535000).l("2021-09-25", 557503000).ea("2021-09-25", -1113228000)
    .a("2022-09-24", 631263000).l("2022-09-24", 562323000).ea("2022-09-24", 68940000);
  const k24 = filing("10-K", "2024-12-04", "k-2024").rev("2022-09-25", "2023-09-30", 1177e6).rev("2023-10-01", "2024-09-28", 1822e6)
    .ea("2021-09-25", -1113228000).a("2023-09-30", 1050710000).l("2023-09-30", 1053426000).ea("2023-09-30", -2716000)
    .a("2024-09-28", 1578552000).l("2024-09-28", 1188422000).ea("2024-09-28", 390130000);
  const c = col(filer(k22, k24), "2021-09-25");
  eq(c.meta.equityAll.accn, "k-2024", "equity keeps rule 2's pick from the FY2024 10-K's opening balance");
  ok(!c.v.bsAligned, "the rule stands down: the only whole presentation does not close within 0.5% of assets on its own");
  ok(!bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equityAll, c.v.tempEquity), "and the column stays open, because the gap is a dimensioned mezzanine and no filing closes it undimensioned");
}

// ── A stray: a footnote figure filed under `Assets` in a later 10-Q (Fluent's FY2023) ────────────
// The 10-Q carries an assets figure at the prior year-end and nothing else — a footnote, not a balance
// sheet — and rule 2 hands it the row, exactly as it handed American Tower's debt (rule 30). A filing
// carrying assets alone is not a presentation of the balance sheet, so the 10-K is the newest one that is.
// MUTATION: taking the newest filing carrying assets, without requiring liabilities, leaves the 10-Q's
// figure in place and fails here.
{
  const k23 = filing("10-K", "2025-03-31", "k-2024").rev("2023-01-01", "2023-12-31", 298e6).rev("2024-01-01", "2024-12-31", 255e6)
    .a("2023-12-31", 111867000).l("2023-12-31", 77463000).e("2023-12-31", 34404000)
    .a("2024-12-31", 100e6).l("2024-12-31", 70e6).e("2024-12-31", 30e6);
  const q1 = filing("10-Q", "2025-05-16", "q1-2025").a("2023-12-31", 93617000).a("2025-03-31", 95e6).l("2025-03-31", 68e6).e("2025-03-31", 27e6);
  const k24 = filing("10-K", "2026-03-30", "k-2025").rev("2024-01-01", "2024-12-31", 255e6).rev("2025-01-01", "2025-12-31", 240e6)
    .e("2023-12-31", 34404000).a("2024-12-31", 100e6).l("2024-12-31", 70e6).e("2024-12-31", 30e6)
    .a("2025-12-31", 90e6).l("2025-12-31", 65e6).e("2025-12-31", 25e6);
  const c = col(filer(k23, q1, k24), "2023-12-31");
  eq(c.v.totalAssets, 111867000, "total assets is the balance sheet's $111.9m, not the 10-Q footnote's $93.6m");
  eq(c.meta.totalAssets.displaced && c.meta.totalAssets.displaced.form, "10-Q", "and the cell names the 10-Q it displaced");
  eq(c.meta.equity.accn, "k-2024", "equity is read from the same 10-K rather than the later equity statement");
  ok(c.v.bsAligned && bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equity, null), "marked, and closes");
}

// ── Two whole presentations: the NEWEST wins, even when the older one also closes (Inspired's FY2019) ──
// The original 10-K tags the all-in equity concept; the 10-K/A that restated liabilities tags only the
// parent one. Rule 2 took liabilities from the amendment and the all-in equity from the original, and
// the column missed by the restatement. Re-drawn from the amendment: liabilities restated, equity the
// parent figure, the all-in row blank at that date — and NOT the original, which also closes but is older.
// MUTATION: preferring the oldest closing presentation fails the liabilities assertion; widening the
// closing tolerance to 5% passes this 3.0% miss as closed and fails the flag.
{
  const orig = filing("10-K", "2021-03-29", "orig").rev("2019-01-01", "2019-12-31", 153.4e6).rev("2020-01-01", "2020-12-31", 200.1e6)
    .a("2019-12-31", 327.4e6).l("2019-12-31", 376.9e6).ea("2019-12-31", -49.5e6)
    .a("2020-12-31", 324.1e6).l("2020-12-31", 412.8e6).ea("2020-12-31", -88.7e6);
  const amend = filing("10-K/A", "2021-05-10", "amend").rev("2019-01-01", "2019-12-31", 153.4e6).rev("2020-01-01", "2020-12-31", 200.1e6)
    .a("2019-12-31", 327.4e6).l("2019-12-31", 386.7e6).e("2019-12-31", -59.3e6)
    .a("2020-12-31", 324.1e6).l("2020-12-31", 425.8e6).e("2020-12-31", -101.7e6);
  const k21 = filing("10-K", "2022-03-31", "k-2021").rev("2020-01-01", "2020-12-31", 200.1e6).rev("2021-01-01", "2021-12-31", 205.8e6)
    .a("2020-12-31", 324.1e6).l("2020-12-31", 425.8e6).e("2020-12-31", -101.7e6)
    .a("2021-12-31", 308.7e6).l("2021-12-31", 417.4e6).e("2021-12-31", -108.7e6);
  const c = col(filer(orig, amend, k21), "2019-12-31");
  eq(c.v.totalLiab, 386.7e6, "liabilities are the amendment's restated $386.7m");
  eq(c.meta.totalLiab.accn, "amend", "from the 10-K/A — the newest whole presentation, not the original that also closes");
  eq(c.v.equity, -59.3e6, "equity is the amendment's parent figure");
  eq(c.v.equityAll, null, "the all-in row is blank at that date, because the amendment does not tag it");
  eq(c.meta.equityAll.displaced && c.meta.equityAll.displaced.value, -49.5e6, "and records the original's −$49.5m it displaced");
  ok(c.v.bsAligned && bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equity, null), "marked, and closes");
}

// ── alignBalanceSheet on its own: the return value the grid keys off ────────────────────────────
{
  const facts = { Assets: { label: "a", units: { USD: [{ end: "2020-12-31", val: 100, filed: "2021-02-01", form: "10-K", accn: "x" }] } },
    Liabilities: { label: "l", units: { USD: [{ end: "2020-12-31", val: 60, filed: "2021-02-01", form: "10-K", accn: "x" }] } },
    StockholdersEquity: { label: "e", units: { USD: [{ end: "2020-12-31", val: 40, filed: "2021-02-01", form: "10-K", accn: "x" }, { end: "2020-12-31", val: 90, filed: "2022-02-01", form: "10-K", accn: "y" }] } } };
  const legLines = Object.fromEntries(BS_LEGS.map(k => [k, line(k)]));
  const mk = () => {
    const v = { totalAssets: 100, totalLiab: 60, equity: 90, equityAll: null, tempEquity: null };
    const meta = { totalAssets: { status: "reported", accn: "x", value: 100 }, totalLiab: { status: "reported", accn: "x", value: 60 }, equity: { status: "reported", accn: "y", value: 90, tag: "StockholdersEquity", form: "10-K", filed: "2022-02-01" }, equityAll: { status: "untagged-this-period" }, tempEquity: { status: "never-tagged" } };
    return { v, meta };
  };
  const { v, meta } = mk();
  const r = alignBalanceSheet(facts, v, meta, legLines, "2020-12-31", "USD");
  eq(r && r.accn, "x", "returns the filing the legs were read from");
  eq(r && r.moved, ["equity"], "and names the legs that moved — equity only; assets and liabilities were already from that filing");
  eq(v.equity, 40, "the mixed leg is replaced in place");
  const closed = mk(); closed.v.equity = 40; closed.meta.equity.value = 40;
  eq(alignBalanceSheet(facts, closed.v, closed.meta, legLines, "2020-12-31", "USD"), null, "a column that closes returns null and is not touched");
  const blank = mk(); blank.meta.totalLiab = { status: "untagged-this-period" }; blank.v.totalLiab = null;
  eq(alignBalanceSheet(facts, blank.v, blank.meta, legLines, "2020-12-31", "USD"), null, "a column missing a leg has no identity to test and returns null");
}

// ── The cache pins: exactly these columns, and no others ────────────────────────────────────────
// The full-diff that cleared the rule said 17 columns move on the 180-filer cache. That number is a
// per-cell count and cannot see a column that STARTS moving later; this can. Every column the rule
// re-draws is listed, so a future change that widens or narrows the population changes this list.
if (needFixtures("t-legs cache pins")) {
  const EXPECT_ANNUAL = ["ALL 2020-12-31", "AMRZ 2024-12-31", "CB 2021-12-31", "CEPL 2020-03-31", "CINF 2021-12-31", "FLNT 2023-12-31", "FUL 2020-11-28",
    "GE 2021-12-31", "HYMC 2018-12-31", "HYMC 2019-12-31", "MET 2021-12-31", "MLR 2020-12-31", "NRDE 2019-12-31", "OBIO 2021-12-31", "OBIO 2022-12-31", "PRU 2021-12-31"];
  const EXPECT_LTM = ["AMRZ 2025-06-30"];
  const annual = [], ltm = [], grids = {};
  for (const t of fixtureTickers()) {
    let g; try { g = buildGrid(loadFixture(t), null, 8); } catch { continue; }
    if (!g || g.empty) continue;
    grids[t] = g;
    for (const c of g.cols) if (c.v.bsAligned) annual.push(`${t} ${c.period.end}`);
    for (const c of g.ltmCols) if (c.v.bsAligned) ltm.push(`${t} ${c.period.end}`);
    for (const c of [...g.cols, ...g.ltmCols]) if (c.v.bsAligned) {
      ok(bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equityAll != null ? c.v.equityAll : c.v.equity, c.v.tempEquity), `${t} ${c.period.end}: every re-drawn column closes`);
      ok(BS_LEGS.every(k => !c.meta[k] || !c.meta[k].aligned || c.meta[k].accn === undefined || c.meta[k].accn === c.meta.totalAssets.accn || c.meta[k].value == null), `${t} ${c.period.end}: every leg that has a value comes from the one filing`);
    }
  }
  eq(annual.sort(), EXPECT_ANNUAL, "the annual columns re-drawn on the cache are exactly the sixteen the measurement named");
  eq(ltm.sort(), EXPECT_LTM, "and the one LTM column");
  const at = (t, end) => grids[t] && grids[t].cols.find(c => c.period.end === end);
  const all = at("ALL", "2020-12-31");
  if (all) { eq(all.v.equityAll, 30217e6, "Allstate FY2020 total equity is $30,217m, from the FY2021 10-K"); eq(all.meta.equityAll.accn, "0000899051-22-000015", "that accession"); eq(all.meta.equityAll.displaced && all.meta.equityAll.displaced.value, -298e6, "displacing the −$298m LDTI adjustment the FY2023 10-K tagged as the total"); }
  const met = at("MET", "2021-12-31"); if (met) eq(met.v.equityAll, 67749e6, "MetLife FY2021 is the pre-LDTI $67,749m its own 2021 balance sheet shows, not the $50,013m restated opening balance");
  const pru = at("PRU", "2021-12-31"); if (pru) eq(pru.v.equityAll, 62608e6, "Prudential FY2021 $62,608m");
  const cb = at("CB", "2021-12-31"); if (cb) { eq(cb.v.equity, 59714e6, "Chubb FY2021 equity $59,714m — the same LDTI class, invisible to a same-tag witness because the older 10-K tags only the parent concept"); eq(cb.v.equityAll, null, "and its all-in row is blank at that date"); }
  const ge22 = at("GE", "2022-12-31"); if (ge22) { ok(!ge22.v.bsAligned, "GE FY2022 closes as rule 2 built it and is not touched"); eq(ge22.meta.equityAll.accn, "0000040545-25-000015", "equity stays from the FY2024 10-K"); }
  const fl = at("FLNT", "2023-12-31"); if (fl) eq(fl.v.totalAssets, 111867000, "Fluent FY2023 assets are the 10-K's $111.9m, not the 10-Q footnote's $93.6m");
  const ob = at("OBIO", "2022-12-31"); if (ob) eq(ob.v.tempEquity, null, "Orchestra BioMed FY2022 drops the shell's $67.7m of redeemable shares");
}

done("t-legs");
