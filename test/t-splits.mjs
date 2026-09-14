// Rule 31 — a stock split restates only the years the newest filing reaches, and the engine carries
// the filer's own factor back over the rest. Measured before it shipped over the 830 double-filed
// per-share and share-count observations across 180 cached filers: 33 filers, 47 events, every one a
// split the filer announced, and every clean-looking restatement refused.
//
// Drives the SHIPPING extract, grid and template. Fixtures are hand-built in the companyfacts shape
// with the real figures named to the filers they came from. Mutation-tested; each mutation is named
// beside the block it breaks. The cache-driven pins at the end skip cleanly without the cache.
import { ok, eq, near, done } from "./_t.mjs";
import { splitEvents, applySplits, SPLIT_PER_SHARE, SPLIT_COUNTS, describeSplits } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { haveFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

// A fact filed in the 10-K for `fy` (filed the following February), for the fiscal year ending `end`.
const K10 = (start, end, val, filed) => ({ start, end, val, fy: +end.slice(0, 4), fp: "FY", filed, form: "10-K", accn: `k-${filed}` });
const tagOf = (unit, facts) => ({ label: "x", units: { [unit]: facts } });
const M = 1e6;
const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);

// ── The engine and the template name the same five concepts ─────────────────────────────────────
{
  eq([...SPLIT_PER_SHARE].sort().join(" "), [line("epsBasic").tags[0], line("epsDil").tags[0], line("dps").tags[0]].sort().join(" "), "the per-share tags rule 31 rebases are exactly the per-share rows' tags");
  eq([...SPLIT_COUNTS].sort().join(" "), [line("wasoBasic").tags[0], line("wasoDil").tags[0]].sort().join(" "), "and the count tags are exactly the share-count rows' tags");
  for (const k of ["epsBasic", "epsDil", "dps", "wasoBasic", "wasoDil"]) ok(line(k).flagNote && line(k).flagNote.splitAdjusted, `${k} carries the split note`);
}

