// What's priced in — the reverse DCF. Given today's enterprise value and the newest year's free cash
// flow, solve for the constant growth rate in that cash flow that makes a plain DCF land on the
// price. The two judgement inputs — cost of capital and terminal growth — are the reader's, exactly as
// the template rules for the `wacc` row ("never auto-filled"); this file never supplies a default.
//
// Pure, so it can be tested without a browser: no DOM, no fetch, no clock. The plate in App.jsx
// only formats what comes out of here.
//
// The model is the plain one a first-year builds: N years of cash flow growing at g, discounted at
// r, plus a Gordon terminal value at the end of year N growing at gT. Nothing fancier on purpose —
// the answer is only as good as the reader's r and gT, and a model with more moving parts would
// hide that rather than state it.

export const HORIZONS = [5, 10];
// The bracket the solve searches. Outside it the answer is not a growth rate a reader can use, so the
// plate says so in words instead of printing −63% or 240%.
export const G_MIN = -0.5, G_MAX = 1.0;

// Present value of the cash-flow stream at growth g. Exported so a test can prove the solve by
// round-tripping: solve for g, put g back in, get the EV out.
export function pvAtGrowth({ fcf, g, wacc, tg, years }) {
  let pv = 0, cf = fcf;
  for (let t = 1; t <= years; t++) { cf *= 1 + g; pv += cf / Math.pow(1 + wacc, t); }
  const tv = cf * (1 + tg) / (wacc - tg);
  return pv + tv / Math.pow(1 + wacc, years);
}

// The reasons a solve refuses, each a sentence the plate prints instead of a number. A reverse DCF
// that prints something for a negative cash flow or for a WACC below terminal growth is printing
// nonsense with confidence, which on this site is the one unforgivable thing.
export const REASONS = {
  "no-ev": "No enterprise value to solve against.",
  "fcf-nonpositive": "The newest year's free cash flow is zero or negative — there is nothing to grow, so the price cannot be read as a growth rate.",
  "bad-inputs": "Cost of capital and terminal growth are needed first.",
  "wacc-below-terminal": "The cost of capital has to exceed terminal growth, or the terminal value is infinite.",
  "below-bracket": "Even a 50%-a-year decline in free cash flow is worth more than this price — the price sits outside what a growth rate can describe.",
  "above-bracket": "The price needs free cash flow to more than double every year for the whole horizon — outside what a constant growth rate can describe.",
};

const finite = v => typeof v === "number" && Number.isFinite(v);

// Solve for g. Bisection on a bracket, because pvAtGrowth is monotonic in g for a positive cash flow
// and bisection cannot be talked into a wrong answer by a flat region the way Newton can.
export function impliedGrowth({ ev, fcf, wacc, tg, years = 10 }) {
  if (!finite(ev) || ev <= 0) return { ok: false, reason: "no-ev" };
  if (!finite(fcf) || fcf <= 0) return { ok: false, reason: "fcf-nonpositive" };
  if (!finite(wacc) || !finite(tg) || wacc <= 0 || wacc >= 1) return { ok: false, reason: "bad-inputs" };
  if (wacc <= tg) return { ok: false, reason: "wacc-below-terminal" };
  const n = HORIZONS.includes(years) ? years : 10;
  const f = g => pvAtGrowth({ fcf, g, wacc, tg, years: n }) - ev;
  if (f(G_MIN) > 0) return { ok: false, reason: "below-bracket" };
  if (f(G_MAX) < 0) return { ok: false, reason: "above-bracket" };
  let lo = G_MIN, hi = G_MAX;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  const g = (lo + hi) / 2;
  const fcfN = fcf * Math.pow(1 + g, n);
  const tvPv = fcfN * (1 + tg) / (wacc - tg) / Math.pow(1 + wacc, n);
  return { ok: true, g, years: n, fcfN, tvShare: tvPv / ev };
}

// The 3×3 the reader actually looks at: the cost of capital one point either way, terminal growth
// half a point either way. The centre cell IS the headline figure, asserted, so the table and the
// sentence above it cannot disagree.
export function sensitivity({ ev, fcf, wacc, tg, years = 10, dw = 0.01, dg = 0.005 }) {
  const waccs = [wacc - dw, wacc, wacc + dw], tgs = [tg - dg, tg, tg + dg];
  return { waccs, tgs, rows: waccs.map(w => tgs.map(t => { const r = impliedGrowth({ ev, fcf, wacc: w, tg: t, years }); return r.ok ? r.g : null; })) };
}

// Whether a reverse DCF is even the right question for this filer, decided by the template's own
// NOT_APPLICABLE list rather than a second opinion here: an industry whose sheet blanks unlevered free
// cash flow or enterprise value (a bank is valued on capital ratios; a carrier's liabilities are the
// business) has no honest cash flow to grow, and the plate says so instead of solving. JPMorgan
// otherwise printed an enterprise value against "free cash flow" of −$148bn — cash from operations at
// a bank swings with deposits and trading, and growing it is not a valuation.
export const dcfApplicable = naList => !(naList || []).includes("ufcf") && !(naList || []).includes("ev");

// Which cash flow to grow. Unlevered free cash flow is the one an enterprise-value DCF discounts;
// it is a computed line (nopat + D&A − capex − ΔNWC) and blank on filers missing any input, so the
// plate falls back to cash from operations less capex — after interest, and it says so — rather than
// showing nothing. The basis is named on the plate either way; a reader who cares knows the difference.
export function pickBasis(col) {
  const v = col && col.v ? col.v : {};
  if (finite(v.ufcf)) return { k: "ufcf", v: v.ufcf, label: "unlevered free cash flow", note: "NOPAT + D&A − capex − change in NWC, the cash flow an enterprise-value DCF discounts" };
  if (finite(v.fcf)) return { k: "fcf", v: v.fcf, label: "free cash flow", note: "cash from operations less capex — after interest, so it is levered; unlevered FCF is blank for this filer" };
  return null;
}
