// Drives the SHIPPING src/reverse.js. A reverse DCF fails in exactly the way this site cannot afford:
// by printing a confident number for an input that has no answer. Every refusal below is therefore
// asserted by name, and the solve itself is proved by round trip — put the answer back into the
// model and the enterprise value comes out — rather than against a figure typed from memory.
import { ok, eq, near, done } from "./_t.mjs";
import { pvAtGrowth, impliedGrowth, sensitivity, pickBasis, dcfApplicable, REASONS, HORIZONS, G_MIN, G_MAX } from "../src/reverse.js";
import { NOT_APPLICABLE } from "../src/template.js";

// ---- is a reverse DCF the right question — decided by the template's own lists, not a copy ----
eq(dcfApplicable(NOT_APPLICABLE.bank), false, "a bank gets no reverse DCF (its sheet blanks unlevered FCF)");
eq(dcfApplicable(NOT_APPLICABLE.pc), false, "a P&C insurer gets none (its sheet blanks enterprise value)");
eq(dcfApplicable(NOT_APPLICABLE.life), false, "a life insurer gets none");
eq(dcfApplicable(NOT_APPLICABLE.corporate), true, "a corporate does (no list at all)");
eq(dcfApplicable(undefined), true, "an industry with no list is applicable");
ok(["bank", "pc", "life"].every(k => Array.isArray(NOT_APPLICABLE[k])), "the three lists this relies on still exist in the template");

// ---- the model, by hand ----
// One year, no growth, at 10%: 100/1.1 plus a terminal value of 100·1.02/0.08 discounted one year.
near(pvAtGrowth({ fcf: 100, g: 0, wacc: 0.10, tg: 0.02, years: 1 }), 100 / 1.1 + (100 * 1.02 / 0.08) / 1.1, 1e-9, "one-year PV matches the arithmetic done by hand");

// ...and the same thing with GROWTH IN IT, which is the assertion this file was missing.
//
// Mutation testing found six survivors and three were the same hole: every check on `pvAtGrowth`
// either used `g: 0`, where the growth convention cannot show, or was a ROUND TRIP — and a round
// trip cannot see the model's shape at all, because `impliedGrowth` solves against `pvAtGrowth`, so
// a mutation moves both sides together and the answer still comes back out. Three real breaks passed
// all 53 assertions: year-1 cash flow not grown, growth compounding twice a year, and the terminal
// value built off the STARTING cash flow instead of year N. Each is a silently different valuation.
//
// The fix is arithmetic written out term by term, not a second implementation — a mirror of the model
// would drift and pass while production broke, which is the reason this project imports shipping code
// everywhere else. Below, every cash flow is spelled out.
//
// Two years at 50% growth, 10% discount, zero terminal growth:
//   CF1 = 100 × 1.5 = 150        CF2 = 150 × 1.5 = 225
//   explicit PV = 150/1.1 + 225/1.1²
//   terminal    = CF2 × (1+0) / (0.10 − 0) = 2250, discounted the full two years
near(pvAtGrowth({ fcf: 100, g: 0.5, wacc: 0.10, tg: 0, years: 2 }),
  150 / 1.1 + 225 / 1.21 + 2250 / 1.21, 1e-9,
  "year 1 is the GROWN cash flow, growth compounds once a year, and the terminal value is built off year N — the three conventions a round trip cannot see");
// The one-year case pins the same thing without any compounding to hide behind: 150 and a terminal
// value of 1500, both discounted once, is exactly 1500.
near(pvAtGrowth({ fcf: 100, g: 0.5, wacc: 0.10, tg: 0, years: 1 }), 150 / 1.1 + 1500 / 1.1, 1e-9,
  "one year at 50% growth: the first cash flow is 150, not 100, and the terminal value grows off it");
// And once more with a terminal growth rate in play, so (1+tg) is pinned alongside the growth.
//   CF1 120 · CF2 144 · CF3 172.8, then 172.8 × 1.02 / 0.08 discounted three years
near(pvAtGrowth({ fcf: 100, g: 0.2, wacc: 0.10, tg: 0.02, years: 3 }),
  120 / 1.1 + 144 / 1.21 + 172.8 / 1.331 + (172.8 * 1.02 / 0.08) / 1.331, 1e-9,
  "three years at 20%, with terminal growth — the full model, every term written out");

