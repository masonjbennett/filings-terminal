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
  carries every tag ever reported; the template needs ~235 of them. Also returns the numeric SIC.
- `api/sections.js` — reads a filing's `FilingSummary.xml` so a line the filer never tagged can link
  to the exact rendered statement or footnote, rather than "somewhere around page 47".
- `api/quote.js` — share price ONLY. Market cap is computed as price × the company's own cover-page
  share count, so the EV bridge stays traceable to filings with exactly one outside input. Needs
  `FINNHUB_KEY`; without it the valuation block says so.
- `src/template.js` — 279 line items across 15 core sections plus industry overlays, grounded in standard
  IB/PE model structure and in Goldman Sachs' own disclosed methodology from the EA merger proxy
  (DEFM14A, Nov 2025 — worth reading if you touch the valuation sections).
- `src/extract.js` — the selection engine. Everything correct or wrong about the numbers is here.

**Every sheet is a URL.** `filings.masonjbennett.com/?t=CB` opens Chubb before anyone types, and
searching normally rewrites the address bar to match, so any lookup can be pasted into an email —
"here is the combined ratio, check the filings yourself" is now a link rather than an instruction.
`replaceState` rather than `pushState`, so the back button leaves the terminal instead of walking
back through a search history; an unrecognised ticker leaves the search box usable rather than
erroring, because a mistyped share link should still land somewhere useful.

**Every reported figure is a link to the filing it came from.** Click any number that was fetched
rather than computed and EDGAR's filing-detail page opens — form type, filing date, and *period of
report* matching the column you clicked from, with the document one click further. That is the
difference between claiming traceability and demonstrating it: the header has always said each
figure is traceable to an accession number, but until the cells became links that was only provable
through a hover tooltip, which is invisible on a phone, in a screenshot, and to anyone reading over
a shoulder.

Two decisions inside it:

- **Per cell, not per column.** Rule 2 takes the newest filing, so a column's figures routinely come
  from several. Apple's FY2025 revenue links to the 10-K filed Oct-2025; its FY2025 *cash* links to
  a 10-Q filed Jul-2026, which carried that balance sheet as its comparative. One Apple sheet spans
  nine filings and one Chubb sheet ten. A link on the year header would be quietly wrong in exactly
  the cases a careful reader checks first.
- **Computed lines are deliberately not linked.** EBITDA, free cash flow, the combined ratio and FFO
  exist in no filing, and sending someone to EDGAR to look for one would be the single dishonest
  thing on a page whose whole argument is provenance. They keep the ƒ marker and stay plain text.

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

6. **The calendar is RECENT first, then deep, and it is per-industry.** Three failures, each of
   which rendered a sheet that looked entirely healthy and was simply about the wrong years.
   *First tag that yields anything*: Lincoln National tags
   `RevenueFromContractWithCustomerExcludingAssessedTax` exactly once, for 2018, because only a
   $1.3bn slice of its revenue is in ASC 606 scope — the whole terminal became a single 2018 column.
   *Tag with the most years*, the obvious fix: Equinix tags `Revenues` 2013–2020 and the 606 tag
   from 2019, so counting years picked the dead one and rendered FY2013–FY2020 in 2026. The rule is
   now: find the newest annual period any candidate reaches, keep only tags that reach it, take the
   deepest of those. Separately, Wells Fargo stopped filing `Revenues` after 2019 and showed four
   stale columns ending FY2019, so `PERIOD_TAGS` gives each industry its own anchors (interest
   income for a bank, premiums for a carrier) with net income as a last resort. The bank overlay had
   shipped against JPM and BAC, which both still tag `Revenues`.
7. **A partial total is worse than no total.** `sum()` treats a missing input as zero, which is
   right for adding up debt-like items and wrong for anything a reader will divide by. Progressive
   tags `LongTermDebtCurrent` as literally `0` and reports its real $6.9bn under
   `DebtLongtermAndShorttermCombinedAmount`, so the three-way corporate debt sum returned **0** —
   printing "Total debt 0", "Debt / equity 0.00x" and a net debt of *minus* $10.1bn. Carriers now
   prefer their own all-in debt tag, and every combined-ratio input is null-checked explicitly. The
   same rule blanks EBITDA without a real EBIT (VICI reported its $4m of D&A as EBITDA and a
   4,041x Net debt/EBITDA) and blanks total debt when only the *current portion* of long-term debt
   resolved (Equinix: $1.3bn against $33.8bn of real estate).
