/**
 * compsData.js
 * Handles fetching live real estate comparables from NYC Open Data (DOF Rolling Sales & PLUTO).
 */

const ROLLING_SALES_ENDPOINT = "https://data.cityofnewyork.us/resource/w2pb-icbu.json";
const PLUTO_ENDPOINT = "https://data.cityofnewyork.us/resource/64uk-42ks.json";

/**
 * Fetches recent land sales in the given ZIP code and calculates average $/BSF.
 * @param {string} zipCode - The NYC ZIP code to search within.
 * @param {number} fallbackCostSf - The default land cost per sqft to return if no comps are found.
 * @returns {Promise<{ averagePricePerBsf: number, comps: Array }>}
 */
export async function fetchLiveLandComps(zipCode, fallbackCostSf = 200) {
  if (!zipCode) return { averagePricePerBsf: fallbackCostSf, comps: [] };

  try {
    // 1. Fetch recent sales in the ZIP code with a sale price > $50,000 to avoid nominal transfers.
    // We fetch a decent chunk and filter client-side to be safe with SoQL string matching.
    const query = `?$where=zip_code='${zipCode}' AND sale_price > 50000&$order=sale_date DESC&$limit=200`;
    const salesRes = await fetch(ROLLING_SALES_ENDPOINT + query);
    
    if (!salesRes.ok) {
      console.warn("Comps API failed:", salesRes.status);
      return { averagePricePerBsf: fallbackCostSf, comps: [] };
    }

    const salesData = await salesRes.json();
    
    // Filter for Vacant Land or Commercial Land
    const landSales = salesData.filter(sale => {
      const cat = (sale.building_class_category || "").toUpperCase();
      return cat.includes("VACANT LAND");
    }).slice(0, 5); // Take the top 5 most recent

    if (landSales.length === 0) {
      console.log(`No vacant land comps found in ZIP ${zipCode}. Using fallback $${fallbackCostSf}/BSF.`);
      return { averagePricePerBsf: fallbackCostSf, comps: [] };
    }

    // 2. Fetch PLUTO data for these comps to determine Buildable Square Feet (BSF)
    const validComps = [];
    let totalPricePerBsf = 0;

    for (const sale of landSales) {
      // Socrata borough codes: 1=MN, 2=BX, 3=BK, 4=QN, 5=SI
      // PLUTO borough codes: MN, BX, BK, QN, SI
      const boroMap = { '1': 'MN', '2': 'BX', '3': 'BK', '4': 'QN', '5': 'SI' };
      const boroString = boroMap[sale.borough];
      
      if (!boroString) continue;

      const block = parseInt(sale.block, 10);
      const lot = parseInt(sale.lot, 10);
      
      try {
        const plutoRes = await fetch(`${PLUTO_ENDPOINT}?borough=${boroString}&block=${block}&lot=${lot}`);
        if (!plutoRes.ok) continue;
        
        const plutoDataArr = await plutoRes.json();
        if (plutoDataArr.length === 0) continue;
        
        const plutoData = plutoDataArr[0];
        
        const lotArea = parseFloat(plutoData.lotarea) || 0;
        const resFar = parseFloat(plutoData.residfar) || 0;
        const commFar = parseFloat(plutoData.commfar) || 0;
        const facilFar = parseFloat(plutoData.facilfar) || 0;
        const mfgFar = parseFloat(plutoData.mfgfar) || 0;
        
        const maxFar = Math.max(resFar, commFar, facilFar, mfgFar);
        
        if (lotArea > 0 && maxFar > 0) {
          const maxBsf = lotArea * maxFar;
          const salePrice = parseFloat(sale.sale_price);
          const pricePerBsf = salePrice / maxBsf;
          
          // Sanity check: if price per BSF is wildly unrealistic (e.g., < $10 or > $3000), it might be a weird assemblage or non-arm's length
          if (pricePerBsf >= 10 && pricePerBsf <= 3000) {
            validComps.push({
              address: sale.address,
              saleDate: sale.sale_date ? sale.sale_date.split('T')[0] : 'N/A',
              salePrice: salePrice,
              maxBsf: maxBsf,
              pricePerBsf: pricePerBsf,
              category: sale.building_class_category
            });
            totalPricePerBsf += pricePerBsf;
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch PLUTO data for comp ${block}-${lot}`, err);
      }
    }

    if (validComps.length === 0) {
      console.log(`Could not resolve BSF for comps in ZIP ${zipCode}. Using fallback $${fallbackCostSf}/BSF.`);
      return { averagePricePerBsf: fallbackCostSf, comps: [] };
    }

    const averagePricePerBsf = totalPricePerBsf / validComps.length;
    console.log(`Successfully calculated live Land Cost: $${averagePricePerBsf.toFixed(2)}/BSF based on ${validComps.length} comps.`);
    
    return {
      averagePricePerBsf: Math.round(averagePricePerBsf), // Round to nearest dollar for cleaner UX
      comps: validComps
    };

  } catch (error) {
    console.error("Error fetching live comps:", error);
    return { averagePricePerBsf: fallbackCostSf, comps: [] };
  }
}