// The strongest check in this file, and it needs no arithmetic typed from memory at all.
// When the explicit growth rate EQUALS the terminal growth rate there is no longer a two-stage
// model: it is one growing perpetuity, worth CF1/(wacc − g) and — this is the part that bites —
// completely INDEPENDENT OF THE HORIZON. Five years and thirty years must give the same number.
// A model that grows year 1 wrongly, compounds twice, or builds its terminal value off the starting
// cash flow all break this, and they break it without anyone having to know what the right answer
// is. It is a property of the mathematics rather than a value someone computed once.
{
  const perp = 100 * 1.03 / (0.09 - 0.03);
  for (const N of [1, 2, 5, 10, 30])
    near(pvAtGrowth({ fcf: 100, g: 0.03, wacc: 0.09, tg: 0.03, years: N }), perp, 1e-6,
      `g equal to terminal growth is a growing perpetuity — worth CF1/(wacc−g) at a ${N}-year horizon, same as at every other`);
}
ok(pvAtGrowth({ fcf: 100, g: 0.05, wacc: 0.10, tg: 0.02, years: 10 }) > pvAtGrowth({ fcf: 100, g: 0.04, wacc: 0.10, tg: 0.02, years: 10 }), "more growth is worth more — the monotonicity bisection relies on");
ok(pvAtGrowth({ fcf: 100, g: 0.05, wacc: 0.09, tg: 0.02, years: 10 }) > pvAtGrowth({ fcf: 100, g: 0.05, wacc: 0.10, tg: 0.02, years: 10 }), "a lower discount rate is worth more");

// ---- the solve, by round trip ----
const base = { fcf: 100, wacc: 0.10, tg: 0.02, years: 10 };
const evAt5 = pvAtGrowth({ ...base, g: 0.05 });
const r = impliedGrowth({ ev: evAt5, ...base });
ok(r.ok, "a priced-for-5% EV solves");
near(r.g, 0.05, 1e-6, "and the implied growth is the 5% the EV was built from");
near(pvAtGrowth({ ...base, g: r.g }), evAt5, 1e-6, "putting the answer back in returns the enterprise value");
eq(r.years, 10, "the horizon is reported");
near(r.fcfN, 100 * Math.pow(1.05, 10), 1e-6, "year-N cash flow is the grown figure");
ok(r.tvShare > 0 && r.tvShare < 1, "the terminal value is some but not all of the EV");
near(r.tvShare, (r.fcfN * 1.02 / 0.08 / Math.pow(1.1, 10)) / evAt5, 1e-9, "terminal share is PV of the terminal value over EV");
for (const g of [-0.3, -0.1, 0, 0.12, 0.4, 0.9]) {
  const ev = pvAtGrowth({ ...base, g });
  near(impliedGrowth({ ev, ...base }).g, g, 1e-6, `round trip at g = ${g}`);
}
const r5 = impliedGrowth({ ev: pvAtGrowth({ ...base, years: 5, g: 0.07 }), ...base, years: 5 });
near(r5.g, 0.07, 1e-6, "a five-year horizon solves too");
eq(HORIZONS, [5, 10], "two horizons on offer");
eq(impliedGrowth({ ev: evAt5, ...base, years: 7 }).years, 10, "an unknown horizon falls back to ten rather than solving a model the plate never shows");
// A richer price needs more growth; a lower discount rate needs less. Both directions are what a
// reader checks first, and both would silently invert if the bracket edges were swapped.
ok(impliedGrowth({ ev: evAt5 * 1.5, ...base }).g > 0.05, "a higher EV implies more growth");
ok(impliedGrowth({ ev: evAt5, ...base, wacc: 0.09 }).g < 0.05, "a lower WACC implies less growth for the same EV");

// ---- the refusals, each by name ----
eq(impliedGrowth({ ev: null, ...base }).reason, "no-ev", "no enterprise value");
eq(impliedGrowth({ ev: 0, ...base }).reason, "no-ev", "a zero enterprise value");
eq(impliedGrowth({ ev: 1000, ...base, fcf: -20 }).reason, "fcf-nonpositive", "negative free cash flow refuses");
eq(impliedGrowth({ ev: 1000, ...base, fcf: 0 }).reason, "fcf-nonpositive", "zero free cash flow refuses");
eq(impliedGrowth({ ev: 1000, ...base, wacc: NaN }).reason, "bad-inputs", "a blank WACC refuses");
eq(impliedGrowth({ ev: 1000, ...base, tg: undefined }).reason, "bad-inputs", "a blank terminal growth refuses");
eq(impliedGrowth({ ev: 1000, ...base, wacc: 1.2 }).reason, "bad-inputs", "a WACC over 100% refuses");
// The BOUNDARIES, not just the middle of each range. Both of these survived mutation: loosening
// `wacc >= 1` to `wacc > 1` and `wacc <= 0` to `wacc < -1` left every other assertion green. A cost
// of capital of exactly 100%, or a negative one, is a typo in the box rather than a valuation — and
// a negative WACC discounts the future UPWARDS, so the plate would print a confident growth rate off
// a model where later cash flows are worth more than nearer ones.
eq(impliedGrowth({ ev: 1000, ...base, wacc: 1 }).reason, "bad-inputs", "a WACC of exactly 100% refuses — the boundary, not just past it");
eq(impliedGrowth({ ev: 1000, ...base, wacc: 0 }).reason, "bad-inputs", "a WACC of exactly zero refuses");
eq(impliedGrowth({ ev: 1000, ...base, wacc: -0.05 }).reason, "bad-inputs", "a negative WACC refuses rather than discounting the future upwards");
eq(impliedGrowth({ ev: 1000, ...base, wacc: 0.02, tg: 0.02 }).reason, "wacc-below-terminal", "WACC equal to terminal growth refuses (infinite terminal value)");
eq(impliedGrowth({ ev: 1000, ...base, wacc: 0.02, tg: 0.03 }).reason, "wacc-below-terminal", "WACC below terminal growth refuses");
eq(impliedGrowth({ ev: pvAtGrowth({ ...base, g: G_MIN }) * 0.5, ...base }).reason, "below-bracket", "a price below a 50%-a-year decline refuses rather than printing a rate");
eq(impliedGrowth({ ev: pvAtGrowth({ ...base, g: G_MAX }) * 2, ...base }).reason, "above-bracket", "a price above doubling every year refuses");
ok(Object.keys(REASONS).length === 6 && ["no-ev", "fcf-nonpositive", "bad-inputs", "wacc-below-terminal", "below-bracket", "above-bracket"].every(k => REASONS[k].length > 20), "every refusal has a sentence");
ok(!Object.values(REASONS).some(s => /!/.test(s)), "no exclamation marks in the refusals");

