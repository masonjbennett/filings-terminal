// Rule 37 — an annual leg filed AFTER the prior interim leg's newest re-presentation is on the
// re-presented basis, and the stitch may proceed. Rule 12's guard asked whether the annual leg's OWN
// filing restated the year before the window — the right question of the 10-K that straddled the
// re-presentation, the wrong one of a later 10-K that carries no such year at all. Measured on the
// 180-filer cache: 442 LTM cells were refused as restated-basis; 361 have the annual leg filed after
// the re-presentation and now stitch (948 cells appear with their derivations, none vanish); the 81
// whose annual leg predates it stay refused, which is the divestiture-in-progress case the guard is for.
//
// Drives the SHIPPING extract and grid. Mutation-tested; each mutation is named beside the block it
// breaks. Cache pins at the end skip cleanly without the cache.
import { ok, eq, near, done } from "./_t.mjs";
import { pickLtm } from "../src/extract.js";
import { buildGrid } from "../src/grid.js";
import { needFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

// One tag's facts as filed: each entry {start, end, val, filed, form}.
const facts = entries => ({ Revenues: { label: "r", units: { USD: entries.map((e, i) => ({ ...e, accn: e.accn || `a-${i}` })) } } });
const FY23 = { start: "2023-01-01", end: "2023-12-31" }, FY22 = { start: "2022-01-01", end: "2022-12-31" };
const H1_24 = { start: "2024-01-01", end: "2024-06-30" }, H1_23 = { start: "2023-01-01", end: "2023-06-30" };
const win = { fy: FY23, prevFy: FY22, cur: { ...H1_24, days: 182 }, prior: { ...H1_23, days: 181 }, end: "2024-06-30", days: 182 };
const K = (p, val, filed, accn) => ({ ...p, val, filed, form: "10-K", accn });
const Q = (p, val, filed, accn) => ({ ...p, val, filed, form: "10-Q", accn });

// ── The GE shape: the annual leg comes from a later 10-K, filed after the re-presentation ────────
// H1 2023 was filed at 35.7 in the Q2 2023 10-Q and re-presented at 26.8 in the Q2 2024 10-Q after
// the Vernova spin; FY2023 was first filed at 68.0 (FY2023 10-K, Feb 2024) and restated at 64.8 by the
// FY2024 10-K (Feb 2025) — which rule 2 takes, and which carries no FY2021 comparative. All three
// legs are on the post-spin basis; the old test found no comparative and refused.
// MUTATION: dropping the "annual leg post-dates the re-presentation" line fails the first assertion.
{
  const f = facts([K(FY22, 70, "2023-02-01", "k22"), K(FY23, 68, "2024-02-01", "k23"), K(FY23, 64.8, "2025-02-01", "k24"),
    Q(H1_23, 35.7, "2023-07-25", "q23"), Q(H1_23, 26.8, "2024-07-23", "q24"), Q(H1_24, 31.2, "2024-07-23", "q24")]);
  const r = pickLtm(f, ["Revenues"], win, "USD");
  eq(r.status, "ltm", "the stitch proceeds: the annual leg was filed after the prior leg's re-presentation");
  near(r.value, 64.8 + 31.2 - 26.8, 1e-9, "FY2023 on the new basis plus H1 2024 less the re-presented H1 2023");
  eq(r.accn, "k24", "and the annual leg is rule 2's — the later 10-K");
}

// ── The divestiture in progress: the annual leg predates the re-presentation ─────────────────────
// Same facts, but the FY2024 10-K has not been filed yet: FY2023 exists only in the FY2023 10-K (Feb
// 2024), filed before the Q2 2024 10-Q re-presented H1 2023. FY (with the sold business) plus a delta
// (without it) is neither, and it is refused — the case the guard exists for, unchanged.
// MUTATION: comparing against the prior leg's FIRST filing instead of its newest passes the stitch here and fails.
{
  const f = facts([K(FY22, 70, "2023-02-01", "k22"), K(FY23, 68, "2024-02-01", "k23"),
    Q(H1_23, 35.7, "2023-07-25", "q23"), Q(H1_23, 26.8, "2024-07-23", "q24"), Q(H1_24, 31.2, "2024-07-23", "q24")]);
  const r = pickLtm(f, ["Revenues"], win, "USD");
  eq(r.status, "restated-basis", "refused: the only FY2023 on file predates the re-presentation, so it is on the old basis");
  eq(r.value, null, "and no figure is printed");
}

// ── Re-presented twice: the annual leg must post-date the NEWEST re-presentation ─────────────────
// H1 2023 was re-presented in the Q2 2024 10-Q and again in the Q2 2025 10-Q; the FY2023 leg comes
// from the FY2024 10-K, filed between the two. It is on the first re-presented basis, not the second.
// MUTATION: testing against the first re-presentation's date instead of the newest version's fails here.
{
  const f = facts([K(FY22, 70, "2023-02-01", "k22"), K(FY23, 68, "2024-02-01", "k23"), K(FY23, 64.8, "2025-02-01", "k24"),
    Q(H1_23, 35.7, "2023-07-25", "q23"), Q(H1_23, 26.8, "2024-07-23", "q24"), Q(H1_23, 24.0, "2025-07-22", "q25"), Q(H1_24, 31.2, "2024-07-23", "q24")]);
  const r = pickLtm(f, ["Revenues"], win, "USD");
  eq(r.status, "restated-basis", "refused: the prior leg was re-presented again after the annual leg was filed");
}

// ── The same filing on both sides: a 10-K carrying the year and its restated quarterly data ───────
// The FY2024 10-K re-presents H1 2023 in its quarterly-data note and reports FY2023 — one filing, one
// basis. Found by the mutation run: the first version compared with `>` and refused this against itself.
// MUTATION: `>` instead of `>=` fails here.
{
  const f = facts([K(FY22, 70, "2023-02-01", "k22"), K(FY23, 68, "2024-02-01", "k23"), K(FY23, 64.8, "2025-02-01", "k24"),
    Q(H1_23, 35.7, "2023-07-25", "q23"), { ...H1_23, val: 26.8, filed: "2025-02-01", form: "10-K", accn: "k24" }, Q(H1_24, 31.2, "2024-07-23", "q24")]);
  const r = pickLtm(f, ["Revenues"], win, "USD");
  eq(r.status, "ltm", "accepted: the annual leg and the re-presented prior leg are the same filing");
  near(r.value, 64.8 + 31.2 - 26.8, 1e-9, "on that filing's basis");
}

// ── The original door still opens: the annual leg's own filing restated the year before ──────────
// FY2023 comes from the FY2023 10-K, filed BEFORE the re-presentation, but that 10-K itself restated
// FY2022 — rule 12's own test, unchanged and still sufficient on its own.
{
  const f = facts([K(FY22, 70, "2023-02-01", "k22"), K(FY22, 62, "2024-02-01", "k23"), K(FY23, 68, "2024-02-01", "k23"),
    Q(H1_23, 35.7, "2023-07-25", "q23"), Q(H1_23, 26.8, "2024-07-23", "q24"), Q(H1_24, 31.2, "2024-07-23", "q24")]);
  const r = pickLtm(f, ["Revenues"], win, "USD");
  eq(r.status, "ltm", "accepted through rule 12's original test: the annual leg's filing restated the previous year");
}

// ── Nothing re-presented: never touched ──────────────────────────────────────────────────────────
{
  const f = facts([K(FY22, 70, "2023-02-01", "k22"), K(FY23, 68, "2024-02-01", "k23"), Q(H1_23, 35.7, "2023-07-25", "q23"), Q(H1_24, 31.2, "2024-07-23", "q24")]);
  const r = pickLtm(f, ["Revenues"], win, "USD");
  eq(r.status, "ltm", "a prior leg filed once is stitched as before");
  near(r.value, 68 + 31.2 - 35.7, 1e-9, "FY + H1 − prior H1");
}

// ── Cache pins ───────────────────────────────────────────────────────────────────────────────────
if (needFixtures("t-basis cache pins")) {
  const ge = buildGrid(loadFixture("GE"), null, 8);
  const c = ge.ltmCols.find(c => c.period.end === "2024-06-30");
  if (c) { ok(c.v.revenue > 30e9 && c.v.revenue < 45e9, `GE's LTM to June 2024 stitches on the GE Aerospace basis — ${c.v.revenue}`); eq(c.meta.revenue.status, "ltm", "with the ltm status"); }
  let refused = 0, stitched = 0;
  for (const t of fixtureTickers()) { let g; try { g = buildGrid(loadFixture(t), null, 8); } catch { continue; } if (!g || g.empty) continue;
    for (const col of g.ltmCols) for (const m of Object.values(col.meta)) { if (!m) continue; if (m.status === "restated-basis") refused++; else if (m.status === "ltm") stitched++; } }
  ok(refused <= 90, `at most 90 LTM cells remain refused as restated-basis on the cache — the 81 whose annual leg predates the re-presentation — found ${refused}`);
  ok(refused >= 60, `and not far fewer: the divestiture-in-progress refusals are real and must survive — found ${refused}`);
}

done("t-basis");
