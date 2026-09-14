// Rule 33 — the revenue row is a series, the filer's own arithmetic settles which concept carries it,
// column by column where it can, and the LTM stitch may take its interim legs from a sibling concept
// whose annual figure is the same figure. Measured before it shipped over the 180-filer cache: 11
// annual cells change (General Mills' six 10x-too-small years, Interactive Brokers gross→net, Paramount's
// pre-merger year, Hycroft's zero, Ridgeline), 17 LTM revenue cells appear and none vanish, and the
// row's mid-sheet concept switches go 25 → 6.
//
// Drives the SHIPPING extract, grid and template. Fixtures are hand-built in the companyfacts shape
// with the figures of the filers each mirrors. Mutation-tested; each mutation is named beside the
// block it breaks. Cache pins at the end skip cleanly without the cache.
import { ok, eq, near, done } from "./_t.mjs";
import { tagsByRun, tagsByIdentity, pickLtm } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture } from "./_fixtures.mjs";

const lines = SECTIONS.flatMap(s => s.lines);
const line = k => lines.find(l => l.k === k);
const REV = line("revenue");
const R606 = "RevenueFromContractWithCustomerExcludingAssessedTax", R606I = "RevenueFromContractWithCustomerIncludingAssessedTax";

// ── A filing is a list of facts; a filer is a list of filings ───────────────────────────────────
function filing(form, filed, accn) {
  const facts = [];
  const put = (tag, unit, f) => facts.push({ tag, unit, f: { ...f, fy: +f.end.slice(0, 4), fp: f.start && (new Date(f.end) - new Date(f.start)) / 864e5 < 200 ? "Q2" : "FY", filed, form, accn } });
  const api = {
    dur: (tag, start, end, val) => (put(tag, "USD", { start, end, val }), api),
    inst: (tag, end, val) => (put(tag, "USD", { end, val }), api),
    facts, meta: { form, filed, accn },
  };
  return api;
}
function filer(sic, ...filings) {
  const facts = {};
  for (const fl of filings) for (const { tag, unit, f } of fl.facts) {
    facts[tag] = facts[tag] || { label: tag, units: {} };
    (facts[tag].units[unit] = facts[tag].units[unit] || []).push(f);
  }
  const list = filings.map(fl => ({ ...fl.meta, period: fl.facts.map(x => x.f.end).sort().pop() }));
  return buildGrid({ cik: "1", name: "X", sicCode: sic, facts, filings: list }, null, 8);
}
const FY = y => [`${y}-01-01`, `${y}-12-31`];
// One 10-K per year carrying its own year and the prior one as a comparative, under `tags` at `vals[y]`.
const tenKs = (years, rows) => years.map(y => {
  const k = filing("10-K", `${y + 1}-02-15`, `k-${y}`);
  for (const [tag, vals] of rows) for (const yy of [y - 1, y]) if (vals[yy] != null) k.dur(tag, ...FY(yy), vals[yy]);
  return k;
});
const tagsOf = g => g.cols.map(c => (c.meta.revenue || {}).tag);

// ── The engine and the template agree on what the row declares ──────────────────────────────────
{
  ok(REV.pinByRun === true, "the revenue row opts into rule 21's pin");
  eq(REV.pinIdentity, { plus: "cogs", equals: "grossProfit" }, "and into rule 23's identity as the MINUEND: revenue = gross profit + cost of revenue");
  eq(REV.tags[0], "Revenues", "rule 9 still leads the list — `Revenues` is the total");
  ok(REV.omitFor && REV.omitFor.bank.includes("InterestAndDividendIncomeOperating"), "and the bank omission is still declared, because the pin has to honour it");
}

// ── General Mills: `Revenues` at a tenth of the top line for six years, the 606 tag for all eight ──
// No gross profit is tagged, so the identity cannot test a column; the pin decides. `Revenues` stops
// at FY2024 and the 606 tag reaches FY2025, so the 606 tag carries the row on every column.
// MUTATION: dropping `pinByRun` from the row restores 2,044 on the first six columns and fails here.
{
  const yrs = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const total = Object.fromEntries(yrs.map((y, i) => [y, (16865 + 500 * i) * 1e6]));
  const slice = Object.fromEntries(yrs.slice(0, 6).map((y, i) => [y, (2044 + 30 * i) * 1e6]));
  const cogs = Object.fromEntries(yrs.map((y, i) => [y, (11108 + 300 * i) * 1e6]));
  const g = filer("2040", ...tenKs(yrs, [[R606, total], ["Revenues", slice], ["CostOfGoodsAndServicesSold", cogs]]));
  eq(tagsOf(g).join(" "), Array(8).fill(R606).join(" "), "every column carries the ASC 606 total — the concept that reaches the newest column and spans the sheet");
  eq(g.cols[0].v.revenue, 16865e6, "FY2018 revenue is $16.9bn, not the $2.0bn slice");
  ok(g.cols.every(c => c.v.grossProfit > 0), "and gross profit derives positive on every column, where it was minus $9bn");
}