// ---- the sensitivity table ----
const s = sensitivity({ ev: evAt5, ...base });
eq(s.rows.length, 3, "three WACC rows");
ok(s.rows.every(row => row.length === 3), "three terminal-growth columns");
near(s.rows[1][1], 0.05, 1e-6, "the centre cell is the headline figure");
near(s.waccs[0], 0.09, 1e-12, "WACC one point down on the first row");
near(s.tgs[2], 0.025, 1e-12, "terminal growth half a point up on the last column");
ok(s.rows[0][1] < s.rows[1][1] && s.rows[1][1] < s.rows[2][1], "implied growth rises with WACC down the column");
ok(s.rows[1][0] > s.rows[1][1] && s.rows[1][1] > s.rows[1][2], "and falls with terminal growth across the row");
const sBad = sensitivity({ ev: evAt5, ...base, wacc: 0.025, tg: 0.02 });
eq(sBad.rows[0][2], null, "a cell whose WACC drops below its terminal growth is null, not a number");
// The horizon has to reach the table too. The plate lets a reader toggle 5/10 years, and a grid that
// silently stayed on ten would disagree with the sentence above it — the one thing the centre-cell
// assertion exists to prevent, arriving through the argument instead of the arithmetic.
{
  const ev5 = pvAtGrowth({ fcf: 100, wacc: 0.10, tg: 0.02, years: 5, g: 0.07 });
  const s5 = sensitivity({ ev: ev5, fcf: 100, wacc: 0.10, tg: 0.02, years: 5 });
  near(s5.rows[1][1], 0.07, 1e-6, "a five-year table's centre cell is the five-year answer");
  near(s5.rows[1][1], impliedGrowth({ ev: ev5, fcf: 100, wacc: 0.10, tg: 0.02, years: 5 }).g, 1e-12,
    "and it agrees with the headline solved at the same horizon");
}

// ---- which cash flow ----
eq(pickBasis({ v: { ufcf: 80, fcf: 95 } }).k, "ufcf", "unlevered FCF is preferred when it exists");
eq(pickBasis({ v: { fcf: 95 } }).k, "fcf", "levered FCF is the fallback");
ok(/after interest/.test(pickBasis({ v: { fcf: 95 } }).note), "and the fallback says it is after interest");
eq(pickBasis({ v: { ufcf: null, fcf: null } }), null, "no cash flow, no basis");
eq(pickBasis(null), null, "no column, no basis");
// `finite` is doing real work here and nothing was checking it. Loosening it to `!= null` survived
// every other assertion — and a NaN reaching the plate is not a blank, it is a headline that reads
// "NaN" beside an enterprise value. NaN is exactly what a derived cash flow produces when one of its
// inputs is missing, which is the ordinary case on this sheet rather than the exotic one.
eq(pickBasis({ v: { ufcf: NaN, fcf: 95 } }).k, "fcf", "a NaN unlevered FCF is not a cash flow — it falls through to the levered basis");
eq(pickBasis({ v: { ufcf: Infinity, fcf: 95 } }).k, "fcf", "nor is an infinite one");
eq(pickBasis({ v: { ufcf: NaN, fcf: NaN } }), null, "and two of them is no basis at all, not a NaN headline");
eq(pickBasis({ v: { ufcf: "80", fcf: 95 } }).k, "fcf", "a numeric STRING is not a number either — it would concatenate downstream, not add");

done("t-reverse");
