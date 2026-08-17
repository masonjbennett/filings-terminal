// THE EXTRACTION TEMPLATE — filings.masonjbennett.com
//
// Organised by the tab it feeds in a real model, because that is how the numbers get used: the
// section names below mirror the Jagex build (Historicals, EV Bridge, DCF, LBO, CCA, PTA, Source
// Log). Grounded in the standard IB/PE structure — Mergers & Inquisitions' 3-statement model,
// Wall Street Prep's LBO build, and standard equity-research practice.
//
// Every line declares HOW it is obtained, and that is the load-bearing part of the design:
//   fetched  — a us-gaap tag in the filing. Exact reported value, traceable to an accession number.
//   computed — derived from fetched lines. Deterministic, so it is calculated rather than trusted
//              to a tag that filers apply inconsistently (EBITDA is not a GAAP concept at all).
//   market   — needs a share price. The Finnhub proxy on the main site already supplies this.
//   manual   — judgement or deal terms that exist in no filing. Never invented; surfaced as blanks
//              with a pointer to where a human would look.
//
// `tags` are ordered fallbacks: filers tag the same economic line differently, and Revenue alone
// has three common spellings. First hit wins.

export const SECTIONS = [
// ─────────────────────────────────────────────────────────────── HISTORICALS: INCOME STATEMENT
{ id: "is", title: "Income Statement", feeds: "Historicals · 3-statement", lines: [
  // `Revenues` leads because it is the TOTAL-revenue concept, while
  // RevenueFromContractWithCustomer is only the ASC 606 slice — the two coincide at an ordinary
  // corporate and diverge violently at a financial. MetLife's 606 revenue is $2.4bn of fee income
  // against $77.1bn of total revenue: the sheet was reporting 3% of the top line, and every margin
  // and growth rate built on it. Berkshire read 33% low, Welltower 22%. Putting the narrow tag
  // first was safe only for as long as nothing but operating companies were looked up.
  //
  // Reordering costs nothing where `Revenues` is stale or absent: pickFact skips a tag with no fact
  // for the period, so Apple (which never files it) and Equinix (which stopped in 2020) fall
  // straight through to the 606 tag exactly as before.
  // `RevenuesNetOfInterestExpense` sits second because it is how every broker-dealer and several
  // banks state their top line, and it must outrank the ASC 606 tag for the same reason `Revenues`
  // does — at a financial the 606 figure is the fee slice, not the total. Without it Goldman Sachs
  // and Morgan Stanley rendered with NO revenue line whatsoever (they are SIC 6211, so they take
  // the corporate sheet and get no bank overlay to fall back on), and Wells Fargo lost its top line
  // in 2019 when it stopped tagging `Revenues`. GS $58bn, MS $71bn, WFC $84bn.
  // The last two are the LENDING top lines, and they are last for the reason rule 11 exists: a tag
  // that only fires where nothing else resolves cannot displace a filer that was already right. A
  // BDC and a mortgage REIT state no "revenue" at all — Ladder Capital and Carlyle Secured Lending
  // rendered with a blank top line and therefore no margin, no growth and no EV/Revenue.
  //
  // `NetInvestmentIncome` is the obvious candidate for a BDC and is WRONG, in exactly the way rule 9
  // is about: it is struck AFTER operating expenses. Carlyle's is $102.7m against $255.6m of gross
  // investment income and $152.9m of expenses — a profit measure sitting in the revenue row, which
  // would have made every margin below it meaningless. `GrossInvestmentIncomeOperating` is the line
  // the filing calls total investment income.
  { k: "revenue", label: "Total revenue", how: "fetched", tags: ["Revenues","RevenuesNetOfInterestExpense","RevenueFromContractWithCustomerExcludingAssessedTax","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","GrossInvestmentIncomeOperating","InterestAndDividendIncomeOperating"],
    // A row that resolved from one of those is not reporting the same thing the label says, and rule
    // 5's discipline — a blank is not one thing — applies just as much to a figure that IS there.
    tagNote: {
      GrossInvestmentIncomeOperating: "Total investment income, which is what a business development company reports instead of revenue. Net investment income, the line below it in the filing, is struck after operating expenses.",
      InterestAndDividendIncomeOperating: "Total interest and dividend income. A lender presents no total-revenue line, so this is the top of the interest margin and excludes any fee or property income reported beside it.",
    },
    // A DEPOSITORY must never take gross interest income as its revenue, and this is the whole
    // reason `omitFor` exists. A bank's top line is net interest income plus fees, which
    // `DERIVED_BANK.revenue` reconstructs — but only when the fetched row came back empty, so simply
    // adding the tag above filled the row and switched the reconstruction off. Five small banks in
    // the sweep moved to gross interest income and none of them looked broken: Hawthorn's FY2019
    // read $64m against a real $58m of net revenue, with every margin under it quietly rebased.
    // Caught by diffing all 167 filers, not by any assertion.
    omitFor: { bank: ["InterestAndDividendIncomeOperating"] } },
  { k: "cogs", label: "Cost of revenue", how: "fetched", tags: ["CostOfGoodsAndServicesSold","CostOfRevenue","CostOfServices"] },
  { k: "grossProfit", label: "Gross profit", how: "fetched", tags: ["GrossProfit"], fallback: "revenue - cogs" },
  { k: "rnd", label: "Research & development", how: "fetched", tags: ["ResearchAndDevelopmentExpense"] },
  { k: "sam", label: "Selling & marketing", how: "fetched", tags: ["SellingAndMarketingExpense","MarketingExpense"] },
  { k: "ga", label: "General & administrative", how: "fetched", tags: ["GeneralAndAdministrativeExpense"] },
  { k: "sga", label: "SG&A (combined)", how: "fetched", tags: ["SellingGeneralAndAdministrativeExpense"] },
  { k: "otherOpex", label: "Other operating expense", how: "fetched", tags: ["OtherCostAndExpenseOperating","RestructuringCharges"] },
  { k: "totalOpex", label: "Total operating expenses", how: "fetched", tags: ["OperatingExpenses","CostsAndExpenses"] },
  // Kept separate from totalOpex because the two are NOT the same subtotal: `CostsAndExpenses` is
  // all-in (cost of revenue AND usually interest), while `OperatingExpenses` sits below a gross
  // profit line and excludes cost of revenue. Reported as its own row rather than folded into the
  // one above, since which of the two a filer uses changes what the number means.
  { k: "totalCosts", label: "Total costs & expenses", how: "fetched", tags: ["CostsAndExpenses"] },
  // `blankNote` shows only when the newest column is empty, because "n/a" is technically right and
  // reads as a gap the reader should go and close. This is the widest blank on the corporate sheet —
  // 20% of the cross-sector sample, Chevron and J&J among them — and it takes EBITDA, the margins,
  // Net debt/EBITDA and EV/EBITDA with it, so the row that starts the chain should say why.
  { k: "ebit", label: "Operating income (EBIT)", how: "fetched", tags: ["OperatingIncomeLoss"],
    blankNote: "This filer's recent statements present no operating income subtotal. Deriving one from pre-tax income was tested against 422 filer-years and missed by up to 350%, so the row is left blank rather than estimated." },
  { k: "da", label: "Depreciation & amortisation", how: "fetched", tags: ["DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet","DepreciationAndAmortization","Depreciation"] },
  { k: "ebitda", label: "EBITDA", how: "computed", formula: "ebit + da", note: "Not a GAAP concept — always computed, never tagged" },
  { k: "sbc", label: "Stock-based compensation", how: "fetched", tags: ["ShareBasedCompensation","AllocatedShareBasedCompensationExpense"] },
  { k: "ebitdaSbc", label: "EBITDA ex-SBC", how: "computed", formula: "ebitda - sbc", note: "The number a credit committee argues about" },
  { k: "intExp", label: "Interest expense", how: "fetched", tags: ["InterestExpense","InterestExpenseDebt","InterestExpenseNonoperating"] },
  { k: "intInc", label: "Interest income", how: "fetched", tags: ["InvestmentIncomeInterest","InterestIncomeOther"] },
  { k: "otherInc", label: "Other income/(expense), net", how: "fetched", tags: ["OtherNonoperatingIncomeExpense","NonoperatingIncomeExpense"] },
  { k: "pretax", label: "Pre-tax income", how: "fetched", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest","IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"] },
  { k: "tax", label: "Income tax expense", how: "fetched", tags: ["IncomeTaxExpenseBenefit"] },
  { k: "netIncome", label: "Net income", how: "fetched", tags: ["NetIncomeLoss","ProfitLoss"] },
  { k: "nci", label: "Less: noncontrolling interest", how: "fetched", tags: ["NetIncomeLossAttributableToNoncontrollingInterest"] },
  { k: "niToCommon", label: "Net income to common", how: "fetched", tags: ["NetIncomeLossAvailableToCommonStockholdersBasic"], fallback: "netIncome - nci - prefDiv" },
  { k: "prefDiv", label: "Preferred dividends", how: "fetched", tags: ["PreferredStockDividendsIncomeStatementImpact"] },
]},
// ─────────────────────────────────────────────────────────────── HISTORICALS: BALANCE SHEET
{ id: "bs", title: "Balance Sheet", feeds: "Historicals · EV Bridge", lines: [
  { k: "cash", label: "Cash & equivalents", how: "fetched", tags: ["CashAndCashEquivalentsAtCarryingValue","CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
  { k: "sti", label: "Short-term investments", how: "fetched", tags: ["ShortTermInvestments","MarketableSecuritiesCurrent","AvailableForSaleSecuritiesDebtSecuritiesCurrent"] },
  { k: "ar", label: "Accounts receivable, net", how: "fetched", tags: ["AccountsReceivableNetCurrent","ReceivablesNetCurrent"] },
  { k: "inventory", label: "Inventory", how: "fetched", tags: ["InventoryNet"] },
  { k: "prepaid", label: "Prepaid & other current assets", how: "fetched", tags: ["OtherAssetsCurrent","PrepaidExpenseAndOtherAssetsCurrent"] },
  { k: "curAssets", label: "Total current assets", how: "fetched", tags: ["AssetsCurrent"] },
  { k: "ppe", label: "PP&E, net", how: "fetched", tags: ["PropertyPlantAndEquipmentNet"] },
  { k: "ppeGross", label: "PP&E, gross", how: "fetched", tags: ["PropertyPlantAndEquipmentGross"] },
  { k: "accumDep", label: "Accumulated depreciation", how: "fetched", tags: ["AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment"] },
  { k: "goodwill", label: "Goodwill", how: "fetched", tags: ["Goodwill"] },
  { k: "intangibles", label: "Intangibles, ex-goodwill", how: "fetched", tags: ["FiniteLivedIntangibleAssetsNet","IntangibleAssetsNetExcludingGoodwill"] },
  { k: "olRou", label: "Operating lease right-of-use asset", how: "fetched", tags: ["OperatingLeaseRightOfUseAsset"] },
  { k: "ltInvest", label: "Long-term investments", how: "fetched", tags: ["LongTermInvestments","MarketableSecuritiesNoncurrent"] },
  { k: "otherAssets", label: "Other non-current assets", how: "fetched", tags: ["OtherAssetsNoncurrent"] },
  { k: "totalAssets", label: "Total assets", how: "fetched", tags: ["Assets"] },
  { k: "ap", label: "Accounts payable", how: "fetched", tags: ["AccountsPayableCurrent","AccountsPayableAndAccruedLiabilitiesCurrent"] },
  { k: "accrued", label: "Accrued liabilities", how: "fetched", tags: ["AccruedLiabilitiesCurrent","EmployeeRelatedLiabilitiesCurrent"] },
  { k: "defRevCur", label: "Deferred revenue, current", how: "fetched", tags: ["ContractWithCustomerLiabilityCurrent","DeferredRevenueCurrent"] },
  { k: "stDebt", label: "Short-term borrowings", how: "fetched", tags: ["ShortTermBorrowings","CommercialPaper","OtherShortTermBorrowings"] },
  // Left at the one unambiguous tag ON PURPOSE. `LongTermDebtAndCapitalLeaseObligationsCurrent` and
  // `DebtCurrent` were both added during the corporate sweep and both backed out, because adding a
  // current portion is only correct when the long-term figure it is added to EXCLUDES it — and
  // `LongTermDebt`, the tag that resolves for most large filers, means both things in the wild.
  // Duke tags it inclusively (non-current 80.1 + current 7.1 = 87.2); Home Depot appears to use it
  // for the non-current balance alone. Adding a current portion on top moved 12 filers by billions
  // with no way to tell which had just been double counted. See README "the current-maturities
  // ambiguity" — it needs a per-filer test, not a tag.
  { k: "ltdCur", label: "Current portion of long-term debt", how: "fetched", tags: ["LongTermDebtCurrent"],
    // The per-filer verdict is now made, so this row can be right and STILL not belong in the total —
    // and a reader adding the debt rows up would get a different number from the one printed below
    // them. Warner Bros Discovery's $139m sits inside its $32,567m long-term figure, so total debt is
    // $32,567m and not $32,706m. Saying so is the same obligation the segments tab took on: a table
    // whose rows do not visibly sum to its own total has to explain itself on the page.
    flagNote: { ltdCurInLtDebt: "Already inside the long-term debt figure below — this filer's long-term tag includes current maturities, checked against a year in which it tagged both. Counted once in total debt." } },
  { k: "olCur", label: "Operating lease liability, current", how: "fetched", tags: ["OperatingLeaseLiabilityCurrent"] },
  { k: "flCur", label: "Finance lease liability, current", how: "fetched", tags: ["FinanceLeaseLiabilityCurrent"] },
  { k: "curLiab", label: "Total current liabilities", how: "fetched", tags: ["LiabilitiesCurrent"] },
  // The third tag is last on purpose — it is only reached when a filer uses neither of the usual
  // two, which is the case for MetLife ($14.2bn) and JPMorgan ($460.5bn). Both were reporting total
  // debt as their short-term borrowings alone. It carries current maturities inside it, so a filer
  // that tagged `ltdCur` AND only this would double-count that slice; none of those tested does,
  // and the two eras above cover everything that does tag `ltdCur`. The fourth is Capital One's,
  // which reported $1.1bn of total debt — its short-term borrowings alone — against a real $52bn.
  // Both of the last two are LONG-TERM debt including current maturities, not all-in totals, so
  // adding `stDebt` on top of them is correct rather than double counting.
  // The filer's OWN all-in debt total, believed outright where it exists rather than added to
  // anything. It lives here, in the corporate balance sheet, rather than in an industry overlay,
  // because the filers that need it are not one industry: Progressive tags LongTermDebtCurrent as
  // literally 0 and puts its real $6.9bn here (the three-way sum below returned "Total debt 0",
  // "Debt / equity 0.00x" and a net debt of MINUS $10.1bn); UnitedHealth files $77.7bn here against
  // the $69.5bn its long-term tag alone reports; and Goldman Sachs files $356bn here and nothing at
  // all in the three tags below it. Confining this to the carrier overlays left every broker-dealer
  // unable to reach it.
  { k: "debtAllIn", label: "Debt outstanding, long + short", how: "fetched", tags: ["DebtLongtermAndShorttermCombinedAmount"] },
  // `LongTermDebtAndCapitalLeaseObligations` is the corporate sweep's addition, and WHERE it sits
  // matters more than that it is here. Without it Southern reported $722m of total debt — its
  // short-term borrowings alone — against $66bn, the Capital One failure in a utility; Sempra read
  // $4.2bn, Cigna a confident $0.0bn, and Dow and Nucor rendered blank.
  //
  // It goes LAST rather than with its siblings because it is the NON-CURRENT balance while the two
  // above it include current maturities. Placed third it displaced them and quietly REMOVED the
  // current portion from eight filers that were already right — Coca-Cola fell $1.8bn, Comcast
  // $5.9bn, RTX $3.4bn. Reached last, it only ever fires for a filer that tags nothing else, which
  // is exactly the population that was broken. It carries finance leases inside it, which the sheet
  // also lists separately as debt-like items; a filer that reaches it is one presenting debt and
  // leases as a single balance, so counting it as debt is what its own balance sheet does.
  { k: "ltDebt", label: "Long-term debt", how: "fetched", tags: ["LongTermDebtNoncurrent","LongTermDebt","LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities","DebtAndCapitalLeaseObligations","LongTermDebtAndCapitalLeaseObligations","ConvertibleDebtNoncurrent"] },
  { k: "olNon", label: "Operating lease liability, non-current", how: "fetched", tags: ["OperatingLeaseLiabilityNoncurrent"] },
  { k: "flNon", label: "Finance lease liability, non-current", how: "fetched", tags: ["FinanceLeaseLiabilityNoncurrent"] },
  { k: "defTaxLiab", label: "Deferred tax liabilities", how: "fetched", tags: ["DeferredIncomeTaxLiabilitiesNet","DeferredTaxLiabilitiesNoncurrent"] },
  { k: "pension", label: "Pension & post-retirement", how: "fetched", tags: ["DefinedBenefitPensionPlanLiabilitiesNoncurrent","LiabilityDefinedBenefitPlanNoncurrent"] },
  { k: "totalLiab", label: "Total liabilities", how: "fetched", tags: ["Liabilities"] },
  // Mezzanine equity — redeemable preferred, usually a VC round that has not converted. It sits
  // BETWEEN liabilities and equity on the face of the balance sheet and is in neither `Liabilities`
  // nor `StockholdersEquity`, so without this row a filer that has any simply does not foot. The
  // small/mid-cap sweep found it exactly: Rhythm Pharmaceuticals reports $480m of assets against
  // $210m of liabilities and $139m of equity, and the missing $131m is this line to the dollar.
  // Not added into any total here — it is neither debt nor common equity, and which one a reader
  // treats it as depends on the redemption terms, which are in the footnote and not in XBRL.
  { k: "tempEquity", label: "Mezzanine (redeemable) equity", how: "fetched",
    tags: ["TemporaryEquityCarryingAmountAttributableToParent", "TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterest", "TemporaryEquityCarryingAmount"],
    note: "Between liabilities and equity — counted in neither total above" },
  { k: "preferred", label: "Preferred stock", how: "fetched", tags: ["PreferredStockValue"] },
  { k: "retained", label: "Retained earnings", how: "fetched", tags: ["RetainedEarningsAccumulatedDeficit"] },
  { k: "treasury", label: "Treasury stock", how: "fetched", tags: ["TreasuryStockValue","TreasuryStockCommonValue"] },
  { k: "aoci", label: "AOCI", how: "fetched", tags: ["AccumulatedOtherComprehensiveIncomeLossNetOfTax"] },
  { k: "equity", label: "Total shareholders' equity", how: "fetched", tags: ["StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { k: "nciBs", label: "Noncontrolling interest", how: "fetched", tags: ["MinorityInterest"] },
]},
// ─────────────────────────────────────────────────────────────── HISTORICALS: CASH FLOW
{ id: "cf", title: "Cash Flow", feeds: "Historicals · DCF · LBO", lines: [
  { k: "cfDa", label: "D&A (cash flow)", how: "fetched", tags: ["DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet"] },
  { k: "deferredTax", label: "Deferred income taxes", how: "fetched", tags: ["DeferredIncomeTaxExpenseBenefit"] },
  { k: "chgAr", label: "Change in receivables", how: "fetched", tags: ["IncreaseDecreaseInAccountsReceivable"] },
  { k: "chgInv", label: "Change in inventory", how: "fetched", tags: ["IncreaseDecreaseInInventories"] },
  { k: "chgAp", label: "Change in payables", how: "fetched", tags: ["IncreaseDecreaseInAccountsPayable"] },
  { k: "cfo", label: "Cash from operations", how: "fetched", tags: ["NetCashProvidedByUsedInOperatingActivities","NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { k: "capex", label: "Capital expenditures", how: "fetched", tags: ["PaymentsToAcquirePropertyPlantAndEquipment","PaymentsToAcquireProductiveAssets"] },
  { k: "capSoftware", label: "Capitalised software", how: "fetched", tags: ["PaymentsToDevelopSoftware","PaymentsForSoftware"] },
  { k: "acquisitions", label: "Acquisitions, net of cash", how: "fetched", tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired"] },
  { k: "divestitures", label: "Divestitures", how: "fetched", tags: ["ProceedsFromDivestitureOfBusinesses"] },
  { k: "cfi", label: "Cash from investing", how: "fetched", tags: ["NetCashProvidedByUsedInInvestingActivities"] },
  { k: "debtIssued", label: "Debt issued", how: "fetched", tags: ["ProceedsFromIssuanceOfLongTermDebt","ProceedsFromIssuanceOfDebt","ProceedsFromNotesPayable"] },
  { k: "debtRepaid", label: "Debt repaid", how: "fetched", tags: ["RepaymentsOfLongTermDebt","RepaymentsOfDebt"] },
  { k: "buybacks", label: "Share repurchases", how: "fetched", tags: ["PaymentsForRepurchaseOfCommonStock"] },
  // AvalonBay and Essex file neither of the first two — `PaymentsOfOrdinaryDividends` is what they
  // use, and without it the FFO payout ratio (the number a REIT is bought for) has no numerator.
  { k: "dividends", label: "Dividends paid", how: "fetched", tags: ["PaymentsOfDividendsCommonStock","PaymentsOfDividends","PaymentsOfOrdinaryDividends","DividendsCommonStockCash"] },
  { k: "cff", label: "Cash from financing", how: "fetched", tags: ["NetCashProvidedByUsedInFinancingActivities"] },
  { k: "fcf", label: "Free cash flow", how: "computed", formula: "cfo - capex" },
  { k: "fcfConv", label: "FCF conversion", how: "computed", formula: "fcf / netIncome" },
]},
// ─────────────────────────────────────────────────────────────── SHARES
{ id: "sh", title: "Share Data", feeds: "Historicals · CCA · EV Bridge", lines: [
  { k: "epsBasic", label: "EPS, basic", how: "fetched", tags: ["EarningsPerShareBasic"] },
  { k: "epsDil", label: "EPS, diluted", how: "fetched", tags: ["EarningsPerShareDiluted"] },
  { k: "wasoBasic", label: "Weighted avg shares, basic", how: "fetched", tags: ["WeightedAverageNumberOfSharesOutstandingBasic"] },
  { k: "wasoDil", label: "Weighted avg shares, diluted", how: "fetched", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  // `latest` because the cover-page count is dated the day the filing went out, not the fiscal
  // year end — it matches no period and must be taken as the most recent value instead.
  { k: "sharesOut", label: "Shares outstanding (cover)", how: "fetched", latest: true, tags: ["dei:EntityCommonStockSharesOutstanding"], note: "Cover page of the most recent filing — the count market cap is built on" },
  { k: "dps", label: "Dividends per share", how: "fetched", tags: ["CommonStockDividendsPerShareDeclared"] },
]},
// ─────────────────────────────────────────────────────────────── DERIVED
{ id: "margins", title: "Margins & Growth", feeds: "Historicals · CCA", derivedOnly: true, lines: [
  { k: "grossMargin", label: "Gross margin", how: "computed", formula: "grossProfit / revenue" },
  { k: "ebitdaMargin", label: "EBITDA margin", how: "computed", formula: "ebitda / revenue" },
  { k: "ebitMargin", label: "EBIT margin", how: "computed", formula: "ebit / revenue" },
  { k: "netMargin", label: "Net margin", how: "computed", formula: "netIncome / revenue" },
  { k: "fcfMargin", label: "FCF margin", how: "computed", formula: "fcf / revenue" },
  { k: "revGrowth", label: "Revenue growth, YoY", how: "computed", formula: "revenue / revenue[-1] - 1" },
  { k: "ebitdaGrowth", label: "EBITDA growth, YoY", how: "computed", formula: "ebitda / ebitda[-1] - 1" },
  { k: "epsGrowth", label: "EPS growth, YoY", how: "computed", formula: "epsDil / epsDil[-1] - 1" },
  { k: "revCagr3", label: "Revenue CAGR, 3yr", how: "computed", formula: "(revenue / revenue[-3])^(1/3) - 1" },
  { k: "revCagr5", label: "Revenue CAGR, 5yr", how: "computed", formula: "(revenue / revenue[-5])^(1/5) - 1" },
  { k: "taxRate", label: "Effective tax rate", how: "computed", formula: "tax / pretax" },
]},
{ id: "credit", title: "Credit & Leverage", feeds: "LBO · Debt schedule", derivedOnly: true, lines: [
  { k: "totalDebt", label: "Total debt", how: "computed", formula: "stDebt + ltdCur + ltDebt" },
  { k: "totalDebtLeases", label: "Total debt incl. leases", how: "computed", formula: "totalDebt + olCur + olNon + flCur + flNon", note: "Lenders increasingly capitalise leases" },
  { k: "netDebt", label: "Net debt", how: "computed", formula: "totalDebt - cash - sti" },
  { k: "netLev", label: "Net debt / EBITDA", how: "computed", formula: "netDebt / ebitda", note: "The covenant that actually gets tested" },
  { k: "grossLev", label: "Total debt / EBITDA", how: "computed", formula: "totalDebt / ebitda" },
  { k: "intCover", label: "EBITDA / interest expense", how: "computed", formula: "ebitda / intExp" },
  { k: "fccr", label: "(EBITDA − capex) / interest", how: "computed", formula: "(ebitda - capex) / intExp", note: "Fixed-charge coverage proxy" },
  { k: "debtEquity", label: "Debt / equity", how: "computed", formula: "totalDebt / equity" },
  { k: "debtCap", label: "Debt / total capital", how: "computed", formula: "totalDebt / (totalDebt + equity)" },
  { k: "currentRatio", label: "Current ratio", how: "computed", formula: "curAssets / curLiab" },
  { k: "quickRatio", label: "Quick ratio", how: "computed", formula: "(curAssets - inventory) / curLiab" },
]},
// "Total debt AND DEBT-LIKE ITEMS" is Goldman's own phrase in the EA fairness opinion, and it is
// not the same as total debt. Getting the EV bridge right means picking these up — every one is
// tagged, and every one of them is a line a junior analyst forgets.
{ id: "debtlike", title: "Debt-Like Items", feeds: "EV Bridge · LBO", lines: [
  { k: "pensionUnderfunded", label: "Underfunded pension", how: "fetched", tags: ["DefinedBenefitPlanFundedStatusOfPlan","DefinedBenefitPensionPlanLiabilitiesNoncurrent"] },
  { k: "deferredComp", label: "Deferred compensation", how: "fetched", tags: ["DeferredCompensationLiabilityClassifiedNoncurrent"] },
  { k: "assetRetirement", label: "Asset retirement obligations", how: "fetched", tags: ["AssetRetirementObligationsNoncurrent"] },
  { k: "uncertainTax", label: "Uncertain tax positions", how: "fetched", tags: ["LiabilityForUncertainTaxPositionsNoncurrent"] },
  { k: "debtLikeTotal", label: "Total debt-like items", how: "computed", formula: "olCur + olNon + flCur + flNon + pensionUnderfunded + deferredComp + assetRetirement" },
]},
// Adjusted EBITDA is what the multiple is actually applied to — GS valued EA on EV/NTM Adjusted
// EBITDA, not GAAP EBITDA. The adjustments themselves are judgement and must never be auto-applied,
// but the CANDIDATES are tagged, so the tool can lay out an add-back worksheet with each one found
// and let him choose. That is the difference between helping and inventing.
{ id: "addbacks", title: "Add-Back Candidates", feeds: "Adjusted EBITDA · QoE", lines: [
  { k: "restructuring", label: "Restructuring charges", how: "fetched", tags: ["RestructuringCharges","RestructuringSettlementAndImpairmentProvisions"] },
  { k: "impairment", label: "Goodwill / asset impairment", how: "fetched", tags: ["GoodwillImpairmentLoss","AssetImpairmentCharges"] },
  { k: "acquisitionCosts", label: "Acquisition-related costs", how: "fetched", tags: ["BusinessCombinationAcquisitionRelatedCosts"] },
  { k: "litigation", label: "Litigation settlements", how: "fetched", tags: ["LitigationSettlementExpense","LossContingencyAccrualAtCarryingValue"] },
  { k: "gainOnSale", label: "Gains/(losses) on disposal", how: "fetched", tags: ["GainLossOnDispositionOfAssets","GainLossOnSaleOfBusiness"] },
  { k: "adjEbitda", label: "Adjusted EBITDA", how: "manual", note: "Which add-backs are truly non-recurring is judgement — the tool proposes, never decides" },
]},
{ id: "returns", title: "Returns & Working Capital", feeds: "Historicals · Diligence", derivedOnly: true, lines: [
  { k: "nopat", label: "NOPAT", how: "computed", formula: "ebit * (1 - taxRate)" },
  { k: "investedCap", label: "Invested capital", how: "computed", formula: "totalDebt + equity - cash" },
  { k: "roic", label: "ROIC", how: "computed", formula: "nopat / investedCap" },
  { k: "roe", label: "ROE", how: "computed", formula: "netIncome / equity" },
  { k: "roa", label: "ROA", how: "computed", formula: "netIncome / totalAssets" },
  { k: "assetTurn", label: "Asset turnover", how: "computed", formula: "revenue / totalAssets" },
  { k: "dso", label: "DSO", how: "computed", formula: "ar / revenue * 365" },
  { k: "dio", label: "DIO", how: "computed", formula: "inventory / cogs * 365" },
  { k: "dpo", label: "DPO", how: "computed", formula: "ap / cogs * 365" },
  { k: "ccc", label: "Cash conversion cycle", how: "computed", formula: "dso + dio - dpo" },
  { k: "nwc", label: "Net working capital", how: "computed", formula: "(curAssets - cash - sti) - (curLiab - stDebt - ltdCur)" },
  { k: "nwcPctRev", label: "NWC % of revenue", how: "computed", formula: "nwc / revenue" },
  { k: "capexPctRev", label: "Capex % of revenue", how: "computed", formula: "capex / revenue" },
  { k: "daPctRev", label: "D&A % of revenue", how: "computed", formula: "da / revenue" },
  { k: "sbcPctRev", label: "SBC % of revenue", how: "computed", formula: "sbc / revenue" },
]},
{ id: "ev", title: "EV Bridge & Valuation", feeds: "EV Bridge · CCA · Football Field", derivedOnly: true, lines: [
  { k: "price", label: "Share price", how: "market" },
  { k: "mktCap", label: "Market capitalisation", how: "market", formula: "price * sharesOut" },
  { k: "ev", label: "Enterprise value", how: "market", formula: "mktCap + totalDebt + preferred + nciBs - cash - sti" },
  { k: "evRev", label: "EV / Revenue", how: "market", formula: "ev / revenue" },
  { k: "evEbitda", label: "EV / EBITDA", how: "market", formula: "ev / ebitda" },
  { k: "evEbit", label: "EV / EBIT", how: "market", formula: "ev / ebit" },
  { k: "evFcf", label: "EV / FCF", how: "market", formula: "ev / fcf" },
  { k: "pe", label: "P / E", how: "market", formula: "price / epsDil" },
  { k: "pb", label: "P / B", how: "market", formula: "mktCap / equity" },
  { k: "fcfYield", label: "FCF yield", how: "market", formula: "fcf / mktCap" },
  { k: "divYield", label: "Dividend yield", how: "market", formula: "dps / price" },
  { k: "bvps", label: "Book value per share", how: "computed", formula: "equity / sharesOut" },
  { k: "tbvps", label: "Tangible book per share", how: "computed", formula: "(equity - goodwill - intangibles) / sharesOut" },
]},
{ id: "dcf", title: "DCF Inputs", feeds: "DCF", derivedOnly: true, lines: [
  { k: "ufcf", label: "Unlevered FCF", how: "computed", formula: "nopat + da - capex - chgNwc" },
  { k: "chgNwc", label: "Change in NWC", how: "computed", formula: "nwc - nwc[-1]" },
  { k: "cashTaxRate", label: "Cash tax rate", how: "computed", formula: "(tax - deferredTax) / pretax" },
  { k: "netDebtBridge", label: "Net debt (equity bridge)", how: "computed", formula: "netDebt" },
  // The EA build discounted a separate NOL/tax-asset stream, mirroring the Goldman fairness
  // opinion. Carryforwards ARE tagged, so that input can be fetched rather than hunted.
  { k: "nol", label: "NOL carryforwards", how: "fetched", tags: ["OperatingLossCarryforwards","DeferredTaxAssetsOperatingLossCarryforwards"] },
  { k: "taxCredits", label: "Tax credit carryforwards", how: "fetched", tags: ["TaxCreditCarryforwardAmount","DeferredTaxAssetsTaxCreditCarryforwards"] },
  { k: "wacc", label: "WACC", how: "manual", note: "Beta, ERP and cost of debt are judgement — never auto-filled" },
  { k: "terminalGrowth", label: "Terminal growth", how: "manual" },
]},
// The equity-value bridge in a buyout is not just shares × price: vested options and unvested RSUs
// get cashed out, and the EA sources & uses carried both. Award counts are tagged.
{ id: "dilution", title: "Dilution & Equity Awards", feeds: "LBO Sources & Uses · Future Share Price", lines: [
  { k: "optionsOut", label: "Options outstanding", how: "fetched", tags: ["ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber"] },
  { k: "optionsStrike", label: "Weighted avg exercise price", how: "fetched", tags: ["ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice"] },
  { k: "rsuOut", label: "Unvested RSUs", how: "fetched", tags: ["ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber"] },
  { k: "unrecognisedComp", label: "Unrecognised comp cost", how: "fetched", tags: ["EmployeeServiceShareBasedCompensationNonvestedAwardsTotalCompensationCostNotYetRecognized"] },
  { k: "treasuryMethod", label: "Fully diluted shares (TSM)", how: "computed", formula: "sharesOut + optionsOut - (optionsOut * optionsStrike / price) + rsuOut" },
]},
// The EA build carried a Premia Paid tab off the undisturbed price. Both inputs are market data,
// not filings — but the announcement 8-K that sets the "undisturbed" date IS findable.
{ id: "premia", title: "Premia Paid", feeds: "Premia Paid · Deal Summary", derivedOnly: true, lines: [
  { k: "undisturbed", label: "Undisturbed share price", how: "market", note: "Price the day before the leak/announcement" },
  { k: "offerPrice", label: "Offer price per share", how: "manual", note: "From the merger 8-K / DEFM14A" },
  { k: "premium1d", label: "Premium to undisturbed", how: "computed", formula: "offerPrice / undisturbed - 1" },
]},
{ id: "lbo", title: "LBO Inputs", feeds: "LBO Model", derivedOnly: true, lines: [
  { k: "ltmEbitda", label: "LTM EBITDA", how: "computed", formula: "sum(last 4 quarters)", note: "Built from 10-Qs — the entry-multiple denominator" },
  { k: "ltmRevenue", label: "LTM revenue", how: "computed", formula: "sum(last 4 quarters)" },
  { k: "entryNetDebt", label: "Net debt at entry", how: "computed", formula: "netDebt" },
  { k: "maintCapex", label: "Maintenance capex", how: "manual", note: "Not split from growth capex in any filing" },
  { k: "addBacks", label: "EBITDA add-backs", how: "manual", note: "Judgement — the tool must never invent these" },
  { k: "sourcesUses", label: "Sources & uses", how: "manual", note: "Deal terms, not financials" },
  { k: "debtTranches", label: "Debt tranches & pricing", how: "manual" },
]},
{ id: "pta", title: "Precedent Transactions", feeds: "PTA", derivedOnly: true, lines: [
  { k: "ptaFilings", label: "Related 8-K / DEFM14A", how: "fetched", note: "The tool can FIND merger 8-Ks (Item 1.01/2.01) and merger proxies" },
  { k: "ptaMultiples", label: "Transaction multiples", how: "manual", note: "Deal values and multiples are not XBRL — PitchBook/CapIQ territory" },
]},
];

// ── Industry handling ──────────────────────────────────────────────────────────────────────────
// Detected from the SIC code SEC already assigns, not guessed from which tags are present — a
// corporate with a finance arm reports loans too, and would be misread as a bank.
//
// "Insurance" is not one industry, and treating 6311-6411 as one sheet was the first thing the
// research killed. Four business models sit inside that range and they do not share a metric:
//   • a P&C carrier is judged on the combined ratio, reserve development and premium leverage;
//   • a life carrier has no combined ratio at all — it is spread businesses and reserves, read on
//     the benefit ratio and book value per share EX-AOCI;
//   • a health plan (6324) is an operating company whose cost of goods is medical claims: it keeps
//     EBIT, EBITDA and EV multiples, which are category errors for the other two;
//   • an agent or broker (6411) underwrites nothing. AJG, AON and BRO file
//     RevenueFromContractWithCustomer, CostsAndExpenses and D&A like any services company — no
//     premiums earned, no reserves, no float. Checked against all four: the corporate template is
//     already the right sheet for them, so they get no overlay at all.
// 6300-6310 ("Insurance Carriers", unspecified) is routed to P&C: the generic code is used by
// carriers whose statements are short-duration, and the P&C overlay degrades to "not tagged"
// rather than to a wrong number if that is ever not so.
export const INDUSTRY = sic => {
  const n = Number(sic);
  if (!n) return "corporate";
  if (n >= 6020 && n <= 6199) return "bank";      // depository + nondepository credit
  if (n === 6324) return "health";                // hospital & medical service plans (managed care)
  if (n >= 6311 && n <= 6321) return "life";      // life, accident & health carriers
  if ((n >= 6300 && n <= 6310) || (n >= 6331 && n <= 6399)) return "pc";  // fire/marine/casualty, surety, title
  if (n === 6411) return "corporate";             // agents & brokers — fee businesses, see above
  // Security brokers/dealers (6211), investment advice (6282) and the rest of 6200-6299. One code
  // range, three businesses — bulge-bracket broker-dealers, advisory boutiques, and alternative
  // asset managers — but they share the metric that decides all of them: what share of revenue is
  // paid to the people who produced it. Goldman runs a 32% compensation ratio, Evercore 64%, PJT
  // 68%, and no reader of this sector looks at anything else first.
  if (n >= 6200 && n <= 6299) return "advisory";
  if (n === 6798) return "reit";
  return "corporate";
};

// What to call the filer in a blanked cell. Without this the sheet says "n/a for a pc", and a label
// a reader has to decode is worse than no label.
export const INDUSTRY_LABEL = {
  bank: "bank", pc: "P&C insurer", life: "life insurer", health: "health plan", reit: "REIT",
  advisory: "broker-dealer",
};

// Which tags the fiscal CALENDAR is derived from — how many columns the sheet has, and what each
// one is dated. Revenue is the natural anchor for a corporate, but it is only an anchor if the
// filer tags it, and a financial need not: Wells Fargo stopped filing `Revenues` after 2019 and
// reports interest and noninterest income instead, so its terminal had been rendering four stale
// columns ending in FY2019 ever since the bank overlay shipped — every figure correct, the whole
// recent history simply absent. It survived because the bank work was checked against JPMorgan and
// Bank of America, both of which still tag `Revenues`.
//
// Ordering does not decide the winner (annualPeriods takes whichever tag yields the most years);
// it only decides how early the search can stop. Breadth is what matters here.
const REV = SECTIONS[0].lines[0].tags;
export const PERIOD_TAGS = {
  corporate: REV,
  bank: [...REV, "InterestAndDividendIncomeOperating", "InterestIncomeExpenseNet", "NoninterestIncome"],
  // Broker-dealers (SIC 6211) take the corporate sheet, so their calendar comes from REV — which
  // now includes RevenuesNetOfInterestExpense, the tag Goldman and Morgan Stanley actually file.
  pc: [...REV, "PremiumsEarnedNet", "BenefitsLossesAndExpenses"],
  life: [...REV, "PremiumsEarnedNet", "BenefitsLossesAndExpenses"],
  health: [...REV, "PremiumsEarnedNet"],
  advisory: REV,
  reit: REV,
};
// Last resort for any filer whose whole top line is a company extension. Net income is a duration
// on the same fiscal calendar, so the columns are right even when the revenue row is blank.
export const PERIOD_TAGS_FALLBACK = ["NetIncomeLoss", "ProfitLoss"];

// Lines that are not MISSING for these filers — they do not exist. A bank has no cost of revenue,
// no inventory and no operating income, and is not levered on EBITDA: it is levered on capital
// ratios, so Net debt/EBITDA is a category error rather than a gap. Saying "n/a for a bank" is the
// difference between a sheet that looks broken and one that shows it knows what it is reading.
export const NOT_APPLICABLE = {
  bank: ["cogs", "grossProfit", "inventory", "dio", "dpo", "ccc", "currentRatio", "quickRatio",
    "curAssets", "curLiab", "totalOpex", "ebit", "ebitda", "ebitdaSbc", "ebitMargin", "ebitdaMargin",
    "ebitdaGrowth", "netLev", "grossLev", "intCover", "fccr", "nwc", "nwcPctRev", "assetTurn",
    "capexPctRev", "prepaid", "ap", "evEbitda", "evEbit", "ufcf", "nopat", "roic", "investedCap"],
  // A carrier's liabilities ARE the business, so the whole EBITDA/enterprise-value apparatus is a
  // category error, not a gap: nobody quotes EV/EBITDA on Chubb. Insurance comps are P/B, P/TBV,
  // P/E and ROE, which the corporate template already computes. Working capital is meaningless for
  // the same reason — an insurer's balance sheet is not classified into current and non-current at
  // all, so AssetsCurrent resolves to nothing and would print "not tagged" as if someone should go
  // hunting for it.
  pc: ["cogs", "grossProfit", "grossMargin", "inventory", "dso", "dio", "dpo", "ccc", "currentRatio",
    "quickRatio", "curAssets", "curLiab", "prepaid", "ap", "totalOpex", "ebit", "ebitda", "ebitdaSbc",
    "ebitMargin", "ebitdaMargin", "ebitdaGrowth", "netLev", "grossLev", "intCover", "fccr", "nwc",
    "nwcPctRev", "assetTurn", "capexPctRev", "ev", "evRev", "evEbitda", "evEbit", "evFcf", "ufcf",
    "nopat", "roic", "investedCap"],
  life: ["cogs", "grossProfit", "grossMargin", "inventory", "dso", "dio", "dpo", "ccc", "currentRatio",
    "quickRatio", "curAssets", "curLiab", "prepaid", "ap", "totalOpex", "ebit", "ebitda", "ebitdaSbc",
    "ebitMargin", "ebitdaMargin", "ebitdaGrowth", "netLev", "grossLev", "intCover", "fccr", "nwc",
    "nwcPctRev", "assetTurn", "capexPctRev", "ev", "evRev", "evEbitda", "evEbit", "evFcf", "ufcf",
    "nopat", "roic", "investedCap"],
  // Deliberately short. A health plan is an operating company — UnitedHealth files
  // OperatingIncomeLoss, CostOfGoodsAndServicesSold and a classified balance sheet, and managed
  // care genuinely trades on EV/EBITDA and P/E. Blanking what the other two carriers blank would
  // delete most of a sheet that is correct as it stands.
  health: ["inventory", "dio", "ccc"],
  // Deliberately short, like the health plans. A broker-dealer has no inventory and no working
  // capital cycle, but Goldman's balance sheet is real and the boutiques tag operating income, so
  // blanking the corporate apparatus wholesale would delete a sheet that is largely correct.
  advisory: ["inventory", "dio", "dpo", "ccc"],
  reit: ["inventory", "dio", "dpo", "ccc"],
};

// Sections added for a given industry, and which tab they belong to.
export const OVERLAY_SECTIONS = {
  bank: [
    { id: "bank_is", title: "Bank Income Statement", feeds: "Historicals", tab: "statements", lines: [
      { k: "intIncTotal", label: "Total interest income", how: "fetched", tags: ["InterestAndDividendIncomeOperating"] },
      { k: "intExpTotal", label: "Total interest expense", how: "fetched", tags: ["InterestExpense"] },
      { k: "intExpDeposits", label: "Interest expense on deposits", how: "fetched", tags: ["InterestExpenseDeposits"] },
      { k: "nii", label: "Net interest income", how: "fetched", tags: ["InterestIncomeExpenseNet"], fallback: "intIncTotal - intExpTotal" },
      { k: "provision", label: "Provision for credit losses", how: "fetched", tags: ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForCreditLosses"] },
      { k: "niiAfterProv", label: "NII after provision", how: "fetched", tags: ["InterestIncomeExpenseAfterProvisionForLoanLoss"] },
      { k: "noninterestIncome", label: "Noninterest income", how: "fetched", tags: ["NoninterestIncome"] },
      { k: "noninterestExpense", label: "Noninterest expense", how: "fetched", tags: ["NoninterestExpense"] },
      { k: "totalRevenueBank", label: "Total revenue (NII + fees)", how: "computed", formula: "nii + noninterestIncome" },
    ]},
    // instant: balances at a date, not flows over a period. Declared here so the grid never has to
    // guess from the section id.
    { id: "bank_bs", title: "Loans, Deposits & Securities", feeds: "Historicals", tab: "statements", instant: true, lines: [
      // Tag lists have to span TAXONOMY ERAS, not just synonyms. CECL (ASU 2016-13) retired the
      // loan and securities tags around 2020-21 and replaced them with "ExcludingAccruedInterest"
      // variants: LoansAndLeasesReceivableNetReportedAmount stops in 2016, the old allowance and AFS
      // tags stop in 2021. Using only those returned "not tagged" for the two largest numbers on a
      // bank's balance sheet. pickFact walks the list and skips any tag with no fact for the period,
      // so listing both eras fixes recent AND historical years at once.
      { k: "loans", label: "Loans & leases, net", how: "fetched", tags: ["FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss", "LoansAndLeasesReceivableNetReportedAmount", "LoansAndLeasesReceivableNetOfDeferredIncome", "NotesReceivableNet"] },
      // Computed, not fetched. The ...BeforeAllowanceForCreditLoss tag returned a SMALLER number
      // than the "after" tag at JPM ($1,408.9bn vs $1,467.7bn), which cannot be true of a gross
      // versus net loan balance — the two tags are evidently applied to different portfolio scopes.
      // Rather than print an impossibility, gross is derived from the two figures that are
      // unambiguous, so allowance coverage is always internally consistent.
      { k: "loansGross", label: "Loans & leases, gross", how: "computed", formula: "loans + allowance" },
      { k: "allowance", label: "Allowance for credit losses", how: "fetched", tags: ["FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest", "FinancingReceivableAllowanceForCreditLosses"] },
      { k: "deposits", label: "Total deposits", how: "fetched", tags: ["Deposits"] },
      { k: "afs", label: "Securities available for sale", how: "fetched", tags: ["DebtSecuritiesAvailableForSaleExcludingAccruedInterest", "AvailableForSaleSecuritiesDebtSecurities", "AvailableForSaleSecurities"] },
      { k: "htm", label: "Securities held to maturity", how: "fetched", tags: ["DebtSecuritiesHeldToMaturityExcludingAccruedInterestAfterAllowanceForCreditLoss", "HeldToMaturitySecurities"] },
    ]},
    { id: "bank_ratios", title: "Bank Ratios", feeds: "Historicals · Diligence", tab: "ratios", lines: [
      { k: "efficiency", label: "Efficiency ratio", how: "computed", formula: "noninterestExpense / (nii + noninterestIncome)", note: "Lower is better — the core bank cost metric" },
      { k: "niiOnAssets", label: "Net interest income / assets", how: "computed", formula: "nii / totalAssets", note: "Proxy for NIM — average EARNING assets are not tagged, so true NIM cannot be computed from filings" },
      { k: "loansToDeposits", label: "Loans / deposits", how: "computed", formula: "loans / deposits" },
      { k: "allowanceToLoans", label: "Allowance / gross loans", how: "computed", formula: "allowance / loansGross" },
      { k: "provisionToLoans", label: "Provision / gross loans", how: "computed", formula: "provision / loansGross" },
      { k: "depositsToAssets", label: "Deposits / assets", how: "computed", formula: "deposits / totalAssets" },
      { k: "equityToAssets", label: "Equity / assets", how: "computed", formula: "equity / totalAssets", note: "Leverage for a bank — regulatory CET1 is not XBRL-tagged" },
    ]},
  ],

  // ── P&C CARRIER (SIC 6300-6310, 6331-6399) ───────────────────────────────────────────────────
  // `after` puts these where a reader expects them: underwriting under the income statement,
  // reserves under the balance sheet. The bank overlay predates it and keeps the old default.
  pc: [
    { id: "pc_uw", title: "Underwriting", feeds: "Historicals · Combined ratio", tab: "statements", after: "is", kind: "is", lines: [
      // Written premium leads earned premium by a year or more, so it is the growth line an
      // underwriter actually watches. Three tags carry it and they are NOT synonyms of each other:
      // PremiumsWrittenNet is the face of the income statement, the two Supplementary/Supplemental
      // ones come off Schedule III and Schedule VI. Allstate files only the Schedule III version.
      { k: "npw", label: "Net premiums written", how: "fetched", tags: ["PremiumsWrittenNet", "SupplementaryInsuranceInformationPremiumsWritten", "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPremiumsWritten"], note: "Leads earned premium — the forward-looking growth line" },
      { k: "npe", label: "Net premiums earned", how: "fetched", tags: ["PremiumsEarnedNet", "SupplementaryInsuranceInformationPremiumRevenue", "PremiumsEarnedNetPropertyAndCasualty"] },
      { k: "cededPrem", label: "Ceded premiums earned", how: "fetched", tags: ["CededPremiumsEarned", "CededPremiumsEarnedPropertyAndCasualty"] },
      { k: "invIncome", label: "Net investment income", how: "fetched", tags: ["NetInvestmentIncome", "SupplementaryInsuranceInformationNetInvestmentIncome", "InvestmentIncomeNet"] },
      { k: "realizedGains", label: "Realised investment gains/(losses)", how: "fetched", tags: ["RealizedInvestmentGainsLosses", "GainLossOnInvestments", "MarketableSecuritiesRealizedGainLoss"] },
      // The one tag that looks right and is not:
      // LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseIncurredClaims1 is filed by six of the
      // eight carriers tested and reads as the incurred-claims total — but at Allstate it collapses
      // from $29.3bn (2021) to $2.65bn (2022) onward, because after that year Allstate only tags it
      // inside a segment breakdown and companyfacts carries NO dimensional data, so what survives is
      // a residual. Using it as a fallback would have printed a 4.7% loss ratio for Allstate and an
      // 88% combined ratio nowhere near it. It is deliberately not in this list: Allstate tags its
      // claims line with a COMPANY EXTENSION, which companyfacts does not carry at any price, so the
      // honest answer is "not tagged" plus a link to the rendered income statement.
      { k: "lossesIncurred", label: "Losses & LAE incurred", how: "fetched", tags: ["PolicyholderBenefitsAndClaimsIncurredNet", "SupplementaryInsuranceInformationBenefitsClaimsLossesAndSettlementExpense"] },
      // Scope, not decoration. PolicyholderBenefitsAndClaimsIncurredNet is SHORT-DURATION business
      // only, but PremiumsEarnedNet is consolidated — so a carrier with a life arm inside the same
      // filer divides a P&C numerator by a P&C-plus-life denominator. Chubb is the case that caught
      // it: $26.7bn of P&C losses over $53.0bn of consolidated premium printed a 77.4% combined
      // ratio, roughly ten points better than anything Chubb has ever reported. Its $5.5bn of life
      // benefits sit in their own tag, and adding them back makes both halves consolidated. Only
      // Chubb files this among the eight carriers tested — for a monoline it is correctly absent.
      { k: "lifeBenefits", label: "Life & annuity policy benefits", how: "fetched", tags: ["LiabilityForFuturePolicyBenefitsPeriodExpense"], note: "Only appears where a life arm sits inside a P&C filer — it belongs in the ratio because the premium line already includes it" },
      { k: "cyLosses", label: "— current accident year", how: "fetched", tags: ["SupplementalInformationForPropertyCasualtyInsuranceUnderwritersCurrentYearClaimsAndClaimsAdjustmentExpense", "SecSchedule1218SupplementalInformationPropertyCasualtyInsuranceUnderwritersCurrentYearClaimAndClaimAdjustmentExpense"] },
      // Prior-year development is the quality-of-earnings line on a P&C income statement — a carrier
      // can buy a good year by releasing reserves. NEGATIVE is favourable (reserves released).
      { k: "pyDevelopment", label: "— prior-year reserve development", how: "fetched", tags: ["SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense", "SecSchedule1218SupplementalInformationPropertyCasualtyInsuranceUnderwritersPriorYearClaimAndClaimAdjustmentExpense"], note: "Negative = favourable, reserves released. The first place a bought quarter shows up" },
      { k: "dacAmort", label: "Policy acquisition costs amortised", how: "fetched", tags: ["DeferredPolicyAcquisitionCostAmortizationExpense", "SupplementaryInsuranceInformationAmortizationOfDeferredPolicyAcquisitionCosts", "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersAmortizationOfDeferredPolicyAcquisitionCosts"] },
      // The expense half of the combined ratio is the weak point of the whole overlay, and the list
      // is long because carriers genuinely disagree: Progressive and Berkley file
      // OtherUnderwritingExpense, Travelers puts it in SG&A, Chubb and AIG in G&A. Only two of the
      // eight tested use the tag whose name says underwriting.
      //
      // The order is face-of-the-income-statement first, Schedule III last, and it is load-bearing
      // in both directions. Cincinnati Financial files NONE of the first three, and the obvious
      // fourth guess — OtherCostAndExpenseOperating, which is right for Allstate — matches a $34m
      // scrap at Cincinnati against $10.0bn of premium. That printed an 18.9% expense ratio and an
      // 85.4% combined ratio for a carrier whose real expense ratio is near 30%: a plausible number,
      // in the right units, ten points wrong, with nothing on the page to suggest it. Schedule III's
      // OtherOperatingExpense ($1,073m) is the line Cincinnati actually files, so that replaced it —
      // and it goes LAST because at Progressive it is $12.6bn against the $11.3bn on the face of the
      // statement, the Schedule sweeping in service and investment expenses that are not underwriting.
      { k: "otherUwExp", label: "Other underwriting expenses", how: "fetched", tags: ["OtherUnderwritingExpense", "SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense", "SupplementaryInsuranceInformationOtherOperatingExpense"] },
      { k: "totalBenExp", label: "Total benefits, losses & expenses", how: "fetched", tags: ["BenefitsLossesAndExpenses"] },
      { k: "uwProfit", label: "Underwriting profit/(loss)", how: "computed", formula: "npe - lossesIncurred - lifeBenefits - dacAmort - otherUwExp", note: "Before investment income — what the policies alone earned" },
    ]},
    { id: "pc_res", title: "Reserves, Float & Investments", feeds: "Historicals · Diligence", tab: "statements", after: "bs", kind: "bs", instant: true, lines: [
      { k: "lossReserves", label: "Loss & LAE reserves, gross", how: "fetched", tags: ["LiabilityForClaimsAndClaimsAdjustmentExpense", "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersReservesForUnpaidClaimsAndClaimsAdjustmentExpense"] },
      { k: "reinsRecov", label: "Reinsurance recoverable on unpaid claims", how: "fetched", tags: ["ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments", "ReinsuranceRecoverables"] },
      { k: "lossReservesNet", label: "Loss & LAE reserves, net of reinsurance", how: "fetched", tags: ["LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet"] },
      { k: "unearnedPrem", label: "Unearned premiums", how: "fetched", tags: ["UnearnedPremiums", "SupplementaryInsuranceInformationUnearnedPremiums", "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersUnearnedPremiums"] },
      { k: "dac", label: "Deferred policy acquisition costs", how: "fetched", tags: ["DeferredPolicyAcquisitionCosts", "DeferredPolicyAcquisitionCostsNet", "SupplementaryInsuranceInformationDeferredPolicyAcquisitionCosts"] },
      // Float on Buffett's own definition — money held that belongs to policyholders and is invested
      // in the meantime. Every component is tagged, so this is the rare famous metric that can be
      // computed exactly rather than approximated.
      { k: "float", label: "Insurance float", how: "computed", formula: "(lossReservesNet or lossReserves - reinsRecov) + unearnedPrem - dac", note: "Policyholder money held and invested before it is paid out. Blank unless reserves NET of reinsurance are known" },
      { k: "investments", label: "Total investments", how: "fetched", tags: ["Investments", "InvestmentsFairValueDisclosure"] },
      { k: "fixedMaturities", label: "Fixed maturities, available for sale", how: "fetched", tags: ["DebtSecuritiesAvailableForSaleExcludingAccruedInterest", "AvailableForSaleSecuritiesDebtSecurities", "AvailableForSaleSecurities"] },
      { k: "equitySec", label: "Equity securities", how: "fetched", tags: ["EquitySecuritiesFvNi", "EquitySecuritiesFvNiCurrentAndNoncurrent", "AvailableForSaleSecuritiesEquitySecurities"] },
    ]},
    { id: "pc_ratios", title: "Underwriting Ratios", feeds: "Historicals · Diligence", tab: "ratios", lines: [
      { k: "lossRatio", label: "Loss & LAE ratio", how: "computed", formula: "lossesIncurred / npe" },
      { k: "expenseRatio", label: "Underwriting expense ratio", how: "computed", formula: "(dacAmort + otherUwExp) / npe" },
      // Stated out loud because a reader WILL compare it to the number in the earnings release and
      // find it a point or two off. The company's combined ratio is a non-GAAP figure with its own
      // definition (fee income netted against expenses, catastrophe and reserve items reclassified,
      // sometimes a statutory written-premium denominator). This one is built only from tagged GAAP
      // lines, which is the only version that can be traced to an accession number.
      { k: "combinedRatio", label: "Combined ratio", how: "computed", formula: "lossRatio + expenseRatio", note: "Under 100% = an underwriting profit. Built from GAAP lines, so it differs by a point or two from the company's own non-GAAP figure" },
      { k: "pyDevRatio", label: "Prior-year development / NPE", how: "computed", formula: "pyDevelopment / npe", note: "How much of the combined ratio came out of the reserve bag" },
      { k: "premiumLeverage", label: "Net premiums written / equity", how: "computed", formula: "npw / equity", note: "Premium-to-surplus on a GAAP book — how hard the capital is working" },
      { k: "reserveLeverage", label: "Reserves / equity", how: "computed", formula: "lossReserves / equity", note: "How much of the balance sheet is an estimate" },
      { k: "cededRatio", label: "Ceded / gross earned premium", how: "computed", formula: "cededPrem / (npe + cededPrem)", note: "How much risk is reinsured away" },
      { k: "investmentYield", label: "Yield on investments", how: "computed", formula: "invIncome / investments", note: "Book yield — period-end portfolio, not an average balance" },
    ]},
  ],

  // ── LIFE / ACCIDENT & HEALTH CARRIER (SIC 6311, 6321) ────────────────────────────────────────
  // A life carrier has no combined ratio: it earns a spread on reserves and fees on account
  // balances, and the underwriting-ratio apparatus above simply does not apply to it.
  life: [
    { id: "life_is", title: "Premiums, Fees & Benefits", feeds: "Historicals", tab: "statements", after: "is", kind: "is", lines: [
      { k: "premiums", label: "Premiums earned, net", how: "fetched", tags: ["PremiumsEarnedNet", "SupplementaryInsuranceInformationPremiumRevenue"] },
      // Universal-life and investment-type policy fees. PolicyChargesInsurance is the tag the name
      // suggests and it is DEAD — Prudential and Globe Life both stop filing it in 2012.
      // InsuranceCommissionsAndFees is what MetLife and Prudential file today ($5.0bn / $4.7bn).
      { k: "policyFees", label: "Policy fees & other insurance revenue", how: "fetched", tags: ["InsuranceCommissionsAndFees", "PolicyChargesInsurance"] },
      { k: "invIncome", label: "Net investment income", how: "fetched", tags: ["NetInvestmentIncome", "SupplementaryInsuranceInformationNetInvestmentIncome"] },
      { k: "realizedGains", label: "Realised investment gains/(losses)", how: "fetched", tags: ["RealizedInvestmentGainsLosses", "GainLossOnInvestments"] },
      { k: "benefits", label: "Policyholder benefits & claims", how: "fetched", tags: ["PolicyholderBenefitsAndClaimsIncurredNet", "SupplementaryInsuranceInformationBenefitsClaimsLossesAndSettlementExpense"] },
      { k: "interestCredited", label: "Interest credited to account balances", how: "fetched", tags: ["InterestCreditedToPolicyholdersAccountBalances", "InterestCreditedToPolicyOwnerAccount", "InterestCreditedToPolicyOwnerAccounts"], note: "The cost of the spread business — only writers of annuities and universal life have it" },
      { k: "dacAmort", label: "DAC amortisation", how: "fetched", tags: ["DeferredPolicyAcquisitionCostAmortizationExpense", "SupplementaryInsuranceInformationAmortizationOfDeferredPolicyAcquisitionCosts"] },
      { k: "totalBenExp", label: "Total benefits & expenses", how: "fetched", tags: ["BenefitsLossesAndExpenses"] },
    ]},
    { id: "life_bs", title: "Policy Reserves & Investments", feeds: "Historicals · Diligence", tab: "statements", after: "bs", kind: "bs", instant: true, lines: [
      { k: "futurePolicyBenefits", label: "Future policy benefits", how: "fetched", tags: ["LiabilityForFuturePolicyBenefits"] },
      // PolicyholderFunds leads because Lincoln National's PolicyholderContractDeposits stops in
      // 2010 at $148m while PolicyholderFunds carries the real $136bn. At MetLife the two are the
      // same number, so leading with the one that survives costs nothing.
      { k: "policyholderAccounts", label: "Policyholder account balances", how: "fetched", tags: ["PolicyholderFunds", "PolicyholderContractDeposits"] },
      { k: "separateAccounts", label: "Separate account assets", how: "fetched", tags: ["SeparateAccountAssets"], note: "Policyholder-directed — the carrier takes fees, not investment risk" },
      { k: "dac", label: "Deferred policy acquisition costs", how: "fetched", tags: ["DeferredPolicyAcquisitionCosts", "DeferredPolicyAcquisitionCostsNet", "SupplementaryInsuranceInformationDeferredPolicyAcquisitionCosts"] },
      { k: "investments", label: "Total investments", how: "fetched", tags: ["Investments", "InvestmentsFairValueDisclosure"] },
      { k: "fixedMaturities", label: "Fixed maturities, available for sale", how: "fetched", tags: ["DebtSecuritiesAvailableForSaleExcludingAccruedInterest", "AvailableForSaleSecuritiesDebtSecurities", "AvailableForSaleSecurities"] },
      { k: "reinsRecov", label: "Reinsurance recoverable", how: "fetched", tags: ["ReinsuranceRecoverables", "ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments"] },
    ]},
    { id: "life_ratios", title: "Life Insurance Ratios", feeds: "Historicals · Diligence", tab: "ratios", lines: [
      // Matches the definition Aflac, Unum and Globe Life publish, which is why the denominator is
      // premiums alone. Read it only against a carrier of the same shape: for a protection writer
      // it runs 54-70% and means what a loss ratio means, but at an annuity or retirement writer
      // the benefits line carries reserve and account-balance movements that no premium offsets —
      // Prudential prints 114% and Lincoln 148%, and neither is distress.
      { k: "benefitRatio", label: "Benefit ratio", how: "computed", formula: "benefits / premiums", note: "The life analogue of a loss ratio. Above 100% at annuity writers by construction — benefits include reserve movements premiums never funded" },
      { k: "creditingRate", label: "Crediting rate on account balances", how: "computed", formula: "interestCredited / policyholderAccounts", note: "Against period-end balances, so it is a proxy — average balances are not tagged" },
      { k: "investmentYield", label: "Yield on investments", how: "computed", formula: "invIncome / investments" },
      { k: "policyReserves", label: "Total policy reserves", how: "computed", formula: "futurePolicyBenefits + policyholderAccounts" },
      { k: "reserveLeverage", label: "Policy reserves / equity", how: "computed", formula: "policyReserves / equity" },
      // The denominator every life comp is quoted on. GAAP equity moves with unrealised bond
      // gains through AOCI, so reported book value swings with the ten-year rather than with the
      // business; stripping AOCI is what makes two carriers comparable in the same year.
      { k: "bvpsExAoci", label: "Book value per share, ex-AOCI", how: "computed", formula: "(equity - aoci) / sharesOut", note: "The life-insurance book value — AOCI moves with rates, not with the business" },
    ]},
  ],

  // ── HEALTH PLAN / MANAGED CARE (SIC 6324) ────────────────────────────────────────────────────
  // Deliberately thin. UnitedHealth, Elevance, Centene, Humana and Molina all file a normal
  // operating income statement; what the corporate template misses is only that their cost of goods
  // is medical claims, so this adds the ratios built on that and leaves the rest alone.
  health: [
    { id: "health_is", title: "Premiums & Medical Costs", feeds: "Historicals", tab: "statements", after: "is", kind: "is", lines: [
      { k: "premiums", label: "Premiums earned, net", how: "fetched", tags: ["PremiumsEarnedNet", "HealthCareOrganizationPremiumRevenue"] },
      // Health plans switched tags mid-history: UnitedHealth files
      // PolicyholderBenefitsAndClaimsIncurredHealthCare through 2021 and the generic
      // ...IncurredNet from 2022, so listing only one leaves half the columns blank.
      //
      // What is NOT here is the tempting third guess. Molina tags its medical care costs as
      // CostOfGoodsAndServicesSold, which would fill its blank — but at Centene the same tag is a
      // $2.7bn services line against $168bn of real medical cost, so adding it would print a 2%
      // medical loss ratio for Centene's older years. Molina's costs are already visible on this
      // sheet as Cost of revenue in the income statement above; a blank MLR is the price of not
      // printing a fictional one, and Centene's premium line is a company extension anyway.
      { k: "medicalCosts", label: "Medical costs / benefits incurred", how: "fetched", tags: ["PolicyholderBenefitsAndClaimsIncurredNet", "PolicyholderBenefitsAndClaimsIncurredHealthCare"] },
      { k: "invIncome", label: "Net investment income", how: "fetched", tags: ["NetInvestmentIncome", "InvestmentIncomeInterest"] },
      // instant on the LINE, not the section: this is the one balance in an otherwise duration
      // section, and splitting it into a section of its own for two rows would read worse than
      // declaring it here.
      { k: "medicalClaimsPayable", label: "Medical claims payable", how: "fetched", instant: true, tags: ["LiabilityForClaimsAndClaimsAdjustmentExpense"], note: "A balance at the year end, not a flow — the reserve held against claims already incurred" },
    ]},
    { id: "health_ratios", title: "Health Plan Ratios", feeds: "Historicals · Diligence", tab: "ratios", lines: [
      { k: "mlr", label: "Medical loss ratio", how: "computed", formula: "medicalCosts / premiums", note: "The benefit ratio — the first number a managed-care analyst reads" },
      { k: "healthSgaRatio", label: "Operating cost ratio", how: "computed", formula: "sga / revenue" },
      { k: "daysClaimsPayable", label: "Days in claims payable", how: "computed", formula: "medicalClaimsPayable / medicalCosts * 365", note: "Reserve adequacy — a falling trend is where a miss shows up first" },
      { k: "premiumMix", label: "Premiums / total revenue", how: "computed", formula: "premiums / revenue", note: "How much of the top line is insured risk rather than services" },
    ]},
  ],

  // ── BROKER-DEALER / ADVISORY / ALT MANAGER (SIC 6200-6299) ───────────────────────────────────
  // Small on purpose. These filers are already well served by the corporate sheet — the top line
  // now resolves via RevenuesNetOfInterestExpense, and equity, net income and ROE all populate.
  // What was missing is the one ratio the sector actually trades and recruits on.
  advisory: [
    { id: "adv_is", title: "Compensation", feeds: "Historicals", tab: "statements", after: "is", kind: "is", lines: [
      // 13 of the 15 firms tested file the first tag; Moelis is the reason for the second.
      { k: "compExpense", label: "Compensation & benefits", how: "fetched", tags: ["LaborAndRelatedExpense", "EmployeeBenefitsAndShareBasedCompensation"] },
    ]},
    { id: "adv_ratios", title: "Broker-Dealer Ratios", feeds: "Historicals · Diligence", tab: "ratios", lines: [
      { k: "compRatio", label: "Compensation ratio", how: "computed", formula: "compExpense / revenue", note: "Comp as a share of net revenue — the number this sector is run on. ~32% at a bulge bracket, 60-70% at an advisory boutique, and the gap IS the business model" },
      { k: "pretaxMargin", label: "Pre-tax margin", how: "computed", formula: "pretax / revenue" },
      // Tangible equity, because goodwill from acquired advisory teams is not capital that can
      // absorb a loss. ROTE is what a broker-dealer sets targets against, not ROE.
      { k: "tangibleEquity", label: "Tangible common equity", how: "computed", formula: "equity - goodwill - intangibles" },
      { k: "rote", label: "Return on tangible equity", how: "computed", formula: "netIncome / tangibleEquity" },
    ]},
  ],

  // ── REIT (SIC 6798) ──────────────────────────────────────────────────────────────────────────
  // Unlike a bank or a carrier, a REIT IS an operating company: it keeps EBIT, EBITDA, EV/EBITDA
  // and Net debt/EBITDA, which is the leverage metric the sector is actually quoted on. What the
  // corporate template misses is that GAAP net income is close to meaningless here — depreciating
  // buildings that are appreciating drives reported earnings far below cash generation, which is
  // the entire reason FFO exists.
  reit: [
    { id: "reit_ops", title: "Property Operations & FFO", feeds: "Historicals · FFO", tab: "statements", after: "is", kind: "is", lines: [
      { k: "rentalRevenue", label: "Rental & lease income", how: "fetched", tags: ["OperatingLeaseLeaseIncome", "LeaseIncome", "OperatingLeasesIncomeStatementLeaseRevenue", "RealEstateRevenueNet"] },
      { k: "propOpex", label: "Property operating expenses", how: "fetched", tags: ["DirectCostsOfLeasedAndRentedPropertyOrEquipment", "CostOfOtherPropertyOperatingExpense"] },
      { k: "realEstateTax", label: "Real estate taxes", how: "fetched", tags: ["RealEstateTaxExpense"] },
      { k: "noi", label: "Net operating income (NOI)", how: "computed", formula: "rentalRevenue - propOpex", note: "Property-level, before G&A, D&A and interest. Net-lease REITs run near 100% because tenants pay the opex" },
      // Schedule III depreciation is REAL-ESTATE only, and it is shown beside the total D&A above
      // precisely because the two differ: at Realty Income it is $1.6bn against $2.5bn of total
      // D&A, the gap being amortisation of in-place lease intangibles. NAREIT adds back both.
      { k: "reDep", label: "— of which real estate (Schedule III)", how: "fetched", tags: ["SECScheduleIIIRealEstateAccumulatedDepreciationDepreciationExpense"], note: "Buildings only. The D&A line above also carries lease-intangible amortisation, which FFO adds back too" },
      { k: "gainOnPropertySale", label: "Gain/(loss) on property sales", how: "fetched", tags: ["GainLossOnSaleOfProperties", "GainsLossesOnSalesOfInvestmentRealEstate", "GainLossOnDispositionOfAssets", "GainLossOnSaleOfPropertyPlantEquipment"] },
      { k: "reImpairment", label: "Real estate impairment", how: "fetched", tags: ["ImpairmentOfRealEstate", "AssetImpairmentCharges"] },
      { k: "straightLineRent", label: "Straight-line rent adjustment", how: "fetched", tags: ["StraightLineRent"], note: "Non-cash rent GAAP recognises early — the largest single gap between FFO and AFFO" },
      // The whole point of the section. Every input is a row directly above it, so the arithmetic
      // can be checked on the page rather than taken on trust — which matters because the gain
      // subtraction only happens when the filer tags one. Simon reports $4.6bn of net income on
      // $6.4bn of revenue and tags no property gain at all, so its FFO here reads high; the blank
      // "Gain on property sales" row immediately above is the tell, and the note says so.
      { k: "ffo", label: "FFO (NAREIT basis)", how: "computed", formula: "niToCommon + da - gainOnPropertySale + reImpairment", note: "Reconstructed from tagged adjustments only. A filer that never tags its property gains reads high — check the gain row above. Company-reported FFO applies further adjustments" },
      { k: "ffoPerShare", label: "FFO per share, diluted", how: "computed", formula: "ffo / wasoDil" },
      { k: "affo", label: "AFFO / Core FFO", how: "manual", note: "Every REIT defines it differently — recurring capex, leasing costs and straight-line rent are all judgement. Not in any filing as a tagged figure" },
    ]},
    { id: "reit_bs", title: "Real Estate & Leverage", feeds: "Historicals · Diligence", tab: "statements", after: "bs", kind: "bs", instant: true, lines: [
      { k: "reGross", label: "Real estate, at cost", how: "fetched", tags: ["RealEstateGrossAtCarryingValue", "RealEstateInvestmentPropertyAtCost"] },
      { k: "reAccumDep", label: "Accumulated depreciation, real estate", how: "fetched", tags: ["RealEstateAccumulatedDepreciation", "RealEstateInvestmentPropertyAccumulatedDepreciation"] },
      { k: "reNet", label: "Real estate, net", how: "computed", formula: "reGross - reAccumDep" },
      // Same story as the carriers: REITs file one debt total under names the corporate three-way
      // sum has never heard of. Realty Income puts all $25.1bn under `NotesPayable` and reported
      // $517m without this; Essex and Digital Realty reported nothing at all.
      { k: "reitDebt", label: "Debt outstanding, as disclosed", how: "fetched", tags: ["NotesPayable", "LongTermDebt", "DebtLongtermAndShorttermCombinedAmount"] },
      { k: "numProperties", label: "Properties owned", how: "fetched", tags: ["NumberOfRealEstateProperties"], note: "A count, not a dollar figure" },
    ]},
    { id: "reit_ratios", title: "REIT Ratios", feeds: "Historicals · Diligence", tab: "ratios", lines: [
      { k: "ffoPayout", label: "Dividend payout (of FFO)", how: "computed", formula: "dividends / ffo", note: "A REIT must distribute 90% of taxable income — payout well over 100% of FFO is the stress signal" },
      { k: "noiMargin", label: "NOI margin", how: "computed", formula: "noi / rentalRevenue" },
      { k: "debtToGrossRE", label: "Debt / real estate at cost", how: "computed", formula: "totalDebt / reGross", note: "Against undepreciated cost, which is how REIT covenants are written" },
      { k: "accumDepPct", label: "Accumulated depreciation / cost", how: "computed", formula: "reAccumDep / reGross", note: "Portfolio age proxy — how far through its book life the estate is" },
    ]},
  ],
};

// Every industry sketched here has now been built and verified against real filers, so OVERLAYS is
// empty rather than holding guesses. It is kept as the shape a future overlay starts from: probe
// first (see the harness notes in the README), promote into OVERLAY_SECTIONS second. Each sketch
// that ever lived here — bank, insurance, REIT — turned out to be wrong in a way that failed
// silently, which is why none of them should be trusted straight into the template.
export const OVERLAYS = {};

export const tally = () => {
  const t = {};
  for (const s of SECTIONS) for (const l of s.lines) t[l.how] = (t[l.how] || 0) + 1;
  return { bySection: SECTIONS.map(s => [s.title, s.lines.length]), byHow: t,
    total: SECTIONS.reduce((n, s) => n + s.lines.length, 0) };
};

// ── Comps ────────────────────────────────────────────────────────────────────────────────────────
// A comps set is a SHORT list. The temptation is to print the whole template with companies as
// columns, but nobody reads 279 rows across six firms — a comps page is scale, growth, margin,
// leverage and the multiple, which is what fits on the sheet an analyst actually circulates.
//
// Every key here already exists in the sections above and is produced by the same engine, so an
// industry overlay's blanking applies unchanged: a bank in the set has no EV/EBITDA because
// NOT_APPLICABLE.bank says so, not because comps has its own opinion.
export const COMPS_ROWS = [
  { group: "Scale", rows: [
    { k: "revenue", label: "Revenue" },
    { k: "ebitda", label: "EBITDA" },
    { k: "netIncome", label: "Net income" },
    { k: "mktCap", label: "Market cap", market: true },
    { k: "ev", label: "Enterprise value", market: true },
  ] },
  { group: "Growth & margin", rows: [
    { k: "revGrowth", label: "Revenue growth" },
    { k: "revCagr3", label: "Revenue CAGR, 3yr" },
    { k: "grossMargin", label: "Gross margin" },
    { k: "ebitdaMargin", label: "EBITDA margin" },
    { k: "ebitMargin", label: "EBIT margin" },
    { k: "netMargin", label: "Net margin" },
    { k: "fcfMargin", label: "FCF margin" },
  ] },
  { group: "Returns & leverage", rows: [
    { k: "roic", label: "ROIC" },
    { k: "roe", label: "ROE" },
    { k: "netDebt", label: "Net debt" },
    { k: "netLev", label: "Net debt / EBITDA" },
    { k: "intCover", label: "EBITDA / interest" },
  ] },
  { group: "Valuation", market: true, rows: [
    { k: "evRev", label: "EV / Revenue", market: true },
    { k: "evEbitda", label: "EV / EBITDA", market: true },
    { k: "evEbit", label: "EV / EBIT", market: true },
    { k: "pe", label: "P / E", market: true },
    { k: "fcfYield", label: "FCF yield", market: true },
    { k: "divYield", label: "Dividend yield", market: true },
  ] },
];

// Rows where a median across the set is meaningful. A median revenue tells you nothing — the set is
// not a distribution of company sizes, it is the companies you chose — while a median EV/EBITDA is
// the number the whole exercise exists to produce. Absolute dollar lines are therefore excluded
// rather than printed and ignored.
export const COMPS_MEDIAN = new Set(["revGrowth", "revCagr3", "grossMargin", "ebitdaMargin", "ebitMargin",
  "netMargin", "fcfMargin", "roic", "roe", "netLev", "intCover", "evRev", "evEbitda", "evEbit", "pe",
  "fcfYield", "divYield"]);
