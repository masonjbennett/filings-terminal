// The calendar: which periods become columns, and what a column has to say about its own length.
//
// Two defects, both about a SERIES being wrong while every column in it is right — the class this
// engine is least instrumented for, because every identity it checks is inside one column.
//
// Drives the SHIPPING extract and grid. The synthetic fixtures are hand-built in the shape
// companyfacts returns so the suite runs offline; the cache-driven block at the end pins the real
// filers the two rules were measured on and skips cleanly when the cache is absent.
import { ok, eq, done } from "./_t.mjs";
import { annualPeriods } from "../src/extract.js";
import { buildGrid, WEEKS53_MIN_DAYS } from "../src/grid.js";
import { haveFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const shift = (d, n) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);
const F = (start, end, val, filed, form = "10-K") => ({ start, end, val, fy: +end.slice(0, 4), fp: "FY", filed, form, accn: `a-${filed}-${end}` });
const tagOf = (facts, unit = "USD") => ({ label: "x", units: { [unit]: facts } });
const grid = facts => buildGrid({ cik: "1", name: "X", sicCode: "3571", facts, filings: [] }, null, 8);

// ── Adjacent means adjacent: a rolling twelve-month ladder is not a calendar ─────────────────────
// Amazon files `NetIncomeLoss` for the trailing twelve months to EVERY quarter end, in every 10-Q,
// so the tag carries 74 annual-length periods overlapping by nine months each. `contiguous()` asked
// whether each period started within a day of the previous one's end and accepted a gap of MINUS
// 273 days, so the ladder scored 74 against the ten calendar years the revenue tag reaches — and
// the sheet rendered eight June-to-June columns with a blank income statement in all of them, on
// the most-typed ticker on the site. Measured over 180 cached filers: exactly one calendar changes.
// MUTATION: restoring `days(...) <= 1` (no lower bound) fails the first assertion.
{
  const years = [];
  for (let y = 2018; y <= 2025; y++) years.push(F(`${y}-01-01`, `${y}-12-31`, 100 + y, `${y + 1}-02-01`));
  // The ladder: a twelve-month period ending every quarter, filed in 10-Qs and 10-Ks alike.
  const ladder = [];
  for (let y = 2018; y <= 2025; y++) for (const q of ["03-31", "06-30", "09-30", "12-31"]) {
    const end = `${y}-${q}`, start = shift(shift(end, -365), 1);
    ladder.push(F(start, end, 7, shift(end, 35), q === "12-31" ? "10-K" : "10-Q"));
  }
  const facts = { Revenues: tagOf(years), NetIncomeLoss: tagOf(ladder) };
  const ps = annualPeriods(facts, ["Revenues", "NetIncomeLoss"], 8);
  eq(ps.map(p => p.end.slice(5)).join(" "), "12-31 12-31 12-31 12-31 12-31 12-31 12-31 12-31",
    "the calendar is the eight December years the revenue tag reaches, not the rolling ladder that outnumbers them");
  const g = grid(facts);
  ok(g.cols.every(c => c.v.revenue != null), "and every column carries revenue — the June-to-June sheet had none");
  // The slack that IS allowed: a filer whose next year starts on the previous end date rather than
  // the day after. Both conventions are one unbroken run.
  const touching = [F("2019-01-01", "2019-12-31", 1, "2020-02-01"), F("2019-12-31", "2020-12-31", 1, "2021-02-01"), F("2020-12-31", "2021-12-31", 1, "2022-02-01")];
  eq(annualPeriods({ Revenues: tagOf(touching) }, ["Revenues"], 8).length, 3, "periods that TOUCH (next start = previous end) are still contiguous");
}

