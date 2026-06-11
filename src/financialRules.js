/**
 * Dynamic Financial Underwriting Estimation Engine
 * Generates estimated development financials for any NYC tax lot based on PLUTO area & zoning parameters
 */

// Helper to parse parameter value with a fallback
export function parseParam(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  const num = parseFloat(val);
  return isNaN(num) ? fallback : num;
}

// Helper to evaluate simple math formulas safely
export function evaluateFormula(formulaStr, variables) {
  try {
    let expr = String(formulaStr || "").trim();
    if (!expr) return NaN;

    // Sort variable names by length descending to prevent partial match replacement
    const sortedKeys = Object.keys(variables).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      expr = expr.replace(regex, variables[key]);
    }

    // Sanitize the expression to ONLY allow digits, mathematical operations, brackets, spaces
    if (/^[0-9+\-*/().\s]+$/.test(expr)) {
      const result = new Function(`return (${expr})`)();
      return Number(result);
    } else {
      console.warn("Formula contains unsafe characters after evaluation:", formulaStr, expr);
      return NaN;
    }
  } catch (e) {
    console.error("Failed to evaluate formula:", formulaStr, e);
    return NaN;
  }
}

export function estimateFinancials(lotArea, zoningRules, address = "Searched Location", bbl = "", customAssumptions = null) {
  if (!lotArea || !zoningRules) return null;

  // 1. Core Dimensions
  const resFar = zoningRules.resFar || 0;
  const commFar = zoningRules.commFar || 0;
  const facilFar = zoningRules.facilFar || 0;
  const mfgFar = zoningRules.mfgFar || 0;
  
  // Determine primary FAR and development type
  const isMfg = mfgFar > Math.max(resFar, commFar) && mfgFar > 0;
  const isComm = commFar >= resFar && commFar > 0;
  
  const far = zoningRules.ihFar || Math.max(resFar, commFar, facilFar, mfgFar, 1.0);
  const zfa = lotArea * far;

  // Define default values
  const defaults = {
    // Formulas
    gsfFormula: "ZFA * 1.15",
    nsfFormula: "GSF * 0.82",
    stabilizedValueFormula: "NOI / CapRate",
    seniorLoanFormula: "ProjectCost * LTC",

    // Inputs
    fmRentMo: 3960,       // FM unit rent
    hpdRentMo: 1867.5,     // HPD unit rent
    commRentSf: isMfg ? 25 : 50, // Commercial rent/SF/yr
    fmVacancy: 0.05,      // FM vacancy rate
    hpdVacancy: 0.02,     // HPD vacancy rate
    commVacancy: 0.07,    // Comm vacancy rate
    
    unabatedTaxPct: 0.215, // Real estate taxes as % of EGI
    opexPerUnit: 8500,     // OpEx per unit
    mgmtFeePct: 0.03,      // Mgmt fee as % of EGI
    
    landCostSf: 200,      // Land cost per lot SF
    hardCostGsf: isMfg ? 180 : (isComm ? 260 : 310), // Hard cost per GSF
    hardContingencyPct: 0.10, // Contingency %
    softCostPct: 0.11,    // Soft cost % of hard costs
    financingCostPct: 0.035, // Financing % of land + hard
    carryInterestPct: 0.10,  // Carry interest % of land + hard
    
    capRate: 0.0575,       // Cap Rate
    ltc: 0.71,             // LTC
    discountRate: 0.03,    // NPV discount rate
    priorAv: lotArea * 175, // Prior land assessed value
    avGrowthRate: 0.02,    // Assessed value growth rate
    taxRateGrowth: 0.005,  // Tax rate growth rate

    // Unit Mix Defaults
    fmPct: 0.70,
    studioPct: 0.15,
    oneBedPct: 0.45,
    twoBedPct: 0.40,
    
    fmStudioRatio: 0.707,
    fmOneBedRatio: 0.909,
    fmTwoBedRatio: 1.212,
    
    hpdStudioRatio: 0.857,
    hpdOneBedRatio: 0.937,
    hpdTwoBedRatio: 1.124
  };

  // Merge custom assumptions
  const a = customAssumptions ? { ...defaults, ...customAssumptions } : defaults;

  // Parse percentages if they were input as strings with '%' or numbers > 1
  const parsePercent = (val) => {
    if (typeof val === 'string') {
      val = val.replace('%', '').trim();
    }
    const num = parseFloat(val);
    if (isNaN(num)) return 0;
    return num > 1 ? num / 100 : num;
  };

  // Ensure all rate variables are decimals
  const fmVacancy = parsePercent(a.fmVacancy);
  const hpdVacancy = parsePercent(a.hpdVacancy);
  const commVacancy = parsePercent(a.commVacancy);
  const unabatedTaxPct = parsePercent(a.unabatedTaxPct);
  const mgmtFeePct = parsePercent(a.mgmtFeePct);
  const hardContingencyPct = parsePercent(a.hardContingencyPct);
  const softCostPct = parsePercent(a.softCostPct);
  const financingCostPct = parsePercent(a.financingCostPct);
  const carryInterestPct = parsePercent(a.carryInterestPct);
  const capRate = parsePercent(a.capRate);
  const ltc = parsePercent(a.ltc);
  const discountRate = parsePercent(a.discountRate);
  const avGrowthRate = parsePercent(a.avGrowthRate);
  const taxRateGrowth = parsePercent(a.taxRateGrowth);

  const fmPct = parsePercent(a.fmPct);
  const studioPct = parsePercent(a.studioPct);
  const oneBedPct = parsePercent(a.oneBedPct);
  const twoBedPct = parsePercent(a.twoBedPct);

  const priorAv = parseFloat(a.priorAv) || (lotArea * 175);
  const landCostSf = parseFloat(a.landCostSf);
  const hardCostGsf = parseFloat(a.hardCostGsf);
  const fmRentMo = parseFloat(a.fmRentMo);
  const hpdRentMo = parseFloat(a.hpdRentMo);
  const commRentSf = parseFloat(a.commRentSf);
  const opexPerUnit = parseFloat(a.opexPerUnit);

  // Evaluate Dimensions
  const gsf = evaluateFormula(a.gsfFormula, { ZFA: zfa, LotArea: lotArea, FAR: far }) || (zfa * 1.15);
  const nsf = evaluateFormula(a.nsfFormula, { GSF: gsf, ZFA: zfa, LotArea: lotArea, FAR: far }) || (gsf * 0.82);

  // Determine split parameters
  let totalResidentialUnits = 0;
  let totalResidentialSf = 0;
  let totalCommercialUnits = 0;
  let totalCommercialSf = 0;

  if (isMfg) {
    totalCommercialSf = nsf;
    totalCommercialUnits = 1;
  } else if (isComm) {
    totalCommercialSf = nsf;
    totalCommercialUnits = Math.max(Math.floor(nsf / 5000), 1);
  } else {
    // Residential development (with potential ground floor commercial if overlay exists)
    const hasCommOverlay = zoningRules.overlay || commFar > 0;
    if (hasCommOverlay) {
      // Allocate 10% of space to ground floor commercial
      totalCommercialSf = nsf * 0.10;
      totalCommercialUnits = Math.max(Math.floor(totalCommercialSf / 2500), 1);
      totalResidentialSf = nsf * 0.90;
    } else {
      totalResidentialSf = nsf;
    }
    // Assume 750 net SF average apartment size
    totalResidentialUnits = Math.max(Math.floor(totalResidentialSf / 750), 1);
  }

  // 2. Unit Mix & Revenues
  const fmUnits = Math.ceil(totalResidentialUnits * fmPct); // dynamic FM units %
  const hpdUnits = Math.max(totalResidentialUnits - fmUnits, 0);
  
  const fmSf = totalResidentialSf * fmPct;
  const hpdSf = Math.max(totalResidentialSf - fmSf, 0);

  const rentFMYr = fmUnits * fmRentMo * 12;
  const rentHPDYr = hpdUnits * hpdRentMo * 12;
  const commRentYr = totalCommercialSf * commRentSf;

  const residentialEgi = (rentFMYr * (1 - fmVacancy)) + (rentHPDYr * (1 - hpdVacancy));
  const commercialEgi = commRentYr * (1 - commVacancy);
  const totalEgi = residentialEgi + commercialEgi;

  const revenues = [
    {
      name: "Residential Income (FM)",
      source: "Rent Roll",
      total: rentFMYr,
      perUnit: rentFMYr / Math.max(fmUnits, 1),
      perGsf: rentFMYr / gsf,
      percentEgi: rentFMYr / totalEgi
    },
    {
      name: "Vacancy & Credit Loss (FM)",
      source: -fmVacancy,
      total: -rentFMYr * fmVacancy,
      perUnit: (-rentFMYr * fmVacancy) / Math.max(fmUnits, 1),
      perGsf: (-rentFMYr * fmVacancy) / gsf,
      percentEgi: (-rentFMYr * fmVacancy) / totalEgi
    }
  ];

  if (hpdUnits > 0) {
    revenues.push({
      name: "Residential Income (HPD / IH)",
      source: "Rent Roll",
      total: rentHPDYr,
      perUnit: rentHPDYr / hpdUnits,
      perGsf: rentHPDYr / gsf,
      percentEgi: rentHPDYr / totalEgi
    });
    revenues.push({
      name: "Vacancy & Credit Loss (HPD / IH)",
      source: -hpdVacancy,
      total: -rentHPDYr * hpdVacancy,
      perUnit: (-rentHPDYr * hpdVacancy) / hpdUnits,
      perGsf: (-rentHPDYr * hpdVacancy) / gsf,
      percentEgi: (-rentHPDYr * hpdVacancy) / totalEgi
    });
  }

  if (totalCommercialSf > 0) {
    revenues.push({
      name: isMfg ? "Industrial Income" : "Commercial Income",
      source: "Rent Roll",
      total: commRentYr,
      perUnit: commRentYr / Math.max(totalCommercialUnits, 1),
      perGsf: commRentYr / gsf,
      percentEgi: commRentYr / totalEgi
    });
    revenues.push({
      name: "Vacancy & Credit Loss (Commercial)",
      source: -commVacancy,
      total: -commRentYr * commVacancy,
      perUnit: (-commRentYr * commVacancy) / Math.max(totalCommercialUnits, 1),
      perGsf: (-commRentYr * commVacancy) / gsf,
      percentEgi: (-commRentYr * commVacancy) / totalEgi
    });
  }

  // 3. Operating Expenses
  const unabatedTaxes = totalEgi * unabatedTaxPct;
  const taxSavings = unabatedTaxes * 0.85; // 421(a) abates ~85% of taxes initially
  const abatedTaxes = unabatedTaxes - taxSavings;

  // Base Operating Expenses
  const baseInsurance = totalResidentialUnits * 950 + totalCommercialSf * 1.5;
  const baseWaterSewer = totalResidentialUnits * 550;
  const baseUtilities = totalResidentialUnits * 750 + totalCommercialSf * 1.0;
  const baseMaintenance = totalResidentialUnits * 500 + totalCommercialSf * 0.8;
  const basePayroll = totalResidentialUnits * 2100;
  const baseGA = totalResidentialUnits * 230;
  const baseReserves = totalResidentialUnits * 250;
  const baseResOpex = baseInsurance + baseWaterSewer + baseUtilities + baseMaintenance + basePayroll + baseGA + baseReserves;

  // Proportionally scale based on custom opexPerUnit
  const scale = (totalResidentialUnits * opexPerUnit) / Math.max(baseResOpex, 1);
  const insurance = baseInsurance * scale;
  const waterSewer = baseWaterSewer * scale;
  const utilities = baseUtilities * scale;
  const maintenance = baseMaintenance * scale;
  const payroll = basePayroll * scale;
  const ga = baseGA * scale;
  const mgmtFee = totalEgi * mgmtFeePct;
  const reserves = baseReserves * scale;

  const totalOpexAbated = abatedTaxes + insurance + waterSewer + utilities + maintenance + payroll + ga + mgmtFee + reserves;
  const totalOpexFull = unabatedTaxes + insurance + waterSewer + utilities + maintenance + payroll + ga + mgmtFee + reserves;

  const expenses = [
    {
      name: "Real Estate Taxes",
      source: "421A Analysis",
      total: -unabatedTaxes,
      perUnit: -unabatedTaxes / Math.max(totalResidentialUnits, 1),
      perGsf: -unabatedTaxes / gsf,
      percentEgi: -unabatedTaxes / totalEgi
    },
    {
      name: "Real Estate Taxes Savings",
      source: "421A Analysis",
      total: taxSavings,
      perUnit: taxSavings / Math.max(totalResidentialUnits, 1),
      perGsf: taxSavings / gsf,
      percentEgi: taxSavings / totalEgi
    },
    {
      name: "Insurance",
      source: "Sponsor Budget",
      total: -insurance,
      perUnit: -insurance / Math.max(totalResidentialUnits, 1),
      perGsf: -insurance / gsf,
      percentEgi: -insurance / totalEgi
    },
    {
      name: "Water/Sewer",
      source: "Sponsor Budget",
      total: -waterSewer,
      perUnit: -waterSewer / Math.max(totalResidentialUnits, 1),
      perGsf: -waterSewer / gsf,
      percentEgi: -waterSewer / totalEgi
    },
    {
      name: "Utilities",
      source: "Sponsor Budget",
      total: -utilities,
      perUnit: -utilities / Math.max(totalResidentialUnits, 1),
      perGsf: -utilities / gsf,
      percentEgi: -utilities / totalEgi
    },
    {
      name: "Repairs & Maintenance",
      source: "Sponsor Budget",
      total: -maintenance,
      perUnit: -maintenance / Math.max(totalResidentialUnits, 1),
      perGsf: -maintenance / gsf,
      percentEgi: -maintenance / totalEgi
    },
    {
      name: "Payroll",
      source: "Sponsor Budget",
      total: -payroll,
      perUnit: -payroll / Math.max(totalResidentialUnits, 1),
      perGsf: -payroll / gsf,
      percentEgi: -payroll / totalEgi
    },
    {
      name: "General & Administrative",
      source: "Sponsor Budget",
      total: -ga,
      perUnit: -ga / Math.max(totalResidentialUnits, 1),
      perGsf: -ga / gsf,
      percentEgi: -ga / totalEgi
    },
    {
      name: "Management Fee",
      source: "Mgmt Fee",
      total: -mgmtFee,
      perUnit: -mgmtFee / Math.max(totalResidentialUnits, 1),
      perGsf: -mgmtFee / gsf,
      percentEgi: -mgmtFee / totalEgi
    },
    {
      name: "Reserves",
      source: "Reserves",
      total: -reserves,
      perUnit: -reserves / Math.max(totalResidentialUnits, 1),
      perGsf: -reserves / gsf,
      percentEgi: -reserves / totalEgi
    }
  ];

  const noiAbated = totalEgi - totalOpexAbated;
  const noiFull = totalEgi - totalOpexFull;

  // 4. Development Budget
  const landCost = lotArea * landCostSf;
  const baseHardCosts = gsf * hardCostGsf;
  const contingency = baseHardCosts * hardContingencyPct;
  const totalHardCosts = baseHardCosts + contingency;
  
  const softCosts = totalHardCosts * softCostPct;
  const financingCosts = (landCost + totalHardCosts) * financingCostPct;
  const carryCosts = (landCost + totalHardCosts) * carryInterestPct;

  const totalProjectCost = landCost + totalHardCosts + softCosts + financingCosts + carryCosts;
  
  const seniorLoan = evaluateFormula(a.seniorLoanFormula, { ProjectCost: totalProjectCost, LTC: ltc }) || (totalProjectCost * ltc);
  const sponsorEquity = totalProjectCost - seniorLoan;

  // 5. Valuation & Abatement Schedule
  const fullTaxValue = evaluateFormula(a.stabilizedValueFormula, { NOI: noiFull, CapRate: capRate }) || (noiFull / capRate);

  // Exemption Schedule
  const abatementSchedule = [];
  let currentTaxableAv = priorAv * 7.5;
  let currentTaxRate = 0.125;

  for (let year = 1; year <= 35; year++) {
    const isExemptPeriod = year <= 25;
    const exemptionPct = isExemptPeriod ? 1.0 : Math.max(1.0 - (year - 25) * 0.07, 0);
    
    const unabatedRet = currentTaxableAv * currentTaxRate;
    const landRet = priorAv * currentTaxRate;
    
    const increaseAv = Math.max(currentTaxableAv - priorAv, 0);
    const exemptAmount = increaseAv * exemptionPct;
    const abatedTaxableAv = currentTaxableAv - exemptAmount;
    
    const abatedRet = abatedTaxableAv * currentTaxRate;
    const savings = unabatedRet - abatedRet;

    abatementSchedule.push({
      year: year,
      startDate: `${2026 + year - 1}-07-01`,
      taxableAssessment: currentTaxableAv,
      priorAv: priorAv,
      increaseAv: increaseAv,
      percentExempt: exemptionPct,
      exemptionAmount: exemptAmount,
      exemptTaxableAssessment: abatedTaxableAv,
      taxRate: currentTaxRate,
      unabatedRet: unabatedRet,
      abatedRet: abatedRet,
      retSavings: savings
    });

    currentTaxableAv *= (1 + avGrowthRate);
    currentTaxRate += 0.000625;
  }

  // Calculate NPV of tax savings at discount rate
  let npv = 0;
  for (let i = 0; i < abatementSchedule.length; i++) {
    const s = abatementSchedule[i];
    npv += s.retSavings / Math.pow(1 + discountRate, s.year);
  }

  const totalStabilizedValue = fullTaxValue + npv;

  const budgetTotals = {
    totalAcquisition: landCost,
    totalHard: totalHardCosts,
    totalSoft: softCosts,
    totalFinancing: financingCosts,
    totalInterest: carryCosts,
    totalProject: totalProjectCost
  };

  const valuationSummary = {
    proformaNoiAbated: noiAbated,
    proformaNoiFullTax: noiFull,
    capRate: capRate,
    fullTaxValue: fullTaxValue,
    pvTaxSavings: npv,
    totalStabilizedValue: totalStabilizedValue,
    valueUnit: totalStabilizedValue / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
    valueGsf: totalStabilizedValue / gsf
  };

  const capitalization = {
    developmentCapitalization: totalProjectCost,
    constructionLoan: seniorLoan,
    debtUnit: seniorLoan / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
    debtGsf: seniorLoan / gsf,
    stabilizedLtv: seniorLoan / totalStabilizedValue,
    stabilizedDy: noiAbated / seniorLoan,
    stabilizedYoC: noiAbated / totalProjectCost
  };

  // Sources & Uses lists
  const sources = [
    {
      name: "Senior Loan",
      totalCost: seniorLoan,
      perZfa: seniorLoan / zfa,
      perGsf: seniorLoan / gsf,
      perUnit: seniorLoan / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: seniorLoan / totalProjectCost
    },
    {
      name: "Sponsor Equity",
      totalCost: sponsorEquity,
      perZfa: sponsorEquity / zfa,
      perGsf: sponsorEquity / gsf,
      perUnit: sponsorEquity / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: sponsorEquity / totalProjectCost
    },
    {
      name: "Total Sources:",
      totalCost: totalProjectCost,
      perZfa: totalProjectCost / zfa,
      perGsf: totalProjectCost / gsf,
      perUnit: totalProjectCost / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: 1.0
    }
  ];

  const uses = [
    {
      name: "Acquisition Costs",
      totalCost: landCost,
      perZfa: landCost / zfa,
      perGsf: landCost / gsf,
      perUnit: landCost / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: landCost / totalProjectCost
    },
    {
      name: "Hard Costs",
      totalCost: totalHardCosts,
      perZfa: totalHardCosts / zfa,
      perGsf: totalHardCosts / gsf,
      perUnit: totalHardCosts / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: totalHardCosts / totalProjectCost
    },
    {
      name: "Soft Costs",
      totalCost: softCosts,
      perZfa: softCosts / zfa,
      perGsf: softCosts / gsf,
      perUnit: softCosts / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: softCosts / totalProjectCost
    },
    {
      name: "Financing Costs",
      totalCost: financingCosts,
      perZfa: financingCosts / zfa,
      perGsf: financingCosts / gsf,
      perUnit: financingCosts / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: financingCosts / totalProjectCost
    },
    {
      name: "Interest/Carry Costs",
      totalCost: carryCosts,
      perZfa: carryCosts / zfa,
      perGsf: carryCosts / gsf,
      perUnit: carryCosts / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: carryCosts / totalProjectCost
    },
    {
      name: "Total Uses:",
      totalCost: totalProjectCost,
      perZfa: totalProjectCost / zfa,
      perGsf: totalProjectCost / gsf,
      perUnit: totalProjectCost / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      percent: 1.0
    }
  ];

  // Detailed Budget lists
  const acquisitionCosts = [
    { name: "Marked-Up Land Value", total: landCost, percent: landCost/totalProjectCost, perZfa: landCost/zfa, perGsf: landCost/gsf, perNsf: landCost/nsf, basis: "$/Lot SF", rate: landCostSf }
  ];
  
  const hardCostsList = [
    { name: "Demolition & Site Clearance", total: baseHardCosts * 0.02, percent: (baseHardCosts*0.02)/totalProjectCost, perZfa: (baseHardCosts*0.02)/zfa, perGsf: (baseHardCosts*0.02)/gsf, perNsf: (baseHardCosts*0.02)/nsf, basis: "% of Hard Costs Base", rate: 2.0 },
    { name: "Concrete & Superstructure", total: baseHardCosts * 0.22, percent: (baseHardCosts*0.22)/totalProjectCost, perZfa: (baseHardCosts*0.22)/zfa, perGsf: (baseHardCosts*0.22)/gsf, perNsf: (baseHardCosts*0.22)/nsf, basis: "% of Hard Costs Base", rate: 22.0 },
    { name: "HVAC & Mechanical Systems", total: baseHardCosts * 0.14, percent: (baseHardCosts*0.14)/totalProjectCost, perZfa: (baseHardCosts*0.14)/zfa, perGsf: (baseHardCosts*0.14)/gsf, perNsf: (baseHardCosts*0.14)/nsf, basis: "% of Hard Costs Base", rate: 14.0 },
    { name: "Electrical & Low Voltage Systems", total: baseHardCosts * 0.12, percent: (baseHardCosts*0.12)/totalProjectCost, perZfa: (baseHardCosts*0.12)/zfa, perGsf: (baseHardCosts*0.12)/gsf, perNsf: (baseHardCosts*0.12)/nsf, basis: "% of Hard Costs Base", rate: 12.0 },
    { name: "Plumbing, Sprinklers & Fire Safety", total: baseHardCosts * 0.10, percent: (baseHardCosts*0.10)/totalProjectCost, perZfa: (baseHardCosts*0.10)/zfa, perGsf: (baseHardCosts*0.10)/gsf, perNsf: (baseHardCosts*0.10)/nsf, basis: "% of Hard Costs Base", rate: 10.0 },
    { name: "Facade, Windows & Exterior Enclosure", total: baseHardCosts * 0.15, percent: (baseHardCosts*0.15)/totalProjectCost, perZfa: (baseHardCosts*0.15)/zfa, perGsf: (baseHardCosts*0.15)/gsf, perNsf: (baseHardCosts*0.15)/nsf, basis: "% of Hard Costs Base", rate: 15.0 },
    { name: "Drywall, Framing & Core Carpentry", total: baseHardCosts * 0.12, percent: (baseHardCosts*0.12)/totalProjectCost, perZfa: (baseHardCosts*0.12)/zfa, perGsf: (baseHardCosts*0.12)/gsf, perNsf: (baseHardCosts*0.12)/nsf, basis: "% of Hard Costs Base", rate: 12.0 },
    { name: "Interior Finishes, Appliances & Fixtures", total: baseHardCosts * 0.08, percent: (baseHardCosts*0.08)/totalProjectCost, perZfa: (baseHardCosts*0.08)/zfa, perGsf: (baseHardCosts*0.08)/gsf, perNsf: (baseHardCosts*0.08)/nsf, basis: "% of Hard Costs Base", rate: 8.0 },
    { name: "General Conditions & GC Fee", total: baseHardCosts * 0.05, percent: (baseHardCosts*0.05)/totalProjectCost, perZfa: (baseHardCosts*0.05)/zfa, perGsf: (baseHardCosts*0.05)/gsf, perNsf: (baseHardCosts*0.05)/nsf, basis: "% of Hard Costs Base", rate: 5.0 },
    { name: "CONTINGENCY", total: contingency, percent: contingency/totalProjectCost, perZfa: contingency/zfa, perGsf: contingency/gsf, perNsf: contingency/nsf, basis: "% of Hard Costs Base", rate: hardContingencyPct * 100 }
  ];
  
  const softCostsList = [
    { name: "Architectural & Engineering Fees", total: softCosts * 0.40, percent: (softCosts*0.40)/totalProjectCost, perZfa: (softCosts*0.40)/zfa, perGsf: (softCosts*0.40)/gsf, perNsf: (softCosts*0.40)/nsf, basis: "% of Soft Costs", rate: 40.0 },
    { name: "Environmental, Geotech & Expediting", total: softCosts * 0.15, percent: (softCosts*0.15)/totalProjectCost, perZfa: (softCosts*0.15)/zfa, perGsf: (softCosts*0.15)/gsf, perNsf: (softCosts*0.15)/nsf, basis: "% of Soft Costs", rate: 15.0 },
    { name: "Legal, Zoning, & Title Representation", total: softCosts * 0.15, percent: (softCosts*0.15)/totalProjectCost, perZfa: (softCosts*0.15)/zfa, perGsf: (softCosts*0.15)/gsf, perNsf: (softCosts*0.15)/nsf, basis: "% of Soft Costs", rate: 15.0 },
    { name: "Soft Cost Contingency & Misc Fees", total: softCosts * 0.30, percent: (softCosts*0.30)/totalProjectCost, perZfa: (softCosts*0.30)/zfa, perGsf: (softCosts*0.30)/gsf, perNsf: (softCosts*0.30)/nsf, basis: "% of Soft Costs", rate: 30.0 }
  ];
  
  const financingCostsList = [
    { name: "Mortgage Recording Tax (2.8%)", total: seniorLoan * 0.028, percent: (seniorLoan*0.028)/totalProjectCost, perZfa: (seniorLoan*0.028)/zfa, perGsf: (seniorLoan*0.028)/gsf, perNsf: (seniorLoan*0.028)/nsf, basis: "% of Senior Loan", rate: 2.8 },
    { name: "Title Insurance & Escrow Closing", total: totalProjectCost * 0.003, percent: (totalProjectCost*0.003)/totalProjectCost, perZfa: (totalProjectCost*0.003)/zfa, perGsf: (totalProjectCost*0.003)/gsf, perNsf: (totalProjectCost*0.003)/nsf, basis: "% of Project Cost", rate: 0.3 },
    { name: "Lender Origination Fee (1.0%)", total: seniorLoan * 0.01, percent: (seniorLoan*0.01)/totalProjectCost, perZfa: (seniorLoan*0.01)/zfa, perGsf: (seniorLoan*0.01)/gsf, perNsf: (seniorLoan*0.01)/nsf, basis: "% of Senior Loan", rate: 1.0 },
    { name: "Debt Placement Broker Fee (0.75%)", total: seniorLoan * 0.0075, percent: (seniorLoan*0.0075)/totalProjectCost, perZfa: (seniorLoan*0.0075)/zfa, perGsf: (seniorLoan*0.0075)/gsf, perNsf: (seniorLoan*0.0075)/nsf, basis: "% of Senior Loan", rate: 0.75 },
    { name: "Lender & Borrower Legal Representation", total: totalProjectCost * 0.002, percent: (totalProjectCost*0.002)/totalProjectCost, perZfa: (totalProjectCost*0.002)/zfa, perGsf: (totalProjectCost*0.002)/gsf, perNsf: (totalProjectCost*0.002)/nsf, basis: "% of Project Cost", rate: 0.2 }
  ];
  
  const interestCarryCostsList = [
    { name: "Construction Interest Reserve", total: carryCosts, percent: carryCosts/totalProjectCost, perZfa: carryCosts/zfa, perGsf: carryCosts/gsf, perNsf: carryCosts/nsf, basis: "% of Land + Hard", rate: carryInterestPct * 100 }
  ];

  // 6. Unit Mix Tables
  const unitsStudioFM = Math.ceil(fmUnits * studioPct);
  const units1BFM = Math.ceil(fmUnits * oneBedPct);
  const units2BFM = Math.max(fmUnits - unitsStudioFM - units1BFM, 0);

  // Rents: studio = rentStudio, 1B = rent1B, 2B = rent2B (pro-rate from average fmRentMo)
  const rentStudioFM = fmRentMo * parseFloat(a.fmStudioRatio);
  const rent1BFM = fmRentMo * parseFloat(a.fmOneBedRatio);
  const rent2BFM = fmRentMo * parseFloat(a.fmTwoBedRatio);

  const unitMixFM = [
    { bed: 0, units: unitsStudioFM, sqft: unitsStudioFM * 480, avgSqft: 480, rentMo: unitsStudioFM * rentStudioFM, rentYr: unitsStudioFM * rentStudioFM * 12, avgRentUnit: rentStudioFM, avgRentSqft: (rentStudioFM * 12) / 480 },
    { bed: 1, units: units1BFM, sqft: units1BFM * 625, avgSqft: 625, rentMo: units1BFM * rent1BFM, rentYr: units1BFM * rent1BFM * 12, avgRentUnit: rent1BFM, avgRentSqft: (rent1BFM * 12) / 625 },
    { bed: 2, units: units2BFM, sqft: units2BFM * 785, avgSqft: 785, rentMo: units2BFM * rent2BFM, rentYr: units2BFM * rent2BFM * 12, avgRentUnit: rent2BFM, avgRentSqft: (rent2BFM * 12) / 785 }
  ];

  const totalFMSqft = unitMixFM.reduce((acc, x) => acc + x.sqft, 0);
  const totalFMRentMo = unitMixFM.reduce((acc, x) => acc + x.rentMo, 0);
  const totalFMRentYr = unitMixFM.reduce((acc, x) => acc + x.rentYr, 0);

  const unitMixFMTotal = {
    units: fmUnits,
    sqft: totalFMSqft,
    avgSqft: totalFMSqft / Math.max(fmUnits, 1),
    rentMo: totalFMRentMo,
    rentYr: totalFMRentYr,
    avgRentUnit: totalFMRentMo / Math.max(fmUnits, 1),
    avgRentSqft: (totalFMRentYr) / Math.max(totalFMSqft, 1)
  };

  const unitsStudioHPD = Math.ceil(hpdUnits * studioPct);
  const units1BHPD = Math.ceil(hpdUnits * oneBedPct);
  const units2BHPD = Math.max(hpdUnits - unitsStudioHPD - units1BHPD, 0);

  const rentStudioHPD = hpdRentMo * parseFloat(a.hpdStudioRatio);
  const rent1BHPD = hpdRentMo * parseFloat(a.hpdOneBedRatio);
  const rent2BHPD = hpdRentMo * parseFloat(a.hpdTwoBedRatio);

  const unitMixHPD = [
    { bed: 0, units: unitsStudioHPD, sqft: unitsStudioHPD * 460, avgSqft: 460, rentMo: unitsStudioHPD * rentStudioHPD, rentYr: unitsStudioHPD * rentStudioHPD * 12, avgRentUnit: rentStudioHPD, avgRentSqft: (rentStudioHPD * 12) / 460 },
    { bed: 1, units: units1BHPD, sqft: units1BHPD * 625, avgSqft: 625, rentMo: units1BHPD * rent1BHPD, rentYr: units1BHPD * rent1BHPD * 12, avgRentUnit: rent1BHPD, avgRentSqft: (rent1BHPD * 12) / 625 },
    { bed: 2, units: units2BHPD, sqft: units2BHPD * 790, avgSqft: 790, rentMo: units2BHPD * rent2BHPD, rentYr: units2BHPD * rent2BHPD * 12, avgRentUnit: rent2BHPD, avgRentSqft: (rent2BHPD * 12) / 790 }
  ];

  const totalHPDSqft = unitMixHPD.reduce((acc, x) => acc + x.sqft, 0);
  const totalHPDRentMo = unitMixHPD.reduce((acc, x) => acc + x.rentMo, 0);
  const totalHPDRentYr = unitMixHPD.reduce((acc, x) => acc + x.rentYr, 0);

  const unitMixHPDTotal = {
    units: hpdUnits,
    sqft: totalHPDSqft,
    avgSqft: totalHPDSqft / Math.max(hpdUnits, 1),
    rentMo: totalHPDRentMo,
    rentYr: totalHPDRentYr,
    avgRentUnit: totalHPDRentMo / Math.max(hpdUnits, 1),
    avgRentSqft: (totalHPDRentYr) / Math.max(totalHPDSqft, 1)
  };

  const totalUnits = fmUnits + hpdUnits;
  const totalSqft = totalFMSqft + totalHPDSqft;
  const totalRentMo = totalFMRentMo + totalHPDRentMo;
  const totalRentYr = totalFMRentYr + totalHPDRentYr;

  const unitMixTotal = [
    { bed: 0, units: unitsStudioFM + unitsStudioHPD, sqft: (unitsStudioFM * 480) + (unitsStudioHPD * 460), avgSqft: ((unitsStudioFM * 480) + (unitsStudioHPD * 460)) / Math.max(unitsStudioFM + unitsStudioHPD, 1), rentMo: (unitsStudioFM * rentStudioFM) + (unitsStudioHPD * rentStudioHPD), rentYr: ((unitsStudioFM * rentStudioFM) + (unitsStudioHPD * rentStudioHPD)) * 12, avgRentUnit: ((unitsStudioFM * rentStudioFM) + (unitsStudioHPD * rentStudioHPD)) / Math.max(unitsStudioFM + unitsStudioHPD, 1), avgRentSqft: (((unitsStudioFM * rentStudioFM) + (unitsStudioHPD * rentStudioHPD)) * 12) / Math.max((unitsStudioFM * 480) + (unitsStudioHPD * 460), 1) },
    { bed: 1, units: units1BFM + units1BHPD, sqft: (units1BFM * 625) + (units1BHPD * 625), avgSqft: 625, rentMo: (units1BFM * rent1BFM) + (units1BHPD * rent1BHPD), rentYr: ((units1BFM * rent1BFM) + (units1BHPD * rent1BHPD)) * 12, avgRentUnit: ((units1BFM * rent1BFM) + (units1BHPD * rent1BHPD)) / Math.max(units1BFM + units1BHPD, 1), avgRentSqft: (((units1BFM * rent1BFM) + (units1BHPD * rent1BHPD)) * 12) / Math.max((units1BFM * 625) + (units1BHPD * 625), 1) },
    { bed: 2, units: units2BFM + units2BHPD, sqft: (units2BFM * 785) + (units2BHPD * 790), avgSqft: ((units2BFM * 785) + (units2BHPD * 790)) / Math.max(units2BFM + units2BHPD, 1), rentMo: (units2BFM * rent2BFM) + (units2BHPD * rent2BHPD), rentYr: ((units2BFM * rent2BFM) + (units2BHPD * rent2BHPD)) * 12, avgRentUnit: ((units2BFM * rent2BFM) + (units2BHPD * rent2BFM)) / Math.max(units2BFM + units2BHPD, 1), avgRentSqft: (((units2BFM * rent2BFM) + (units2BHPD * rent2BHPD)) * 12) / Math.max((units2BFM * 785) + (units2BHPD * 790), 1) }
  ];

  const unitMixTotalTotal = {
    units: totalUnits,
    sqft: totalSqft,
    avgSqft: totalSqft / Math.max(totalUnits, 1),
    rentMo: totalRentMo,
    rentYr: totalRentYr,
    avgRentUnit: totalRentMo / Math.max(totalUnits, 1),
    avgRentSqft: totalRentYr / Math.max(totalSqft, 1)
  };

  const unitMixComm = [];
  if (totalCommercialSf > 0) {
    if (isMfg) {
      unitMixComm.push({ unit: "Industrial Flex", sqft: totalCommercialSf, rentMo: commRentYr / 12, rentYr: commRentYr, rentSqft: commRentSf });
    } else if (isComm) {
      const officeSf = totalCommercialSf * 0.60;
      const retailSf = totalCommercialSf - officeSf;
      unitMixComm.push({ unit: "Anchor Retail", sqft: retailSf, rentMo: (retailSf * commRentSf) / 12, rentYr: retailSf * commRentSf, rentSqft: commRentSf });
      unitMixComm.push({ unit: "Office space", sqft: officeSf, rentMo: (officeSf * (commRentSf * 0.75)) / 12, rentYr: officeSf * (commRentSf * 0.75), rentSqft: commRentSf * 0.75 });
    } else {
      unitMixComm.push({ unit: "Corner Retail", sqft: totalCommercialSf, rentMo: commRentYr / 12, rentYr: commRentYr, rentSqft: commRentSf });
    }
  }

  const totalCommSqft = unitMixComm.reduce((acc, x) => acc + x.sqft, 0);
  const totalCommRentMo = unitMixComm.reduce((acc, x) => acc + x.rentMo, 0);
  const totalCommRentYr = unitMixComm.reduce((acc, x) => acc + x.rentYr, 0);

  const unitMixCommTotal = {
    sqft: totalCommSqft,
    rentMo: totalCommRentMo,
    rentYr: totalCommRentYr,
    rentSqft: totalCommSqft > 0 ? totalCommRentYr / totalCommSqft : 0
  };

  return {
    isEstimate: true,
    projectInfo: {
      projectName: `Project ${address.split(',')[0]}`,
      address: address,
      submarket: zoningRules.district && zoningRules.district.includes('R') ? "Residential Submarket" : "Commercial Submarket",
      sponsor: "AI Estimated Proforma",
      blockLot: bbl ? `${bbl.substring(1, 6)} / ${bbl.substring(6, 10)}` : "Estimated",
      lotArea: lotArea,
      far: far,
      zfa: zfa,
      gsf: gsf,
      nsf: nsf,
      totalResidentialUnits: totalResidentialUnits,
      totalResidentialSf: totalResidentialSf,
      totalCommercialUnits: totalCommercialUnits,
      totalCommercialSf: totalCommercialSf
    },
    valuationSummary,
    capitalization,
    sources,
    uses,
    revenues,
    effectiveGrossIncome: {
      total: totalEgi,
      perUnit: totalEgi / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      perGsf: totalEgi / gsf,
      percentEgi: 1.0
    },
    expenses,
    totalExpenses: {
      total: -totalOpexAbated,
      perUnit: -totalOpexAbated / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      perGsf: -totalOpexAbated / gsf,
      percentEgi: -totalOpexAbated / totalEgi
    },
    netOperatingIncome: {
      total: noiAbated,
      perUnit: noiAbated / Math.max(totalResidentialUnits || totalCommercialUnits, 1),
      perGsf: noiAbated / gsf,
      percentEgi: noiAbated / totalEgi
    },
    unitMixFM,
    unitMixFMTotal,
    unitMixHPD,
    unitMixHPDTotal,
    unitMixTotal,
    unitMixTotalTotal,
    unitMixComm,
    unitMixCommTotal,
    acquisitionCosts,
    hardCosts: hardCostsList,
    softCosts: softCostsList,
    financingCosts: financingCostsList,
    interestCarryCosts: interestCarryCostsList,
    budgetTotals,
    abatementNPV: npv,
    abatementSchedule,
    abatementSummary: {
      ...a,
      discountRate: discountRate,
      priorAv: priorAv
    }
  };
}