// ── Capstone Energy Plus: the concept that IS the total changed, and the filing says so each year ──
// Through FY2023 only the 606 tag is filed and it closes gross profit; from FY2024 `Revenues` closes it
// and the 606 tag is a product-only slice 13–16% below. Run length alone pins the slice (8 years against
// 3); a sheet-wide identity scores the slice 5 to 4. Per column, the filer's arithmetic settles each.
// MUTATION: removing the per-column identity pass in fillCol prints the slice on FY2024–26 and fails;
// so does computing the identity as `gross profit − cost` instead of `gross profit + cost`.
{
  const yrs = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const c606 = { 2019: 83412000, 2020: 68926000, 2021: 67607000, 2022: 63964000, 2023: 73882000, 2024: 79788000, 2025: 69849000, 2026: 89242000 };
  const revs = { 2019: 83412000, 2024: 91219000, 2025: 85564000, 2026: 106004000 };
  const cogs = { 2019: 73960000, 2020: 59895000, 2021: 63122000, 2022: 58323000, 2023: 64818000, 2024: 76935000, 2025: 62266000, 2026: 72133000 };
  const gp = { 2019: 9452000, 2020: 9031000, 2021: 4485000, 2022: 5641000, 2023: 9064000, 2024: 14284000, 2025: 23298000, 2026: 33871000 };
  const g = filer("3510", ...tenKs(yrs, [[R606I, c606], ["Revenues", revs], ["CostOfGoodsAndServicesSold", cogs], ["GrossProfit", gp]]));
  const c = g.cols;
  eq(c.map(x => x.v.revenue).join(" "), [83412000, 68926000, 67607000, 63964000, 73882000, 91219000, 85564000, 106004000].join(" "),
    "each column shows the concept that closes gross profit + cost of revenue for THAT year: the 606 tag through FY2023, `Revenues` from FY2024");
  eq(tagsOf(g).slice(5).join(" "), ["Revenues", "Revenues", "Revenues"].join(" "), "FY2024–26 come from `Revenues`");
  ok(c[5].meta.revenue.identity && c[5].meta.revenue.identity.equals === "grossProfit", "and the cell records that the identity, not the pin, chose it");
  ok(!c[1].meta.revenue.identity, "a column where the pinned concept already closes the identity carries no such mark");
  eq(c[0].meta.revenue.status, "reported", "every cell is still a reported figure with its accession");
}

// ── Alphabet: a concept that does not reach the newest column must not win the pin ───────────────
// The 606 tag runs FY2018–FY2024 and stops; `Revenues` misses FY2022 and reaches FY2025; the 10-Qs
// tag only `Revenues`. By run alone the 606 tag wins (7 against 4), the newest column falls through
// to `Revenues` anyway, and the LTM stitch — which reads the annual column's concept — finds no
// interim under the 606 tag and goes blank. Reaching the newest column ranks first.
// MUTATION: dropping `reaches` from tagsByRun's sort pins the 606 tag and blanks the LTM here.
{
  const yrs = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const v = Object.fromEntries(yrs.map((y, i) => [y, (136819 + 30000 * i) * 1e6]));
  const revs = { ...v }; delete revs[2022];
  const c606 = { ...v }; delete c606[2025];
  // Net income every year, so the CALENDAR has all eight columns (rule 6's fallback anchor) and the
  // revenue row's two concepts are judged on the same eight ends: `Revenues` runs four (a hole at
  // FY2022), the 606 tag seven, and only `Revenues` reaches FY2025.
  const ni = Object.fromEntries(yrs.map((y, i) => [y, (30000 + 5000 * i) * 1e6]));
  const ks = tenKs(yrs, [["Revenues", revs], [R606, c606], ["NetIncomeLoss", ni]]);
  const q = filing("10-Q", "2026-07-25", "q-2026").dur("Revenues", "2026-01-01", "2026-06-30", 210e9).dur("Revenues", "2025-01-01", "2025-06-30", 180e9);
  const g = filer("7370", ...ks, q);
  eq(g.cols.length, 8, "eight columns, FY2018 to FY2025");
  eq(tagsByRun({}, ["a"], ["2025-12-31"]).join(), "a", "tagsByRun passes a single tag straight through");
  eq(tagsOf(g)[7], "Revenues", "the newest column is `Revenues`");
  eq(tagsOf(g)[0], "Revenues", "and so is the oldest — the pin chose the concept that reaches the newest column, not the longer run");
  ok(g.ltm && g.ltm.v.revenue != null, "so the LTM column stitches: the 10-Qs carry the same concept");
  near(g.ltm.v.revenue, v[2025] + 210e9 - 180e9, 1, "FY2025 + H1 2026 − H1 2025");
}

