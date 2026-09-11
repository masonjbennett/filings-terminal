// Rule 25 — the change in working capital, off the filer's own cash flow statement.
//
// Drives the SHIPPING `changeInWorkingCapital`, `promoteWorkingCapital` and `DERIVED.ufcf`. The
// facts are hand-built here rather than cached from SEC, so the suite runs offline and forever —
// but every fixture below is a REAL shape taken from a real filer, named in its assertion, with the
// figures as filed. The two that settle the sign convention (Chevron FY2018, Coca-Cola FY2018) are
// the only filers in the 160 swept that tag BOTH their own working-capital subtotal AND its
// components, which is the only place the convention can be checked rather than asserted.
//
// Mutation-tested: each block below was proved to FAIL with the original defect reintroduced. The
// mutations used are named in the comments, because an assertion that passes for the wrong reason
// is worse than no assertion — this project has already shipped one of those.
import { ok, eq, near, done } from "./_t.mjs";
import { changeInWorkingCapital, promoteWorkingCapital, WC_IMMATERIAL, DERIVED } from "../src/extract.js";
import { NOT_APPLICABLE } from "../src/template.js";

// A minimal companyfacts-shaped payload. One annual duration per tag, plus instants where asked.
const FY = { start: "2024-01-01", end: "2024-12-31", fy: 2024 };
const mk = (tags, instants = {}) => {
  const f = {};
  for (const [tag, val] of Object.entries(tags))
    f[tag] = { label: tag, units: { USD: [{ start: FY.start, end: FY.end, val, fy: 2024, fp: "FY", filed: "2025-02-01", form: "10-K", accn: "0000000000-25-000001" }] } };
  for (const [tag, val] of Object.entries(instants))
    f[tag] = { label: tag, units: { USD: [{ end: FY.end, val, fy: 2024, fp: "FY", filed: "2025-02-01", form: "10-K", accn: "0000000000-25-000001" }] } };
  return f;
};
const run = (facts) => changeInWorkingCapital(facts, "USD", t => {
  const d = facts[t]; if (!d) return null;
  const r = (d.units.USD || []).find(x => x.start === FY.start && x.end === FY.end);
  return r ? { value: r.val, unit: "USD", tag: t, accn: r.accn, form: r.form, filed: r.filed } : null;
}, FY.end);

// ── The sign convention, settled against the two filers that file both halves ───────────────────
// Chevron FY2018 tags IncreaseDecreaseInOperatingCapital at 718 and its components sum to 718.
// An asset growing USES cash, a liability growing SOURCES it, so dWC = assets - liabilities + net.
// MUTATION: flipping to (liabilities - assets) fails here; so does dropping the net term.
{
  const facts = mk({
    IncreaseDecreaseInAccountsReceivable: 1000,
    IncreaseDecreaseInInventories: 300,
    IncreaseDecreaseInAccountsPayable: 500,
    IncreaseDecreaseInAccruedLiabilities: 82,
  }, { InventoryNet: 5000 });
  const r = run(facts);
  eq(r.value, 718, "assets minus liabilities: 1000 + 300 - 500 - 82 = 718 (the Chevron FY2018 shape)");
  eq(r.wcSource, "components", "and it is reported as a component sum, not as the filer's own line");
}

// ── The catch-all net line, which most filers lean on hardest ───────────────────────────────────
// 3M FY2025: AR 211, inventories -139, AP 21, and IncreaseDecreaseInOtherOperatingCapitalNet 3,145
// carrying everything else — 211 - 139... no: assets 211 + (-139) = 72, liabilities 21, net 3,145,
// so 72 - 21 + 3,145 = 3,196. The net term is 98% of the answer here and is ALREADY net of both
// sides, so it is added with an asset's sign rather than differenced.
// This block exists because mutation testing found the suite could not see the net term at all:
// `IncreaseDecreaseInOtherOperatingCapitalNet` is the second most common working-capital tag in the
// census (62 of 160 filers) and dropping it from the sum passed every other assertion in this file.
{
  const r = run(mk({
    IncreaseDecreaseInAccountsReceivable: 211,
    IncreaseDecreaseInInventories: -139,
    IncreaseDecreaseInAccountsPayable: 21,
    IncreaseDecreaseInOtherOperatingCapitalNet: 3145,
  }, { InventoryNet: 3500 }));
  eq(r.value, 3196, "3M FY2025: the catch-all net line carries 98% of the movement and is summed with it");
  eq(r.wcTags, 4, "and all four components are counted");
}

