// Rule 36 — the cash tax rate is what the filer paid over pre-tax income, from the supplemental cash-flow
// disclosure, and the current-expense proxy it used to compute keeps its own row. Measured before it
// shipped over the 180-filer cache with the wide companyfacts beside it: of 945 columns with positive
// pre-tax income, 901 carry a taxes-paid figure against 831 with the proxy; where both are computable the
// two differ by a median 0.3 points and by 10 points at the 10th and 90th percentiles, so they are two
// quantities and never one row.
//
// Drives the SHIPPING extract, grid and template. Mutation-tested; each mutation is named beside the
// block it breaks. Cache pins at the end skip cleanly without the cache.
import { ok, eq, near, done } from "./_t.mjs";
import { DERIVED } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);

// ── The template declares the rows and the engine reads them ─────────────────────────────────────
{
  const paid = line("taxesPaid"), cash = line("cashTaxRate"), cur = line("currentTaxRate");
  ok(paid && paid.how === "fetched", "cash taxes paid is a fetched row");
  eq(paid.tags.join(" "), "IncomeTaxesPaidNet IncomeTaxesPaid", "net of refunds leads, gross is the fallback");
  ok(paid.pinByRun === true, "and the row is pinned by run — a spelling change must not read as a movement");
  eq(cash.formula, "taxesPaid / pretax", "the cash tax rate is what was paid over pre-tax income");
  eq(cur.formula, "(tax - deferredTax) / pretax", "and the current-expense proxy keeps its formula under its own name");
  const keep = readFileSync(join(root, "api", "facts.js"), "utf8");
  for (const t of paid.tags) ok(keep.includes(`"${t}"`), `KEEP carries ${t}`);
  const app = readFileSync(join(root, "src", "App.jsx"), "utf8");
  ok(/"currentTaxRate"/.test(app.slice(0, app.indexOf("const PCT") + 600)), "the current tax rate is formatted as a percentage");
}

// ── The derivations ──────────────────────────────────────────────────────────────────────────────
// MUTATION: falling back to `tax − deferredTax` when nothing paid is tagged fails the second assertion;
// treating a missing deferred line as zero in currentTaxRate fails the fourth.
{
  near(DERIVED.cashTaxRate({ taxesPaid: 300e6, pretax: 2e9 }), 0.15, 1e-9, "300 paid over 2,000 pre-tax is 15%");
  eq(DERIVED.cashTaxRate({ taxesPaid: null, tax: 400e6, deferredTax: 100e6, pretax: 2e9 }), null, "nothing paid tagged, no cash tax rate — the current-expense proxy is a different quantity and is not substituted");
  near(DERIVED.currentTaxRate({ tax: 400e6, deferredTax: 100e6, pretax: 2e9 }), 0.15, 1e-9, "the current tax rate is (400 − 100) / 2,000");
  eq(DERIVED.currentTaxRate({ tax: 400e6, deferredTax: null, pretax: 2e9 }), null, "and refuses without the deferred line (rule 35)");
}

