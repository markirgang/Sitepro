/**
 * NYC Zoning Rules Engine & Calculations
 */

// Base reference mappings for standard NYC Zoning Districts
const BASE_DISTRICT_RULES = {
  // Residential Districts
  R1: { resFar: 0.50, commFar: 0, facilFar: 1.00, mfgFar: 0, contextual: false, baseHeight: 30, maxBuildingHeight: 35 },
  R2: { resFar: 0.50, commFar: 0, facilFar: 1.00, mfgFar: 0, contextual: false, baseHeight: 30, maxBuildingHeight: 35 },
  R3: { resFar: 0.60, commFar: 0, facilFar: 1.00, mfgFar: 0, contextual: false, baseHeight: 40, maxBuildingHeight: 35 },
  R4: { resFar: 0.75, commFar: 0, facilFar: 2.00, mfgFar: 0, contextual: false, baseHeight: 45, maxBuildingHeight: 35 },
  R5: { resFar: 1.25, commFar: 0, facilFar: 2.00, mfgFar: 0, contextual: false, baseHeight: 40, maxBuildingHeight: 40 },
  R6: { resFar: 2.43, commFar: 0, facilFar: 4.80, mfgFar: 0, contextual: false, baseHeight: 60, maxBuildingHeight: 110 },
  R7: { resFar: 3.44, commFar: 0, facilFar: 6.50, mfgFar: 0, contextual: false, baseHeight: 60, maxBuildingHeight: 135 },
  R8: { resFar: 6.02, commFar: 0, facilFar: 6.50, mfgFar: 0, contextual: false, baseHeight: 85, maxBuildingHeight: 185 },
  R9: { resFar: 8.00, commFar: 0, facilFar: 10.00, mfgFar: 0, contextual: false, baseHeight: 85, maxBuildingHeight: 225 },
  R10: { resFar: 10.00, commFar: 0, facilFar: 10.00, mfgFar: 0, contextual: false, baseHeight: 125, maxBuildingHeight: 350, ihFar: 12.0 },

  // Commercial Districts (Typical values for various sub-districts)
  C1: { resFar: 1.00, commFar: 1.00, facilFar: 2.00, mfgFar: 0, overlay: true },
  C2: { resFar: 1.00, commFar: 2.00, facilFar: 2.00, mfgFar: 0, overlay: true },
  C3: { resFar: 0.50, commFar: 0.50, facilFar: 1.00, mfgFar: 0, contextual: false, baseHeight: 30 },
  C4: { resFar: 3.44, commFar: 3.40, facilFar: 6.50, mfgFar: 0, contextual: false, baseHeight: 60 },
  C5: { resFar: 10.00, commFar: 15.00, facilFar: 15.00, mfgFar: 0, contextual: false, baseHeight: 125, ihFar: 12.0 },
  C6: { resFar: 10.00, commFar: 10.00, facilFar: 10.00, mfgFar: 0, contextual: false, baseHeight: 85, ihFar: 12.0 },
  C7: { resFar: 0.00, commFar: 2.00, facilFar: 0.00, mfgFar: 0, contextual: false, baseHeight: 60 },
  C8: { resFar: 0.00, commFar: 2.00, facilFar: 2.00, mfgFar: 0, contextual: false, baseHeight: 60 },

  // Manufacturing Districts
  M1: { resFar: 0.00, commFar: 2.00, facilFar: 2.40, mfgFar: 1.00, contextual: false, baseHeight: 60 },
  M2: { resFar: 0.00, commFar: 2.00, facilFar: 0.00, mfgFar: 2.00, contextual: false, baseHeight: 60 },
  M3: { resFar: 0.00, commFar: 2.00, facilFar: 0.00, mfgFar: 2.00, contextual: false, baseHeight: 60 }
};

