// Rule 35 — a derivation that subtracts a blank input must refuse, not print the row it was meant to
// adjust; two of the seven keep their figure and gain a note instead; the carriers keep free cash flow
// with capex untagged, by measurement; and the capex row gains three measured spellings and a pin.
// Measured before it shipped over the 180-filer cache: fcf printed cash from operations on 241 cells
// of 43 filers (Verizon $37.1bn against a real $20.1bn), fccr on 92, cashTaxRate the effective rate on
// 156, quickRatio the current ratio on 267, ebitdaSbc EBITDA on 94, tbvps book value on 393.
//
// Drives the SHIPPING extract, grid and template. Mutation-tested; each mutation is named beside the
// block it breaks. Cache pins at the end skip cleanly without the cache.
import { ok, eq, near, done } from "./_t.mjs";
import { DERIVED, CAPEX_IMMATERIAL_INDUSTRIES } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS, NOT_APPLICABLE } from "../src/template.js";
import { needFixtures, loadFixture } from "./_fixtures.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);

const FILED = "2026-02-01", END = "2025-12-31", START = "2025-01-01";
const dur = (tag, val) => ({ [tag]: { label: tag, units: { USD: [{ start: START, end: END, val, fy: 2025, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } } });
const inst = (tag, val) => ({ [tag]: { label: tag, units: { USD: [{ end: END, val, fy: 2025, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } } });
const shares = n => ({ WeightedAverageNumberOfSharesOutstandingBasic: { label: "s", units: { shares: [{ start: START, end: END, val: n, fy: 2025, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } },
  "dei:EntityCommonStockSharesOutstanding": { label: "s", units: { shares: [{ end: END, val: n, fy: 2025, fp: "FY", filed: FILED, form: "10-K", accn: "a-1" }] } } });
const col = (sic, facts) => { const g = buildGrid({ cik: "1", name: "X", sicCode: sic, facts, filings: [{ form: "10-K", filed: FILED, accn: "a-1", period: END }] }, null, 8); return g.cols[g.cols.length - 1]; };
const base = { ...dur("Revenues", 10e9), ...dur("OperatingIncomeLoss", 2e9), ...dur("NetCashProvidedByUsedInOperatingActivities", 3e9), ...dur("IncomeTaxExpenseBenefit", 400e6),
  ...dur("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", 2e9), ...dur("InterestExpense", 100e6), ...dur("DepreciationDepletionAndAmortization", 500e6),
  ...inst("AssetsCurrent", 4e9), ...inst("LiabilitiesCurrent", 2e9), ...inst("StockholdersEquity", 8e9), ...inst("Assets", 20e9), ...inst("Liabilities", 12e9), ...shares(1e9) };

// ── The seven derivations refuse a blank subtrahend (five) or say what they could not deduct (two) ──
// MUTATION: restoring `(v.capex || 0)` in fcf, fccr or ufcf, `(v.deferredTax || 0)` in cashTaxRate or
// `(v.sbc || 0)` in ebitdaSbc fails the matching assertion below.
{
  eq(DERIVED.fcf({ cfo: 3e9, capex: null }), null, "fcf refuses without capex — it is not cash from operations");
  eq(DERIVED.fcf({ cfo: 3e9, capex: 1e9 }), 2e9, "and subtracts it when it is there");
  eq(DERIVED.fcf({ cfo: 3e9, capex: 0 }), 3e9, "a capex filed as zero is a figure, not a blank");
  eq(DERIVED.fccr({ ebitda: 2.5e9, capex: null, intExp: 100e6 }), null, "fccr refuses without capex — it is not interest cover");
  eq(DERIVED.fccr({ ebitda: 2.5e9, capex: 500e6, intExp: 100e6 }), 20, "(2,500 − 500) / 100");
  eq(DERIVED.ufcf({ nopat: 100, da: 40, capex: null, chgNwc: 25 }), null, "unlevered FCF refuses without capex");
  eq(DERIVED.ufcf({ nopat: 100, da: 40, capex: 20, chgNwc: 25 }), 95, "and computes with it — 100 + 40 − 20 − 25, unchanged from rule 25");
  eq(DERIVED.cashTaxRate({ tax: 400e6, deferredTax: null, pretax: 2e9 }), null, "the cash tax rate refuses without the deferred line — it is not the effective rate");
  near(DERIVED.cashTaxRate({ tax: 400e6, deferredTax: 100e6, pretax: 2e9 }), 0.15, 1e-9, "(400 − 100) / 2,000");
  eq(DERIVED.ebitdaSbc({ ebitda: 2.5e9, sbc: null }), null, "EBITDA ex-SBC refuses without SBC — it is not EBITDA");
  eq(DERIVED.ebitdaSbc({ ebitda: 2.5e9, sbc: 300e6 }), 2.2e9, "and deducts it when tagged");
  eq(DERIVED.ebitda({ ebit: 2e9, da: null }), 2e9, "EBITDA with no D&A is still EBIT — the recorded decision (a missing D&A understates), untouched");
}

// ── On a rendered column: the blanks, the notes, and rule 22's ordering ──────────────────────────
{
  const c = col("2834", base);
  eq(c.v.fcf, null, "a corporate with cash from operations and no capex has no free cash flow");
  eq(c.v.fccr, null, "no fixed-charge coverage");
  eq(c.v.cashTaxRate, null, "no cash tax rate");
  eq(c.v.ebitdaSbc, null, "no EBITDA ex-SBC");
  ok(!c.v.capexWaived, "and no waiver — it is not a carrier");
  eq(c.v.quickRatio, 2, "the quick ratio prints — current assets over current liabilities, nothing deducted");
  ok(c.v.quickNoInventory === true, "with the flag that puts the note under it");
  ok(/tags no inventory/.test(line("quickRatio").flagNote.quickNoInventory), "and the note says so");
  eq(c.v.tbvps, 8, "tangible book per share prints — $8bn over 1bn shares, nothing deducted");
  ok(c.v.tbvpsPartial === true, "with its flag");
  ok(/no goodwill and no intangibles/.test(line("tbvps").flagNote.tbvpsPartial(c)), "and the note names both missing legs");
  const c2 = col("2834", { ...base, ...inst("Goodwill", 1e9) });
  eq(c2.v.tbvps, 7, "with goodwill tagged the deduction is made — $7bn");
  ok(/no intangibles at 2025-12-31/.test(line("tbvps").flagNote.tbvpsPartial(c2)) && /deducts only goodwill/.test(line("tbvps").flagNote.tbvpsPartial(c2)), "and the note names only the leg still missing");
  const c3 = col("2834", { ...base, ...inst("Goodwill", 1e9), ...inst("IntangibleAssetsNetExcludingGoodwill", 500e6), ...inst("InventoryNet", 1e9) });
  ok(!c3.v.tbvpsPartial && !c3.v.quickNoInventory, "and with both tagged, neither note fires");
  eq(c3.v.quickRatio, 1.5, "(4 − 1) / 2");
  // The notes are keyed to the FIGURE, not the input: a row that did not render must not be explained.
  // MUTATION: keying `quickNoInventory` off `curAssets` instead of `quickRatio` fails the first; keying
  // `tbvpsPartial` off `equity` instead of `tbvps` fails the second.
  const noLiab = { ...base }; delete noLiab.LiabilitiesCurrent;
  const c4 = col("2834", noLiab);
  eq(c4.v.quickRatio, null, "no current liabilities, no quick ratio");
  ok(!c4.v.quickNoInventory, "and no note under a row that shows nothing");
  const noShares = { ...base }; delete noShares["dei:EntityCommonStockSharesOutstanding"];
  const c5 = col("2834", noShares);
  eq(c5.v.tbvps, null, "no share count, no tangible book per share");
  ok(!c5.v.tbvpsPartial, "and no note under it");
}

// ── The carriers: capex untagged is waived, measured, and the row says so ────────────────────────
// At the P&C carriers that do tag capex it is 3.8% of operating cash flow at the median and 8.2% at the
// 90th percentile; no life carrier tags it at all. Health plans run 11–18% and get no waiver, and
// neither do REITs, whose real spending is under concepts the capex row does not ask for.
// MUTATION: adding "health" to CAPEX_IMMATERIAL_INDUSTRIES fails the Cigna block; removing "pc" or
// "life" fails the Chubb one; setting the waiver before the blanking pass and not after leaves a bank
// explaining a figure it does not show (asserted on the bank below).
{
  eq([...CAPEX_IMMATERIAL_INDUSTRIES].sort().join(" "), "life pc", "the waiver is the two carrier industries and nothing else");
  const chubb = col("6331", { ...base });
  eq(chubb.v.fcf, 3e9, "a P&C carrier with no capex tagged prints free cash flow as cash from operations");
  ok(chubb.v.capexWaived === true, "with the waiver flag that puts the note under the row");
  ok(/3\.8% of operating cash flow/.test(line("fcf").flagNote.capexWaived), "and the note states the measured basis");
  const met = col("6311", { ...base });
  eq(met.v.fcf, 3e9, "and so does a life carrier");
  const cigna = col("6324", { ...base });
  eq(cigna.v.fcf, null, "a health plan does not — its capex is material where it is tagged, and Cigna's is untagged after 2019");
  ok(!cigna.v.capexWaived, "no waiver, no note");
  const reit = col("6798", { ...base });
  eq(reit.v.fcf, null, "nor a REIT, whose real capital spending is development and acquisition under other concepts");
  const bank = col("6021", { ...base });
  eq(bank.v.fcf, null, "a bank's free cash flow is n/a (rule 27)");
  ok(!bank.v.capexWaived && !bank.v.quickNoInventory, "and it carries neither note, because both are set after the blanking pass");
  for (const ind of ["pc", "life", "health", "reit"]) ok(!NOT_APPLICABLE[ind].includes("fcf"), `rule 27's keep for ${ind} is untouched`);
}

// ── The capex row: three measured spellings, last-resort last, and pinned by run ─────────────────
// `PaymentsToAcquireOtherPropertyPlantAndEquipment` equals the existing figure 12 times in 12 where
// both are filed; `PaymentsForCapitalImprovements` equals it at the corporates that file both;
// `PaymentsToAcquireOtherProductiveAssets` is Chevron's "other" at a rounding of zero and Verizon's
// whole capex line, so it is reached only where nothing above it resolves.
// MUTATION: reordering `PaymentsToAcquireOtherProductiveAssets` above the two existing tags fails
// the Chevron block; dropping `pinByRun` from the row fails the AvalonBay block.
{
  const capex = line("capex");
  eq(capex.tags.slice(0, 2).join(" "), "PaymentsToAcquirePropertyPlantAndEquipment PaymentsToAcquireProductiveAssets", "the two original candidates still lead");
  eq(capex.tags[capex.tags.length - 1], "PaymentsToAcquireOtherProductiveAssets", "and Verizon's is last");
  ok(capex.tags.includes("PaymentsToAcquireOtherPropertyPlantAndEquipment") && capex.tags.includes("PaymentsForCapitalImprovements"), "the two aliases are asked for");
  ok(capex.pinByRun === true, "and the row is pinned by run");
  const keep = readFileSync(join(root, "api", "facts.js"), "utf8");
  for (const t of capex.tags) ok(keep.includes(`"${t}"`), `KEEP carries ${t}`);
  // Lilly: only the "other" PP&E spelling.
  const lly = col("2834", { ...base, ...dur("PaymentsToAcquireOtherPropertyPlantAndEquipment", 7841e6) });
  eq(lly.v.capex, 7841e6, "Lilly's capex fills from the alias"); eq(lly.v.fcf, 3e9 - 7841e6, "and free cash flow is real");
  // Chevron: the existing tag AND a tiny "other" — the existing figure wins.
  const cvx = col("2911", { ...base, ...dur("PaymentsToAcquirePropertyPlantAndEquipment", 16e9), ...dur("PaymentsToAcquireOtherProductiveAssets", 60e6) });
  eq(cvx.v.capex, 16e9, "Chevron's capex is its $16bn of PP&E payments, not the $60m of other");
}
// AvalonBay: a small `PaymentsToAcquireProductiveAssets` in two years, `PaymentsForCapitalImprovements`
// in every year at 25x — pinned, the concept spanning the sheet carries every column.
{
  const yrs = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const facts = {};
  const put = (tag, y, val) => { facts[tag] = facts[tag] || { label: tag, units: { USD: [] } }; facts[tag].units.USD.push({ start: `${y}-01-01`, end: `${y}-12-31`, val, fy: y, fp: "FY", filed: `${y + 1}-02-15`, form: "10-K", accn: `k-${y}` }); };
  for (const y of yrs) { put("Revenues", y, 2.3e9); put("NetCashProvidedByUsedInOperatingActivities", y, 1.3e9); put("PaymentsForCapitalImprovements", y, 83e6 + (y - 2018) * 10e6); }
  put("PaymentsToAcquireProductiveAssets", 2018, 3.3e6); put("PaymentsToAcquireProductiveAssets", 2019, 5.3e6);
  const g = buildGrid({ cik: "1", name: "AVB-shape", sicCode: "6798", facts, filings: yrs.map(y => ({ form: "10-K", filed: `${y + 1}-02-15`, accn: `k-${y}`, period: `${y}-12-31` })) }, null, 8);
  eq(g.cols.map(c => c.meta.capex.tag).join(" "), Array(8).fill("PaymentsForCapitalImprovements").join(" "), "every column carries capital improvements — one concept across the sheet");
  eq(g.cols[0].v.capex, 83e6, "FY2018 is $83m, not the $3.3m of other productive assets");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-blank cache pins")) {
  const at = (t, end) => buildGrid(loadFixture(t), null, 8).cols.find(c => c.period.end === end);
  const vz = at("VZ", "2025-12-31"); if (vz) { near(vz.v.fcf, 20.126e9, 0.1e9, "Verizon FY2025 free cash flow is $20.1bn, not the $37.1bn of cash from operations"); eq(vz.meta.capex.tag, "PaymentsToAcquireOtherProductiveAssets", "from the last-resort spelling"); }
  const lly = at("LLY", "2025-12-31"); if (lly) ok(lly.v.capex != null && lly.v.fcf != null && lly.v.fcf < lly.v.cfo, "Lilly's capex fills and free cash flow is below cash from operations");
  const cb = at("CB", "2025-12-31"); if (cb) { ok(cb.v.capexWaived && cb.v.fcf === cb.v.cfo, "Chubb's free cash flow is its cash from operations, waived and marked"); }
  const ci = at("CI", "2025-12-31"); if (ci) eq(ci.v.fcf, null, "Cigna's is blank — no capex tagged, no waiver for a health plan");
  const nee = at("NEE", "2025-12-31"); if (nee) eq(nee.v.fcf, null, "NextEra's is blank — no capex under any concept the row asks for");
  const aapl = at("AAPL", "2025-09-27"); if (aapl) eq(aapl.v.cashTaxRate, null, "Apple's cash tax rate is blank where its deferred tax line is untagged, not the effective rate");
  const avb = at("AVB", "2018-12-31"); if (avb) eq(avb.meta.capex.tag, "PaymentsForCapitalImprovements", "AvalonBay's FY2018 capex is capital improvements, the concept that spans its sheet");
}

done("t-blank");