// ── The NVIDIA shape: two splits, three annual filings each, cumulative ×40 ──────────────────────
// Years ending Jan-2019 … Jan-2026 (calendar-labelled 2018–2025 here for brevity). The 4-for-1 is first
// reported by the 10-K filed 2022-03 (the FY2021 report restating 2020 and 2021); the 10-for-1 by the
// 10-K filed 2025-02. Net income never moves. Each 10-K carries its own year and two comparatives.
// MUTATION: applying the factor to facts filed ON `newFrom` (`<=` for `<`) moves the 2022-03 10-K's
// figures a second time and fails the ÷10 assertion; inverting the direction multiplies EPS instead.
function nvda() {
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  // EPS as each 10-K would report it, on the basis in force when it was filed.
  const trueEps = { 2018: 0.166, 2019: 0.113, 2020: 0.173, 2021: 0.385, 2022: 0.17, 2023: 1.19, 2024: 2.94, 2025: 4.90 };
  const trueNi = { 2018: 4141, 2019: 2796, 2020: 4332, 2021: 9752, 2022: 4368, 2023: 29760, 2024: 72880, 2025: 120067 };
  const trueShares = { 2018: 24514, 2019: 24720, 2020: 25100, 2021: 25350, 2022: 25070, 2023: 24940, 2024: 24804, 2025: 24514 };
  const basisAt = filed => (filed < "2022-02-01" ? 40 : filed < "2025-02-01" ? 10 : 1);   // pre-4:1, between, post-10:1
  const eps = [], ni = [], sh = [];
  for (const y of years) for (const fy of [y, y + 1, y + 2]) {          // each year appears in three 10-Ks
    if (fy > 2025) continue;
    const filed = `${fy + 1}-02-20`; const b = basisAt(filed);
    eps.push(K10(`${y}-01-01`, `${y}-12-31`, +(trueEps[y] * b).toFixed(2), filed));
    ni.push(K10(`${y}-01-01`, `${y}-12-31`, trueNi[y] * M, filed));
    sh.push(K10(`${y}-01-01`, `${y}-12-31`, Math.round(trueShares[y] * M / b), filed));
  }
  const facts = { Revenues: tagOf("USD", years.map(y => K10(`${y}-01-01`, `${y}-12-31`, 1000 * M, `${y + 1}-02-20`))),
    NetIncomeLoss: tagOf("USD", ni), EarningsPerShareDiluted: tagOf("USD/shares", eps), EarningsPerShareBasic: tagOf("USD/shares", eps.map(f => ({ ...f, val: +(f.val * 1.01).toFixed(2) }))),
    WeightedAverageNumberOfDilutedSharesOutstanding: tagOf("shares", sh) };
  return { facts, trueEps };
}
{
  const { facts, trueEps } = nvda();
  const ev = splitEvents(facts);
  eq(ev.map(e => `${e.K}${e.forward ? "" : "r"}@${e.newFrom}`).join(" "), "4@2022-02-20 10@2025-02-20", "two forward events, each dated to the first filing that carried the new basis");
  ok(ev.every(e => e.count > 0 && e.perShare > 0), "each has both witnesses: a count moved ×K and a per-share row moved ×1/K");
  const g = buildGrid({ cik: "1", name: "NVDA-shape", sicCode: "3674", facts, filings: [] }, null, 8);
  const at = y => g.cols.find(c => c.period.end === `${y}-12-31`);
  near(at(2018).v.epsDil, trueEps[2018], 0.0005, "the oldest year is carried back ÷40 (its newest filing predates both splits)");
  near(at(2019).v.epsDil, trueEps[2019], 0.0005, "a year whose newest filing sits between the splits is ÷10");
  near(at(2022).v.epsDil, trueEps[2022], 0.0005, "a year first reported on today's basis is untouched");
  eq(at(2018).meta.epsDil.status, "split-adjusted", "a rebased cell says so");
  eq(at(2018).meta.epsDil.splitMark, "÷40", "and carries the mark for what was done to it");
  near(at(2018).meta.epsDil.filedValue, trueEps[2018] * 40, 0.01, "and the figure as the filing shows it");
  ok(at(2018).meta.epsDil.accn && at(2018).meta.epsDil.filed, "and keeps its accession, so the link still opens the filing that shows the figure as reported");
  eq(at(2022).meta.epsDil.status, "reported", "while an untouched cell is plain `reported`");
  eq(at(2018).meta.wasoDil.splitMark, "×40", "a share count moves the other way");
  ok(at(2018).v.splitAdjusted && !at(2022).v.splitAdjusted, "the column flag the row note keys on is set only where a cell was rebased");
  const growth = g.cols.map(c => c.v.epsGrowth);
  ok(growth.slice(1).every(x => x != null && x > -0.7 && x < 8), `EPS growth is a real series now (FY2023's −56% is NVIDIA's real decline): ${growth.slice(1).map(x => (x * 100).toFixed(0) + "%").join(" ")} — not −83% and −96% at the boundaries`);
  const note = line("epsDil").flagNote.splitAdjusted(at(2018));
  ok(/4-for-1 split first reported 2022-02-20/.test(note) && /10-for-1 split first reported 2025-02-20/.test(note) && /÷40/.test(note), `the note names both splits and the factor: ${note.slice(0, 100)}…`);
  eq(g.splits.length, 2, "the grid carries the events for the workbook and the TSV");
  ok(/4-for-1 split \(first reported 2022-02-20\), 10-for-1 split \(first reported 2025-02-20\)/.test(describeSplits(g.splits)), "and the one-line description names them in order");
}