export function recalculateUnderwriting(fData) {
  if (!fData) return;

  const far = parseFloat(fData.projectInfo.far) || 1.0;
  const lotArea = parseFloat(fData.projectInfo.lotArea) || 0;
  const zfa = lotArea * far;

  const as = fData.abatementSummary || {};
  const ltc = parseParam(as.ltc, fData.capitalization.ltc || 0.71);
  const capRate = parseParam(as.capRate, fData.valuationSummary.capRate || 0.0575);
  const discountRate = parseParam(as.discountRate, 0.03);
  const hardCostGsf = parseParam(as.hardCostGsf, 0);


  // Re-evaluate GSF and NSF if formulas exist
  if (as.gsfFormula) {
    const newGsf = evaluateFormula(as.gsfFormula, { ZFA: zfa, LotArea: lotArea, FAR: far });
    if (!isNaN(newGsf) && newGsf > 0) {
      fData.projectInfo.gsf = newGsf;
    }
  }
  const gsf = parseFloat(fData.projectInfo.gsf) || 1;

  if (as.nsfFormula) {
    const newNsf = evaluateFormula(as.nsfFormula, { GSF: gsf, ZFA: zfa, LotArea: lotArea, FAR: far });
    if (!isNaN(newNsf) && newNsf > 0) {
      fData.projectInfo.nsf = newNsf;
    }
  }
  const nsf = parseFloat(fData.projectInfo.nsf) || 1;

  // 1. FM Unit Mix Recalculations
  if (fData.unitMixFM && fData.unitMixFM.length > 0) {
    fData.unitMixFM.forEach(item => {
      item.units = parseFloat(item.units) || 0;
      item.avgSqft = parseFloat(item.avgSqft) || 0;
      item.avgRentUnit = parseFloat(item.avgRentUnit) || 0;

      item.sqft = item.units * item.avgSqft;
      item.rentMo = item.units * item.avgRentUnit;
      item.rentYr = item.rentMo * 12;
      item.avgRentSqft = item.sqft > 0 ? (item.rentYr) / item.sqft : 0;
    });

    const fmUnits = fData.unitMixFM.reduce((acc, x) => acc + x.units, 0);
    const fmSqft = fData.unitMixFM.reduce((acc, x) => acc + x.sqft, 0);
    const fmRentMo = fData.unitMixFM.reduce((acc, x) => acc + x.rentMo, 0);
    const fmRentYr = fData.unitMixFM.reduce((acc, x) => acc + x.rentYr, 0);

    fData.unitMixFMTotal = {
      units: fmUnits,
      sqft: fmSqft,
      avgSqft: fmUnits > 0 ? fmSqft / fmUnits : 0,
      rentMo: fmRentMo,
      rentYr: fmRentYr,
      avgRentUnit: fmUnits > 0 ? fmRentMo / fmUnits : 0,
      avgRentSqft: fmSqft > 0 ? fmRentYr / fmSqft : 0
    };
  }

  // 2. HPD Unit Mix Recalculations
  if (fData.unitMixHPD && fData.unitMixHPD.length > 0) {
    fData.unitMixHPD.forEach(item => {
      item.units = parseFloat(item.units) || 0;
      item.avgSqft = parseFloat(item.avgSqft) || 0;
      item.avgRentUnit = parseFloat(item.avgRentUnit) || 0;

      item.sqft = item.units * item.avgSqft;
      item.rentMo = item.units * item.avgRentUnit;
      item.rentYr = item.rentMo * 12;
      item.avgRentSqft = item.sqft > 0 ? (item.rentYr) / item.sqft : 0;
    });

    const hpdUnits = fData.unitMixHPD.reduce((acc, x) => acc + x.units, 0);
    const hpdSqft = fData.unitMixHPD.reduce((acc, x) => acc + x.sqft, 0);
    const hpdRentMo = fData.unitMixHPD.reduce((acc, x) => acc + x.rentMo, 0);
    const hpdRentYr = fData.unitMixHPD.reduce((acc, x) => acc + x.rentYr, 0);

    fData.unitMixHPDTotal = {
      units: hpdUnits,
      sqft: hpdSqft,
      avgSqft: hpdUnits > 0 ? hpdSqft / hpdUnits : 0,
      rentMo: hpdRentMo,
      rentYr: hpdRentYr,
      avgRentUnit: hpdUnits > 0 ? hpdRentMo / hpdUnits : 0,
      avgRentSqft: hpdSqft > 0 ? hpdRentYr / hpdSqft : 0
    };
  }

  // 3. Combined Unit Mix (FM + HPD) Recalculations
  if (fData.unitMixTotal && fData.unitMixTotal.length > 0) {
    fData.unitMixTotal.forEach(item => {
      const bed = item.bed;
      const fmItem = fData.unitMixFM.find(x => x.bed === bed) || { units: 0, sqft: 0, rentMo: 0, rentYr: 0 };
      const hpdItem = (fData.unitMixHPD || []).find(x => x.bed === bed) || { units: 0, sqft: 0, rentMo: 0, rentYr: 0 };

      item.units = fmItem.units + hpdItem.units;
      item.sqft = fmItem.sqft + hpdItem.sqft;
      item.rentMo = fmItem.rentMo + hpdItem.rentMo;
      item.rentYr = fmItem.rentYr + hpdItem.rentYr;
      item.avgSqft = item.units > 0 ? item.sqft / item.units : 0;
      item.avgRentUnit = item.units > 0 ? item.rentMo / item.units : 0;
      item.avgRentSqft = item.sqft > 0 ? item.rentYr / item.sqft : 0;
    });

    const totUnits = fData.unitMixTotal.reduce((acc, x) => acc + x.units, 0);
    const totSqft = fData.unitMixTotal.reduce((acc, x) => acc + x.sqft, 0);
    const totRentMo = fData.unitMixTotal.reduce((acc, x) => acc + x.rentMo, 0);
    const totRentYr = fData.unitMixTotal.reduce((acc, x) => acc + x.rentYr, 0);

    fData.unitMixTotalTotal = {
      units: totUnits,
      sqft: totSqft,
      avgSqft: totUnits > 0 ? totSqft / totUnits : 0,
      rentMo: totRentMo,
      rentYr: totRentYr,
      avgRentUnit: totUnits > 0 ? totRentMo / totUnits : 0,
      avgRentSqft: totSqft > 0 ? totRentYr / totSqft : 0
    };
    fData.projectInfo.totalResidentialUnits = totUnits;
    fData.projectInfo.totalResidentialSf = totSqft;
  }

  // 4. Commercial Rent Roll Recalculations
  if (fData.unitMixComm && fData.unitMixComm.length > 0) {
    fData.unitMixComm.forEach(item => {
      item.sqft = parseFloat(item.sqft) || 0;
      item.rentSqft = parseFloat(item.rentSqft) || 0;
      item.rentYr = item.sqft * item.rentSqft;
      item.rentMo = item.rentYr / 12;
    });

    const commSqft = fData.unitMixComm.reduce((acc, x) => acc + x.sqft, 0);
    const commRentMo = fData.unitMixComm.reduce((acc, x) => acc + x.rentMo, 0);
    const commRentYr = fData.unitMixComm.reduce((acc, x) => acc + x.rentYr, 0);

    fData.unitMixCommTotal = {
      sqft: commSqft,
      rentMo: commRentMo,
      rentYr: commRentYr,
      rentSqft: commSqft > 0 ? commRentYr / commSqft : 0
    };
    fData.projectInfo.totalCommercialSf = commSqft;
  }

  // Determine residential units and commercial units for per-unit metrics
  const resUnits = fData.unitMixTotalTotal ? fData.unitMixTotalTotal.units : 0;
  const commUnits = fData.unitMixComm ? fData.unitMixComm.length : 0;
  const totalUnits = resUnits || commUnits || 1;

  // 5. Revenues & EGI
  const fmVacancy = parseParam(as.fmVacancy, 0.05);
  const hpdVacancy = parseParam(as.hpdVacancy, 0.02);
  const commVacancy = parseParam(as.commVacancy, 0.07);

  const rentFMYr = fData.unitMixFMTotal ? fData.unitMixFMTotal.rentYr : 0;
  const rentHPDYr = fData.unitMixHPDTotal ? fData.unitMixHPDTotal.rentYr : 0;
  const commRentYr = fData.unitMixCommTotal ? fData.unitMixCommTotal.rentYr : 0;

  const resEgi = (rentFMYr * (1 - fmVacancy)) + (rentHPDYr * (1 - hpdVacancy));
  const commEgi = commRentYr * (1 - commVacancy);
  const totalEgi = resEgi + commEgi;

  if (fData.revenues) {
    fData.revenues.forEach(r => {
      if (r.name.includes("Residential Income (FM)")) {
        r.total = rentFMYr;
      } else if (r.name.includes("Vacancy & Credit Loss (FM)")) {
        r.total = -rentFMYr * fmVacancy;
      } else if (r.name.includes("Residential Income (HPD")) {
        r.total = rentHPDYr;
      } else if (r.name.includes("Vacancy & Credit Loss (HPD")) {
        r.total = -rentHPDYr * hpdVacancy;
      } else if (r.name.includes("Commercial Income") || r.name.includes("Industrial Income")) {
        r.total = commRentYr;
      } else if (r.name.includes("Vacancy & Credit Loss (Commercial)")) {
        r.total = -commRentYr * commVacancy;
      }

      // Recompute metrics
      r.percentEgi = totalEgi > 0 ? r.total / totalEgi : 0;
      r.perGsf = r.total / gsf;
      if (r.name.includes("FM")) {
        r.perUnit = r.total / Math.max(fData.unitMixFMTotal ? fData.unitMixFMTotal.units : 1, 1);
      } else if (r.name.includes("HPD")) {
        r.perUnit = r.total / Math.max(fData.unitMixHPDTotal ? fData.unitMixHPDTotal.units : 1, 1);
      } else {
        r.perUnit = r.total / totalUnits;
      }
    });
  }

  fData.effectiveGrossIncome = {
    total: totalEgi,
    perUnit: totalEgi / totalUnits,
    perGsf: totalEgi / gsf,
    percentEgi: 1.0
  };
  // 6. Development Budget Recalculations
  const sumList = (list) => (list || []).reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

  // Land Cost
  const landCostSf = parseFloat(as.landCostSf);
  if (!isNaN(landCostSf) && fData.acquisitionCosts && fData.acquisitionCosts[0] && fData.acquisitionCosts[0].basis !== 'Manual') {
    fData.acquisitionCosts[0].total = lotArea * landCostSf;
    fData.acquisitionCosts[0].rate = landCostSf;
  }
  const landCost = (fData.acquisitionCosts && fData.acquisitionCosts[0]) ? parseFloat(fData.acquisitionCosts[0].total) || 0 : 0;

  // Base Hard Costs
  const baseHardCosts = gsf * hardCostGsf;
  const hardContingencyPct = parseFloat(as.hardContingencyPct) || 0;
  
  // Set up context
  const context = {
    lotArea,
    gsf,
    zfa,
    baseHardCosts,
    landCost,
    totalHardCosts: baseHardCosts * (1 + hardContingencyPct),
    totalSoft: baseHardCosts * (1 + hardContingencyPct) * (parseFloat(as.softCostPct) || 0.11),
    seniorLoan: (landCost + baseHardCosts * (1 + hardContingencyPct) * 1.2) * ltc,
    totalProject: landCost + baseHardCosts * (1 + hardContingencyPct) * 1.25
  };

  const evaluateBudgetList = (list) => {
    if (!list) return;
    list.forEach(item => {
      const basis = item.basis || "Manual";
      const rate = parseFloat(item.rate) || 0;
      
      switch (basis) {
        case "Manual":
          item.total = parseFloat(item.total) || 0;
          break;
        case "% of Hard Costs Base":
        case "% of Hard Costs":
          item.total = (rate / 100) * context.baseHardCosts;
          break;
        case "% of Hard Costs Total":
          item.total = (rate / 100) * context.totalHardCosts;
          break;
        case "% of Soft Costs":
          item.total = (rate / 100) * context.totalSoft;
          break;
        case "% of Senior Loan":
          item.total = (rate / 100) * context.seniorLoan;
          break;
        case "% of Project Cost":
          item.total = (rate / 100) * context.totalProject;
          break;
        case "% of Land + Hard":
          item.total = (rate / 100) * (context.landCost + context.totalHardCosts);
          break;
        case "$/Lot SF":
          item.total = rate * context.lotArea;
          break;
        case "$/GSF":
          item.total = rate * context.gsf;
          break;
        case "$/ZFA":
          item.total = rate * context.zfa;
          break;
      }
    });
  };

  // Pass 1:
  evaluateBudgetList(fData.acquisitionCosts);
  const totalAcq1 = sumList(fData.acquisitionCosts);
  context.landCost = totalAcq1;

  evaluateBudgetList(fData.hardCosts);
  const totalHard1 = sumList(fData.hardCosts);
  context.totalHardCosts = totalHard1;

  evaluateBudgetList(fData.softCosts);
  const totalSoft1 = sumList(fData.softCosts);
  context.totalSoft = totalSoft1;

  const estProjectCost = totalAcq1 + totalHard1 + totalSoft1;
  context.totalProject = estProjectCost * 1.15;
  context.seniorLoan = context.totalProject * ltc;

  evaluateBudgetList(fData.financingCosts);
  evaluateBudgetList(fData.interestCarryCosts);

  // Pass 2:
  const totalFin1 = sumList(fData.financingCosts);
  const totalInt1 = sumList(fData.interestCarryCosts);
  const totalProj1 = totalAcq1 + totalHard1 + totalSoft1 + totalFin1 + totalInt1;
  context.totalProject = totalProj1;

  let seniorLoanEval = totalProj1 * ltc;
  if (as.seniorLoanFormula) {
    const calculatedLoan = evaluateFormula(as.seniorLoanFormula, { ProjectCost: totalProj1, LTC: ltc });
    if (!isNaN(calculatedLoan)) {
      seniorLoanEval = calculatedLoan;
    }
  }
  context.seniorLoan = seniorLoanEval;

  evaluateBudgetList(fData.financingCosts);
  evaluateBudgetList(fData.interestCarryCosts);

  const totalAcquisition = sumList(fData.acquisitionCosts);
  const totalHard = sumList(fData.hardCosts);
  const totalSoft = sumList(fData.softCosts);
  const totalFinancing = sumList(fData.financingCosts);
  const totalInterest = sumList(fData.interestCarryCosts);
  const totalProject = totalAcquisition + totalHard + totalSoft + totalFinancing + totalInterest;

  fData.budgetTotals = {
    totalAcquisition,
    totalHard,
    totalSoft,
    totalFinancing,
    totalInterest,
    totalProject
  };

  const updateListMetrics = (list) => {
    (list || []).forEach(item => {
      item.total = parseFloat(item.total) || 0;
      item.perZfa = item.total / zfa;
      item.perGsf = item.total / gsf;
      item.percent = totalProject > 0 ? item.total / totalProject : 0;
    });
  };

  updateListMetrics(fData.acquisitionCosts);
  updateListMetrics(fData.hardCosts);
  updateListMetrics(fData.softCosts);
  updateListMetrics(fData.financingCosts);
  updateListMetrics(fData.interestCarryCosts);

  // 7. Capitalization & Debt Recalculations (Loan / Equity)


  // Re-evaluate Senior Loan from formula or defaults
  let seniorLoan = totalProject * ltc;
  if (as.seniorLoanFormula) {
    const calculatedLoan = evaluateFormula(as.seniorLoanFormula, { ProjectCost: totalProject, LTC: ltc });
    if (!isNaN(calculatedLoan)) {
      seniorLoan = calculatedLoan;
    }
  }
  const sponsorEquity = totalProject - seniorLoan;

  fData.capitalization.developmentCapitalization = totalProject;
  fData.capitalization.constructionLoan = seniorLoan;
  fData.capitalization.debtUnit = seniorLoan / totalUnits;
  fData.capitalization.debtGsf = seniorLoan / gsf;
  fData.capitalization.ltc = ltc;

  // Update sources array
  if (fData.sources) {
    fData.sources.forEach(s => {
      if (s.name.includes("Senior Loan")) {
        s.totalCost = seniorLoan;
      } else if (s.name.includes("Sponsor Equity")) {
        s.totalCost = sponsorEquity;
      } else if (s.name.includes("Total Sources")) {
        s.totalCost = totalProject;
      }
      s.perZfa = s.totalCost / zfa;
      s.perGsf = s.totalCost / gsf;
      s.perUnit = s.totalCost / totalUnits;
      s.percent = totalProject > 0 ? s.totalCost / totalProject : 0;
    });
  }

  // Update uses array
  if (fData.uses) {
    fData.uses.forEach(u => {
      if (u.name.includes("Acquisition Costs")) {
        u.totalCost = totalAcquisition;
      } else if (u.name.includes("Hard Costs")) {
        u.totalCost = totalHard;
      } else if (u.name.includes("Soft Costs")) {
        u.totalCost = totalSoft;
      } else if (u.name.includes("Financing Costs")) {
        u.totalCost = totalFinancing;
      } else if (u.name.includes("Interest/Carry Costs")) {
        u.totalCost = totalInterest;
      } else if (u.name.includes("Total Uses")) {
        u.totalCost = totalProject;
      }
      u.perZfa = u.totalCost / zfa;
      u.perGsf = u.totalCost / gsf;
      u.perUnit = u.totalCost / totalUnits;
      u.percent = totalProject > 0 ? u.totalCost / totalProject : 0;
    });
  }

  // 8. 421(a) Tax Abatement Schedule Recalculation
  const priorAv = parseParam(as.priorAv, 2089010);
  const avGrowthRate = parseParam(as.avGrowthRate, 0.02);
  const taxRateGrowth = parseParam(as.taxRateGrowth, 0.005);

  const startAv = (fData.abatementSchedule && fData.abatementSchedule[0]) ? fData.abatementSchedule[0].taxableAssessment : (priorAv * 7.6435);
  const startTaxRate = (fData.abatementSchedule && fData.abatementSchedule[0]) ? fData.abatementSchedule[0].taxRate : 0.125;

  const newSchedule = [];
  let currentTaxableAvIter = startAv;
  let currentTaxRateIter = startTaxRate;
  let npv = 0;

  const numYears = fData.abatementSchedule ? fData.abatementSchedule.length : 35;

  for (let y = 1; y <= numYears; y++) {
    const isExemptPeriod = y <= 25;
    const exemptionPct = isExemptPeriod ? 1.0 : Math.max(1.0 - (y - 25) * 0.07, 0);

    const unabatedRet = currentTaxableAvIter * currentTaxRateIter;
    const landRet = priorAv * currentTaxRateIter;

    const increaseAv = Math.max(currentTaxableAvIter - priorAv, 0);
    const exemptAmount = increaseAv * exemptionPct;
    const abatedTaxableAv = currentTaxableAvIter - exemptAmount;

    const abatedRet = abatedTaxableAv * currentTaxRateIter;
    const savings = unabatedRet - abatedRet;

    newSchedule.push({
      year: y,
      startDate: `${2026 + y - 1}-07-01`,
      taxableAssessment: currentTaxableAvIter,
      priorAv: priorAv,
      increaseAv: increaseAv,
      percentExempt: exemptionPct,
      exemptionAmount: exemptAmount,
      exemptTaxableAssessment: abatedTaxableAv,
      taxRate: currentTaxRateIter,
      unabatedRet: unabatedRet,
      abatedRet: abatedRet,
      retSavings: savings
    });

    npv += savings / Math.pow(1 + discountRate, y);

    currentTaxableAvIter *= (1 + avGrowthRate);
    currentTaxRateIter *= (1 + taxRateGrowth);
  }

  fData.abatementSchedule = newSchedule;
  fData.abatementNPV = npv;

  // 9. Operating Expenses & NOI Recalculations
  const unabatedTaxPct = parseParam(as.unabatedTaxPct, 0.215);
  const unabatedTaxes = totalEgi * unabatedTaxPct;
  const taxSavings = newSchedule[0] ? newSchedule[0].retSavings : 0;

  if (fData.expenses) {
    fData.expenses.forEach(e => {
      if (e.name === "Real Estate Taxes") {
        e.total = -unabatedTaxes;
      } else if (e.name === "Real Estate Taxes Savings") {
        e.total = taxSavings;
      } else if (e.name === "Management Fee") {
        const mgmtFeePct = parseParam(as.mgmtFeePct, 0.03);
        e.total = -totalEgi * mgmtFeePct;
      } else {
        e.total = parseFloat(e.total) || 0;
      }
      e.perUnit = e.total / totalUnits;
      e.perGsf = e.total / gsf;
      e.percentEgi = totalEgi > 0 ? e.total / totalEgi : 0;
    });
  }

  const totalExpensesAbated = fData.expenses.reduce((sum, item) => sum + item.total, 0);
  fData.totalExpenses.total = totalExpensesAbated;
  fData.totalExpenses.perUnit = totalExpensesAbated / totalUnits;
  fData.totalExpenses.perGsf = totalExpensesAbated / gsf;
  fData.totalExpenses.percentEgi = totalEgi > 0 ? totalExpensesAbated / totalEgi : 0;

  const noiAbated = totalEgi + totalExpensesAbated; // expenses are negative
  fData.netOperatingIncome.total = noiAbated;
  fData.netOperatingIncome.perUnit = noiAbated / totalUnits;
  fData.netOperatingIncome.perGsf = noiAbated / gsf;
  fData.netOperatingIncome.percentEgi = totalEgi > 0 ? noiAbated / totalEgi : 0;

  const totalOpexFull = totalExpensesAbated - taxSavings;
  const noiFull = totalEgi + totalOpexFull;

  // 10. Valuation Summary Recalculations
  let fullTaxValue = noiFull / capRate;
  if (as.stabilizedValueFormula) {
    const calculatedValue = evaluateFormula(as.stabilizedValueFormula, { NOI: noiFull, CapRate: capRate });
    if (!isNaN(calculatedValue)) {
      fullTaxValue = calculatedValue;
    }
  }
  const totalStabilizedValue = fullTaxValue + npv;

  fData.valuationSummary.proformaNoiAbated = noiAbated;
  fData.valuationSummary.proformaNoiFullTax = noiFull;
  fData.valuationSummary.capRate = capRate;
  fData.valuationSummary.fullTaxValue = fullTaxValue;
  fData.valuationSummary.pvTaxSavings = npv;
  fData.valuationSummary.totalStabilizedValue = totalStabilizedValue;
  fData.valuationSummary.valueUnit = totalStabilizedValue / totalUnits;
  fData.valuationSummary.valueGsf = totalStabilizedValue / gsf;

  // Stabilized capitalization ratios
  fData.capitalization.stabilizedLtv = totalStabilizedValue > 0 ? seniorLoan / totalStabilizedValue : 0;
  fData.capitalization.stabilizedDy = seniorLoan > 0 ? noiAbated / seniorLoan : 0;
  fData.capitalization.stabilizedYoC = totalProject > 0 ? noiAbated / totalProject : 0;

  // Sync abatementSummary
  if (fData.abatementSummary) {
    fData.abatementSummary.totalEgi = totalEgi;
    fData.abatementSummary.totalTax = unabatedTaxes;
    fData.abatementSummary.priorAv = priorAv;
    fData.abatementSummary.avGrowthRate = avGrowthRate;
    fData.abatementSummary.taxRateGrowth = taxRateGrowth;
    fData.abatementSummary.discountRate = discountRate;
    fData.abatementSummary.fmVacancy = fmVacancy;
    fData.abatementSummary.hpdVacancy = hpdVacancy;
    fData.abatementSummary.commVacancy = commVacancy;
    fData.abatementSummary.unabatedTaxPct = unabatedTaxPct;
    fData.abatementSummary.ltc = ltc;
    fData.abatementSummary.capRate = capRate;
  }
}

