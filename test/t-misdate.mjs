// Rule 17, second clause — a filing is set aside for a year it does not present, or for a year it dates
// another year's figures to, and the sheet is rebuilt without it (`buildGrid` in grid.js; the recognisers
// in extract.js). Measured before it shipped over the 171 cached filers with a sheet: 44 contexts
// recognised on 26 filers, 33 more set aside by the repeat, at most 5 builds of one sheet, and 132 cells
// that move on the annual and LTM columns (76 values, 13 blanks, 43 re-sourced at the same figure), every
// one of them pinned below, and nothing else.
//
// Drives the SHIPPING extract and grid. The synthetic sheets S1-S19 are hand-built in the companyfacts
// shape, each named for the filer whose shape it carries, so every branch runs without the cache; the
// cache pins at the end skip cleanly without it. S5 (INSE) and S6 (AROW) are REPLICAS of shapes measured
// on populations whose payloads are not in this cache: their counts are the measured ones, their figures
// are not. Every synthetic filing carries the totals a real filing presents its own period with (revenue,
// operating income, net income and operating cash flow, in its own accession) unless its block says it is
// meant to be stray — without them the second test sets the filing's comparatives aside, which is what it
// did to t-splits' NVIDIA-shape fixture.
//
// The pins between the generated markers are generated mechanically from the measured full-diff:
// regenerate them, never edit one by hand. MISDATE_FAST=1 stops at the first failure and skips the two
// slow passes over the cache (the rebuild when a quote lands, and the nothing-else-moves diff).
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "./_t.mjs";
import { SET_ASIDE, misdatedContexts, anchorIndex, strayDuration, setAsideTip, SET_ASIDE_NOTE, describeSetAside } from "../src/extract.js";
import { buildGrid, buildSheet, STAND_DOWN_CAP } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { needFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

const FAST = process.env.MISDATE_FAST === "1";
const NAME = "t-misdate";
const show = x => (typeof x === "string" ? x : JSON.stringify(x));
const ok = (c, m) => { T.ok(c, m); if (!c && FAST) T.done(NAME); };
const eq = (a, b, m) => { const same = show(a) === show(b); T.eq(a, b, m); if (!same && FAST) T.done(NAME); };
const S = (name, fn) => { try { fn(); } catch (e) { ok(false, `${name} threw: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`); } };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = 1e6;
const LINES = SECTIONS.flatMap(s => s.lines);
const line = k => LINES.find(l => l.k === k);
const TAG = k => (/^[A-Z]/.test(k) ? k : line(k).tags[0]);
const FY = y => [`${y}-01-01`, `${y}-12-31`];
const Qtr = (y, q) => [`${y}-${String(3 * q - 2).padStart(2, "0")}-01`, new Date(Date.UTC(y, 3 * q, 0)).toISOString().slice(0, 10)];
const plus = (date, n) => new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10);

// ── A filing is a list of facts; a filer is a list of filings ───────────────────────────────────
function filing(form, filed, accn) {
  const facts = [], fp = /^10-K/.test(form) ? "FY" : "Q1";
  const api = {
    d(k, [start, end], val, unit = "USD") { facts.push({ tag: TAG(k), unit, f: { start, end, val, fy: +end.slice(0, 4), fp, filed, form, accn } }); return api; },
    i(k, end, val, unit = "USD") { facts.push({ tag: TAG(k), unit, f: { end, val, fy: +end.slice(0, 4), fp, filed, form, accn } }); return api; },
    // The totals a real filing presents a period with, in its own accession.
    own(p, s = 1, unit = "USD") { return api.d("revenue", p, 1000 * M * s, unit).d("ebit", p, 150 * M * s, unit).d("netIncome", p, 100 * M * s, unit).d("cfo", p, 130 * M * s, unit); },
    facts,
  };
  return api;
}
// A 10-K for fiscal year y presents y and the year before it.
const tenK = (y, filed = `${y + 1}-02-20`, accn = `k${y}`) => filing("10-K", filed, accn).own(FY(y), y - 2000).own(FY(y - 1), y - 2001);
function payload(...fls) {
  const facts = {};
  for (const fl of fls) for (const { tag, unit, f } of fl.facts) {
    facts[tag] = facts[tag] || { label: tag, units: {} };
    (facts[tag].units[unit] = facts[tag].units[unit] || []).push(f);
  }
  return { cik: "1", name: "X", sicCode: "3674", facts, filings: [] };
}
const build = (d, q = null) => buildGrid(d, q, 8);
const colAt = (g, end) => g.cols.find(c => c.period.end === end);
const ctxsOf = m => ((m && m.setAside && m.setAside.ctxs) || []).map(o => ({ form: o.form, filed: o.filed, why: o.why, value: o.value }));
const STRAY = (form, filed, v, y, end) => `${form === "10-Q" ? "The 10-Q" : `The ${form}`} filed ${filed} carries ${v} for FY${y} but no revenue, operating income, net income or cash-flow total for any period of two months to a year ending ${end} besides this figure, so it does not present the year`;
const PURITY = (filed, v, y, on) => `The 10-K filed ${filed} carries ${v} for FY${y}, but dates another year's figures to it: ${on} where earlier filings disagree with it, it carries the figure an earlier filing gave the year beside it`;

// ── S1, the Altria shape: a later 10-K tags an earlier year's deferred tax, presenting nothing then ──
// The FY2022 10-K presents 2022 and 2021 and also carries −95 for 2019; the FY2019 10-K, which presents
// 2019, carries −57. The newest pick is the stray one, so the year goes back to the 10-K that presents it.
S("S1", () => {
  const fl = [2019, 2020, 2021, 2022, 2023].map(y => tenK(y));
  fl[0].d("deferredTax", FY(2019), -57 * M);
  fl[3].d("deferredTax", FY(2019), -95 * M);
  const g = build(payload(...fl)), c = colAt(g, "2019-12-31"), m = c.meta.deferredTax;
  eq([c.v.deferredTax, m.status, m.accn], [-57 * M, "reported", "k2019"], "S1: FY2019 shows the presenting 10-K's −57, still reported");
  eq(ctxsOf(m), [{ form: "10-K", filed: "2023-02-20", why: "stray", value: -95 * M }], "S1: and carries a one-filing mark naming the 10-K it was read from before");
  eq(setAsideTip(m.setAside, { k: "deferredTax", fy: c.period.fy, fmt: null, ccy: g.ccy, source: "SRC" }),
    STRAY("10-K", "2023-02-20", "-95000000", 2019, "2019-12-31") + " and is not read here — SRC", "S1: the moved cell's tooltip, word for word, with one \"so\"");
  const ctx = (why, filed, value) => ({ why, form: "10-Q", filed, accn: `q-${filed}`, start: "2018-01-01", end: "2018-12-31", value, A: 0 });
  eq(setAsideTip({ ctxs: [ctx("stray", "2019-11-08", 3), ctx("repeat", "2019-08-07", 3), ctx("repeat", "2019-05-10", 3)], unit: "USD" }, { k: "revenue", fy: 2018, fmt: null, ccy: "USD", source: "SRC" }),
    STRAY("10-Q", "2019-11-08", "3", 2018, "2018-12-31") + "; also set aside, as not presenting the year: the 10-Q filed 2019-08-07, 3; the 10-Q filed 2019-05-10, 3. None is read here — SRC",
    "S1: a moved cell after more than one set-aside filing closes the list before the source, with no second \"so\" and no \"it\"");
  eq(SET_ASIDE_NOTE(g.cols, "deferredTax", null), "FY2019 is not read from the 10-K filed 2023-02-20, which does not present the year; it carried -95000000, and the figure shown is from the 10-K filed 2020-02-20.", "S1: the row note names the filing read instead");
  eq(g.standDown.builds, 2, "S1: one rebuild, and the repeat stops at the 10-K that presents the year");
});

