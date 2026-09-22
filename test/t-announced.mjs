// The "a later filing exists" banner: when it speaks, when it must not, and what it may say.
//
// The rule is a pointer, not a fact in the data path — it reads SEC's own cover-page `items` field
// and links to a filing the page never opens. That makes its failure mode WORDING rather than
// arithmetic, so this suite tests two things most suites here do not: the source text of the banner
// itself, and the agreement of three copies of one regex that live in three files.
//
// Drives the SHIPPING module. Every synthetic row below is in the shape api/facts.js builds, and the
// filer cases (Tesla, Apple, FS Specialty Lending Fund) carry REAL accession numbers and dates taken
// from data.sec.gov on 2026-09-22, so a reader can check them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./_t.mjs";
import { announcedSince, announcedIsCurrent, LAG_MIN, ANNOUNCED_MAX_AGE, buildGrid } from "../src/grid.js";
import { haveFixtures, loadFixture, fixtureTickers } from "./_fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = f => readFileSync(join(root, f), "utf8");
const P = (form, filed, period, accn) => ({ form, filed, period, accn });
const K = (filed, period, accn, items = "2.02,9.01") => ({ form: "8-K", filed, period, accn, items });

// ── Block 1 — it fires, and it returns the coverage row rather than the candidate ────────────────
{
  const rows = [P("10-Q", "2026-05-05", "2026-03-31", "p1"), K("2026-07-15", "2026-07-15", "k1")];
  const a = announcedSince(rows);
  ok(!!a, "a 10-Q followed by an item-2.02 8-K 106 days after the period end fires");
  eq(a.form, "10-Q", "prints the form of the periodic report");
  eq(a.period, "2026-03-31", "prints the newest period COVERED, which is what the sheet shows");
  eq(a.filed, "2026-05-05", "prints when that report was filed");
  eq(a.annFiled, "2026-07-15", "prints the 8-K's filing date, which is what the link says");
  eq(a.annEvent, "2026-07-15", "carries the 8-K's event date, which is what the lag and the ceiling measure");
  eq(a.annAccn, "k1", "carries the accession the link is built from");
  eq(Object.keys(a).sort().join(","), "annAccn,annEvent,annFiled,filed,form,period",
    "returns raw strings only — nothing formatted, nothing computed, nothing for the render to parse");
}

// ── Block 2 — every way it can fail, it fails closed ─────────────────────────────────────────────
// There is no error boundary in this repo (src/main.jsx renders <App /> bare), so a throw here
// blanks the whole terminal for as long as the payload that caused it stays cached.
{
  const k = K("2026-07-15", "2026-07-15", "k1");
  const p = P("10-Q", "2026-05-05", "2026-03-31", "p1");
  eq(announcedSince(null), null, "a null filing list returns null rather than throwing");
  eq(announcedSince(undefined), null, "an absent filing list returns null");
  eq(announcedSince("not a list"), null, "a string returns null — a cached payload whose shape moved");
  eq(announcedSince({}), null, "an object returns null");
  eq(announcedSince([null, undefined, 0]), null, "null rows inside the list are skipped, not dereferenced");
  eq(announcedSince([k]), null, "8-Ks with no periodic report at all: two of 180 filers, one with live 2.02s");
  eq(announcedSince([p]), null, "a periodic report with no 8-K");
  eq(announcedSince([P("10-Q", "2026-05-05", null, "p1"), k]), null,
    "a periodic with no period at all — no coverage row, so no lag can be measured");
  eq(announcedSince([P("10-Q", null, "2026-03-31", "p1"), k]), null, "a periodic with no filing date");
  eq(announcedSince([P("10-Q", "05/05/2026", "2026-03-31", "p1"), k]), null, "a filing date in another format");
  eq(announcedSince([p, K("2026-07-15", null, "k1")]), null,
    "an 8-K with no event date fails closed — it does NOT fall back to an older 8-K, which would link the wrong filing");
  eq(announcedSince([p, K("2026-07-15", "2026-07-15", null)]), null, "an 8-K with no accession — nothing to link to");
  eq(announcedSince([p, { form: "8-K", filed: "2026-07-15", period: "2026-07-15", accn: "k1" }]), null,
    "an 8-K row with no items key at all: every payload built before this feature existed");
  eq(announcedSince([p, { ...k, items: "" }]), null, "an empty items string");
  eq(announcedSince([p, { ...k, items: null }]), null, "a null items value, which is what api/facts.js writes when SEC sends none");
}

