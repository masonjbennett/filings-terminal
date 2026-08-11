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
  the browser. No server round trip to turn "APPLE" into a CIK.
- `api/facts.js` — proxies `data.sec.gov` (which sends no CORS headers, so a browser cannot read it
  directly) and **slims the payload**: a large filer's companyfacts document is 10–15MB because it
  carries every tag ever reported; the template needs ~93 of them.
- `api/sections.js` — reads a filing's `FilingSummary.xml` so a line the filer never tagged can link
  to the exact rendered statement or footnote, rather than "somewhere around page 47".
- `src/template.js` — 168 line items across 15 sections, grounded in standard IB/PE model structure
  and in Goldman Sachs' own disclosed methodology from the EA merger proxy (DEFM14A, Nov 2025).
- `src/extract.js` — the selection engine. Everything correct or wrong about the numbers is here.

## Four rules in the extraction engine

Each was learned by probing real filings, and each fails silently if broken:

1. **Period shape.** Income and cash-flow facts are durations; balance-sheet facts are instants. A
   10-Q files both discrete-quarter and year-to-date spans for the same tag, so lines are chosen by
   period length. Ignore this and EBITDA comes out as nine months against a full-year balance sheet.
2. **Latest filed wins.** Seven of Apple's nine annual revenue periods appear in more than one
   filing, because each 10-K restates two prior years as comparatives.
3. **Tag fallbacks are ordered.** Revenue alone has four common spellings.
4. **A blank is not one thing.** *n/a* (never tagged by this filer), *not tagged* (disclosed but
   untagged — go look), *judgement* (never auto-filled), *needs price*. Only the second is worth
   hunting by hand, and conflating them sends you chasing numbers that do not exist.

Column labels come from the **period end date**, never from XBRL's `fy` — `fy` is the fiscal year of
the *report* a fact was filed in, so the year to Sept-2018 carries fy=2019 as a comparative and two
adjacent columns both rendered "FY2019".

## Deploying

1. Push this folder to its own GitHub repo.
2. New Vercel project pointing at it. No environment variables — nothing here needs a secret.
3. Vercel → Settings → Domains → add `filings.masonjbennett.com`, then add the CNAME it shows you
   at your DNS provider.

`npm run dev` runs the serverless functions too, via a small plugin in `vite.config.js`, so local
development exercises the real code path against real SEC responses.

## Chores

- **Annually**, alongside the January refresh on the main site: re-download `public/tickers.json`
  from `https://www.sec.gov/files/company_tickers.json` (needs a declared User-Agent) so newly
  listed companies are searchable.
- SEC requires a User-Agent with real contact details and caps traffic at 10 requests/second. Both
  are honoured in `api/*.js`. **Do not remove the UA** — requests without one are refused, and the
  failure looks like a network error rather than a policy rejection.

## Known gaps

- **Industry overlays are defined but not yet applied.** `OVERLAYS` in `template.js` holds bank,
  REIT and insurance line items; nothing selects them by SIC code yet, so JPMorgan fills ~37% of a
  corporate template against Apple's ~82%. The data is there — JPM tags *more* concepts than Apple
  — the template is simply the wrong shape for it.
- **No segment or geographic breakdowns.** `companyfacts` carries no dimensional data at all; the
  fact object is only `start, end, val, accn, fy, fp, form, filed, frame`. Segments live in the raw
  XBRL instance or the R-files, which is a different data path.
- **No market data**, so EV, multiples and yields show as *needs price*. The main site's Finnhub
  proxy already supplies quotes and could feed this.
- **Multi-company comps** is the intended next step; the metric definitions are already in place.