// ── The filer's own subtotal outranks its components, and is not ADDED to them ──────────────────
// Coca-Cola files IncreaseDecreaseInOperatingCapital AND the components that make it up. Summing
// both read exactly 2x — the rule 21/23 defect one statement over. This is the assertion that
// would have caught it.
// MUTATION: adding the subtotal to the component sum yields 14416 and fails.
{
  const facts = mk({
    IncreaseDecreaseInOperatingCapital: 7208,
    IncreaseDecreaseInAccountsReceivable: -334,
    IncreaseDecreaseInInventories: 154,
    IncreaseDecreaseInAccountsPayableAndAccruedLiabilities: -6612,
    IncreaseDecreaseInAccruedIncomeTaxesPayable: -558,
    IncreaseDecreaseInPrepaidDeferredExpenseAndOtherAssets: 388,
  }, { InventoryNet: 4000 });
  const r = run(facts);
  eq(r.value, 7208, "Coca-Cola FY2025: the filer's own subtotal wins, and the components are not added to it");
  eq(r.wcSource, "subtotal", "and the row says which it used");
  eq(r.tag, "IncreaseDecreaseInOperatingCapital", "the subtotal keeps its tag, so the cell still links to the filing");
  ok(!!r.accn, "and its accession");
}

// ── A combined tag is taken only where neither of its parts is ──────────────────────────────────
// MUTATION: summing the combined tag unconditionally double counts payables.
{
  const both = run(mk({
    IncreaseDecreaseInAccountsReceivable: 100,
    IncreaseDecreaseInAccountsPayable: 40,
    IncreaseDecreaseInAccruedLiabilities: 10,
    IncreaseDecreaseInAccountsPayableAndAccruedLiabilities: 50,
  }, { InventoryNet: 0 }));
  eq(both.value, 50, "the parts are tagged, so the combined tag is skipped: 100 - 40 - 10 = 50");
  const comboOnly = run(mk({
    IncreaseDecreaseInAccountsReceivable: 100,
    IncreaseDecreaseInAccountsPayableAndAccruedLiabilities: 50,
  }, { InventoryNet: 0 }));
  eq(comboOnly.value, 50, "neither part is tagged, so the combined tag is used: 100 - 50 = 50");
}

// ── Rule 7: a partial movement is refused, not subtracted ───────────────────────────────────────
// Ungated, Target FY2023 would have contributed a partial dWC of $2.44bn against a UFCF of $0.30bn
// and Alphabet FY2018 -$6.68bn against -$0.91bn. The refusal is the whole safety story.
// MUTATION: returning `assets - liabs + net` regardless of the missing leg passes everything else
// in this file and fails here.
{
  const noRecv = run(mk({ IncreaseDecreaseInAccountsPayable: 500, IncreaseDecreaseInInventories: 300 }, { InventoryNet: 9000 }));
  eq(noRecv.value, null, "no receivables movement tagged: the sum is refused rather than subtracted");
  eq(noRecv.status, "wc-partial", "and it is refused as PARTLY tagged, never as 'not tagged'");
  eq(noRecv.wcMissing.join(","), "ar", "naming the leg that is missing");
  ok(noRecv.wcRaw === -200, "the raw sum travels with the refusal, for the materiality reconsideration");

  const noPays = run(mk({ IncreaseDecreaseInAccountsReceivable: 100 }, { InventoryNet: 0 }));
  eq(noPays.wcMissing.join(","), "ap", "no payables or accruals tagged is equally a refusal");

  const noInv = run(mk({ IncreaseDecreaseInAccountsReceivable: 100, IncreaseDecreaseInAccountsPayable: 50 }, { InventoryNet: 9000 }));
  eq(noInv.wcMissing.join(","), "inventory", "a filer CARRYING inventory must tag its movement");

  // ...but a filer with no inventory on its balance sheet is not missing anything. Demanding the
  // tag from a services company would blank it for not reporting something it does not have.
  const svc = run(mk({ IncreaseDecreaseInAccountsReceivable: 100, IncreaseDecreaseInAccountsPayable: 50 }, { InventoryNet: 0 }));
  eq(svc.value, 50, "a filer carrying no inventory needs no inventory movement: 100 - 50 = 50");
}

// ── Nothing tagged at all is a DIFFERENT blank from a partial one ───────────────────────────────
{
  const none = run(mk({ NetIncomeLoss: 100 }, {}));
  eq(none.value, null, "a filer tagging no working-capital movement at all gets no figure");
  eq(none.status, "not-tagged", "and that blank is 'not tagged' — go and look — which a partial one is not");
}