// ── On a rendered sheet: net leads, gross falls back, and the pin keeps one concept ──────────────
const FILED = y => `${y + 1}-02-01`;
const mk = (rows, sic = "2834") => {
  const facts = {}, filings = [];
  const put = (tag, y, val) => { facts[tag] = facts[tag] || { label: tag, units: { USD: [] } }; facts[tag].units.USD.push({ start: `${y}-01-01`, end: `${y}-12-31`, val, fy: y, fp: "FY", filed: FILED(y), form: "10-K", accn: `k-${y}` }); };
  for (const [tag, byYear] of rows) for (const [y, val] of Object.entries(byYear)) put(tag, +y, val);
  const years = [...new Set(rows.flatMap(([, b]) => Object.keys(b).map(Number)))].sort();
  for (const y of years) filings.push({ form: "10-K", filed: FILED(y), accn: `k-${y}`, period: `${y}-12-31` });
  return buildGrid({ cik: "1", name: "X", sicCode: sic, facts, filings }, null, 8);
};
const yrs = [2020, 2021, 2022, 2023];
const each = val => Object.fromEntries(yrs.map(y => [y, val]));
// Apple's FY2018 shape, per year: pre-tax 72.9bn, tax 13.4bn, deferred −32.6bn (the repatriation accrual), paid 10.4bn.
const base = [["Revenues", each(265e9)], ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", each(72.9e9)], ["IncomeTaxExpenseBenefit", each(13.4e9)], ["DeferredIncomeTaxExpenseBenefit", each(-32.6e9)]];
{
  const g = mk([...base, ["IncomeTaxesPaidNet", each(10.4e9)], ["IncomeTaxesPaid", each(10.6e9)]]);
  const c = g.cols[g.cols.length - 1];
  eq(c.v.taxesPaid, 10.4e9, "both concepts tagged: the net figure is the row");
  eq(c.meta.taxesPaid.tag, "IncomeTaxesPaidNet", "under the net concept");
  near(c.v.cashTaxRate, 10.4 / 72.9, 1e-6, "the cash tax rate is 14.3% — what Apple paid");
  near(c.v.currentTaxRate, (13.4 + 32.6) / 72.9, 1e-6, "the current tax rate is 63.1% — the accrual carrying the repatriation tax it would pay over eight years");
  near(c.v.taxRate, 13.4 / 72.9, 1e-6, "and the effective rate is 18.4%, untouched");
}
{
  const g = mk([...base, ["IncomeTaxesPaid", each(10.6e9)]]);
  const c = g.cols[g.cols.length - 1];
  eq(c.v.taxesPaid, 10.6e9, "gross only: the gross figure is the row (Costco, Disney, Merck)");
  eq(c.meta.taxesPaid.tag, "IncomeTaxesPaid", "under the gross concept");
}
{
  const g = mk(base);
  const c = g.cols[g.cols.length - 1];
  eq(c.v.taxesPaid, null, "neither tagged: the row is blank");
  eq(c.v.cashTaxRate, null, "and so is the cash tax rate — not the current-expense proxy in disguise");
  near(c.v.currentTaxRate, (13.4 + 32.6) / 72.9, 1e-6, "which still shows on its own row");
}
// A filer that tagged gross for two years and net for the next two, at the same figure — pinned, the
// sheet reads one concept where the values allow it, and no cell moves between them.
// MUTATION: dropping `pinByRun` from the row fails the concept assertion.
{
  const g = mk([...base, ["IncomeTaxesPaid", { 2020: 10.6e9, 2021: 10.6e9, 2022: 10.6e9, 2023: 10.6e9 }], ["IncomeTaxesPaidNet", { 2022: 10.6e9, 2023: 10.6e9 }]]);
  eq(g.cols.map(c => c.meta.taxesPaid.tag).join(" "), Array(4).fill("IncomeTaxesPaid").join(" "), "the concept that spans the sheet carries every column, though net leads the list");
  ok(g.cols.every(c => c.v.taxesPaid === 10.6e9), "and every cell is the filed figure");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-tax cache pins")) {
  const at = (t, end) => buildGrid(loadFixture(t), null, 8).cols.find(c => c.period.end === end);
  const aapl = at("AAPL", "2018-09-29");
  if (aapl) { ok(aapl.v.cashTaxRate > 0.12 && aapl.v.cashTaxRate < 0.16, `Apple FY2018 paid about 14% of pre-tax income — ${aapl.v.cashTaxRate}`); ok(aapl.v.currentTaxRate > 0.6, `while its current tax rate carried the repatriation accrual — ${aapl.v.currentTaxRate}`); }
  const cost = at("COST", "2025-08-31"); if (cost) { eq(cost.meta.taxesPaid.tag, "IncomeTaxesPaid", "Costco tags only the gross concept"); ok(cost.v.cashTaxRate > 0, "and has a cash tax rate"); }
  let withCash = 0, withCurrent = 0, positive = 0;
  for (const t of fixtureTickers()) { let g; try { g = buildGrid(loadFixture(t), null, 8); } catch { continue; } if (!g || g.empty) continue; for (const c of g.cols) { if (!(c.v.pretax > 0)) continue; positive++; if (c.v.cashTaxRate != null) withCash++; if (c.v.currentTaxRate != null) withCurrent++; } }
  ok(withCash >= 880 && withCash > withCurrent, `of ${positive} columns with positive pre-tax income, ${withCash} carry a cash tax rate against ${withCurrent} with the current-expense proxy — the measured 901 against 831`);
}

done("t-tax");