// ── A bank: the pin is computed AFTER the industry omission, or it hands the row gross interest income ──
// US Bancorp tags `InterestAndDividendIncomeOperating` in every year and `Revenues` in five; the bank
// `omitFor` keeps the first off the row, and the pinned list replaces the row's tags in fillCol.
// MUTATION: computing the pin from `line.tags` instead of the omitted list fails here.
{
  const yrs = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const gross = Object.fromEntries(yrs.map((y, i) => [y, (16173 + 1000 * i) * 1e6]));
  const revs = { 2018: 22637e6, 2022: 24302e6, 2023: 28144e6, 2024: 27455e6, 2025: 28656e6 };
  const g = filer("6021", ...tenKs(yrs, [["Revenues", revs], ["InterestAndDividendIncomeOperating", gross]]));
  ok(tagsOf(g).every(t => t !== "InterestAndDividendIncomeOperating"), "no column's revenue is the bank's gross interest income, whatever its run");
  eq(g.cols[7].v.revenue, 28656e6, "the newest column is the filer's own `Revenues`");
}

// ── MetLife: rule 9 exactly where it was ─────────────────────────────────────────────────────────
// `Revenues` and the 606 slice both run the whole sheet and both reach the newest column; no gross
// profit is tagged. A tie on reach and run keeps the list's order, and the list leads with the total.
// The slice never stitches an LTM either: its annual figure is 3% of the total, so it is not the same
// figure, and the sibling rule below refuses it.
// MUTATION: dropping the same-figure test in pickLtm stitches the 606 slice onto the total and fails
// the LTM assertion; putting the 606 tag first in the list fails the annual one.
{
  const yrs = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const total = Object.fromEntries(yrs.map((y, i) => [y, (67941 + 1000 * i) * 1e6]));
  const slice = Object.fromEntries(yrs.map((y, i) => [y, (2400 + 50 * i) * 1e6]));
  const q = filing("10-Q", "2026-08-05", "q-2026").dur(R606, "2026-01-01", "2026-06-30", 1300e6).dur(R606, "2025-01-01", "2025-06-30", 1250e6);
  const g = filer("6311", ...tenKs(yrs, [["Revenues", total], [R606, slice]]), q);
  eq(tagsOf(g).join(" "), Array(8).fill("Revenues").join(" "), "MetLife's row is `Revenues` on every column");
  eq(g.cols[7].v.revenue, total[2025], "$75bn, not $2.8bn");
  ok(g.ltm == null || g.ltm.v.revenue == null || g.ltm.meta.revenue.status !== "ltm", "and no LTM revenue is stitched from the slice's interim legs");
}

// ── Costco: the 10-K tags one concept, the 10-Qs the other, and the figure is the same ───────────
// Rule 12 recorded Costco's blank LTM revenue as the honest answer. Its two annual concepts are equal
// to the dollar in every year, so the interim legs under the 606 tag are on the annual column's basis
// and the stitch is sound. The cell says which concept the legs came from.
// MUTATION: restoring "only the tag the annual column chose" blanks the LTM and fails here.
{
  const yrs = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const v = Object.fromEntries(yrs.map((y, i) => [y, (141576 + 15000 * i) * 1e6]));
  const q = filing("10-Q", "2026-06-05", "q-2026").dur(R606, "2026-01-01", "2026-05-10", 110e9).dur(R606, "2025-01-01", "2025-05-10", 100e9);
  const g = filer("5331", ...tenKs(yrs, [["Revenues", v], [R606, v]]), q);
  eq(tagsOf(g)[7], "Revenues", "the annual column is `Revenues`");
  ok(g.ltm && g.ltm.meta.revenue.status === "ltm", "and the LTM column stitches");
  near(g.ltm.v.revenue, v[2025] + 110e9 - 100e9, 1, "FY2025 plus the 606 tag's year-to-date legs");
  eq(g.ltm.meta.revenue.legTag, R606, "with the cell recording that the legs came from the sibling concept");
  eq(g.ltm.meta.revenue.tag, "Revenues", "while the concept named on the cell is still the annual column's");
}