// ── S2, the Interactive Brokers shape: a 10-K filed before the years it tags ─────────────────────
// The FY2017 10-K (filed 2018-03-01) tags amortisation for 2018-2020, a schedule, not a year presented;
// the FY2016 10-K tags 2018 and 2019. No 10-K for those years tags it at all.
let S3data = null;
S("S2", () => {
  const k16 = tenK(2016, "2017-03-01").d("amort", FY(2018), 9 * M).d("amort", FY(2019), 3 * M);
  const k17 = tenK(2017, "2018-03-01").d("amort", FY(2017), 20 * M).d("amort", FY(2018), 16 * M).d("amort", FY(2019), 10 * M).d("amort", FY(2020), 6 * M);
  const later = [2018, 2019, 2020].map(y => tenK(y, `${y + 1}-03-01`));
  const g = build(payload(k16, k17, ...later));
  const at = y => colAt(g, `${y}-12-31`).meta.amort;
  eq([2018, 2019, 2020].map(y => [colAt(g, `${y}-12-31`).v.amort ?? null, at(y).status]), [[null, SET_ASIDE], [null, SET_ASIDE], [null, SET_ASIDE]], "S2: all three years are blanks of their own kind");
  eq([2018, 2019, 2020].map(y => ctxsOf(at(y)).length), [2, 2, 1], "S2: chains of 2, 2 and 1");
  eq(ctxsOf(at(2018)), [{ form: "10-K", filed: "2018-03-01", why: "stray", value: 16 * M }, { form: "10-K", filed: "2017-03-01", why: "repeat", value: 9 * M }], "S2: the 2018 chain, newest first");
  eq([colAt(g, "2017-12-31").v.amort, !!colAt(g, "2017-12-31").meta.amort.setAside], [20 * M, false], "S2: the year the 10-K presents is untouched");
  eq(setAsideTip(at(2018).setAside, { k: "amort", fy: 2018, fmt: null, ccy: g.ccy }),
    "Set aside. " + STRAY("10-K", "2018-03-01", "16000000", 2018, "2018-12-31") + ". Also set aside, as not presenting the year: the 10-K filed 2017-03-01, 9000000. No other filing that is read carries this line for FY2018, so the cell is left blank.",
    "S2: the blank cell's tooltip, word for word");
  eq(SET_ASIDE_NOTE(g.cols, "amort", null),
    "FY2018 is set aside: the 10-K filed 2018-03-01 does not present the year, and the 1 earlier filing that carries it does not present it either; no other filing that is read carries it. "
    + "FY2019 is set aside: the 10-K filed 2018-03-01 does not present the year, and the 1 earlier filing that carries it does not present it either; no other filing that is read carries it. "
    + "FY2020 is set aside: the 10-K filed 2018-03-01 does not present the year; no other filing that is read carries it.", "S2: the row note names every column");
  eq(describeSetAside(g.cols, [line("amort")], null),
    "Set aside — a filing is not read for a year it does not present (no revenue, operating income, net income or cash-flow total for a period ending that date besides the figure itself), or for a year it dates another year's figures to. "
    + "FY2018, the 10-K filed 2018-03-01 (does not present the year; 1 earlier filing also set aside): Amortisation of intangibles 16000000 there, blank here. "
    + "FY2019, the 10-K filed 2018-03-01 (does not present the year; 1 earlier filing also set aside): Amortisation of intangibles 10000000 there, blank here. "
    + "FY2020, the 10-K filed 2018-03-01 (does not present the year): Amortisation of intangibles 6000000 there, blank here. Each cell shows the filing read instead, or is blank where none is left.",
    "S2: the workbook sentence names them, one item per column and filing");
  eq([g.standDown.recognised.length, g.standDown.setAside.length, g.standDown.builds], [3, 5, 3], "S2: 3 recognised, 2 more by the repeat, 3 builds");
});

// ── S3, the JPMorgan shape: a year's zero only in three 10-Qs, and a trailing twelve months on it ──
S("S3", () => {
  const ks = [2020, 2021, 2022].map(y => tenK(y));
  ks[0].d("impairment", FY(2020), 5 * M);
  const H1 = y => [`${y}-01-01`, `${y}-06-30`];
  const q1 = filing("10-Q", "2023-05-03", "q1").own(Qtr(2023, 1)).d("impairment", FY(2022), 0);
  const q2 = filing("10-Q", "2023-08-03", "q2").own(H1(2023)).own(H1(2022)).d("impairment", H1(2023), 0).d("impairment", H1(2022), 0).d("impairment", FY(2022), 0);
  const q3 = filing("10-Q", "2023-11-03", "q3").own(Qtr(2023, 3)).d("impairment", FY(2022), 0);
  const d = payload(...ks, q1, q2, q3);
  S3data = d;
  const g0 = buildSheet(d, null, 8);
  ok((g0.ltmCols || []).some(L => L.period.end === "2023-06-30" && L.v.impairment === 0), "S3: the sheet as first built has a twelve months to June 2023 reading the zero");
  const g = build(d), c = colAt(g, "2022-12-31"), m = c.meta.impairment;
  eq([c.v.impairment ?? null, m.status], [null, SET_ASIDE], "S3: FY2022 is set aside");
  eq(ctxsOf(m).map(o => `${o.filed} ${o.why}`), ["2023-11-03 stray", "2023-08-03 repeat", "2023-05-03 repeat"], "S3: a chain of all three 10-Qs, newest first");
  const L = (g.ltmCols || []).find(x => x.period.end === "2023-06-30"), lm = (L && L.meta.impairment) || {};
  eq([L && (L.v.impairment ?? null), lm.status, lm.setAside && lm.setAside.via, lm.setAside && lm.setAside.fy], [null, SET_ASIDE, "fy", 2022], "S3: the twelve months inherits the fiscal year's mark");
  ok(setAsideTip(lm.setAside, { k: "impairment", fy: 2023, fmt: null, ccy: g.ccy }).startsWith("The fiscal year this twelve months builds on (FY2022): Set aside. The 10-Q filed 2023-11-03 carries 0 for FY2022"), "S3: and its tooltip says which year it builds on");
});

// ── S4, the iQSTEL shape: a 10-K's comparative context carries the NEXT year's figures ──────────
// The FY2022 10-K dates 2021's revenue, cost of revenue and net income to 2020; the earlier 10-Ks agree on
// 2020, and each figure is the one they gave 2021. Diluted EPS is in that context and nowhere else.
S("S4", () => {
  const R = y => (y - 2017) * 10 * M;
  const yr = (fl, y, rv = R(y)) => fl.d("revenue", FY(y), rv).d("cogs", FY(y), 6 * rv / 10).d("ebit", FY(y), 2 * rv / 10).d("netIncome", FY(y), rv / 10).d("cfo", FY(y), 15 * rv / 100);
  const k = (y, filed) => yr(yr(filing("10-K", filed, `k${y}`), y), y - 1);
  const k22 = yr(filing("10-K", "2023-04-14", "k2022"), 2022)
    .d("revenue", FY(2020), R(2021)).d("cogs", FY(2020), 6 * R(2021) / 10).d("netIncome", FY(2020), R(2021) / 10).d("epsDil", FY(2020), 0.05, "USD/shares");
  const g = build(payload(k(2019, "2020-04-01"), k(2020, "2021-04-01"), k(2021, "2022-04-01"), k22));
  const c = colAt(g, "2020-12-31");
  eq(["revenue", "cogs", "netIncome"].map(x => [c.v[x], c.meta[x].accn, ctxsOf(c.meta[x]).map(o => o.why).join()]),
    [[R(2020), "k2021", "purity"], [6 * R(2020) / 10, "k2021", "purity"], [R(2020) / 10, "k2021", "purity"]], "S4: three rows go back to the earlier filings' figures, each marked");
  eq([c.v.epsDil ?? null, c.meta.epsDil.status], [null, SET_ASIDE], "S4: diluted EPS, carried only there, is set aside");
  eq(g.standDown.outvoted.map(o => [o.A, o.AC, o.nz, o.convicted]), [[3, 3, 3, true]], "S4: the first test's counts: 3 outvoted, all 3 land, on 3 tags");
  eq(setAsideTip(c.meta.revenue.setAside, { k: "revenue", fy: 2020, fmt: null, ccy: g.ccy, source: "SRC" }),
    PURITY("2023-04-14", "40000000", 2020, "on every one of the 3 lines") + ", so it is not read here — SRC", "S4: the moved cell's purity tooltip");
  eq(setAsideTip(c.meta.epsDil.setAside, { k: "epsDil", fy: 2020, fmt: null, ccy: g.ccy }),
    "Set aside. " + PURITY("2023-04-14", "0.05", 2020, "on every one of the 3 lines") + ". No other filing that is read carries this line for FY2020, so the cell is left blank.", "S4: the purity blank's tooltip");
  eq(SET_ASIDE_NOTE(g.cols, "epsDil", null), "FY2020 is set aside: the 10-K filed 2023-04-14 dates another year's figures to it; no other filing that is read carries it.", "S4: the purity blank's row note");
});
// The purity clause's count: "both" at two, never "1 lines".
S("purity wording", () => {
  const mk = A => ({ ctxs: [{ why: "purity", form: "10-K", filed: "2023-02-20", accn: "s", start: "2020-01-01", end: "2020-12-31", value: 5, A }], unit: "USD" });
  ok(setAsideTip(mk(2), { k: "x", fy: 2020 }).includes(": on both lines where"), "two lines read 'on both lines'");
  ok(!/\b1 lines\b/.test(setAsideTip(mk(1), { k: "x", fy: 2020 })), "one line never reads '1 lines'");
});

