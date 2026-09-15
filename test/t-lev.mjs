// Rule 39 — debt as a multiple of a negative EBITDA is not a leverage figure, and the sheet says n/m.
// Measured before it shipped over the 180-filer cache: 77 annual cells on each of the two rows and 36 LTM
// each (26 filers), 31 of them a POSITIVE multiple printed for net cash over a loss — Shopify's FY2019 net
// debt/EBITDA read 23.27x. Full-diff: 0 values changed, 0 appeared, 226 cells now n/m, nothing else moved.
//
// Drives the SHIPPING extract, grid and template. Mutation-tested; each mutation is named beside the
// block it breaks. Cache pins at the end skip cleanly without the cache.
import { ok, eq, done } from "./_t.mjs";
import { LEV_ROWS } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const line = k => SECTIONS.flatMap(s => s.lines).find(l => l.k === k);
const FILED = "2024-02-15", END = "2023-12-31", START = "2023-01-01";
const dur = (tag, val) => ({ [tag]: { label: tag, units: { USD: [{ start: START, end: END, val, fy: 2023, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } } });
const inst = (tag, val) => ({ [tag]: { label: tag, units: { USD: [{ end: END, val, fy: 2023, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } } });
const col = (sic, facts) => { const g = buildGrid({ cik: "1", name: "X", sicCode: sic, facts, filings: [{ form: "10-K", filed: FILED, accn: "a-1", period: END }] }, null, 8); return g.cols[g.cols.length - 1]; };
// Shopify's FY2023, in the shape the template reads: an operating loss larger than its D&A.
const loss = { ...dur("Revenues", 7060e6), ...dur("OperatingIncomeLoss", -1418e6), ...dur("DepreciationDepletionAndAmortization", 70e6),
  ...inst("LongTermDebtNoncurrent", 916e6), ...inst("CashAndCashEquivalentsAtCarryingValue", 1680e6) };

// ── The rows, and the figure each divides ────────────────────────────────────────────────────────
{
  eq(LEV_ROWS.map(r => r.join("/")).join(" "), "netLev/netDebt grossLev/totalDebt", "the two debt multiples of EBITDA, each with its own numerator");
  for (const [k] of LEV_ROWS) ok(typeof (line(k).flagNote || {}).levNegEbitda === "function", `${k} carries rule 39's note`);
  ok(readFileSync(join(root, "src", "App.jsx"), "utf8").includes(`x.m.status === "not-meaningful" ? "n/m"`), "and the cell prints n/m for that status, not a dash");
}

// ── A loss: both multiples read n/m (Shopify FY2023) ─────────────────────────────────────────────
// MUTATION: removing fillCol's pass prints −0.68x and the net-cash multiple here; not setting the flag fails the note.
{
  const c = col("7372", loss);
  eq(c.v.ebitda, -1348e6, "EBITDA is the loss, $1,348m, and stays on the sheet");
  eq(c.v.totalDebt, 916e6, "total debt stays on the sheet");
  for (const k of ["grossLev", "netLev"]) { eq(c.v[k], null, `${k} is not printed over a loss`); eq(c.meta[k].status, "not-meaningful", `and its cell says n/m rather than a blank`); }
  ok(c.v.levNegEbitda === true, "the column flag puts the row note under both rows");
  ok(/EBITDA is a loss of 1\.35bn in FY2023/.test(line("netLev").flagNote.levNegEbitda(c)), "the note names the loss and the year");
}

// ── Net cash over a loss printed a POSITIVE multiple, which is the worse half ────────────────────
// MUTATION: limiting the pass to cells whose multiple would be negative leaves this one printed.
{
  const c = col("7372", loss);
  ok(c.v.netDebt < 0, "Shopify-shaped: cash above debt, so net debt is negative");
  eq(c.v.netLev, null, "and net debt over the loss, a positive 0.57x that reads as modest leverage, is n/m too");
}

// ── A positive EBITDA prints its multiple, unflagged ─────────────────────────────────────────────
// MUTATION: testing EBITDA against a threshold above zero (`< 1e9`) marks this profit n/m and fails here.
{
  const c = col("7372", { ...loss, ...dur("OperatingIncomeLoss", 500e6) });
  eq(c.v.ebitda, 570e6, "an operating profit of $500m plus $70m of D&A");
  ok(Math.abs(c.v.grossLev - 916 / 570) < 1e-9, "total debt / EBITDA prints");
  ok(c.meta.grossLev.status !== "not-meaningful" && !c.v.levNegEbitda, "with no n/m and no note");
}

// ── A loss with no debt figure is a blank for its own reason, not n/m ────────────────────────────
// MUTATION: dropping the numerator test marks this column n/m and fails here.
{
  const noDebt = { ...loss }; delete noDebt.LongTermDebtNoncurrent; delete noDebt.CashAndCashEquivalentsAtCarryingValue;
  const c = col("7372", noDebt);
  eq(c.v.totalDebt, null, "no debt tagged, no total debt");
  eq(c.v.grossLev, null, "no multiple");
  ok(c.meta.grossLev.status !== "not-meaningful" && !c.v.levNegEbitda, "and it is not called n/m — the missing figure is the debt, not a meaningful ratio");
}

// ── A bank's n/a stays n/a ───────────────────────────────────────────────────────────────────────
// A bank's EBITDA is n/a, so the pass never reaches its leverage rows. MUTATION: running the pass before
// the NOT_APPLICABLE blanking (while a bank's EBITDA is still a number) relabels them n/m and fails here.
{
  const c = col("6021", loss);
  for (const k of ["grossLev", "netLev"]) eq(c.meta[k].status, "not-applicable", `a bank's ${k} is n/a, whatever its EBITDA`);
  ok(!c.v.levNegEbitda, "and carries no n/m note");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-lev cache pins")) {
  const at = (t, end) => { const g = buildGrid(loadFixture(t), null, 8); return g.cols.find(c => c.period.end === end); };
  const s23 = at("SHOP", "2023-12-31"); if (s23) { eq(s23.meta.grossLev.status, "not-meaningful", "Shopify FY2023 total debt/EBITDA is n/m, not −0.68x"); ok(s23.v.ebitda < 0 && s23.v.totalDebt > 0, "over a real loss and real debt"); }
  const s19 = at("SHOP", "2019-12-31"); if (s19) eq(s19.meta.netLev.status, "not-meaningful", "Shopify FY2019 net debt/EBITDA is n/m, not the 23.27x net cash over a loss printed");
  let annual = 0, ltm = 0, filers = new Set();
  for (const t of fixtureTickers()) { let g; try { g = buildGrid(loadFixture(t), null, 8); } catch { continue; } if (!g || g.empty) continue;
    for (const [cols, isLtm] of [[g.cols, false], [g.ltmCols, true]]) for (const c of cols) for (const [k] of LEV_ROWS)
      if ((c.meta[k] || {}).status === "not-meaningful") { if (isLtm) ltm++; else annual++; filers.add(t); } }
  eq(annual, 154, "154 annual cells read n/m on the cache — 77 on each row, the census's count exactly");
  eq(ltm, 72, "and 72 LTM cells");
  eq(filers.size, 26, "on 26 filers");
}

done("t-lev");
