// The 53-week marks: which growth CELLS an extra week of trading moves, and in which direction.
//
// The note beside these rows says what a 53-week year does to a rate. It cannot say WHICH rates —
// the renderer hands a note one column, and a sheet can carry two 53-week years, so prose naming one
// would be wrong about the other. The marks are how the sheet names them, per cell, the way rule 31
// marks a figure rebased after a split.
//
// Drives the SHIPPING grid. Synthetic sheets are built in the shape companyfacts returns, the way
// t-calendar builds its calendars, so the suite runs offline; the cache-driven block at the end pins
// the real filers the rule was measured on and skips cleanly when the cache is absent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./_t.mjs";
import { buildGrid, WEEK53_BACK } from "../src/grid.js";
import { SECTIONS } from "../src/template.js";
import { haveFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = f => readFileSync(join(root, f), "utf8");
const MINUS = "−";

const F = (start, end, val, filed, form = "10-K") => ({ start, end, val, fy: +end.slice(0, 4), fp: "FY", filed, form, accn: `a-${filed}-${end}` });
const tagOf = (facts, unit = "USD") => ({ label: "x", units: { [unit]: facts } });
const grid = facts => buildGrid({ cik: "1", name: "X", sicCode: "3571", facts, filings: [] }, null, 8);

// A run of fiscal years ending on the Saturday nearest 31 January, with an extra week inserted at
// each index in `longs` — the shape a 52/53-week retailer actually files.
const ladder = (n, longs, startYear = 2016) => {
  const out = [];
  let start = `${startYear}-01-31`;
  for (let i = 0; i < n; i++) {
    const days = longs.includes(i) ? 371 : 364;
    const end = new Date(new Date(start).getTime() + (days - 1) * 86400000).toISOString().slice(0, 10);
    out.push(F(start, end, 100 + i * 10, `${Number(end.slice(0, 4)) + (end.slice(5, 7) < "07" ? 0 : 1)}-04-01`));
    start = new Date(new Date(end).getTime() + 86400000).toISOString().slice(0, 10);
  }
  return out;
};

const marks = (g, k) => g.cols.map(c => (c.v[k] == null ? "." : ((c.meta[k] || {}).week53 || "-"))).join(" ");

// ── Block 1 — the mark table is derived, and it agrees with the note ────────────────────────────
// WEEK53_BACK is built from YOY and CAGRS so a growth row added to either is covered the day it is
// added. This binds it the other way: every row carrying the 53-week note must be in the table, or
// the note promises marks that never render. MUTATION: dropping a row from either side fails here.
{
  const back = Object.fromEntries(WEEK53_BACK);
  eq(back.revGrowth, 1, "a year-on-year rate looks one column back");
  eq(back.revCagr3, 3, "a 3-year CAGR looks three back");
  eq(back.revCagr5, 5, "and a 5-year CAGR five");
  const noted = SECTIONS.flatMap(s => s.lines).filter(l => l.flagNote && l.flagNote.week53Sheet).map(l => l.k).sort();
  eq(noted.join(" "), Object.keys(back).sort().join(" "),
    "every row carrying the 53-week note is in the mark table, and every row in the table carries the note");
  ok(noted.length === 5, `five rows carry it: ${noted.join(", ")}`);
}

// ── Block 2 — the endpoint gains a week, the base gives one up ──────────────────────────────────
// MUTATION: dropping the base term marks only the endpoint; flipping the sign swaps every mark.
{
  const g = grid({ Revenues: tagOf(ladder(8, [3])) });
  eq(g.cols.map(c => (c.period.weeks53 ? "53" : "52")).join(" "), "52 52 52 53 52 52 52 52", "one 53-week year, at index 3");
  eq(marks(g, "revGrowth"), ". - - +wk " + MINUS + "wk - - -",
    "the rate INTO the long year carries the extra week, the rate measured FROM it gives one up, and nothing else moves");
  eq(marks(g, "revCagr3"), ". . . +wk - - " + MINUS + "wk -",
    "a 3-year CAGR is marked where the long year is its endpoint, and again three columns later where it is its base");
  eq(marks(g, "revCagr5"), ". . . . . - - -",
    "a 5-year CAGR reaches its first full window at index 5, where the long year is neither end");
}

// ── Block 3 — two long years that cancel, which is the AutoZone case ────────────────────────────
// AutoZone's FY2019 and FY2024 are exactly five apart, so its 5-year CAGR ending FY2024 has the extra
// week at BOTH ends and is not moved at all. A mark there would be wrong on the filer this rule was
// written for. MUTATION: marking on the endpoint alone puts a +wk on that cell.
{
  const g = grid({ Revenues: tagOf(ladder(8, [2, 7])) });
  eq(g.cols.map(c => (c.period.weeks53 ? "53" : "52")).join(" "), "52 52 53 52 52 52 52 53", "two 53-week years, five apart");
  eq((g.cols[7].meta.revCagr5 || {}).week53, undefined,
    "the 5-year CAGR spanning both of them is NOT marked — the extra week is at both ends and cancels");
  ok(g.cols[7].v.revCagr5 != null, "and it is still printed, because it is a perfectly good rate");
  eq((g.cols[2].meta.revCagr5 || {}).week53, undefined, "the earlier long year has no 5-year window on this sheet at all");
  eq(marks(g, "revGrowth"), ". - +wk " + MINUS + "wk - - - +wk",
    "the year-on-year rates still mark both long years, because no 52-week gap of 1 can cancel");
  // Index 3 is NOT marked, and working out why is the point of this line: its window is columns 0 to
  // 3, and the long year at index 2 is INSIDE that window rather than at either end. A CAGR only
  // knows its endpoints, so a long year in the middle moves nothing — the compounding is over the
  // whole span either way. The marks are at index 5 (base = the long year at 2) and index 7 (its own
  // endpoint is long).
  eq(marks(g, "revCagr3"), ". . . - - " + MINUS + "wk - +wk",
    "the 3-year CAGR marks each long year's endpoint and base independently, and ignores one sitting mid-window");
}

// ── Block 4 — a mark never floats beside a number the sheet did not print ───────────────────────
// A blank, a refused comparison or a row this industry does not have has nothing to mark. A marker
// beside an em dash would say the sheet moved a figure it never showed.
{
  const g = grid({ Revenues: tagOf(ladder(8, [3])) });
  for (const [k] of WEEK53_BACK)
    for (const c of g.cols)
      if (c.v[k] == null) eq((c.meta[k] || {}).week53, undefined, `${k} is unmarked wherever it is blank`);
  ok(g.cols.slice(0, 3).every(c => c.v.revCagr3 == null && !(c.meta.revCagr3 || {}).week53),
    "the first three columns have no 3-year window, so no value and no mark");

  // A calendar-year filer is never marked at all, and the note never fires.
  const cal = grid({ Revenues: tagOf([
    F("2022-01-01", "2022-12-31", 100, "2023-02-01"), F("2023-01-01", "2023-12-31", 101, "2024-02-01"),
    F("2024-01-01", "2024-12-31", 102, "2025-02-01")] ) });
  ok(cal.cols.every(c => !(c.meta.revGrowth || {}).week53), "a calendar-year filer carries no marks");
  ok(cal.cols.every(c => !c.v.week53Sheet), "and no note");
}

// ── Block 5 — the mark is meta, not a cell ──────────────────────────────────────────────────────
// `scripts/full-diff.mjs` compares cells as [value, status, tag, form, accession]. A key in `v` would
// have counted as a cell appearing on every 53-week filer; in `meta` it is invisible to the diff, and
// the row's computed status survives beside it.
{
  const g = grid({ Revenues: tagOf(ladder(8, [3])) });
  const c = g.cols[3];
  eq(c.v.revGrowthWeek53, undefined, "nothing was added to v");
  eq(c.meta.revGrowth.week53, "+wk", "the mark rides in meta");
  eq(c.meta.revGrowth.status, "computed", "beside the status, which the mark must not overwrite");
}

// ── Block 6 — what the page does with it ────────────────────────────────────────────────────────
{
  const app = src("src/App.jsx");
  ok(/\{x\.m\.week53 && <span/.test(app), "the cell renders the mark");
  ok(app.includes("WEEK53_TIP[x.m.week53]"), "and a computed cell, which carries no tag and so had no tooltip, gets one");
  ok(/"\+wk":/.test(app) && app.includes(`"${MINUS}wk":`), "both directions are explained");
  // Asserted on the PARSED note, not on template.js's source: the source writes the minus sign as a
  // − escape, so a source-text search for the character it denotes finds nothing and the
  // assertion passes or fails for a reason that has nothing to do with what the page says.
  const L = SECTIONS.flatMap(s => s.lines);
  const full = L.find(l => l.k === "revGrowth").flagNote.week53Sheet;
  const short = L.find(l => l.k === "epsGrowth").flagNote.week53Sheet;
  ok(full.includes("+wk carries that extra week"), "the full note points at the marks");
  ok(full.includes(MINUS + "wk is measured from it"), "and explains the other direction");
  ok(full.includes("because the two cancel"), "and says why a rate spanning two long years is unmarked");
  ok(short.startsWith("Cells marked +wk or " + MINUS + "wk"),
    "the short note on the other four rows points at them too");
  ok(short.includes("see the note on Revenue growth, YoY"), "and says where the explanation is");
}

// ── Block 7 — the corpus ────────────────────────────────────────────────────────────────────────
// Apple FY2023, Applied Materials FY2021 and AMD FY2022 are the real 53-week years the rule was read
// against. The assertion is the SHAPE — exactly one +wk per long year per row, each followed by its
// base mark n columns later when that column is on the sheet.
if (!haveFixtures()) {
  console.log("  (no fixture cache — the corpus block did not run. It is the only block that drives real filers; " +
    "build it with `node scripts/build-fixtures.mjs`.)");
} else {
  let filers = 0, marked = 0;
  for (const t of fixtureTickers()) {
    const g = buildGrid(loadFixture(t), null, 8);
    if (!g || !g.cols || !g.cols.some(c => c.period.weeks53)) continue;
    filers++;
    const longs = g.cols.map((c, i) => (c.period.weeks53 ? i : -1)).filter(i => i >= 0);
    for (const [k, back] of WEEK53_BACK) {
      for (let i = 0; i < g.cols.length; i++) {
        const c = g.cols[i];
        const want = c.v[k] == null ? undefined
          : (longs.includes(i) ? 1 : 0) - (longs.includes(i - back) ? 1 : 0) === 0 ? undefined
          : (longs.includes(i) ? 1 : 0) - (longs.includes(i - back) ? 1 : 0) > 0 ? "+wk" : MINUS + "wk";
        eq((c.meta[k] || {}).week53, want, `${t} ${k} col ${i} (${c.period.fy})`);
        if (want) marked++;
      }
    }
  }
  ok(filers > 0, `${filers} cached filers have a 53-week year on their sheet, carrying ${marked} marks`);
}

done("t-week53");
