// The two things the valuation block is built on: a cover-page share count that describes the
// company being priced, and an enterprise value that means something for the filer's industry.
// Both failed silently, and both failed in the direction this site cannot afford — a plausible
// wrong number rather than a blank.
//
// Drives the SHIPPING `latestFact`, `buildGrid` and the template's own lists. Mutation-tested; each
// mutation is named beside the block it breaks.
import { ok, eq, done } from "./_t.mjs";
import { latestFact, COVER_STALE_DAYS } from "../src/extract.js";
import { NOT_APPLICABLE, INDUSTRY_LABEL } from "../src/template.js";
import { dcfApplicable } from "../src/reverse.js";
import { buildGrid } from "../src/grid.js";

const TAG = "dei:EntityCommonStockSharesOutstanding";
const cover = (val, filed) => ({ [TAG]: { label: TAG, units: { shares: [{ end: filed, val, filed, form: "10-Q", accn: "0000000000-26-000001" }] } } });
const cur = { mustBeCurrent: true, notBefore: "2026-08-01" };

// ── A cover count must describe the company being priced ────────────────────────────────────────
// UPS's count is from 2010 — 713,924,267 against roughly 848m today — and it produced a $71.4bn
// market capitalisation and an $89.1bn enterprise value that looked entirely ordinary. Comcast's is
// from 2010 (2.06bn against ~3.7bn), Nike's from 2015, Sony's and Ares' from 2019.
// MUTATION: dropping the notBefore comparison passes everything else and fails here.
{
  eq(latestFact(cover(713924267, "2010-02-26"), [TAG], cur).value, null, "a cover-page share count from 2010 is refused, not priced (the UPS shape)");
  eq(latestFact(cover(713924267, "2010-02-26"), [TAG], cur).status, "cover-stale", "and it says WHY — not 'not tagged', which would send a reader to a cover page that has the number on it");
  eq(latestFact(cover(14594180000, "2026-07-31"), [TAG], cur).value, 14594180000, "a current count is used unchanged (the Apple shape)");
  // The boundary is asserted rather than assumed. The population separates with a huge margin —
  // 91 days at p90, then nothing until 2,557 — so the exact threshold is not load-bearing, but a
  // silent off-by-one in the comparison would be.
  const at = new Date(Date.parse("2026-08-01") - COVER_STALE_DAYS * 86400000).toISOString().slice(0, 10);
  const past = new Date(Date.parse("2026-08-01") - (COVER_STALE_DAYS + 1) * 86400000).toISOString().slice(0, 10);
  eq(latestFact(cover(1000, at), [TAG], cur).value, 1000, `exactly ${COVER_STALE_DAYS} days old is still current`);
  eq(latestFact(cover(1000, past), [TAG], cur).value, null, `one day past ${COVER_STALE_DAYS} is refused`);
}

// ── Zero is not a share count ───────────────────────────────────────────────────────────────────
// Simon Property, Paramount and iHeartMedia all file 0, which made market cap $0 and left
// enterprise value silently EQUAL TO NET DEBT — SPG showed $28.91bn with no equity in it.
// Rule 24's `preferNonZero` is no help: SPG's next non-zero candidate is from 2009, so preferring it
// would trade a visibly broken number for an invisibly wrong one. It fails closed instead.
// MUTATION: removing the `best.val === 0` test fails here.
{
  const r = latestFact(cover(0, "2026-07-31"), [TAG], cur);
  eq(r.value, null, "a cover-page share count of zero is refused — a listed company cannot have none");
  eq(r.status, "cover-zero", "and is reported as its own kind of blank, distinct from a stale one");
}

// ── The gate is opt-in, so no other `latest` row changes behaviour ──────────────────────────────
{
  eq(latestFact(cover(0, "2010-01-01"), [TAG]).value, 0, "without mustBeCurrent nothing is gated — the guard cannot reach a row that did not ask for it");
  eq(latestFact({}, [TAG], cur).status, "never-tagged", "a filer that never tagged it is still 'never tagged', not 'stale'");
}

// ── With no share count, the market rows must not read "needs price" ────────────────────────────
// The price arrived and is fine; what is missing is the count. Saying "needs price" sends a reader
// hunting a quote that is already on the page — rule 5's complaint, on the valuation block.
// MUTATION: returning before the mktCap==null branch, or marking those rows "market", fails here.
{
  const facts = {
    Revenues: { label: "r", units: { USD: [{ start: "2025-01-01", end: "2025-12-31", val: 1000, fy: 2025, fp: "FY", filed: "2026-02-01", form: "10-K", accn: "a-1" }] } },
    EarningsPerShareDiluted: { label: "e", units: { "USD/shares": [{ start: "2025-01-01", end: "2025-12-31", val: 2, fy: 2025, fp: "FY", filed: "2026-02-01", form: "10-K", accn: "a-1" }] } },
  };
  const g = buildGrid({ cik: "1", name: "N", sicCode: "3674", facts, filings: [{ form: "10-K", filed: "2026-02-01", accn: "a-1", period: "2025-12-31" }] }, { price: 100 }, 8);
  const c = g.cols[g.cols.length - 1];
  eq(c.v.mktCap, null, "no share count, no market capitalisation");
  eq(c.meta.mktCap.status, "no-share-count", "and the row says so rather than asking for a price that arrived");
  eq(c.meta.ev.status, "no-share-count", "the enterprise value it feeds says the same");
  eq(c.v.price, 100, "the price itself is still shown — it is not the thing that is missing");
  eq(c.v.pe, 50, "and a multiple that needs no share count still computes: 100 / 2");
}

