// Rule 34 — where the D&A row resolves `Depreciation` alone and the filer tags intangible amortisation
// beside it with no total, the row is their sum and says so. Measured before it shipped over the
// 180-filer cache with the full companyfacts beside it: 188 cells resolve `Depreciation`, 110 of them
// on 21 filers that tag `AmortizationOfIntangibleAssets` for the same period and no D&A total under
// any concept; where filers tag a total AND both parts, the parts reproduce it 184 times in 400 and
// fall 2–5% short in most of the rest, so the sum is a floor and never displaces a filed total.
//
// Drives the SHIPPING extract, grid and template. Mutation-tested; each mutation is named beside the
// block it breaks. Cache pins at the end skip cleanly without the cache.
import { ok, eq, done } from "./_t.mjs";
import { DERIVED } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture } from "./_fixtures.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);

const FILED = "2026-02-01", END = "2025-12-31", START = "2025-01-01";
const d = (tag, val) => ({ [tag]: { label: tag, units: { USD: [{ start: START, end: END, val, fy: 2025, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } } });
const grid = facts => buildGrid({ cik: "1", name: "X", sicCode: "2834", facts, filings: [{ form: "10-K", filed: FILED, accn: "a-1", period: END }] }, null, 8);
const col = facts => { const g = grid(facts); return g.cols[g.cols.length - 1]; };

// ── The template declares the row and the engine reads it ────────────────────────────────────────
{
  const da = line("da"), am = line("amort");
  eq(da.tags[da.tags.length - 1], "Depreciation", "`Depreciation` is the D&A row's LAST candidate — it excludes amortisation by definition");
  ok(am && am.how === "fetched" && am.tags.join() === "AmortizationOfIntangibleAssets", "the amortisation row is a fetched line asking for the one concept the measurement kept");
  ok(da.flagNote && typeof da.flagNote.daSummed === "function", "and the D&A row carries the rule 34 note, keyed off the flag the derivation sets");
  const keep = readFileSync(join(root, "api", "facts.js"), "utf8");
  ok(keep.includes('"AmortizationOfIntangibleAssets"'), "KEEP carries the amortisation concept, or the row asks for something that cannot reach the browser");
  const keys = Object.keys(DERIVED);
  ok(keys.indexOf("daSummed") < keys.indexOf("da") && keys.indexOf("da") < keys.indexOf("ebitda"), "the flag precedes the sum and the sum precedes EBITDA — object order is execution order");
}

// ── AbbVie's shape: Depreciation and intangible amortisation, no total ───────────────────────────
// FY2018: depreciation $471m, amortisation $1,294m, no D&A total under any concept. The row showed
// $471m and EBITDA read $6.85bn against $8.15bn.
// MUTATION: dropping the `daDepreciationOnly` guard in DERIVED.da (summing whenever amortisation is
// tagged) fails the total-tagged block below; dropping the sum fails this one.
{
  const c = col({ ...d("Revenues", 32753e6), ...d("OperatingIncomeLoss", 6383e6), ...d("Depreciation", 471e6), ...d("AmortizationOfIntangibleAssets", 1294e6) });
  eq(c.v.da, 1765e6, "D&A is depreciation plus amortisation: 471 + 1,294");
  eq(c.meta.da.status, "computed", "and the cell says it was computed — there is no single filing figure to link");
  eq(c.v.amort, 1294e6, "the amortisation row shows the filed figure");
  eq(c.meta.amort.status, "reported", "as a reported one, with its accession");
  ok(c.v.daSummed === true, "the column carries the flag the note keys off");
  eq(c.v.ebitda, 6383e6 + 1765e6, "and EBITDA is built on the sum");
  const note = line("da").flagNote.daSummed(c);
  ok(/depreciation 471\.0m plus amortisation of intangibles 1\.29bn/.test(note), `the note names both parts with the filer's own figures — ${note.slice(0, 80)}`);
}

// ── A filer that tags a D&A total AND both parts keeps the total ─────────────────────────────────
// Amgen files DepreciationDepletionAndAmortization $5,167m beside depreciation $763m and amortisation
// $4,300m; the parts sum to $5,063m, 2% short. The total wins outright and is never summed over.
// MUTATION: summing whenever amortisation is tagged prints $9,467m here and fails.
{
  const c = col({ ...d("Revenues", 35e9), ...d("OperatingIncomeLoss", 9e9), ...d("DepreciationDepletionAndAmortization", 5167e6), ...d("Depreciation", 763e6), ...d("AmortizationOfIntangibleAssets", 4300e6) });
  eq(c.v.da, 5167e6, "D&A is the filed total");
  eq(c.meta.da.status, "reported", "reported, with its accession intact");
  eq(c.meta.da.tag, "DepreciationDepletionAndAmortization", "from the total's concept");
  ok(!c.v.daSummed, "and no summing flag is raised");
}

// ── Depreciation alone, no amortisation tagged: exactly as before ────────────────────────────────
{
  const c = col({ ...d("Revenues", 10e9), ...d("OperatingIncomeLoss", 2e9), ...d("Depreciation", 400e6) });
  eq(c.v.da, 400e6, "a filer tagging depreciation and nothing else keeps the depreciation figure");
  eq(c.meta.da.status, "reported", "as a reported figure");
  ok(!c.v.daSummed && c.v.daDepreciationOnly === true, "the row knows it resolved `Depreciation`, and nothing was summed");
}

// ── A zero amortisation is not a sum ─────────────────────────────────────────────────────────────
{
  const c = col({ ...d("Revenues", 10e9), ...d("OperatingIncomeLoss", 2e9), ...d("Depreciation", 400e6), ...d("AmortizationOfIntangibleAssets", 0) });
  eq(c.v.da, 400e6, "amortisation filed as zero adds nothing and the row is not marked as summed");
  ok(!c.v.daSummed, "no flag");
  eq(c.meta.da.status, "reported", "and the depreciation figure keeps its accession");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-da cache pins")) {
  const at = (t, end) => buildGrid(loadFixture(t), null, 8).cols.find(c => c.period.end === end);
  const abbv = at("ABBV", "2025-12-31"); if (abbv) { ok(abbv.v.daSummed, "AbbVie FY2025 is summed"); ok(abbv.v.da > 7e9, `AbbVie FY2025 D&A is above $7bn, not $762m — ${abbv.v.da}`); }
  const amgn = at("AMGN", "2025-12-31"); if (amgn) { eq(amgn.meta.da.status, "reported", "Amgen keeps its filed total"); ok(!amgn.v.daSummed, "and is not summed"); }
  const amd = at("AMD", "2023-12-30"); if (amd) { ok(amd.v.daSummed && amd.v.da > 3e9, `AMD FY2023 D&A is above $3bn — ${amd.v.da}`); }
  let summed = 0, total = 0;
  for (const t of ["ABBV", "AMD", "AVGO", "INTC", "MSFT", "ORCL", "TMO", "TSLA", "MRK", "GEV"]) { const g = buildGrid(loadFixture(t), null, 8); for (const c of g.cols) { total++; if (c.v.daSummed) summed++; } }
  ok(summed >= 40, `at least 40 of the ${total} annual columns on the ten named filers are summed — found ${summed}`);
}

done("t-da");