// ── S5-S8: the first test's counts, on the recogniser itself ────────────────────────────────────
// Three columns; the middle one read from filing "s" (filed 2023), which presents 2020 with two totals of
// its own. Each spec row: s = the figure s carries, e = an earlier filing's figure for 2020, n = the
// figure an earlier filing gave 2021 (the neighbour).
function recog(spec) {
  const facts = {}, put = (tag, unit, f) => { facts[tag] = facts[tag] || { label: tag, units: {} }; (facts[tag].units[unit] = facts[tag].units[unit] || []).push(f); };
  const P = { start: "2020-01-01", end: "2020-12-31" };
  const Sx = { accn: "s", form: "10-K", filed: "2023-02-20", fy: 2020, fp: "FY" }, E = { accn: "e", form: "10-K", filed: "2021-02-20", fy: 2020, fp: "FY" }, N = { accn: "n", form: "10-K", filed: "2022-02-20", fy: 2021, fp: "FY" };
  put("Revenues", "USD", { ...P, val: 7 * M, ...Sx });
  put("NetIncomeLoss", "USD", { ...P, val: 1 * M, ...Sx });
  const rows = [{ k: "revenue", tags: ["Revenues"], instant: false, latest: false, fetched: true }, { k: "netIncome", tags: ["NetIncomeLoss"], instant: false, latest: false, fetched: true }];
  const v = {}, meta = {};
  spec.forEach((x, i) => {
    const k = `r${i}`, tag = x.tag || `Tag${i}`, unit = x.unit || "USD";
    rows.push({ k, tags: [tag], instant: false, latest: !!x.latest, fetched: true });
    v[k] = x.s; meta[k] = { status: "reported", tag, unit, ...Sx, ...P };
    if (x.dup) return;
    put(tag, unit, { ...P, val: x.s, ...Sx });
    if ("e" in x) put(tag, unit, { ...(x.eShort ? { start: "2020-03-07", end: "2020-12-31" } : P), val: x.e, ...E, ...(x.eAt || {}) });
    if (x.agree) put(tag, unit, { ...P, val: x.s, ...E, accn: "e2", filed: "2021-06-01" });
    if ("n" in x) put(tag, unit, { start: "2021-01-01", end: "2021-12-31", val: x.n, ...N });
  });
  const cols = [2019, 2020, 2021].map(y => ({ period: { fy: y, start: `${y}-01-01`, end: `${y}-12-31` }, v: y === 2020 ? v : {}, meta: y === 2020 ? meta : {} }));
  const { found, outvoted } = misdatedContexts(cols, facts, rows);
  const o = outvoted.find(x => x.key === "s|2020-01-01..2020-12-31");
  return { stats: o ? { A: o.A, AC: o.AC, nz: o.nz, verdict: o.convicted } : null, found: [...found.values()].map(x => x.why) };
}
const lands = (s, e = s + M) => ({ s, e, n: s }), stays = (s, e = s + M) => ({ s, e });
S("S5-S8", () => {
  // S5, the INSE replica: 17 outvoted, 2 land, on 2 non-zero tags. Only "every" stops it.
  eq(recog([lands(11 * M), lands(12 * M), ...Array.from({ length: 15 }, (_, i) => stays((20 + i) * M))]), { stats: { A: 17, AC: 2, nz: 2, verdict: false }, found: [] }, "S5 (INSE replica): 17 outvoted, 2 land on 2 non-zero tags, no conviction");
  // S6, the AROW replica: 4 outvoted, 2 land, on EPS and one more tag.
  eq(recog([{ tag: "EarningsPerShareDiluted", unit: "USD/shares", s: 1.23, e: 1.1, n: 1.23 }, lands(5 * M), stays(6 * M), stays(8 * M)]), { stats: { A: 4, AC: 2, nz: 2, verdict: false }, found: [] }, "S6 (AROW replica): 4 outvoted, 2 land, no conviction");
  // S7, zeros.
  eq(recog([lands(0, 3 * M), lands(0, 4 * M), lands(5 * M)]), { stats: { A: 3, AC: 3, nz: 1, verdict: false }, found: [] }, "S7: every landing zero bar one is one non-zero tag, no conviction");
  eq(recog([lands(5 * M), lands(7 * M), stays(0, 9 * M)]), { stats: { A: 3, AC: 2, nz: 2, verdict: false }, found: [] }, "S7: a zero outvoted cell that lands nowhere stops it");
  eq(recog([lands(5 * M), lands(7 * M), lands(0, 9 * M)]), { stats: { A: 3, AC: 3, nz: 2, verdict: true }, found: ["purity"] }, "S7: two non-zero landings and a zero landing convict");
  // S8, one tag: two rows reading the same tag are one tag's evidence.
  eq(recog([{ tag: "Same", ...lands(5 * M) }, { tag: "Same", dup: true, s: 5 * M }]), { stats: { A: 2, AC: 2, nz: 1, verdict: false }, found: [] }, "S8: two cells of the same tag land, nz 1, no conviction");
  // What does not count as an earlier filing's word for the year.
  const three = x => [{ ...lands(5 * M), ...x }, { ...lands(6 * M), ...x }, { ...lands(7 * M), ...x }];
  eq(recog(three({ eAt: { filed: "2024-01-01" } })).stats, null, "a filing made AFTER the suspect is not an earlier one");
  eq(recog(three({ eAt: { accn: "s" } })).stats, null, "nor is the suspect's own accession");
  eq(recog(three({ latest: true })).stats, null, "a latest-value row is not counted");
  eq(recog(three({ eShort: true })).stats, null, "an earlier figure for a period shorter than a year is not the year's");
  eq(recog(three({ agree: true })).stats, null, "a cell is outvoted only when EVERY earlier filing disagrees with it");
  eq(recog(three({})).stats, { A: 3, AC: 3, nz: 3, verdict: true }, "and the same three cells, with nothing removed, convict");
});

// ── S9, an instant: a 10-Q carries the prior year-end balance sheet, and nothing at that date presents ──
// An instant is never set aside by the second test; the first sees it outvoted and landing nowhere.
S("S9", () => {
  const fl = [2019, 2020, 2021].map(y => tenK(y).i("totalAssets", `${y}-12-31`, (y - 2000) * 100 * M).i("totalAssets", `${y - 1}-12-31`, (y - 2001) * 100 * M));
  const q = filing("10-Q", "2022-05-10", "q1").own(Qtr(2022, 1)).i("totalAssets", "2022-03-31", 2250 * M).i("totalAssets", "2021-12-31", 2105 * M);
  const g = build(payload(...fl, q)), c = colAt(g, "2021-12-31");
  eq([c.v.totalAssets, c.meta.totalAssets.accn, !!c.meta.totalAssets.setAside, g.standDown.recognised.length], [2105 * M, "q1", false, 0], "S9: the 10-Q's year-end figure is shown, untouched");
  eq(g.standDown.outvoted.map(o => [o.key, o.A, o.AC]), [["q1|..2021-12-31", 1, 0]], "S9: the first test saw it, outvoted and landing nowhere");
});

// ── S10, the Axon shape: a 10-Q that does present the full year ─────────────────────────────────
// It carries the year's net income and operating cash flow (net income alone would make its own
// net-income cell stray, S12's rule), so its amortisation figure is read.
S("S10", () => {
  const fl = [2019, 2020, 2021].map(y => tenK(y));
  fl[2].d("amort", FY(2021), 30 * M);
  const q = filing("10-Q", "2022-05-10", "q1").own(Qtr(2022, 1)).d("amort", FY(2021), 31 * M).d("netIncome", FY(2021), 2100 * M).d("cfo", FY(2021), 2730 * M);
  const g = build(payload(...fl, q)), c = colAt(g, "2021-12-31");
  eq([c.v.amort, c.meta.amort.accn, !!c.meta.amort.setAside, g.standDown.recognised.length], [31 * M, "q1", false, 0], "S10: a 10-Q presenting the year is kept");
});

