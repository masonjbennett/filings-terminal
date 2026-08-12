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
const KEEP = new Set(["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","RevenuesNetOfInterestExpense","RevenueFromContractWithCustomerIncludingAssessedTax","SalesRevenueNet","CostOfGoodsAndServicesSold","CostOfRevenue","CostOfServices","GrossProfit","ResearchAndDevelopmentExpense","SellingAndMarketingExpense","MarketingExpense","GeneralAndAdministrativeExpense","SellingGeneralAndAdministrativeExpense","OtherCostAndExpenseOperating","RestructuringCharges","OperatingExpenses","CostsAndExpenses","OperatingIncomeLoss","DepreciationDepletionAndAmortization","DepreciationAmortizationAndAccretionNet","DepreciationAndAmortization","Depreciation","ShareBasedCompensation","AllocatedShareBasedCompensationExpense","InterestExpense","InterestExpenseDebt","InterestExpenseNonoperating","InvestmentIncomeInterest","InterestIncomeOther","OtherNonoperatingIncomeExpense","NonoperatingIncomeExpense","IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest","IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments","IncomeTaxExpenseBenefit","NetIncomeLoss","ProfitLoss","NetIncomeLossAttributableToNoncontrollingInterest","NetIncomeLossAvailableToCommonStockholdersBasic","PreferredStockDividendsIncomeStatementImpact","CashAndCashEquivalentsAtCarryingValue","CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents","ShortTermInvestments","MarketableSecuritiesCurrent","AvailableForSaleSecuritiesDebtSecuritiesCurrent","AccountsReceivableNetCurrent","ReceivablesNetCurrent","InventoryNet","OtherAssetsCurrent","PrepaidExpenseAndOtherAssetsCurrent","AssetsCurrent","PropertyPlantAndEquipmentNet","PropertyPlantAndEquipmentGross","AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment","Goodwill","FiniteLivedIntangibleAssetsNet","IntangibleAssetsNetExcludingGoodwill","OperatingLeaseRightOfUseAsset","LongTermInvestments","MarketableSecuritiesNoncurrent","OtherAssetsNoncurrent","Assets","AccountsPayableCurrent","AccountsPayableAndAccruedLiabilitiesCurrent","AccruedLiabilitiesCurrent","EmployeeRelatedLiabilitiesCurrent","ContractWithCustomerLiabilityCurrent","DeferredRevenueCurrent","ShortTermBorrowings","CommercialPaper","OtherShortTermBorrowings","LongTermDebtCurrent","OperatingLeaseLiabilityCurrent","FinanceLeaseLiabilityCurrent","LiabilitiesCurrent","LongTermDebtNoncurrent","LongTermDebt","LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities","DebtAndCapitalLeaseObligations","DebtLongtermAndShorttermCombinedAmount","OperatingLeaseLiabilityNoncurrent","FinanceLeaseLiabilityNoncurrent","DeferredIncomeTaxLiabilitiesNet","DeferredTaxLiabilitiesNoncurrent","DefinedBenefitPensionPlanLiabilitiesNoncurrent","LiabilityDefinedBenefitPlanNoncurrent","Liabilities","PreferredStockValue","RetainedEarningsAccumulatedDeficit","TreasuryStockValue","TreasuryStockCommonValue","AccumulatedOtherComprehensiveIncomeLossNetOfTax","StockholdersEquity","StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest","MinorityInterest","DeferredIncomeTaxExpenseBenefit","IncreaseDecreaseInAccountsReceivable","IncreaseDecreaseInInventories","IncreaseDecreaseInAccountsPayable","NetCashProvidedByUsedInOperatingActivities","NetCashProvidedByUsedInOperatingActivitiesContinuingOperations","PaymentsToAcquirePropertyPlantAndEquipment","PaymentsToAcquireProductiveAssets","PaymentsToDevelopSoftware","PaymentsForSoftware","PaymentsToAcquireBusinessesNetOfCashAcquired","ProceedsFromDivestitureOfBusinesses","NetCashProvidedByUsedInInvestingActivities","ProceedsFromIssuanceOfLongTermDebt","ProceedsFromIssuanceOfDebt","ProceedsFromNotesPayable","RepaymentsOfLongTermDebt","RepaymentsOfDebt","PaymentsForRepurchaseOfCommonStock","PaymentsOfDividendsCommonStock","PaymentsOfDividends","NetCashProvidedByUsedInFinancingActivities","EarningsPerShareBasic","EarningsPerShareDiluted","WeightedAverageNumberOfSharesOutstandingBasic","WeightedAverageNumberOfDilutedSharesOutstanding","CommonStockDividendsPerShareDeclared","OperatingLossCarryforwards","DeferredTaxAssetsOperatingLossCarryforwards","TaxCreditCarryforwardAmount","DeferredTaxAssetsTaxCreditCarryforwards","ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber","ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice","ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber","EmployeeServiceShareBasedCompensationNonvestedAwardsTotalCompensationCostNotYetRecognized","DefinedBenefitPlanFundedStatusOfPlan","DeferredCompensationLiabilityClassifiedNoncurrent","AssetRetirementObligationsNoncurrent","LiabilityForUncertainTaxPositionsNoncurrent","RestructuringSettlementAndImpairmentProvisions","GoodwillImpairmentLoss","AssetImpairmentCharges","BusinessCombinationAcquisitionRelatedCosts","LitigationSettlementExpense","LossContingencyAccrualAtCarryingValue","GainLossOnDispositionOfAssets","GainLossOnSaleOfBusiness","InterestIncomeExpenseNet","ProvisionForLoanLeaseAndOtherLosses","ProvisionForCreditLosses","LoansAndLeasesReceivableNetReportedAmount","Deposits","NoninterestIncome","NoninterestExpense","PremiumsEarnedNet","PolicyholderBenefitsAndClaimsIncurredNet","OperatingLeaseLeaseIncome",
// Bank-specific. A depository reports a different income statement entirely — interest in, interest
// out, provision, and the two noninterest lines — none of which appear in a corporate template.
"InterestAndDividendIncomeOperating","InterestIncomeExpenseAfterProvisionForLoanLoss","InterestExpenseDeposits","LoansAndLeasesReceivableNetOfDeferredIncome","FinancingReceivableAllowanceForCreditLosses","AvailableForSaleSecuritiesDebtSecurities","HeldToMaturitySecurities","LoansAndLeasesReceivableGrossCarryingAmount","NotesReceivableNet",
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
"NotesPayable","NumberOfRealEstateProperties","PaymentsOfOrdinaryDividends","DividendsCommonStockCash"]);

const pad = c => String(c).padStart(10, "0");

export default async function handler(req, res) {
  const cik = String(req.query.cik || "").replace(/\D/g, "");
  if (!cik || cik.length > 10) return res.status(400).json({ error: "cik must be digits" });
  // Filings change once a quarter at most, so a long shared cache is honest here and it is also
  // what keeps this inside SEC's rate limits when several lookups land at once.
  res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
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
    const r = sub.filings && sub.filings.recent ? sub.filings.recent : { form: [] };
    const filings = [];
    for (let i = 0; i < r.form.length; i++) {
      if (!/^(10-K|10-Q|8-K|20-F|40-F|10-K\/A|10-Q\/A)$/.test(r.form[i])) continue;
      filings.push({ form: r.form[i], filed: r.filingDate[i], accn: r.accessionNumber[i], doc: r.primaryDocument[i], period: r.reportDate ? r.reportDate[i] : null });
      if (filings.length >= 120) break;
    }
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