// ── pickLtm on its own ───────────────────────────────────────────────────────────────────────────
{
  const mk = (annualA, annualB, interimTag) => ({
    A: { label: "A", units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: annualA, filed: "2025-02-01", form: "10-K", accn: "k" }] } },
    B: { label: "B", units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: annualB, filed: "2025-02-01", form: "10-K", accn: "k" },
      ...(interimTag === "B" ? [{ start: "2025-01-01", end: "2025-06-30", val: 60, filed: "2025-08-01", form: "10-Q", accn: "q" }, { start: "2024-01-01", end: "2024-06-30", val: 50, filed: "2024-08-01", form: "10-Q", accn: "q0" }] : [])] } },
  });
  const win = { fy: { start: "2024-01-01", end: "2024-12-31" }, prevFy: null, cur: { start: "2025-01-01", end: "2025-06-30", days: 181 }, prior: { start: "2024-01-01", end: "2024-06-30", days: 182 }, end: "2025-06-30", days: 181 };
  eq(pickLtm(mk(100, 100, "B"), ["A", "B"], win, "USD").value, 110, "A's annual with B's interim legs, because B's annual is the same figure: 100 + 60 − 50");
  eq(pickLtm(mk(100, 100, "B"), ["A", "B"], win, "USD").legTag, "B", "and the leg concept is recorded");
  eq(pickLtm(mk(100, 3, "B"), ["A", "B"], win, "USD").status, "no-interim", "B's annual is a slice of A's, so B's legs are refused and the cell is blank");
  eq(pickLtm(mk(100, 100.005, "B"), ["A", "B"], win, "USD").value, 110, "one part in ten thousand is the same figure — a rounding difference between two statements");
  eq(pickLtm(mk(100, 100.2, "B"), ["A", "B"], win, "USD").status, "no-interim", "two parts in a thousand is not");
}

// ── tagsByIdentity in the minuend orientation ────────────────────────────────────────────────────
{
  // In millions, because the identity's tolerance has a $1,000 floor and dollar-sized fixtures would
  // let both candidates "close".
  const M = 1e6;
  const f = { GP: { label: "g", units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 30 * M, filed: "2025-02-01", form: "10-K", accn: "k" }] } },
    COGS: { label: "c", units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 70 * M, filed: "2025-02-01", form: "10-K", accn: "k" }] } },
    T: { label: "t", units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 100 * M, filed: "2025-02-01", form: "10-K", accn: "k" }] } },
    S: { label: "s", units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: 88 * M, filed: "2025-02-01", form: "10-K", accn: "k" }] } } };
  const periods = [{ start: "2024-01-01", end: "2024-12-31" }];
  eq(tagsByIdentity(f, ["S", "T"], periods, undefined, ["GP"], ["COGS"])[0], "T", "the candidate equal to gross profit + cost leads, whatever the list order");
  eq(tagsByIdentity(f, ["S", "T"], periods, ["T"], ["GP"]), null, "the subtrahend orientation asks the other question — T − GP = 70 matches neither candidate — and stands aside");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-revenue cache pins")) {
  const at = (t, end) => { const g = buildGrid(loadFixture(t), null, 8); return { g, c: g.cols.find(c => c.period.end === end) }; };
  const gis = at("GIS", "2019-05-26"); eq(gis.c.v.revenue, 16865200000, "General Mills FY2019 revenue is $16.9bn"); ok(tagsOf(gis.g).every(t => t === R606), "and one concept across the sheet");
  const cepl = at("CEPL", "2026-03-31"); eq(cepl.c.v.revenue, 106004000, "Capstone FY2026 keeps `Revenues`, which closes its gross profit"); eq(cepl.g.cols.find(c => c.period.end === "2021-03-31").v.revenue, 67607000, "and FY2021 the 606 tag, which closed it then");
  const met = at("MET", "2025-12-31"); eq(met.c.meta.revenue.tag, "Revenues", "MetLife's newest column is `Revenues`");
  const usb = at("USB", "2025-12-31"); ok(tagsOf(usb.g).every(t => t !== "InterestAndDividendIncomeOperating"), "US Bancorp's row never carries gross interest income");
  const goog = buildGrid(loadFixture("GOOGL"), null, 8); ok(goog.ltmCols.every(c => c.v.revenue != null), "every Alphabet LTM column has revenue");
  const cost = buildGrid(loadFixture("COST"), null, 8); ok(cost.ltm && cost.ltm.v.revenue != null && cost.ltm.meta.revenue.legTag === R606, "Costco's LTM revenue stitches from the 606 tag's interim legs");
  const cmcsa = buildGrid(loadFixture("CMCSA"), null, 8); ok(cmcsa.ltmCols.every(c => c.v.revenue != null), "every Comcast LTM column has revenue");
}

done("t-revenue");
