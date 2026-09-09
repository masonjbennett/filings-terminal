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

// ---- which cash flow ----
eq(pickBasis({ v: { ufcf: 80, fcf: 95 } }).k, "ufcf", "unlevered FCF is preferred when it exists");
eq(pickBasis({ v: { fcf: 95 } }).k, "fcf", "levered FCF is the fallback");
ok(/after interest/.test(pickBasis({ v: { fcf: 95 } }).note), "and the fallback says it is after interest");
eq(pickBasis({ v: { ufcf: null, fcf: null } }), null, "no cash flow, no basis");
eq(pickBasis(null), null, "no column, no basis");

done("t-reverse");
