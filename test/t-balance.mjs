// Two defects the Sep 11 audit found, both of which had been on the page since the rows were
// written, and both of which are about a FETCHED figure rather than a computed one.
//
// Drives the SHIPPING template, extract and grid. The fixtures are hand-built in the shape
// companyfacts returns so the suite runs offline, but every tag name and every figure below is real
// and named to the filer it came from.
import { ok, eq, done } from "./_t.mjs";
import { SECTIONS } from "../src/template.js";
import { DERIVED_BANK } from "../src/extract.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempEquity = SECTIONS.flatMap(s => s.lines).find(l => l.k === "tempEquity");

// ── The mezzanine row asked for an element that does not exist ──────────────────────────────────
// `TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterest` — SINGULAR —
// was the second of three tags on the row and also held a slot in api/facts.js's KEEP. It is not a
// us-gaap element: SEC's frames API 404s it in every period tried while the PLURAL returns hundreds
// of filers in the same call. So the row's declared safety net for exactly the case it was missing
// could never win a column, and nothing could ever fail — the tag simply never matched.
//
// The cost was on the page. Seven filers' newest balance sheet failed to close by more than 0.2% of
// assets and SIX were explained to the dollar by a mezzanine line tagged under a name the template
// never asked for: Blackstone $1,381m, Prudential $2,794m, UnitedHealth $1,608m, Ventas $375m,
// Welltower $263m, Simon Property $233m. After the fix, non-closing filers go 7 -> 1, and the one
// that remains is Instacart, whose $195m is tagged only inside a class-of-stock dimension and is
// invisible to companyfacts (README open item 9, untouched by this).
// MUTATION: restoring the singular spelling, or dropping either added tag, fails here.
{
  const t = tempEquity.tags;
  ok(!t.includes("TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterest"),
    "the singular spelling is gone — it is not a us-gaap element and SEC 404s it");
  ok(t.includes("TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests"),
    "the PLURAL element is asked for — it is the one filers actually tag");
  ok(t.includes("RedeemableNoncontrollingInterestEquityCarryingAmount"),
    "and the other spelling filers use, which was never asked for at all");
  // Rule 11's discipline: first hit wins, so the new names must sit LAST or they would displace the
  // parent-only figure on the 16 filers already resolving it. Measured: 207 cells appeared and
  // 0 changed, which is only true because of this ordering.
  eq(t[0], "TemporaryEquityCarryingAmountAttributableToParent",
    "the parent-only concept still leads, so no filer that already resolved can move");
  const addedAt = Math.min(t.indexOf("TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests"),
    t.indexOf("RedeemableNoncontrollingInterestEquityCarryingAmount"));
  ok(addedAt > t.indexOf("TemporaryEquityCarryingAmount"),
    "and the two new names go last, after every concept that resolved before");
  // A tag the template asks for and the proxy drops silently never arrives — the rule api/facts.js
  // states about itself. Asserted here because this row is the one that proved it can happen.
  const keep = readFileSync(join(root, "api", "facts.js"), "utf8");
  for (const tag of t) ok(keep.includes(`"${tag}"`), `KEEP carries ${tag}, or the row asks for something that cannot reach the browser`);
  ok(!keep.includes('"TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterest"'),
    "and the dead singular no longer occupies a KEEP slot pretending to be a safety net");
}

// ── A derivation must not return the figure it was handed ───────────────────────────────────────
// `fillCol` writes `meta[k] = { status: "computed" }` for ANY derivation returning non-null, so a
// derivation that hands back the FETCHED value destroys the meta entry carrying the tag, the form
// and the accession. `DERIVED_BANK.nii` did exactly that, on net interest income — the top line of a
// bank's income statement. Measured: 0 of 64 bank columns carried a link to the filing, against
// 64 of 64 on the Deposits row beside it, on a page whose whole argument is provenance.
//
// The rule was already written for rule 22's gross profit and the `revenue` reconstruction two lines
// below does it correctly; `nii` was the only instance of the class in the file.
// MUTATION: restoring `v.nii != null ? v.nii` fails the first assertion.
{
  eq(DERIVED_BANK.nii({ nii: 95443000000, intIncTotal: 180000000000, intExpTotal: 84557000000 }), null,
    "a filer that TAGGED net interest income gets null back, so its accession survives (JPMorgan, $95.44bn)");
  eq(DERIVED_BANK.nii({ nii: null, intIncTotal: 100, intExpTotal: 40 }), 60,
    "a filer that tagged none gets the reconstruction — interest income less interest expense");
  eq(DERIVED_BANK.nii({ nii: null, intIncTotal: 100 }), 100,
    "and a missing interest-expense leg is treated as zero, which is the reconstruction's own rule");
  eq(DERIVED_BANK.nii({ nii: null, intIncTotal: null }), null, "no interest income, no reconstruction");
  // The sibling that always had it right. Asserted so the two cannot drift apart again.
  eq(DERIVED_BANK.revenue({ revenue: 182400000000, nii: 95400000000, noninterestIncome: 87000000000 }), null,
    "the revenue reconstruction has always returned null when the filer tagged one — same rule, same reason");
  // Structural: no derivation anywhere may return the value it was given for the key it fills.
  const src = readFileSync(join(root, "src", "extract.js"), "utf8");
  const selfReturning = [...src.matchAll(/^\s+(\w+): v => \(v\.(\w+) != null \? v\.\2\b/gm)].map(m => m[1]);
  eq(selfReturning.length, 0,
    `no derivation returns its own fetched value${selfReturning.length ? " — found: " + selfReturning.join(", ") : ""}. ` +
    `fillCol overwrites meta for any non-null return, so doing that silently deletes the cell's link to its filing.`);
}

done("t-balance");