// ── Block 3 — the lag gate, at the boundary the 44 read documents put it on ──────────────────────
// Netflix's Q1 shareholder letter sits at exactly 100 and AbbVie's guidance table at 99, and the
// AbbVie document says in its own words that the results "have not been finalized".
// MUTATION: changing `>=` to `>` fails the first assertion; LAG_MIN = 99 fails the second.
{
  eq(LAG_MIN, 100, "the threshold is 100 days and the suite reads it from the module, not a copy");
  const at = lagDays => {
    const end = new Date(new Date("2026-03-31").getTime() + lagDays * 86400000).toISOString().slice(0, 10);
    return announcedSince([P("10-Q", "2026-05-05", "2026-03-31", "p1"), K(end, end, "k1")]);
  };
  ok(!!at(100), "a lag of exactly 100 days fires");
  eq(at(99), null, "a lag of 99 does not");
  eq(at(1), null, "an 8-K the day after the period end does not — no fiscal boundary has fallen");
  eq(at(90), null, "nor one at 90, where a quarter has not yet closed");
  ok(!!at(400), "a long lag still fires on the predicate — staleness is announcedIsCurrent's question, not this one");
}

// ── Block 4 — TESLA: the lag is measured from the period COVERED, never the report last FILED ────
// Tesla files a Part III 10-K/A every April, which outranks its own later 10-Q on filing date. Real
// rows, data.sec.gov, 2026-09-22. MUTATION: measuring the lag from the newest FILED periodic instead
// of the newest period covered makes the first assertion fire at a lag of 183.
{
  const tsla = [
    P("10-Q", "2026-04-23", "2026-03-31", "0001628280-26-026673"),
    P("10-K/A", "2026-04-30", "2025-12-31", "0001104659-26-053166"),
    K("2026-07-02", "2026-07-02", "0001628280-26-046717"),
  ];
  eq(announcedSince(tsla), null,
    "Tesla's 2 Jul production and deliveries release is cut at a lag of 93 from the quarter the sheet shows — " +
    "measured from the April 10-K/A it would read 183 and clear any floor");

  const withEarnings = [...tsla, K("2026-07-22", "2026-07-22", "0001628280-26-049213")];
  const a = announcedSince(withEarnings);
  ok(!!a, "Tesla's 22 Jul earnings 8-K fires at a lag of 113");
  eq(a.period, "2026-03-31", "and names the 10-Q's period, not the 10-K/A's 2025-12-31");
  eq(a.form, "10-Q", "and the 10-Q's form");
  eq(a.filed, "2026-04-23", "and the 10-Q's filing date, though the 10-K/A was filed a week later");
  eq(a.annAccn, "0001628280-26-049213", "and links the newest 2.02 8-K, not the July 2nd one");
}

// ── Block 5 — APPLE and DATACENTREX: an episode's whole life, and why the comparison is strict ───
// Apple's release lands the day BEFORE its 10-Q, so the banner speaks for one day and stops.
// filingDate carries no time, so a release furnished later on the same day is invisible until
// tomorrow — one day of silence, taken deliberately.
// MUTATION: `>=` in place of `>` fires on the Datacentrex case. It does NOT fire on the synthetic
// same-day case above it, because the lag gate cuts that one first — which is the whole reason the
// Datacentrex rows are here, and why this block was written twice.
{
  const before = [P("10-Q", "2026-05-01", "2026-03-28", "0000320193-26-000013"), K("2026-07-30", "2026-07-30", "0000320193-26-000018")];
  ok(!!announcedSince(before), "on 30 Jul, with Q3 announced and the 10-Q not yet filed, Apple's banner speaks");
  const after = [...before, P("10-Q", "2026-07-31", "2026-06-27", "0000320193-26-000020")];
  eq(announcedSince(after), null, "on 31 Jul, the day the 10-Q lands, it stops — the sheet now covers it");
  const sameDay = [P("10-Q", "2026-07-30", "2026-06-27", "p"), K("2026-07-30", "2026-07-30", "k")];
  eq(announcedSince(sameDay), null, "a release and a 10-Q filed on the same date does not fire");
  // DATACENTREX, real rows. 1,261 item-2.02 8-Ks across the 180 cached filers were filed on a date
  // that also carries a periodic report, and the lag gate cuts all but this one: most same-day pairs
  // are a results release beside the annual report for the SAME year, so their lag is about 30 days.
  // Here the lag is 103, so the gate passes it and only the strict comparison holds it out — and it
  // has to, because the 10-K filed beside it covers exactly the year being announced.
  const dtcx = [P("10-K", "2026-04-13", "2025-12-31", "0001493152-26-016375"), K("2026-04-13", "2026-04-13", "0001493152-26-016376")];
  eq(announcedSince(dtcx), null,
    "Datacentrex filed its FY2025 10-K and its FY2025 results release on one day at a lag of 103 — the banner stays silent");
  eq(announcedSince([...dtcx, P("10-Q", "2026-05-20", "2026-03-31", "later")]), null,
    "and once a later 10-Q lands it is still silent, because the 8-K is older than it");
}

