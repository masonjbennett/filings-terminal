// The only route that talks to SEC for financial data.
//
// It exists because data.sec.gov sends no CORS headers — a browser cannot read it directly, which I
// verified before designing around it. So this proxies, and while it is there it does the one thing
// that makes the whole app viable: it SLIMS the payload. A companyfacts document for a large filer
// is 10-15MB because it carries every tag the company has ever reported; the template needs about
// two hundred and thirty of them. Sending the raw document to the browser would make every lookup a multi-megabyte
// download for data that is 99% discarded.
//
// SEC's fair-access policy requires a declared User-Agent with real contact details and caps
// traffic at 10 requests/second. Both are honoured here. Do not remove the UA — requests without
// one are refused, and that failure looks like a network error rather than a policy rejection.
const UA = { "User-Agent": "Mason Bennett masonjbennett.com bennettmasonj@gmail.com", "Accept-Encoding": "gzip, deflate" };
const SEC = "https://data.sec.gov";

// Every tag the template can ask for. Kept here rather than imported from src/ because this file is
// a serverless function and src/ is client bundle — duplicating ~235 strings is cheaper than a build
// step that shares them. If a tag is added to the template it must be added here too, or the value
// silently never arrives; the tag-coverage check in the UI is what surfaces that.
//
// Twenty of them are asked for by NO ROW, and they are here for rule 40: the thirteen current debt
// spellings whose population it measures, the six whole-debt totals that are its witnesses, and
// `CapitalLeaseObligationsCurrent`, which is the pre-ASC-842 name for the finance lease current and
// is what its lease guard compares against. That last one is the reason to be careful here: a rule
// that reads the filer's own arithmetic can only be as right as the payload is wide, and a GUARD with
// nothing to read fails OPEN. Without it Lam Research's FY2019 finance-lease slice would be added to
// its debt, because the guard that refuses it would have nothing to compare the residual to.
const KEEP = new Set(["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","RevenuesNetOfInterestExpense","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","CostOfGoodsAndServicesSold","CostOfRevenue","CostOfServices","GrossProfit","ResearchAndDevelopmentExpense","SellingAndMarketingExpense","MarketingExpense","GeneralAndAdministrativeExpense","SellingGeneralAndAdministrativeExpense","OtherCostAndExpenseOperating","RestructuringCharges","OperatingExpenses","CostsAndExpenses","OperatingIncomeLoss","DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet","DepreciationAndAmortization","Depreciation","ShareBasedCompensation","AllocatedShareBasedCompensationExpense","InterestExpense","InterestExpenseDebt","InterestExpenseNonoperating","InvestmentIncomeInterest","InterestIncomeOther","OtherNonoperatingIncomeExpense","NonoperatingIncomeExpense","IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest","IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments","IncomeTaxExpenseBenefit","NetIncomeLoss","ProfitLoss","NetIncomeLossAttributableToNoncontrollingInterest","NetIncomeLossAvailableToCommonStockholdersBasic","PreferredStockDividendsIncomeStatementImpact","CashAndCashEquivalentsAtCarryingValue","CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents","ShortTermInvestments","MarketableSecuritiesCurrent","AvailableForSaleSecuritiesDebtSecuritiesCurrent","AccountsReceivableNetCurrent","ReceivablesNetCurrent","InventoryNet","OtherAssetsCurrent","PrepaidExpenseAndOtherAssetsCurrent","AssetsCurrent","PropertyPlantAndEquipmentNet","PropertyPlantAndEquipmentGross","AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment","Goodwill","FiniteLivedIntangibleAssetsNet","IntangibleAssetsNetExcludingGoodwill","OperatingLeaseRightOfUseAsset","LongTermInvestments","MarketableSecuritiesNoncurrent","OtherAssetsNoncurrent","Assets","AccountsPayableCurrent","AccountsPayableAndAccruedLiabilitiesCurrent","AccruedLiabilitiesCurrent","EmployeeRelatedLiabilitiesCurrent","ContractWithCustomerLiabilityCurrent","DeferredRevenueCurrent","ShortTermBorrowings","CommercialPaper","OtherShortTermBorrowings","LongTermDebtCurrent","OperatingLeaseLiabilityCurrent","FinanceLeaseLiabilityCurrent","LiabilitiesCurrent","LongTermDebtNoncurrent","LongTermDebt","LongTermDebtAndCapitalLeaseObligations","LongTermDebtAndCapitalLeaseObligationsCurrent","DebtCurrent","ConvertibleDebtNoncurrent","LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities","DebtAndCapitalLeaseObligations","DebtLongtermAndShorttermCombinedAmount","ConvertibleDebtCurrent","ConvertibleNotesPayableCurrent","ConvertibleSubordinatedDebtCurrent","SeniorNotesCurrent","OtherLongTermDebtCurrent","UnsecuredDebtCurrent","SecuredDebtCurrent","SubordinatedDebtCurrent","NotesPayableCurrent","OtherNotesPayableCurrent","NotesPayableToBankCurrent","NotesPayableRelatedPartiesClassifiedCurrent","LongTermCommercialPaperCurrent","CapitalLeaseObligationsCurrent","DebtInstrumentCarryingAmount","ConvertibleDebt","ConvertibleNotesPayable","OtherNotesPayable","SeniorNotes","OtherLongTermDebt","OperatingLeaseLiabilityNoncurrent","FinanceLeaseLiabilityNoncurrent","DeferredIncomeTaxLiabilitiesNet","DeferredTaxLiabilitiesNoncurrent","DefinedBenefitPensionPlanLiabilitiesNoncurrent","LiabilityDefinedBenefitPlanNoncurrent","Liabilities","TemporaryEquityCarryingAmountAttributableToParent","TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests","RedeemableNoncontrollingInterestEquityCarryingAmount","TemporaryEquityCarryingAmount","PreferredStockValue","RetainedEarningsAccumulatedDeficit","TreasuryStockValue","TreasuryStockCommonValue","AccumulatedOtherComprehensiveIncomeLossNetOfTax","StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest","MinorityInterest","MembersEquity","PartnersCapital","LimitedLiabilityCompanyLlcMembersEquityIncludingPortionAttributableToNoncontrollingInterest","PartnersCapitalIncludingPortionAttributableToNoncontrollingInterest","RedeemableNoncontrollingInterestEquityCommonCarryingAmount","RedeemableNoncontrollingInterestEquityPreferredCarryingAmount","RedeemableNoncontrollingInterestEquityOtherCarryingAmount","RedeemableNoncontrollingInterestEquityOtherFairValue","DeferredIncomeTaxExpenseBenefit","IncomeTaxesPaidNet","IncomeTaxesPaid","IncreaseDecreaseInAccountsReceivable","IncreaseDecreaseInInventories","IncreaseDecreaseInAccountsPayable","NetCashProvidedByUsedInOperatingActivities","NetCashProvidedByUsedInOperatingActivitiesContinuingOperations","PaymentsToAcquirePropertyPlantAndEquipment","PaymentsToAcquireProductiveAssets","PaymentsToAcquireOtherPropertyPlantAndEquipment","PaymentsForCapitalImprovements","PaymentsToAcquireOtherProductiveAssets","AmortizationOfIntangibleAssets","PaymentsToDevelopSoftware","PaymentsForSoftware","PaymentsToAcquireBusinessesNetOfCashAcquired","ProceedsFromDivestitureOfBusinesses","NetCashProvidedByUsedInInvestingActivities","ProceedsFromIssuanceOfLongTermDebt","ProceedsFromIssuanceOfDebt","ProceedsFromNotesPayable","RepaymentsOfLongTermDebt","RepaymentsOfDebt","PaymentsForRepurchaseOfCommonStock","PaymentsOfDividendsCommonStock","PaymentsOfDividends","NetCashProvidedByUsedInFinancingActivities","EarningsPerShareBasic","EarningsPerShareDiluted","WeightedAverageNumberOfSharesOutstandingBasic","WeightedAverageNumberOfDilutedSharesOutstanding","CommonStockDividendsPerShareDeclared","OperatingLossCarryforwards","DeferredTaxAssetsOperatingLossCarryforwards","TaxCreditCarryforwardAmount","DeferredTaxAssetsTaxCreditCarryforwards","ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber","ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice","ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber","EmployeeServiceShareBasedCompensationNonvestedAwardsTotalCompensationCostNotYetRecognized","DefinedBenefitPlanFundedStatusOfPlan","DeferredCompensationLiabilityClassifiedNoncurrent","AssetRetirementObligationsNoncurrent","LiabilityForUncertainTaxPositionsNoncurrent","RestructuringSettlementAndImpairmentProvisions","GoodwillImpairmentLoss","AssetImpairmentCharges","BusinessCombinationAcquisitionRelatedCosts","LitigationSettlementExpense","LossContingencyAccrualAtCarryingValue","GainLossOnDispositionOfAssets","GainLossOnSaleOfBusiness","InterestIncomeExpenseNet","ProvisionForLoanLeaseAndOtherLosses","ProvisionForCreditLosses","LoansAndLeasesReceivableNetReportedAmount","Deposits","NoninterestIncome","NoninterestExpense","PremiumsEarnedNet","PolicyholderBenefitsAndClaimsIncurredNet","OperatingLeaseLeaseIncome",
// Bank-specific. A depository reports a different income statement entirely — interest in, interest
// out, provision, and the two noninterest lines — none of which appear in a corporate template.
"InterestAndDividendIncomeOperating","InterestIncomeExpenseAfterProvisionForLoanLoss","InterestExpenseDeposits","LoansAndLeasesReceivableNetOfDeferredIncome","FinancingReceivableAllowanceForCreditLosses","AvailableForSaleSecuritiesDebtSecurities","HeldToMaturitySecurities","LoansAndLeasesReceivableGrossCarryingAmount","NotesReceivableNet",
// A business development company's top line. It is here rather than with the insurance investment
// tags below because it is a REVENUE concept: `GrossInvestmentIncomeOperating` is what the filing
// calls total investment income, while `NetInvestmentIncome` two blocks down is struck after
// operating expenses. Carlyle Secured Lending files no revenue concept of any kind, so without this
// the top line is blank and every margin under it goes with it.
"GrossInvestmentIncomeOperating",
// Post-CECL equivalents. The tags above stop around 2016-2021; these are what banks file today, and
// both eras must be kept or the sheet is blank at one end of its history or the other.
"FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss","FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss","FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest","DebtSecuritiesAvailableForSaleExcludingAccruedInterest","DebtSecuritiesHeldToMaturityExcludingAccruedInterestAfterAllowanceForCreditLoss",
// ── Insurance ────────────────────────────────────────────────────────────────────────────────────
// P&C underwriting. Three of these come off Schedule III / Schedule VI rather than the face of the
// income statement (the Supplementary*/Supplemental* names), and they are not decoration: Allstate
// files its written premium ONLY through Schedule III, so dropping them blanks the growth line for
// a top-five carrier.
"PremiumsWrittenNet","SupplementaryInsuranceInformationPremiumsWritten","SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPremiumsWritten",
"PremiumsEarnedNet","SupplementaryInsuranceInformationPremiumRevenue","PremiumsEarnedNetPropertyAndCasualty",
"CededPremiumsEarned","CededPremiumsEarnedPropertyAndCasualty",
"PolicyholderBenefitsAndClaimsIncurredNet","SupplementaryInsuranceInformationBenefitsClaimsLossesAndSettlementExpense",
"SupplementalInformationForPropertyCasualtyInsuranceUnderwritersCurrentYearClaimsAndClaimsAdjustmentExpense","SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense",
// Post-2019 taxonomy names for the same two Schedule VI lines. Chubb files BOTH spellings; a filer
// that has switched cleanly would go blank on the old names alone — the CECL lesson, again.
"SecSchedule1218SupplementalInformationPropertyCasualtyInsuranceUnderwritersCurrentYearClaimAndClaimAdjustmentExpense","SecSchedule1218SupplementalInformationPropertyCasualtyInsuranceUnderwritersPriorYearClaimAndClaimAdjustmentExpense",
"DeferredPolicyAcquisitionCostAmortizationExpense","SupplementaryInsuranceInformationAmortizationOfDeferredPolicyAcquisitionCosts","SupplementalInformationForPropertyCasualtyInsuranceUnderwritersAmortizationOfDeferredPolicyAcquisitionCosts",
"OtherUnderwritingExpense","SupplementaryInsuranceInformationOtherOperatingExpense","BenefitsLossesAndExpenses","LiabilityForFuturePolicyBenefitsPeriodExpense",
// Reserves, float and the investment portfolio.
"LiabilityForClaimsAndClaimsAdjustmentExpense","SupplementalInformationForPropertyCasualtyInsuranceUnderwritersReservesForUnpaidClaimsAndClaimsAdjustmentExpense",
"LiabilityForUnpaidClaimsAndClaimsAdjustmentExpenseNet","ReinsuranceRecoverableForUnpaidClaimsAndClaimsAdjustments","ReinsuranceRecoverables",
"UnearnedPremiums","SupplementaryInsuranceInformationUnearnedPremiums","SupplementalInformationForPropertyCasualtyInsuranceUnderwritersUnearnedPremiums",
"DeferredPolicyAcquisitionCosts","DeferredPolicyAcquisitionCostsNet","SupplementaryInsuranceInformationDeferredPolicyAcquisitionCosts",
"Investments","InvestmentsFairValueDisclosure","NetInvestmentIncome","SupplementaryInsuranceInformationNetInvestmentIncome","InvestmentIncomeNet","InvestmentIncomeInterest",
"RealizedInvestmentGainsLosses","GainLossOnInvestments","MarketableSecuritiesRealizedGainLoss",
"EquitySecuritiesFvNi","EquitySecuritiesFvNiCurrentAndNoncurrent","AvailableForSaleSecuritiesEquitySecurities","AvailableForSaleSecurities",
// Life carriers. InsuranceCommissionsAndFees is the live policy-fee tag; PolicyChargesInsurance is
// the one whose name fits and which every filer tested abandoned in 2012.
"LiabilityForFuturePolicyBenefits","PolicyholderFunds","PolicyholderContractDeposits","SeparateAccountAssets",
"InsuranceCommissionsAndFees","PolicyChargesInsurance",
"InterestCreditedToPolicyholdersAccountBalances","InterestCreditedToPolicyOwnerAccount","InterestCreditedToPolicyOwnerAccounts",
// Health plans. Both spellings of the medical-cost line — UnitedHealth uses the HealthCare one
// through 2021 and the generic one from 2022.
"PolicyholderBenefitsAndClaimsIncurredHealthCare","HealthCareOrganizationPremiumRevenue",
// Broker-dealers, boutiques and alternative managers — the compensation ratio.
"LaborAndRelatedExpense","EmployeeBenefitsAndShareBasedCompensation",
// ── REIT ─────────────────────────────────────────────────────────────────────────────────────────
// SECScheduleIII...DepreciationExpense is filed by all ten REITs tested — the only universally
// tagged real-estate-only depreciation figure. NotesPayable/LongTermDebt carry the debt total that
// the corporate short/current/long split misses entirely for a REIT.
"OperatingLeaseLeaseIncome","LeaseIncome","OperatingLeasesIncomeStatementLeaseRevenue","RealEstateRevenueNet",
"DirectCostsOfLeasedAndRentedPropertyOrEquipment","CostOfOtherPropertyOperatingExpense","RealEstateTaxExpense",
"SECScheduleIIIRealEstateAccumulatedDepreciationDepreciationExpense",
"GainLossOnSaleOfProperties","GainsLossesOnSalesOfInvestmentRealEstate","GainLossOnSaleOfPropertyPlantEquipment",
"ImpairmentOfRealEstate","StraightLineRent",
"RealEstateGrossAtCarryingValue","RealEstateInvestmentPropertyAtCost",
"RealEstateAccumulatedDepreciation","RealEstateInvestmentPropertyAccumulatedDepreciation",
"NotesPayable","NumberOfRealEstateProperties","PaymentsOfOrdinaryDividends","DividendsCommonStockCash",
// ── Working capital, off the cash flow statement ─────────────────────────────────────────
// Rule 25. The movement a filer reports in operating assets and liabilities, which unlevered free
// cash flow subtracts. There is no universal subtotal — IncreaseDecreaseInOperatingCapital appears
// at 8 of 160 filers swept — so the movement is summed from components, and a component this list
// drops is a leg of working capital silently missing from every sheet. Classified from a census of
// all 159 IncreaseDecreaseIn* tags those filers use; see src/extract.js for what is deliberately
// EXCLUDED (a bank's deposits and trading book, an insurer's reserves, restricted cash).
"IncreaseDecreaseInOperatingCapital","IncreaseDecreaseInReceivables","IncreaseDecreaseInAccountsAndNotesReceivable",
"IncreaseDecreaseInAccountsAndOtherReceivables","IncreaseDecreaseInOtherReceivables","IncreaseDecreaseInIncomeTaxesReceivable",
"IncreaseDecreaseInNotesReceivables","IncreaseDecreaseInUnbilledReceivables","IncreaseDecreaseInAccountsReceivableRelatedParties",
"IncreaseDecreaseInLongTermReceivablesCurrent","IncreaseDecreaseInDeferredRentReceivables","IncreaseDecreaseInInsuranceSettlementsReceivable",
"IncreaseDecreaseInAccountsReceivableAndOtherOperatingAssets","IncreaseDecreaseInRetailRelatedInventories","IncreaseDecreaseInMaterialsAndSupplies",
"IncreaseDecreaseInRawMaterialsPackagingMaterialsAndSuppliesInventories","IncreaseDecreaseInFinishedGoodsAndWorkInProcessInventories","IncreaseDecreaseInFossilFuelInventories",
"IncreaseDecreaseInPrepaidSupplies","IncreaseDecreaseInPrepaidDeferredExpenseAndOtherAssets","IncreaseDecreaseInPrepaidExpense",
"IncreaseDecreaseInPrepaidExpensesOther","IncreaseDecreaseInPrepaidTaxes","IncreaseDecreaseInOtherOperatingAssets",
"IncreaseDecreaseInOtherCurrentAssets","IncreaseDecreaseInOtherNoncurrentAssets","IncreaseDecreaseInContractWithCustomerAsset",
"IncreaseDecreaseInDeferredCharges","IncreaseDecreaseInAssetsHeldForSale","IncreaseDecreaseInIntangibleAssetsCurrent",
"IncreaseDecreaseInOperatingAssets","IncreaseDecreaseInDueFromRelatedParties","IncreaseDecreaseInDueFromRelatedPartiesCurrent",
"IncreaseDecreaseInDueFromAffiliatesCurrent","IncreaseDecreaseInAccountsPayableTrade","IncreaseDecreaseInAccountsPayableRelatedParties",
"IncreaseDecreaseInOtherAccountsPayable","IncreaseDecreaseInAccountsPayableAndOtherOperatingLiabilities","IncreaseDecreaseInAccruedLiabilities",
"IncreaseDecreaseInOtherAccruedLiabilities","IncreaseDecreaseInAccruedIncomeTaxesPayable","IncreaseDecreaseInAccruedTaxesPayable",
"IncreaseDecreaseInIncomeTaxes","IncreaseDecreaseInIncomeTaxesPayableNetOfIncomeTaxesReceivable","IncreaseDecreaseInEmployeeRelatedLiabilities",
"IncreaseDecreaseInOtherEmployeeRelatedLiabilities","IncreaseDecreaseInAccruedSalaries","IncreaseDecreaseInInterestPayableNet",
"IncreaseDecreaseInRestructuringReserve","IncreaseDecreaseInSelfInsuranceReserve","IncreaseDecreaseInContractWithCustomerLiability",
"IncreaseDecreaseInDeferredRevenue","IncreaseDecreaseInDeferredRevenueAndCustomerAdvancesAndDeposits","IncreaseDecreaseInCustomerAdvances",
"IncreaseDecreaseInCustomerDeposits","IncreaseDecreaseInBillingInExcessOfCostOfEarnings","IncreaseDecreaseInOtherOperatingLiabilities",
"IncreaseDecreaseInOtherCurrentLiabilities","IncreaseDecreaseInOtherNoncurrentLiabilities","IncreaseDecreaseInDueToRelatedParties",
"IncreaseDecreaseInDueToRelatedPartiesCurrent","IncreaseDecreaseInDueToAffiliates","IncreaseDecreaseInDeferredLiabilities",
"IncreaseDecreaseInOtherDeferredLiability","IncreaseDecreaseInDeferredCompensation","IncreaseDecreaseInPensionAndPostretirementObligations",
"IncreaseDecreaseInPensionPlanObligations","IncreaseDecreaseInPostretirementObligations","IncreaseDecreaseInAssetRetirementObligations",
"IncreaseDecreaseInOperatingLeaseLiability","IncreaseDecreaseInOperatingLiabilities","IncreaseDecreaseInRegulatoryLiabilities",
"IncreaseDecreaseInManagementAndIncentiveFeesPayable","IncreaseDecreaseInOtherOperatingCapitalNet","IncreaseDecreaseInOtherNoncurrentAssetsAndLiabilitiesNet",
"IncreaseDecreaseInOtherCurrentAssetsAndLiabilitiesNet","IncreaseDecreaseInDerivativeAssetsAndLiabilities","IncreaseDecreaseInCommodityContractAssetsAndLiabilities",
"IncreaseDecreaseInRiskManagementAssetsAndLiabilities","IncreaseDecreaseInAccountsPayableAndAccruedLiabilities","IncreaseDecreaseInAccruedLiabilitiesAndOtherOperatingLiabilities",
"IncreaseDecreaseInOtherAccountsPayableAndAccruedLiabilities",
]);

