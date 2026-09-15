// Rule 38 — an LLC's members' equity and a partnership's partners' capital are the equity line under
// the names those entities file, and a mezzanine line under a class concept the row does not ask for is
// taken only where the balance sheet then closes on it. Measured before it shipped over every annual
// and LTM column of the 180-filer cache and the material-weakness frame (the private notes'
// measure/audit4/item2): 40 mezzanine cells, every one closing its column to $0, the open annual columns
// 19 → 8, and no column that closed before opened.
//
// Drives the SHIPPING extract, grid and template. Fixtures are hand-built in the companyfacts shape
// with the figures of the filers each mirrors; the cache pins at the end skip cleanly without the cache.
// Mutation-tested; each mutation is named beside the block it breaks.
import { ok, eq, done } from "./_t.mjs";
import { fillMezzanine, MEZZ_CANDIDATES, MEZZ_COMPONENTS, MEZZ_GATE_TOL, bsFoots } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture } from "./_fixtures.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);

function filing(form, filed, accn) {
  const facts = [];
  const put = (tag, f) => facts.push({ tag, f: { ...f, fy: +f.end.slice(0, 4), fp: "FY", filed, form, accn } });
  const api = {
    rev: (start, end, val) => (put("Revenues", { start, end, val }), api),
    tag: (tag, end, val) => (put(tag, { end, val }), api),
    bs: (end, A, L, E, eTag = "StockholdersEquity") => (put("Assets", { end, val: A }), put("Liabilities", { end, val: L }), put(eTag, { end, val: E }), api),
    facts, meta: { form, filed, accn },
  };
  return api;
}
function grid(...filings) {
  const facts = {};
  for (const fl of filings) for (const { tag, f } of fl.facts) {
    facts[tag] = facts[tag] || { label: tag, units: { USD: [] } };
    facts[tag].units.USD.push(f);
  }
  const list = filings.map(fl => ({ ...fl.meta, period: fl.facts.map(x => x.f.end).sort().pop() }));
  return buildGrid({ cik: "1", name: "X", sicCode: "2040", facts, filings: list }, null, 8);
}
const at = (g, end) => g.cols.find(c => c.period.end === end);
const Y = "2019-05-26", R = ["2018-05-28", Y];

// ── The candidates, the components and the gate are what was measured, and KEEP carries them ─────
// MUTATION: dropping a spelling from KEEP makes it invisible to every sheet and fails here.
{
  eq(MEZZ_CANDIDATES.join(" "), "RedeemableNoncontrollingInterestEquityCommonCarryingAmount RedeemableNoncontrollingInterestEquityPreferredCarryingAmount RedeemableNoncontrollingInterestEquityOtherFairValue",
    "three single spellings, in the measured order — the four others the census tried reach no column");
  eq(MEZZ_COMPONENTS.join(" "), "RedeemableNoncontrollingInterestEquityCommonCarryingAmount RedeemableNoncontrollingInterestEquityPreferredCarryingAmount RedeemableNoncontrollingInterestEquityOtherCarryingAmount",
    "and the three class carrying amounts that sum inside one filing");
  eq(MEZZ_GATE_TOL, 1e-4, "the gate is the filer's own arithmetic at rule 33's precision, not the 0.5% foot test");
  const keep = readFileSync(join(root, "api", "facts.js"), "utf8");
  for (const t of new Set([...MEZZ_CANDIDATES, ...MEZZ_COMPONENTS])) ok(keep.includes(`"${t}"`), `KEEP carries ${t}`);
  for (const t of ["MembersEquity", "PartnersCapital"]) ok(line("equity").tags.includes(t) && keep.includes(`"${t}"`), `the equity row asks for ${t} and KEEP carries it`);
  ok(typeof line("tempEquity").flagNote.mezzSummed === "function", "the mezzanine row carries rule 38's note for a summed cell");
}

// ── A single class concept that closes the column is the mezzanine (General Mills FY2019) ─────────
// Assets $30,111.2m, liabilities $22,191.8m, total equity $7,367.7m: $551.7m short, which is exactly
// the redeemable interest General Mills tags under `…OtherFairValue` and no row asks for.
// MUTATION: taking the first candidate without the gate still passes this block and fails the next.
{
  const k = filing("10-K", "2019-06-28", "gis").rev("2018-05-28", Y, 16865e6)
    .bs(Y, 30111.2e6, 22191.8e6, 7367.7e6, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityOtherFairValue", Y, 551.7e6);
  const c = at(grid(k), Y);
  eq(c.v.tempEquity, 551.7e6, "the mezzanine row fills with the $551.7m that closes the column");
  eq(c.meta.tempEquity.tag, "RedeemableNoncontrollingInterestEquityOtherFairValue", "from the class concept");
  eq(c.meta.tempEquity.status, "reported", "a filed figure, so the cell links to its filing");
  eq(c.meta.tempEquity.closes, "single", "and it says how it was taken");
  ok(bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equityAll, c.v.tempEquity) && !c.v.mezzSummed, "the column closes, and no summed-cell note fires");
}