// ── Block 6 — what counts as a candidate ────────────────────────────────────────────────────────
{
  const p = P("10-Q", "2026-05-05", "2026-03-31", "p1");
  eq(announcedSince([p, { ...K("2026-07-15", "2026-07-15", "k1"), form: "8-K/A" }]), null,
    "an 8-K/A is excluded: 33 filings across 24 filers carry 2.02 on one, and an amendment is about a period already announced");
  ok(!!announcedSince([p, { ...K("2026-07-15", "2026-07-15", "k1"), items: "2.02" }]), "items may be the single code");
  ok(!!announcedSince([p, { ...K("2026-07-15", "2026-07-15", "k1"), items: "9.01,2.02" }]), "or carry 2.02 anywhere in the list");
  ok(!!announcedSince([p, { ...K("2026-07-15", "2026-07-15", "k1"), items: "7.01, 2.02 ,9.01" }]), "or be spaced");
  eq(announcedSince([p, { ...K("2026-07-15", "2026-07-15", "k1"), items: "5.02,9.01" }]), null, "an 8-K with other items does not fire");
  // SYNTHETIC: SEC issues no item code containing "2.02" inside a longer one, so the corpus cannot
  // tell a token match from a substring match. Pinned here so the distinction survives a refactor.
  eq(announcedSince([p, { ...K("2026-07-15", "2026-07-15", "k1"), items: "12.021" }]), null,
    "the match is on the whole comma-separated token, not a substring (synthetic — no real item code collides)");
}

// ── Block 7 — the answer does not depend on the order SEC returns the list in ────────────────────
// Both reduces break ties on accession descending. 19 same-day pairs of periodic filings exist
// across 17 filers, and 11 filer-days across 6 filers carry two item-2.02 8-Ks on one date.
{
  const rows = [
    P("10-Q", "2026-04-23", "2026-03-31", "0001628280-26-026673"),
    P("10-K/A", "2026-04-30", "2025-12-31", "0001104659-26-053166"),
    K("2026-07-22", "2026-07-22", "0001628280-26-049213"),
    K("2026-07-02", "2026-07-02", "0001628280-26-046717"),
  ];
  const first = JSON.stringify(announcedSince(rows));
  const rotations = rows.map((_, i) => rows.slice(i).concat(rows.slice(0, i)));
  ok(rotations.every(r => JSON.stringify(announcedSince(r)) === first), "every rotation of the list gives the same answer");
  ok(rotations.every(r => JSON.stringify(announcedSince(r.slice().reverse())) === first), "so does every reversal");
  const twoSameDay = [P("10-Q", "2026-05-05", "2026-03-31", "p1"), K("2026-07-15", "2026-07-15", "aaa"), K("2026-07-15", "2026-07-15", "bbb")];
  eq(announcedSince(twoSameDay).annAccn, "bbb", "two 2.02 8-Ks on one date break to the higher accession, both ways round");
  eq(announcedSince(twoSameDay.slice().reverse()).annAccn, "bbb", "and the reversed list agrees");
}

// ── Block 8 — the freshness ceiling, which is the only clock this feature reads ──────────────────
// FS Specialty Lending Fund's last periodic is a 10-Q filed 2025-08-14 and its newest item-2.02 8-K
// is dated 2025-10-15 — a lag of 107, so the predicate fires, and on 2026-09-22 that 8-K is 342 days
// old. Real rows. Without the ceiling the banner is permanent on a filer that has simply stopped.
// MUTATION: removing the ceiling leaves the first assertion true at 342 days.
{
  const fssl = announcedSince([P("10-Q", "2025-08-14", "2025-06-30", "0001104659-25-070007x"), K("2025-10-20", "2025-10-15", "0001104659-25-100888")]);
  ok(!!fssl, "the predicate itself fires for FS Specialty Lending Fund — the filing list alone cannot see that a filer has stopped");
  eq(announcedIsCurrent(fssl, "2026-09-22"), false, "but at 342 days old the banner does not speak");
  eq(announcedIsCurrent(fssl, "2025-12-01"), true, "while at 47 days it does");
  eq(ANNOUNCED_MAX_AGE, 120, "the ceiling is 120 days, against a measured worst case of 50 across 363 episodes");
  const on = d => announcedIsCurrent({ annEvent: "2026-01-01" }, d);
  eq(on("2026-05-01"), true, "exactly 120 days old still speaks");
  eq(on("2026-05-02"), false, "121 does not");
  eq(announcedIsCurrent(null, "2026-05-01"), false, "no announcement, no banner");
  eq(announcedIsCurrent({ annEvent: "2026-01-01" }, null), false, "and a missing date fails closed rather than rendering NaN");
  eq(announcedIsCurrent({ annEvent: "2026-01-01" }, "today"), false, "as does an unparseable one");
}