// Sub-district overrides based on exact matches (e.g. C4-1 vs C4-7)
const EXACT_DISTRICT_OVERRIDES = {
  "C4-1": { resFar: 1.25, commFar: 1.00, facilFar: 2.00, baseHeight: 30 },
  "C4-2": { resFar: 2.43, commFar: 3.40, facilFar: 4.80, baseHeight: 60 },
  "C4-3": { resFar: 2.43, commFar: 3.40, facilFar: 4.80, baseHeight: 60 },
  "C4-4": { resFar: 3.44, commFar: 3.40, facilFar: 6.50, baseHeight: 60 },
  "C4-5": { resFar: 3.44, commFar: 3.40, facilFar: 6.50, baseHeight: 60 },
  "C4-6": { resFar: 10.00, commFar: 3.40, facilFar: 10.00, baseHeight: 85 },
  "C4-7": { resFar: 10.00, commFar: 10.00, facilFar: 10.00, baseHeight: 125 },
  
  "C5-1": { resFar: 10.00, commFar: 4.00, facilFar: 10.00, baseHeight: 85 },
  "C5-2": { resFar: 10.00, commFar: 10.00, facilFar: 10.00, baseHeight: 85 },
  "C5-3": { resFar: 10.00, commFar: 15.00, facilFar: 15.00, baseHeight: 125, ihFar: 12.0 },
  "C5-4": { resFar: 10.00, commFar: 10.00, facilFar: 10.00, baseHeight: 85 },
  "C5-5": { resFar: 10.00, commFar: 15.00, facilFar: 15.00, baseHeight: 125 },

  "C6-1": { resFar: 3.44, commFar: 6.00, facilFar: 6.50, baseHeight: 60 },
  "C6-2": { resFar: 6.02, commFar: 6.00, facilFar: 6.50, baseHeight: 85 },
  "C6-3": { resFar: 7.52, commFar: 6.00, facilFar: 10.00, baseHeight: 85 },
  "C6-4": { resFar: 10.00, commFar: 10.00, facilFar: 10.00, baseHeight: 85, ihFar: 12.0 },
  "C6-5": { resFar: 10.00, commFar: 10.00, facilFar: 10.00, baseHeight: 85 },
  "C6-6": { resFar: 10.00, commFar: 15.00, facilFar: 15.00, baseHeight: 125 },
  "C6-9": { resFar: 10.00, commFar: 15.00, facilFar: 15.00, baseHeight: 125 },

  "M1-1": { resFar: 0, commFar: 1.00, facilFar: 2.40, mfgFar: 1.00, baseHeight: 30 },
  "M1-2": { resFar: 0, commFar: 2.00, facilFar: 4.80, mfgFar: 2.00, baseHeight: 60 },
  "M1-3": { resFar: 0, commFar: 2.00, facilFar: 4.80, mfgFar: 2.00, baseHeight: 60 },
  "M1-4": { resFar: 0, commFar: 2.00, facilFar: 6.50, mfgFar: 2.00, baseHeight: 60 },
  "M1-5": { resFar: 0, commFar: 5.00, facilFar: 6.50, mfgFar: 5.00, baseHeight: 85 },
  "M1-6": { resFar: 0, commFar: 10.00, facilFar: 10.00, mfgFar: 10.00, baseHeight: 85 }
};

/**
 * Parses any raw NYC zoning district name and overlay code, returning rules
 * @param {string} district - Primary zoning district (e.g. "R7-2", "C5-3", "M1-1")
 * @param {string} overlay - Commercial overlay if exists (e.g. "C1-2")
 * @returns {object} - Calculated rules object
 */