// ── A 53-week year says so ──────────────────────────────────────────────────────────────────────
// A 52/53-week filer's long year is a genuine fiscal year and 1.9% longer than its neighbours.
// Nothing is adjusted and nothing is blanked — the filer's own 10-K reports the growth rate with the
// extra week in it — but the column is marked and the growth rows carry the note, because on a
// slow-growing filer the extra week is the whole sign (Kroger FY2024: +1.20% printed, −0.71% per week).
// MUTATION: dropping `p.weeks53 = …` in buildGrid fails the mark; dropping `week53Sheet` in
// crossColumn fails the note key; raising WEEKS53_MIN_DAYS above 370 fails both.
{
  // 364 / 370 / 364-day years, Saturday-nearest-month-end style, then a 365-day calendar year filer.
  const w = [F("2021-01-31", "2022-01-29", 100, "2022-03-20"), F("2022-01-30", "2023-02-04", 103, "2023-03-20"), F("2023-02-05", "2024-02-03", 104, "2024-03-20")];
  eq(days(w[1].start, w[1].end), 370, "the middle year of the fixture is 370 days — the shape the census found 30 times in 1,258 columns");
  const g = grid({ Revenues: tagOf(w) });
  eq(g.cols.map(c => c.period.weeks53 ? "53" : "52").join(" "), "52 53 52", "only the 370-day column is marked as a 53-week year");
  eq(g.cols.map(c => c.v.week53Sheet).join(" "), "true true true", "the sheet-level flag the growth rows' note keys on is set on every column once any column is 53 weeks");
  ok(g.cols[1].v.revGrowth != null && g.cols[2].v.revGrowth != null, "growth rates into and out of the 53-week year are still printed — both years are real");
  ok(Math.abs(g.cols[1].v.revGrowth - 0.03) < 1e-9 && Math.abs(g.cols[2].v.revGrowth - (104 / 103 - 1)) < 1e-9, "and they are the reported rates, not per-week adjusted ones");
  const cal = [F("2022-01-01", "2022-12-31", 100, "2023-02-01"), F("2023-01-01", "2023-12-31", 101, "2024-02-01"), F("2024-01-01", "2024-12-31", 102, "2025-02-01")];
  const g2 = grid({ Revenues: tagOf(cal) });
  ok(g2.cols.every(c => !c.period.weeks53 && !c.v.week53Sheet), "calendar years (365 and 366 days) are never marked, and the note never fires on a sheet without one");
  ok(WEEKS53_MIN_DAYS > 366 && WEEKS53_MIN_DAYS <= 370, `the boundary sits in the gap between a leap year (366) and a 53-week year (370): ${WEEKS53_MIN_DAYS}`);
}

// ── The same rules on the filers they were measured against ─────────────────────────────────────
if (haveFixtures()) {
  const have = new Set(fixtureTickers());
  if (have.has("AMZN")) {
    const g = buildGrid(loadFixture("AMZN"), null, 8);
    ok(g.cols.every(c => c.period.end.endsWith("-12-31")), `Amazon's columns are December years, not June-to-June windows: ${g.cols.map(c => c.period.end).join(" ")}`);
    ok(g.cols.every(c => c.v.revenue != null), "and Amazon's revenue is on every one of them");
  }
  for (const [t, end] of [["KR", "2024-02-03"], ["LOW", "2023-02-03"], ["JNJ", "2021-01-03"], ["AAPL", "2023-09-30"]]) {
    if (!have.has(t)) continue;
    const g = buildGrid(loadFixture(t), null, 8);
    const c = g.cols.find(x => x.period.end === end);
    ok(c && c.period.weeks53, `${t}'s year to ${end} is marked as a 53-week year — one of the sign-flip cases the rule was measured on`);
  }
  // Every mark on the cache is a 369–372-day column and no shorter column carries one: the boundary
  // has nothing near it on either side (measured lengths are 363/364/365/370 only).
  let marked = 0, wrong = 0;
  for (const t of have) {
    let g; try { g = buildGrid(loadFixture(t), null, 8); } catch { continue; }
    if (!g || g.empty) continue;
    for (const c of g.cols) { const d = days(c.period.start, c.period.end); if (c.period.weeks53) { marked++; if (d < 369 || d > 372) wrong++; } else if (d >= 369) wrong++; }
  }
  ok(marked >= 30, `at least the 30 columns the census found are marked across the cache (${marked})`);
  eq(wrong, 0, "and the mark agrees with the column's own length everywhere");
}

done("t-calendar");