// ── S11, S12: the second test's edges, on the index itself ──────────────────────────────────────
S("S11-S12", () => {
  const one = (days, form = "10-Q", accn = "a", end = "2020-12-31", tags = ["NetIncomeLoss"]) => {
    const facts = {};
    for (const tag of tags) facts[tag] = { label: tag, units: { USD: [{ start: plus(end, -days), end, val: 1, form, accn, filed: "2021-02-01" }] } };
    return facts;
  };
  const stray = (facts, tag = "AmortizationOfIntangibleAssets") => strayDuration(anchorIndex(facts, ["Revenues", "NetIncomeLoss"]), { accn: "a", end: "2020-12-31", tag });
  eq([59, 60, 400, 401].map(n => stray(one(n))), [true, false, false, true], "S11: an anchor of 59 days does not present the year, 60 and 400 do, 401 does not");
  ok(stray(one(365, "8-K")), "S11: nor does an anchor in a filing that is not periodic");
  ok(stray(one(365, "10-Q", "b")), "S11: nor another filing's anchor");
  ok(stray(one(365, "10-Q", "a", "2020-09-30")), "S11: nor an anchor ending another date");
  ok(stray(one(365, "10-Q", "a", "2020-12-31", ["Revenues"]), "Revenues"), "S12: a filing carrying only revenue does not present revenue");
  ok(!stray(one(365, "10-Q", "a", "2020-12-31", ["Revenues", "NetIncomeLoss"]), "Revenues"), "S12: with net income beside it, it does");
});
// S12 through the sheet, and the same-value re-source, which moves the source and carries no mark.
S("S12", () => {
  const run = rev => {
    const fl = [2019, 2020, 2021].map(y => tenK(y));
    const q = filing("10-Q", "2022-05-10", "q1").own(Qtr(2022, 1)).d("revenue", FY(2021), rev);
    return build(payload(...fl, q));
  };
  const g = run(21500 * M), c = colAt(g, "2021-12-31");
  eq([c.v.revenue, c.meta.revenue.accn, ctxsOf(c.meta.revenue)], [21000 * M, "k2021", [{ form: "10-Q", filed: "2022-05-10", why: "stray", value: 21500 * M }]], "S12: a 10-Q's lone revenue figure is set aside; the 10-K's is shown, marked");
  const h = run(21000 * M), e = colAt(h, "2021-12-31");
  eq([e.v.revenue, e.meta.revenue.accn, e.meta.revenue.status, !!e.meta.revenue.setAside, h.standDown.setAside.length], [21000 * M, "k2021", "reported", false, 1], "same figure: re-sourced to the 10-K, no mark");
  eq(SET_ASIDE_NOTE(h.cols, "revenue", null), "", "same figure: no row note");
});

// ── S13: stray, stray, then a presenting 10-K: the repeat stops there and never marks it ─────────
S("S13", () => {
  const fl = [2019, 2020, 2021].map(y => tenK(y));
  fl[2].d("amort", FY(2021), 5 * M);
  const qa = filing("10-Q", "2022-05-10", "qa").own(Qtr(2022, 1)).d("amort", FY(2021), 6 * M);
  const qb = filing("10-Q", "2022-08-10", "qb").own(Qtr(2022, 2)).d("amort", FY(2021), 7 * M);
  const g = build(payload(...fl, qa, qb)), c = colAt(g, "2021-12-31");
  eq([c.v.amort, c.meta.amort.accn, g.standDown.builds], [5 * M, "k2021", 3], "S13: the 10-K's figure, after 3 builds");
  eq(ctxsOf(c.meta.amort).map(o => `${o.filed} ${o.why} ${o.value}`), [`2022-08-10 stray ${7 * M}`, `2022-05-10 repeat ${6 * M}`], "S13: the chain names both 10-Qs and not the 10-K");
});

// ── S14: thirteen stray filings in a chain: the cap holds, nothing throws ───────────────────────
S("S14", () => {
  const fl = [2019, 2020, 2021].map(y => tenK(y));
  fl[2].d("amort", FY(2021), 5 * M);
  const qs = Array.from({ length: 13 }, (_, i) => {
    const p = Qtr(2022 + Math.floor(i / 4), i % 4 + 1);
    return filing("10-Q", plus(p[1], 40), `q${i}`).own(p).d("amort", FY(2021), (100 + i) * M);
  });
  const g = build(payload(...fl, ...qs)), c = colAt(g, "2021-12-31"), sa = c.meta.amort.setAside;
  eq([g.standDown.capped, g.standDown.builds, STAND_DOWN_CAP + 1], [true, STAND_DOWN_CAP + 1, 13], "S14: the repeat stops at the cap");
  eq([c.v.amort, c.meta.amort.accn], [100 * M, "q0"], "S14: the sheet is the last build, which still reads the oldest stray");
  eq([sa.ctxs.length, sa.ctxs.some(o => o.accn === "q0")], [12, false], "S14: and marks only the twelve it was built without");
});

// ── S15: what the page does with it, read as source ─────────────────────────────────────────────
S("S15", () => {
  const app = readFileSync(join(root, "src/App.jsx"), "utf8");
  for (const n of ["SET_ASIDE", "setAsideTip", "SET_ASIDE_NOTE", "describeSetAside"])
    ok(new RegExp(`import\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*from\\s*"\\./extract(\\.js)?"`).test(app), `App imports ${n} from extract.js`);
  ok(app.includes("x.m.status === SET_ASIDE ? <span") && app.includes(">set aside</span>"), "the blank cell says 'set aside'");
  ok(app.includes("x.m.setAside ? setAsideTip(x.m.setAside, {"), "every marked cell's tooltip is the set-aside one");
  ok(app.includes("<b style={{ color: C.bronze }}>set aside</b> — on a cell: a filing that does not present this year, or that dates another year's figures to it, is not read for it; the cell's tooltip and the row's note name it"), "the legend line, word for word");
  ok(/const saNote = SET_ASIDE_NOTE\(grid\.cols, line\.k, display\);/.test(app) && app.includes("{saNote && <div style={NOTE_STYLE}>{saNote}</div>}"), "the row note is computed and rendered");
  ok(app.includes("newest.m.status !== SET_ASIDE"), "and the blank note, untrue there, is not");
  ok(/const saLine = describeSetAside\(grid\.cols, sec\.lines, display\);\s*if \(saLine\) rows\.push\(\[\{ v: saLine, s: XF\.MUTED \}\]\);/.test(app), "the workbook carries the sentence per section");
  ok(/const saLine = describeSetAside\(grid\.cols, secs\.flatMap\(s => s\.lines\), display\);\s*if \(saLine\) out\.push\(saLine\);/.test(app), "the TSV carries it over the copied tab");
  ok(/basis === "ltm" \? \{ \[SET_ASIDE\]: \(tic, lines\) =>/.test(app), "Comps explains a set-aside gap on the LTM basis");
});

// ── S16, the BetterLife shape: the blank's other currency survives ──────────────────────────────
// A CAD sheet. FY2012's net income is filed in CAD only by a later 10-K that presents 2013, not 2012; three
// filings carry it in USD, which this sheet does not read.
S("S16", () => {
  const k12 = filing("10-K", "2013-04-20", "k2012").own(FY(2012), 12);
  const k12a = filing("10-K/A", "2013-06-20", "k2012a").own(FY(2012), 12);
  const q13 = filing("10-Q", "2013-08-14", "q2013").own(Qtr(2013, 2)).d("netIncome", FY(2012), 1200 * M);
  const sx = filing("10-K", "2014-05-16", "sx").own(FY(2013), 13, "CAD").d("netIncome", FY(2012), 1417734, "CAD");
  const k14 = filing("10-K", "2015-04-20", "k2014").own(FY(2014), 14, "CAD").own(FY(2013), 13, "CAD");
  const g = build(payload(k12, k12a, q13, sx, k14)), c = colAt(g, "2012-12-31"), m = c.meta.netIncome, sa = m.setAside || {};
  eq([g.ccy, c.v.netIncome ?? null, m.status, sa.otherCcy, sa.otherCcyFilings], ["CAD", null, SET_ASIDE, "USD", 3], "S16: set aside, and the mark keeps the other currency and its 3 filings");
  eq(setAsideTip(sa, { k: "netIncome", fy: 2012, fmt: null, ccy: g.ccy }),
    "Set aside. " + STRAY("10-K", "2014-05-16", "1417734", 2012, "2012-12-31") + ". 3 other filings carry this line for FY2012 in USD, which this CAD sheet does not read, so the cell is left blank.", "S16: the other-currency tail");
  eq(SET_ASIDE_NOTE(g.cols, "netIncome", null), "FY2012 is set aside: the 10-K filed 2014-05-16 does not present the year; the other filings carry it only in USD.", "S16: the other-currency row note");
  ok(describeSetAside(g.cols, [line("netIncome")], null).includes("Net income 1417734 there, blank here (filed in USD only)."), "S16: the workbook says so too");
});

// ── S17-S19: a header that moves returns the sheet as first built ───────────────────────────────
// S17: the oldest column's only figure is a stray one; built without it, the column goes.
S("S17", () => {
  const fl = [2018, 2019, 2020, 2021].map(y => tenK(y));
  const q = filing("10-Q", "2022-05-10", "q1").own(Qtr(2022, 1)).d("revenue", FY(2016), 777 * M);
  const d = payload(...fl, q), s = buildSheet(d, null, 8), g = build(d);
  ok(!!colAt(s, "2016-12-31"), "S17: the sheet as first built has a column only the stray figure holds");
  eq([g.standDown.skipped, g.standDown.setAside, g.standDown.recognised.length], ["calendar", [], 1], "S17: the column would go, so nothing is set aside: skipped 'calendar'");
  ok(isDeepStrictEqual(g.cols, s.cols), "S17: and the sheet is the one first built");
});
// S18, a split witnessed only by a set-aside context: the NVIDIA shape, MEANT to be stray — each 10-K
// carries revenue for its own year only, so its comparatives (net income, EPS, shares) present nothing.
// Built without them, both splits lose their witnesses (rule 31).
S("S18", () => {
  const K = (y, val, filed) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, fy: y, fp: "FY", filed, form: "10-K", accn: `k-${filed}` });
  const tagOf = (unit, facts) => ({ label: "x", units: { [unit]: facts } });
  const eps0 = { 2018: 0.166, 2019: 0.113, 2020: 0.173, 2021: 0.385, 2022: 0.17, 2023: 1.19, 2024: 2.94, 2025: 4.90 };
  const sh0 = { 2018: 24514, 2019: 24720, 2020: 25100, 2021: 25350, 2022: 25070, 2023: 24940, 2024: 24804, 2025: 24514 };
  const basis = filed => (filed < "2022-02-01" ? 40 : filed < "2025-02-01" ? 10 : 1);
  const eps = [], ni = [], sh = [], years = Object.keys(eps0).map(Number);
  for (const y of years) for (const fy of [y, y + 1, y + 2]) {
    if (fy > 2025) continue;
    const filed = `${fy + 1}-02-20`, b = basis(filed);
    eps.push(K(y, +(eps0[y] * b).toFixed(2), filed)); ni.push(K(y, 1000 * M * (y - 2010), filed)); sh.push(K(y, Math.round(sh0[y] * M / b), filed));
  }
  const d = { cik: "1", name: "X", sicCode: "3674", filings: [], facts: { Revenues: tagOf("USD", years.map(y => K(y, 1000 * M, `${y + 1}-02-20`))), NetIncomeLoss: tagOf("USD", ni),
    EarningsPerShareDiluted: tagOf("USD/shares", eps), WeightedAverageNumberOfDilutedSharesOutstanding: tagOf("shares", sh) } };
  const s = buildSheet(d, null, 8), g = build(d);
  ok(g.standDown.recognised.length > 0, "S18: the comparatives are recognised as stray");
  eq([g.standDown.skipped, g.standDown.setAside], ["splits", []], "S18: built without them the splits would go, so nothing is set aside: skipped 'splits'");
  eq([g.splits.length, show(g.splits)], [2, show(s.splits)], "S18: both split events intact");
  ok(isDeepStrictEqual(g.cols, s.cols), "S18: every cell is the sheet first built");
  const q2 = { price: 50 }, g2 = build(d, q2), s2 = buildSheet(d, q2, 8);
  eq([g2.standDown.skipped, g2.splits.length], ["splits", 2], "S18: built again when a quote lands, the memo returns the same sheet");
  ok(isDeepStrictEqual(g2.cols, s2.cols), "S18: and it is the sheet first built with that quote");
});
// S19, a currency drift: the newest year's revenue is filed in EUR only by five 10-Qs that do not present
// the year, against the 10-K's USD. The sheet as first built reads EUR; built without them, USD.
S("S19", () => {
  const fl = [2019, 2020, 2021].map(y => tenK(y));
  const qs = [[2022, 1], [2022, 2], [2022, 3], [2023, 1], [2023, 2]].map(([y, q], i) => {
    const p = Qtr(y, q);
    return filing("10-Q", plus(p[1], 40), `e${i}`).own(p).d("revenue", FY(2021), (900 + i) * M, "EUR");
  });
  const d = payload(...fl, ...qs), s = buildSheet(d, null, 8), g = build(d);
  eq(s.ccy, "EUR", "S19: the sheet as first built reads EUR");
  eq([g.standDown.skipped, g.standDown.setAside, g.ccy], ["ccy", [], "EUR"], "S19: built without the strays it would read USD, so nothing is set aside: skipped 'ccy'");
  ok(isDeepStrictEqual(g.cols, s.cols), "S19: and the sheet is the one first built");
});