const pad = c => String(c).padStart(10, "0");

// Steps 1-4 of `announcedSince` with both gates removed — see the Cache-Control note below. It
// answers "could this payload's freshness matter to the page?", never "should the banner speak".
const hasLaterAnn = rows => {
  const per = rows.filter(f => /^(10-K|10-Q|20-F|40-F)T?(\/A)?$/.test(f.form)).map(f => f.filed).sort().pop();
  const ann = rows.filter(f => f.form === "8-K"
    && String(f.items || "").split(",").map(x => x.trim()).includes("2.02")).map(f => f.filed).sort().pop();
  return !!(per && ann && ann > per);
};

export default async function handler(req, res) {
  const cik = String(req.query.cik || "").replace(/\D/g, "");
  if (!cik || cik.length > 10) return res.status(400).json({ error: "cik must be digits" });
  // Filings change once a quarter at most, so a long shared cache is honest here and it is also
  // what keeps this inside SEC's rate limits when several lookups land at once.
  // The cache header goes on the SUCCESS path only, at the single `return res.status(200)` below.
  // It used to be set here, before the try — so every failure carried it too, and a 502 saying
  // "couldn't reach SEC" or a 404 saying "no XBRL data on file" was handed to the edge with six
  // hours of s-maxage and a day of stale-while-revalidate behind it. One blip at SEC and every
  // reader looking up that company gets the error for six hours, after SEC has recovered, with
  // nothing retrying because the CDN is answering. A failure is the one response that must not be
  // cached: it is the one most likely to be wrong a second later.
  const CACHE_OK = "public, s-maxage=21600, stale-while-revalidate=86400";
  const CACHE_FRESH = "public, s-maxage=1800, stale-while-revalidate=300";
  try {
    const [factsRes, subRes] = await Promise.all([
      fetch(`${SEC}/api/xbrl/companyfacts/CIK${pad(cik)}.json`, { headers: UA }),
      fetch(`${SEC}/submissions/CIK${pad(cik)}.json`, { headers: UA }),
    ]);
    if (factsRes.status === 404) return res.status(404).json({ error: "no XBRL financial data on file for that company" });
    if (!factsRes.ok) return res.status(502).json({ error: `SEC answered ${factsRes.status} for company facts` });
    if (!subRes.ok) return res.status(502).json({ error: `SEC answered ${subRes.status} for the filing list` });
    const [all, sub] = await Promise.all([factsRes.json(), subRes.json()]);

    const out = {};
    let kept = 0, dropped = 0;
    for (const ns of ["us-gaap", "dei"]) {
      const block = (all.facts || {})[ns] || {};
      for (const [tag, def] of Object.entries(block)) {
        if (ns === "us-gaap" && !KEEP.has(tag)) { dropped++; continue; }
        if (ns === "dei" && tag !== "EntityCommonStockSharesOutstanding") continue;
        const units = {};
        for (const [unit, arr] of Object.entries(def.units || {})) units[unit] = arr;
        out[ns === "dei" ? `dei:${tag}` : tag] = { label: def.label, units };
        kept++;
      }
    }

    // The filing list, trimmed to the forms a model is built from and the fields needed to link back.
    //
    // The pattern has to cover every form a FACT can come from, because `behind` reads this list to
    // ask whether an annual report exists for a period the sheet does not cover — and it was written
    // as a fixed set of eight strings that left out every TRANSITION report. `grid.js` carries a `T?`
    // in its own regex specifically for those, so the provision was there and could never fire: the
    // population had been removed one layer earlier. Greif changed its year end from 31 Oct to 30 Sep
    // and files a 10-KT for the eleven months to Sep-2025; with that report invisible here, its sheet
    // stopped at Oct-2024 and said nothing, which is National Steel's failure exactly. Also picks up
    // 20-F/A, 40-F/A and the amended transition forms, none of which were listed either.
    const r = sub.filings && sub.filings.recent ? sub.filings.recent : { form: [] };
    const filings = [];
    for (let i = 0; i < r.form.length; i++) {
      if (!/^(10-K|10-Q|20-F|40-F)T?(\/A)?$|^8-K$/.test(r.form[i])) continue;
      // `items` is SEC's own list of the cover-page item codes on an 8-K, e.g. "2.02,9.01". It is
      // what `announcedSince` in src/grid.js reads to find a results announcement the sheet does not
      // cover, and it is the reason that rule needs no document parsed and no new request made.
      // Carried verbatim on EVERY kept row rather than pre-filtered to the 8-Ks that carry 2.02: a
      // field that is absent because this handler dropped it cannot be told from one absent because
      // SEC had none, and rule 5's discipline is that a blank means one thing. Measured cost: +1.5KB
      // on a mean payload of 1,097KB, 0.14%.
      filings.push({ form: r.form[i], filed: r.filingDate[i], accn: r.accessionNumber[i], doc: r.primaryDocument[i], period: r.reportDate ? r.reportDate[i] : null, items: r.items ? r.items[i] : null });
      if (filings.length >= 120) break;
    }
    // A payload can sit on the edge for six hours with a day of stale-while-revalidate behind it,
    // so a reader can be served one up to thirty hours old. That was harmless while everything here
    // was eight years of annual figures. It stops being harmless the moment the page carries a line
    // whose whole job is to say a LATER filing exists: measured over a year's replay of 180 filers,
    // a payload 24 hours stale gets that line wrong on 362 of 3,554 firing reader-days (10.2%) —
    // 350 of them a banner that should have gone once the 10-Q landed, 12 a link to an 8-K a newer
    // one has superseded.
    //
    // So the header is decided from the filing list rather than being one constant. `hasLaterAnn`
    // is deliberately CRUDER than the rule in grid.js and must never become a second copy of it: it
    // asks only whether this filer has any item-2.02 8-K filed after any periodic report, with no
    // lag gate and no freshness ceiling. That makes it a strict relaxation, so the banner cannot
    // fire where this is false — containment is provable rather than measured. It is true on 7.1% of
    // filer-days and on 37% of the corpus on the busiest filing day of the year.
    //
    // The short tier keeps a small stale-while-revalidate on purpose. Dropping it would put a
    // 10-15MB SEC companyfacts fetch on a reader's critical path every half hour for a third of the
    // corpus in earnings season, and SEC answers 503 often enough that this session's own census hit
    // one. 300 seconds cannot span a filing; the freshness is bought by s-maxage.
    res.setHeader("Cache-Control", hasLaterAnn(filings) ? CACHE_FRESH : CACHE_OK);
    return res.status(200).json({
      // The NUMERIC sic is what industry detection keys off. The description is prose that varies
      // ("State Commercial Banks", "National Commercial Banks"), whereas the code is a range you
      // can test — and guessing the industry from which tags happen to be present would call any
      // company with a loan book a bank.
      cik, name: sub.name, tickers: sub.tickers || [], sic: sub.sicDescription || "", sicCode: sub.sic || "",
      fiscalYearEnd: sub.fiscalYearEnd || "", facts: out, filings,
      meta: { tagsKept: kept, tagsDropped: dropped },
    });
  } catch (e) {
    console.error("facts failed:", e && e.message);
    return res.status(502).json({ error: "couldn't reach SEC — try again in a moment" });
  }
}