8. **A subtotal that looks derivable usually is not.** Deriving a missing EBIT as
   revenue − `CostsAndExpenses` was written, tested and removed: that tag is "total costs **and
   expenses**" and for most filers includes interest, so the difference is pre-tax income, not
   operating income. Welltower derived to *minus* $480m and Realty Income to $963m against a real
   ~$2.1bn. A wrong EBIT does not stay put — it propagates into EBITDA, three margins, NOPAT, ROIC
   and EV/EBITDA. Filers that never tag `OperatingIncomeLoss` now show a blank EBIT and EBITDA.
9. **Revenue means the TOTAL, so `Revenues` leads the tag list.**
   `RevenueFromContractWithCustomer…` is only the ASC 606 slice. The two coincide at an operating
   company and diverge violently at a financial: MetLife's 606 revenue is $2.4bn of fee income
   against $77.1bn of total revenue, so the sheet reported **3%** of the top line and every margin
   and growth rate built on it. Berkshire read 33% low, Welltower 22%. Reordering is free where
   `Revenues` is stale or absent — `pickFact` skips a tag with no fact for the period, so Apple
   (never files it) and Equinix (stopped in 2020) fall through exactly as before.

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

- **Bank** (SIC 6020–6199) — DONE, and **swept across 10 filers** (Aug 2026) after shipping on two.
  Bank income statement, loans/deposits/securities, and bank ratios (efficiency, loans/deposits,
  allowance coverage, equity/assets). `NOT_APPLICABLE.bank` blanks the lines a depository does not
  have, including every EBITDA-based leverage ratio: a bank is levered on capital ratios, so Net
  debt/EBITDA is a category error rather than a gap.

  The sweep held up better than the record suggested — money-centres, regionals, a card issuer and a
  custody bank all populate, and State Street's 0.17 loans/deposits is correct for a custodian
  rather than a bug. Three things it did find: **Capital One reported $1.1bn of total debt** (its
  short-term borrowings alone) against a real $52bn, because it files neither long-term tag the
  chain knew; **Truist had no revenue line at all**, now reconstructed as NII + fees, an identity
  that holds exactly at JPMorgan; and Wells Fargo's and American Express's loan balances are
  company extensions, so they stay blank. Amex's revenue also moved $41bn → $72bn, the same ASC 606
  slice problem as MetLife.
- **Insurance** (SIC 6300–6411) — DONE, as **four** overlays rather than one. See below.
- **REIT** (SIC 6798) — DONE. Property operations, FFO, real estate and REIT ratios. See below.
- **Broker-dealer / advisory / alt manager** (SIC 6200–6299) — DONE. One code range, three
  businesses: bulge-bracket broker-dealers (GS, MS, JEF, SCHW, RJF, IBKR), advisory boutiques (EVR,
  LAZ, PJT, HLI, MC) and alternative managers (BX, KKR, APO). Deliberately the smallest overlay —
  the corporate sheet already serves them once the top line resolves — adding only the compensation
  ratio, pre-tax margin, tangible common equity and ROTE.

  **The compensation ratio is the point.** It is what the sector is run, valued and recruited on,
  and the spread across the three business models is the business model: computed **GS 32.4% ·
  MS 41.4% · JEF 35.7% · SCHW 27.1% · EVR 64.5% · LAZ 65.4% · PJT 67.6% · HLI 61.5% · BX 38.9%**.
  `LaborAndRelatedExpense` covers 13 of the 15 firms tested; Moelis is why
  `EmployeeBenefitsAndShareBasedCompensation` is the fallback. ROTE rather than ROE because goodwill
  from acquired advisory teams is not capital that absorbs a loss — Goldman's reads 14.5%, which is
  the figure it sets targets against.

  Two blanks that are correct: KKR and Apollo tag no compensation figure, and Moelis tags no
  standard revenue concept at all (only `RevenueFromRelatedParties`), so its revenue and comp ratio
  stay empty rather than guessed.

