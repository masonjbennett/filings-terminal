# Filings Terminal — filings.masonjbennett.com

Pulls reported financials straight from SEC EDGAR into a model-ready sheet. Every figure is the
value the company filed, traceable to the accession number it came from. **No AI anywhere in the
data path** — nothing is estimated, inferred or written by a model, which is the whole point: a
number on this page can be defended in an interview.

Separate Vercel project from the main site on purpose. `mason-bennett-dashboard` sits at Vercel
Hobby's 12-function cap, and the recruiting front door should not be able to break because a filing
lookup did.

## How it works

- `public/tickers.json` — SEC's company list (10,387 names, 432KB), shipped once and searched in
  the browser. No server round trip to turn "AAPL" into a CIK.
- `api/facts.js` — proxies `data.sec.gov` (which sends no CORS headers, so a browser cannot read it
  directly) and **slims the payload**: a large filer's companyfacts document is 10–15MB because it
  carries every tag ever reported; the template needs ~110 of them. Also returns the numeric SIC.
- `api/sections.js` — reads a filing's `FilingSummary.xml` so a line the filer never tagged can link
  to the exact rendered statement or footnote, rather than "somewhere around page 47".
- `api/quote.js` — share price ONLY. Market cap is computed as price × the company's own cover-page
  share count, so the EV bridge stays traceable to filings with exactly one outside input. Needs
  `FINNHUB_KEY`; without it the valuation block says so.
- `src/template.js` — 168 line items across 15 sections plus industry overlays, grounded in standard
  IB/PE model structure and in Goldman Sachs' own disclosed methodology from the EA merger proxy
  (DEFM14A, Nov 2025 — worth reading if you touch the valuation sections).
- `src/extract.js` — the selection engine. Everything correct or wrong about the numbers is here.

## Rules in the extraction engine

Each was learned by probing real filings, and each fails **silently** if broken:

1. **Period shape.** Income and cash-flow facts are durations; balance-sheet facts are instants. A
   10-Q files both discrete-quarter and year-to-date spans for the same tag, so lines are chosen by
   period length. Ignore this and EBITDA comes out as nine months against a full-year balance sheet.
   Sections declare `instant: true` themselves — this was once hardcoded by section id, and the
   first industry overlay to add a balance sheet silently resolved nothing.
2. **Latest filed wins.** Seven of Apple's nine annual revenue periods appear in more than one
   filing, because each 10-K restates two prior years as comparatives.
3. **Tag fallbacks are ordered, and must span TAXONOMY ERAS.** Not just synonyms — tags get retired.
   CECL replaced the bank loan and securities tags around 2020–21 with `…ExcludingAccruedInterest`
   variants; `LoansAndLeasesReceivableNetReportedAmount` stops in 2016. `pickFact` skips any tag
   with no fact for the period, so listing both eras fixes recent and historical years at once.
4. **Some facts are "as of latest filing", not "as of a period".** The cover-page share count is
   dated the day the filing went out, so it matches no period end. Mark those `latest: true`.
5. **A blank is not one thing.** *n/a for a bank* (does not exist for this filer type), *n/a* (never
   tagged), *not tagged* (disclosed but untagged — go look), *judgement* (never auto-filled),
   *needs price*. Only "not tagged" is worth hunting by hand; conflating them sends you chasing
   numbers that do not exist.

Column labels come from the **period end date**, never from XBRL's `fy` — `fy` is the fiscal year of
the *report* a fact was filed in, so the year to Sept-2018 carries fy=2019 as a comparative and two
adjacent columns both rendered "FY2019". Columns run **oldest → newest**, the way a model does, and
the sheet opens scrolled to the right-hand edge.

## Layout

Three tabs, organised by **statement, not by analysis**: Statements · Ratios · Valuation.

A DCF, an LBO and a comps set all run off the same revenue, EBITDA, capex and net debt — tabbing by
analysis would print the same twenty lines in four places under a taxonomy the data does not have.
Bloomberg's `FA` splits I/S, B/S, C/F and Ratios for the same reason: the terminal is the source,
the model is where the analysis happens. **This tool is the Historicals tab**, not a worse copy of
the four tabs built off it. Measured before deciding: an LBO tab would be 43% fillable and a PTA tab
50%, against 100% for the three statements.

Lines no filing contains — add-backs, maintenance capex, sources & uses, deal terms — are a footer
headed *"Deliberately not computed"*, not a tab. Knowing where to stop is the part a finance reader
will actually check.

Valuation sits above all three tabs and populates the **newest column only**. There is one price, so
EV/EBITDA against FY2019 would be today's enterprise value over a six-year-old profit.

## Industry overlays

Detected from the **SIC code SEC assigns** (`api/facts.js` returns `sicCode`), never inferred from
which tags are present — a corporate with a finance arm reports loans too.

- **Bank** (SIC 6020–6199) — DONE. Bank income statement, loans/deposits/securities, and bank
  ratios (efficiency, loans/deposits, allowance coverage, equity/assets). `NOT_APPLICABLE.bank`
  blanks the lines a depository does not have, including every EBITDA-based leverage ratio: a bank
  is levered on capital ratios, so Net debt/EBITDA is a category error rather than a gap.
- **Insurance** (SIC 6311–6411) — line items sketched in `OVERLAYS`, not wired.
- **REIT** (SIC 6798) — same.

Verified against JPM and BAC: deposits $2.56tn/$2.02tn, NII $95.4bn/$60.1bn, efficiency 52.4%,
ROE 15.7%, equity/assets 8.2%. Test any overlay on **at least three filers** — the bank work looked
finished against JPM alone and was not.

## Deploying

Vercel project → this repo. One environment variable: `FINNHUB_KEY` (same value as the main site;
Vercel does not share env vars across projects). Env vars only apply to **new** deployments, so
redeploy after adding it. Domain is a CNAME at Cloudflare — set **DNS only, grey cloud**, or
certificate issuance fails.

`npm run dev` runs the serverless functions too, via a small plugin in `vite.config.js`, so local
development exercises the real code path against real SEC responses.

## Chores

- **Annually**, alongside the January refresh on the main site: re-download `public/tickers.json`
  from `https://www.sec.gov/files/company_tickers.json` (needs a declared User-Agent) so newly
  listed companies are searchable.
- SEC requires a User-Agent with real contact details and caps traffic at 10 requests/second. Both
  are honoured in `api/*.js`. **Do not remove the UA** — requests without one are refused, and the
  failure looks like a network error rather than a policy rejection.

## Next

1. **Insurance overlay** (SIC 6311–6411) — premiums earned, losses & LAE incurred, combined ratio,
   reserves, investment income. Same shape as the bank work.
2. **REIT overlay** (SIC 6798) — FFO, AFFO, NOI, same-store NOI, rental revenue.
3. **Segments** — a genuinely different data path: `companyfacts` carries **no dimensional data at
   all** (facts are `start, end, val, accn, fy, fp, form, filed, frame` and nothing else), so
   segment and geographic revenue need the raw XBRL instance or the R-files.
4. **Multi-company comps** — metric definitions already exist in the template; needs a second
   fetch path and a column-per-company layout.

## A note on how this got built

Every session so far has turned up a bug that automated checks passed and actual use caught — a
label that read "needs price" beside a populated cell, section titles that scrolled off-screen, a
valuation block whose only real value sat outside the viewport. Query the DOM to confirm a number,
but **look at the page** before calling it done.