// ── S3 with no interim on file: the twelve months is the newest year carried, a copy made inside
// buildSheet before any mark, so it takes the year's marks again ──────────────────────────────────
S("S3, carried", () => {
  const ks = [2020, 2021, 2022].map(y => tenK(y));
  ks[0].d("impairment", FY(2020), 5 * M);
  const qs = [["2023-05-03", "q1"], ["2023-08-03", "q2"], ["2023-11-03", "q3"]].map(([filed, accn]) => filing("10-Q", filed, accn).d("impairment", FY(2022), 0));
  const g = build(payload(...ks, ...qs)), last = g.cols[g.cols.length - 1], m = last.meta.impairment || {};
  eq([last.period.end, g.ltmStitched, m.status], ["2022-12-31", false, SET_ASIDE], "S3, carried: the newest year is set aside, and no twelve months is stitched");
  ok(!!g.ltm && isDeepStrictEqual(g.ltm.meta.impairment, m), "S3, carried: the twelve months carried from it shows the same set-aside blank");
});

// ── S9 beside a stray: a filing is set aside for one context, its start and its end, never for every
// fact it dates to that day, so the same 10-Q's year-end balance sheet is still read ───────────────
S("S9, beside a stray", () => {
  const fl = [2019, 2020, 2021].map(y => tenK(y).i("totalAssets", y + "-12-31", (y - 2000) * 100 * M).i("totalAssets", (y - 1) + "-12-31", (y - 2001) * 100 * M));
  const q = filing("10-Q", "2022-05-10", "q1").own(Qtr(2022, 1)).i("totalAssets", "2022-03-31", 2250 * M).i("totalAssets", "2021-12-31", 2105 * M).d("deferredTax", FY(2021), -7 * M);
  const g = build(payload(...fl, q)), c = colAt(g, "2021-12-31");
  eq([c.meta.deferredTax.status, ctxsOf(c.meta.deferredTax).map(o => o.why)], [SET_ASIDE, ["stray"]], "S9, beside a stray: the 10-Q's annual deferred tax is set aside");
  eq([c.v.totalAssets, c.meta.totalAssets.accn, !!c.meta.totalAssets.setAside], [2105 * M, "q1", false], "S9, beside a stray: its year-end total assets, another context, is still read from it");
});

// ── S20, one filing with two contexts ending the same day: the repeat asks whether a filing presents the
// year of the PAYLOAD, never of the facts left once a context is set aside. The 10-Q's operating cash
// flow, the only total it carries for 2021, is stray and goes with its context; its deferred tax is also
// filed under a second context a day or two apart, which is read, and the payload's cash-flow total
// keeps that filing from reading as stray. Four sheets, both orders of the two facts and a second
// context either side, so whichever the first build reads, one of them reaches the repeat ────────────
S("S20", () => {
  const E = "2021-12-31", ks = [2020, 2021, 2022].map(y => tenK(y));
  const runs = [["2021-01-02", false], ["2021-01-02", true], ["2020-12-31", false], ["2020-12-31", true]].map(([s2, flip]) => {
    const q = filing("10-Q", "2023-05-03", "qb").own(Qtr(2023, 1)).d("cfo", FY(2021), 777 * M);
    const two = [[FY(2021), -11 * M], [[s2, E], -13 * M]];
    for (const [p, v] of flip ? two.reverse() : two) q.d("deferredTax", p, v);
    return build(payload(...ks, q));
  });
  for (const g of runs) eq(g.standDown.setAside.map(x => x.key), ["qb|2021-01-01.." + E], "S20: only the stray context is set aside");
  ok(runs.some(g => !!(colAt(g, E).meta.deferredTax || {}).setAside), "S20: and on at least one sheet the deferred tax moved to the second context, so the repeat tested it");
});

// ── The memo, and the payload, on a synthetic (CI has no cache) ─────────────────────────────────
S("memo", () => {
  const d = S3data, before = JSON.stringify(d);
  const g1 = build(d), q = { price: 100 }, warm = build(d, q), fresh = build(structuredClone(d), q);
  ok(isDeepStrictEqual(warm, fresh), "a sheet rebuilt when the quote lands equals one built fresh with it");
  eq(show(fresh.standDown.setAside), show(g1.standDown.setAside), "what is set aside does not depend on the quote");
  eq(JSON.stringify(d), before, "the payload is never touched");
});

