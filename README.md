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
   *needs price*, and — since rule 20 — *filed in USD* (tagged for this period, in a currency this
   sheet is not in). Only "not tagged" is worth hunting by hand; conflating them sends you chasing
   numbers that do not exist, or into a 20-F after a figure that is sitting there in the wrong unit.

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

10. **The ticker→CIK map itself can be wrong, and then nothing downstream matters.** SEC's
    `company_tickers.json` is the only thing turning "XOM" into a company, and the corporate sweep
    found two ways it fails. A **holding-company reorganisation** moves the ticker to a newly
    registered entity: XOM points at CIK 2115436, "ExxonMobil Holdings Corp", which has filed no
    10-K, one 10-Q and not a single annual revenue fact, while eight years of Exxon sit under CIK
    34088 — which no longer carries a ticker at all. The terminal rendered an **empty sheet for the
    largest energy company in the country**, under a message blaming IFRS. And **outright omission**:
    American Electric Power is in neither `company_tickers.json` nor `company_tickers_exchange.json`,
    though its own submissions file lists AEP against seven 10-Ks, so no refresh will ever fix it.
    Both are repaired in `src/tickerFixes.js` rather than by editing `public/tickers.json`, which the
    annual chore regenerates wholesale — and they need **two different mechanisms**. An omission has
    no row to correct, so the row is added. A reorganisation does have a row, and hard-remapping it
    would be right today and wrong the moment the successor files its own first 10-K, at which point
    it would pin the ticker to stale predecessor data silently, a year before the chore looks again.
    So `PREDECESSOR` is a **fallback consulted only when a lookup produced no annual periods**: it
    fires while the successor is empty and stops firing the day it is not. The retry also has to
    cover a **failed** response, not just an empty one — an entity that has never filed has no
    companyfacts document at all and data.sec.gov answers 404, which is CBAT's case exactly.

    **Is XOM the only one? No — there are five, and the scan that found them is `t-tickers.mjs`.**
    Fetching 10,387 companyfacts documents would be tens of gigabytes; EDGAR's quarterly `form.idx`
    answers the same question for ~120MB, since it lists every filing with form type, CIK and company
    name. 2,123 of the 10,387 tickers have filed no 10-K since 2024 — overwhelmingly ETFs, trusts,
    funds and SPACs, for which a blank sheet is the right answer — so the signature to hunt is
    narrower: no annual report under this CIK, while a **near-identical company name** has them.
    That yields five, all confirmed against submissions data: XOM, **NVRI** (successor "Enviri Corp",
    history under CIK 45876, now named ENVIRI LLC), **DMRC** (predecessor is literally named "Old
    Digimarc CORP"), **CBAT** (a redomiciliation; both entities list the ticker) and **FSSL**.

    The scan also produced one **false positive, deliberately excluded**: CNTMF's CIK is Cansortium,
    renamed Fluent Corp, a cannabis company — and its name-match is Fluent, Inc., an unrelated
    advertising firm with its own ticker FLNT and a former-name chain running back to Tiger Media. A
    name match is not evidence. An entry goes in only when the predecessor's submissions file carries
    the 10-Ks, the ticker's does not, and the two are demonstrably the same company; a guess here
    points a ticker at another company's financials, which is the worst failure this tool has.

11. **Where a debt tag sits in the list decides whether it fixes or breaks eight filers.** The sweep
    added `LongTermDebtAndCapitalLeaseObligations`, without which Southern Co reported **$722m of
    total debt — its short-term borrowings alone — against $66bn**; Sempra read $4.2bn, Cigna a
    confident **$0.0bn**, and Dow, Nucor and Snowflake rendered blank. Placed with its siblings
    (third) it *also* displaced the tags above it, which include current maturities, quietly removing
    the current portion from eight filers that were already right — Coca-Cola fell $1.8bn, Comcast
    $5.9bn, RTX $3.4bn. It belongs **last**, where it only fires for a filer that tags nothing else.

    A third case, added when the lending top lines went in: **a tag can be right for most filers and
    wrong for one industry**, which is a different thing from a tag being wrong. `omitFor` on a line
    removes named tags for a named industry, and the industry sets could not express it before —
    `NOT_APPLICABLE` blanks a whole LINE, which is too blunt when the line is right and one candidate
    on it is not. See rule 14.

    The related trap, once deliberately not fixed and now closed by **rule 15**: `LongTermDebt` means
    "including current maturities" at some filers and "excluding" at others — Duke tags it inclusively
    (non-current 80.1 + current 7.1 = 87.2), Home Depot appears to use it for the non-current balance
    alone. Adding a current-portion tag on top moved twelve filers by billions with no way to tell
    which had just been double counted. It needed a per-filer test, not a tag; it now has one.

12. **A figure stitched across periods must have all its legs on ONE basis, and rule 2 is usually
    what guarantees that — until it isn't.** A trailing twelve months is the last full year plus
    this year to date less last year to the same date. Take the newest filed version of each leg and
    a divestiture is handled for free: it re-presents the prior periods, and the newest version of
    every leg picks the re-presentation up at once. Honeywell's first half of 2025 was filed at
    **$20.17bn and re-filed at $18.25bn** after the Solstice spin; Occidental's at **$13.22bn and
    $10.96bn** after OxyChem. Both stitch correctly, because both annual figures had already moved —
    Occidental's 10-K restated its own 2024 comparative from $26.7bn to $22.0bn.

    That is a fact about those two filers, not a rule. The interim legs pick up a re-presentation at
    the next **10-Q** and the annual leg only at the next **10-K**, so a divestiture completed
    mid-year leaves two or three quarters where the annual leg is the old basis and the interim legs
    are the new one. FY *including* a sold business plus a delta *excluding* it is neither, and it is
    wrong by that business's half-year — right units, right magnitude, a different company inside it.

    It is detectable, because a re-presentation always sweeps the comparatives with it: **if the
    prior leg has moved since it was first filed, the annual leg shares its basis only if that
    filing also restated the year before it** — checked against that accession, not against "was it
    ever restated". No evidence either way fails closed. This fires for **2 of 89** filers swept, so
    the blank is rare enough to be worth its certainty, and the case has to be built by hand to see
    it fire at all: `t-ltm.mjs` strips the restated comparative out of Honeywell's 10-K and asserts
    the line goes blank. A guard that has never been seen to fire is not a guard.

    The same stitch has a second rule, which is rule 9 wearing different clothes: **all three legs
    come from the tag the ANNUAL column chose, and only that tag.** A filer tagging `Revenues` in its
    10-K and only the ASC 606 slice in its 10-Qs would otherwise have a total stitched onto the
    change in a component of itself. Costco is exactly that and its LTM revenue is **blank**, which
    is the honest answer and is marked as one on the page.

13. **Only the periodic reports are the financial statements, and rule 2 was handing the sheet to
    everything else.** A 10-K or 10-Q *is* the statements. An 8-K exhibit is a press release, a
    pro-forma, or a recast of a combination; a DEF 14A carries `NetIncomeLoss` inside the
    pay-versus-performance table. All three are filed under the same tags for the same periods, and
    "newest filed wins" made them win.

    Black Diamond Therapeutics reported net income of **minus $69.68bn against a real minus $70m**,
    from a proxy statement — an ROE of −83,660%, which the small/mid-cap sweep had first filed under
    "correct for a biotech". Essential Utilities is subtler and worse. Its FY2023 operating income is
    **$0.692bn in three successive 10-Ks and $1.504bn in an 8-K filed a month after the newest**,
    with D&A and net income doubled to match — a bigger entity than the one it reports. The sheet
    paired the 10-K's revenue with the 8-K's operating income and printed **EBITDA above revenue for
    three straight years**. That impossibility was read as a revenue-tag problem first, and
    "fixing" it by reordering the rule 9 list would have made revenue wrong as well.

    Preferring the periodic filings is **not enough**, because a concept can appear only outside
    them: Essential Utilities files `NetIncomeLossAvailableToCommonStockholdersBasic` in that 8-K and
    nowhere else, and the Schwab repair then lifted it straight into net income. So non-periodic
    filings are excluded outright. Measured across 167 filers before and after: **864 values
    corrected, 39 lost** — seven cells in total, all in the oldest column of two sheets and all minor
    lines (Disney's FY2018 investing and financing flows, a preferred dividend of zero). 228 values
    moved from an 8-K to a 10-K, 148 from a DEF 14A, 12 from a 6-K to a 20-F.

14. **A lender files no revenue concept at all, and the obvious substitute is a profit measure.** A
    business development company and a mortgage REIT rendered with a blank top line — and therefore
    no margin, no growth, no asset turn and no EV/Revenue — because neither tags `Revenues` or any
    ASC 606 concept. Carlyle Secured Lending and Ladder Capital are the two in the sweep.

    `NetInvestmentIncome` is the obvious candidate for a BDC and is **wrong in exactly the way rule 9
    is about**: it is struck AFTER operating expenses. Carlyle's is $102.7m against $255.6m of gross
    investment income and $152.9m of expenses, so it would have put an operating profit in the revenue
    row and made every margin beneath it meaningless. The line the filing calls total investment
    income is `GrossInvestmentIncomeOperating`, and it also had to be added to `api/facts.js`'s KEEP —
    the harness caught that as a still-blank row, which is the whole reason it drives the shipping
    handler rather than a copy of it.

    **Where the tag sits was decided by rule 11 and where it applies had to be invented.** Both new
    tags go LAST, so they only fire for a filer nothing else reaches. That is not sufficient: a
    depository files `InterestAndDividendIncomeOperating` too, as its GROSS interest income, and
    filling the revenue row from it also switched off `DERIVED_BANK.revenue` — the reconstruction that
    produces the correct bank top line of net interest income plus fees, which only runs when the
    fetched row is empty. Five small banks moved to gross interest income and **not one of them looked
    broken**: Hawthorn's FY2019 read $64m against a real $58m, with every margin under it rebased.
    Hence `omitFor` on the line, and hence the standing rule — `full-diff.mjs` over all 167 filers
    before and after, which is what showed 7 filers moving where 2 were intended. After the fix: **2
    filers moved, 0 values changed, 95 appeared, 0 vanished.**

    The row that results does not mean what its label says, so it says so: `tagNote` is `blankNote`'s
    opposite — a note keyed to the newest column's RESOLVED TAG rather than to the row being empty, so
    it appears only on the filers it describes. Rule 5's discipline applied to a figure that is there.

15. **Whether the current maturities are already inside the long-term figure is a fact about the
    FILER, and the tag name is not evidence.** This is rule 11's open trap, and what made it look
    unfixable was reaching for a tag to settle it. The decisive case: Chevron and Verizon both fill
    the long-term debt row from `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities`,
    whose name says outright that it includes them — and **at Chevron it does not**, $33.57bn against
    a $33.48bn non-current balance with $6.72bn of current maturities sitting outside it. A repair
    keyed on the name would have stripped $6.7bn from a filer that was already right.

    The filer settles it on its own filings. Where it tags both the resolving tag *T* and
    `LongTermDebtNoncurrent` at the same date, *T* = Noncurrent means *T* excludes the current portion
    and *T* = Noncurrent + Current means it includes it. That is the filer's **convention**, not a
    property of the period, so it is read from any year it ever tagged both — usually an older one,
    because a filer still tagging the unambiguous concept today would never reach the ambiguous one —
    and applied to the years where only *T* resolves. Every reading must agree; a filer that changed
    convention gets no verdict, and no verdict changes nothing.

    Its boundary is the lease component. Where the ambiguous tag also carries finance leases — the
    `…AndCapitalLeaseObligations…` family does — `T` equals neither Noncurrent nor Noncurrent + Current
    and no verdict is reached, which is correct behaviour and does cost Tronox a $39m double count. A
    lease-aware variant of the identity was considered and is not available: Tronox's lease residual
    is not tagged at all, so there is nothing to add back.

    Measured across all 167: **12 filers are exposed** (the long-term row filled from a tag that could
    contain current maturities, with a non-zero current portion beside it). Of those, 5 EXCLUDE and
    are already right, 4 are undecidable from their own filings and are left alone, and 3 INCLUDE.
    Only **two of those three reach the page through the sum** — Verizon's is rescued by a guard
    written for something else entirely, its own `DebtLongtermAndShorttermCombinedAmount` outranking
    the three-way sum at $158.15bn, which happens to equal *T* plus short-term borrowings exactly.
    Relying on that would be relying on an accident. The two corrected are **Warner Bros Discovery**
    ($32.71bn → $32.57bn newest, and $45.45bn → $43.67bn in FY2023) and **Old Dominion** ($100m →
    $80m, a quarter of its total debt). `full-diff.mjs`: 2 filers moved, none appeared, none vanished.

    The row itself stays on the sheet, because it is a figure the filer reported — but it is no longer
    summed, and a reader adding the debt rows up would otherwise get a different number from the total
    printed below them. So it says so, which is the same obligation the Segments tab took on. That
    needed a third kind of note: `blankNote` fires on an empty row, `tagNote` on which tag resolved,
    and `flagNote` on something the engine worked out.

16. **Two debt rows filed at the same non-zero value on the same date are ONE line, not two.** Iridium
    tags `ShortTermBorrowings` and `LongTermDebtCurrent` at the same $3m and the three-way sum counted
    it twice. Its balance sheet has a single current-liability debt line — *"Short-Term Debt 3,402"* —
    carrying both tags, and so does every filer this fires for: UPS files *"Current maturities of
    long-term debt and commercial paper"*, AMD *"Current portion of long-term debt, net"*, GE
    HealthCare *"Short-term borrowings"*, Target *"Unsecured debt and other borrowings"*.

    Equality is the whole test, and what makes it safe is that the population is not close. Across the
    167 filers, at **every date either concept was ever filed** including quarter ends: **20 non-zero
    equal observations against 1,548 differing**. A filer with two genuinely distinct balances is
    nowhere near — Exxon $201m against $348m, Chevron $384m against $66m, Walmart $1.51bn against
    $5.85bn — so there is no near-miss regime for a coincidence to hide in. All seven filers producing
    an equal pair were read out of their rendered balance sheets and all seven have a single line.
    Zero is excluded because it is not evidence: 38 observations have both rows at zero.

    **Two better-looking tests were measured and neither shipped, because each reaches only part of
    it.** Asking whether the filer ever files the two differently — rule 15's own shape, and the first
    thing to try — is over-strict: AMD's interim quarters differ by $3m because one leg is the balance
    sheet and the other the debt footnote, and its statement still carries one line. Asking whether the
    filer's own `LiabilitiesCurrent` has room for the figure twice is a genuine structural
    impossibility and it misses Iridium, whose operating lease liability is tagged separately *and*
    sits inside the accrued line it also tags, so the components overshoot either way.

    It corrects two filers. **UPS FY2019 $28.66bn → $25.24bn**, a 13.5% overstatement that carried
    Debt/equity 8.77x → 7.73x and Net debt/EBITDA 2.26x → 1.92x, and **Iridium $1,763.9m → $1,760.5m**.
    AMD and JBTM are the same shape and were already right by a different route — their own
    `DebtLongtermAndShorttermCombinedAmount` outranks the three-way sum — so the flag fires and the
    total does not move, which the suite asserts in both directions. `full-diff.mjs`: 2 filers moved,
    0 appeared, 0 vanished, 0 source-form moves.

    It composes with rule 15 rather than competing: rule 16 decides whether the short-term row is the
    same figure as the current portion, rule 15 decides whether that figure is already inside the
    long-term row. A filer with both verdicts drops it from the sum entirely, which is right.

    **The note it needed exposed a silent gap in rule 15's.** `flagNote` was keyed to the NEWEST
    column, which is correct for `blankNote` — a blank note answers "why is this row empty", asked
    about the column the valuation divides into, and keying it to the newest is exactly what makes it
    fire on the half-blank case. A flag note discharges a different obligation: a column whose rows do
    not add up to its own total has to say why, and that debt is owed by whichever column carries the
    flag. Keyed to the newest, **three filers went silent** — Old Dominion drops the current portion
    from six columns and its newest is not one of them, so the row rule 15 exists to explain had been
    rendering with no explanation since rule 15 shipped; RDNT the same; and UPS's duplicate is in its
    oldest column. Now any column carrying the flag shows the note. Found by looking at the page.

17. **An amendment can carry the right digits at the wrong scale, and rule 13's door has a second
    hinge.** Rule 13 excluded DEF 14A outright because a proxy tags `NetIncomeLoss` inside the
    pay-versus-performance table. A 10-K/A filed only to add Part III carries that **same table** — and
    it is a periodic report by rule 13's own regex, so rule 2 hands it the sheet. The restatement frame
    was drawn to test exactly that, and it found the failure on the first pass: **Identiv filed FY2021
    net income as $1,620,000 in three consecutive 10-Ks and as $1,620,000,000,000 in a 10-K/A** — the
    same digits with six extra zeros — so the terminal printed a **$1.62 trillion net income** for a
    company with $110m of revenue. FY2022 and FY2023 were wrong the same way.

    **Two hypotheses were measured first and both failed, which is why the rule that shipped is so
    narrow.** "A Part III amendment carries no financial statements, so it supplies few tags" does not
    separate them at all — the amendments that disagree wildly supply a **median of 46** template tags,
    because they are genuine re-filings. And amendments that disagree are overwhelmingly *legitimate*:
    of **109 sheet cells where an amendment overrode a periodic report with a different value, 108 are
    restatements a reader wants**, and rule 2 is right about every one.

    What separates the one is that a restatement changes the **digits** while a scale error moves the
    **decimal point**. Exactly one of the 109 differs by an exact power of ten. That is still not
    sufficient on its own, because the same slip fires in both directions: **Middlesex Water** tags its
    share count in thousands in some filings and in units in others, and there the **amendment is the
    correct one**. So the discriminator is corroboration — across all 29 power-of-ten disagreements in
    the frame, Identiv's is the only one where **no periodic filing anywhere agrees with the
    amendment** while two or more agree with the other. Middlesex's amended scale has two witnesses;
    National HealthCare's has two and its amendment is right, which rule 2 already delivers.

    Uncorroborated, off by exactly a power of ten, and outvoted two to none. Anything short of all
    three leaves the sort exactly as it was. `full-diff.mjs` across the 167 already swept: **byte-identical
    to before the change** — 0 filers moved, 0 values changed, 0 source-form moves.

18. **A column is a fiscal YEAR, and fresh-start accounting files periods that are not.** The annual
    window was drawn at 300–400 days to sit safely outside 52–53 weeks, and nothing had ever landed in
    the slack. Emergence from Chapter 11 does: fresh-start accounting cuts the year in half at the
    effective date and the filer reports a **predecessor** stub and a **successor** stub, both under
    the same annual tags. Six of them were inside the window and rendered as fiscal years.

    **CBL's ten months to 31 October 2021 were labelled "FY2021"** and sat between FY2020 and FY2022
    reading **$575.9m → $468.0m → $563.0m** — a 19% collapse and a 20% recovery, neither of which
    happened, on a sheet that footed and reconciled throughout. California Resources and Chord are the
    same predecessor shape; Noble (from 6 Feb 2021), Seadrill (23 Feb 2022) and Vroom (15 Jan 2025)
    are the successor shape, where the period ends on the year end and starts late.

    **The boundary is 358 days and it is a judgement**, in the sense the near-cancelled-equity note is
    — but a better-evidenced one, because the population below it is small enough to enumerate rather
    than describe. Of 44,897 duration facts filed under a period-anchor tag across the cached filers,
    44,728 are 363, 364, 365 or 370 days (a 52-week year, a calendar year, a leap year, a 53-week
    year). **43 distinct (filer, period) pairs are shorter than 358 and every one was identified**:
    Chapter 11 stubs, fiscal-year transition stubs on 10-KT (Greif, MediaCo, Jefferies), inception and
    IPO periods (Kinder Morgan 2011, Shoals, UWM), and CleanSpark, which tags two years seven days
    short and never reaches a column with them.

    **363 is the number that looks principled and is wrong.** 52 weeks is 364 calendar days, so "at
    least 52 weeks" reads as the definition of a fiscal year — and 362 days carries **Kraft Heinz's
    FY2016 and H.B. Fuller's FY2024**, both genuine 52-week years, each shortened by a day because the
    year before it was a 53-week year. A rule drawn on what a fiscal year *is* would have dropped a
    mega-cap's year in order to fix a stub. `ANNUAL_MAX` is deliberately **not** tightened to match:
    nothing in 2,830 rendered columns exceeds 370 days, so there is no population to measure a tighter
    maximum against, and `annualPeriods` reuses that constant for a different question entirely.

    **Nothing is estimated to fill the hole.** The stub is dropped, the year gets no column, and the
    break is marked by the instrumentation the transition frame already shipped — CBL's FY2022 column
    carries `12 mo not covered` and every growth rate across it is blank. Measured across all six
    frames, **14 filers change and none loses a real year**: eight swap a stub for a genuine 364-day
    year that the stub had been displacing out of the eight-column window (CBL, California Resources,
    Chord, Expand, Greif, Zhanling, BNC, Dynamic Aerospace), and six lose a period that is not one.
    `full-diff.mjs` across the 167: **1 filer moved, 0 values changed, 5 cells vanished** — Shoals'
    post-IPO 335-day net income to common and EPS, which had been sitting in a 365-day column.

19. **Rule 13 decides which columns EXIST, not only which facts fill them — and it was only doing
    half the job.** `pickFact` refuses to take a figure from anything but a periodic report. But
    `annualPeriods`, which decides that a column exists at all, took **any form**, so the two halves of
    the engine disagreed about which filings count.

    It was invisible until rule 18 tightened the window, because the same end date was usually also
    carried by a stub that got there first. **Seadrill files its 2022 as a 311-day successor period in
    the 20-F and as a full 364-day year in a DEF 14A**; Vroom's 2025 is the same shape. With the stub
    excluded, the proxy's period was the only one left at that date, and both rendered a column that
    the whole of rule 13 then refused to fill — every duration line blank beneath a populated equity
    balance, which reads as *"the filer did not tag this"* when the truth is that the year does not
    exist in this shape at all. Rule 5's complaint arriving on a whole column.

    **WW International is the clearest case and it is not a blank one.** Its 2025 period — 367 days,
    29 Dec 2024 to 31 Dec 2025 — is tagged in **no periodic filing at all**, only in a DEF 14A, at
    `NetIncomeLoss` of **$1,056m**, which is the gain on discharge of debt appearing in the
    pay-versus-performance table of a company that emerged from Chapter 11 in June 2025. A proxy
    statement was creating a column.

    It also improved a filer nobody was aiming at, which is the evidence it is general.
    **Powerfleet's proxy restates its March calendar back to 2021** and those periods were winning
    rule 6's contiguity tie-break against the December years its 10-Ks actually report. Its sheet now
    shows six December years from 10-Ks, the three-month transition stub excluded and marked as a
    break, then the two March years it has filed. `full-diff.mjs` across the 167: **0 values changed**
    — no filer in either size frame had a period that only a non-periodic filing reported.

20. **A sheet has ONE currency, and which one it is was being decided by JSON key order.** Every rule
    above is about choosing the right fact. This is about the unit that fact is in, and it is the one
    place the engine was reading a number correctly and reporting it as something else.

    `factsFor` flattens `def.units` in object-key order and `pickFact` sorts only on filed date and
    form rank, so where a filer files one line in two currencies the winner was decided by the order
    SEC happened to serialise the units map — **independently per tag**. One column could hold revenue
    in CNY and cost of revenue in USD. **All In FutureTech tags `ShortTermBorrowings` at both
    `JPY 948.2m` and `USD 6.3m` for the same instant**, JPY first, so the sheet reported 948,200,000 of
    short-term debt for a company with $6.3m of it. It is not exotic: **45 of the 426 filers swept
    carry a second currency**, because a foreign private issuer publishing a USD convenience
    translation beside its own statements is the ordinary case.

    So the currency is read once per sheet, from the facts that build the calendar — the period
    anchors of rule 6 — and threaded into every fetch. A fact in another currency is **skipped, never
    converted**: there is no exchange rate in this data path and there is not going to be one, because
    a converted figure is not the value the company filed and the header says every figure is.

    **Two things about the choice, and both were measured rather than assumed.** It is decided on the
    **newest anchor period alone**, which is rule 6 again — a filer that CHANGES reporting currency has
    more of the old one on file, and BetterLife Pharma files 21 USD annual anchors against 14 CAD while
    its newest year is CAD only. A majority across all history picked USD and blanked 90 cells, the
    newest column among them: the one the valuation divides into. And on a tie the **non-USD** half
    wins, because a filer publishing a full convenience translation files both for every period, so the
    newest period is always a tie and the tie-break decides the whole sheet. USD is the wrong half to
    keep — the translation is what gets added. Futu, Vipshop, Recon and SFHG file their statements in
    HKD or CNY with a USD column beside them; a filer that genuinely reports in USD, like B.O.S. Better
    Online, files USD alone at the anchors and never reaches the tie-break at all.

    **The valuation block is suppressed rather than converted, for the same reason.** The price is in
    the currency of the LISTING — Finnhub quotes a US line in dollars — and every row there either
    divides it into a filed figure or adds it to one: `mktCap + totalDebt − cash` would be three
    currencies in one sum and `price / epsDil` a P/E built from two. Same answer `NOT_APPLICABLE` gives
    a carrier's enterprise value, with a status of its own so the row reads **"reported in EUR"** and
    not "needs price", which would be false — the price arrived and is fine. Rule 5 again: the wrong
    kind of blank sends a reader looking for a missing quote.

    **The card needed its own line, and that was found in production.** It drops any row that came out
    null, so ASML rendered *"$1890.00 today"* beside a book value of 50.89 with nothing between them
    saying one is dollars and the other euros. The row-level *"reported in EUR"* status cannot reach
    it: the EV bridge is deliberately not in the year grid, so those keys have no row to carry a status
    on. Same compact bronze line the near-cancelled-equity note uses, and the same route the $155bn
    Chubb enterprise value was caught by — a real quote exists only in production.

    And the page says it, once, at the top: *every figure below is in EUR, as filed — not converted*.
    Once rather than on 279 rows, because one currency per sheet is now true by construction. USD is
    left unsaid, because it is the default a reader already assumes and marking it would train the eye
    to skip the marker on the ten sheets that need it.

    Measured over **274,112 template cells evaluated both ways: 168 differ** — 56 corrected to the
    sheet currency (Futu's EPS moves from `USD/shares 1.31` to `HKD/shares 10.17`, which is its P/E out
    by 7.8x) and 112 blanked, overwhelmingly option strikes and dividends per share that a foreign
    issuer quotes on the ADS in dollars while reporting the statements in its own currency. Columns
    carrying more than one currency: **37 → 0**. Filers whose currency changes between columns:
    **9 → 0**. `full-diff.mjs` across the 167: **0 values changed**.

    **And the 112 blanks it creates are rule 5's fifth kind, not its third.** A cell the filer tagged,
    for this period, in another currency is not *"not tagged"* — it is tagged, findable, and in dollars
    on a sheet denominated in yuan, so labelling it that way sends a reader into a 20-F after a figure
    that is sitting in front of them in the wrong unit. It says **"filed in USD"** instead. The
    invariant is a correspondence rather than a list: **all 112 of the blanked cells carry it**, on 9
    filers, which is what `t-regress.mjs` asserts — every blank the rule creates must explain itself,
    checked by re-resolving each one without the gate rather than against a list of known filers.

    The order of the tests inside `pickFact` is load-bearing and is not the obvious one. The currency
    check runs **after** the period tests, so what gets remembered is a fact this line would otherwise
    have used. Written first — which is how it was first written — it remembers any fact in another
    currency anywhere in the filer's history, and the row then claims a figure exists for a year it
    does not: a note that is a worse lie than the blank it replaces.

    This also absorbs the case that looked like it needed its own mechanism. A filer that genuinely
    **changed** reporting currency empties whole columns, and that was worth a mark of its own until it
    was measured: across 389 filers with a currency it is **2 columns on one filer** — BetterLife
    Pharma, which reports in CAD today and filed USD through 2017. Too rare to have earned a column-header
    mechanism, and it needs none, because a column emptied by a currency change is simply a column of
    these cells and each one already says so.

21. **A line item is a SERIES, and the tag carrying the series IS the line.** Every rule above this
    one picks a fact for a period. This picks the CONCEPT for a row, once, and it exists because the
    tag list alone cannot: where a filer files two concepts for the same line, which one appears was
    decided by list order, and no fixed order is right.

    **Caterpillar files `CostOfRevenue` every year from 2018 at $35–45bn and, from 2022, also files
    `CostOfGoodsAndServicesSold` at $413m, $160m, $33m** — a component, about 0.1% of revenue. The
    list put the component first, so the sheet showed **1% of Caterpillar's cost of sales for four
    straight years**, on a mega-cap, live. Snap was wrong the same way and had been since the first
    version: its 2018 cost of revenue read $120m against a filed $798.9m.

    **Nothing caught either of them**, and the reason is worth more than the fix. The identity that
    would — gross profit = revenue − cost — needs a TAGGED gross profit, and Caterpillar does not tag
    one, so the check could never fire on the filer that needed it. What was visible was downstream and
    absurd: **186,116 days of inventory**, 510 years, in a derived DIO nobody was asserting on. It was
    found by screenshotting the page for an unrelated reason.

    **Reordering the list was measured and rejected.** Of the filers that file both concepts with
    different values, **ten have `CostOfRevenue` larger and six have `CostOfGoodsAndServicesSold`
    larger** — Tronox Uplift and Fortitude Gold file `CostOfRevenue` as literally zero — so either
    order is right for one group and catastrophic for the other. Rule 11's trap on a new row.

    The filer settles it, which is rule 15's shape measured rule 6's way: a row is a series, and a tag
    appearing for the last four years at 1% of the incumbent's magnitude is not the same line. The
    candidates are ranked once per sheet by their **longest unbroken run across that sheet's own
    calendar**, ties keeping the list's order, and the winner is used for **every column** — a row may
    not mean one concept in 2021 and another in 2022. That last part is the claim, and the suite
    asserts it as one: Caterpillar resolves exactly one cost concept across all eight columns.

    Across all six frames only **three filers** have two cost concepts that disagree in the newest
    column, and this changes two of them. `full-diff.mjs` over the 167: **4 filers moved, 37 values
    changed, 0 appeared, 0 vanished** — Caterpillar and Snap corrected, Anterix switched to the concept
    that spans its sheet rather than the one that stops in its oldest column, and the rest is DIO, DPO
    and cash-conversion moving with them. The foreign-issuer sweep went **54 → 52**.

    Only the cost row opts in today, via `pinByRun`. The rule is general — it applies to any row whose
    tag list holds two concepts a filer might file together — but each row needs its own measurement
    before it does, which is the whole lesson of rule 11.

22. **A formula written in the template is not an implementation, and this is the second time.**
    `revCagr3` and `revCagr5` were declared in the template with formulas and never wired to anything,
    so they rendered blank on every sheet ever served until comps needed them. Three rows also declare
    a `fallback:`, and only one of the three — a bank's net interest income — was ever implemented.

    **`grossProfit` declares `fallback: "revenue - cogs"` and nothing ran it.** That is **446 cells on
    84 filers, 15.8% of all columns**, and the population is not obscure: Chevron, Conoco, Walmart,
    Costco, Target, P&G, Pfizer, Merck, Lilly, AbbVie, Amgen and Caterpillar all report revenue and
    cost of revenue and no gross-profit subtotal, so the row *and the gross margin under it* were empty
    on every one of them. Nothing could fail, because a blank cannot be mis-computed.

    It is an **identity over two rows directly above it**, which is what separates it from rule 8's
    rejected `revenue − CostsAndExpenses` — that inferred a subtotal from a tag meaning something else,
    while this is arithmetic the statement itself satisfies. Checked where a filer tags gross profit
    *and* both inputs: **1,051 columns agree to within 0.5% and 49 do not**, and the 49 are a
    population rather than an error rate — near-zero-revenue shells where a percentage is meaningless,
    plus the **excise-tax category** (Altria, RLX) which presents a third line between cost and gross
    profit. Every one of those tags its own gross profit, so the derivation never fires on them, and
    Altria's sheet is unchanged.

    **It returns null when the row was fetched**, which is the part that would have broken quietly.
    `fillCol` overwrites `meta` with `computed` for any derivation returning non-null, so a derivation
    that handed back the existing figure would strip the **per-cell EDGAR link** from every filer that
    does tag the subtotal. Apple keeps `status: reported` and its accession number, and the suite
    asserts both.

    **`niToCommon` declares `fallback: "netIncome - nci - prefDiv"` and it was measured and REJECTED.**
    It would fill 1,750 cells, but **1,276 of them have neither `nci` nor `prefDiv` tagged**, so the
    "derivation" is `netIncome` unchanged — asserting that a company has no minority interest and no
    preferred, on no evidence. Rule 7 exactly: a missing input treated as zero. And where the filer
    *does* tag the row so the identity can be checked, it **disagrees 482 times against 591 agreements**
    — the inputs are routinely untagged even when they exist. The declaration is removed rather than
    left in the template, because a formula nobody implemented is a lie told to the next reader of the
    file. `full-diff.mjs`: **602 cells appeared, 0 values changed, 0 vanished.**

    **The derived row says so, because the header says otherwise.** Every sheet claims each figure is
    the value the company filed, and this one is arithmetic on the two rows above it — the same
    obligation a collapsed segment table took on, discharged the same way the derived non-controlling
    interest discharges it. The row carries a `flagNote` naming what was computed and why it does not
    link to a filing, and the flag is set AFTER the industry blanking pass, so a bank — which has no
    gross profit at all — cannot be left claiming a derivation behind a blank. Asserted in all three
    directions: Caterpillar flagged, Apple not, JPMorgan not, and no column anywhere flags a
    derivation with no figure behind it.

    **And the class now has a structural check rather than a third repetition.** `t-declared.mjs`
    enumerates every property declared in `template.js` and greps the whole shipping engine for it. A
    key nobody reads is either dead documentation or an unimplemented feature and from inside the file
    those are identical, so anything unread must be wired, deleted, or listed as dynamically read
    **with a reason** — the industry names, the tag-keyed note maps. It caught one more on its first
    run: **`derivedOnly:` was declared on eight sections, read nowhere, and false on three of them**,
    since `dcf` and `pta` contain fetched lines. Deleted. Three occurrences of one defect is a pattern,
    and the generalisation is the currency lesson stated the other way round: a value the engine never
    reads is a value nothing is enforcing.

23. **Where the filer tags a subtotal the row participates in, its own arithmetic outranks rule 21's
    proxy.** Rule 21 ranks candidates by their longest unbroken run, which is a *proxy* for "which
    concept is this row" — and a proxy loses to evidence wherever the filer supplies evidence.

    **Air Industries breaks the proxy.** It tags `CostOfGoodsAndServicesSold` at **$0.1m for 2019 and
    2020** and at $45m from 2021, so the placeholder's unbroken run (5) beats `CostOfRevenue`'s (4),
    and the sheet showed **$0.1m of cost against $50m of revenue** for two columns. Its own filed gross
    profit settles it: revenue $50.1m less gross profit $6.5m is **$43.6m**, which is `CostOfRevenue`
    exactly.

    **Ranking by COVERAGE instead was the tempting fix and is rejected**, because it trades one filer
    for another — rule 11's trap. It corrects Air Industries (7 columns against 5) and breaks **AIOS
    Tech**, whose tagged gross profit says `CostOfRevenue` is right there to the dollar: 386.7 − 346.7
    = 40.0. Across all six frames those are the **only two filers** where run length and coverage
    disagree, and they disagree in opposite directions, so no ranking of the two can be right for both.
    The identity is right for both.

    So a row may declare `pinIdentity` — for the cost row, `revenue − cost = grossProfit` — and the
    candidates are scored by how many of the sheet's own columns they close it in. Scored **across the
    sheet** rather than per column, because rule 21's claim is that a row means one concept for the
    whole page. A filer tagging no subtotal scores every candidate zero and falls through to rule 21
    unchanged, which is every filer but three.

    The third is **Anterix, and it is a regression rule 21 introduced the same day**: its reported
    gross profit is **minus $0.75m** and revenue less `CostOfGoodsAndServicesSold` is minus $0.75m
    exactly, so rule 21's run-length answer had picked the wrong concept there. `full-diff.mjs` over the
    167: **34 values changed rather than 37** — the three that moved back are Anterix's, corrected by
    the filer's own figures rather than by a preference.

24. **A zero is a fact, and on some rows it is not evidence of absence.** `pickFact` takes the first
    candidate with a fact for the period, and a fact of `0` is a fact. That is the mechanism behind
    rule 7's Progressive case — it tagged `LongTermDebtCurrent` as literally 0 while reporting its real
    $6.9bn under another concept, and the sheet printed "Total debt 0". The mechanism was fixed there
    for debt and never looked at anywhere else.

    Swept across every fetched row with more than one candidate, over all six frames: **115 cells
    resolve to zero while a LATER candidate in the same list reports over $1m**, and 75 of them are one
    row. The impairment line covers goodwill *and* asset impairment, and a filer with none of the first
    and real amounts of the second tags `GoodwillImpairmentLoss` as 0 — which displaced the figure it
    actually reported. **38 filers, and not small ones: Williams showed 0 against $1.915bn, Kenvue
    against $578m, Intel against $522m, PepsiCo against $498m, Lilly against $497.8m.**

    **It is opt-in per row, and the counter-example is why.** A zero is usually the reported truth, and
    the same guard applied to the debt rows would be wrong in exactly the population this project has
    swept most recently: `LongTermDebtNoncurrent` filed as 0 by a company in Chapter 11 is **correct** —
    its debt has been reclassified — and taking the non-zero sibling would put **$15.2bn of
    iHeartMedia's debt back on a line the filing had deliberately emptied**. Seven of the 115 are that
    shape. So the row declares `preferNonZero`, the cost of being wrong is confined to rows where the
    label covers both concepts, and the suite asserts iHeartMedia keeps its filed zero.

    Where every candidate reports zero, zero is what the filer says and zero is what is shown — the
    guard falls back to the first hit rather than blanking, because "the company had no impairment" and
    "the company reported nothing" are different answers and rule 5 is about not confusing them.
    `full-diff.mjs`: **65 values changed across the 167** (34 of them rules 21 and 23), 0 vanished.

### A number that is correct and reads as broken

Rule 5 says a blank is not one thing. This is its mirror: **a populated cell is not one thing either**,
and the case that misleads is a figure that is exactly right and looks like a defect. Nothing here is
suppressed — suppressing a correctly derived number is the one thing this page must not do — so the
answer is a mark, and the mark had to be keyed to the right property.

**Not to how big the ratio came out.** A biotech's −5,041% EBITDA margin is huge and correct and is a
different situation entirely: its denominator is $3m of revenue, which genuinely *is* the company's
revenue, and the ratio means exactly what it says. Equity is a **residual** — assets less liabilities —
and when it has nearly cancelled the ratio stops describing returns and starts describing buyback
history, because a 1% revision anywhere on the balance sheet moves it by tens of percent. That is a
fact about **stability**, not magnitude, so the test is `|equity| / total assets`.

**The threshold is a judgement, and saying so matters** because most numbers in this file are the other
kind. The segment gate could point at a distribution with nothing in the middle; this one is smooth —
over 1,193 filer-columns the median is 34.3% of assets, p10 9.3%, p5 5.7%, p1 0.9%, **with no gap
anywhere**. 2% is chosen as the point where a 1% move in the balance sheet moves the ratio by more than
half, and the note **prints the filer's actual percentage**, so the threshold decides only *when to
speak* and never *what is claimed*.

It is not one filer, which was the surprise. **23 columns across 13**, and they are not obscure:
McKesson's FY2021 ROE is **21,614%** on minus $21m of equity against $65bn of assets, Boeing's FY2018
3,085%, Colgate's FY2025 3,948%, Home Depot's FY2024 1,450%, Oracle's FY2023 792%, HCA's FY2020 656%.
Colgate's P/B, with a live price, is **1,158.85x**.

Three places, because the figure appears in three and each has different room:

- **The sheet** — ROE and Debt/equity carry the full note. `flagNote` values may now be a *function* of
  the flagged column, which is what lets the note carry the filer's own 0.33% instead of a category.
- **The valuation card** — one compact bronze line covering P/B and book value per share together. The
  card is deliberately four numbers read at a glance and a five-line note inside it would cost the
  thing it is for. `pb` therefore has no `flagNote` at all: the EV bridge is in no tab, so one declared
  there would never render, and dead markup that looks live is worse than none.
- **The comps table** — the cell turns bronze and the companies are named underneath, exactly as the
  Costco blank is. This is the Costco lesson arriving on a populated cell: Colgate's ROE sat at 863.6%
  beside P&G's 29.5% and the set said nothing. It reads the **LTM** column, which is a different column
  with its own balance sheet, so the mark is asserted there too.

`Debt / total capital` is deliberately **not** marked: it divides by debt + equity, so a near-cancelled
equity leaves it near 1.0x rather than exploding — Colgate reads 0.99x. The rows the mark applies to are
named once in `EQUITY_DENOMINATED` and read by both the sheet and comps, so the two cannot drift about
which figures are incomparable. `full-diff.mjs`: **0 values changed**, which is the whole point.

Column labels come from the **period end date**, never from XBRL's `fy` — `fy` is the fiscal year of
the *report* a fact was filed in, so the year to Sept-2018 carries fy=2019 as a comparative and two
adjacent columns both rendered "FY2019". Columns run **oldest → newest**, the way a model does, and
the sheet opens scrolled to the right-hand edge.

The end date fixed that cause and the sweep found the same wrong label arriving by another: a
**52/53-week filer** drifts backwards until a fiscal year ends on 1 January, and then two periods end
in the same calendar year. J&J's ran to 2023-01-01 and 2023-12-31 and the sheet printed "FY2023" over
both — two columns a full year apart with nothing to tell them apart. The label is **not** recomputed
from a fiscal-year convention, because filers do not share one: Walmart calls the year ending 31 Jan
2026 "fiscal 2026" while Home Depot calls the year ending 1 Feb 2026 "fiscal 2025", so either rule
mislabels the other company. Only **uniqueness** is enforced — the earlier of a colliding pair drops a
year, cascading newest-to-oldest so a fix cannot create the next collision — and the exact period end
stays printed underneath, which is what actually disambiguates. On J&J and Kenvue the cascade lands
on each company's own naming.

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

## Getting the data out

Every free competitor — stockanalysis, Koyfin, TIKR, QuickFS — shows financials for nothing and
charges for the export. That is the business model in this category, and it is backwards for the
person doing the work: nobody analyses on a website. **Download Excel workbook** writes all three
tabs as a real `.xlsx` — number formats, frozen header, column widths — and the Copy button beside it
stays for the other job, dropping the tab in front of you into a model that is already open.

The writer is ~120 lines against `fflate` in `src/xlsx.js`, and the dependency choice is the point:
SheetJS's npm package is abandoned at 0.18.5 with two HIGH advisories and no fix, and exceljs pulls a
vulnerable `uuid`. The real risk to a write-only path is negligible, but `npm audit` is the first
thing a technical reader runs, and this project's whole argument is rigour. fflate is 8KB and audits
clean. An `.xlsx` is a zip of XML and only one narrow slice of it is needed, so it is written
directly rather than inheriting a dependency that rots. **Do not swap it for a library.** It is
lazy-imported, so a reader who never exports pays nothing for it.

Four things in there fail silently:

- **The indices in `S` ARE the positions in `cellXfs`.** Appending is safe; reordering repaints every
  cell in the workbook with the wrong format and breaks nothing that looks broken.
- **A blank is written as no cell at all**, never an empty string — an empty string in a year column
  stops Excel treating the column as numeric, which quietly breaks the average a reader puts under it.
- **Number formats follow the screen**: percent, then multiple, then decimals for anything under a
  thousand (per-share figures, ratios, counts), money otherwise. An exact zero is money — "Preferred
  dividends 0.00" on a sheet denominated in billions reads as a broken export.
- **Sheet names are sanitised.** Excel rejects a name over 31 characters, or containing
  `: \ / ? * [ ]`, by refusing to open the file at all.

**The EV bridge is in the workbook but not in the page's year grid, deliberately.** On screen it
lives in a card above the tabs, because there is one price, so it fills one column, and a table row
of seven blanks buried the only real value off the right-hand edge of the scroll. A spreadsheet has
no such problem — a figure under the newest year with the earlier years empty is how a model reads —
and an export missing enterprise value and EV/EBITDA would be missing the two numbers a banker looks
for first. So it is appended in the export rather than added to `TABS`, which would put it back on
the page, and only when a price actually arrived: with no `FINNHUB_KEY` it would be eleven blank rows.
It carries a row of its own naming the price and the year, because a spreadsheet has no card header
to say so.

Verified by opening the files in **real Excel**, not by reading the XML back: a malformed `.xlsx`
fails by refusing to open, not by looking wrong. AAPL, CB, O, JPM and CBRE were captured from the
shipping click path and opened with `CorruptLoad = xlNormalLoad`, which refuses a bad file instead of
silently repairing it, with two deliberately broken files put through the same call to prove the
check can fail. Chubb's five EV rows are blank in the exported file and Apple's populate: the export
reads `grid`, so every suppression rule in this file already applies to it, and any rule that does
not hold in the workbook is a bug in both places at once.

## Comps

`filings.masonjbennett.com/?c=AAPL,MSFT,NVDA` opens a comparable-companies set: companies across,
metrics down, off the same engine as the single sheet. **+ Compare** on any company starts a set from
the sheet you are already looking at, and with a set open the search box adds to it rather than
replacing it.

It is deliberately a **short** list — 23 rows in four blocks (scale, growth and margin, returns and
leverage, valuation) rather than the whole 279-line template with companies as columns. Nobody reads
279 rows across six firms; a comps page is the sheet an analyst circulates.

Three things it does not fudge:

- **The industry rules carry over untouched**, because the set is built by the same `buildGrid`. A
  bank in the set has no EV/EBITDA because `NOT_APPLICABLE.bank` says a depository is levered on
  capital ratios; Chubb has no enterprise value at all, verified with a live price in the set — the
  same suppression that the $155bn Chubb bug exists to enforce.
- **The median is taken over the companies that report the figure**, never over the set, so a blank
  is not silently counted as a zero. Absolute dollar lines have no median at all: a median revenue
  describes the names you happened to pick, while a median EV/EBITDA is the point of the exercise.
- **A blank says which kind of blank it is.** Rule 5 in a table with nowhere to put a status chip:
  a line the filer reports annually but not quarterly turns the cell bronze and names itself
  underneath, because unmarked it reads as the tool breaking on that one company.

Building it surfaced a bug that had been invisible since the first version: `revCagr3` and `revCagr5`
were declared in the template **with formulas and never implemented**, because a `DERIVED` function
only ever sees one column and a three-year rate spans four. They rendered blank on every sheet ever
served. They are now a cross-column pass in `grid.js` beside the YoY one — and the moment they became
real, Nvidia's 100% three-year CAGR printed as "1", because a key that never had a value had also
never been added to the percent-formatting set. A blank cannot be mis-formatted, which is exactly why
nothing caught it.

### The columns are trailing twelve months, and the page prints the spread

The fiscal years do not line up, and the second pass stopped saying so and did something about it.
Across the 97-filer corporate sample the fiscal-year ends spread **eleven months** — Intuit's year to
31 Jul 2025 in the same table as Microsoft's to 30 Jun 2026. Stitching each company forward to its
most recent quarter closes that to **three months**. So LTM is the default basis and **Reported FY**
is the toggle beside it, because the filed year is what a reader wants the moment they go to check a
figure against the 10-K itself.

It narrows the windows, it does not align them, and the page never says "calendarised". The
through-date sits under every ticker and **the actual spread across the set on screen is measured and
printed in words** — 65 days for AAPL/MSFT/NVDA/JPM against 276 on the reported year. Measured rather
than asserted, because a set of three December filers lines up exactly and should say so, and one
spanning January and June should not be flattered by a generic sentence about calendarisation.

- **Balance-sheet lines are read at the quarter end, not stitched.** A balance is a fact at a date and
  adding three of them together means nothing. That also makes net debt — and therefore enterprise
  value — as of the latest quarter rather than as of a year-end that may be eleven months behind the
  price being divided into it.
- **It is a ladder, not a pair of lookups.** Window *k*'s prior leg is window *k+1*'s current leg, the
  same period seen from either side, so a series of LTM columns costs one extra rung each. That is
  what lets the LTM column carry a growth rate and a three-year CAGR through the same cross-column
  pass the fiscal-year columns use, rather than borrowing those rows from a window it is not on. Four
  deep, which is what a three-year CAGR spans; `revCagr5` would need six and stays blank on this basis.
- **`buildGrid` builds it for every sheet** — `grid.ltm` and `grid.ltmCols` beside `grid.cols` — and
  only comps renders it. That costs the single sheet about 18ms on a payload it just fetched over the
  network, which is cheaper than a second code path the sheet would never exercise and the harness
  would therefore never test. Putting the LTM column into the single sheet's year grid is a real and
  available next step; it would touch the grid, the Excel export and the copy path.
- **Where there is nothing to stitch, the fiscal year IS the trailing twelve months, and the column
  says so.** Six of the 97 have filed nothing since their year closed — Microsoft's year to 30 Jun
  2026 is the twelve months to 30 Jun 2026. Gated on whether an interim period exists at all rather
  than on the stitch having failed, because those look identical from an empty result and are not the
  same claim: relabelling a nine-month-old fiscal year "LTM" is the misdating the rest of the engine
  exists to prevent.
- **The old sketch was wrong twice, and never ran.** `latestYtd`/`ltm` sat in `extract.js` unused
  since the first version. It took the first tag with any 10-Q match and stopped — rule 6's failure in
  the interim data, resolving a Microsoft period ending **2010-12-31**. And it took whichever span
  turned up first at that period end, where a 10-Q files **both** the discrete quarter and the
  year-to-date span under one tag with one end date: FY + Q3 − prior Q3 keeps three quarters of the
  old year and drops three of the new one.

Checked by `t-ltm.mjs`: 3,413 assertions over the 97 filers, of which the load-bearing one is an
**independent reconstruction from discrete quarters** — the last four quarters ending at *T*, with the
un-filed fourth quarter of the old year recovered as FY less its own nine-month year-to-date. That
path shares exactly one fact with the stitch and reaches the answer through periods the ladder never
touches, so agreement is evidence about **period selection** rather than about arithmetic. 87 filers
reconstruct, the worst to 0.39% and every other to under 0.01%. Only two assertions fail and both are
the Altria and Instacart findings already open below — the LTM column inherits the sheet's known
limits and adds none of its own.

**Coverage costs almost nothing**, which is the other reason it can be the default: revenue resolves
for 95 of 97 against 97 on the reported year, net income 96, EBITDA 77 either way. The five lines lost
are all the same-tag rule refusing to cross concepts — Costco's revenue, AT&T's operating cash flow
after it moved to the continuing-operations tag in 2026.

### Getting the set out, and getting out of the set

**Download Excel** writes the set as one `Comps` sheet, companies across and metrics down, with the
median column and the same number formats as the single sheet's workbook — `styleFor` is shared
rather than copied. The twelve months each column covers goes in **a row of its own** rather than into
the ticker header, because the columns do not share a window and a workbook has no subtitle to say so.
Six header rows, matching the single sheet: a seventh put company names *inside* the frozen data area
and the Excel check flagged them as text in a numeric column, which is the same complaint it would
make about a real defect. Verified the same way as the single sheet — captured from the shipping click
path and opened in real Excel with `CorruptLoad = xlNormalLoad`, three sets including a carrier set and
a reported-FY set, with the two deliberately broken negative controls still rejected.

**A column opens its own sheet.** Clicking a ticker loads that company and leaves a *← Back to the set*
button above it; the set stays in state rather than being torn down, because "show me this column's
sheet" and "throw away the six companies I just assembled" are not the same instruction. It is a real
anchor to `?t=TICKER`, so ctrl-click opens a second tab and the address is copyable, with the in-page
load intercepted otherwise. That is where every blank in the set gets explained.

## Segments

`api/segments.js`, the **Segments** tab. The only numbers on this site that do not come from
`companyfacts`, because companyfacts carries **no dimensional data at all** — a fact there is
`start, end, val, accn, fy, fp, form, filed, frame` and nothing else, so "Apple's revenue" exists and
"Apple's revenue in Greater China" cannot. Breakdowns live in the XBRL instance, where a CONTEXT
carries an `explicitMember` on an axis and a FACT points at a context. SEC extracts that instance out
of the inline-XBRL 10-K as a standalone `<stem>_htm.xml`: 1.4MB for Apple, 14.9MB for JPMorgan.

Three axes get a table — reportable segments, products & services, geography. Scope is the **newest
10-K**, which is three years, because that is what a segment footnote presents; reaching eight would
mean three more instances and 45MB to add two stale years of a structure that has usually been
reorganised since. Lazy-loaded on opening the tab, so a reader who never asks pays nothing.

**The claim the tab makes is that every table on it adds up**, and it is enforced rather than
reported: a breakdown whose rows do not sum to the consolidated figure for the same period in the
same filing is not shown. The consolidated line is printed under each block so the arithmetic is
checkable on the page. That gate costs real tables — **27 of 30 filers swept keep a reportable-segment
table**, up from 17 once the reconciliation's own rows were captured, 26 once a reconciling row could
itself be a subtotal, and 27 once a cross-tab could collapse — and it is the right trade,
because both ways this goes wrong produce a company half again its real size, and a reader cannot tell
a good table from a bad one by looking.

**The tolerance is 0.1%, and it was 1%.** On a $400bn company 1% is $4bn, bigger than most of the
rows, and it let two tables through that a reader adding the column up would catch: Exxon's revenue by
product sat $1.7bn under the consolidated line printed directly beneath it. The distribution says a
looser number buys nothing, because it is not a distribution at all — **317 of the 336 cells shown foot
to the DOLLAR**, 19 more are inside 0.05%, and everything else is wrong by a whole missing row. There
is nothing in between. Tightening cost exactly one concept on one filer across the sweep.

Nine rules, each learned the same way as the others here:

1. **One breakdown axis per fact, with `srt:ConsolidationItemsAxis` permitted as a qualifier.** That
   axis says which VIEW a figure is — an operating segment, corporate, an elimination — rather than
   subdividing it. Anything else riding along makes the fact a cell in a cross-tab: Apple files
   revenue by segment × product, and counting those as segment rows multiplies the company. It is
   also what separates a segment table from Chubb's claims-development triangles, which sit on the
   segment axis with an accident-year axis beside them — 542 contexts, the largest block of
   dimensional data in its filing.
2. **A view is an (axis, extended-link ROLE) pair, not an axis.** One axis can carry two completely
   different breakdowns. Apple files revenue by product twice — on the income statement as
   {Product, Service} and in the revenue footnote as {iPhone, Mac, iPad, Wearables, Service}. Both
   sit on `srt:ProductOrServiceAxis` and each foots to $416.2bn alone; grouped by axis they summed to
   **$832.3bn, exactly twice the company**. No containment arc says so, because the linkbase declares
   Product and iPhone as *siblings* under one domain. What separates them is belonging to different
   hypercubes, and the role is where that is written down.
3. **A member is a subtotal when the linkbase says the table already contains its children.**
   UnitedHealth files `TotalOptum` beside Optum Health, Optum Insight and OptumRx; Caterpillar files
   the standard `ReportableSegmentAggregationBeforeOtherOperatingSegment` beside the four segments
   inside it. As rows they doubled both companies — UNH to $891.6bn against $447.6bn, CAT to $136.4bn
   against $67.6bn. Matching the word "Total" is what rule 10 exists to warn against, and unnecessary:
   `unh:TotalOptumMember → unh:OptumhealthMember` says it outright. The test is **containment of
   members actually present**, not "has children anywhere" — deciding it on the linkbase alone removed
   real segments, taking Chubb's premium base from $53.0bn to $37.3bn, and left Chevron with a single
   $0.6bn "all other" row against a $184bn company because its aggregation member is the only row
   carrying revenue at all.
4. **Deduplicate facts by (tag, context).** Inline XBRL tags a figure everywhere it appears in the
   document, so the extracted instance carries the same fact once per occurrence. Apple's services
   revenue is on the face of the income statement and again in the revenue footnote — identical tag,
   identical context, two elements. Summed as filed, its product breakdown came to **$525.3bn against
   a $416.2bn company**, the extra $109.1bn being services counted twice. A duplicate is one fact seen
   twice, and nothing downstream can tell the difference.
5. **A concept allow-list, and members are not required to end in "Member".** Every table in a filing
   that touches one of these axes becomes a candidate, and most are disclosures nobody models —
   goodwill translation adjustments by segment, restructuring costs, a held-for-sale narrative.
   Caterpillar produced thirteen. Separately, Apple's geographic rows are `country:US` and
   `country:CN`, standard members with no such suffix; requiring it dropped the United States and
   China from a geographic breakdown and left "Other countries" behind.

6. **The reconciliation's own rows are rows, and they are not on the breakdown axis at all.**
   Corporate, intersegment eliminations and "all other" are filed with `srt:ConsolidationItemsAxis`
   ALONE and no segment member, so a pipeline that only looked at contexts carrying a breakdown member
   never saw them — and the segments then sum to the company less that row. JPMorgan's came to
   $178.6bn against $182.5bn, Procter & Gamble's to 98.9% of itself, Bank of America's to 102.7%.
   All three foot **exactly** once the corporate row is on the page, which is the point: the row that
   was missing is the row that makes the arithmetic work. This is what took coverage from 17 to 24.
   Which table a reconciling row belongs to is the filer's own statement — the definition linkbase
   declares it on the role, the same way it declares a member.

   Two things it must not do, and both were found by doing them:

   - **`OperatingSegmentsMember` filed alone is the SUBTOTAL**, "the total of the operating segments",
     not a row beside them. 14 of the 30 file one and adding it doubles the table. Name-matching is
     not enough either, which is rule 10's warning arriving on a different axis: **Coca-Cola files its
     $48.806bn segment total under `MaterialReconcilingItemsMember`**, the member every other filer
     uses for a genuine reconciling item. So the test is the VALUE — a reconciling row carrying the
     sum of the segments beside it is the subtotal restated — and it is decided against the segment
     rows in that table, not against the consolidated figure, which is what the gate is for.
   - **A reconciling row can be the sum of the OTHER reconciling rows** — the same subtotal one level
     down, and what was keeping Caterpillar off the tab. It files corporate at −$805m, intersegment
     eliminations at −$5,888m and `EliminationsAndReconcilingItems` at −$6,693m, which is exactly the
     other two; all three went in and the table came out $6.7bn light. Drop it and Caterpillar foots
     **to the dollar**: $74,282m of segments less those two is $67,589m against a $67,589m company.
     Only where exactly one row matches, and only with two or more others to sum — with two rows of
     equal value each is trivially "the sum of the others" and there is no way to tell which is the
     total, so nothing is dropped. This and the lead-view rule below took coverage 24 → **26 of 30**,
     GE arriving with Caterpillar.
   - **A breakdown that already closes does not get one.** If the rows already sum to consolidated,
     the reconciling item is inside them and adding it beside them is the same double count from the
     other end. AT&T's revenue categories foot to $122.43bn exactly and its linkbase also declares
     `CorporateAndReconcilingItems` on that role, so its $458m went in and left a table summing to
     $122.89bn under a printed consolidated line of $122.43bn — inside the old 1% gate, which is the
     worst way to be wrong here. **"Already closes" means to the dollar, not within the gate's
     tolerance**: reusing the gate's number was the first version and cost AT&T's segment revenue the
     row that closes it, because 0.37% short is inside 1%. Decided per CONCEPT, which is how a footnote
     is actually laid out — Apple's revenue by geography foots without a corporate row because every
     dollar of revenue belongs to a region, while its operating income by geography cannot, because
     corporate expense is unallocated by construction. Its footnote prints the corporate line against
     operating income and not against revenue, and so does this.

7. **One member, one concept, one period is ONE row — a filer files several VIEWS of it.**
   Caterpillar files Construction Industries three times for the same year: external sales, the
   intersegment elimination, and the total of the two. Summed as filed its revenue came to **345% of
   the company**. The qualifier axis was "permitted" but never used to choose, so every view was added
   up.

   The UNQUALIFIED fact leads, and that was not the first guess. `OperatingSegmentsMember` is the
   measure the ASC 280 reconciliation starts from, so it looked like the natural head of the list, and
   it cost Exxon its table: Exxon files the three revenue lines of its income statement unqualified and
   ALSO tags the operating-segment portion of one of them — **$323.820bn against the statement's own
   $323.905bn** — under that member. Ranked that way the table swapped one line for a subset of itself.
   An unqualified fact is the figure as the statement presents it; a qualified one is a view of it.
   Measured both ways over the 30 filers, at the 1% gate that was still in force when the two orders
   were compared: unqualified-first foots **320 of 342 cells to the dollar against 302**, and keeps one
   more filer and two more concepts.

   **Rank alone is not enough, and nor is a table-wide choice.** Per member alone MIXES BASES, and the
   total is then neither figure: Caterpillar tags Power & Energy unqualified at its external sales and
   its other four segments only at the total including intersegment, so a per-member choice summed
   **$68.94bn against a $67.59bn company** — four segments gross of intersegment and the fifth net of
   it. Choosing one view for the whole table is worse, because different members legitimately carry
   different views: AT&T's two segments are `OperatingSegments` and its corporate row is
   `CorporateAndReconcilingItems`, which a table-wide choice drops entirely, leaving D&A $76m short.
   So the view covering the MOST members leads, and a member it does not reach keeps its own best by
   rank. Which views were not shown is printed beside the table, because it is why a figure here can
   differ from the footnote.

   Both rules here match the prefix as `[\w-]+`, not `\w+`, and that is not a detail: the member they
   are about is `us-gaap:OperatingSegmentsMember` and the standard prefix contains a **hyphen**.
   Written `\w+` neither rule ever fires on the one member it exists for, and neither fails loudly —
   the subtotal simply renders as a row called "Operating Segments" beside the segments it is the
   total of, which is how it was caught.

8. **A row label can be the taxonomy's DEFINITION rather than a name.** JPMorgan's corporate row came
   out of the label linkbase as "Segment Reporting, Reconciling Item, Excluding Corporate Nonsegment" —
   67 characters into a sticky column that does not wrap, which is how three year-columns got pushed
   off an eight-year sheet once already. Linde's read "Corporate Segment and Other Operating Segment".

   Which label is which cannot be told from the ROLE it sits in: Coca-Cola files a `terseLabel` whose
   text is the standard label verbatim, so preferring terse and falling back does nothing. Nor can the
   member simply be overridden, because most filers do supply a real name for exactly these members
   and it is better than a generic one — UnitedHealth calls its intersegment row "Optum Eliminations",
   Bank of America calls its corporate row "All Other". So the match is on the taxonomy's **exact
   string**, collected from the linkbases themselves; anything else is the filer's own words and is
   kept. Same job the concept `LABEL` map does, and the reason `t-seg.mjs` now asserts on label length.

9. **A cross-tab collapses along its second axis — and the collapse is the only thing on this site the
   filer did not file, so it says so.** Rule 1 keeps one breakdown axis per fact, and for Exxon that
   was the only thing between the tab and a table it plainly has: it files no single-axis segment
   breakdown worth the name (two members, on one impairment concept) and files thirteen concepts three
   years deep as **segment × geography**. Each segment's cells added across geography recover the row.

   It is arithmetic rather than inference, and it is checkable on the filer's own figures. Exxon's
   eight revenue cells sum to **$452.209bn, which is exactly the `OperatingSegments` subtotal it files
   beside them**; its intersegment elimination of −$121.005bn and corporate revenue of $1.034bn take
   that to **$332.238bn against a consolidated $332.238bn**. Net income likewise: four segments to
   $32.434bn, corporate −$3.590bn, consolidated $28.844bn. Every period of every concept foots to
   **0.0000%**, because the collapse is fed back into the SAME pipeline — rules 6, 7 and the gate all
   apply to it unchanged rather than being re-implemented on a second path. It also gained two views
   nobody was aiming at, both footing to the dollar: **Prologis' revenue by region** and **UPS by
   service** (Next Day Air, Deferred, Ground, Forwarding, Logistics), each of which files that
   breakdown only against its segments. 26 → **27 of 30**; `seg-diff.mjs` 3 views gained, **0 lost, 0
   changed**.

   Three things bound it, and the first is the one that would double a company:

   - **A TOTAL member on the second axis**, which is rule 3's failure arriving on an axis rule 3 never
     looks at. Tested by value the way rule 6 tests a reconciling row, and the whole collapse fails
     closed rather than dropping the row, because a filer that files a total files it for every row.
     It fires on two real filers: Bank of America, whose product axis carries
     `InvestmentandBrokerageServices` as the sum of its parts, and **Caterpillar, whose geography would
     otherwise collapse to $136.742bn against a $67.589bn company — 202% of itself**, its aggregation
     member counted beside the segments inside it. **Measured honestly: the guard changes no output on
     this population**, because the gate rejects both anyway at 202% against a 0.1% tolerance. It is
     kept for the reason Verizon's rescue in rule 15 is called an accident — a downstream check that
     happens to catch a failure is not the same as refusing to build it.
   - **Exactly ONE other breakdown axis.** Exxon also files segment × geography × product, and which
     of two axes to collapse along is not answerable from the data, so it is not guessed. Four of the
     36 available cross-tabs are rejected on this.
   - **Only where the single-axis path produced nothing that survives the gate.** An unqualified
     single-axis fact is the figure as the statement presents it; a collapse is a reconstruction, and
     a reconstruction never outranks the filing. Decided AFTER the gate, because "the single-axis path
     produced a table" is not knowable until the gate has ruled on it. This is what keeps the change
     off the 26 filers that already had one, and it is why the diff shows nothing changed.

   **And the page has to say it.** The header on every sheet claims each figure is the value the
   company filed, traceable to an accession number, and these cells are the only ones anywhere on the
   site that are not — Exxon never filed "Upstream $107,151,000,000", it filed $55.662bn and $51.489bn
   and this page added them. Same line the sheet draws when it refuses to link a computed row to
   EDGAR. So a collapsed table carries a caption naming the axis it was summed across, and the claim it
   still makes is the one the gate enforces: the arithmetic is the filer's own and it foots to the
   filer's own total. Caught by looking at the page — the table was correct, complete and silent about
   what it was.

Where nothing reconciles the tab says so and links the filing, rather than showing a table it cannot
stand behind. **The three left are not one problem.** Realty Income tags a single `ReportableSegment`
member and genuinely is a one-segment company. **NextEra** files a combined 10-K with Florida Power &
Light as a co-registrant, so most of FPL's segment figures carry `LegalEntityAxis` and are that
registrant's own statements rather than a breakdown of the parent — its segment revenue reaches
$8.76bn of a $27.41bn company because only the NEER row is on the segment axis alone. **Blackstone**
reports its segments on measures that have no consolidated counterpart at all — fee-related earnings,
segment distributable earnings, base management fees — so there is nothing for the gate to reconcile
against; three of its concepts do foot and the rest cannot by construction, which is a question about
what the tab is for rather than a bug.

Payloads come out at **0–17KB from instances of up to 17MB**. `t-seg.mjs` runs 11,717 assertions over
the 30 filers, the load-bearing one being the reconciliation itself — **at the shipping tolerance, not
a looser one**. A suite that asserts 1% while the code gates at 0.1% is testing nothing; at 1% this one
passed on Exxon's $1.7bn gap. One check had to be weakened after it fired: a segment legitimately
*exceeds* the consolidated line when another row is negative, which is what a corporate-and-eliminations
row usually is — AT&T's Communications is $27.8bn against $23.5bn of consolidated operating income, and
Goldman's Global Banking & Markets $11.0bn against $10.7bn. Both correct, both flagged by a check that
assumed the parts are each smaller than the whole.

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

  The reconstruction holds even where it produces a startling number, and it is worth knowing that
  before assuming it broke. **Bank of Marin's FY2025 revenue reads $29m against $106m of net interest
  income**, because its non-interest income is **minus $76.7m** — its statement carries *"Net losses on
  sale of investment securities (88,202)"* from a portfolio restructuring. NII + fees is the reported
  truth; a bank really can earn a quarter of its net interest income in a year it sells its securities
  book at a loss. Checked against the filing, not assumed either way.
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

## The corporate cross-sector sweep

The corporate template carries ~10,000 of the 10,387 tickers and had only ever been checked against a
handful. Swept against **97 filers across 14 sectors** — energy, retail, staples, pharma, industrials,
software, semis, media, utilities, autos, materials, transport, health services, and recent IPOs and
spin-offs — chosen for structural variety rather than size, because every bug this project has found
was about filing shape rather than sector.

There is no external truth source to diff against, and inventing one would put an unverified number
in the loop. So every check is either **an identity the filing must satisfy** (gross profit =
revenue − COGS, EBITDA = EBIT + D&A, assets = liabilities + equity, FCF = CFO − capex) or **a
structural impossibility** (a revenue smaller than a component of itself, a total debt smaller than
the long-term debt inside it). A filer failing one of those is wrong on its own terms, which is
provable without knowing the right answer. `t-corp.mjs` in the session scratchpad runs it.

What held: 93 of 95 resolve eight columns oldest→newest, no stale or out-of-order calendars, the
balance sheet foots for 94, every computed EBITDA satisfies EBIT + D&A, and young filers correctly
render four or five columns rather than padding. Findings went 9 → 4; rules 10 and 11 above and the
52/53-week label fix are what closed them.

**The ceiling it measured, which is not a bug and is bigger than it looks: 19 of 95 filers — 20% —
have no EBIT in the newest year, and therefore no EBITDA, no EBITDA margin, no Net debt/EBITDA and no
EV/EBITDA.** Fourteen never tag `OperatingIncomeLoss`; five stopped (Schlumberger and Sherwin-Williams
after 2023, Deere after 2024, J&J after 2014, GE after 2012). Verified filer by filer: SLB now tags no
operating subtotal at all, its highest income line being pre-tax. The population is Chevron, Conoco,
Oxy, Phillips 66, SLB, Pfizer, Merck, Lilly, BMY, J&J, GE, Nike, HCA, Dow, Newmont, Nucor,
Sherwin-Williams, Sempra and Deere — and the failure is worse than a uniform blank, because SLB's EBIT
row populates through FY2023 and stops exactly at the column the valuation block divides into. The
EBIT row now carries a `blankNote` saying so, since "n/a" reads as a gap the reader should go close.

### The small/mid-cap sweep

The 97 were nearly all mega-caps — the best-tagged filers in the market — and the template carries
~10,000 tickers that mostly are not. **70 filers, selected rather than remembered**: `tickers.json`
is SEC's own file and is ordered by size descending, so the frame is rows 700–5,200 walked at a fixed
stride, screened on the small submissions document for a 10-K since Jun-2024. That is reproducible
without a seed and cannot be talked into a friendlier sample — hand-picking small caps means picking
the ones you have heard of, which are the large ones. It lands 17 mid, 17 small, 20 smaller and 16
micro, across 47 distinct SIC descriptions, SPACs and clinical-stage biotechs included on purpose.
`SAMPLE_MODULE=./smallcap-sample.mjs node t-corp.mjs` runs the same checks; not one of them assumes
anything about company size.

**40 findings, of which three were real.** The rest is the population being genuinely strange, and
distinguishing the two is the whole exercise:

- **A total-debt override could report less debt than the filer had already tagged.** Both
  `NotesPayable` and `LongTermDebt` are in the REIT debt list, `NotesPayable` resolves first, and at
  some filers it is only part of the stack. BrightSpire reported **$414m against $2.47bn** of
  long-term debt on its own balance sheet, Regency $4.62bn against $4.74bn. A total smaller than a
  component of itself is impossible on its own terms, so an all-in tag failing that test now falls
  back to the corporate sum — the same guard on the carrier path moved Phillips 66 $19.52bn →
  $19.72bn. Diffed across all 165 filers: **3 moved, none appeared, none vanished.** Taking the
  larger of the two was the tempting version and is how a tax-inclusive tag wins an argument it
  should lose.
- **Mezzanine equity was missing, so filers that have any did not foot.** Redeemable preferred sits
  BETWEEN liabilities and equity on the face of the balance sheet and is in neither `Liabilities` nor
  `StockholdersEquity`. Rhythm Pharmaceuticals showed $480m of assets against $210m + $139m, and the
  missing **$131m was `TemporaryEquityCarryingAmountAttributableToParent`, to the dollar**. Now a row
  of its own, added into no total — it is neither debt nor common equity, and which one a reader
  treats it as depends on redemption terms that are in the footnote and not in XBRL. This does **not**
  explain Instacart's $0.2bn, which stays open.
- **An 8-K and a proxy statement were outranking the 10-K** — the largest finding of the three, and
  the one that nearly went the wrong way. Essential Utilities printed EBITDA above revenue for three
  straight years, which reads as a revenue-tag problem and is not one: its operating income was
  coming from an 8-K pro-forma while its revenue came from the 10-K. Reordering the rule 9 revenue
  list would have "fixed" the impossibility by making revenue wrong too. See **rule 13** — the real
  fix corrected 864 values across 167 filers, and it also closed most of the "out-of-range" noise
  below, including Black Diamond's ROE of −83,660%.

Two checks in `t-corp.mjs` were wrong rather than the engine. A **zero total debt** is only a finding
when the filing contradicts it — Hycroft tags both long-term debt lines as literally 0 after repaying
$126m during the year, and printing 0 is the reported truth; Progressive's tell was $6.9bn sitting
under another tag, so the check now asks for interest expense as corroboration. And the balance-sheet
identity had to learn about mezzanine equity before it could be trusted.

What the population is actually like, none of it a bug: **10 filers have no revenue at all** (six
clinical-stage biotechs, a development-stage miner, two SPACs), **two SPACs resolve no columns** and
render empty, and **18 ratios sit outside any plausible range** because a biotech with $3m of revenue
and $150m of losses really does have a −5,041% EBITDA margin. The two coverage gaps it found — a
mortgage REIT (Ladder) and a BDC (Carlyle Secured Lending) with no revenue line — are **closed by rule
14**, which also corrects the tag this paragraph originally named: a BDC's top line is
`GrossInvestmentIncomeOperating`, and `NetInvestmentIncome` is struck after operating expenses.
Findings **32 → 30**.

### The foreign-issuer sweep, and the sheet that stopped before the filer did

Both earlier frames screen candidates on having filed a recent **10-K**, so a company reporting on a
20-F or 40-F is excluded from both **by construction** — and both had saturated, holding at 3 and 29
findings through five consecutive changes. They vary SIZE. This one varies the **filing form**, which
is what every bug this project has ever found was actually about. Rule 13 already names 20-F and 40-F
as periodic reports and its diff moved 12 values from a 6-K to a 20-F, so foreign issuers were in the
data and had never once been swept.

It cost no network scan. EDGAR's quarterly `form.idx` was already on disk from the ticker-integrity
work, so "which CIKs filed a 20-F or 40-F recently" is a grep: **1,424 CIKs, 1,700 ticker rows, 968
distinct companies**, walked at a fixed stride like the small-cap frame. Two things had to be right
about the frame itself. **One row per company** — a foreign issuer routinely carries several tickers
for one CIK, and without deduplication National Grid appears twice (NGG at row 210 and a preferred at
9,332) and its one bug would be reported as two. And the size bands are **deliberately not named**:
`tickers.json` orders by the size of the SECURITY, so the bottom of that list is unsponsored ADRs and
notes of very large companies — Royal Bank of Canada sits at row 9,730 — and calling those rows
"micro-cap" would invent a fact the file does not carry. 68 filers, 58 on 20-F and 10 on 40-F, 55
distinct SIC descriptions. `SAMPLE_MODULE=./fpi-sample.mjs node t-corp.mjs`.

**33 of 68 resolve and 35 render empty, and the split is the answer rather than a problem.** SEC's
companyfacts carries the `us-gaap` and `dei` taxonomies and no IFRS namespace at all, so a filer
reporting under IFRS *should* produce an empty sheet — UBS keeps one tagged concept, and Philips, ING,
Deutsche Bank and Fairfax resolve no columns and say so. The ones that do resolve are foreign issuers
that report in **US GAAP**, and they are correct: ASML's sheet reads €32.67bn of revenue against its
20-F's own *"Total net sales €32,667.3"*, eight columns deep, and it passes the same gross-profit,
EBITDA and balance-sheet identities as any domestic filer. ICON plc the same. The failure that would
have mattered — a half-populated income statement assembled from whatever us-gaap tags an IFRS filer
happens to leave lying around — does not occur.

**The one real finding is a filer that changed accounting standards, and it is rule 6's own failure
arriving by a route rule 6 cannot see.** Rule 6 is about tags being retired *inside* us-gaap. This is
the filer leaving us-gaap altogether: **National Steel (SID) files a 20-F every year and every us-gaap
fact it carries stops at 2009-12-31**, because its later filings are IFRS. The terminal rendered
FY2007–FY2009 — footing, reconciling, calendar in order, entirely healthy-looking, and about a company
as it stood sixteen years ago. Magic Software is the same shape three years back, ending FY2021 against
a FY2024 annual report.

The filer's own submissions list settles it and `api/facts.js` already returns it: compare the newest
column against the newest **annual report on file** (10-K / 20-F / 40-F) by period of report. Measured
across all 198 filers in the three frames, **196 are behind by exactly zero months** and the other two
by 36 and 192 — a gap rather than a threshold, so any gap at all is reported. The sheet is not
suppressed, because those years are real and correct; a banner above the valuation card says what is
known — an annual report exists for a period these figures do not cover — names the form, links the
filing, and gives IFRS as the usual cause on a foreign form rather than as a verdict. It sits **above**
the valuation card because a reader who misses it will divide today's share price into a sixteen-year-old
profit. It also reads correctly in the benign case it can fire on: the day a new annual report lands
before the facts document is regenerated, "a filing exists that these figures do not include" is
exactly true and worth knowing.

**It was blind to transition reports for its whole first life, and the provision for them was already
written.** `grid.js` carried a `T?` in its pattern specifically for 10-KT / 20-FT / 40-FT — but
`api/facts.js` built the filings list from a fixed set of eight form strings naming none of them, so
the population had been removed one layer earlier and the guard could never fire. *A rule with a
deliberate provision for a case nobody has produced is a rule nobody has checked*, which is the
transition frame's own lesson arriving on the instrument rather than on the data. **Greif** changed its
year end from 31 Oct to 30 Sep and files a 10-KT for the eleven months to Sep-2025; with that report
invisible, its sheet stopped at Oct-2024 and said nothing — National Steel's failure on a domestic
mid-cap. Both regexes also had `T` and `/A` the wrong way round, so `10-KT/A`, the one form carrying
both provisions, failed either way; the pattern now matches `periodic()` exactly.

The banner then had to learn to say three different things, because it began firing on forms it was
never worded for. *"An annual report … for the year to 2025-12-31"* is a **false claim** about
Ferguson, whose 10-KT covers five months, and naming IFRS as the cause on a domestic form is a
non-sequitur. The fact is identical in all three cases and is stated first; only the cause is
conditional, and it is named only where the form itself establishes it — IFRS on a foreign form, a
fiscal-year change on a transition report, nothing at all on a plain 10-K. It now fires for **22 filers
across the six frames, 11 of them on a 10-KT** that had been invisible.

Its two single-filer findings were then adjudicated against the filings, and they went opposite ways.

- **AMTD Idea Group was a real gap and it generalised.** Its balance sheet was $389m out — 16.9% of
  assets — and the statement says exactly what that is: non-controlling interests $177,104k **plus
  perpetual securities $206,559k and warrants $5,764k**, which is $389,427k against a $389,427k gap, to
  the dollar and not one thing. It had simply **stopped tagging `MinorityInterest` in 2023** and reports
  the residual only through its two equity totals. Both of those are filed figures, so the difference
  between them is the residual: `equityAll − equity`, which closes AMTD exactly and fills the row for
  28 more filer-columns across the three frames that were blank. The all-in total is now a row of its
  own, so the subtraction is auditable on the page the way FFO's inputs are.

  Two guards, and the second was found by diffing. It only fires where `equity` resolved from the
  **parent** tag — a filer that tags only the all-in concept fills that row from it via the second
  fallback, and the difference would be a confident zero for a company with a real minority interest.
  And a **zero difference is not a derivation**, it is the absence of one: printing "Noncontrolling
  interest 0" is the same defect as an exported "Preferred dividends 0.00", and suppressing it took the
  diff from 820 new cells to 751. `full-diff.mjs`: **714 `equityAll` and 28 `nciBs` appeared, 0 values
  changed, 0 vanished** — the only changed cells in the whole session are still rule 16's two filers.

  The label is right for almost every filer and not for AMTD, so the row says so. Rule 14's discipline,
  applied to a derived figure rather than a fetched one.

- **RLX is the sheet being right, and it is Altria's shape verbatim.** Its statement reads *Net revenues
  ¥3,958,861 · Cost of revenues (2,433,656) · **Excise tax on products (341,595)** · Gross profit
  1,183,610* — and 3,958,861 − 2,433,656 − 341,595 = 1,183,610 exactly. That is the presentation whose
  repair was measured across all eight filers reporting either excise tag and **rejected**, because it
  gives Philip Morris minus $25.93bn of gross profit. RLX is worth recording as a second instance on a
  different continent and in a different industry, which makes the shape a category — excise-taxed
  consumer products — rather than an Altria quirk. It does not make the repair any more general, since
  PM is still the counterexample. COGS stays understated and gross profit stays right.

The rest of the sweep's findings are the 35 correct empty sheets, four stale-calendar reports of which
two are now explained and two are filers that have simply not filed their next 20-F yet, and six
out-of-range ratios at micro-caps with more loss than revenue. **54 findings, of which one was real.**

### The transition-report frame: two calendars at once

A **hypothesis** rather than a survey, and the first frame drawn to test a specific mechanism. A
transition report — 10-KT / 20-FT / 40-FT — is what a filer files when it **changes its fiscal year
end**, so every member of that population has a stub period: a duration that is neither a quarter nor
a year, filed under the same annual tags, ending on a date that belongs to no regular calendar. Three
shipped rules are aimed squarely at that and none had ever met a filer that did it — `annualPeriods`
keeps 300–400 day durations, the 52/53-week cascade renames colliding labels, and rule 13's `periodic()`
regex carries a trailing `T` for exactly these forms. *A rule with a deliberate provision for a case
nobody has produced is a rule nobody has checked.* The cached `form.idx` finds them for free, and the
population is small enough to take **entire** — 34 tickers, no sampling question at all.

**It found the failure it was built to look for, and the failure was worse than the symptom.** The
sweep flagged five filers with duplicate FY labels running *backwards* — `2021 2022 2021 2022 2023` —
and the labels were not the problem. Powerfleet moved from a December to a March year end and reports
on **both calendars for the overlap years**, so its periods were 2021-01-01→2021-12-31,
2021-04-01→2022-03-31, 2022-01-01→2022-12-31, 2022-04-01→2023-03-31 … — each pair overlapping the next
**by nine months**, eight "annual" columns spanning about five years, every growth rate between
adjacent columns comparing a period with itself. Republic Airways, Premier Air Charter, ESG and
Frequency the same. It is rule 6's failure a third way: a sheet that foots, reconciles, and is not
about the years it says. The label cascade is only why it was *visible* — renaming the collisions would
have hidden the overlap rather than fixed it.

**Columns may not overlap.** Walking newest to oldest, a period is kept only if it ends on or before
the start of the last one kept. That needs no fiscal-year convention — which matters, because filers do
not share one — and it anchors on the current calendar, the same "recent first, then deep" discipline
as the tag selection. Touching periods are kept (`<=`), because some filers tag the next year as
starting on the previous year's end date and a strict test would silently drop a real column. The stub
is already excluded by the 300–400 day window, so a gap remains where it sat, which is correct: it is
not twelve months and nothing here pretends a period is longer than it is.

It corrected **three filers among the 167 already swept**, none of which is in the transition frame —
which is the evidence that the rule is general rather than fitted:

- **BHIC** moved from an August to a December year end and its August-2022 year overlapped the
  December-2022 year by eight months.
- **H.B. Fuller tags its fiscal 2024 twice**, ending 2024-11-29 and 2024-11-30, and rendered both as
  columns. Dropping the duplicate freed a slot for FY2018 — and corrected its 3- and 5-year CAGRs,
  which had been spanning a duplicated year.
- **Thermo Fisher** was the one nobody would have gone looking for, and it is a different bug the gap
  instrumentation exposed: it tags `NetIncomeLoss` for 2007–2013 and again for 2021–2025 and nothing
  in between, which is twelve periods against the ten *contiguous* ones its ASC 606 revenue tag
  reaches. Rule 6's "deepest" tie-breaker counted years and picked the tag **with a hole**, so a
  mega-cap rendered FY2011, FY2012, FY2013, FY2021 … FY2025 — three of eight columns twelve years old.
  So "deep" now means deepest **without a break**, measured as the run back from the newest period.
  TMO is eight contiguous years.

**A break in the calendar is not a growth rate, so there isn't one.** The overlap rule made the
calendar honest; it did not make it continuous. Republic runs to Sep-2022 and then to Dec-2023, and
October–December 2022 is in no column — so a growth rate across that boundary divides a September year
by a December year fifteen months later. It printed **169.1% for Republic, 841.9% for CEA Industries
and 32,960.1% for Frequency**. Measured across all four frames: **32 of 2,896 adjacent pairs do not
abut, on 27 filers** — and one is **e.l.f. Beauty**, so this is not a shell-company problem. Those
growth rates and any CAGR whose span crosses a break are now blank, which is rule 7's "a partial total
is worse than no total" applied to a comparison.

The blank is explained **once, at the boundary it belongs to**, as a bronze line under the column's date
reading `3 mo not covered` — one mark rather than every affected row explaining itself. It states the
**fact and not the cause**, which is rule 10's lesson arriving again: a fiscal-year change is the cause
at most of these filers, but Thermo Fisher's gap was a seven-year hole with an unmoved December year end
and **Diebold Nixdorf's is a Chapter 11 year split into two stubs**, so a confident "year end moved"
would have been wrong on both. It also very nearly shipped with a `⌐` in front of it, which is the
Excel button's `↧` lesson exactly; it is words only.

### The restatement frame: rule 13's second door

**1,081 tickers had filed a 10-K/A** in the cached quarters — the largest untested population — and
like the transition frame it was drawn with a hypothesis rather than a hope. Rule 13 shut the proxy
door on the pay-versus-performance table; a Part III amendment carries the same table and *is* a
periodic report. 70 filers, one row per company, fixed stride, screened on also having a real 10-K.

It found **Identiv's $1.62 trillion net income** on the first probe — see rule 17, which also records
the two hypotheses that were measured and rejected before the narrow one that shipped. The general
lesson is the one the frame was built to check and is worth stating on its own: **an amendment is not
automatically better evidence than the thing it amends.** It usually is — 108 of 109 disagreements are
restatements and rule 2 is right about all of them — and the exception is not a category of *filing*,
it is a category of *error*.

Findings 38 across 5 kinds, and the rest of them are the usual population: micro-caps whose amendments
genuinely restated the year, shells with no revenue, and ratios that are extreme because the company
is. `SAMPLE_MODULE=./amend-sample.mjs node t-corp.mjs`; `t-amend.mjs`, `t-amend2.mjs` and `t-amend3.mjs`
are the three measurements, kept because two of them are the rejections.

### The Chapter 11 frame: a year cut in half

The sixth frame, and the third drawn as a **hypothesis**. Fresh-start accounting splits the year of
emergence into a predecessor and a successor period, neither of them twelve months, both filed under
the annual tags — so this population is the one that tests whether a "year" on the sheet is actually a
year. It found what it was built for, and rules 18 and 19 are the result.

**`form.idx` cannot find this population, which is the interesting part of building it.** There is no
10-K variant for emergence; the event is an 8-K item 1.03, and the quarterly index carries form type
and CIK and no items at all. Every previous frame was drawn from that index. So the signal has to come
from the DATA, and the scan that answers it for about a hundred requests is the **XBRL frames API** —
one request returns every filer reporting a concept for a period, CIK and value included. Fetching
companyfacts for 10,387 tickers would be tens of gigabytes; this is the `form.idx` trick moved one
layer in. Four duration concepts per calendar year and three instants per quarter end, 2014–2026:
`ReorganizationItems` and its Debtor* components, `LiabilitiesSubjectToCompromise` for the balance
sheet, and `ReorganizationValue`, which is fresh-start itself. **297 CIKs, 87 of them listed**, 56
distinct SIC descriptions. `SAMPLE_MODULE=./ch11-sample.mjs node t-corp.mjs`.

Two limits bound what the frame can reach, and the first is a genuine paradox worth stating:

- **A frame covers a CALENDAR period, so a fact filed for a stub is in no frame** — the very periods
  this frame exists to study are invisible to the scan that selects it. It works anyway, and the
  reason is worth writing down: reorganization items are filed for the full years a filer spends *in*
  bankruptcy, and again as **comparatives** afterwards, routinely at zero. Diebold is selected by
  `ReorganizationItems` CY2021 = 0 — a comparative filed after it emerged, two years before the event.
  The stub is invisible; the company is not.
- It cannot reach a filer that entered and left inside one fiscal year and tagged nothing at a
  calendar boundary. `LiabilitiesSubjectToCompromise` is scanned at every quarter end to narrow that,
  since a filer in bankruptcy over any quarter end carries it.

The frame is a population, not a claim about each member: a handful of filers are in it on a single
observation and are effectively controls — AMD on one `LiabilitiesSubjectToCompromise` at CY2021Q4I,
GE on one `ReorganizationValue` instant from 2015. They cost nothing and excluding them would be a
judgement the data does not support.

**Findings 62 → 65, and the count going UP is the honest outcome.** WW International and Vroom each
lost a newest column that was a stub or a proxy period, so both are now reported as twenty months
stale — which they are, and which the banner above the valuation card now says on the page. A sweep
that counts "things nobody has accounted for" should rise when the engine stops pretending. The rest
of the population is the usual: micro-caps with more loss than revenue, shells with no top line, and
`out-of-range` ratios that are correct for the company.

### Bottom-up EBIT: tested against 422 filer-years, and rejected

The obvious repair is to build EBIT as **pre-tax + interest expense − interest income**, which is what
an analyst does when a filer presents no operating income, and which is *not* the `CostsAndExpenses`
trap of rule 8 — it is an identity over two reported figures rather than a mislabelled subtotal. It
was not argued about, it was measured: ~76 filers in the sample report `OperatingIncomeLoss` **and**
everything the construction needs, so they are ground truth. Every column of every filer, 422
observations.

Median absolute error **5.3%**, which sounds tolerable, and p75 **14.8%**, p90 **38.2%**, which is
not — half the filer-years land outside ±5%. Carried into EBITDA the tail is still 30% at p90.

It fails worst exactly where it would be used. By sector, median and p90 absolute error: **energy
25.0% / 347.6%**, **autos 83.5% / 389.0%** against semis 1.3% / 16.3% and retail 2.3% / 19.6%. Four of
the fifteen filers it could reach are energy. Impairments and equity-method income from affiliates sit
below the operating line for those filers and the construction sweeps them all in.

Schlumberger settles it, because it is both a candidate and checkable — it only stopped tagging in
2023, so its earlier years have an answer. **FY2019: reported +$4.0bn, computed −$9.8bn. FY2020:
reported +$2.4bn, computed −$10.8bn.** Not drift, a sign flip, on a company this would have been
applied to. And a reader cannot tell a 1.3% case from a 348% case, which is the same argument that
removed the derivation in rule 8.

So the ceiling stands. Worth keeping for whoever proposes this again: the construction is accurate to
1–2% for semiconductors, retail and transport, so it is defensible **per sector** if that is ever
wanted explicitly. As a global rule it is not. It would also have reached only 15 of the 19 — Oxy,
Phillips 66, Nike, GE and Newmont tag no interest expense or no pre-tax income and stay blank either
way. `t-ebit.mjs` in the session scratchpad reruns the whole calibration.

### The four single-filer findings, adjudicated against the filings

All four were resolved by reading the rendered statement out of the 10-K rather than reasoning from
companyfacts — which is the point: two of them were undecidable from the facts alone because the
question was what the STATEMENT says, and companyfacts carries facts without their presentation.
`rfile.mjs` in the session scratchpad pulls any R-file by name. **Two were the sheet being right and a
check being wrong, one is a measured rejection, and one is a hard limit of the data source.**

- **Williams — the sheet is correct, and the check was the mirror of MetLife.** Its consolidated
  statement of income reads *"Revenues $11,950"* and that is what the sheet shows. The $14,899m is the
  **"Total revenues from contracts with customers"** line in its revenue-disaggregation footnote — a
  *component*, which exceeds the top line because the other component (Gas & NGL marketing
  derivatives) is negative. Rule 9 put `Revenues` first and rule 9 is right here for the opposite
  reason it was right at MetLife: the 606 figure was **3%** of MetLife's top line and is **125%** of
  Williams'. Essential Utilities is the same shape — $5.1bn against a filed **$2,474,615 thousand**.

  So the `t-corp` check was wrong, not the engine, and its first form said *any* revenue-ish tag
  exceeding the chosen one means a slice was picked. That is only true when the other tag is a
  component **of the one chosen**. It now fires only on the actual failure: the sheet resolved
  something other than `Revenues` while `Revenues` exists and is larger. Findings **4 → 3** on the
  mega sweep and **30 → 29** on the small-cap one, with no engine change at all.

- **Altria — the fix was measured and rejected, and it would have broken Philip Morris by $53bn.**
  Altria's statement presents *Net revenues 23,279 · Cost of sales 5,597 · Excise taxes on products
  3,140 · Gross profit 14,542*, and it tags that excise line `us-gaap:OtherCostOfOperatingRevenue`.
  Subtracting it makes Altria foot exactly. It is not a general rule: **that tag means something
  different at every filer that uses it** — AT&T's is $25.4bn of cost of services (with no
  `CostOfGoodsAndServicesSold` at all), Netflix's $5.7bn, Deere's $82m. And its sibling
  `ExciseAndSalesTaxes` is worse: **Philip Morris files $53.21bn of it against $40.65bn of total
  revenue**, because PM's revenue is already net of excise and the line is a separate disclosure.
  `revenue − cogs = gross profit` holds at PM exactly; subtracting the excise gives **minus
  $25.93bn**. Tested across all eight filers that report either tag: the subtraction is right for
  Altria alone, right-by-doing-nothing for PM, and unverifiable for the six that tag no gross profit.
  Same shape as rule 8 and the bottom-up EBIT rejection — right for the filer that prompted it,
  catastrophic elsewhere. Altria's COGS row stays understated and its gross profit and margin stay
  right, which is the honest version.

- **Instacart — it IS mezzanine equity, and it is unreachable.** The earlier note that it was not was
  wrong. Its balance sheet ends *"Total liabilities, redeemable convertible preferred stock, and
  stockholders' equity 3,687"*, and the missing $195m is **$196m of Series A redeemable convertible
  preferred**, tagged `us-gaap:TemporaryEquityCarryingAmountAttributableToParent` — the tag already
  FIRST in the mezzanine row's list. It does not arrive because Instacart tags it **only inside a
  class-of-stock dimension**, and companyfacts carries no dimensional data at all: the same fact the
  Segments tab exists because of. In 2022 the balance was one undimensioned line and it resolved
  correctly at $2,822m; from 2023 the series is broken out and every occurrence carries the axis.
  Nothing in `api/facts.js` can reach it — only the XBRL instance can, which is a different data path
  and a different function. This is a **limit with a named cause**, not an open question.

- **Colgate — 3948% is arithmetically correct.** Its balance sheet foots to the dollar in all eight
  columns, and its parent equity really is **$54m**: −$102m in 2018, $117m in 2019, $54m in 2025, the
  residue of decades of buybacks. Net income $2,132m over $54m is 3948%, and the whole equity-
  denominated block moves with it — Debt/equity runs −62.29x to 147.89x. ROIC (36.2%) and ROA (13.1%)
  are steady because their denominators are not equity. Same category as the biotech's −5,041% EBITDA
  margin: the population is genuinely strange, not broken. It is left as filed, because suppressing a
  correctly derived number is the one thing this page must not do — and it now **says why**, on the
  sheet, in the valuation card and in a comps set. See *"A number that is correct and reads as broken"*
  above; the mark turned out to cover 13 filers rather than Colgate alone, McKesson's 21,614% ROE among
  them.

## Deploying

Vercel project → this repo. One environment variable: `FINNHUB_KEY` (same value as the main site;
Vercel does not share env vars across projects). Env vars only apply to **new** deployments, so
redeploy after adding it.

**`filings.masonjbennett.com` went live 12 Aug 2026**; `filings-terminal.vercel.app` still serves
the same deployment, so older links keep working. It had been claimed as live in this file and in
the main repo's CLAUDE.md for a day while it actually returned `DNS_PROBE_FINISHED_NXDOMAIN` — which
is how a dead link reached the site's project card before a screenshot attempt happened to route
through DNS and catch it. **Do not describe infrastructure as working without resolving it**; the
readiness gates worth checking, in the order they fail, are: DNS resolves at all → the record is
grey-clouded (Cloudflare's proxy answers from 104.x/172.67.x and blocks Vercel's certificate
issuance) → HTTPS serves the app. The zone is at Cloudflare, and the subdomain is a CNAME to a
per-project Vercel target (`21fa2e858bbf15dc.vercel-dns-017.com`) — not the generic
`cname.vercel-dns.com`, and not an A record, which is what Cloudflare rejects with "not a valid
IPv4 address".

`npm run dev` runs the serverless functions too, via a small plugin in `vite.config.js`, so local
development exercises the real code path against real SEC responses.

## Chores

- **Annually**, alongside the January refresh on the main site: re-download `public/tickers.json`
  from `https://www.sec.gov/files/company_tickers.json` (needs a declared User-Agent) so newly
  listed companies are searchable. Re-check `src/tickerFixes.js` at the same time — a repair there
  goes stale the day SEC fixes its own file, and a stale override is a ticker pointing at a CIK on
  purpose for no reason. Worth folding in then: `company_tickers_exchange.json` is **not** a
  drop-in replacement (it carries 35 tickers this file lacks but is missing 26 that it has), so the
  upgrade is a UNION of the two, not a swap.
- SEC requires a User-Agent with real contact details and caps traffic at 10 requests/second. Both
  are honoured in `api/*.js`. **Do not remove the UA** — requests without one are refused, and the
  failure looks like a network error rather than a policy rejection.

## Next

1. **Tronox's $39m double count, the one thing rule 15 and rule 16 between them still cannot reach.**
   Its long-term tag carries FINANCE LEASES as well, so `T` equals neither Noncurrent nor
   Noncurrent + Current and no identity closes; its lease residual is untagged, so there is no second
   witness. A per-filer test needs a witness and this filer supplies none — which may mean the answer
   is the XBRL instance rather than another tag.
3. **The comps set can hold two currencies and only says so per column.** Rule 20 made a single sheet
   honest and marked the comps columns, which is right as far as it goes — the ratio and multiple rows
   are dimensionless and compare fine, and the median is taken only over those. But **Revenue, EBITDA
   and Net income are absolute**, and ASML's €32.67bn sits in the same row as a US filer's dollars with
   only a small note under each ticker to separate them. The single sheet solves this by having one
   currency; a set cannot. Worth deciding whether those three rows should be marked per CELL the way
   the near-cancelled-equity ones are, or whether a mixed-currency set should refuse the absolute rows
   altogether and keep the multiples. Measured cost: only 10 of 426 filers report in anything but USD,
   so a mixed set is rare — but it is exactly the set someone builds to compare ASML with Applied
   Materials, which is a real comp.
4. **Blackstone's segments, which are a question about what the tab is for.** It reports on measures
   with no consolidated counterpart — fee-related earnings, segment distributable earnings — so the
   gate has nothing to reconcile against and shows nothing. Three of its concepts do foot. Whether a
   table can be shown for the concepts that reconcile while saying the rest cannot is a design
   question, not a bug; the risk is that a partial table reads as the whole segment footnote.
5. **NextEra's co-registrant axis.** Its combined 10-K carries Florida Power & Light's own statements
   under `LegalEntityAxis`, which is not a breakdown of the parent, so most of its segment rows are
   correctly excluded and its table comes to $8.76bn of a $27.41bn company. Telling a co-registrant
   axis from a breakdown axis is the general question behind it.
6. **The next sampling frame.** Six are swept now — mega, small/mid, foreign issuers, transition
   reports, restatements, Chapter 11 — and the last four all paid off by varying something STRUCTURAL
   rather than size. Chapter 11 was the named candidate and is done; rules 18 and 19 came out of it.
   No obvious structural axis is left unswept, which is itself worth noticing: the next one probably
   has to be drawn from a mechanism rather than a form. The two that look most promising are filers
   that **restated after a material weakness** — a population EDGAR's full-text search can find and
   `form.idx` cannot — and **spin-offs**, whose first years are carve-out financials for a company
   that did not exist as filed. Worth knowing that the frames are no longer the only way in: rule 20
   came out of reading the UNITS across the filers already cached, and nothing had ever looked at
   them. The same trick is available for anything else carried alongside a value and never inspected.
7. **The four filers rule 15 cannot decide, checked against their filings — two are right and two are
   overstated by 1.2% and 0.2%.** Worth knowing which, because "undecidable" is not the same as
   "probably fine", and the two failures share a cause the rule cannot see past.
   - **Exxon is correct.** Its tag is `LongTermDebtAndCapitalLeaseObligations`, whose taxonomy
     definition is *"classified as noncurrent"*, and its balance sheet agrees: long-term debt 34,241
     against notes and loans payable 9,296, total 43,537 against the 43,500 shown — 0.09% out.
   - **Kenvue is correct, by accident.** Its balance sheet reads 1,453 + 7,071 = 8,524 and the sheet
     shows exactly that, but through `DebtLongtermAndShorttermCombinedAmount` rather than the sum: its
     long-term tag really does include the current maturities (7,821 = 7,071 + 750), so the three-way
     sum would read 9,271. The same accident that rescues Verizon.
   - **Tronox is overstated by $39m (1.2%)** and shows why the rule missed it: its tag carries
     FINANCE LEASES as well, so `T` equals neither Noncurrent nor Noncurrent + Current. In its one
     evidence year T is 2.94bn against a 2.89bn non-current balance and 16m of current maturities —
     a 50m gap where the current portion is 16m, so no identity closes and the rule correctly declines
     to guess. There is no clean second witness for it: the lease residual is untagged.
   - **Iridium is overstated by $3m (0.2%)**, and by a different mechanism entirely — it tags
     `ShortTermBorrowings` and `LongTermDebtCurrent` at the SAME $3m, so the sum counts one figure
     twice regardless of what its long-term tag means. **Closed by rule 16**, which turned out to be a
     class of seven filers rather than one, and which corrects UPS by $3.42bn as well.
8. **`t-corp`'s `out-of-range` bucket could now tell itself apart.** The engine knows which of those
   ratios are near-cancelled-equity cases and which are unexplained; the sweep still reports both the
   same way. Splitting them would leave the finding count meaning "things nobody has accounted for",
   which is what a sweep is for — deliberately not done here, because the counts are a tracked baseline
   and moving them in the same session as an engine change would blur what caused what.
9. **Mezzanine equity tagged inside a class-of-stock dimension** is invisible to companyfacts, which
   is why Instacart's balance sheet is $195m out. Reaching it means reading the XBRL instance for
   balance-sheet facts, which `api/segments.js` already does for breakdowns — a real option, and a
   much larger one than it looks. Watch the Hobby function cap: `api/` is at 12 on the main site and
   this project has room, but a second instance-reading route is a route.

   **What it would buy is now measured, and the number argues against doing it on its own.** After the
   AMTD repair, **1 of the 235 filers across the three frames fails to close its balance sheet** —
   Instacart, by 5.3%; every other gap either closed or sits inside 3%. So the whole new data path buys
   one filer today, against fetching a 1.4–17MB instance on every lookup rather than only when the
   Segments tab is opened. It is a **coverage** decision rather than a correctness one: the class is
   "any balance-sheet fact a filer tags only inside a dimension", the sweeps have found exactly one
   instance of it, and the row already reads as empty rather than guessing. Worth doing when something
   else needs the instance at load time anyway.
10. **Segment coverage beyond the newest 10-K.** Scope is three years by construction; a reader
   comparing a segment to the eight-year sheet above it cannot. Reaching further means more instances
   and a structure that has usually been reorganised, which is why it was not done — but the tab now
   carries enough filers that the question is worth re-asking.

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

The Excel session added the cheapest example of the lot. The download button shipped with `↧`
(U+21A7), a glyph JetBrains Mono does not carry, so the fallback drew a serif capital I and the
primary button on the sheet read **"I DOWNLOAD EXCEL WORKBOOK"**. The build passed, 109 regression
assertions passed, five workbooks opened in Excel with every value matching the page. It took a 4×
crop of a screenshot to see it.

The LTM session's was subtler, and it is the one worth generalising. 3,413 assertions passed and the
comps table still had **Costco's revenue as a bare em-dash between $91bn and $199bn** — correct, and
correct for a reason the page gave nowhere. The engine had a status for it and the table threw the
status away, because a comps grid has no room for the label column the single sheet uses. Every
correctness check can pass on a number that communicates the wrong thing; the sheet's own rule 5 —
*a blank is not one thing* — is a claim about the reader, and only a reader can check it. The
same session's second one came from an existing tool rather than a new eye: adding a seventh header
row to the comps workbook put company names inside the frozen data area, and the Excel check written
for a different export refused it as text in a numeric column. Checks outlive the thing they were
written for, which is an argument for making them structural rather than specific.

The restatement session's is the one that most nearly went wrong, and the record of it is the two
rejected hypotheses rather than the rule. The bug was found in twenty minutes; the first fix — "a Part
III amendment supplies few tags" — was obvious, wrong, and would have passed a casual look, because it
is *true of Identiv* (two tags) and false of the population (median 46). The second — "an exact power
of ten is a scale error" — was closer, and would have **broken Middlesex Water**, whose amendment is
the one filing that has the scale right. Only the third survived contact with all 29 cases. The general
form of that trap is the one rule 8 and the bottom-up-EBIT rejection are both about: a repair that is
right for the filer that prompted it.

The transition-report session's belongs beside it and pushes the same point further. The frame was
built to test three named rules, and what it produced first was a *symptom* — five filers with FY
labels running backwards. Chasing the symptom would have meant fixing the label cascade, which would
have left eight columns overlapping by nine months each and merely made them look consistent. The
finding was one level below the flag. And the fix then exposed a second bug in a rule it had not been
aimed at: once columns could not overlap, Thermo Fisher's seven-year hole became visible, and that was
rule 6 counting years without noticing a gap in them. Neither was reachable from the other two frames,
because both screen on having filed a 10-K and neither varies the calendar.

The foreign-issuer session's is the sharpest version of the whole pattern, and nothing on the page
caught it — a **new sampling frame** did. National Steel's sheet footed, reconciled, ran eight columns
in order and was about 2009. Every automated check this project has passed on it, because every one of
them asks whether the numbers are consistent with each other and none asks whether they are about the
right decade. The frame is what found it, which is the argument for building a new one rather than
tightening the old: both existing sweeps had held at 3 and 29 findings through five consecutive
changes, and they were not going to find this, because they both screen on having filed a 10-K.

The rule 16 / rule 9 session's two are about a table that was *correct* and still misled, which is the
hardest kind to catch with a check. Exxon's collapsed segment table footed to the dollar in every
period and said nothing about being a **reconstruction** — a reader would have taken "Upstream
$107,151,000,000" for a figure Exxon filed, when Exxon filed $55.662bn and $51.489bn and the page added
them. On a site whose header says every figure is the value the company filed, that is the one thing
it cannot leave unmarked, and no reconciliation check can ever fail on it. The other came from asking
where a NEW note should fire and finding that the OLD one had been silent: `flagNote` was keyed to the
newest column, so Old Dominion — one of the two filers rule 15 was written to correct — had been
dropping its current portion from six columns with no explanation on the page since rule 15 shipped.
The generalisation is that a note has to be keyed to the question it answers: "why is this row empty"
is asked of the newest column, "why do these rows not add up" is asked of whichever column does not.

The segment-coverage session's two are both a check agreeing with the code for the wrong reason.
`t-seg.mjs` asserted reconciliation at 1% because the handler gated at 1%, so the suite could never
disagree with it — and both were wrong together, passing a table $1.7bn short of the consolidated line
printed directly beneath it. **A test that shares a constant with the code it tests is not a second
opinion**; the number is written down once now and the suite reads the same one. The other is smaller
and worse: two new rules matched the QName prefix as `\w+`, and the member they exist for is
`us-gaap:OperatingSegmentsMember`, whose standard prefix contains a **hyphen**. Neither rule ever
fired, neither failed, 8,987 assertions passed, and the only symptom was a row on the page labelled
"Operating Segments" sitting beside the four segments it is the total of. Looking at the page found it
in seconds.

The Chapter 11 session's has two halves and the second is the one worth generalising. The first is the
familiar shape: a frame drawn from a hypothesis found the failure it was built for, and the failure
was one level below the flag — six filers whose "fiscal year" was ten months of one, on sheets that
footed and reconciled throughout. The second is that **fixing it exposed a rule that had been enforced
on only one of the two places it applies.** Rule 13 says the financial statements are the periodic
reports; `pickFact` had always honoured it and `annualPeriods` never had, so a DEF 14A could not fill a
cell but could still create the COLUMN the cell sits in. That was invisible for as long as a stub
happened to occupy the same end date first, and it surfaced only because an unrelated change moved the
stub out of the way. Two rules that disagree about the same question will look correct until something
else changes which one gets asked — and the tell was not a wrong number, it was a column of blanks
under a populated equity balance, which rule 5 says is the one thing a blank must never be.

The currency session's is the only bug in this file that was found by reading a field the engine had
always carried and nobody had ever looked at. `pickFact` has returned `meta.unit` since the first
version. Every rule above it is about choosing the right FACT, every check asks whether the numbers
are consistent with each other, and not one of them asks what the numbers are DENOMINATED IN — so a
sheet in euros passed every identity, footed, reconciled, and was typographically indistinguishable
from dollars. It is the National Steel lesson in a second dimension: those checks confirm the figures
are about the right company and the right years, and they are silent about the third thing that has to
be true. The tell, when it was finally looked for, was not subtle — 45 of 426 filers, and a filer
reporting short-term debt at `JPY 948.2m` beside `USD 6.3m` for the same instant, with which one won
decided by JSON key order. **Worth generalising: a value carried through the whole engine and never
asserted on is a value nothing is checking.**

The third thing it found is not a rule at all, and it came from looking at the page: **a number that
is not wrong, only cut in half** — and it took three attempts, two of which are worth more than the fix.
 The sheet opens scrolled to the right-hand edge so the newest year is
visible, and where the table only just overflows — 71px on an eight-column sheet at 1500px — that
scroll hides most of the OLDEST column behind the 260px sticky label. What survives past the label's
edge is not a blank; it is a truncated number that still reads as a number, and CBL's FY2017 revenue of
$927,252,000 renders as **`2,000`** beside $858,557,000. Measured rather than guessed (`scrollLeft` is
70.4 of a 71px maximum) and inherent to the overflow rather than a regression, since some column is
clipped at every scroll position.

Three attempts, and the two that failed are worth more than the one that worked. **Snapping the scroll
to a column boundary** clips the NEWEST column instead — the one the valuation card divides into — so
it trades the defect rather than fixing it. **A shadow on the sticky label cell**, the standard
"content continues under here" affordance, is *inert*: these tables are `border-collapse: collapse`,
where a sticky cell paints at `z-index: auto` and the cells after it in the row paint on top. An 18px
**solid red** shadow rendered as nothing at all, which is how that was established rather than
assumed, and it was reverted rather than shipped subtle-and-invisible — dead markup that looks live is
worse than none, the same reason `pb` carries no `flagNote`.

What works is refusing to auto-scroll at all when the overflow is narrower than one rendered column,
which removes the case entirely for a table that nearly fits — plus a **hairline** at the boundary,
drawn in a non-scrolling wrapper outside the table, measured from the rendered header cell because the
label is content-sized, and only while `scrollLeft > 0`.

**It shipped as a gradient and that was wrong twice over.** Aesthetically: every rule on this site is a
1px hairline on paper and there is no other soft-edged element anywhere, so a 26px grey fade read as a
smudge rather than as an edge — the one thing on the page that looked like a rendering artifact.
And functionally a fade cannot win: to stop a clipped figure being legible it would have to cover the
whole fragment, which is up to a column wide and changes size as you scroll, and an opaque block that
size would break the row rules running under the label. So the honest scope is to MARK the boundary
rather than to erase what is behind it. That is enough here because the case that actually mattered is
already gone — the sheet no longer auto-scrolls when the table nearly fits, so a partial column now
appears only while a reader is actively scrolling and can see the columns moving under the label. CBL now reads $927,252,000 unmasked; Apple, whose overflow is permanently between one and two
column widths, still scrolls and now marks the column it cuts.

**Comps got the same mask and the segment tables deliberately did not**, which is a measurement rather
than a preference. Segments never overflow — scope is the newest 10-K, so three columns, and
`scrollWidth − clientWidth` is **0 at 1500, 1180 and 900px** on Apple, JPMorgan and Caterpillar alike.
A mask there is markup that can never fire, which is the same defect as the shadow that rendered as
nothing. Comps does overflow — 0 with three companies at any width, 64px with six at 1180px, 264px
with eight at 1500px — and it is a weaker case than the sheet's, worth stating: it has no scroller ref
and never auto-scrolls, so it opens with nothing hidden and a reader reaches the bad state only by
scrolling there. But the rows it truncates are Revenue, EBITDA and Net income, where a fragment reads
as a smaller company.
