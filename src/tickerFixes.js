// Repairs to SEC's own ticker→CIK map.
//
// In its own module, rather than inside App.jsx, so the offline harness can import the SHIPPING
// table instead of a copy: this is exactly the kind of list that gets fixed in the app and silently
// left out of the tests, and both entries below exist because a test could not see the problem.
//
// The corporate sweep found two ways company_tickers.json puts a live S&P 500 company completely out
// of reach of the search box. Neither is repaired by editing public/tickers.json, because the annual
// chore regenerates that file wholesale and would drop any hand edit without a word.
//
// 1. A HOLDING-COMPANY REORGANISATION moves the ticker to a newly registered entity that has filed
//    almost nothing. XOM points at CIK 2115436, "ExxonMobil Holdings Corp" — no 10-K, one 10-Q, not
//    a single annual revenue fact — while eight years of Exxon Mobil Corp sit under CIK 34088, which
//    no longer carries a ticker at all. The terminal rendered an empty sheet for the largest energy
//    company in the country, under a message blaming IFRS.
// 2. AN OUTRIGHT OMISSION. American Electric Power is in neither company_tickers.json nor
//    company_tickers_exchange.json, though its own submissions file lists AEP and it has filed seven
//    10-Ks. Refreshing the source does not fix it; only adding the row does.
//
// Every entry needs the same evidence before it goes in: the CIK's submissions file carries the
// 10-Ks and the ticker's does not. Guessing here would point a ticker at another company's
// financials, which is the worst failure this tool has.
export const TICKER_FIXES = [
  { ticker: "XOM", cik: 34088, title: "EXXON MOBIL CORP" },
  { ticker: "AEP", cik: 4904, title: "AMERICAN ELECTRIC POWER CO INC" },
];

export const applyTickerFixes = rows => {
  const out = rows.slice();
  for (const fix of TICKER_FIXES) {
    const row = [fix.cik, fix.ticker, fix.title];
    const at = out.findIndex(([, t]) => t === fix.ticker);
    if (at >= 0) out[at] = row; else out.push(row);
  }
  return out;
};