// ── The cache pins ───────────────────────────────────────────────────────────────────────────────
// ---- generated pins: begin (regenerate; never edit by hand) ----
// [t, col, k, from, to, status, accn shown]  — a value moved, or the cell went blank (status set-aside)
const CHANGED = [
  ["BAC","A2019-12-31","impairment",2100000000,null,"set-aside",null],
  ["BETRF","A2012-01-31","netIncome",1417734,null,"set-aside",null],
  ["BNC","A2018-12-31","rnd",32000,317713,"reported","0001493152-20-004569"],
  ["CVX","A2021-12-31","optionsOut",25265000,77399000,"reported","0000093410-23-000009"],
  ["CVX","A2021-12-31","optionsStrike",114.61,108.1,"reported","0000093410-23-000009"],
  ["DLR","A2018-12-31","rentalRevenue",3000000000,2412076000,"reported","0001297996-19-000032"],
  ["IBKR","A2018-12-31","amort",16000000,null,"set-aside",null],
  ["IBKR","A2019-12-31","amort",10000000,null,"set-aside",null],
  ["IBKR","A2020-12-31","amort",3000000,null,"set-aside",null],
  ["IQST","A2019-12-31","debtIssued",2544250,null,"set-aside",null],
  ["IQST","A2020-12-31","revenue",64702018,44910006,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","cogs",63168303,43947654,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","grossProfit",1533715,962352,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","ga",4517631,4174367,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","totalOpex",4517631,4174367,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","ebit",-2983916,-3212015,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","da",91474,68602,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","sbc",1284325,697858,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","otherInc",2684,-117562,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","pretax",-3864001,-6699330,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","netIncome",-3837773,-6573891,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","nci",-26228,-125591,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","cfDa",91474,68602,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","chgAr",39862,-167077,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","cfo",-3152181,-2116174,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","capex",153183,90192,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","acquisitions",60000,-15781,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","cfi",-511348,-91211,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","cff",6250980,2662756,"reported","0001663577-22-000244"],
  ["IQST","A2020-12-31","epsDil",-0.03,null,"set-aside",null],
  ["IQST","A2020-12-31","wasoDil",135383893,null,"set-aside",null],
  ["JNJ","A2025-12-28","acquisitions",17500000000,17541000000,"reported","0000200406-26-000016"],
  ["JPM","A2020-12-31","impairment",0,null,"set-aside",null],
  ["JPM","A2021-12-31","impairment",0,null,"set-aside",null],
  ["JPM","A2022-12-31","impairment",0,null,"set-aside",null],
  ["MO","A2018-12-31","deferredTax",-95000000,-57000000,"reported","0000764180-21-000037"],
  ["MO","A2019-12-31","deferredTax",-164000000,-95000000,"reported","0000764180-22-000019"],
  ["MO","A2020-12-31","deferredTax",-1160000000,-164000000,"reported","0000764180-23-000020"],
  ["NRDE","A2021-12-31","amort",11100000,11111000,"reported","0001558370-23-002862"],
  ["SLB","A2021-12-31","ppe",6607000000,6429000000,"reported","0001564590-23-000762"],
  ["SLB","A2021-12-31","ppeGross",28386000000,29077000000,"reported","0001564590-23-000762"],
  ["SLB","A2021-12-31","accumDep",21779000000,22648000000,"reported","0001564590-23-000762"],
  ["WBD","A2024-12-31","impairment",9100000000,9147000000,"reported","0001437107-25-000031"],
];
// [t, col, k, value, accession before, accession after]  — re-sourced at the same figure, carrying no mark
const RESOURCED = [
  ["APO","A2025-12-31","dps",1.99,"0001858681-26-000040","0001858681-26-000013"],
  ["BHIC","A2023-12-31","amort",0,"0001185185-25-001545","0001185185-25-000176"],
  ["BHIC","A2024-12-31","amort",0,"0001185185-26-001775","0001185185-26-001133"],
  ["CGBD","A2020-12-31","wasoBasic",56421137,"0001544206-26-000013","0001544206-23-000010"],
  ["CGBD","A2021-12-31","wasoBasic",54244432,"0001544206-26-000013","0001544206-24-000012"],
  ["CGBD","A2022-12-31","wasoBasic",52112420,"0001544206-26-000013","0001544206-25-000011"],
  ["CVX","A2021-12-31","cash",5640000000,"0000093410-24-000013","0000093410-23-000088"],
  ["DIS","A2021-10-02","netIncome",1995000000,"0001744489-24-000064","0001744489-23-000216"],
  ["EA","A2022-03-31","netIncome",789000000,"0001308179-26-000382","0000712515-24-000023"],
  ["EA","A2023-03-31","netIncome",802000000,"0001308179-26-000382","0000712515-25-000022"],
  ["EA","A2024-03-31","netIncome",1273000000,"0001308179-26-000382","0001628280-26-033617"],
  ["EA","A2025-03-31","netIncome",1121000000,"0001308179-26-000382","0001628280-26-033617"],
  ["EA","A2026-03-31","netIncome",887000000,"0001308179-26-000382","0001628280-26-033617"],
  ["ETN","A2020-12-31","otherOpex",214000000,"0001551182-24-000006","0001551182-23-000004"],
  ["ETN","A2020-12-31","restructuring",214000000,"0001551182-24-000006","0001551182-23-000004"],
  ["ETN","A2024-12-31","otherOpex",202000000,"0001551182-26-000030","0001551182-26-000007"],
  ["ETN","A2024-12-31","restructuring",202000000,"0001551182-26-000030","0001551182-26-000007"],
  ["ETN","A2025-12-31","otherOpex",133000000,"0001551182-26-000030","0001551182-26-000007"],
  ["ETN","A2025-12-31","restructuring",133000000,"0001551182-26-000030","0001551182-26-000007"],
  ["JBTM","A2019-12-31","impairment",0,"0001433660-20-000033","0001433660-20-000008"],
  ["JPM","A2019-12-31","impairment",0,"0000019617-20-000438","0000019617-20-000257"],
  ["MLR","A2019-12-31","epsDil",3.43,"0001558370-23-003178","0000924822-22-000013"],
  ["MLR","A2019-12-31","wasoDil",11400000,"0001558370-23-003178","0000924822-22-000013"],
  ["MO","A2025-12-31","amort",132000000,"0000764180-26-000094","0000764180-26-000017"],
  ["MO","A2025-12-31","impairment",1158000000,"0000764180-26-000094","0000764180-26-000017"],
  ["PLD","A2018-12-31","gainOnPropertySale",635900000,"0001564590-19-025364","0001564590-19-002872"],
  ["SOLV","A2024-12-31","otherOpex",62000000,"0001964738-25-000091","0001964738-25-000019"],
  ["SOLV","A2024-12-31","restructuring",62000000,"0001964738-25-000091","0001964738-25-000019"],
  ["SUNB","A2026-04-30","impairment",0,"0001628280-26-061146","0001628280-26-044888"],
  ["TKLS","A2024-12-31","debtIssued",130000,"0001477932-26-005170","0001477932-26-003397"],
  ["WYGC","A2025-12-31","revenue",24627,"0001493152-26-024540","0001493152-26-021866"],
];
// [t, col, k, from, to, status]  — derived annual, LTM (L) and headline (N) cells that move with them
const DERIVED = [
  ["BETRF","A2012-01-31","roe",-1.3850969603238883,null,"computed"],
  ["DLR","A2018-12-31","noi",2042935000,1455011000,"computed"],
  ["DLR","A2018-12-31","noiMargin",0.6809783333333334,0.6032193844638395,"computed"],
  ["IQST","A2020-12-31","chgNwc",1437003,-1178786,"computed"],
  ["IQST","A2020-12-31","ebitda",-2892442,-3143413,"computed"],
  ["IQST","A2020-12-31","ebitdaSbc",-4176767,-3841271,"computed"],
  ["IQST","A2020-12-31","grossMargin",0.023704283844748087,0.02142845405097474,"computed"],
  ["IQST","A2020-12-31","ebitdaMargin",-0.044704046170553756,-0.06999360008992206,"computed"],
  ["IQST","A2020-12-31","ebitMargin",-0.0461178196945882,-0.07152114386268396,"computed"],
  ["IQST","A2020-12-31","netMargin",-0.059314579647268495,-0.1463792055605604,"computed"],
  ["IQST","A2020-12-31","fcf",-3305364,-2206366,"computed"],
  ["IQST","A2020-12-31","fcfMargin",-0.05108594912758362,-0.049128606217509745,"computed"],
  ["IQST","A2020-12-31","fcfConv",0.8612713675352868,0.33562558308313906,"computed"],
  ["IQST","A2020-12-31","taxRate",-0.000039337463939579726,-0.000022688836047783884,"computed"],
  ["IQST","A2020-12-31","intCover",-0.8242165226740314,-0.895732025806687,"computed"],
  ["IQST","A2020-12-31","fccr",-0.8678668221762431,-0.9214327093858274,"computed"],
  ["IQST","A2020-12-31","nopat",-2984033.3796880487,-3212087.8768817177,"computed"],
  ["IQST","A2020-12-31","roic",5.541967078572939,5.965511441102805,"computed"],
  ["IQST","A2020-12-31","roe",2.7638211835874906,4.73427146535117,"computed"],
  ["IQST","A2020-12-31","roa",-0.6448123725273519,-1.1045276133961561,"computed"],
  ["IQST","A2020-12-31","assetTurn",10.871060308644475,7.54565929748258,"computed"],
  ["IQST","A2020-12-31","dso",14.2628807188054,20.548586989723404,"computed"],
  ["IQST","A2020-12-31","dpo",15.817347744801692,22.735116076958285,"computed"],
  ["IQST","A2020-12-31","ccc",-1.554467025996292,-2.186529087234881,"computed"],
  ["IQST","A2020-12-31","nwcPctRev",-0.037378231386847934,-0.05385096140935719,"computed"],
  ["IQST","A2020-12-31","capexPctRev",0.002367515028665721,0.0020082829648252554,"computed"],
  ["IQST","A2020-12-31","daPctRev",0.0014137735240344436,0.0015275437727619097,"computed"],
  ["IQST","A2020-12-31","sbcPctRev",0.019849844559716823,0.015539031546778239,"computed"],
  ["IQST","A2020-12-31","ufcf",-4482745.379688049,-2054891.8768817177,"computed"],
  ["IQST","A2020-12-31","revGrowth",2.5882675186844746,1.4906350802493495,"computed"],
  ["IQST","A2020-12-31","ebitdaGrowth",3.6134247370654045,4.013721724761628,"computed"],
  ["IQST","A2021-12-31","revGrowth",0,0.44070383780398514,"computed"],
  ["IQST","A2021-12-31","ebitdaGrowth",0,-0.07984028824720135,"computed"],
  ["IQST","A2023-12-31","revCagr3",0.30713074237736415,0.47630899755549305,"computed"],
  ["IQST","A2025-12-31","revCagr5",0.37404433213,0.47814040167231653,"computed"],
  ["JNJ","L2026-06-28","acquisitions",3305000000,3346000000,"ltm"],
  ["JNJ","N2026-06-28","acquisitions",3305000000,3346000000,"ltm"],
  ["JPM","L2023-06-30","impairment",0,null,"set-aside"],
  ["MO","A2018-12-31","currentTaxRate",0.26431859543946046,0.26025050851086606,"computed"],
  ["MO","A2019-12-31","currentTaxRate",2.9086161879895562,2.818537859007833,"computed"],
  ["MO","A2020-12-31","currentTaxRate",0.5219158200290276,0.37735849056603776,"computed"],
  ["NRDE","A2021-12-31","da",11100000,11111000,"computed"],
  ["NRDE","A2021-12-31","ebitda",-389389000,-389378000,"computed"],
  ["NRDE","A2021-12-31","ebitdaSbc",-408078000,-408067000,"computed"],
  ["NRDE","A2021-12-31","ufcf",-725014000,-725003000,"computed"],
  ["NRDE","A2021-12-31","ebitdaGrowth",2.806976721449312,2.8068691766960296,"computed"],
  ["NRDE","A2022-12-31","ebitdaGrowth",-0.005354542629606884,-0.005326443712793227,"computed"],
];
// [t, col, k, accession before, accession after]  — LTM cells re-sourced at the same figure
const LTM_MOVES = [
  ["APO","L2026-06-30","dps","0001858681-26-000040","0001858681-26-000013"],
  ["CGBD","L2023-06-30","wasoBasic","0001544206-26-000013","0001544206-25-000011"],
  ["EA","L2023-06-30","netIncome","0001308179-26-000382","0000712515-25-000022"],
  ["EA","L2024-06-30","netIncome","0001308179-26-000382","0001628280-26-033617"],
  ["EA","L2025-06-30","netIncome","0001308179-26-000382","0001628280-26-033617"],
  ["EA","L2026-06-30","netIncome","0001308179-26-000382","0001628280-26-033617"],
  ["ETN","L2025-06-30","otherOpex","0001551182-26-000030","0001551182-26-000007"],
  ["ETN","L2025-06-30","restructuring","0001551182-26-000030","0001551182-26-000007"],
  ["ETN","L2026-06-30","otherOpex","0001551182-26-000030","0001551182-26-000007"],
  ["ETN","L2026-06-30","restructuring","0001551182-26-000030","0001551182-26-000007"],
  ["MO","L2026-06-30","amort","0000764180-26-000094","0000764180-26-000017"],
  ["MO","L2026-06-30","impairment","0000764180-26-000094","0000764180-26-000017"],
];
// [t, col, k, chain length, first filing's form, its filing date, its test]
const CHAINS = [
  ["BAC","A2019-12-31","impairment",2,"10-Q","2020-07-31","stray"],
  ["BETRF","A2012-01-31","netIncome",1,"10-K","2014-05-16","stray"],
  ["BNC","A2018-12-31","rnd",1,"10-K","2021-03-24","stray"],
  ["CVX","A2021-12-31","optionsOut",1,"10-K","2024-02-26","purity"],
  ["CVX","A2021-12-31","optionsStrike",1,"10-K","2024-02-26","purity"],
  ["DLR","A2018-12-31","rentalRevenue",3,"10-Q","2019-11-08","stray"],
  ["IBKR","A2018-12-31","amort",3,"10-K","2018-03-01","stray"],
  ["IBKR","A2019-12-31","amort",2,"10-K","2018-03-01","stray"],
  ["IBKR","A2020-12-31","amort",1,"10-K","2018-03-01","stray"],
  ["IQST","A2019-12-31","debtIssued",4,"10-Q","2021-05-14","stray"],
  ["IQST","A2020-12-31","revenue",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","cogs",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","grossProfit",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","ga",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","totalOpex",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","ebit",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","da",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","sbc",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","otherInc",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","pretax",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","netIncome",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","nci",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","cfDa",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","chgAr",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","cfo",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","capex",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","acquisitions",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","cfi",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","cff",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","epsDil",1,"10-K","2023-04-14","purity"],
  ["IQST","A2020-12-31","wasoDil",1,"10-K","2023-04-14","purity"],
  ["JNJ","A2025-12-28","acquisitions",1,"10-Q","2026-04-22","stray"],
  ["JPM","A2020-12-31","impairment",3,"10-Q","2021-11-02","stray"],
  ["JPM","A2021-12-31","impairment",3,"10-Q","2022-11-03","stray"],
  ["JPM","A2022-12-31","impairment",1,"10-Q","2023-05-03","stray"],
  ["MO","A2018-12-31","deferredTax",1,"10-K","2022-02-25","stray"],
  ["MO","A2019-12-31","deferredTax",1,"10-K","2023-02-27","stray"],
  ["MO","A2020-12-31","deferredTax",1,"10-K","2024-02-27","stray"],
  ["NRDE","A2021-12-31","amort",1,"10-Q","2023-05-04","stray"],
  ["SLB","A2021-12-31","ppe",1,"10-Q","2023-04-26","purity"],
  ["SLB","A2021-12-31","ppeGross",1,"10-Q","2023-04-26","purity"],
  ["SLB","A2021-12-31","accumDep",1,"10-Q","2023-04-26","purity"],
  ["WBD","A2024-12-31","impairment",2,"10-Q","2025-11-06","stray"],
];
// [t, col, k, fiscal year the twelve months inherits from]
const LTM_MARKS = [
  ["JNJ","L2026-06-28","acquisitions",2025],
  ["JPM","L2023-06-30","impairment",2022],
];
// ---- generated pins: end ----

if (needFixtures(`${NAME} cache pins`)) {
  const t0 = Date.now();
  const at = (g, col) => {
    const w = col[0], end = col.slice(1);
    if (w === "N") return g.ltm && g.ltm.period.end === end ? g.ltm : null;
    return (w === "A" ? g.cols : g.ltmCols || []).find(c => c.period.end === end) || null;
  };
  const V = (c, k) => (c ? c.v[k] ?? null : undefined), Mt = (c, k) => (c && c.meta && c.meta[k]) || {};
  const pinsBy = new Map(), add = (t, f) => { if (!pinsBy.has(t)) pinsBy.set(t, []); pinsBy.get(t).push(f); };
  for (const [t, col, k, from, to, status, accn] of CHANGED) add(t, (s, g) => {
    const a = at(s, col), b = at(g, col), m = Mt(b, k);
    ok(V(a, k) === from, `${t} ${col} ${k}: the sheet as first built shows ${from} (got ${V(a, k)})`);
    ok(V(b, k) === to && m.status === status && (accn == null || m.accn === accn), `${t} ${col} ${k}: shows ${to} ${status} ${accn} (got ${V(b, k)} ${m.status} ${m.accn})`);
    ok(!!m.setAside && m.setAside.ctxs[0].value === from, `${t} ${col} ${k}: the mark names the figure it carried, ${from}`);
  });
  for (const [t, col, k, v, a0, a1] of RESOURCED) add(t, (s, g) => {
    const a = at(s, col), b = at(g, col), ma = Mt(a, k), mb = Mt(b, k);
    ok(V(a, k) === v && ma.accn === a0 && V(b, k) === v && mb.accn === a1 && mb.status === ma.status && !mb.setAside,
      `${t} ${col} ${k}: re-sourced at ${v} from ${a0} to ${a1}, no mark (got ${V(a, k)} ${ma.accn} -> ${V(b, k)} ${mb.accn} ${mb.status} ${!!mb.setAside})`);
  });
  for (const [t, col, k, from, to, status] of DERIVED) add(t, (s, g) => {
    const a = at(s, col), b = at(g, col), m = Mt(b, k);
    ok(V(a, k) === from && V(b, k) === to && m.status === status, `${t} ${col} ${k}: ${from} -> ${to} [${status}] (got ${V(a, k)} -> ${V(b, k)} [${m.status}])`);
  });
  for (const [t, col, k, a0, a1] of LTM_MOVES) add(t, (s, g) => {
    const a = at(s, col), b = at(g, col), ma = Mt(a, k), mb = Mt(b, k);
    ok(V(a, k) === V(b, k) && V(a, k) !== undefined && ma.accn === a0 && mb.accn === a1 && !mb.setAside, `${t} ${col} ${k}: the LTM re-sourced from ${a0} to ${a1} (got ${ma.accn} -> ${mb.accn})`);
  });
  for (const [t, col, k, n, form, filed, why] of CHAINS) add(t, (s, g) => {
    const sa = Mt(at(g, col), k).setAside, c0 = sa && sa.ctxs[0];
    ok(!!c0 && sa.ctxs.length === n && c0.form === form && c0.filed === filed && c0.why === why, `${t} ${col} ${k}: a chain of ${n} from the ${form} filed ${filed} [${why}] (got ${sa ? sa.ctxs.map(o => `${o.form} ${o.filed} ${o.why}`).join(" ; ") : "no mark"})`);
  });
  for (const [t, col, k, fy] of LTM_MARKS) add(t, (s, g) => {
    const sa = Mt(at(g, col), k).setAside;
    ok(!!sa && sa.via === "fy" && sa.fy === fy, `${t} ${col} ${k}: inherits FY${fy}'s mark`);
  });
  const key = x => `${x[0]}|${x[1]}|${x[2]}`;
  const want = new Set([...CHANGED, ...RESOURCED, ...DERIVED.filter(x => x[1][0] !== "N"), ...LTM_MOVES].map(key));
  const wantN = new Set(DERIVED.filter(x => x[1][0] === "N").map(key));
  const wantMarks = new Set([...CHAINS, ...LTM_MARKS].map(key));
  eq([want.size, wantN.size, wantMarks.size, pinsBy.size], [132, 1, 45, 26], "the pins: 132 cells move on the annual and LTM columns, 1 headline cell, 45 marks, over 26 filers");

  const FIELDS = ["status", "tag", "form", "accn"];
  const sameV = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1)) || (typeof a === "object" && show(a) === show(b));
  const diff = (t, w, A, B, out) => {
    const byEnd = new Map(B.map(c => [c.period.end, c]));
    for (const a of A) {
      const b = byEnd.get(a.period.end);
      if (!b) { out.add(`${t}|${w}${a.period.end}|(column)`); continue; }
      for (const k of new Set([...Object.keys(a.v), ...Object.keys(b.v), ...Object.keys(a.meta || {}), ...Object.keys(b.meta || {})])) {
        const ma = (a.meta || {})[k] || {}, mb = (b.meta || {})[k] || {};
        if (!sameV(a.v[k] ?? null, b.v[k] ?? null) || FIELDS.some(f => (ma[f] ?? null) !== (mb[f] ?? null))) out.add(`${t}|${w}${a.period.end}|${k}`);
      }
    }
  };
  const head = g => show([g.cols.map(c => [c.period.fy, c.period.start, c.period.end, !!c.period.broken]), (g.ltmCols || []).map(c => [c.period.end, c.period.basis]),
    g.ltm ? g.ltm.period.end : null, !!g.ltmStitched, g.behind ?? null, g.announced ?? null, g.ccy ?? null, g.splits ?? null]);
  const FIVE = new Set(["IQST", "JPM", "ETN", "BETRF", "SLB"]), Q = { price: 100 };
  const n = { grids: 0, recognised: 0, setAside: 0, filers: 0, maxBuilds: 0, capped: 0, skipped: 0, marks: 0 };
  const moved = new Set(), movedN = new Set(), strayMarks = [], headerBad = [], memoBad = [], quoteBad = [], payloads = [];
  for (const t of fixtureTickers().sort()) {
    const d = loadFixture(t), snap = FIVE.has(t) && !FAST ? JSON.stringify(d) : null;
    const g = buildGrid(d, null, 8);
    if (!g || g.empty || !Array.isArray(g.cols)) continue;
    n.grids++;
    const sd = g.standDown || {};
    n.recognised += (sd.recognised || []).length; n.setAside += (sd.setAside || []).length;
    if ((sd.recognised || []).length) n.filers++;
    n.maxBuilds = Math.max(n.maxBuilds, sd.builds || 0);
    if (sd.capped) n.capped++;
    if (sd.skipped) n.skipped++;
    for (const [w, cols] of [["A", g.cols], ["L", g.ltmCols || []]]) for (const c of cols) for (const [k, m] of Object.entries(c.meta || {}))
      if (m && m.setAside) { n.marks++; if (!wantMarks.has(`${t}|${w}${c.period.end}|${k}`)) strayMarks.push(`${t} ${w}${c.period.end} ${k}`); }
    const pins = pinsBy.get(t);
    if (!pins && FAST) continue;
    const s = buildSheet(d, null, 8);
    for (const p of pins || []) p(s, g);
    if (FAST) continue;
    if (head(s) !== head(g)) headerBad.push(t);
    diff(t, "A", s.cols, g.cols, moved);
    diff(t, "L", s.ltmCols || [], g.ltmCols || [], moved);
    if (s.ltm && g.ltm) diff(t, "N", [s.ltm], [g.ltm], movedN);
    // The headline IS the newest LTM window when one is stitched, so it re-sources whatever that window
    // re-sources (Apollo, EA, Eaton and Altria's), and moves in value only at Johnson & Johnson.
    for (const [lt, col, k] of LTM_MOVES) if (lt === t && g.ltm && g.ltmStitched && col.slice(1) === g.ltm.period.end) wantN.add(`${t}|N${col.slice(1)}|${k}`);
    const warm = buildGrid(d, Q, 8), fresh = buildGrid(loadFixture(t), Q, 8);
    if (!isDeepStrictEqual(warm, fresh)) memoBad.push(t);
    if (show(((fresh.standDown || {}).setAside) || []) !== show(sd.setAside || [])) quoteBad.push(t);
    if (snap) payloads.push(`${t} ${JSON.stringify(d) === snap ? "unchanged" : "CHANGED"}`);
  }
  eq(n, { grids: 171, recognised: 44, setAside: 77, filers: 26, maxBuilds: 5, capped: 0, skipped: 0, marks: 45 },
    "the cache: 171 sheets, 44 contexts recognised on 26 filers, 77 set aside, at most 5 builds, the cap never reached, no header moved, 45 cells marked");
  eq(strayMarks, [], "no cell carries a mark the pins do not name");
  if (!FAST) {
    eq(headerBad, [], "on every cached filer the sheet's header equals the one first built");
    eq([...moved].filter(k => !want.has(k)).sort(), [], "nothing else moves: no cell outside the 132 differs from the sheet as first built");
    eq([...want].filter(k => !moved.has(k)).sort(), [], "and every one of the 132 does");
    eq([...movedN].sort(), [...wantN].sort(), "the headline twelve months moves in one value, Johnson & Johnson's acquisitions, and re-sources only what its window does");
    eq(wantN.size, 7, "seven headline cells: that one, and six re-sourced with the newest window");
    eq(memoBad, [], "on every cached filer, the sheet rebuilt when a quote lands equals one built fresh with it");
    eq(quoteBad, [], "and what is set aside does not depend on the quote");
    eq(payloads, ["BETRF unchanged", "ETN unchanged", "IQST unchanged", "JPM unchanged", "SLB unchanged"], "the payload is never touched");
  }
  console.log(`     ${NAME}: cache pass ${FAST ? "(fast) " : ""}${n.grids} sheets in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

T.done(NAME);