// ── A candidate that does not close is not taken, and the row stays blank ────────────────────────
// MUTATION: widening the gate to BS_FOOT_TOL takes the $10.5m-off figure below; dropping the gate takes all three.
{
  const off = filing("10-K", "2019-06-28", "x").rev("2018-05-28", Y, 16865e6)
    .bs(Y, 30111.2e6, 22191.8e6, 7367.7e6, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityOtherFairValue", Y, 400e6);
  eq(at(grid(off), Y).v.tempEquity, null, "a $400m redeemable interest against a $551.7m gap is not the mezzanine");
  const near = filing("10-K", "2019-06-28", "y").rev("2018-05-28", Y, 16865e6)
    .bs(Y, 30111.2e6, 22191.8e6, 7367.7e6, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityOtherFairValue", Y, 551.7e6 - 150e6 * 0.07);
  eq(at(grid(near), Y).v.tempEquity, null, "nor one that lands $10.5m away on a $30bn balance sheet — inside 0.5%, outside the filer's own arithmetic");
  const exact = filing("10-K", "2019-06-28", "z").rev("2018-05-28", Y, 16865e6)
    .bs(Y, 30111.2e6, 22191.8e6, 7367.7e6, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityOtherFairValue", Y, 551.7e6 - 1e6);
  eq(at(grid(exact), Y).v.tempEquity, 550.7e6, "a filer's rounding ($1m on $30bn, 0.3e-4 of assets) is inside the gate");
}

// ── A mezzanine total the row already resolves is never second-guessed ──────────────────────────
// MUTATION: removing the `v.tempEquity != null` guard replaces a filed total with a class figure here.
{
  const k = filing("10-K", "2019-06-28", "t").rev("2018-05-28", Y, 16865e6)
    .bs(Y, 30111.2e6, 22191.8e6, 7367.7e6, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("TemporaryEquityCarryingAmountAttributableToParent", Y, 551.7e6).tag("RedeemableNoncontrollingInterestEquityCommonCarryingAmount", Y, 551.7e6);
  const c = at(grid(k), Y);
  eq(c.meta.tempEquity.tag, "TemporaryEquityCarryingAmountAttributableToParent", "the row's own tag wins");
  ok(!c.meta.tempEquity.closes, "and the gate never ran");
}

// ── The classes, summed inside ONE filing, where no single class closes (Farmland Partners FY2018) ─
// $1,139.5m of assets, $536.0m of liabilities, $339.3m of equity: $264.3m short. Farmland tags its
// Series A preferred units ($120.5m) and its Series B participating preferred as "other" ($143.8m); the
// preferred alone is the ungated list's partial-as-whole, and the gate refuses it before the sum closes.
// MUTATION: accepting a single class without the gate prints $120.5m here; summing across filings fails the next.
{
  const E = "2018-12-31";
  const k = filing("10-K", "2019-03-01", "fpi").rev("2018-01-01", E, 56e6)
    .bs(E, 1139509000, 535968000, 339273000, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityPreferredCarryingAmount", E, 120510000).tag("RedeemableNoncontrollingInterestEquityOtherCarryingAmount", E, 143758000);
  const c = at(grid(k), E);
  eq(c.v.tempEquity, 264268000, "the mezzanine is the two classes' $264,268,000, which closes the column to the dollar");
  eq(c.meta.tempEquity.status, "computed", "a sum no filing presents is computed, and carries no single accession to link to");
  ok(!c.meta.tempEquity.accn && c.meta.tempEquity.from.accn === "fpi", "the filing it was read from travels with the cell for the note");
  ok(c.v.mezzSummed === true, "and the column flag puts rule 38's note under the row");
  ok(/preferred 120\.5m plus other 143\.8m/.test(line("tempEquity").flagNote.mezzSummed(c)), "the note names the classes with the filer's own figures");
}
{
  const E = "2018-12-31";
  const k = filing("10-K", "2019-03-01", "a").rev("2018-01-01", E, 56e6)
    .bs(E, 1139509000, 535968000, 339273000, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityPreferredCarryingAmount", E, 120510000);
  const q = filing("10-Q", "2019-05-01", "b").tag("RedeemableNoncontrollingInterestEquityOtherCarryingAmount", E, 143758000);
  eq(at(grid(k, q), E).v.tempEquity, null, "two classes from two filings are never summed — no filing presents that total");
}
// The sum is a candidate like any other: two classes in one filing that do not close the column are
// not the mezzanine either. MUTATION: taking the sum without the gate prints $220.5m here.
{
  const E = "2018-12-31";
  const k = filing("10-K", "2019-03-01", "c").rev("2018-01-01", E, 56e6)
    .bs(E, 1139509000, 535968000, 339273000, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")
    .tag("RedeemableNoncontrollingInterestEquityPreferredCarryingAmount", E, 120510000).tag("RedeemableNoncontrollingInterestEquityOtherCarryingAmount", E, 100000000);
  eq(at(grid(k), E).v.tempEquity, null, "$120.5m plus $100.0m against a $264.3m gap is not taken, and the row stays blank");
}

// ── fillMezzanine needs all three other legs, and is inert without them ─────────────────────────
// MUTATION: dropping the three-leg guard lets a column with no liabilities "close" on any candidate.
{
  const v = { totalAssets: 100, totalLiab: null, equity: 40, equityAll: null, tempEquity: null }, meta = {};
  const facts = { RedeemableNoncontrollingInterestEquityCommonCarryingAmount: { units: { USD: [{ end: Y, val: 60, filed: "2019-06-28", form: "10-K", accn: "q" }] } } };
  eq(fillMezzanine(facts, v, meta, Y, "USD"), null, "no liabilities, no identity, nothing taken");
  eq(v.tempEquity, null, "and the column is untouched");
}

// ── An LLC's or a partnership's equity is the equity line (MPLX, GRAIL) — LAST (RadNet) ────────────
// MUTATION: putting `PartnersCapital` ahead of `StockholdersEquity` takes RadNet's consolidated
// partnership's $42m as the company's equity and fails the second block.
{
  const E = "2025-12-31";
  const k = filing("10-K", "2026-02-20", "mplx").rev("2025-01-01", E, 12e9).bs(E, 43005e6, 28477e6, 14301e6, "PartnersCapital")
    .tag("PartnersCapitalIncludingPortionAttributableToNoncontrollingInterest", E, 14528e6);
  const c = at(grid(k), E);
  eq(c.v.equity, 14301e6, "MPLX's partners' capital fills the equity row");
  eq(c.v.equityAll, 14528e6, "and its all-in partners' capital the all-in row");
  ok(bsFoots(c.v.totalAssets, c.v.totalLiab, c.v.equityAll, c.v.tempEquity), "and the column closes on it: $43,005m = $28,477m + $14,528m");
}
{
  const E = "2024-12-31";
  const k = filing("10-K", "2025-03-01", "rdnt").rev("2024-01-01", E, 1.8e9).bs(E, 3.2e9, 2.4e9, 52e6)
    .tag("PartnersCapital", E, 42e6);
  eq(at(grid(k), E).v.equity, 52e6, "RadNet's own stockholders' equity, not the $42m of a partnership it consolidates");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-mezz cache pins")) {
  const g = t => { try { return buildGrid(loadFixture(t), null, 8); } catch { return null; } };
  const col = (t, end) => { const x = g(t); return x && x.cols.find(c => c.period.end === end); };
  const gis = col("GIS", "2019-05-26"); if (gis) { eq(gis.v.tempEquity, 551.7e6, "General Mills FY2019's mezzanine is its $551.7m redeemable interest"); ok(bsFoots(gis.v.totalAssets, gis.v.totalLiab, gis.v.equityAll, gis.v.tempEquity), "and the column closes"); }
  const fpi = col("FPI", "2018-12-31"); if (fpi) { eq(fpi.v.tempEquity, 264268000, "Farmland Partners FY2018 is $264,268,000, summed"); eq(fpi.meta.tempEquity.status, "computed", "and marked computed"); }
  const fpi21 = col("FPI", "2021-12-31"); if (fpi21) eq(fpi21.meta.tempEquity.tag, "RedeemableNoncontrollingInterestEquityPreferredCarryingAmount", "Farmland FY2021 closes on the preferred alone once the Series B went to zero");
  const mplx = col("MPLX", "2025-12-31"); if (mplx) { eq(mplx.meta.equity.tag, "PartnersCapital", "MPLX FY2025 equity is its partners' capital"); ok(mplx.v.debtCap != null && mplx.v.debtCap < 1, "and debt-to-capital is no longer the 1.000 a blank equity summed as zero produced"); }
  const gral = col("GRAL", "2023-12-31"); if (gral) { eq(gral.v.equity, 3646187000, "GRAIL FY2023, the LLC year before its spin-off, shows its members' equity"); ok(bsFoots(gral.v.totalAssets, gral.v.totalLiab, gral.v.equity, gral.v.tempEquity), "and closes"); }
  // Every annual column still open on the cache is the dimensioned class or iQSTEL's swapped tags.
  const open = [];
  for (const t of ["CART", "ERAS", "IQST", "NRDE", "FPI", "GIS", "MPLX", "GRAL"]) { const x = g(t); if (!x) continue;
    for (const c of x.cols) { const E = c.v.equityAll != null ? c.v.equityAll : c.v.equity; if (c.v.totalAssets != null && c.v.totalLiab != null && E != null && !bsFoots(c.v.totalAssets, c.v.totalLiab, E, c.v.tempEquity)) open.push(`${t} ${c.period.end}`); } }
  eq(open.join(", "), "CART 2023-12-31, CART 2024-12-31, CART 2025-12-31, ERAS 2020-12-31, IQST 2024-12-31, IQST 2025-12-31, NRDE 2024-12-31, NRDE 2025-12-31",
    "the open columns on these filers are exactly the eight the measurement left: a class-of-stock mezzanine (Instacart, Erasca, Nuride) and iQSTEL's swapped equity tags");
}

done("t-mezz");