// ── An enterprise value has to mean something for the filer's industry ──────────────────────────
// The Chubb defect: a price arriving resurrects rows NOT_APPLICABLE deleted. It was closed for the
// two carriers and never for a depository or a broker-dealer. A bank is funded by DEPOSITS and a
// dealer by client payables and repo, and `totalDebt` sees neither — so the bridge reads market cap
// plus a sliver of debt less cash and calls it an enterprise value. JPMorgan printed $422.5bn,
// Bank of America $805.6bn, Goldman $236bn, Morgan Stanley $395.3bn, Schwab $157.8bn.
// MUTATION: removing "ev" from either list fails here.
for (const ind of ["bank", "advisory", "pc", "life"]) {
  for (const k of ["ev", "evRev", "evEbitda", "evEbit", "evFcf"])
    ok(NOT_APPLICABLE[ind].includes(k), `a ${ind} filer's ${k} is blanked — the bridge cannot see how it is funded`);
}
ok(!(NOT_APPLICABLE.corporate || []).includes("ev"), "a corporate keeps its enterprise value");
ok(!(NOT_APPLICABLE.reit || []).includes("ev"), "so does a REIT — its debt IS its debt, and the bridge closes");

// ── ...and that is what stops the reverse DCF for them ──────────────────────────────────────────
// `dcfApplicable` reads the template's own lists rather than a second copy, so blanking `ev` for a
// broker-dealer also answers Schwab printing a 5.3% implied growth rate off cash from operations
// that swings with client balances. Goldman and Morgan Stanley were held back only by the sign
// their operating cash flow happened to take this year.
// MUTATION: reverting `advisory` to its old list makes this fail while every sheet still renders.
for (const ind of ["bank", "advisory", "pc", "life"])
  eq(dcfApplicable(NOT_APPLICABLE[ind]), false, `a ${ind} filer gets no reverse DCF`);
eq(dcfApplicable(NOT_APPLICABLE.corporate), true, "a corporate does");

// ── ...and the free-cash-flow family goes with the enterprise value, for banks and dealers ──────
// `fcf` is cfo − capex, and a bank's cash from operations is dominated by the change in its loan
// book, deposits and trading assets — so it reports whether the BALANCE SHEET grew, not whether the
// business generated cash. JPMorgan printed −$147.8bn and an FCF yield of −55.6%, Citi −$74.2bn and
// −42.4%, Goldman −162.2%.
//
// The negative ones are not what makes this a defect. Bank of America reads +$12.6bn, US Bancorp
// +$8.0bn, PNC +$4.4bn, Schwab +$8.8bn — 5.1%, 11.0%, 4.7%, 5.1% yields that look entirely ordinary
// and mean nothing, because the same bank prints the opposite sign next year for reasons unrelated
// to free cash flow. A number that sometimes looks plausible is worse than one that always looks
// broken. Blank the derived concept and keep the filed inputs, exactly as the EBITDA family does.
// MUTATION: removing any of the four from either list fails here.
for (const ind of ["bank", "advisory"])
  for (const k of ["fcf", "fcfMargin", "fcfConv", "fcfYield", "evFcf"])
    ok(NOT_APPLICABLE[ind].includes(k), `a ${ind} filer's ${k} is blanked — cfo swings with funding, so it is not free cash flow`);
for (const ind of ["bank", "advisory"])
  for (const k of ["cfo", "capex"])
    ok(!NOT_APPLICABLE[ind].includes(k), `...but ${k} stays on a ${ind} sheet — it is a figure the filer actually reported`);
// NOT extended to the carriers, the REITs or the health plans, and that is measured rather than
// preferred: an insurer's operating cash flow is premiums less claims less expenses, which IS an
// operating flow — none of the nine carriers swept reports a negative one — and blanking it would
// delete a sheet that is correct as it stands. Asserted so a later pass cannot widen this quietly.
for (const ind of ["pc", "life", "health", "reit"])
  for (const k of ["fcf", "fcfYield"])
    ok(!NOT_APPLICABLE[ind].includes(k), `a ${ind} filer KEEPS ${k} — its operating cash flow is an operating flow`);

// ── The status chip has to stay short, because it sets a sticky column's width ──────────────────
// Blanking the EV rows for `advisory` made the reverse-DCF sentence fire for the first time, and the
// obvious follow-on — spelling the label out as "broker-dealer or asset manager" so Blackstone is not
// called something it is not — measured 359px against 194px for the next-widest label on its ratios
// sheet. The label cell is `white-space: nowrap` and the widest label sets the column for every row,
// so that pushes year columns off an 8-column sheet: the note-widens-the-column failure the layout
// section documents. The plate says it in full instead; it is prose and has the room.
// MUTATION: restoring the long label fails here.
for (const [k, label] of Object.entries(INDUSTRY_LABEL))
  ok(label.length <= 16, `the "${k}" status label stays short enough not to widen the sticky column — "${label}" is ${label.length} chars`);

done("t-valuation");