// ── The materiality reconsideration, and the denominator that makes it work ─────────────────────
// Alphabet's entire inventory is 7% of its unlevered cash flow, so its absence cannot move the
// answer; Costco's untagged receivables are 68% of its, so they can. Scaling by REVENUE instead
// would wave Costco through — 1.2% — which is the filer this test most needs to stop.
// MUTATION: scaling by revenue, or dropping the promotion entirely, each fail a half of this.
{
  const partial = { status: "wc-partial", wcRaw: 281, wcMissing: ["inventory"], wcTags: 6 };
  // ebit 100, tax 20, pretax 100 -> nopat 80; + da 40 - capex 20 = 100 of cash flow.
  const base = { ebit: 100, tax: 20, pretax: 100, da: 40, capex: 20, ar: 50, ap: 30 };

  const small = { v: { ...base, inventory: 5 }, meta: { chgNwc: { ...partial } } };
  promoteWorkingCapital(small.v, small.meta);
  eq(small.v.chgNwc, 281, "an immaterial missing leg (5 against 100 of cash flow) is promoted");
  eq(small.meta.chgNwc.wcImmaterial, "inventory", "and the column records WHICH leg was waived");

  const big = { v: { ...base, inventory: 68 }, meta: { chgNwc: { ...partial } } };
  promoteWorkingCapital(big.v, big.meta);
  eq(big.v.chgNwc, undefined, "a material missing leg (68 against 100 — the Costco shape) stays refused");
  eq(big.meta.chgNwc.status, "wc-partial", "and keeps its partly-tagged status");

  const edge = { v: { ...base, inventory: 100 * WC_IMMATERIAL }, meta: { chgNwc: { ...partial } } };
  promoteWorkingCapital(edge.v, edge.meta);
  eq(edge.v.chgNwc, 281, "exactly at the threshold is promoted — the boundary is asserted, not assumed");

  // An UNBOUNDED leg is never promoted. 78 of the 164 refusals are this shape: the movement is
  // untagged and so is the balance, so there is no evidence the leg is small — only an absence.
  const unbounded = { v: { ...base, inventory: null }, meta: { chgNwc: { ...partial } } };
  promoteWorkingCapital(unbounded.v, unbounded.meta);
  eq(unbounded.v.chgNwc, undefined, "a missing leg whose BALANCE is also untagged cannot be shown to be small");

  // No cash flow to scale against means no verdict, rather than a verdict on a zero denominator.
  const noScale = { v: { ...base, ebit: null, inventory: 5 }, meta: { chgNwc: { ...partial } } };
  promoteWorkingCapital(noScale.v, noScale.meta);
  eq(noScale.v.chgNwc, undefined, "no EBIT means no scale, so no promotion — not a division by nothing");
}

// ── ufcf REQUIRES the change in working capital, and blanks without it ──────────────────────────
// This is the bug rule 25 exists to close: the template declared `nopat + da - capex - chgNwc` and
// the engine computed `nopat + da - capex`, so the Valuation tab printed a figure the plate beside
// it described as something else. Measured over 160 filers, the omission moved the implied growth
// rate by a median 1.97 points and by more than a point on 39 of 60.
// MUTATION: restoring `v.nopat + (v.da||0) - (v.capex||0)` fails the second assertion below.
{
  eq(DERIVED.ufcf({ nopat: 100, da: 40, capex: 20, chgNwc: 25 }), 95, "unlevered FCF subtracts the working-capital movement: 100 + 40 - 20 - 25");
  eq(DERIVED.ufcf({ nopat: 100, da: 40, capex: 20, chgNwc: null }), null, "and BLANKS without it rather than silently meaning something else");
  eq(DERIVED.ufcf({ nopat: null, da: 40, capex: 20, chgNwc: 25 }), null, "no NOPAT, no unlevered FCF");
  // A negative movement RELEASES cash and must add to it. Getting this backwards would still
  // produce a plausible number, which is why it is asserted rather than left to the formula.
  eq(DERIVED.ufcf({ nopat: 100, da: 0, capex: 0, chgNwc: -30 }), 130, "working capital released adds to free cash flow");
}

// ── An industry with no working capital must say so, not "partly tagged" ────────────────────────
// Found by LOOKING at the page, which is the only place it could be found: JPMorgan's row read
// "partly tagged", inviting a reader to go hunting in a 10-K for a depository's working-capital
// movement. A bank's balance sheet is not classified into current and non-current at all, which is
// why `nwc` was already blanked for it — `chgNwc` had simply not been added beside it. Rule 5's
// complaint, arriving through the door a NEW status opened.
// MUTATION: removing "chgNwc" from either list fails here.
for (const ind of ["bank", "pc", "life"]) {
  ok(NOT_APPLICABLE[ind].includes("chgNwc"),
    `a ${ind} filer's change in working capital reads "n/a", never "partly tagged"`);
  ok(NOT_APPLICABLE[ind].includes("nwc") === NOT_APPLICABLE[ind].includes("chgNwc"),
    `and it is blanked in step with net working capital itself, for ${ind} — the two cannot drift apart`);
}

done("t-wc");