// ── Block 9 — buildGrid carries it on both returns, including the empty one ──────────────────────
// A filer with no annual XBRL periods still has a filing list, and "a later filing exists" is the
// one thing that page can honestly say. Nine of the 180 cached filers render empty.
{
  const filings = [P("10-Q", "2026-05-05", "2026-03-31", "p1"), K("2026-07-15", "2026-07-15", "k1")];
  const empty = buildGrid({ cik: "1", name: "X", sicCode: "3571", facts: {}, filings }, null, 8);
  eq(empty.empty, true, "a payload with no facts builds an empty grid");
  ok(!!empty.announced, "and still carries the announcement");
  eq(empty.announced.annAccn, "k1", "with the accession the link needs");
  const none = buildGrid({ cik: "1", name: "X", sicCode: "3571", facts: {}, filings: [] }, null, 8);
  eq(none.announced, null, "an empty grid with nothing announced carries null, not undefined");
}

// ── Block 10 — one regex, three files ───────────────────────────────────────────────────────────
// The periodic-form pattern exists in extract.js (which decides where a FIGURE may come from),
// grid.js (which decides what this banner is measured against) and api/facts.js (which decides what
// reaches the browser at all). They drifted once already: api/facts.js listed eight literal form
// strings and left out every transition report, so grid.js's own `T?` provision could never fire and
// Greif's sheet stopped fourteen months early saying nothing.
{
  const PAT = "/^(10-K|10-Q|20-F|40-F)T?(\\/A)?$/";
  ok(src("src/extract.js").includes(`const periodic = form => (${PAT}.test(String(form)) ? 1 : 0);`),
    "extract.js's periodic() carries the pattern");
  // Pinned to the DECLARATION, not to the file: grid.js carries this pattern twice — the PERIODIC
  // const and newestFiledDate's inline copy — so a file-wide includes() stays true while the one the
  // banner reads drifts. That is the shape of assertion that passes for the wrong reason.
  ok(src("src/grid.js").includes(`const PERIODIC = ${PAT};`),
    "grid.js's PERIODIC const carries the same pattern, character for character");
  ok((src("src/grid.js").match(/\^\(10-K\|10-Q\|20-F\|40-F\)/g) || []).length === 2,
    "and grid.js still carries exactly two copies of it — a third would be a place to drift");
  ok(src("api/facts.js").includes("/^(10-K|10-Q|20-F|40-F)T?(\\/A)?$|^8-K$/"),
    "api/facts.js carries it with the 8-K alternative — the rows this feature reads");
  ok(src("api/facts.js").includes("/^(10-K|10-Q|20-F|40-F)T?(\\/A)?$/"),
    "and the plain pattern in hasLaterAnn, which must stay a relaxation of the rule rather than a copy of it");
}