// ── A reverse split runs the other way (GE, 1-for-8, 2021) ──────────────────────────────────────
// MUTATION: dropping the reverse direction (treating every event as forward) fails here.
{
  const eps = [K10("2018-01-01", "2018-12-31", -0.50, "2019-02-20"), K10("2018-01-01", "2018-12-31", -0.50, "2020-02-20"), K10("2018-01-01", "2018-12-31", -0.50, "2021-02-12"),
    K10("2019-01-01", "2019-12-31", -0.62, "2020-02-20"), K10("2019-01-01", "2019-12-31", -0.62, "2021-02-12"), K10("2019-01-01", "2019-12-31", -4.96, "2022-02-11"),
    K10("2020-01-01", "2020-12-31", 0.66, "2021-02-12"), K10("2020-01-01", "2020-12-31", 5.28, "2022-02-11"), K10("2021-01-01", "2021-12-31", -5.82, "2022-02-11")];
  const sh = [K10("2018-01-01", "2018-12-31", 8700 * M, "2019-02-20"), K10("2018-01-01", "2018-12-31", 8700 * M, "2020-02-20"), K10("2018-01-01", "2018-12-31", 8700 * M, "2021-02-12"),
    K10("2019-01-01", "2019-12-31", 8724 * M, "2020-02-20"), K10("2019-01-01", "2019-12-31", 8724 * M, "2021-02-12"), K10("2019-01-01", "2019-12-31", 1090.5 * M, "2022-02-11"),
    K10("2020-01-01", "2020-12-31", 8760 * M, "2021-02-12"), K10("2020-01-01", "2020-12-31", 1095 * M, "2022-02-11"), K10("2021-01-01", "2021-12-31", 1098 * M, "2022-02-11")];
  const ni = [K10("2018-01-01", "2018-12-31", -4300 * M, "2019-02-20"), K10("2018-01-01", "2018-12-31", -4300 * M, "2020-02-20"), K10("2018-01-01", "2018-12-31", -4300 * M, "2021-02-12"),
    K10("2019-01-01", "2019-12-31", -5439 * M, "2020-02-20"), K10("2019-01-01", "2019-12-31", -5439 * M, "2021-02-12"), K10("2019-01-01", "2019-12-31", -5439 * M, "2022-02-11"),
    K10("2020-01-01", "2020-12-31", 5704 * M, "2021-02-12"), K10("2020-01-01", "2020-12-31", 5704 * M, "2022-02-11"), K10("2021-01-01", "2021-12-31", -6520 * M, "2022-02-11")];
  const facts = { Revenues: tagOf("USD", [2018, 2019, 2020, 2021].map(y => K10(`${y}-01-01`, `${y}-12-31`, 75000 * M, `${y + 1}-02-12`))), NetIncomeLoss: tagOf("USD", ni),
    EarningsPerShareDiluted: tagOf("USD/shares", eps), WeightedAverageNumberOfDilutedSharesOutstanding: tagOf("shares", sh) };
  const ev = splitEvents(facts);
  eq(ev.map(e => `${e.forward ? "" : "reverse "}${e.K}`).join(","), "reverse 8", "a 1-for-8 is detected as a reverse event");
  const g = buildGrid({ cik: "1", name: "GE-shape", sicCode: "3600", facts, filings: [] }, null, 8);
  const c19 = g.cols.find(c => c.period.end === "2019-12-31");
  eq(c19.meta.epsDil.status, "reported", "FY2019's newest filing is the post-split 10-K, so its cell is as filed");
  const c18 = g.cols.find(c => c.period.end === "2018-12-31");
  near(c18.v.epsDil, -0.50 * 8, 0.001, "a year whose newest filing predates the reverse split has its EPS multiplied by 8");
  near(c18.v.wasoDil, 8700 * M / 8, 1, "and its share count divided");
  eq(c18.meta.epsDil.splitMark, "×8", "the mark says ×8 on a per-share row");
}