Verified against JPM and BAC: deposits $2.56tn/$2.02tn, NII $95.4bn/$60.1bn, efficiency 52.4%,
ROE 15.7%, equity/assets 8.2%. Test any overlay on **at least three filers** — the bank work looked
finished against JPM alone and was not.

### Insurance is four industries, not one

Splitting the SIC range was the first thing the research forced, because these do not share a
metric:

| SIC | Routes to | Why |
|---|---|---|
| 6300–6310, 6331–6399 | `pc` | Combined ratio, reserve development, premium leverage, float |
| 6311, 6321 | `life` | No combined ratio at all — benefit ratio, reserves, book value ex-AOCI |
| 6324 | `health` | An operating company whose cost of goods is medical claims. **Keeps** EBIT, EBITDA and EV multiples |
| 6411 | `corporate` | Agents and brokers underwrite nothing. AJG, AON, BRO and ERIE file `RevenueFromContractWithCustomer` and `CostsAndExpenses` like any services firm — the corporate sheet is already correct for them, so they get no overlay |

Tested against 26 filers. What it cost to get right:

- **The combined ratio is a consolidated GAAP ratio and says so on the row.** It runs a point or
  three from the company's own figure, which is non-GAAP with its own definition. Computed: PGR
  87.4%, TRV 92.5%, CB 87.7%, WRB 90.7%, CINF 95.8%, AIG 95.1%.
- **Scope has to match on both sides of the divide.** `PolicyholderBenefitsAndClaimsIncurredNet` is
  short-duration business only but `PremiumsEarnedNet` is consolidated, so Chubb's life arm printed
  a **77.4%** combined ratio — ten points better than anything it has reported. Its life benefits
  sit in `LiabilityForFuturePolicyBenefitsPeriodExpense`; adding them back makes both halves
  consolidated and gives 87.7%.
- **The expense half is the weak point, and the obvious fallback is a trap.**
  `OtherUnderwritingExpense` is filed by only two of eight carriers. `OtherCostAndExpenseOperating`
  is the right line for Allstate ($9.0bn) and a **$34m scrap** at Cincinnati Financial against
  $10.0bn of premium — an 18.9% expense ratio and an 85.4% combined ratio for a carrier that runs
  near 96%. Plausible, right units, ten points wrong. Replaced with Schedule III's
  `SupplementaryInsuranceInformationOtherOperatingExpense`, ordered *after* the income-statement
  tags because at Progressive the Schedule sweeps in $1.2bn of non-underwriting cost.
- **Two big filers are simply unreachable, and that is the correct answer.** Allstate tags its
  claims expense with a company extension, and companyfacts carries **no** custom namespaces —
  only `us-gaap`, `dei`, `srt`, `invest`, `ecd`. Berkshire (SIC 6331) tags not one insurance
  concept. Both render blank with a link to the filed statement. The near-miss:
  `LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1` looks like the incurred-claims
  total and is filed by six of eight — but at Allstate it collapses from $29.3bn to $2.65bn once the
  figure is only tagged inside a segment breakdown, leaving a dimensionless residual. It would have
  printed a 4.7% loss ratio. It is deliberately in no tag list.
- **Float fails closed.** Allstate and Cincinnati both stop filing any reinsurance-recoverable tag,
  and treating an unknown recoverable as zero overstated Allstate's float by billions.

Where a carrier's data genuinely is not tagged, the sheet is blank: Allstate and Berkshire have no
combined ratio, Aflac and Berkley no total debt, Centene no premium line, Molina no MLR.

### REIT