// ── Block 11 — the payload actually carries `items`, and the cache is decided on the way out ─────
// These are text assertions on the handler because this suite cannot deploy it. They need no
// fixtures, which matters: they are the only check that runs on a fresh checkout.
{
  const h = src("api/facts.js");
  ok(h.includes("items: r.items ? r.items[i] : null"),
    "api/facts.js carries SEC's item codes onto every kept row — without this the rule silently never fires");
  ok(/CACHE_FRESH\s*=\s*"public, s-maxage=1800/.test(h), "there is a short cache tier");
  ok(/CACHE_OK\s*=\s*"public, s-maxage=21600/.test(h), "and the long one is unchanged for everyone else");
  ok(h.includes("hasLaterAnn(filings) ? CACHE_FRESH : CACHE_OK"),
    "and the header is chosen from the filing list — a payload 24h stale gets this banner wrong on 10.2% of firing days");
  ok(h.indexOf("res.setHeader(\"Cache-Control\"") > h.indexOf("const filings = []"),
    "the header still goes on the success path only, after the list is built");
}

// ── Block 12 — what the banner may say ──────────────────────────────────────────────────────────
// The rule's failure mode is a sentence, not a number. Item 2.02 is a cover-page code the filer
// ticks: of 44 of these filings fetched and read, 27 were results and 17 were a production count, a
// preliminary estimate, a conference deck or a restatement. So the copy names the HEADING and says
// the page has not opened the document.
//
// The first sentence is scoped to REPORTED figures. An earlier draft said "every figure below comes
// from a periodic report", which the valuation card 40px underneath falsifies — its market
// capitalisation and EV/EBITDA are a live share price divided into filed figures, and no filing
// contains them.
{
  const app = src("src/App.jsx");
  const from = app.indexOf("{grid.announced && announcedIsCurrent(");
  const to = app.indexOf("The valuation summary rides above every tab", from);
  ok(from > 0, "the banner is rendered");
  ok(to > from, "and the region it occupies can be read");
  const banner = app.slice(from, to);
  ok(banner.includes("The reported figures below are read from this company"),
    "the provenance sentence is scoped to reported figures");
  ok(!/every figure below comes from/i.test(app),
    "and nowhere claims every figure below comes from a periodic report — the valuation card would falsify it");
  ok(banner.includes("Results of Operations and Financial Condition"), "item 2.02's official heading is quoted");
  ok(banner.includes("says nothing about what the document contains"), "and is disclaimed as a cover-page code");
  ok(banner.includes("has not opened it"), "the banner says the page has not opened the filing");
  for (const phrase of ["earnings", "press release", "non-GAAP", "reconciliation", "newest word", "latest results", "announced results", "material filing"])
    ok(!banner.toLowerCase().includes(phrase.toLowerCase()),
      `the banner never says "${phrase}" — nothing here can see the document's contents`);
  ok(banner.includes("secFilingUrl(data.cik"), "the link goes through the shared EDGAR filing-detail helper");
  ok(banner.includes("grid.empty"), "and the copy branches on the empty sheet, where there is no \"below\" to be about");
  ok(!/\.toFixed\(|\.split\(|new Date\((?!\)\.toISOString)/.test(banner.replace(/\/\/[^\n]*/g, "")),
    "nothing in the block formats, parses or computes — every value is a string grid.js already validated");
}

// ── Block 13 — the comps view no longer contradicts the banner ──────────────────────────────────
// `interim` tests only whether a filer files 10-Qs at all. "nothing filed since the year end" said
// more than that, and would have sat one click from a banner saying a later filing exists.
{
  const app = src("src/App.jsx");
  ok(!/nothing filed since/.test(app),
    "the comps table, its paragraph and the workbook no longer say \"nothing filed since\"");
  ok((app.match(/no quarterly report since/g) || []).length >= 2,
    "they say no quarterly report since, which is what the code tests");
  ok(app.includes("filed no quarterly report since the year end"), "and the paragraph reads the same way");
}

// ── Block 14 — the corpus. 180 real payloads, none of which carry `items` ───────────────────────
// The cache predates this feature, so every fixture exercises the pre-`items` path — which is worth
// asserting on its own: a payload from before the field existed must fail closed rather than throw,
// and that is exactly what a browser holding a cached payload will hand this code on the day it
// deploys.
if (!haveFixtures()) {
  console.log("  (no fixture cache — the corpus block did not run. It is the only block that drives real payloads " +
    "through buildGrid; build it with `node scripts/build-fixtures.mjs`.)");
} else {
  const tickers = fixtureTickers();
  let withItems = 0, fired = 0, threw = 0;
  for (const t of tickers) {
    const fx = loadFixture(t);
    if ((fx.filings || []).some(f => f.items != null)) withItems++;
    try {
      const a = announcedSince(fx.filings);
      if (a) fired++;
      const g = buildGrid(fx, null, 8);
      ok(g && "announced" in g, `${t}: the grid carries an announced key either way`);
    } catch (e) { threw++; ok(false, `${t}: threw — ${e.message}`); }
  }
  ok(tickers.length > 100, `the cache holds ${tickers.length} filers`);
  eq(threw, 0, "no fixture throws");
  if (withItems === 0) eq(fired, 0, "no fixture carries items, so none fires — the pre-items path fails closed across 180 real payloads");
  else console.log(`  (${withItems} fixtures carry items; ${fired} fire — the cache has been rebuilt since this suite was written)`);
}

done("t-announced");