// ── What is NOT a split ─────────────────────────────────────────────────────────────────────────
// A restatement changes earnings and leaves the share count; a scale slip moves one row alone; a
// quarter re-filed once and then filed back is noise. None may produce an event, however clean the
// ratio looks — Apple's 2009 subscription-accounting restatement is ×1.27 with net income moving,
// Caterpillar's 2015 is ×1.19, and Brown & Brown files one quarter's EPS at ×100 with no count moving.
// MUTATION: dropping the net-income test admits the clean-ratio restatement below; dropping the
// persistence test admits the wobble; admitting a power of ten without a count admits the ×100.
{
  const base = { Revenues: tagOf("USD", [2018, 2019, 2020].map(y => K10(`${y}-01-01`, `${y}-12-31`, 500 * M, `${y + 1}-02-10`))) };
  // Clean ratio, earnings moved with it: a restatement (net income ×1.5, EPS ×1.5, count unchanged).
  const restated = { ...base,
    NetIncomeLoss: tagOf("USD", [K10("2018-01-01", "2018-12-31", 100 * M, "2019-02-10"), K10("2018-01-01", "2018-12-31", 150 * M, "2020-02-10"), K10("2019-01-01", "2019-12-31", 120 * M, "2020-02-10")]),
    EarningsPerShareDiluted: tagOf("USD/shares", [K10("2018-01-01", "2018-12-31", 1.00, "2019-02-10"), K10("2018-01-01", "2018-12-31", 1.50, "2020-02-10"), K10("2019-01-01", "2019-12-31", 1.20, "2020-02-10")]),
    WeightedAverageNumberOfDilutedSharesOutstanding: tagOf("shares", [K10("2018-01-01", "2018-12-31", 100 * M, "2019-02-10"), K10("2018-01-01", "2018-12-31", 100 * M, "2020-02-10"), K10("2019-01-01", "2019-12-31", 100 * M, "2020-02-10")]) };
  eq(splitEvents(restated).length, 0, "a 3-for-2-looking EPS step whose net income moved by the same ratio is a restatement, not a split");
  // Count and EPS move together by 1.5 but earnings moved too: still a restatement.
  const restated2 = { ...restated, WeightedAverageNumberOfDilutedSharesOutstanding: tagOf("shares", [K10("2018-01-01", "2018-12-31", 100 * M, "2019-02-10"), K10("2018-01-01", "2018-12-31", 66.67 * M, "2020-02-10"), K10("2019-01-01", "2019-12-31", 100 * M, "2020-02-10")]) };
  eq(splitEvents(restated2).length, 0, "and it stays one even when a count happens to move as well, because net income did");
  // The ×100 decimal slip on a per-share row, no count moving, net income unchanged.
  const slip = { ...base,
    NetIncomeLoss: tagOf("USD", [K10("2018-01-01", "2018-12-31", 100 * M, "2019-02-10"), K10("2018-01-01", "2018-12-31", 100 * M, "2020-02-10"), K10("2018-01-01", "2018-12-31", 100 * M, "2021-02-10"), K10("2019-01-01", "2019-12-31", 120 * M, "2020-02-10"), K10("2019-01-01", "2019-12-31", 120 * M, "2021-02-10")]),
    // Large figures, so the rounding interval admits ×100 alone and only the power-of-ten refusal stands
    // between this and an event; a tiny EPS would be refused as ambiguous before the guard is reached.
    EarningsPerShareDiluted: tagOf("USD/shares", [K10("2018-01-01", "2018-12-31", 1.00, "2019-02-10"), K10("2018-01-01", "2018-12-31", 1.00, "2020-02-10"), K10("2018-01-01", "2018-12-31", 100.00, "2021-02-10"), K10("2019-01-01", "2019-12-31", 1.20, "2020-02-10"), K10("2019-01-01", "2019-12-31", 120.00, "2021-02-10")]),
    EarningsPerShareBasic: tagOf("USD/shares", [K10("2018-01-01", "2018-12-31", 1.00, "2019-02-10"), K10("2018-01-01", "2018-12-31", 1.00, "2020-02-10"), K10("2018-01-01", "2018-12-31", 100.00, "2021-02-10"), K10("2019-01-01", "2019-12-31", 1.20, "2020-02-10"), K10("2019-01-01", "2019-12-31", 120.00, "2021-02-10")]) };
  eq(splitEvents(slip).length, 0, "two per-share rows moving ×100 with no share count on file is a decimal slip, never a split");
  // The same shape at ×20 with the counts silent is Alphabet, and IS a split.
  const googl = { ...slip,
    EarningsPerShareDiluted: tagOf("USD/shares", [K10("2018-01-01", "2018-12-31", 58.61, "2019-02-10"), K10("2018-01-01", "2018-12-31", 58.61, "2020-02-10"), K10("2018-01-01", "2018-12-31", 2.93, "2021-02-10"), K10("2019-01-01", "2019-12-31", 112.20, "2020-02-10"), K10("2019-01-01", "2019-12-31", 5.61, "2021-02-10")]),
    EarningsPerShareBasic: tagOf("USD/shares", [K10("2018-01-01", "2018-12-31", 59.15, "2019-02-10"), K10("2018-01-01", "2018-12-31", 59.15, "2020-02-10"), K10("2018-01-01", "2018-12-31", 2.96, "2021-02-10"), K10("2019-01-01", "2019-12-31", 113.88, "2020-02-10"), K10("2019-01-01", "2019-12-31", 5.69, "2021-02-10")]) };
  eq(splitEvents(googl).map(e => e.K).join(), "20", "Alphabet's 20-for-1, with its counts filed per class and absent, is accepted on two per-share rows over two periods");
  const oneRow = { ...googl, EarningsPerShareBasic: undefined };
  eq(splitEvents(oneRow).length, 0, "but one per-share row alone is not enough without a count");
  // A quarter filed, re-filed at half, then filed back: the new basis did not persist.
  const wobble = { ...base,
    NetIncomeLoss: tagOf("USD", [K10("2018-01-01", "2018-12-31", 100 * M, "2019-02-10"), K10("2018-01-01", "2018-12-31", 100 * M, "2020-02-10"), K10("2018-01-01", "2018-12-31", 100 * M, "2021-02-10")]),
    EarningsPerShareDiluted: tagOf("USD/shares", [K10("2018-01-01", "2018-12-31", 1.00, "2019-02-10"), K10("2018-01-01", "2018-12-31", 0.50, "2020-02-10"), K10("2018-01-01", "2018-12-31", 1.00, "2021-02-10")]),
    WeightedAverageNumberOfDilutedSharesOutstanding: tagOf("shares", [K10("2018-01-01", "2018-12-31", 100 * M, "2019-02-10"), K10("2018-01-01", "2018-12-31", 200 * M, "2020-02-10"), K10("2018-01-01", "2018-12-31", 100 * M, "2021-02-10")]) };
  eq(splitEvents(wobble).length, 0, "a basis that does not persist in the next filing is noise, not a split");
  // A filer with no double-filed periods at all gets the payload's own object back, untouched.
  eq(applySplits(base, []), base, "no events, no copy: the payload object is returned as is");
}

