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
  { k: "revenue", label: "Total revenue", how: "fetched", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet"] },
  { k: "cogs", label: "Cost of revenue", how: "fetched", tags: ["CostOfGoodsAndServicesSold","CostOfRevenue","CostOfServices"] },
  { k: "grossProfit", label: "Gross profit", how: "fetched", tags: ["GrossProfit"], fallback: "revenue - cogs" },
  { k: "rnd", label: "Research & development", how: "fetched", tags: ["ResearchAndDevelopmentExpense"] },
  { k: "sam", label: "Selling & marketing", how: "fetched", tags: ["SellingAndMarketingExpense","MarketingExpense"] },
  { k: "ga", label: "General & administrative", how: "fetched", tags: ["GeneralAndAdministrativeExpense"] },
  { k: "sga", label: "SG&A (combined)", how: "fetched", tags: ["SellingGeneralAndAdministrativeExpense"] },
  { k: "otherOpex", label: "Other operating expense", how: "fetched", tags: ["OtherCostAndExpenseOperating","RestructuringCharges"] },
  { k: "totalOpex", label: "Total operating expenses", how: "fetched", tags: ["OperatingExpenses","CostsAndExpenses"] },
  { k: "ebit", label: "Operating income (EBIT)", how: "fetched", tags: ["OperatingIncomeLoss"] },
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
  { k: "ltdCur", label: "Current portion of long-term debt", how: "fetched", tags: ["LongTermDebtCurrent"] },
  { k: "olCur", label: "Operating lease liability, current", how: "fetched", tags: ["OperatingLeaseLiabilityCurrent"] },
  { k: "flCur", label: "Finance lease liability, current", how: "fetched", tags: ["FinanceLeaseLiabilityCurrent"] },
  { k: "curLiab", label: "Total current liabilities", how: "fetched", tags: ["LiabilitiesCurrent"] },
  { k: "ltDebt", label: "Long-term debt", how: "fetched", tags: ["LongTermDebtNoncurrent","LongTermDebt"] },
  { k: "olNon", label: "Operating lease liability, non-current", how: "fetched", tags: ["OperatingLeaseLiabilityNoncurrent"] },
  { k: "flNon", label: "Finance lease liability, non-current", how: "fetched", tags: ["FinanceLeaseLiabilityNoncurrent"] },
  { k: "defTaxLiab", label: "Deferred tax liabilities", how: "fetched", tags: ["DeferredIncomeTaxLiabilitiesNet","DeferredTaxLiabilitiesNoncurrent"] },
  { k: "pension", label: "Pension & post-retirement", how: "fetched", tags: ["DefinedBenefitPensionPlanLiabilitiesNoncurrent","LiabilityDefinedBenefitPlanNoncurrent"] },
  { k: "totalLiab", label: "Total liabilities", how: "fetched", tags: ["Liabilities"] },
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
  { k: "dividends", label: "Dividends paid", how: "fetched", tags: ["PaymentsOfDividendsCommonStock","PaymentsOfDividends"] },
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

// Industry overlays — a bank has no gross profit and a REIT lives on FFO. Applying one template to
// every filer is what made JPM score 50%: the template was wrong, not the data.
export const OVERLAYS = {
  bank: [
    { k: "nii", label: "Net interest income", how: "fetched", tags: ["InterestIncomeExpenseNet"] },
    { k: "provision", label: "Provision for credit losses", how: "fetched", tags: ["ProvisionForLoanLeaseAndOtherLosses","ProvisionForCreditLosses"] },
    { k: "loans", label: "Loans, net", how: "fetched", tags: ["LoansAndLeasesReceivableNetReportedAmount","NotesReceivableNet"] },
    { k: "deposits", label: "Total deposits", how: "fetched", tags: ["Deposits"] },
    { k: "noninterestIncome", label: "Noninterest income", how: "fetched", tags: ["NoninterestIncome"] },
    { k: "noninterestExpense", label: "Noninterest expense", how: "fetched", tags: ["NoninterestExpense"] },
    { k: "efficiency", label: "Efficiency ratio", how: "computed", formula: "noninterestExpense / (nii + noninterestIncome)" },
    { k: "nim", label: "Net interest margin", how: "computed", formula: "nii / earningAssets" },
  ],
  reit: [
    { k: "ffo", label: "FFO", how: "computed", formula: "netIncome + realEstateDep - gainsOnSale" },
    { k: "realEstateDep", label: "Real estate depreciation", how: "fetched", tags: ["RealEstateInvestmentPropertyAccumulatedDepreciation","DepreciationAndAmortizationDiscontinuedOperations"] },
    { k: "rentalRevenue", label: "Rental revenue", how: "fetched", tags: ["OperatingLeaseLeaseIncome"] },
  ],
  insurance: [
    { k: "premiums", label: "Premiums earned", how: "fetched", tags: ["PremiumsEarnedNet"] },
    { k: "lossesIncurred", label: "Losses & LAE incurred", how: "fetched", tags: ["PolicyholderBenefitsAndClaimsIncurredNet"] },
    { k: "combinedRatio", label: "Combined ratio", how: "computed", formula: "(lossesIncurred + underwritingExpense) / premiums" },
  ],
};

export const tally = () => {
  const t = {};
  for (const s of SECTIONS) for (const l of s.lines) t[l.how] = (t[l.how] || 0) + 1;
  return { bySection: SECTIONS.map(s => [s.title, s.lines.length]), byHow: t,
    total: SECTIONS.reduce((n, s) => n + s.lines.length, 0) };
};