A REIT, unlike a bank or a carrier, **is** an operating company: it keeps EBIT, EBITDA, EV/EBITDA
and Net debt/EBITDA, which is the leverage metric the sector is quoted on. `NOT_APPLICABLE.reit` is
therefore almost empty. What the corporate template misses is that GAAP net income is close to
meaningless here — depreciating buildings that are appreciating pushes reported earnings far below
cash generation, which is the entire reason FFO exists.

Tested against ten filers (O, PLD, SPG, AMT, EQIX, AVB, VICI, WELL, DLR, ESS). FFO per share
computed against reported: **O $4.27 · PLD $6.22 · AMT $9.97 · AVB $11.38 · WELL $4.63 · DLR $6.46 ·
ESS $15.18** — seven of ten within a rounding of the filed figure.

- **FFO is reconstructed, and every input is a row directly above it** so the arithmetic is
  auditable on the page: net income to common + D&A − gains on sale + impairment.
- **The add-back is total D&A, not Schedule III.** `SECScheduleIII…DepreciationExpense` is the only
  universally tagged (10/10) real-estate depreciation figure, and it is shown — but it is buildings
  only. At Realty Income it is $1.6bn against $2.5bn of total D&A, the gap being lease-intangible
  amortisation, which NAREIT also adds back. Using it alone put FFO 23% low.
- **FFO blanks when it can prove it is wrong.** The gain adjustment only happens if the filer tags a
  gain, which lets an untagged one through. Simon reports $4.6bn of net income on $3.2bn of
  operating income and tags no property gain at all: FFO came out at $18.54/share against the ~$13
  Simon reports. So if no gain is tagged **and** net income to common exceeds operating income,
  material gains demonstrably exist and were demonstrably not removed — blank instead. Realty Income
  also out-earns its operating income but tags its gain, so it is unaffected.
- **Two REITs are structurally different and mostly blank, correctly.** VICI's leases are sales-type,
  so it holds financing receivables rather than depreciable property and has almost no depreciation;
  Equinix stops tagging net income to common. Neither gets an FFO.
- **Net debt/EBITDA is blank for the three REITs that never tag `OperatingIncomeLoss`** (O, VICI,
  WELL). Deriving EBIT as revenue − `CostsAndExpenses` was tried and removed — see rule 8.

Still missing, and genuinely not in any filing as a tagged figure: **AFFO/Core FFO** (every REIT
defines it differently), same-store NOI, and occupancy. AFFO is a `manual` row that says so.

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

1. **Corporate cross-sector sweep.** The corporate template carries ~10,000 of the 10,387 tickers
   and has only ever been checked against a handful. Every shared-engine change in the insurance/
   REIT session — revenue tag order, the calendar rule, EBITDA, total debt — lands hardest here.
   Sample across energy, retail, pharma, industrials and software.
2. **Segments** — a genuinely different data path: `companyfacts` carries **no dimensional data at
   all** (facts are `start, end, val, accn, fy, fp, form, filed, frame` and nothing else), so
   segment and geographic revenue need the raw XBRL instance or the R-files.
3. **Multi-company comps** — metric definitions already exist in the template; needs a second
   fetch path and a column-per-company layout.

## A note on how this got built

Every session so far has turned up a bug that automated checks passed and actual use caught — a
label that read "needs price" beside a populated cell, section titles that scrolled off-screen, a
valuation block whose only real value sat outside the viewport. Query the DOM to confirm a number,
but **look at the page** before calling it done.

The insurance/REIT session added two more, and the second is the sharpest example yet. Long
explanatory notes inherited `white-space: nowrap` from the cell and widened the sticky label column
from 303px to 503px, pushing three year-columns off an 8-year sheet — caught by measuring the
rendered geometry, invisible in the data. And Chubb shipped a **$155bn enterprise value, 2.62x
EV/Revenue and 12.12x EV/FCF**, the exact three rows `NOT_APPLICABLE.pc` exists to suppress: App's
quote block runs *after* the blanking pass and wrote values back over it. That one could not be
reproduced locally at all, because the quote needs `FINNHUB_KEY` and local dev has none — it was
found by looking at production. The harness now simulates the quote block for that reason: if a code
path only executes in production, the test has to fake it or it is not tested.