export function getZoningRules(district, overlay = "") {
  if (!district) return null;

  const upperDistrict = district.trim().toUpperCase();
  
  const isNycFormat = /^[RCM][0-9]/.test(upperDistrict);
  if (!isNycFormat || upperDistrict.includes('GENERIC') || upperDistrict.includes('NON-NYC')) {
    return {
      district: upperDistrict,
      type: 'Mixed Use',
      resFar: 2.50,
      commFar: 2.00,
      facilFar: 2.00,
      mfgFar: 0,
      contextual: true,
      baseHeight: 45,
      maxBuildingHeight: 75,
      ihFar: null,
      skyExposurePlaneSlope: 2.7
    };
  }

  const baseType = upperDistrict.charAt(0); // R, C, or M
  
  // 1. Start with defaults for the category
  let rules = {
    district: upperDistrict,
    type: baseType === 'R' ? 'Residential' : baseType === 'C' ? 'Commercial' : baseType === 'M' ? 'Manufacturing' : 'Special',
    resFar: 0,
    commFar: 0,
    facilFar: 0,
    mfgFar: 0,
    contextual: false,
    baseHeight: 60, // base street wall height in feet
    maxBuildingHeight: null, // null means sky exposure plane limits height
    ihFar: null, // Inclusionary Housing bonus FAR if available
    skyExposurePlaneSlope: baseType === 'M' ? 5.6 : 2.7 // slope ratio: horizontal run / vertical rise
  };

  // 2. Check for exact overrides (e.g. C4-1, C5-3)
  if (EXACT_DISTRICT_OVERRIDES[upperDistrict]) {
    Object.assign(rules, EXACT_DISTRICT_OVERRIDES[upperDistrict]);
  } else {
    // 3. Fallback to parsing general category (e.g. R7, C6)
    const baseMatch = upperDistrict.match(/^([RCM][0-9]+)/);
    if (baseMatch && BASE_DISTRICT_RULES[baseMatch[1]]) {
      Object.assign(rules, BASE_DISTRICT_RULES[baseMatch[1]]);
    }
  }

  // 4. Check for Contextual District rules
  // Contextual districts have letter suffixes (e.g. R7A, R8X, C4-4D)
  if (upperDistrict.match(/[A-Z]$/) && !upperDistrict.startsWith('C5') && !upperDistrict.startsWith('C6') && !upperDistrict.startsWith('M1')) {
    rules.contextual = true;
    
    // Set typical contextual height limits (Quality Housing)
    if (upperDistrict.includes('6A') || upperDistrict.includes('6B')) {
      rules.maxBuildingHeight = 70;
      rules.baseHeight = 45;
    } else if (upperDistrict.includes('7A') || upperDistrict.includes('7B')) {
      rules.maxBuildingHeight = 80;
      rules.baseHeight = 65;
    } else if (upperDistrict.includes('8A') || upperDistrict.includes('8B') || upperDistrict.includes('8X')) {
      rules.maxBuildingHeight = 120;
      rules.baseHeight = 85;
    } else if (upperDistrict.includes('9A') || upperDistrict.includes('9X')) {
      rules.maxBuildingHeight = 145;
      rules.baseHeight = 95;
    } else if (upperDistrict.includes('10A') || upperDistrict.includes('10X')) {
      rules.maxBuildingHeight = 185;
      rules.baseHeight = 125;
    }
  }

  // 5. Apply Commercial Overlay if exists (e.g., C1-2 overlay in R7-2 district)
  if (overlay) {
    const cleanOverlay = overlay.trim().toUpperCase();
    rules.overlay = cleanOverlay;
    // Commercial overlay in R1-R5: Max 1.0 FAR commercial
    // Commercial overlay in R6-R10: Max 2.0 FAR commercial
    const rMatch = upperDistrict.match(/^R([0-9]+)/);
    if (rMatch) {
      const rNum = parseInt(rMatch[1], 10);
      rules.commFar = rNum >= 6 ? 2.00 : 1.00;
    }
  }

  return rules;
}

/**
 * Calculates building envelope volume constraints
 * @param {number} lotArea - Area of the lot in sq ft
 * @param {object} rules - Zoning rules object
 * @returns {object} - Calculated floor area allocations
 */
export function calculateDevelopmentRights(lotArea, rules) {
  if (!lotArea || !rules) return null;

  return {
    maxResidentialArea: lotArea * rules.resFar,
    maxCommercialArea: lotArea * rules.commFar,
    maxFacilityArea: lotArea * rules.facilFar,
    maxMfgArea: lotArea * rules.mfgFar,
    maxInclusionaryArea: rules.ihFar ? lotArea * rules.ihFar : null
  };
}
