// Repairs to SEC's own ticker→CIK map.
//
// In its own module, rather than inside App.jsx, so the offline harness imports the SHIPPING table
// instead of a copy: this is exactly the kind of list that gets fixed in the app and silently left
// out of the tests. Neither repair belongs in public/tickers.json, because the annual chore
// regenerates that file wholesale and would drop a hand edit without a word.
//
// The corporate sweep found two different failures, and they need two different mechanisms.

// ── 1. Omissions ─────────────────────────────────────────────────────────────────────────────────
// American Electric Power is in neither company_tickers.json nor company_tickers_exchange.json,
// though its own submissions file lists AEP against seven 10-Ks. There is no row to correct — the
// company is simply absent and unsearchable — so the row is added.
export const TICKER_ADDITIONS = [
  { ticker: "AEP", cik: 4904, title: "AMERICAN ELECTRIC POWER CO INC" },
];

// ── 2. Holding-company reorganisations ───────────────────────────────────────────────────────────
// A reorganisation moves the ticker to a newly registered entity that has filed almost nothing, while
// the operating history stays under a predecessor CIK that no longer carries a ticker. XOM pointed at
// "ExxonMobil Holdings Corp" — no 10-K, one 10-Q, not a single annual revenue fact — and the terminal
// rendered an EMPTY SHEET for the largest energy company in the country.
//
// This is a FALLBACK, not an override, and that distinction is the whole design. A hard remap would
// be correct today and wrong the moment the successor files its own first 10-K, at which point it
// would pin the ticker to stale predecessor data — silently, and a year before the chore looks at it
// again. Consulted only when the primary CIK yields no annual periods, the table heals in both
// directions: it fires while the successor is empty, and stops firing the day it is not.
//
// An entry needs EVIDENCE, never a name match: the predecessor's submissions file carries the 10-Ks
// and the ticker's does not, and the two are demonstrably the same company. The scan that found these
// also turned up CNTMF, whose CIK is Cansortium (renamed Fluent Corp, cannabis) and whose name-match
// is Fluent, Inc. — an unrelated advertising company with its own ticker. Deliberately not here. A
// wrong entry points a ticker at another company's financials, which is the worst failure this tool
// has, so a suspect without a filing history to prove the lineage stays out.
export const PREDECESSOR = {
  XOM:  { cik: 34088,   title: "EXXON MOBIL CORP" },          // successor: ExxonMobil Holdings Corp
  NVRI: { cik: 45876,   title: "ENVIRI CORP" },               // successor: Enviri Corp (was Enviri II)
  DMRC: { cik: 1438231, title: "DIGIMARC CORP" },             // successor: was Deschutes Parent, Inc.
  CBAT: { cik: 1117171, title: "CBAK ENERGY TECHNOLOGY INC" },// successor: the Ltd redomiciliation
  FSSL: { cik: 1501729, title: "FS SPECIALTY LENDING FUND" }, // successor: New FS Specialty Lending Fund
};

export const applyTickerFixes = rows => {
  const out = rows.slice();
  for (const fix of TICKER_ADDITIONS) {
    const row = [fix.cik, fix.ticker, fix.title];
    const at = out.findIndex(([, t]) => t === fix.ticker);
    if (at >= 0) out[at] = row; else out.push(row);
  }
  return out;
};