// ── The same rule on the filers it was measured against ─────────────────────────────────────────
if (haveFixtures()) {
  const have = new Set(fixtureTickers());
  const grid = t => buildGrid(loadFixture(t), null, 8);
  if (have.has("NVDA")) {
    const g = grid("NVDA");
    eq(g.splits.map(e => `${e.K}@${e.newFrom}`).join(" "), "4@2021-08-20 10@2024-08-28", "NVIDIA: the 4-for-1 first reported in the 10-Q of Aug 2021 and the 10-for-1 in the 10-Q of Aug 2024");
    const c = e => g.cols.find(x => x.period.end === e);
    near(c("2019-01-27").v.epsDil, 6.63 / 40, 0.0001, "FY2019 diluted EPS is 6.63 ÷ 40");
    near(c("2020-01-26").v.epsDil, 1.13 / 10, 0.0001, "FY2020 is 1.13 ÷ 10");
    near(c("2023-01-29").v.epsDil, 0.17, 1e-9, "FY2023 is untouched");
    ok(g.cols.slice(1).every(x => x.v.epsGrowth > -0.6), `no EPS growth cell reads like a collapse any more: ${g.cols.slice(1).map(x => (x.v.epsGrowth * 100).toFixed(0) + "%").join(" ")}`);
  }
  if (have.has("GOOGL")) { const g = grid("GOOGL"); near(g.cols.find(x => x.period.end === "2019-12-31").v.epsDil, 49.16 / 20, 0.0001, "Alphabet's FY2019 EPS is 49.16 ÷ 20, on per-share evidence alone"); }
  // Tesla's FY2018 cell comes from the FY2020 10-K, filed after the 5-for-1 and already on that basis
  // (−1.14 = −5.72 ÷ 5), so only the 3-for-1 is carried back: −0.38, which is −5.72 ÷ 15.
  if (have.has("TSLA")) { const g = grid("TSLA"); near(g.cols.find(x => x.period.end === "2018-12-31").v.epsDil, -1.14 / 3, 0.0001, "Tesla's FY2018 EPS is −1.14 ÷ 3 — the filing already shows the post-5-for-1 figure (rounded), so only the 3-for-1 is carried back"); }
  if (have.has("AAPL")) { const g = grid("AAPL"); ok(g.cols.every(x => x.meta.epsDil.status === "reported"), "Apple's eight columns were already on today's basis and none is touched"); }
  if (have.has("NFLX")) { const g = grid("NFLX"); ok(g.ltm && g.ltm.v.epsDil > 0, `Netflix's LTM diluted EPS is positive now (${g.ltm && g.ltm.v.epsDil}), the legs on one basis`); }
  // Every event on the cache is on the list of filers the rule was checked against, and the count is
  // pinned so a rule change that widens or narrows the population shows here first.
  const found = [];
  for (const t of have) { let g; try { g = grid(t); } catch { continue; } if (g && !g.empty && g.splits.length) found.push(t); }
  const KNOWN = new Set(["AAPL", "AIRI", "AMZN", "AVGO", "BHIC", "BNC", "BRO", "CL", "CMCSA", "CSX", "FLNT", "GE", "GIS", "GOOGL", "HYMC", "IBKR", "KO", "KR", "LRCX", "NEE", "NFLX", "NKE", "NRDE", "NVDA", "ODFL", "RJF", "SBUX", "SHOP", "TSLA", "WBD", "WMT", "WRB", "WTRG"]);
  const unexpected = found.filter(t => !KNOWN.has(t));
  eq(unexpected.join(" "), "", `no filer outside the 33 verified ones carries an event${unexpected.length ? " — new: " + unexpected.join(" ") : ""}`);
  ok(found.length >= 20, `and the verified ones present in the cache do (${found.length})`);
}

done("t-splits");
