import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getZoningRules, calculateDevelopmentRights } from './zoningRules.js';
import { financialData } from './financialData.js';
import { estimateFinancials, recalculateUnderwriting } from './financialRules.js';

// Application state
let currentBBL = null;
let plutoData = null;
let footprintsData = [];
let zapProjects = [];
let currentAddressName = null;
let activeTab = 'zoning';
let activeFinancialSubTab = 'summary';
let activeUnderwritingAssumptions = null;
let activeUnderwritingData = null;
let isCustomized = false;

// Initialize custom underwriting assumptions
function initAssumptions(bblStr, lotArea, zoningRules) {
  const far = zoningRules.ihFar || Math.max(zoningRules.resFar || 0, zoningRules.commFar || 0, zoningRules.facilFar || 0, zoningRules.mfgFar || 0, 1.0);
  const zfa = lotArea * far;
  const isMfg = (zoningRules.mfgFar || 0) > Math.max(zoningRules.resFar || 0, zoningRules.commFar || 0) && (zoningRules.mfgFar || 0) > 0;
  const isComm = (zoningRules.commFar || 0) >= (zoningRules.resFar || 0) && (zoningRules.commFar || 0) > 0;

  if (bblStr === "1017230017") {
    return {
      gsfFormula: "ZFA * 1.201288",
      nsfFormula: "GSF * 0.798159",
      stabilizedValueFormula: "NOI / CapRate",
      seniorLoanFormula: "ProjectCost * LTC",
      fmRentMo: 3612.38,
      hpdRentMo: 1476.11,
      commRentSf: 59.50,
      fmVacancy: 0.05,
      hpdVacancy: 0.02,
      commVacancy: 0.07,
      unabatedTaxPct: 0.2144,
      opexPerUnit: 5312.22,
      mgmtFeePct: 0.03,
      landCostSf: 2100,
      hardCostGsf: 310.93,
      hardContingencyPct: 0.00,
      softCostPct: 0.1116,
      financingCostPct: 0.04586,
      carryInterestPct: 0.1268,
      capRate: 0.0575,
      ltc: 0.7103,
      discountRate: 0.03,
      priorAv: 1987000,
      avGrowthRate: 0.02,
      taxRateGrowth: 0.005
    };
  } else {
    return {
      gsfFormula: "ZFA * 1.15",
      nsfFormula: "GSF * 0.82",
      stabilizedValueFormula: "NOI / CapRate",
      seniorLoanFormula: "ProjectCost * LTC",
      fmRentMo: 3960,
      hpdRentMo: 1867.5,
      commRentSf: isMfg ? 25 : 50,
      fmVacancy: 0.05,
      hpdVacancy: 0.02,
      commVacancy: 0.07,
      unabatedTaxPct: 0.215,
      opexPerUnit: 8500,
      mgmtFeePct: 0.03,
      landCostSf: 200,
      hardCostGsf: isMfg ? 180 : (isComm ? 260 : 310),
      hardContingencyPct: 0.10,
      softCostPct: 0.11,
      financingCostPct: 0.035,
      carryInterestPct: 0.10,
      capRate: 0.0575,
      ltc: 0.71,
      discountRate: 0.03,
      priorAv: lotArea * 175,
      avGrowthRate: 0.02,
      taxRateGrowth: 0.005
    };
  }
}

// UI Elements
const searchInput = document.getElementById('site-search-input');
const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
const reportPanel = document.getElementById('report-panel');

// GIS Map
let map = null;
let lotGeoJSONLayer = null;
let buildingsGeoJSONLayer = null;

// Three.js Scene Globals
let scene, camera, renderer, controls;
let lotMesh = null;
let buildingsGroup = null;
let envelopeMesh = null;
let proposedMesh = null;
let container3D = null;

// Initialize 2D Map
function initMap() {
  if (map) return;
  // Initialize map centered on NYC (City Hall)
  map = L.map('map-container').setView([40.7128, -74.0060], 13);
  
  // Use CartoDB Dark Matter tiles to fit the premium dark aesthetic
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
}

// Initialize 3D Viewport
function init3D() {
  if (renderer) return;
  container3D = document.getElementById('renderer-3d-container');
  if (!container3D) return;

  const width = container3D.clientWidth;
  const height = container3D.clientHeight;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060810);

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
  camera.position.set(0, 300, 400);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container3D.appendChild(renderer.domElement);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground level
  controls.minDistance = 50;
  controls.maxDistance = 2000;

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(400, 800, 200);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0x00f0ff, 0.3);
  dirLight2.position.set(-400, 300, -200);
  scene.add(dirLight2);

  // Grid / Ground helper
  const gridHelper = new THREE.GridHelper(2000, 50, 0x1e2541, 0x0f1322);
  gridHelper.position.y = -0.5;
  scene.add(gridHelper);

  // Group containers
  buildingsGroup = new THREE.Group();
  scene.add(buildingsGroup);

  // Start Animation Loop
  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    if (!container3D) return;
    const w = container3D.clientWidth;
    const h = container3D.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Projection: Converts Latitude/Longitude to local X/Y coordinates in feet relative to lot center
function getLocalCoordinates(lon, lat, centerLon, centerLat) {
  const latRad = centerLat * Math.PI / 180;
  // 1 degree latitude ~= 111,320 meters ~= 365,223 feet
  // 1 degree longitude ~= 111,320 * cos(lat) meters
  const y = (lat - centerLat) * 365223;
  const x = (lon - centerLon) * Math.cos(latRad) * 365223;
  return { x, y };
}

function isCoordinatesInNYC(lat, lon) {
  return lat >= 40.49 && lat <= 40.92 && lon >= -74.26 && lon <= -73.69;
}

function formatPhotonLabel(props) {
  const parts = [];
  let mainName = props.name || '';
  const houseNum = props.housenumber || '';
  const street = props.street || '';
  
  let addressLine = '';
  if (houseNum && street) {
    addressLine = `${houseNum} ${street}`;
  } else if (street) {
    addressLine = street;
  } else {
    addressLine = mainName;
  }
  
  if (mainName && mainName !== houseNum && mainName !== street && mainName !== addressLine) {
    parts.push(mainName);
  }
  if (addressLine) {
    parts.push(addressLine);
  }
  
  const city = props.city || props.town || props.village || '';
  const state = props.state || '';
  const postcode = props.postcode || '';
  const country = props.country || '';
  
  const locationParts = [];
  if (city) locationParts.push(city);
  if (state) locationParts.push(state);
  if (postcode) locationParts.push(postcode);
  if (country && country !== 'United States') locationParts.push(country);
  
  if (locationParts.length > 0) {
    parts.push(locationParts.join(', '));
  }
  
  return parts.join(', ');
}

function getLocalGovernmentAgencies(address, city, state, postcode) {
  const cleanCity = (city || '').trim();
  const cleanState = (state || '').trim();
  const addressQuery = encodeURIComponent(address || '');
  
  // NYC case
  if (cleanCity === 'New York' || cleanState === 'NY' || cleanCity === 'Brooklyn' || cleanCity === 'Queens' || cleanCity === 'Bronx' || cleanCity === 'Staten Island') {
    // Parse BBL components
    const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
    const boro = bblStr.substring(0, 1);
    const block = String(parseInt(bblStr.substring(1, 6), 10) || '');
    const lot = String(parseInt(bblStr.substring(6, 10), 10) || '');
    return {
      building: {
        name: "NYC DOB (BIS)",
        url: boro && block && lot 
          ? `https://a810-bisweb.nyc.gov/bisweb/PropertyBrowseByBBLServlet?allborough=${boro}&allblock=${block}&alllot=${lot}&go5=%2BGO%2B&requestid=0`
          : `https://www.google.com/search?q=site:a810-bisweb.nyc.gov+OR+site:nyc.gov/site/buildings+"${addressQuery}"`
      },
      housing: {
        name: "NYC HPD Online",
        url: `https://hpdonline.nyc.gov/hpdonline/select-property?address=${addressQuery}`
      },
      planning: {
        name: "NYC DCP (ZoLa)",
        url: `https://zola.planning.nyc.gov/about#12/${40.7128}/${-74.0060}`
      }
    };
  }

  // Los Angeles case
  if (cleanCity === 'Los Angeles' || cleanState === 'CA') {
    return {
      building: {
        name: "LADBS (Permit Search)",
        url: `https://www.google.com/search?q=site:ladbstransactions.lacity.org+OR+site:ladbs.org+"${addressQuery}"`
      },
      housing: {
        name: "LA Housing Dept (LAHD)",
        url: `https://www.google.com/search?q=site:housing.lacity.org+"${addressQuery}"`
      },
      planning: {
        name: "LA City Planning (ZIMAS)",
        url: `https://www.google.com/search?q=site:zimas.lacity.org+OR+site:planning.lacity.org+"${addressQuery}"`
      }
    };
  }

  // Chicago case
  if (cleanCity === 'Chicago' || cleanState === 'IL') {
    return {
      building: {
        name: "Chicago Dept of Buildings",
        url: `https://www.google.com/search?q=site:chicago.gov/city/en/depts/bldgs+"${addressQuery}"`
      },
      housing: {
        name: "Chicago Dept of Housing",
        url: `https://www.google.com/search?q=site:chicago.gov/city/en/depts/doh+"${addressQuery}"`
      },
      planning: {
        name: "Chicago Planning & Zoning",
        url: `https://www.google.com/search?q=site:chicago.gov/city/en/depts/dcd+OR+site:gisapps.chicago.gov+"${addressQuery}"`
      }
    };
  }

  // Miami case
  if (cleanCity === 'Miami' || cleanState === 'FL' || cleanCity === 'Miami-Dade') {
    return {
      building: {
        name: "Miami-Dade RER Building",
        url: `https://www.google.com/search?q=site:miamidade.gov/building+OR+site:miamigov.com/building+"${addressQuery}"`
      },
      housing: {
        name: "Miami-Dade Housing Authority",
        url: `https://www.google.com/search?q=site:miamidade.gov/housing+OR+site:miamigov.com/housing+"${addressQuery}"`
      },
      planning: {
        name: "Miami Planning & Zoning",
        url: `https://www.google.com/search?q=site:miamigov.com/Government/Departments-Organizations/Planning-Zoning+"${addressQuery}"`
      }
    };
  }

  // Houston case
  if (cleanCity === 'Houston' || cleanState === 'TX') {
    return {
      building: {
        name: "Houston Permitting Center",
        url: `https://www.google.com/search?q=site:houstonpermittingcenter.org+OR+site:houstontx.gov+"${addressQuery}"`
      },
      housing: {
        name: "Houston Housing & Dev",
        url: `https://www.google.com/search?q=site:houstontx.gov/housing+"${addressQuery}"`
      },
      planning: {
        name: "Houston Planning & Zoning",
        url: `https://www.google.com/search?q=site:houstontx.gov/planning+"${addressQuery}"`
      }
    };
  }

  // San Francisco case
  if (cleanCity === 'San Francisco' || cleanState === 'CA') {
    return {
      building: {
        name: "SF DBI (Building Inspection)",
        url: `https://www.google.com/search?q=site:sf.gov/departments/department-building-inspection+"${addressQuery}"`
      },
      housing: {
        name: "SF MOHCD (Housing)",
        url: `https://www.google.com/search?q=site:sf.gov/departments/mayors-office-housing-and-community-development+"${addressQuery}"`
      },
      planning: {
        name: "SF Planning (Property Map)",
        url: `https://www.google.com/search?q=site:sfplanninggis.org+OR+site:sfplanning.org+"${addressQuery}"`
      }
    };
  }

  // Default fallback for any other city in the US/World
  const cityState = `${cleanCity ? cleanCity + ' ' : ''}${cleanState ? cleanState + ' ' : ''}`;
  return {
    building: {
      name: `${cleanCity || 'Local'} Building Dept`,
      url: `https://www.google.com/search?q=${encodeURIComponent(cityState + "building department permit violations " + address)}`
    },
    housing: {
      name: `${cleanCity || 'Local'} Housing Dept`,
      url: `https://www.google.com/search?q=${encodeURIComponent(cityState + "housing authority housing department " + address)}`
    },
    planning: {
      name: `${cleanCity || 'Local'} Planning & Zoning`,
      url: `https://www.google.com/search?q=${encodeURIComponent(cityState + "planning zoning maps code " + address)}`
    }
  };
}

// Search Autocomplete Handlers
let searchTimeout;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const val = e.target.value.trim();
  
  if (val.length < 3) {
    autocompleteDropdown.style.display = 'none';
    return;
  }

  // Direct BBL search checking
  if (/^\d{10}$/.test(val)) {
    autocompleteDropdown.style.display = 'none';
    return;
  }

  searchTimeout = setTimeout(() => {
    // Normalize hyphenated ranges (e.g., 33-35 W 125th St -> 33 W 125th St) to satisfy geosearch API
    const cleanVal = val.replace(/^(\d+)-(\d+)\s+/, '$1 ');
    
    const planningLabsPromise = fetch(`https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(cleanVal)}`)
      .then(res => res.json())
      .catch(err => {
        console.warn('PlanningLabs autocomplete failed:', err);
        return { features: [] };
      });
      
    const photonPromise = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(val)}&limit=8`)
      .then(res => res.json())
      .catch(err => {
        console.warn('Photon autocomplete failed:', err);
        return { features: [] };
      });

    Promise.all([planningLabsPromise, photonPromise])
      .then(([plData, phData]) => {
        const plFeatures = plData.features || [];
        const phFeatures = phData.features || [];

        autocompleteDropdown.innerHTML = '';

        // Add PlanningLabs results first
        plFeatures.forEach(feat => {
          const props = feat.properties;
          const pad = props.addendum ? props.addendum.pad : null;
          if (!pad || !pad.bbl) return; // skip if no BBL

          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.innerHTML = `
            <div class="item-title">${props.label || props.name}</div>
            <div class="item-subtitle">BBL: ${pad.bbl} | BIN: ${pad.bin || 'N/A'}</div>
          `;
          div.addEventListener('click', () => {
            searchInput.value = props.label || props.name;
            autocompleteDropdown.style.display = 'none';
            const coords = feat.geometry ? feat.geometry.coordinates : null;
            const lon = coords ? coords[0] : null;
            const lat = coords ? coords[1] : null;
            loadSite(pad.bbl, pad.bin, props.label || props.name, lat, lon);
          });
          autocompleteDropdown.appendChild(div);
        });

        // Add Photon results next
        phFeatures.forEach(feat => {
          const props = feat.properties;
          const coords = feat.geometry ? feat.geometry.coordinates : null;
          if (!coords || coords.length < 2) return;
          const lon = coords[0];
          const lat = coords[1];

          // Check if coordinate is in NYC and if we already have PlanningLabs results
          const inNYC = isCoordinatesInNYC(lat, lon);
          if (inNYC && plFeatures.length > 0) {
            return; // skip duplicate NYC result
          }

          const label = formatPhotonLabel(props);
          const city = props.city || props.town || props.village || '';
          const state = props.state || '';

          const div = document.createElement('div');
          div.className = 'autocomplete-item';
          div.innerHTML = `
            <div class="item-title">${label}</div>
            <div class="item-subtitle">Location: ${city || ''} ${state || ''} | GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
          `;
          div.addEventListener('click', () => {
            searchInput.value = label;
            autocompleteDropdown.style.display = 'none';
            loadSite(null, null, label, lat, lon, props);
          });
          autocompleteDropdown.appendChild(div);
        });

        autocompleteDropdown.style.display = autocompleteDropdown.children.length > 0 ? 'block' : 'none';
      })
      .catch(err => console.error('Merged autocomplete failed:', err));
  }, 300);
});

// Close dropdown on click outside
document.addEventListener('click', (e) => {
  if (e.target !== searchInput && e.target !== autocompleteDropdown) {
    autocompleteDropdown.style.display = 'none';
  }
});

// Trigger search on direct enter key
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = searchInput.value.trim();
    if (/^\d{10}$/.test(val)) {
      loadSite(val);
      return;
    }

    // Address search on Enter
    if (val.length >= 3) {
      const cleanVal = val.replace(/^(\d+)-(\d+)\s+/, '$1 ');
      
      const plPromise = fetch(`https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(cleanVal)}`)
        .then(res => res.json())
        .catch(err => {
          console.warn('Enter geosearch failed:', err);
          return { features: [] };
        });

      const phPromise = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(val)}&limit=5`)
        .then(res => res.json())
        .catch(err => {
          console.warn('Enter photon failed:', err);
          return { features: [] };
        });

      Promise.all([plPromise, phPromise])
        .then(([plData, phData]) => {
          // 1. Try to find NYC match first
          if (plData.features && plData.features.length > 0) {
            const feat = plData.features.find(f => f.properties && f.properties.addendum && f.properties.addendum.pad && f.properties.addendum.pad.bbl);
            if (feat) {
              const props = feat.properties;
              const pad = props.addendum.pad;
              const coords = feat.geometry ? feat.geometry.coordinates : null;
              const lon = coords ? coords[0] : null;
              const lat = coords ? coords[1] : null;
              searchInput.value = props.label || props.name;
              autocompleteDropdown.style.display = 'none';
              loadSite(pad.bbl, pad.bin, props.label || props.name, lat, lon);
              return;
            }
          }

          // 2. Fallback to Photon match
          if (phData.features && phData.features.length > 0) {
            const feat = phData.features[0];
            const props = feat.properties;
            const coords = feat.geometry ? feat.geometry.coordinates : null;
            if (coords && coords.length >= 2) {
              const lon = coords[0];
              const lat = coords[1];
              const label = formatPhotonLabel(props);
              searchInput.value = label;
              autocompleteDropdown.style.display = 'none';
              loadSite(null, null, label, lat, lon, props);
            }
          }
        })
        .catch(err => console.error('Enter key search aggregation failed:', err));
    }
  }
});

// Local mock properties database for offline/CORS-blocked fallback
const MOCK_PROPERTIES = {
  "1017230017": {
    bbl: "1017230017",
    borough: "MN", block: "1723", lot: "17",
    address: "35 WEST 125TH STREET",
    zonedist1: "C4-7", spdist1: "125th", splitzone: false,
    lotarea: "11990", bldgarea: "166023", builtfar: "13.85",
    residfar: "10.00", commfar: "10.00", facilfar: "10.00", affresfar: "12.00",
    numfloors: "21", yearbuilt: "2025",
    latitude: "40.8073159", longitude: "-73.9436739",
    lotfront: "120.0", lotdepth: "99.9", landmark: null
  },
  "1008350041": {
    bbl: "1008350041",
    borough: "MN", block: "835", lot: "41",
    address: "350 FIFTH AVENUE",
    zonedist1: "C5-3", zonedist2: "C6-4.5", spdist1: "MiD", splitzone: true,
    lotarea: "91351", bldgarea: "2812739", builtfar: "30.79",
    residfar: "10.00", commfar: "15.00", facilfar: "15.00", affresfar: "12.00",
    numfloors: "102", yearbuilt: "1931",
    latitude: "40.7484514", longitude: "-73.9857117",
    lotfront: "197.5", lotdepth: "500.0", landmark: "INDIVIDUAL AND INTERIOR LANDMARK"
  }
};

// Load and query zoning data for BBL
function loadSite(bbl, bin = null, addressName = null, inputLat = null, inputLon = null, geojsonProps = null) {
  currentBBL = bbl;
  
  const isNonNyc = !bbl || !/^\d{10}$/.test(String(bbl));

  reportPanel.innerHTML = `
    <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
      <div style="font-size: 24px; margin-bottom: 12px; animation: spin 2s linear infinite;">⏳</div>
      <p>${isNonNyc ? 'Gathering coordinate references & local zoning templates...' : 'Gathering spatial coordinates & NYC PLUTO zoning data...'}</p>
    </div>
  `;

  let dataPromise;

  if (bbl && MOCK_PROPERTIES[bbl]) {
    // Resolve immediately for preloaded mock properties to ensure instant load
    dataPromise = Promise.resolve([[MOCK_PROPERTIES[bbl]], [], []]);
  } else if (isNonNyc) {
    // Resolve immediately for non-NYC locations
    dataPromise = Promise.resolve([[], [], []]);
  } else {
    // Parse BBL components safely
    const bblStr = String(bbl);
    const boroughDigit = bblStr.substring(0, 1);
    const rawBlock = bblStr.substring(1, 6);
    const rawLot = bblStr.substring(6, 10);

    // Convert to numeric integers (strip leading zeros) for Socrata API query
    const blockNum = parseInt(rawBlock, 10);
    const lotNum = parseInt(rawLot, 10);

    const boroMap = { '1': 'MN', '2': 'BX', '3': 'BK', '4': 'QN', '5': 'SI' };
    const borough = boroMap[boroughDigit];

    if (!borough) {
      reportPanel.innerHTML = `<div class="welcome-screen">❌ Invalid Borough identifier in BBL.</div>`;
      return;
    }

    // Fetch PLUTO, building footprints, and ZAP applications concurrently
    const plutoUrl = `https://data.cityofnewyork.us/resource/64uk-42ks.json?borough=${borough}&block=${blockNum}&lot=${lotNum}`;
    const footprintsUrl = `https://data.cityofnewyork.us/resource/5zhs-2jue.json?base_bbl=${bbl}`;
    const zapBblUrl = `https://data.cityofnewyork.us/resource/2iga-a6mk.json?bbl=${bbl}`;

    dataPromise = Promise.all([
      fetch(plutoUrl)
        .then(r => {
          if (!r.ok) throw new Error("PLUTO Socrata Server Error: " + r.status);
          return r.json();
        })
        .catch(err => {
          console.warn("PLUTO fetch failed, checking local mock database:", err);
          if (MOCK_PROPERTIES[bbl]) {
            return [MOCK_PROPERTIES[bbl]];
          }
          throw err;
        }),
      fetch(footprintsUrl)
        .then(r => r.json())
        .catch(err => {
          console.warn("Building footprints fetch failed:", err);
          return [];
        }),
      fetch(zapBblUrl)
        .then(r => r.json())
        .catch(err => {
          console.warn("ZAP BBL fetch failed:", err);
          return [];
        })
    ]);
  }

  dataPromise
  .then(([plutoRows, footprintRows, zapBblRows]) => {
    let lat = inputLat;
    let lon = inputLon;

    if (!plutoRows || plutoRows.length === 0) {
      if (lat === null || lon === null) {
        throw new Error("Tax lot BBL not found in PLUTO. Please try searching via address suggestion.");
      }
      
      let cityVal = "";
      let stateVal = "";
      let postcodeVal = "";
      
      if (isNonNyc) {
        if (geojsonProps) {
          cityVal = geojsonProps.city || geojsonProps.town || geojsonProps.village || "";
          stateVal = geojsonProps.state || "";
          postcodeVal = geojsonProps.postcode || "";
        } else if (addressName) {
          const parts = addressName.split(',').map(p => p.trim());
          if (parts.length >= 3) {
            cityVal = parts[parts.length - 3] || "";
            const stateZip = parts[parts.length - 2] || "";
            const szParts = stateZip.split(/\s+/);
            stateVal = szParts[0] || "";
            postcodeVal = szParts[1] || "";
          }
        }
      }

      // Fallback data structure for new/split lots or non-NYC
      plutoData = {
        bbl: bbl || "N/A",
        address: addressName || `BBL ${bbl}`,
        zonedist1: isNonNyc ? "MU-Generic" : "C4-7", 
        spdist1: isNonNyc ? null : "125th",
        lotarea: isNonNyc ? "10000" : "12000", 
        bldgarea: "0",
        builtfar: "0.0",
        residfar: isNonNyc ? "2.5" : "10.0",
        commfar: isNonNyc ? "2.0" : "10.0",
        facilfar: isNonNyc ? "2.0" : "10.0",
        affresfar: "0.0",
        numfloors: "0",
        yearbuilt: "N/A",
        latitude: String(lat),
        longitude: String(lon),
        lotfront: "100",
        lotdepth: "100",
        splitzone: false,
        landmark: null,
        fallback: true,
        isNonNyc: isNonNyc,
        city: cityVal,
        state: stateVal,
        postcode: postcodeVal
      };
    } else {
      plutoData = plutoRows[0];
      plutoData.city = "New York";
      plutoData.state = "NY";
      plutoData.isNonNyc = false;
    }
    footprintsData = footprintRows;

    const bblStr = String(bbl).split('.')[0];
    const lotArea = parseInt(plutoData.lotarea, 10) || 0;
    const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1) || {
      resFar: 0, commFar: 0, facilFar: 0, baseHeight: 60, contextual: false, maxBuildingHeight: 300
    };
    activeUnderwritingAssumptions = initAssumptions(bblStr, lotArea, zoningRules);
    
    // Initialize activeUnderwritingData
    if (bblStr === "1017230017") {
      activeUnderwritingData = JSON.parse(JSON.stringify(financialData));
      activeUnderwritingData.abatementSummary = {
        ...activeUnderwritingData.abatementSummary,
        ...activeUnderwritingAssumptions
      };
    } else {
      const displayAddress = addressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;
      activeUnderwritingData = estimateFinancials(lotArea, zoningRules, displayAddress, bblStr, activeUnderwritingAssumptions);
    }
    isCustomized = false;
    
    // Set map and 3D views
    initMap();
    init3D();

    // Reveal sidebar tab navigation
    const tabContainer = document.getElementById('sidebar-tabs');
    if (tabContainer) {
      tabContainer.style.display = 'flex';
    }

    // Update save location button state and show saved list
    updateSaveButtonState();
    renderSavedLocationsList();

    const siteLat = parseFloat(plutoData.latitude);
    const siteLon = parseFloat(plutoData.longitude);

    if (!isNaN(siteLat) && !isNaN(siteLon)) {
      map.setView([siteLat, siteLon], 17);
      updateMapLayers(siteLat, siteLon);
      update3DScene(siteLat, siteLon);
    }

    // Process Zoning Application (ZAP) project details if they exist
    if (zapBblRows && zapBblRows.length > 0) {
      const projectIds = [...new Set(zapBblRows.map(row => row.project_id))].slice(0, 5);
      const queryStr = projectIds.map(id => `'${id}'`).join(',');
      const zapProjectUrl = `https://data.cityofnewyork.us/resource/hgx4-8ukb.json?$where=project_id in(${encodeURIComponent(queryStr)})`;
      
      fetch(zapProjectUrl)
        .then(r => r.json())
        .then(projectData => {
          zapProjects = projectData;
          currentAddressName = addressName;
          activeTab = 'zoning'; // default to zoning on new site load
          renderActiveTab();
        })
        .catch(err => {
          console.error("ZAP Project fetch error:", err);
          zapProjects = [];
          currentAddressName = addressName;
          activeTab = 'zoning';
          renderActiveTab();
        });
    } else {
      zapProjects = [];
      currentAddressName = addressName;
      activeTab = 'zoning';
      renderActiveTab();
    }
  })
  .catch(err => {
    console.error(err);
    reportPanel.innerHTML = `
      <div class="welcome-screen">
        <h3>❌ Request Failed</h3>
        <p style="margin-top: 10px; color: var(--accent-magenta); font-size: 13px;">${err.message}</p>
        <p style="margin-top: 15px; font-size: 12px;">Verify the search text or try entering a direct 10-digit BBL.</p>
      </div>
    `;
  });
}

// Visual layout for Leaflet layers
function updateMapLayers(lat, lon) {
  // Clear existing layers
  if (lotGeoJSONLayer) map.removeLayer(lotGeoJSONLayer);
  if (buildingsGeoJSONLayer) map.removeLayer(buildingsGeoJSONLayer);

  // Draw lot boundary estimation
  const lotWidth = parseFloat(plutoData.lotfront) || 100;
  const lotDepth = parseFloat(plutoData.lotdepth) || 100;

  // Since we don't have exact lot polygon from PLUTO directly, we generate a rectangle or use bounding box of buildings
  // Check if we have building footprints to bound the lot
  let bounds;
  if (footprintsData && footprintsData.length > 0) {
    const coordinates = [];
    footprintsData.forEach(feat => {
      if (feat.the_geom && feat.the_geom.coordinates) {
        const type = feat.the_geom.type;
        const coords = feat.the_geom.coordinates;
        if (type === "MultiPolygon") {
          coords[0][0].forEach(pt => coordinates.push([pt[1], pt[0]]));
        } else if (type === "Polygon") {
          coords[0].forEach(pt => coordinates.push([pt[1], pt[0]]));
        }
      }
    });

    if (coordinates.length > 0) {
      // Calculate footprint polygon bounds
      const polygon = L.polygon(coordinates);
      bounds = polygon.getBounds();
    }
  }

  // If no footprints, construct box based on front/depth
  if (!bounds) {
    // Generate approximate rectangle bounds
    const latOffset = (lotDepth / 365223);
    const lonOffset = (lotWidth / (365223 * Math.cos(lat * Math.PI / 180)));
    bounds = L.latLngBounds(
      [lat - latOffset/2, lon - lonOffset/2],
      [lat + latOffset/2, lon + lonOffset/2]
    );
  }

  // Create Lot Outline
  lotGeoJSONLayer = L.rectangle(bounds, {
    color: '#00f0ff',
    weight: 2,
    fillColor: '#00f0ff',
    fillOpacity: 0.1,
    dashArray: '4, 4'
  }).addTo(map);

  // Create Building Footprint Layers
  if (footprintsData && footprintsData.length > 0) {
    const geoJsonFeatures = footprintsData.map(feat => {
      return {
        type: "Feature",
        geometry: feat.the_geom,
        properties: {
          name: feat.name || "Building Footprint",
          bin: feat.bin,
          height: feat.height_roof
        }
      };
    });

    buildingsGeoJSONLayer = L.geoJSON(geoJsonFeatures, {
      style: {
        color: '#ff007f',
        weight: 1,
        fillColor: '#ff007f',
        fillOpacity: 0.35
      }
    }).addTo(map);
  }
}

// 3D Rendering updates
function update3DScene(centerLat, centerLon) {
  if (!scene || !buildingsGroup) return;

  // Clear scene items
  if (lotMesh) scene.remove(lotMesh);
  if (envelopeMesh) scene.remove(envelopeMesh);
  
  // Clear existing buildings Group
  while (buildingsGroup.children.length > 0) {
    buildingsGroup.remove(buildingsGroup.children[0]);
  }

  // Calculate lot dimensions
  const lotWidth = parseFloat(plutoData.lotfront) || 100;
  const lotDepth = parseFloat(plutoData.lotdepth) || 100;

  // Resolve zoning rules
  const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1);

  // 1. Draw Lot Base Mesh
  // If we have footprints, let's use the bounds of footprints to match the map, otherwise construct rectangle
  let minX = -lotWidth / 2;
  let maxX = lotWidth / 2;
  let minY = -lotDepth / 2;
  let maxY = lotDepth / 2;

  // Setup actual boundaries from building footprints if they exceed our simple box
  let boundaryCoords = [
    new THREE.Vector2(minX, minY),
    new THREE.Vector2(maxX, minY),
    new THREE.Vector2(maxX, maxY),
    new THREE.Vector2(minX, maxY)
  ];

  const lotShape = new THREE.Shape(boundaryCoords);
  const lotGeom = new THREE.ShapeGeometry(lotShape);
  const lotMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide
  });
  lotMesh = new THREE.Mesh(lotGeom, lotMat);
  lotMesh.rotation.x = -Math.PI / 2;
  scene.add(lotMesh);

  // Add glowing boundary line
  const points = lotShape.getPoints();
  const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
  const boundaryLine = new THREE.LineLoop(lineGeom, lineMat);
  boundaryLine.rotation.x = -Math.PI / 2;
  scene.add(boundaryLine);

  // 2. Extrude Existing Buildings
  if (footprintsData && footprintsData.length > 0) {
    footprintsData.forEach(feat => {
      if (!feat.the_geom || !feat.the_geom.coordinates) return;

      const type = feat.the_geom.type;
      const coords = feat.the_geom.coordinates;
      let rings = [];

      if (type === "MultiPolygon") {
        rings = coords[0];
      } else if (type === "Polygon") {
        rings = coords;
      }

      if (rings.length === 0) return;

      // Extract outer ring points
      const outerRing = rings[0];
      const shapePoints = [];
      outerRing.forEach(pt => {
        const local = getLocalCoordinates(pt[0], pt[1], centerLon, centerLat);
        shapePoints.push(new THREE.Vector2(local.x, local.y));
      });

      // Extrude parameters
      const bldgHeight = parseFloat(feat.height_roof) || (parseFloat(plutoData.numfloors) * 12) || 30;
      
      const bldgShape = new THREE.Shape(shapePoints);
      const extrudeSettings = {
        depth: bldgHeight,
        bevelEnabled: false
      };

      const bldgGeom = new THREE.ExtrudeGeometry(bldgShape, extrudeSettings);
      const bldgMat = new THREE.MeshStandardMaterial({
        color: 0x2e355c,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85
      });
      const bldgMesh = new THREE.Mesh(bldgGeom, bldgMat);
      
      // Rotate to match 3D standard y-up axis
      bldgMesh.rotation.x = -Math.PI / 2;
      bldgMesh.castShadow = true;
      bldgMesh.receiveShadow = true;

      // Wireframe overlay for premium visual style
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.15
      });
      const wireMesh = new THREE.Mesh(bldgGeom, wireMat);
      bldgMesh.add(wireMesh);

      buildingsGroup.add(bldgMesh);
    });
  }

  // 3. Render Proposed Maximum Development Massing (utilizing full ZFA)
  if (proposedMesh) scene.remove(proposedMesh);
  proposedMesh = new THREE.Group();

  if (zoningRules) {
    const lotArea = parseInt(plutoData.lotarea, 10) || 0;
    const maxFar = Math.max(zoningRules.resFar, zoningRules.commFar, zoningRules.facilFar);
    let maxAllowedArea = lotArea * maxFar;

    // Show maximized development potential with Inclusionary Housing bonus if available
    if (zoningRules.ihFar) {
      maxAllowedArea = lotArea * zoningRules.ihFar;
    }

    const baseHeight = zoningRules.baseHeight || 60;
    const baseFloors = Math.max(Math.floor(baseHeight / 12), 1);
    
    const baseScale = Math.sqrt(0.80); // ~0.894 (80% base coverage)
    const baseCoords = boundaryCoords.map(p => new THREE.Vector2(p.x * baseScale, p.y * baseScale));
    const baseShape = new THREE.Shape(baseCoords);
    const baseFootprintArea = lotArea * 0.80;
    const baseZFA = baseFootprintArea * baseFloors;

    const propMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00, // amber orange
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    });

    const propWireMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      wireframe: true,
      transparent: true,
      opacity: 0.25
    });

    if (maxAllowedArea <= baseZFA) {
      // Single block up to proposed height
      const propHeight = baseFootprintArea > 0 ? (maxAllowedArea / baseFootprintArea) * 12 : 30;
      const propBaseGeom = new THREE.ExtrudeGeometry(baseShape, {
        depth: propHeight,
        bevelEnabled: false
      });
      const propBaseMesh = new THREE.Mesh(propBaseGeom, propMat);
      propBaseMesh.rotation.x = -Math.PI / 2;
      propBaseMesh.castShadow = true;
      propBaseMesh.receiveShadow = true;

      const propWire = new THREE.Mesh(propBaseGeom, propWireMat);
      propBaseMesh.add(propWire);
      proposedMesh.add(propBaseMesh);
    } else {
      // 1. Street wall base block up to base height
      const propBaseGeom = new THREE.ExtrudeGeometry(baseShape, {
        depth: baseHeight,
        bevelEnabled: false
      });
      const propBaseMesh = new THREE.Mesh(propBaseGeom, propMat);
      propBaseMesh.rotation.x = -Math.PI / 2;
      propBaseMesh.castShadow = true;
      propBaseMesh.receiveShadow = true;

      const propBaseWire = new THREE.Mesh(propBaseGeom, propWireMat);
      propBaseMesh.add(propBaseWire);
      proposedMesh.add(propBaseMesh);

      // 2. Tower block on top
      const remainingZFA = maxAllowedArea - baseZFA;
      const towerScale = Math.sqrt(0.40); // ~0.632 (40% coverage tower)
      const towerCoords = boundaryCoords.map(p => new THREE.Vector2(p.x * towerScale, p.y * towerScale));
      const towerShape = new THREE.Shape(towerCoords);
      const towerFootprintArea = lotArea * 0.40;
      const towerHeight = towerFootprintArea > 0 ? (remainingZFA / towerFootprintArea) * 12 : 30;

      const propTowerGeom = new THREE.ExtrudeGeometry(towerShape, {
        depth: towerHeight,
        bevelEnabled: false
      });
      const propTowerMesh = new THREE.Mesh(propTowerGeom, propMat);
      propTowerMesh.position.z = baseHeight; // Position on top of base along local Z (upward)
      propTowerMesh.castShadow = true;
      propTowerMesh.receiveShadow = true;

      const propTowerWire = new THREE.Mesh(propTowerGeom, propWireMat);
      propTowerMesh.add(propTowerWire);
      propBaseMesh.add(propTowerMesh);
    }

    scene.add(proposedMesh);
  }

  // 4. Render Allowable Zoning Envelope
  if (zoningRules) {
    const baseHeight = zoningRules.baseHeight || 60;
    const slope = zoningRules.skyExposurePlaneSlope || 2.7;
    const envelopeHeight = zoningRules.maxBuildingHeight || 300;

    // We build the envelope mesh: Bottom chunk (straight box to base height) and top chunk (tapered)
    const envelopeShape = new THREE.Shape(boundaryCoords);
    
    // Extrude Straight Box to Base Height
    const envelopeBaseGeom = new THREE.ExtrudeGeometry(envelopeShape, {
      depth: baseHeight,
      bevelEnabled: false
    });
    
    const envelopeMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });

    const envelopeBaseMesh = new THREE.Mesh(envelopeBaseGeom, envelopeMat);
    envelopeBaseMesh.rotation.x = -Math.PI / 2;
    envelopeBaseMesh.castShadow = false;

    // Base wireframe
    const envelopeWire = new THREE.Mesh(envelopeBaseGeom, new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.25
    }));
    envelopeBaseMesh.add(envelopeWire);

    // Group it
    envelopeMesh = new THREE.Group();
    envelopeMesh.add(envelopeBaseMesh);

    // If no absolute limit (contextual height), taper the top using standard sky exposure plane geometry
    if (!zoningRules.contextual) {
      // Setup tapered geometry
      const topHeight = envelopeHeight - baseHeight;
      
      // Calculate scaled boundary to represent setback
      const setbackAmt = topHeight / slope;
      const taperedCoords = [
        new THREE.Vector2(Math.min(minX + setbackAmt, 0), Math.min(minY + setbackAmt, 0)),
        new THREE.Vector2(Math.max(maxX - setbackAmt, 0), Math.min(minY + setbackAmt, 0)),
        new THREE.Vector2(Math.max(maxX - setbackAmt, 0), Math.max(maxY - setbackAmt, 0)),
        new THREE.Vector2(Math.min(minX + setbackAmt, 0), Math.max(maxY - setbackAmt, 0))
      ];

      const taperedShape = new THREE.Shape(taperedCoords);
      const taperedGeom = new THREE.ExtrudeGeometry(taperedShape, {
        depth: topHeight,
        bevelEnabled: false
      });

      const taperedMesh = new THREE.Mesh(taperedGeom, envelopeMat);
      taperedMesh.position.z = baseHeight; // Stack on top of base height
      
      const taperedWire = new THREE.Mesh(taperedGeom, new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.25
      }));
      taperedMesh.add(taperedWire);

      envelopeBaseMesh.add(taperedMesh);
    } else {
      // If contextual, just build straight box to maximum height
      const contextualGeom = new THREE.ExtrudeGeometry(envelopeShape, {
        depth: envelopeHeight - baseHeight,
        bevelEnabled: false
      });
      const contextualMesh = new THREE.Mesh(contextualGeom, envelopeMat);
      contextualMesh.position.z = baseHeight;
      
      const contextualWire = new THREE.Mesh(contextualGeom, new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.2
      }));
      contextualMesh.add(contextualWire);
      envelopeBaseMesh.add(contextualMesh);
    }

    scene.add(envelopeMesh);
  }

  // Adjust camera to look at the lot, framing dynamically based on maximum height
  const maxBldgHeight = parseFloat(plutoData.numfloors) * 12 || 300;
  const envelopeHeight = (zoningRules && zoningRules.maxBuildingHeight) || 300;
  const maxHeight = Math.max(maxBldgHeight, envelopeHeight, 100);

  // Point camera target slightly up (e.g. 30% of the building height) to center the massing
  controls.target.set(0, maxHeight * 0.3, 0);
  
  // Set camera height and distance proportional to the max dimensions (footprint vs height)
  const maxDim = Math.max(lotDepth, lotWidth, maxHeight);
  camera.position.set(0, maxDim * 1.2, maxDim * 1.6);
  controls.update();
}

// 3D Controls Visibility Toggles
document.querySelector('.view-controls-3d').addEventListener('click', (e) => {
  if (!e.target.classList.contains('control-btn')) return;

  // Toggle active class
  document.querySelectorAll('.control-btn').forEach(btn => btn.classList.remove('active'));
  e.target.classList.add('active');

  const view = e.target.dataset.view;

  // Set visibilities
  if (view === 'all') {
    if (lotMesh) lotMesh.visible = true;
    if (buildingsGroup) buildingsGroup.visible = true;
    if (envelopeMesh) envelopeMesh.visible = true;
    if (proposedMesh) proposedMesh.visible = true;
  } else if (view === 'proposed') {
    if (lotMesh) lotMesh.visible = true;
    if (buildingsGroup) buildingsGroup.visible = false;
    if (envelopeMesh) envelopeMesh.visible = false;
    if (proposedMesh) proposedMesh.visible = true;
  } else if (view === 'envelope') {
    if (lotMesh) lotMesh.visible = true;
    if (buildingsGroup) buildingsGroup.visible = false;
    if (envelopeMesh) envelopeMesh.visible = true;
    if (proposedMesh) proposedMesh.visible = false;
  } else if (view === 'built') {
    if (lotMesh) lotMesh.visible = true;
    if (buildingsGroup) buildingsGroup.visible = true;
    if (envelopeMesh) envelopeMesh.visible = false;
    if (proposedMesh) proposedMesh.visible = false;
  }
});

// Formatter Helpers
const formatCurrency = (val) => {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === 'string') return val;
  const sign = val < 0 ? "-" : "";
  return sign + "$" + Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const formatPercent = (val) => {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === 'string') return val;
  return (val * 100).toFixed(2) + "%";
};

const formatNumber = (val) => {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === 'string') return val;
  return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const formatDec = (val) => {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === 'string') return val;
  return val.toFixed(2);
};

// Saved Locations Storage Helper
function getSavedLocations() {
  try {
    const saved = localStorage.getItem('sitepro_saved_locations');
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    console.error('Error reading saved locations:', e);
    return [];
  }
}

function saveSavedLocations(locations) {
  try {
    localStorage.setItem('sitepro_saved_locations', JSON.stringify(locations));
  } catch (e) {
    console.error('Error saving locations:', e);
  }
}

function renderSavedLocationsList() {
  const container = document.getElementById('saved-locations-container');
  const listElement = document.getElementById('saved-locations-list');
  if (!container || !listElement) return;

  const saved = getSavedLocations();
  if (saved.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  listElement.innerHTML = saved.map((loc, idx) => `
    <div class="saved-location-item" data-index="${idx}">
      <span class="saved-location-name" title="${loc.addressName}">${loc.addressName}</span>
      <button class="saved-location-delete" data-index="${idx}" title="Delete location">×</button>
    </div>
  `).join('');
}

function updateSaveButtonState() {
  const saveBtn = document.getElementById('save-location-btn');
  if (!saveBtn || !plutoData) return;

  saveBtn.style.display = 'flex';
  const saved = getSavedLocations();
  const currentAddress = currentAddressName || plutoData.address;
  const isSaved = saved.some(loc => loc.addressName === currentAddress);
  
  if (isSaved) {
    saveBtn.classList.add('saved');
    saveBtn.title = 'Remove from saved locations';
  } else {
    saveBtn.classList.remove('saved');
    saveBtn.title = 'Save this location';
  }
}

function setupSavedLocationsEvents() {
  const saveBtn = document.getElementById('save-location-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!plutoData) return;

      const currentAddress = currentAddressName || plutoData.address;
      let saved = getSavedLocations();
      const index = saved.findIndex(loc => loc.addressName === currentAddress);

      if (index > -1) {
        // Remove
        saved.splice(index, 1);
      } else {
        // Add
        saved.push({
          bbl: currentBBL,
          bin: plutoData.bin || null,
          addressName: currentAddress,
          lat: plutoData.latitude ? parseFloat(plutoData.latitude) : null,
          lon: plutoData.longitude ? parseFloat(plutoData.longitude) : null,
          isNonNyc: plutoData.isNonNyc || false,
          geojsonProps: plutoData.fallback && plutoData.isNonNyc ? {
            city: plutoData.city,
            state: plutoData.state,
            postcode: plutoData.postcode
          } : null
        });
      }

      saveSavedLocations(saved);
      updateSaveButtonState();
      renderSavedLocationsList();
    });
  }

  const listElement = document.getElementById('saved-locations-list');
  if (listElement) {
    listElement.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.saved-location-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const idx = parseInt(deleteBtn.dataset.index, 10);
        let saved = getSavedLocations();
        saved.splice(idx, 1);
        saveSavedLocations(saved);
        updateSaveButtonState();
        renderSavedLocationsList();
        return;
      }

      const item = e.target.closest('.saved-location-item');
      if (item) {
        const idx = parseInt(item.dataset.index, 10);
        const saved = getSavedLocations();
        const loc = saved[idx];
        if (loc) {
          loadSite(loc.bbl, loc.bin, loc.addressName, loc.lat, loc.lon, loc.geojsonProps);
        }
      }
    });
  }
}

// Contact Logs Database Helpers
const CONTACT_ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'sales-broker', label: 'Sales Broker' },
  { value: 'rental-broker', label: 'Rental Broker' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'title-company', label: 'Title Company' },
  { value: 'lawyer', label: 'Lawyer' },
  { value: 'attorney', label: 'Attorney' },
  { value: 'architect', label: 'Architect' },
  { value: 'mortgage-broker', label: 'Mortgage Broker' },
  { value: 'other', label: 'Other' }
];

function getContactsFromDOM() {
  const contactRows = document.querySelectorAll('.saved-contact-row');
  const contacts = [];
  contactRows.forEach(row => {
    const role = row.querySelector('.contact-role-select')?.value || 'other';
    const firstName = row.querySelector('.contact-first-name')?.value || '';
    const lastName = row.querySelector('.contact-last-name')?.value || '';
    const company = row.querySelector('.contact-company')?.value || '';
    const workPhone = row.querySelector('.contact-work-phone')?.value || '';
    const cellPhone = row.querySelector('.contact-cell-phone')?.value || '';
    const email = row.querySelector('.contact-email')?.value || '';
    const address = row.querySelector('.contact-address')?.value || '';

    contacts.push({
      firstName,
      lastName,
      role,
      company,
      workPhone,
      cellPhone,
      email,
      address
    });
  });
  return contacts;
}

function syncInteractionFields() {
  const spokeWithSelect = document.getElementById('log-spoke-with');
  if (!spokeWithSelect) return;

  const val = spokeWithSelect.value;
  const contactsData = getPropertyContactsData() || { contacts: [] };
  const savedContacts = contactsData.contacts || [];

  // Containers
  const customNameContainer = document.getElementById('log-custom-name-container');
  const customCompanyContainer = document.getElementById('log-custom-company-container');
  const customPhonesContainer = document.getElementById('log-custom-phones-container');
  const customEmailAddressContainer = document.getElementById('log-custom-email-address-container');

  // Fields to populate
  const roleSelect = document.getElementById('log-role');
  const companySelect = document.getElementById('log-company');
  const workPhoneSelect = document.getElementById('log-work-phone');
  const cellPhoneSelect = document.getElementById('log-cell-phone');
  const emailSelect = document.getElementById('log-email');
  const addressSelect = document.getElementById('log-address');

  if (val === 'other') {
    // Show custom fields
    if (customNameContainer) customNameContainer.style.display = 'block';
    
    // Set all other selects to "custom" and show their text inputs
    populateSelectWithOptions(roleSelect, CONTACT_ROLES, 'other');
    populateSelectWithOptions(companySelect, [{ value: 'custom', label: 'Custom...' }], 'custom');
    populateSelectWithOptions(workPhoneSelect, [{ value: 'custom', label: 'Custom...' }], 'custom');
    populateSelectWithOptions(cellPhoneSelect, [{ value: 'custom', label: 'Custom...' }], 'custom');
    populateSelectWithOptions(emailSelect, [{ value: 'custom', label: 'Custom...' }], 'custom');
    populateSelectWithOptions(addressSelect, [{ value: 'custom', label: 'Custom...' }], 'custom');

    if (customCompanyContainer) customCompanyContainer.style.display = 'block';
    if (customPhonesContainer) customPhonesContainer.style.display = 'grid';
    if (customEmailAddressContainer) customEmailAddressContainer.style.display = 'grid';
  } else {
    // Hide custom name container
    if (customNameContainer) customNameContainer.style.display = 'none';

    // Find selected contact details
    let selectedContact = null;
    if (val.startsWith('saved|')) {
      const parts = val.split('|');
      const fullName = parts[1];
      const role = parts[2];
      selectedContact = savedContacts.find(c => {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
        return name === fullName && c.role === role;
      });
    } else if (val.startsWith('contact|')) {
      const parts = val.split('|');
      const fullName = parts[1];
      const role = parts[2];
      const logs = contactsData.logs || [];
      const matchingLog = logs.find(log => {
        return log.spokeWith === fullName && log.role === role;
      });
      if (matchingLog) {
        selectedContact = {
          firstName: fullName.split(' ')[0] || '',
          lastName: fullName.split(' ').slice(1).join(' ') || '',
          role: matchingLog.role,
          company: matchingLog.company,
          workPhone: matchingLog.workPhone,
          cellPhone: matchingLog.cellPhone,
          email: matchingLog.email,
          address: matchingLog.address
        };
      }
    }

    const roleVal = selectedContact?.role || 'other';
    const companyVal = selectedContact?.company || '';
    const workPhoneVal = selectedContact?.workPhone || '';
    const cellPhoneVal = selectedContact?.cellPhone || '';
    const emailVal = selectedContact?.email || '';
    const addressVal = selectedContact?.address || '';

    // Populate Role
    populateSelectWithOptions(roleSelect, CONTACT_ROLES, roleVal);

    // Populate Company (contact's company, plus all other saved companies, plus custom)
    const companyOptions = getUniqueOptionsForField(savedContacts, 'company', companyVal);
    populateSelectWithOptions(companySelect, companyOptions, companyVal || 'none');

    // Populate Work Phone
    const workPhoneOptions = getUniqueOptionsForField(savedContacts, 'workPhone', workPhoneVal);
    populateSelectWithOptions(workPhoneSelect, workPhoneOptions, workPhoneVal || 'none');

    // Populate Cell Phone
    const cellPhoneOptions = getUniqueOptionsForField(savedContacts, 'cellPhone', cellPhoneVal);
    populateSelectWithOptions(cellPhoneSelect, cellPhoneOptions, cellPhoneVal || 'none');

    // Populate Email
    const emailOptions = getUniqueOptionsForField(savedContacts, 'email', emailVal);
    populateSelectWithOptions(emailSelect, emailOptions, emailVal || 'none');

    // Populate Address
    const addressOptions = getUniqueOptionsForField(savedContacts, 'address', addressVal);
    populateSelectWithOptions(addressSelect, addressOptions, addressVal || 'none');

    // Toggle custom containers based on initial select values
    toggleCustomInputsVisibility();
  }
}

function populateSelectWithOptions(selectElem, options, selectedValue) {
  if (!selectElem) return;
  selectElem.innerHTML = options.map(opt => {
    const selected = opt.value === selectedValue ? 'selected' : '';
    return `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
  }).join('');
}

function getUniqueOptionsForField(contacts, fieldName, contactValue) {
  const uniqueValues = new Set();
  if (contactValue && contactValue.trim()) uniqueValues.add(contactValue.trim());

  contacts.forEach(c => {
    const val = c[fieldName];
    if (val && val.trim()) {
      uniqueValues.add(val.trim());
    }
  });

  const options = [];
  if (contactValue && contactValue.trim()) {
    options.push({ value: contactValue, label: contactValue });
  } else {
    options.push({ value: 'none', label: 'None / Empty' });
  }

  uniqueValues.forEach(val => {
    if (val !== contactValue) {
      options.push({ value: val, label: val });
    }
  });

  options.push({ value: 'custom', label: 'Custom / New...' });
  return options;
}

function toggleCustomInputsVisibility() {
  const customCompanyContainer = document.getElementById('log-custom-company-container');
  const customPhonesContainer = document.getElementById('log-custom-phones-container');
  const customEmailAddressContainer = document.getElementById('log-custom-email-address-container');

  const companyVal = document.getElementById('log-company')?.value;
  const workPhoneVal = document.getElementById('log-work-phone')?.value;
  const cellPhoneVal = document.getElementById('log-cell-phone')?.value;
  const emailVal = document.getElementById('log-email')?.value;
  const addressVal = document.getElementById('log-address')?.value;

  if (customCompanyContainer) {
    customCompanyContainer.style.display = companyVal === 'custom' ? 'block' : 'none';
  }

  // Work Phone & Cell Phone
  const workPhoneGroup = document.getElementById('log-custom-work-phone')?.closest('.contacts-form-group');
  const cellPhoneGroup = document.getElementById('log-custom-cell-phone')?.closest('.contacts-form-group');
  if (workPhoneGroup) workPhoneGroup.style.display = workPhoneVal === 'custom' ? 'block' : 'none';
  if (cellPhoneGroup) cellPhoneGroup.style.display = cellPhoneVal === 'custom' ? 'block' : 'none';
  if (customPhonesContainer) {
    const showPhones = (workPhoneVal === 'custom' || cellPhoneVal === 'custom');
    customPhonesContainer.style.display = showPhones ? 'grid' : 'none';
  }

  // Email & Address
  const emailGroup = document.getElementById('log-custom-email')?.closest('.contacts-form-group');
  const addressGroup = document.getElementById('log-custom-address')?.closest('.contacts-form-group');
  if (emailGroup) emailGroup.style.display = emailVal === 'custom' ? 'block' : 'none';
  if (addressGroup) addressGroup.style.display = addressVal === 'custom' ? 'block' : 'none';
  if (customEmailAddressContainer) {
    const showEmailAddress = (emailVal === 'custom' || addressVal === 'custom');
    customEmailAddressContainer.style.display = showEmailAddress ? 'grid' : 'none';
  }
}

function getPropertyStorageKey() {
  if (!plutoData) return null;
  const key = plutoData.isNonNyc 
    ? plutoData.address.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() 
    : plutoData.bbl;
  return `sitepro_property_${key}`;
}

function getPropertyContactsData() {
  const key = getPropertyStorageKey();
  if (!key) return null;
  try {
    const data = localStorage.getItem(key);
    if (data) {
      const parsed = JSON.parse(data);
      if (!parsed.logs) parsed.logs = [];
      if (!parsed.contacts) {
        parsed.contacts = [];
        if (parsed.ownerFirstName || parsed.ownerLastName) {
          parsed.contacts.push({
            firstName: parsed.ownerFirstName || '',
            lastName: parsed.ownerLastName || '',
            role: 'owner'
          });
        }
        if (parsed.salesBrokerFirstName || parsed.salesBrokerLastName) {
          parsed.contacts.push({
            firstName: parsed.salesBrokerFirstName || '',
            lastName: parsed.salesBrokerLastName || '',
            role: 'sales-broker'
          });
        }
      }
      return parsed;
    }
  } catch (e) {
    console.error('Error reading contacts data:', e);
  }
  return {
    ownerFirstName: '',
    ownerLastName: '',
    salesBrokerFirstName: '',
    salesBrokerLastName: '',
    contacts: [],
    logs: []
  };
}

function savePropertyContactsData(data) {
  const key = getPropertyStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Error saving contacts data:', e);
  }
}


// Render Contact Logs & Details Tab Content
function renderContactsTab() {
  const contactsData = getPropertyContactsData() || {
    ownerFirstName: '',
    ownerLastName: '',
    salesBrokerFirstName: '',
    salesBrokerLastName: '',
    contacts: [],
    logs: []
  };

  // Safe fallback if contacts is not initialized
  if (!contactsData.contacts) {
    contactsData.contacts = [];
    if (contactsData.ownerFirstName || contactsData.ownerLastName) {
      contactsData.contacts.push({ firstName: contactsData.ownerFirstName || '', lastName: contactsData.ownerLastName || '', role: 'owner' });
    }
    if (contactsData.salesBrokerFirstName || contactsData.salesBrokerLastName) {
      contactsData.contacts.push({ firstName: contactsData.salesBrokerFirstName || '', lastName: contactsData.salesBrokerLastName || '', role: 'sales-broker' });
    }
  }

  const ownerName = [contactsData.ownerFirstName, contactsData.ownerLastName].filter(Boolean).join(' ');
  const brokerName = [contactsData.salesBrokerFirstName, contactsData.salesBrokerLastName].filter(Boolean).join(' ');

  const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;

  // Format datetime-local default value (YYYY-MM-DDTHH:MM)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const defaultDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;

  // Extract unique custom logged contacts from history
  const loggedContacts = [];
  const seenNames = new Set();

  if (ownerName) seenNames.add(ownerName.trim().toLowerCase());
  if (brokerName) seenNames.add(brokerName.trim().toLowerCase());

  contactsData.contacts.forEach(contact => {
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
    if (fullName) {
      seenNames.add(fullName.toLowerCase());
    }
  });

  if (contactsData.logs && contactsData.logs.length > 0) {
    for (const log of contactsData.logs) {
      if (log.spokeWith) {
        const cleanedName = log.spokeWith.trim();
        const nameLower = cleanedName.toLowerCase();
        
        // Skip default placeholders, "Other", and duplicates
        if (
          nameLower && 
          !seenNames.has(nameLower) && 
          nameLower !== 'property owner' && 
          nameLower !== 'sales broker' && 
          nameLower !== 'other'
        ) {
          seenNames.add(nameLower);
          loggedContacts.push({
            name: cleanedName,
            role: log.role || 'other'
          });
        }
      }
    }
  }

  // Format logged contacts as options
  const loggedOptions = loggedContacts.map(contact => {
    const formattedRole = contact.role 
      ? contact.role.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      : 'Other';
    const displayLabel = `${contact.name} (${formattedRole})`;
    const val = `contact|${contact.name}|${contact.role || 'other'}`;
    return `<option value="${val}">${displayLabel}</option>`;
  }).join('');

  // Format saved contacts as options
  const savedOptions = contactsData.contacts.map(contact => {
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
    const displayRole = CONTACT_ROLES.find(r => r.value === contact.role)?.label || 'Other';
    const displayLabel = fullName ? `${fullName} (${displayRole})` : `Unnamed (${displayRole})`;
    const val = `saved|${fullName || 'Unnamed'}|${contact.role}`;
    return `<option value="${val}">${displayLabel}</option>`;
  }).join('');

  // Build the Contact History HTML
  let logsHtml = '';
  if (contactsData.logs && contactsData.logs.length > 0) {
    const sortedLogs = [...contactsData.logs].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    
    logsHtml = sortedLogs.map((log) => {
      const formattedDate = new Date(log.dateTime).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
      
      const roleClass = (log.role || log.spokeWith || 'other').toLowerCase().replace(/\s+/g, '-');
      
      let displaySpokeWith = log.spokeWith;
      if (log.role && log.role !== 'other') {
        const roleLabel = log.role.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        const isPlaceholder = log.spokeWith.toLowerCase() === roleLabel.toLowerCase();
        if (!isPlaceholder && !log.spokeWith.endsWith(`(${roleLabel})`)) {
          displaySpokeWith = `${log.spokeWith} (${roleLabel})`;
        }
      }

      // Format details
      let contactDetailsHtml = '';
      const detailItems = [];
      if (log.company) detailItems.push(`🏢 <strong>Company:</strong> ${log.company}`);
      if (log.workPhone) detailItems.push(`📞 <strong>Work Phone:</strong> ${log.workPhone}`);
      if (log.cellPhone) detailItems.push(`📱 <strong>Cell:</strong> ${log.cellPhone}`);
      if (log.email) detailItems.push(`✉️ <strong>Email:</strong> <a href="mailto:${log.email}" style="color: var(--accent-cyan); text-decoration: none;">${log.email}</a>`);
      if (log.address) detailItems.push(`📍 <strong>Address:</strong> ${log.address}`);

      if (detailItems.length > 0) {
        contactDetailsHtml = `
          <div class="log-contact-details" style="font-size: 11px; color: var(--text-secondary); display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin-top: 6px; padding: 6px; background: rgba(255, 255, 255, 0.01); border-radius: 4px; border-left: 2px solid var(--accent-cyan); margin-bottom: 6px;">
            ${detailItems.map(item => `<div>${item}</div>`).join('')}
          </div>
        `;
      }
      
      return `
        <div class="log-item" style="border-left: 3px solid var(--border-color); padding-left: 12px;">
          <div class="log-header">
            <span class="contacts-badge badge-${roleClass}">${displaySpokeWith}</span>
            <span class="log-time">${formattedDate}</span>
          </div>
          ${contactDetailsHtml}
          <div class="log-notes" style="margin-top: 8px;">${log.notes || 'No details provided.'}</div>
          <div style="text-align: right; margin-top: 4px;">
            <button class="log-delete-btn" data-id="${log.id || log.dateTime}" title="Delete log entry">Delete Entry</button>
          </div>
        </div>
      `;
    }).join('');
  } else {
    logsHtml = `<p style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 24px 0;">No contact logs recorded yet.</p>`;
  }

  // Generate individual contact input fields with all fields
  const contactsInputsHtml = contactsData.contacts.length > 0
    ? contactsData.contacts.map((contact, index) => {
        const roleOptions = CONTACT_ROLES.map(role => {
          const selected = contact.role === role.value ? 'selected' : '';
          return `<option value="${role.value}" ${selected}>${role.label}</option>`;
        }).join('');

        return `
          <div class="saved-contact-row" data-index="${index}" style="margin-bottom: 16px; padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11px; font-weight: 600; color: var(--accent-cyan);">Contact #${index + 1}</span>
              <button type="button" class="remove-contact-btn" data-index="${index}" style="background: transparent; border: none; color: var(--accent-magenta); cursor: pointer; font-size: 11px; padding: 0;">✕ Remove</button>
            </div>
            
            <div class="contacts-form-row" style="margin-bottom: 8px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">First Name</label>
                <input type="text" class="contacts-input contact-first-name" placeholder="First Name" value="${contact.firstName || ''}">
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Last Name</label>
                <input type="text" class="contacts-input contact-last-name" placeholder="Last Name" value="${contact.lastName || ''}">
              </div>
            </div>

            <div class="contacts-form-row" style="margin-bottom: 8px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Role</label>
                <select class="contacts-input contact-role-select" style="height: 34px;">
                  ${roleOptions}
                </select>
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Company</label>
                <input type="text" class="contacts-input contact-company" placeholder="Company Name" value="${contact.company || ''}">
              </div>
            </div>

            <div class="contacts-form-row" style="margin-bottom: 8px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Work Phone</label>
                <input type="text" class="contacts-input contact-work-phone" placeholder="Work Phone" value="${contact.workPhone || ''}">
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Cell Phone</label>
                <input type="text" class="contacts-input contact-cell-phone" placeholder="Cell Phone" value="${contact.cellPhone || ''}">
              </div>
            </div>

            <div class="contacts-form-row" style="margin-bottom: 0;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Email</label>
                <input type="email" class="contacts-input contact-email" placeholder="Email Address" value="${contact.email || ''}">
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Address</label>
                <input type="text" class="contacts-input contact-address" placeholder="Mailing Address" value="${contact.address || ''}">
              </div>
            </div>
          </div>
        `;
      }).join('')
    : `<p style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 24px 0; margin: 0;">No saved contacts for this property.</p>`;

  reportPanel.innerHTML = `
    <!-- Property Contact Details Card -->
    <div class="section-card highlight" style="padding-bottom: 12px; min-height: 100%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div class="card-title" style="margin-bottom: 0;">
          <span>Contact Logs & History</span>
          <span style="font-size: 10px; color: var(--text-muted); display: block; margin-top: 4px; font-weight: normal;">${displayAddress}</span>
        </div>
        <button id="open-contacts-modal-btn" class="control-btn" style="padding: 6px 12px; font-size: 11px; height: auto;">Manage Contacts</button>
      </div>

      <!-- Contact Info Modal -->
      <div id="property-contacts-modal" class="contact-modal-overlay">
        <div class="contact-modal-content">
          <div class="contact-modal-header">
            <span class="contact-modal-title">Property Contact Info</span>
            <button class="contact-modal-close" id="close-contacts-modal-btn" type="button">✕</button>
          </div>
          <div class="contact-modal-body">
            <form id="property-contacts-form" onsubmit="event.preventDefault();">
              <div id="saved-contacts-list">
                ${contactsInputsHtml}
              </div>
              
              <button id="add-contact-field-btn" class="control-btn" type="button" style="width: 100%; margin-bottom: 12px; border-color: var(--accent-cyan); color: var(--accent-cyan); background: transparent;">+ Add Contact</button>
              
              <button id="save-contacts-btn" class="control-btn active" style="width: 100%; margin-top: 8px;">Save Contact Information</button>
              <div id="contacts-save-feedback"></div>
            </form>
          </div>
        </div>
      </div>

      <!-- Contact Logs History Subform -->
      <div style="padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 11px; font-weight: 600; color: var(--accent-cyan);">Interaction History</span>
          <button type="button" id="toggle-new-log-btn" style="background: transparent; border: 1px solid var(--accent-cyan); color: var(--accent-cyan); border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;">+ New Interaction</button>
        </div>
        
        <div id="new-log-form-container" style="display: none; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
          <form id="new-log-form" onsubmit="event.preventDefault();">
            <!-- Contact & Date -->
            <div class="contacts-form-row" style="margin-bottom: 12px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Who Spoke With? (Contact)</label>
                <select id="log-spoke-with" class="contacts-input" style="height: 34px;">
                  ${savedOptions}
                  ${loggedOptions}
                  <option value="other">Other / Custom Name...</option>
                </select>
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <label class="contacts-form-label" style="margin-bottom: 0;">Date & Time</label>
                  <button type="button" id="set-today-btn" style="background: transparent; border: none; color: var(--accent-cyan); cursor: pointer; font-size: 10px; padding: 0; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Today</button>
                </div>
                <input type="datetime-local" id="log-datetime" class="contacts-input" style="height: 34px; cursor: pointer;" value="${defaultDateTime}" onclick="this.showPicker()">
              </div>
            </div>
            
            <!-- Custom Name Input (Only shown if 'other' contact is selected) -->
            <div id="log-custom-name-container" class="contacts-form-group" style="margin-bottom: 12px; display: none;">
              <label class="contacts-form-label">Custom Contact Name</label>
              <input type="text" id="log-custom-name" class="contacts-input" placeholder="Enter contact name...">
            </div>

            <!-- Role & Company Dropdowns -->
            <div class="contacts-form-row" style="margin-bottom: 12px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Role</label>
                <select id="log-role" class="contacts-input" style="height: 34px;">
                  <!-- Populated by JS -->
                </select>
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Company</label>
                <select id="log-company" class="contacts-input" style="height: 34px;">
                  <!-- Populated by JS -->
                </select>
              </div>
            </div>
            <div id="log-custom-company-container" class="contacts-form-group" style="margin-bottom: 12px; display: none;">
              <label class="contacts-form-label">Custom Company</label>
              <input type="text" id="log-custom-company" class="contacts-input" placeholder="Enter custom company...">
            </div>

            <!-- Work Phone & Cell Phone Dropdowns -->
            <div class="contacts-form-row" style="margin-bottom: 12px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Work Phone</label>
                <select id="log-work-phone" class="contacts-input" style="height: 34px;">
                  <!-- Populated by JS -->
                </select>
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Cell Phone</label>
                <select id="log-cell-phone" class="contacts-input" style="height: 34px;">
                  <!-- Populated by JS -->
                </select>
              </div>
            </div>
            <div id="log-custom-phones-container" class="contacts-form-row" style="margin-bottom: 12px; display: none;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Custom Work Phone</label>
                <input type="text" id="log-custom-work-phone" class="contacts-input" placeholder="Enter custom work phone...">
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Custom Cell Phone</label>
                <input type="text" id="log-custom-cell-phone" class="contacts-input" placeholder="Enter custom cell phone...">
              </div>
            </div>

            <!-- Email & Address Dropdowns -->
            <div class="contacts-form-row" style="margin-bottom: 12px;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Email</label>
                <select id="log-email" class="contacts-input" style="height: 34px;">
                  <!-- Populated by JS -->
                </select>
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Address</label>
                <select id="log-address" class="contacts-input" style="height: 34px;">
                  <!-- Populated by JS -->
                </select>
              </div>
            </div>
            <div id="log-custom-email-address-container" class="contacts-form-row" style="margin-bottom: 12px; display: none;">
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Custom Email</label>
                <input type="email" id="log-custom-email" class="contacts-input" placeholder="Enter custom email...">
              </div>
              <div class="contacts-form-group" style="margin-bottom: 0;">
                <label class="contacts-form-label">Custom Address</label>
                <input type="text" id="log-custom-address" class="contacts-input" placeholder="Enter custom address...">
              </div>
            </div>
            
            <div class="contacts-form-group">
              <label class="contacts-form-label">Conversation Details / Notes</label>
              <textarea id="log-notes" class="contacts-textarea" placeholder="Summarize the discussion, next steps, or notes..."></textarea>
            </div>
            
            <button id="add-log-btn" class="control-btn" style="width: 100%; border-color: var(--accent-magenta); color: var(--accent-magenta); background: transparent;">Add Contact Log Entry</button>
          </form>
        </div>

        <div class="log-history-list">
          ${logsHtml}
        </div>
      </div>
    </div>
  `;

  // Initialize and synchronize fields
  syncInteractionFields();

  // Modal event listeners
  const modalOverlay = document.getElementById('property-contacts-modal');
  const openModalBtn = document.getElementById('open-contacts-modal-btn');
  const closeModalBtn = document.getElementById('close-contacts-modal-btn');

  if (openModalBtn && modalOverlay) {
    openModalBtn.addEventListener('click', () => {
      modalOverlay.classList.add('active');
    });
  }

  if (closeModalBtn && modalOverlay) {
    closeModalBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
      // Re-render tab on close to ensure new contacts appear in dropdowns
      renderContactsTab();
    });
  }

  // Close modal when clicking outside content
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.classList.remove('active');
        renderContactsTab();
      }
    });
  }
}

// Main Tab Router
function renderActiveTab() {
  // Toggle tab button UI state
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === activeTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const appContainer = document.querySelector('.app-container');

  if (activeTab === 'zoning') {
    if (appContainer) {
      appContainer.classList.remove('full-width-financials');
      // Trigger window resize event so Leaflet and Three.js adjust correctly
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        if (map) map.invalidateSize();
      }, 100);
    }
    renderZoningTab();
  } else if (activeTab === 'contacts') {
    if (appContainer) {
      appContainer.classList.remove('full-width-financials');
      // Trigger window resize event so Leaflet and Three.js adjust correctly
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        if (map) map.invalidateSize();
      }, 100);
    }
    renderContactsTab();
  } else {
    if (appContainer) {
      appContainer.classList.add('full-width-financials');
    }
    renderFinancialsTab();
  }
}

// Render Zoning & Massing Tab Content
function renderZoningTab() {
  const lotArea = parseInt(plutoData.lotarea, 10) || 0;
  const builtArea = parseInt(plutoData.bldgarea, 10) || 0;
  const builtFar = parseFloat(plutoData.builtfar) || 0;
  
  // Parse BBL components for DOB BIS linking
  const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
  const boro = bblStr.substring(0, 1);
  const block = String(parseInt(bblStr.substring(1, 6), 10) || plutoData.block || '');
  const lot = String(parseInt(bblStr.substring(6, 10), 10) || plutoData.lot || '');
  
  // Resolve zoning rules
  const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1) || {
    resFar: 0, commFar: 0, facilFar: 0, baseHeight: 60, contextual: false, maxBuildingHeight: 300
  };
  const devRights = calculateDevelopmentRights(lotArea, zoningRules);

  const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;
  const isSplit = plutoData.splitzone === 'Y' || plutoData.splitzone === true;

  // Calculate remaining floor area details based on maximum allowed FAR
  const maxFar = Math.max(zoningRules.resFar, zoningRules.commFar, zoningRules.facilFar);
  const maxAllowedArea = lotArea * maxFar;
  const remainingArea = Math.max(maxAllowedArea - builtArea, 0);
  const remainingFar = Math.max(maxFar - builtFar, 0).toFixed(2);

  // Generate ZAP Projects list (for NYC only)
  let zapHtml = '';
  if (!plutoData.isNonNyc) {
    if (zapProjects && zapProjects.length > 0) {
      zapHtml = zapProjects.map(proj => `
        <div class="project-item ${proj.project_status === 'Active' ? 'active' : ''}">
          <div class="project-header">
            <span>${proj.project_name}</span>
            <span style="color: ${proj.project_status === 'Active' ? 'var(--accent-green)' : 'var(--text-muted)'}">${proj.project_status}</span>
          </div>
          <div class="project-desc">${proj.project_brief || 'No description provided.'}</div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Filed: ${proj.app_filed_date ? proj.app_filed_date.substring(0, 10) : 'N/A'}</div>
        </div>
      `).join('');
    } else {
      zapHtml = `<p style="font-size: 12px; color: var(--text-muted);">No zoning applications found for this lot.</p>`;
    }
  }

  // Generate Local Government Agency Portals
  const city = plutoData.city || (plutoData.isNonNyc ? "" : "New York");
  const state = plutoData.state || (plutoData.isNonNyc ? "" : "NY");
  const postcode = plutoData.postcode || "";
  const agencies = getLocalGovernmentAgencies(displayAddress, city, state, postcode);

  const localPortalsCard = `
    <div class="section-card highlight">
      <div class="card-title">🏛️ Local Government Portals (${city || 'Local'}, ${state || 'Agency'})</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">
        Queries are automatically pre-formatted and sent out to the local portals serving this property.
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <!-- Building Dept -->
        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 11px; font-weight: 600; color: #fff;">Building & Permits</span>
            <span style="font-size: 10px; color: var(--accent-cyan);">${agencies.building.name}</span>
          </div>
          <p style="font-size: 10px; color: var(--text-secondary); margin: 0 0 6px 0;">Search building permits, violations, and certificate of occupancy.</p>
          <a class="control-btn" style="text-align: center; text-decoration: none; display: inline-block; padding: 4px 10px; font-size: 11px;" 
             href="${agencies.building.url}" target="_blank" rel="noreferrer" referrerpolicy="no-referrer">
             Query Building Dept ↗
          </a>
        </div>

        <!-- Housing Dept -->
        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 11px; font-weight: 600; color: #fff;">Housing & Community</span>
            <span style="font-size: 10px; color: var(--accent-magenta);">${agencies.housing.name}</span>
          </div>
          <p style="font-size: 10px; color: var(--text-secondary); margin: 0 0 6px 0;">Search owner information, rent regulations, or building complaints.</p>
          <a class="control-btn" style="text-align: center; text-decoration: none; display: inline-block; padding: 4px 10px; font-size: 11px; border-color: var(--accent-magenta); color: var(--accent-magenta); background: transparent;" 
             href="${agencies.housing.url}" target="_blank" rel="noreferrer" referrerpolicy="no-referrer">
             Query Housing Dept ↗
          </a>
        </div>

        <!-- Planning & Zoning -->
        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 11px; font-weight: 600; color: #fff;">Planning & Zoning Code</span>
            <span style="font-size: 10px; color: var(--accent-amber);">${agencies.planning.name}</span>
          </div>
          <p style="font-size: 10px; color: var(--text-secondary); margin: 0 0 6px 0;">Search zoning maps, land use constraints, and setbacks.</p>
          <a class="control-btn" style="text-align: center; text-decoration: none; display: inline-block; padding: 4px 10px; font-size: 11px; border-color: var(--accent-amber); color: var(--accent-amber); background: transparent;" 
             href="${agencies.planning.url}" target="_blank" rel="noreferrer" referrerpolicy="no-referrer">
             Query Planning Dept ↗
          </a>
        </div>
      </div>
    </div>
  `;

  // Render Screen HTML (without print-only sections, as those will be compiled globally in print-package)
  reportPanel.innerHTML = `
    <!-- General Lot Details Card -->
    <div class="section-card highlight">
      <div class="card-title">
        <span>Site Profile</span>
        <span style="font-size: 10px; color: var(--text-muted);">${plutoData.isNonNyc ? 'US Property' : `BBL: ${bblStr}`}</span>
      </div>
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">Address</span>
          <span class="info-value" style="font-weight: 700; color: #fff;">${displayAddress}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Zoning District</span>
          <span class="info-value highlight-cyan">${plutoData.zonedist1} ${plutoData.zonedist2 ? ' / ' + plutoData.zonedist2 : ''}</span>
        </div>
        ${plutoData.spdist1 ? `
        <div class="info-row">
          <span class="info-label">Special District</span>
          <span class="info-value highlight-magenta">${plutoData.spdist1}</span>
        </div>` : ''}
        <div class="info-row">
          <span class="info-label">Split Zone?</span>
          <span class="info-value">${isSplit ? '⚠️ Yes (Complex Rules)' : 'No'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Lot Area</span>
          <span class="info-value">${lotArea.toLocaleString()} sq ft</span>
        </div>
        <div class="info-row">
          <span class="info-label">Lot Dimensions</span>
          <span class="info-value">${parseFloat(plutoData.lotfront)}' x ${parseFloat(plutoData.lotdepth)}'</span>
        </div>
        <div class="info-row">
          <span class="info-label">Landmark Status</span>
          <span class="info-value" style="color: ${plutoData.landmark ? 'var(--accent-amber)' : 'inherit'}">${plutoData.landmark || 'None'}</span>
        </div>
      </div>
    </div>

    <!-- FAR Comparison Card -->
    <div class="section-card">
      <div class="card-title">Zoning Floor Area Ratio (FAR)</div>
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">Residential Max FAR</span>
          <span class="info-value">${zoningRules.resFar.toFixed(2)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Commercial Max FAR</span>
          <span class="info-value">${zoningRules.commFar.toFixed(2)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Facility Max FAR</span>
          <span class="info-value">${zoningRules.facilFar.toFixed(2)}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 4px;">
          <span class="info-label">Current Built FAR</span>
          <span class="info-value highlight-magenta">${builtFar.toFixed(2)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Remaining FAR</span>
          <span class="info-value highlight-cyan">${remainingFar}</span>
        </div>
      </div>

      <!-- Built vs Remaining Visualizer -->
      <div class="far-visual-container">
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span style="color: var(--accent-magenta);">Built: ${Math.round((builtFar / Math.max(maxFar, 0.1)) * 100)}%</span>
          <span style="color: var(--accent-cyan);">Remaining: ${Math.max(100 - Math.round((builtFar / Math.max(maxFar, 0.1)) * 100), 0)}%</span>
        </div>
        <div class="far-bar-wrapper">
          <div class="far-bar-fill built" style="width: ${Math.min((builtFar / Math.max(maxFar, 0.1)) * 100, 100)}%; position: absolute; left: 0;"></div>
          <div class="far-bar-fill remaining" style="width: ${Math.min((Math.max(maxFar - builtFar, 0) / Math.max(maxFar, 0.1)) * 100, 100)}%; position: absolute; left: ${Math.min((builtFar / Math.max(maxFar, 0.1)) * 100, 100)}%;"></div>
        </div>
      </div>
    </div>

    <!-- Allowable Areas Card -->
    <div class="section-card">
      <div class="card-title">Development Rights</div>
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">Max Allowed Floor Area</span>
          <span class="info-value">${maxAllowedArea.toLocaleString()} sq ft</span>
        </div>
        <div class="info-row">
          <span class="info-label">Existing Built Area</span>
          <span class="info-value highlight-magenta">${builtArea.toLocaleString()} sq ft</span>
        </div>
        <div class="info-row" style="border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 4px;">
          <span class="info-label">Unused Floor Area (Air Rights)</span>
          <span class="info-value highlight-cyan">${remainingArea.toLocaleString()} sq ft</span>
        </div>
        <div class="info-row">
          <span class="info-label">Max Base Street Wall Height</span>
          <span class="info-value">${zoningRules.baseHeight}'</span>
        </div>
        <div class="info-row">
          <span class="info-label">Contextual Height Cap?</span>
          <span class="info-value">${zoningRules.contextual ? `${zoningRules.maxBuildingHeight}' Limit` : 'Sky Exposure Plane'}</span>
        </div>
      </div>
    </div>

    <!-- ZAP Applications Card (NYC only) -->
    ${!plutoData.isNonNyc ? `
    <div class="section-card">
      <div class="card-title">Zoning Applications (ZAP)</div>
      <div class="project-list">
        ${zapHtml}
      </div>
    </div>` : ''}

    <!-- Local Government Portals Card -->
    ${localPortalsCard}

    <!-- Report Actions -->
    <div class="section-card" style="margin-bottom: 24px;">
      <div class="card-title">Report & Presentation</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <a class="control-btn" style="text-align: center; text-decoration: none; display: block; border-color: var(--accent-magenta); color: var(--accent-magenta); background: transparent;" 
           onclick="window.print()">
           Print Presentation PDF Report
        </a>
      </div>
    </div>
  `;

  // Render print package and append to report panel (invisible on screen)
  const printDiv = document.createElement('div');
  printDiv.className = 'print-only';
  printDiv.innerHTML = renderPrintPackage();
  reportPanel.appendChild(printDiv);
}

// Render Financial Underwriting Tab Content
function renderFinancialsTab() {
  const lotArea = parseInt(plutoData.lotarea, 10) || 0;
  const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1) || {
    resFar: 0, commFar: 0, facilFar: 0, baseHeight: 60, contextual: false, maxBuildingHeight: 300
  };
  
  const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
  const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;

  // Retrieve Underwriting dataset: use activeUnderwritingData
  if (!activeUnderwritingData) {
    if (bblStr === "1017230017") {
      activeUnderwritingData = JSON.parse(JSON.stringify(financialData));
      activeUnderwritingData.abatementSummary = {
        ...activeUnderwritingData.abatementSummary,
        ...activeUnderwritingAssumptions
      };
      
      const initManual = (list) => {
        if (!list) return;
        list.forEach(item => {
          if (!item.basis) item.basis = "Manual";
          if (item.rate === undefined) item.rate = 0;
        });
      };
      initManual(activeUnderwritingData.acquisitionCosts);
      initManual(activeUnderwritingData.hardCosts);
      initManual(activeUnderwritingData.softCosts);
      initManual(activeUnderwritingData.financingCosts);
      initManual(activeUnderwritingData.interestCarryCosts);
    } else {
      activeUnderwritingData = estimateFinancials(lotArea, zoningRules, displayAddress, bblStr, activeUnderwritingAssumptions);
    }
  }
  let fData = activeUnderwritingData;

  // Create Screen Layout
  reportPanel.innerHTML = `
    <!-- Underwriting Source Verification Header -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
      <h3 style="font-family: var(--font-display); font-size: 13px; font-weight: 700; color: #fff; text-transform: uppercase;">Underwriting Model</h3>
      <span class="badge-indicator ${fData.isEstimate ? 'estimated' : 'verified'}">
        ${fData.isEstimate ? 'AI Estimated Proforma' : 'Verified Excel Model'}
      </span>
    </div>

    <!-- Financial Sub-Nav (Pills) -->
    <div class="financial-sub-nav">
      <button class="sub-pill-btn ${activeFinancialSubTab === 'summary' ? 'active' : ''}" data-subtab="summary">Summary</button>
      <button class="sub-pill-btn ${activeFinancialSubTab === 'rentroll' ? 'active' : ''}" data-subtab="rentroll">Rent Roll</button>
      <button class="sub-pill-btn ${activeFinancialSubTab === 'budget' ? 'active' : ''}" data-subtab="budget">Development Budget</button>
      <button class="sub-pill-btn ${activeFinancialSubTab === 'abatement' ? 'active' : ''}" data-subtab="abatement">421(a) Abatement</button>
      <button class="sub-pill-btn ${activeFinancialSubTab === 'assumptions' ? 'active' : ''}" data-subtab="assumptions">Assumptions & Formulas</button>
    </div>

    <!-- Active Sub-tab Container -->
    <div id="financials-view-container">
      ${renderFinancialsSubTabContent(fData)}
    </div>

    <!-- Print Button for Underwriting -->
    <div class="section-card" style="margin-bottom: 24px; margin-top: 16px;">
      <a class="control-btn" style="text-align: center; text-decoration: none; display: block; border-color: var(--accent-cyan); color: var(--accent-cyan); background: transparent;" 
         onclick="window.print()">
         Print Presentation PDF Report
      </a>
    </div>
  `;

  // Render print package and append to report panel (invisible on screen)
  const printDiv = document.createElement('div');
  printDiv.className = 'print-only';
  printDiv.innerHTML = renderPrintPackage();
  reportPanel.appendChild(printDiv);
}

// Generate HTML Content for the Active Financial Sub-tab
function renderFinancialsSubTabContent(fData = null) {
  if (!fData) {
    if (!activeUnderwritingData) {
      const lotArea = parseInt(plutoData.lotarea, 10) || 0;
      const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1);
      const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
      const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;
      if (bblStr === "1017230017") {
        activeUnderwritingData = JSON.parse(JSON.stringify(financialData));
        activeUnderwritingData.abatementSummary = {
          ...activeUnderwritingData.abatementSummary,
          ...activeUnderwritingAssumptions
        };
        const initManual = (list) => {
          if (!list) return;
          list.forEach(item => {
            if (!item.basis) item.basis = "Manual";
            if (item.rate === undefined) item.rate = 0;
          });
        };
        initManual(activeUnderwritingData.acquisitionCosts);
        initManual(activeUnderwritingData.hardCosts);
        initManual(activeUnderwritingData.softCosts);
        initManual(activeUnderwritingData.financingCosts);
        initManual(activeUnderwritingData.interestCarryCosts);
      } else {
        activeUnderwritingData = estimateFinancials(lotArea, zoningRules, displayAddress, bblStr, activeUnderwritingAssumptions);
      }
    }
    fData = activeUnderwritingData;
  }

  const lotArea = parseInt(plutoData.lotarea, 10) || 0;
  const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1) || {
    resFar: 0, commFar: 0, facilFar: 0, baseHeight: 60, contextual: false, maxBuildingHeight: 300
  };
  const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
  const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;
  
  const as = fData.abatementSummary || {};
  const fmRentMo = parseFloat(as.fmRentMo) || 0;
  const hpdRentMo = parseFloat(as.hpdRentMo) || 0;
  const commRentSf = parseFloat(as.commRentSf) || 0;
  const landCostSf = parseFloat(as.landCostSf) || 0;
  const hardCostGsf = parseFloat(as.hardCostGsf) || 0;
  const priorAv = parseFloat(as.priorAv) || 0;
  const discountRate = parseFloat(as.discountRate) || 0;
  const avGrowthRate = as.avGrowthRate !== undefined ? parseFloat(as.avGrowthRate) : 0.02;
  const taxRateGrowth = as.taxRateGrowth !== undefined ? parseFloat(as.taxRateGrowth) : 0.005;
  const capRate = parseFloat(fData.valuationSummary.capRate) || parseFloat(as.capRate) || 0.0575;
  const ltc = parseFloat(fData.capitalization.ltc) || parseFloat(as.ltc) || 0.71;

  const fmVacancy = as.fmVacancy !== undefined ? parseFloat(as.fmVacancy) : 0.05;
  const hpdVacancy = as.hpdVacancy !== undefined ? parseFloat(as.hpdVacancy) : 0.02;
  const commVacancy = as.commVacancy !== undefined ? parseFloat(as.commVacancy) : 0.07;

  const fmPct = as.fmPct !== undefined ? parseFloat(as.fmPct) : 0.70;
  const studioPct = as.studioPct !== undefined ? parseFloat(as.studioPct) : 0.15;
  const oneBedPct = as.oneBedPct !== undefined ? parseFloat(as.oneBedPct) : 0.45;
  const twoBedPct = as.twoBedPct !== undefined ? parseFloat(as.twoBedPct) : 0.40;

  const fmStudioRatio = as.fmStudioRatio !== undefined ? parseFloat(as.fmStudioRatio) : 0.707;
  const fmOneBedRatio = as.fmOneBedRatio !== undefined ? parseFloat(as.fmOneBedRatio) : 0.909;
  const fmTwoBedRatio = as.fmTwoBedRatio !== undefined ? parseFloat(as.fmTwoBedRatio) : 1.212;

  const hpdStudioRatio = as.hpdStudioRatio !== undefined ? parseFloat(as.hpdStudioRatio) : 0.857;
  const hpdOneBedRatio = as.hpdOneBedRatio !== undefined ? parseFloat(as.hpdOneBedRatio) : 0.937;
  const hpdTwoBedRatio = as.hpdTwoBedRatio !== undefined ? parseFloat(as.hpdTwoBedRatio) : 1.124;

  if (activeFinancialSubTab === 'summary') {
    // 1. SUMMARY SUB-TAB RENDERER
    const ltv = fData.capitalization.stabilizedLtv;
    const dy = fData.capitalization.stabilizedDy;
    const yoc = fData.capitalization.stabilizedYoC;

    // Stacked Sources Bar Calculations
    const loanPct = fData.sources[0].percent * 100;
    const equityPct = fData.sources[1].percent * 100;

    // Stacked Uses Bar Calculations
    const acqPct = fData.uses[0].percent * 100;
    const hardPct = fData.uses[1].percent * 100;
    const softPct = fData.uses[2].percent * 100;
    const finPct = fData.uses[3].percent * 100;
    const carryPct = fData.uses[4].percent * 100;

    return `
      <!-- Big Metrics Display Grid -->
      <div class="metric-grid-3">
        <div class="metric-card highlight-cyan">
          <span class="metric-label">Stabilized NOI</span>
          <span class="metric-val" style="font-size: 11px;">${formatCurrency(fData.valuationSummary.proformaNoiAbated)}</span>
        </div>
        <div class="metric-card highlight-amber">
          <span class="metric-label">Cap Rate</span>
          <span class="metric-val" style="display: flex; align-items: center; justify-content: center; gap: 2px;">
            <input type="number" step="0.1" class="inline-edit-input" data-param="capRate" value="${(capRate * 100).toFixed(2)}" style="width: 55px;" />%
          </span>
        </div>
        <div class="metric-card highlight-magenta">
          <span class="metric-label">Stabilized Value</span>
          <span class="metric-val" style="font-size: 11px;">${formatCurrency(fData.valuationSummary.totalStabilizedValue)}</span>
        </div>
      </div>

      <!-- Key Underwriting Ratios -->
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--text-primary);">Underwriting Ratios</div>
        <div class="info-grid" style="gap: 8px;">
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Stabilized Loan-to-Value (LTV)</span>
            <span class="info-value highlight-cyan" style="display: flex; align-items: center; gap: 2px;">
              <input type="number" step="0.5" class="inline-edit-input" data-param="ltc" value="${(ltc * 100).toFixed(1)}" style="width: 48px; text-align: right;" />%
            </span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Stabilized Debt Yield (DY)</span>
            <span class="info-value highlight-magenta">${formatPercent(dy)}</span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Yield on Cost (YoC)</span>
            <span class="info-value highlight-amber">${formatPercent(yoc)}</span>
          </div>
        </div>
      </div>

      <!-- Capitalization Overview Card -->
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--text-primary);">Project Capitalization</div>
        <div class="info-grid" style="gap: 8px;">
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Total Project Cost</span>
            <span class="info-value" style="font-weight: 700;">${formatCurrency(fData.capitalization.developmentCapitalization)}</span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Senior Construction Loan</span>
            <span class="info-value highlight-magenta" style="display: flex; align-items: center; gap: 2px;">
              $<input type="number" step="100000" class="inline-capitalization-input" data-field="constructionLoan" value="${Math.round(fData.capitalization.constructionLoan)}" style="width: 85px; text-align: right;" />
            </span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Sponsor Equity Invested</span>
            <span class="info-value highlight-cyan">${formatCurrency(fData.sources[1].totalCost)}</span>
          </div>
        </div>
      </div>

      <!-- Operating Expenses Card -->
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
          <span>Operating Expenses</span>
          <span class="highlight-magenta">${formatCurrency(Math.abs(fData.totalExpenses.total))}</span>
        </div>
        <div class="budget-list-scroll" style="max-height: 180px;">
          ${fData.expenses.map((e, idx) => {
            const isCalculated = e.name.includes("Taxes") || e.name.includes("Management Fee");
            if (isCalculated) {
              return `
                <div class="budget-list-item" style="opacity: 0.85;">
                  <span class="budget-item-name" style="color: var(--text-muted); font-size: 10px;">${e.name}</span>
                  <span class="budget-item-val" style="color: var(--text-muted); font-size: 10px;">${formatCurrency(e.total)}</span>
                </div>
              `;
            } else {
              return `
                <div class="budget-list-item">
                  <span class="budget-item-name">${e.name}</span>
                  <span class="budget-item-val" style="display: flex; align-items: center; gap: 4px;">
                    $<input type="number" class="inline-expense-input" data-index="${idx}" value="${Math.round(Math.abs(e.total))}" style="width: 65px; text-align: right;" />
                  </span>
                </div>
              `;
            }
          }).join('')}
        </div>
      </div>

      <!-- Sources & Uses Visual Progress Stacked Bars -->
      <div class="section-card" style="padding: 12px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--text-primary);">Sources & Uses Breakdown</div>
        
        <!-- Sources Stacked Bar -->
        <div class="stacked-bar-container">
          <div class="stacked-bar-label">
            <span style="color: var(--text-secondary);">Sources of Funds</span>
          </div>
          <div class="stacked-bar">
            <div class="stacked-bar-segment" style="width: ${loanPct}%; background: linear-gradient(90deg, #ff007f, #c084fc);"></div>
            <div class="stacked-bar-segment" style="width: ${equityPct}%; background: linear-gradient(90deg, #00f0ff, #818cf8);"></div>
          </div>
          <div class="stacked-bar-legend">
            <div class="legend-item">
              <span class="legend-color" style="background: var(--accent-magenta);"></span>
              <span>Senior Debt (${Math.round(loanPct)}%)</span>
            </div>
            <div class="legend-item">
              <span class="legend-color" style="background: var(--accent-cyan);"></span>
              <span>Sponsor Equity (${Math.round(equityPct)}%)</span>
            </div>
          </div>
        </div>

        <!-- Uses Stacked Bar -->
        <div class="stacked-bar-container" style="margin-top: 12px;">
          <div class="stacked-bar-label">
            <span style="color: var(--text-secondary);">Uses of Funds</span>
          </div>
          <div class="stacked-bar">
            <div class="stacked-bar-segment" style="width: ${acqPct}%; background: #3b82f6;"></div>
            <div class="stacked-bar-segment" style="width: ${hardPct}%; background: #10b981;"></div>
            <div class="stacked-bar-segment" style="width: ${softPct}%; background: #f59e0b;"></div>
            <div class="stacked-bar-segment" style="width: ${finPct}%; background: #8b5cf6;"></div>
            <div class="stacked-bar-segment" style="width: ${carryPct}%; background: #ec4899;"></div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; font-size: 9px; color: var(--text-muted);">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#3b82f6;"></span>
              <span>Acquisition (${Math.round(acqPct)}%)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#10b981;"></span>
              <span>Hard Costs (${Math.round(hardPct)}%)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#f59e0b;"></span>
              <span>Soft Costs (${Math.round(softPct)}%)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#8b5cf6;"></span>
              <span>Financing (${Math.round(finPct)}%)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#ec4899;"></span>
              <span>Carry Interest (${Math.round(carryPct)}%)</span>
            </div>
          </div>
        </div>

      </div>
    `;
  } else if (activeFinancialSubTab === 'rentroll') {
    // 2. RENT ROLL / UNIT MIX SUB-TAB RENDERER
    const renderMixRows = (mixArray, mixType) => {
      return mixArray.map((item, index) => `
        <tr>
          <td>${item.bed === 0 ? "Studio (0 Bed)" : item.bed + " Bed"}</td>
          <td class="num-col" style="padding: 2px 4px;">
            <input type="number" class="inline-rentroll-input" data-mix="${mixType}" data-index="${index}" data-field="units" value="${item.units}" style="width: 45px; text-align: right;" />
          </td>
          <td class="num-col">${formatNumber(item.sqft)} sf</td>
          <td class="num-col" style="padding: 2px 4px;">
            <input type="number" class="inline-rentroll-input" data-mix="${mixType}" data-index="${index}" data-field="avgSqft" value="${Math.round(item.avgSqft)}" style="width: 50px; text-align: right;" /> sf
          </td>
          <td class="num-col">${formatCurrency(item.rentMo)}</td>
          <td class="num-col">${formatCurrency(item.rentYr)}</td>
          <td class="num-col" style="padding: 2px 4px;">
            <input type="number" class="inline-rentroll-input" data-mix="${mixType}" data-index="${index}" data-field="avgRentUnit" value="${Math.round(item.avgRentUnit)}" style="width: 55px; text-align: right;" />
          </td>
          <td class="num-col">${formatCurrency(item.avgRentSqft)}/sf</td>
        </tr>
      `).join('');
    };

    const hasHpd = fData.unitMixHPD && fData.unitMixHPD.length > 0;
    const hasComm = fData.unitMixComm && fData.unitMixComm.length > 0;

    return `
      <!-- Market Rate Unit Mix -->
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 6px;">
          <div class="card-title" style="margin-bottom: 0; font-size: 11px; color: var(--accent-magenta); border: none; padding-bottom: 0;">Market Rate (FM) Apartments</div>
          <div style="font-size: 10px; color: var(--text-secondary); display: none;">
            Avg Rent: $<input type="number" step="50" class="inline-edit-input" data-param="fmRentMo" value="${fmRentMo.toFixed(0)}" style="width: 50px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff; padding: 1px 3px; font-size: 10px; text-align: right; font-family: inherit;" />/mo
          </div>
        </div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Unit Type</th>
                <th class="num-col">Units</th>
                <th class="num-col">Total SF</th>
                <th class="num-col">Avg SF</th>
                <th class="num-col">Mo. Rent</th>
                <th class="num-col">Yr. Rent</th>
                <th class="num-col">Avg/Unit</th>
                <th class="num-col">Rent/SF</th>
              </tr>
            </thead>
            <tbody>
              ${renderMixRows(fData.unitMixFM, 'FM')}
              <tr class="total-row">
                <td>Total FM</td>
                <td class="num-col">${formatNumber(fData.unitMixFMTotal.units)}</td>
                <td class="num-col">${formatNumber(fData.unitMixFMTotal.sqft)} sf</td>
                <td class="num-col">${formatNumber(fData.unitMixFMTotal.avgSqft)} sf</td>
                <td class="num-col">${formatCurrency(fData.unitMixFMTotal.rentMo)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixFMTotal.rentYr)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixFMTotal.avgRentUnit)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixFMTotal.avgRentSqft)}/sf</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- HPD / Affordable Unit Mix -->
      ${hasHpd ? `
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 6px;">
          <div class="card-title" style="margin-bottom: 0; font-size: 11px; color: var(--accent-green); border: none; padding-bottom: 0;">Affordable (HPD / IH) Apartments</div>
          <div style="font-size: 10px; color: var(--text-secondary); display: none;">
            Avg Rent: $<input type="number" step="50" class="inline-edit-input" data-param="hpdRentMo" value="${hpdRentMo.toFixed(0)}" style="width: 50px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff; padding: 1px 3px; font-size: 10px; text-align: right; font-family: inherit;" />/mo
          </div>
        </div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Unit Type</th>
                <th class="num-col">Units</th>
                <th class="num-col">Total SF</th>
                <th class="num-col">Avg SF</th>
                <th class="num-col">Mo. Rent</th>
                <th class="num-col">Yr. Rent</th>
                <th class="num-col">Avg/Unit</th>
                <th class="num-col">Rent/SF</th>
              </tr>
            </thead>
            <tbody>
              ${renderMixRows(fData.unitMixHPD, 'HPD')}
              <tr class="total-row">
                <td>Total HPD</td>
                <td class="num-col">${formatNumber(fData.unitMixHPDTotal.units)}</td>
                <td class="num-col">${formatNumber(fData.unitMixHPDTotal.sqft)} sf</td>
                <td class="num-col">${formatNumber(fData.unitMixHPDTotal.avgSqft)} sf</td>
                <td class="num-col">${formatCurrency(fData.unitMixHPDTotal.rentMo)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixHPDTotal.rentYr)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixHPDTotal.avgRentUnit)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixHPDTotal.avgRentSqft)}/sf</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}

      <!-- Total Combined Residential Rent Roll -->
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--accent-cyan);">Combined Residential Roll</div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Unit Type</th>
                <th class="num-col">Units</th>
                <th class="num-col">Total SF</th>
                <th class="num-col">Avg SF</th>
                <th class="num-col">Mo. Rent</th>
                <th class="num-col">Yr. Rent</th>
                <th class="num-col">Avg/Unit</th>
                <th class="num-col">Rent/SF</th>
              </tr>
            </thead>
            <tbody>
              ${fData.unitMixTotal.map(item => `
                <tr>
                  <td>${item.bed === 0 ? "Studio (0 Bed)" : item.bed + " Bed"}</td>
                  <td class="num-col">${formatNumber(item.units)}</td>
                  <td class="num-col">${formatNumber(item.sqft)} sf</td>
                  <td class="num-col">${formatNumber(item.avgSqft)} sf</td>
                  <td class="num-col">${formatCurrency(item.rentMo)}</td>
                  <td class="num-col">${formatCurrency(item.rentYr)}</td>
                  <td class="num-col">${formatCurrency(item.avgRentUnit)}</td>
                  <td class="num-col">${formatCurrency(item.avgRentSqft)}/sf</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td>Total Residential</td>
                <td class="num-col">${formatNumber(fData.unitMixTotalTotal.units)}</td>
                <td class="num-col">${formatNumber(fData.unitMixTotalTotal.sqft)} sf</td>
                <td class="num-col">${formatNumber(fData.unitMixTotalTotal.avgSqft)} sf</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.rentMo)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.rentYr)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.avgRentUnit)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.avgRentSqft)}/sf</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Commercial Rent Roll -->
      ${hasComm ? `
      <div class="section-card" style="padding: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding-bottom: 6px;">
          <div class="card-title" style="margin-bottom: 0; font-size: 11px; color: var(--accent-amber); border: none; padding-bottom: 0;">Commercial Rent Roll</div>
          <div style="font-size: 10px; color: var(--text-secondary); display: none;">
            Rent Rate: $<input type="number" step="5" class="inline-edit-input" data-param="commRentSf" value="${commRentSf.toFixed(0)}" style="width: 45px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff; padding: 1px 3px; font-size: 10px; text-align: right; font-family: inherit;" />/sf/yr
          </div>
        </div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Tenant / Space</th>
                <th class="num-col">Area (SF)</th>
                <th class="num-col">Monthly Rent</th>
                <th class="num-col">Annual Rent</th>
                <th class="num-col">Annual Rent / SF</th>
              </tr>
            </thead>
            <tbody>
              ${fData.unitMixComm.map((item, index) => `
                <tr>
                  <td style="padding: 2px 4px;">
                    <input type="text" class="inline-rentroll-input" data-mix="Comm" data-index="${index}" data-field="unit" value="${item.unit}" style="width: 90px; text-align: left;" />
                  </td>
                  <td class="num-col" style="padding: 2px 4px;">
                    <input type="number" class="inline-rentroll-input" data-mix="Comm" data-index="${index}" data-field="sqft" value="${item.sqft}" style="width: 65px; text-align: right;" /> sf
                  </td>
                  <td class="num-col">${formatCurrency(item.rentMo)}</td>
                  <td class="num-col">${formatCurrency(item.rentYr)}</td>
                  <td class="num-col" style="padding: 2px 4px;">
                    <input type="number" class="inline-rentroll-input" data-mix="Comm" data-index="${index}" data-field="rentSqft" value="${Math.round(item.rentSqft)}" style="width: 45px; text-align: right;" />/sf
                  </td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td>Total Commercial</td>
                <td class="num-col">${formatNumber(fData.unitMixCommTotal.sqft)} sf</td>
                <td class="num-col">${formatCurrency(fData.unitMixCommTotal.rentMo)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixCommTotal.rentYr)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixCommTotal.rentSqft)}/sf</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}
    `;
  } else if (activeFinancialSubTab === 'budget') {
    // 3. DEVELOPMENT BUDGET SUB-TAB RENDERER
    const totals = fData.budgetTotals;
    const gsf = fData.projectInfo.gsf;
    const zfa = fData.projectInfo.zfa;
    const units = fData.projectInfo.totalResidentialUnits || fData.projectInfo.totalCommercialUnits || 1;

    const renderBudgetScroll = (budgetArray, category) => {
      return `
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Sub-Item Name</th>
                <th class="num-col" style="width: 95px;">Total Cost</th>
                <th class="num-col" style="width: 70px;">Rate/Pct</th>
                <th style="padding-left: 10px; width: 140px;">Calculation Basis</th>
              </tr>
            </thead>
            <tbody>
              ${budgetArray.map((item, index) => {
                const basis = item.basis || "Manual";
                const isManual = basis === "Manual";
                const rateVal = item.rate !== undefined ? item.rate : 0;
                
                return `
                  <tr>
                    <td>${item.name}</td>
                    <td class="num-col" style="padding: 2px 4px;">
                      $<input type="number" class="inline-budget-input" data-category="${category}" data-index="${index}" value="${Math.round(item.total)}" ${isManual ? '' : 'readonly style="background: rgba(255,255,255,0.02); opacity: 0.8; border-color: transparent;"'} style="width: 75px; text-align: right;" />
                    </td>
                    <td class="num-col" style="padding: 2px 4px;">
                      <input type="number" step="any" class="inline-budget-rate-input" data-category="${category}" data-index="${index}" value="${rateVal}" ${isManual ? 'disabled style="opacity: 0.5; border-color: transparent;"' : ''} style="width: 50px; text-align: right;" />
                    </td>
                    <td style="padding-left: 10px; font-size: 10px; text-align: left;">
                      <select class="inline-budget-basis-select" data-category="${category}" data-index="${index}">
                        <option value="Manual" ${basis === 'Manual' ? 'selected' : ''}>Manual</option>
                        <option value="% of Hard Costs Base" ${basis === '% of Hard Costs Base' ? 'selected' : ''}>% of Hard Costs Base</option>
                        <option value="% of Hard Costs Total" ${basis === '% of Hard Costs Total' ? 'selected' : ''}>% of Hard Costs Total</option>
                        <option value="% of Soft Costs" ${basis === '% of Soft Costs' ? 'selected' : ''}>% of Soft Costs</option>
                        <option value="% of Senior Loan" ${basis === '% of Senior Loan' ? 'selected' : ''}>% of Senior Loan</option>
                        <option value="% of Project Cost" ${basis === '% of Project Cost' ? 'selected' : ''}>% of Project Cost</option>
                        <option value="% of Land + Hard" ${basis === '% of Land + Hard' ? 'selected' : ''}>% of Land + Hard</option>
                        <option value="$/Lot SF" ${basis === '$/Lot SF' ? 'selected' : ''}>$/Lot SF</option>
                        <option value="$/GSF" ${basis === '$/GSF' ? 'selected' : ''}>$/GSF</option>
                        <option value="$/ZFA" ${basis === '$/ZFA' ? 'selected' : ''}>$/ZFA</option>
                      </select>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    return `
      <!-- Capitalization metrics -->
      <div class="metric-grid-3">
        <div class="metric-card highlight-cyan">
          <span class="metric-label">GSF cost</span>
          <span class="metric-val">${formatCurrency(totals.totalProject / gsf)}/sf</span>
        </div>
        <div class="metric-card highlight-magenta">
          <span class="metric-label">ZFA cost</span>
          <span class="metric-val">${formatCurrency(totals.totalProject / zfa)}/sf</span>
        </div>
        <div class="metric-card highlight-amber">
          <span class="metric-label">Cost / Unit</span>
          <span class="metric-val">${formatCurrency(totals.totalProject / units)}</span>
        </div>
      </div>

      <!-- Acquisition Costs -->
      <div class="section-card" style="padding: 12px; margin-bottom: 12px;">
        <div class="card-title" style="margin-bottom: 6px; font-size: 11px; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
          <span>Acquisition Costs</span>
          <div style="font-size: 10px; color: var(--text-secondary); font-weight: normal; display: flex; align-items: center; gap: 4px;">
            Land: $<input type="number" step="10" class="inline-edit-input" data-param="landCostSf" value="${landCostSf.toFixed(0)}" style="width: 45px; text-align: right;" />/lot sf
          </div>
        </div>
        <div class="budget-list-scroll" style="max-height: none;">
          ${renderBudgetScroll(fData.acquisitionCosts, 'acquisitionCosts')}
        </div>
      </div>

      <!-- Hard Costs -->
      <div class="section-card" style="padding: 12px; margin-bottom: 12px;">
        <div class="card-title" style="margin-bottom: 6px; font-size: 11px; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
          <span>Hard Construction Costs</span>
          <div style="font-size: 10px; color: var(--text-secondary); font-weight: normal; display: flex; align-items: center; gap: 4px;">
            Const: $<input type="number" step="10" class="inline-edit-input" data-param="hardCostGsf" value="${hardCostGsf.toFixed(0)}" style="width: 45px; text-align: right;" />/gsf
          </div>
        </div>
        <div class="budget-list-scroll">
          ${renderBudgetScroll(fData.hardCosts, 'hardCosts')}
        </div>
      </div>

      <!-- Soft Costs -->
      <div class="section-card" style="padding: 12px; margin-bottom: 12px;">
        <div class="card-title" style="margin-bottom: 6px; font-size: 11px; color: var(--text-primary); display: flex; justify-content: space-between;">
          <span>Soft Professional Costs</span>
          <span class="highlight-amber">${formatCurrency(totals.totalSoft)}</span>
        </div>
        <div class="budget-list-scroll">
          ${renderBudgetScroll(fData.softCosts, 'softCosts')}
        </div>
      </div>

      <!-- Financing Costs -->
      <div class="section-card" style="padding: 12px; margin-bottom: 12px;">
        <div class="card-title" style="margin-bottom: 6px; font-size: 11px; color: var(--text-primary); display: flex; justify-content: space-between;">
          <span>Financing Costs</span>
          <span class="highlight-cyan">${formatCurrency(totals.totalFinancing)}</span>
        </div>
        <div class="budget-list-scroll">
          ${renderBudgetScroll(fData.financingCosts, 'financingCosts')}
        </div>
      </div>

      <!-- Carry & Interest Costs -->
      <div class="section-card" style="padding: 12px;">
        <div class="card-title" style="margin-bottom: 6px; font-size: 11px; color: var(--text-primary); display: flex; justify-content: space-between;">
          <span>Carry & Interest Reserve</span>
          <span class="highlight-magenta">${formatCurrency(totals.totalInterest)}</span>
        </div>
        <div class="budget-list-scroll" style="max-height: none;">
          ${renderBudgetScroll(fData.interestCarryCosts, 'interestCarryCosts')}
        </div>
      </div>
    `;
  } else if (activeFinancialSubTab === 'abatement') {
    // 4. TAX ABATEMENT SUB-TAB RENDERER
    const NPV = fData.abatementNPV;
    const summary = fData.abatementSummary;

    return `
      <!-- Exemption schedule NPV -->
      <div class="metric-card highlight-cyan" style="padding: 14px 10px; margin-bottom: 16px;">
        <span class="metric-label" style="font-size: 10px;">NPV of 35-Year Tax Savings</span>
        <span class="metric-val" style="font-size: 18px; text-shadow: 0 0 16px rgba(0, 240, 255, 0.4);">${formatCurrency(NPV)}</span>
      </div>

      <!-- Parameters Card -->
      <div class="section-card" style="padding: 12px; margin-bottom: 16px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--text-primary);">Abatement Parameters</div>
        <div class="info-grid" style="gap: 8px;">
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Prior Taxable Assessed Value (Land)</span>
            <span class="info-value highlight-magenta" style="display: flex; align-items: center; gap: 2px;">
              $<input type="number" step="50000" class="inline-edit-input" data-param="priorAv" value="${priorAv.toFixed(0)}" style="width: 75px; text-align: right;" />
            </span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Discount Rate (Discounting NPV)</span>
            <span class="info-value highlight-cyan" style="display: flex; align-items: center; gap: 2px;">
              <input type="number" step="0.5" class="inline-edit-input" data-param="discountRate" value="${(discountRate * 100).toFixed(1)}" style="width: 45px; text-align: right;" />%
            </span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Assessed Value Annual Growth</span>
            <span class="info-value" style="display: flex; align-items: center; gap: 2px;">
              <input type="number" step="0.5" class="inline-edit-input" data-param="avGrowthRate" value="${(summary.avGrowthRate * 100).toFixed(1)}" style="width: 45px; text-align: right;" />%
            </span>
          </div>
          <div class="info-row">
            <span class="info-label" style="font-size: 11px;">Tax Rate Annual Growth</span>
            <span class="info-value" style="display: flex; align-items: center; gap: 2px;">
              <input type="number" step="0.1" class="inline-edit-input" data-param="taxRateGrowth" value="${(summary.taxRateGrowth * 100).toFixed(2)}" style="width: 45px; text-align: right;" />%
            </span>
          </div>
        </div>
      </div>

      <!-- Exemption Schedule table -->
      <div class="section-card" style="padding: 12px;">
        <div class="card-title" style="margin-bottom: 8px; font-size: 11px; color: var(--text-primary);">35-Year Exemption Schedule</div>
        <div class="underwriting-table-wrapper" style="max-height: 260px; overflow-y: auto;">
          <table class="underwriting-table" style="position: relative;">
            <thead style="position: sticky; top: 0; z-index: 10;">
              <tr>
                <th style="background:#0a0e1a;">Yr</th>
                <th style="background:#0a0e1a;">Exempt%</th>
                <th style="background:#0a0e1a;" class="num-col">RET Savings</th>
                <th style="background:#0a0e1a;" class="num-col">Abated Tax</th>
                <th style="background:#0a0e1a;" class="num-col">Full Tax</th>
              </tr>
            </thead>
            <tbody>
              ${fData.abatementSchedule.map(s => `
                <tr>
                  <td>${s.year}</td>
                  <td>${formatPercent(s.percentExempt)}</td>
                  <td class="num-col highlight-cyan" style="font-weight:600;">${formatCurrency(s.retSavings)}</td>
                  <td class="num-col highlight-magenta">${formatCurrency(s.abatedRet)}</td>
                  <td class="num-col">${formatCurrency(s.unabatedRet)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (activeFinancialSubTab === 'assumptions') {
    // 5. EDITABLE ASSUMPTIONS & FORMULAS SUB-TAB
    return `
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4;">
        Modify the financial values or algebraic formulas below, then click **Recalculate Proforma Model** to rerun the underwriting model.
      </div>
      <form id="assumptions-form">
        <div class="assumptions-grid">
          <!-- Card 1: Dimensions & Formulas -->
          <div class="assumption-card">
            <div class="assumption-card-title">Dimensions & Formulas</div>
            <div class="assumption-field">
              <label class="assumption-label">GSF Formula</label>
              <input class="assumption-input" type="text" name="gsfFormula" value="${as.gsfFormula || ''}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">NSF Formula</label>
              <input class="assumption-input" type="text" name="nsfFormula" value="${as.nsfFormula || ''}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Stabilized Value Formula</label>
              <input class="assumption-input" type="text" name="stabilizedValueFormula" value="${as.stabilizedValueFormula || ''}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Senior Loan Formula</label>
              <input class="assumption-input" type="text" name="seniorLoanFormula" value="${as.seniorLoanFormula || ''}" />
            </div>
          </div>

          <!-- Card 2: Revenues -->
          <div class="assumption-card">
            <div class="assumption-card-title">Revenues & Vacancy</div>
            <div class="assumption-field">
              <label class="assumption-label">FM Res. Rent ($/mo average)</label>
              <input class="assumption-input" type="number" step="0.01" name="fmRentMo" value="${fmRentMo}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">HPD Res. Rent ($/mo average)</label>
              <input class="assumption-input" type="number" step="0.01" name="hpdRentMo" value="${hpdRentMo}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Commercial Rent ($/SF/year)</label>
              <input class="assumption-input" type="number" step="0.01" name="commRentSf" value="${commRentSf}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">FM Vacancy Rate (%)</label>
              <input class="assumption-input" type="text" name="fmVacancy" value="${(fmVacancy * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">HPD Vacancy Rate (%)</label>
              <input class="assumption-input" type="text" name="hpdVacancy" value="${(hpdVacancy * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Commercial Vacancy Rate (%)</label>
              <input class="assumption-input" type="text" name="commVacancy" value="${(commVacancy * 100).toFixed(1)}%" />
            </div>
          </div>

          <!-- Card 3: Expenses -->
          <div class="assumption-card">
            <div class="assumption-card-title">Operating Expenses</div>
            <div class="assumption-field">
              <label class="assumption-label">Unabated Taxes (% of EGI)</label>
              <input class="assumption-input" type="text" name="unabatedTaxPct" value="${(as.unabatedTaxPct * 100).toFixed(2)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Res. OpEx per Unit ($/yr)</label>
              <input class="assumption-input" type="number" name="opexPerUnit" value="${as.opexPerUnit || 8500}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Management Fee (% of EGI)</label>
              <input class="assumption-input" type="text" name="mgmtFeePct" value="${(as.mgmtFeePct * 100).toFixed(1)}%" />
            </div>
          </div>

          <!-- Card 4: Development Budget -->
          <div class="assumption-card">
            <div class="assumption-card-title">Development Costs</div>
            <div class="assumption-field">
              <label class="assumption-label">Land Cost ($/lot SF)</label>
              <input class="assumption-input" type="number" name="landCostSf" value="${landCostSf}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Hard Cost ($/GSF)</label>
              <input class="assumption-input" type="number" name="hardCostGsf" value="${hardCostGsf}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Hard Cost Contingency (%)</label>
              <input class="assumption-input" type="text" name="hardContingencyPct" value="${(as.hardContingencyPct * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Soft Cost % of Hard</label>
              <input class="assumption-input" type="text" name="softCostPct" value="${(as.softCostPct * 100).toFixed(2)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Financing % of Land+Hard</label>
              <input class="assumption-input" type="text" name="financingCostPct" value="${(as.financingCostPct * 100).toFixed(2)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Carry/Interest % of Land+Hard</label>
              <input class="assumption-input" type="text" name="carryInterestPct" value="${(as.carryInterestPct * 100).toFixed(2)}%" />
            </div>
          </div>

          <!-- Card 5: Valuation & Debt -->
          <div class="assumption-card">
            <div class="assumption-card-title">Valuation, Debt & Abatement</div>
            <div class="assumption-field">
              <label class="assumption-label">Capitalization Rate (%)</label>
              <input class="assumption-input" type="text" name="capRate" value="${(capRate * 100).toFixed(3)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Senior Loan LTC (%)</label>
              <input class="assumption-input" type="text" name="ltc" value="${(ltc * 100).toFixed(2)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">NPV Tax Discount Rate (%)</label>
              <input class="assumption-input" type="text" name="discountRate" value="${(discountRate * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Prior Land Assessed Value ($)</label>
              <input class="assumption-input" type="number" name="priorAv" value="${priorAv}" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Assessed Value Growth Rate (%)</label>
              <input class="assumption-input" type="text" name="avGrowthRate" value="${(avGrowthRate * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Tax Rate Growth Rate (%)</label>
              <input class="assumption-input" type="text" name="taxRateGrowth" value="${(taxRateGrowth * 100).toFixed(2)}%" />
            </div>
          </div>

          <!-- Card 6: Unit Mix Allocation -->
          <div class="assumption-card">
            <div class="assumption-card-title">Unit Mix Allocation</div>
            <div class="assumption-field">
              <label class="assumption-label">Market Rate (FM) %</label>
              <input class="assumption-input" type="text" name="fmPct" value="${(fmPct * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">Studio Units %</label>
              <input class="assumption-input" type="text" name="studioPct" value="${(studioPct * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">1 Bed Units %</label>
              <input class="assumption-input" type="text" name="oneBedPct" value="${(oneBedPct * 100).toFixed(1)}%" />
            </div>
            <div class="assumption-field">
              <label class="assumption-label">2 Bed Units %</label>
              <input class="assumption-input" type="text" name="twoBedPct" value="${(twoBedPct * 100).toFixed(1)}%" />
            </div>
          </div>

          <!-- Card 7: Apartment Rent Ratios -->
          <div class="assumption-card">
            <div class="assumption-card-title">Apartment Rent Ratios</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div class="assumption-field">
                <label class="assumption-label">FM Studio Ratio</label>
                <input class="assumption-input" type="number" step="0.001" name="fmStudioRatio" value="${fmStudioRatio}" />
              </div>
              <div class="assumption-field">
                <label class="assumption-label">HPD Studio Ratio</label>
                <input class="assumption-input" type="number" step="0.001" name="hpdStudioRatio" value="${hpdStudioRatio}" />
              </div>
              <div class="assumption-field">
                <label class="assumption-label">FM 1 Bed Ratio</label>
                <input class="assumption-input" type="number" step="0.001" name="fmOneBedRatio" value="${fmOneBedRatio}" />
              </div>
              <div class="assumption-field">
                <label class="assumption-label">HPD 1 Bed Ratio</label>
                <input class="assumption-input" type="number" step="0.001" name="hpdOneBedRatio" value="${hpdOneBedRatio}" />
              </div>
              <div class="assumption-field">
                <label class="assumption-label">FM 2 Bed Ratio</label>
                <input class="assumption-input" type="number" step="0.001" name="fmTwoBedRatio" value="${fmTwoBedRatio}" />
              </div>
              <div class="assumption-field">
                <label class="assumption-label">HPD 2 Bed Ratio</label>
                <input class="assumption-input" type="number" step="0.001" name="hpdTwoBedRatio" value="${hpdTwoBedRatio}" />
              </div>
            </div>
          </div>
        </div>

        <button type="button" id="recalculate-model-btn" class="control-btn active" style="width:100%; height:40px; font-weight:700; background:linear-gradient(90deg, var(--accent-cyan), var(--accent-magenta)); border:none; border-radius:6px; color:#fff; cursor:pointer; font-size:12px; box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); text-transform:uppercase; letter-spacing:0.5px; transition: all 0.3s;">
          Recalculate Proforma Model
        </button>
      </form>
    `;
  }
}

// Compile a complete professional PDF presentation report package
function renderPrintPackage() {
  const lotArea = parseInt(plutoData.lotarea, 10) || 0;
  const builtArea = parseInt(plutoData.bldgarea, 10) || 0;
  const builtFar = parseFloat(plutoData.builtfar) || 0;
  const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
  const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;
  
  // Resolve zoning rules
  const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1) || {
    resFar: 0, commFar: 0, facilFar: 0, baseHeight: 60, contextual: false, maxBuildingHeight: 300
  };
  const maxFar = Math.max(zoningRules.resFar, zoningRules.commFar, zoningRules.facilFar);
  const maxAllowedArea = lotArea * maxFar;
  const remainingArea = Math.max(maxAllowedArea - builtArea, 0);
  const remainingFar = Math.max(maxFar - builtFar, 0).toFixed(2);

  // Retrieve Underwriting dataset: use activeUnderwritingData
  let fData = activeUnderwritingData;
  const zfa = fData.projectInfo.zfa;
  const gsf = fData.projectInfo.gsf;

  // Generate ZAP Projects list
  let zapHtml = '';
  if (zapProjects && zapProjects.length > 0) {
    zapHtml = zapProjects.map(proj => `
      <div class="project-item ${proj.project_status === 'Active' ? 'active' : ''}" style="border: 1px solid #cbd5e1; background: #fff; margin-bottom: 8px;">
        <div class="project-header">
          <span>${proj.project_name}</span>
          <span style="color: ${proj.project_status === 'Active' ? '#16a34a' : '#64748b'}">${proj.project_status}</span>
        </div>
        <div class="project-desc" style="color: #334155;">${proj.project_brief || 'No description provided.'}</div>
        <div style="font-size: 10px; color: #64748b; margin-top: 4px;">Filed: ${proj.app_filed_date ? proj.app_filed_date.substring(0, 10) : 'N/A'}</div>
      </div>
    `).join('');
  } else {
    zapHtml = `<p style="font-size: 12px; color: #64748b;">No zoning applications found for this lot.</p>`;
  }

  const renderMixRows = (mixArray) => {
    return mixArray.map(item => `
      <tr>
        <td>${item.bed === 0 ? "Studio (0 Bed)" : item.bed + " Bed"}</td>
        <td class="num-col">${formatNumber(item.units)}</td>
        <td class="num-col">${formatNumber(item.sqft)} sf</td>
        <td class="num-col">${formatNumber(item.avgSqft)} sf</td>
        <td class="num-col">${formatCurrency(item.rentMo)}</td>
        <td class="num-col">${formatCurrency(item.rentYr)}</td>
        <td class="num-col">${formatCurrency(item.avgRentUnit)}</td>
        <td class="num-col">${formatCurrency(item.avgRentSqft)}/sf</td>
      </tr>
    `).join('');
  };

  const hasHpd = fData.unitMixHPD && fData.unitMixHPD.length > 0;
  const hasComm = fData.unitMixComm && fData.unitMixComm.length > 0;

  return `
    <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px;">
      <h1 style="font-size: 26px; font-family: var(--font-display); font-weight: 700; margin: 0; color: #000;">SITEPRONY DEVELOPMENT REPORT</h1>
      <span style="font-size: 12px; font-weight: 500; color: #334155; text-transform: uppercase;">Real Estate Presentation & Underwriting Package</span>
    </div>

    <!-- Page 1: Site Profile & 3D Model -->
    <div class="financials-print-section">
      <h2 style="font-size: 18px; border-bottom: 1px solid #94a3b8; padding-bottom: 6px; color: #000; margin-bottom: 16px;">1. SITE LOCATION PROFILE</h2>
      <div class="info-grid" style="margin-bottom: 20px; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="section-card" style="margin-bottom: 0;">
          <div class="card-title">Site Details</div>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">Address</span><span class="info-value" style="font-weight: 700;">${displayAddress}</span></div>
            <div class="info-row"><span class="info-label">Zoning District</span><span class="info-value">${plutoData.zonedist1}</span></div>
            <div class="info-row"><span class="info-label">Special District</span><span class="info-value">${plutoData.spdist1 || 'None'}</span></div>
            <div class="info-row"><span class="info-label">BBL</span><span class="info-value">${bblStr}</span></div>
            <div class="info-row"><span class="info-label">Lot Area</span><span class="info-value">${lotArea.toLocaleString()} sf</span></div>
            <div class="info-row"><span class="info-label">Lot Dimensions</span><span class="info-value">${parseFloat(plutoData.lotfront)}' x ${parseFloat(plutoData.lotdepth)}'</span></div>
          </div>
        </div>
        <div class="section-card" style="margin-bottom: 0;">
          <div class="card-title">Visual Development Model</div>
          <div style="text-align: center;">
            <img id="print-3d-image-placeholder" class="print-3d-image-class" style="width: 100%; max-height: 200px; object-fit: contain; border: 1px solid #cbd5e1; background: #060810; border-radius: 6px;" />
            <div style="font-size: 8px; color: #64748b; margin-top: 4px; text-align: left;">3D perspective model render captured from viewports.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Page 2: Zoning Allowances & Rights -->
    <div class="financials-print-section">
      <h2 style="font-size: 18px; border-bottom: 1px solid #94a3b8; padding-bottom: 6px; color: #000; margin-bottom: 16px;">2. ZONING RIGHTS & DEVELOPMENT POTENTIAL</h2>
      <div class="info-grid" style="grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <div class="section-card" style="margin-bottom: 0;">
          <div class="card-title">FAR Allowances</div>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">Residential Max FAR</span><span class="info-value">${zoningRules.resFar.toFixed(2)}</span></div>
            <div class="info-row"><span class="info-label">Commercial Max FAR</span><span class="info-value">${zoningRules.commFar.toFixed(2)}</span></div>
            <div class="info-row"><span class="info-label">Facility Max FAR</span><span class="info-value">${zoningRules.facilFar.toFixed(2)}</span></div>
            <div class="info-row"><span class="info-label">Existing Built FAR</span><span class="info-value" style="color: #c026d3;">${builtFar.toFixed(2)}</span></div>
            <div class="info-row"><span class="info-label">Remaining FAR</span><span class="info-value" style="color: #0891b2;">${remainingFar}</span></div>
          </div>
        </div>
        <div class="section-card" style="margin-bottom: 0;">
          <div class="card-title">Development Rights</div>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">Max Allowed Floor Area</span><span class="info-value">${maxAllowedArea.toLocaleString()} sf</span></div>
            <div class="info-row"><span class="info-label">Existing Built Area</span><span class="info-value">${builtArea.toLocaleString()} sf</span></div>
            <div class="info-row"><span class="info-label">Unused Floor Area (Air Rights)</span><span class="info-value" style="font-weight: 700; color: #0891b2;">${remainingArea.toLocaleString()} sf</span></div>
            <div class="info-row"><span class="info-label">Base Street Wall Height</span><span class="info-value">${zoningRules.baseHeight}'</span></div>
            <div class="info-row"><span class="info-label">Contextual Height Cap?</span><span class="info-value">${zoningRules.contextual ? `${zoningRules.maxBuildingHeight}'` : 'Sky Exposure Plane'}</span></div>
          </div>
        </div>
      </div>
      <div class="section-card" style="margin-bottom: 20px;">
        <div class="card-title">Zoning Applications (ZAP)</div>
        <div class="project-list">${zapHtml}</div>
      </div>
    </div>

    <!-- Page 3: Financial Proforma Summary -->
    <div class="financials-print-section">
      <h2 style="font-size: 18px; border-bottom: 1px solid #94a3b8; padding-bottom: 6px; color: #000; margin-bottom: 16px;">3. STABILIZED UNDERWRITING PROFORMA SUMMARY</h2>
      
      <div class="info-grid" style="grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px;">
        <div class="metric-card" style="border: 1px solid #cbd5e1; background: #fff; padding: 12px 6px;">
          <span class="metric-label">Stabilized NOI</span>
          <span class="metric-val" style="color: #0891b2; font-size: 16px;">${formatCurrency(fData.valuationSummary.proformaNoiAbated)}</span>
        </div>
        <div class="metric-card" style="border: 1px solid #cbd5e1; background: #fff; padding: 12px 6px;">
          <span class="metric-label">Cap Rate</span>
          <span class="metric-val" style="color: #b45309; font-size: 16px;">${formatPercent(fData.valuationSummary.capRate)}</span>
        </div>
        <div class="metric-card" style="border: 1px solid #cbd5e1; background: #fff; padding: 12px 6px;">
          <span class="metric-label">Stabilized Value</span>
          <span class="metric-val" style="color: #be185d; font-size: 16px;">${formatCurrency(fData.valuationSummary.totalStabilizedValue)}</span>
        </div>
      </div>

      <div class="info-grid" style="grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <div class="section-card" style="margin-bottom: 0;">
          <div class="card-title">Capitalization & Debt Parameters</div>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">Total Capitalization</span><span class="info-value" style="font-weight: 700;">${formatCurrency(fData.capitalization.developmentCapitalization)}</span></div>
            <div class="info-row"><span class="info-label">Construction Loan</span><span class="info-value">${formatCurrency(fData.capitalization.constructionLoan)}</span></div>
            <div class="info-row"><span class="info-label">Sponsor Equity</span><span class="info-value">${formatCurrency(fData.sources[1].totalCost)}</span></div>
            <div class="info-row"><span class="info-label">Debt / Unit</span><span class="info-value">${formatCurrency(fData.capitalization.debtUnit)}</span></div>
            <div class="info-row"><span class="info-label">Debt / GSF</span><span class="info-value">${formatCurrency(fData.capitalization.debtGsf)}</span></div>
          </div>
        </div>
        <div class="section-card" style="margin-bottom: 0;">
          <div class="card-title">Ratios & Capital Metrics</div>
          <div class="info-grid">
            <div class="info-row"><span class="info-label">Stabilized Loan-To-Value (LTV)</span><span class="info-value" style="font-weight: 700; color: #0891b2;">${formatPercent(fData.capitalization.stabilizedLtv)}</span></div>
            <div class="info-row"><span class="info-label">Stabilized Debt Yield (DY)</span><span class="info-value" style="font-weight: 700; color: #be185d;">${formatPercent(fData.capitalization.stabilizedDy)}</span></div>
            <div class="info-row"><span class="info-label">Stabilized Yield on Cost (YoC)</span><span class="info-value" style="font-weight: 700; color: #b45309;">${formatPercent(fData.capitalization.stabilizedYoC)}</span></div>
            <div class="info-row"><span class="info-label">Valuation per Unit</span><span class="info-value">${formatCurrency(fData.valuationSummary.valueUnit)}</span></div>
            <div class="info-row"><span class="info-label">Valuation per GSF</span><span class="info-value">${formatCurrency(fData.valuationSummary.valueGsf)}/sf</span></div>
          </div>
        </div>
      </div>
      
      <div class="section-card">
        <div class="card-title">Income & Expense Underwriting Statement</div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Line Item</th>
                <th>Source Description</th>
                <th class="num-col">Total Amount</th>
                <th class="num-col">Per Unit</th>
                <th class="num-col">Per GSF</th>
                <th class="num-col">% EGI</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="font-weight:600;">Effective Gross Income (EGI)</td><td>Model Revenue</td><td class="num-col" style="font-weight:600;">${formatCurrency(fData.effectiveGrossIncome.total)}</td><td class="num-col">${formatCurrency(fData.effectiveGrossIncome.perUnit)}</td><td class="num-col">${formatCurrency(fData.effectiveGrossIncome.perGsf)}</td><td class="num-col">${formatPercent(fData.effectiveGrossIncome.percentEgi)}</td></tr>
              ${fData.expenses.map(e => `
                <tr>
                  <td>${e.name}</td>
                  <td>${e.source}</td>
                  <td class="num-col" style="color: ${e.total < 0 ? '#b91c1c' : '#16a34a'};">${formatCurrency(e.total)}</td>
                  <td class="num-col">${formatCurrency(e.perUnit)}</td>
                  <td class="num-col">${formatCurrency(e.perGsf)}</td>
                  <td class="num-col">${formatPercent(e.percentEgi)}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td>Total Operating Expenses</td>
                <td>Calculated Opex</td>
                <td class="num-col" style="color: #b91c1c;">${formatCurrency(fData.totalExpenses.total)}</td>
                <td class="num-col">${formatCurrency(fData.totalExpenses.perUnit)}</td>
                <td class="num-col">${formatCurrency(fData.totalExpenses.perGsf)}</td>
                <td class="num-col">${formatPercent(fData.totalExpenses.percentEgi)}</td>
              </tr>
              <tr class="total-row" style="background: #e0f2fe;">
                <td style="color: #0369a1;">Net Operating Income (NOI)</td>
                <td style="color: #0369a1;">Stabilized Abated</td>
                <td class="num-col" style="color: #0369a1; font-weight:700;">${formatCurrency(fData.netOperatingIncome.total)}</td>
                <td class="num-col" style="color: #0369a1;">${formatCurrency(fData.netOperatingIncome.perUnit)}</td>
                <td class="num-col" style="color: #0369a1;">${formatCurrency(fData.netOperatingIncome.perGsf)}</td>
                <td class="num-col" style="color: #0369a1;">${formatPercent(fData.netOperatingIncome.percentEgi)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Page 4: Rent Roll & Unit Mix -->
    <div class="financials-print-section">
      <h2 style="font-size: 18px; border-bottom: 1px solid #94a3b8; padding-bottom: 6px; color: #000; margin-bottom: 16px;">4. RESIDENTIAL & COMMERCIAL RENT ROLLS</h2>
      
      <div class="section-card" style="margin-bottom: 20px;">
        <div class="card-title" style="color: #be185d;">Residential Apartment Unit Mix (Total)</div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Unit Type</th>
                <th class="num-col">Units</th>
                <th class="num-col">Total SF</th>
                <th class="num-col">Avg SF</th>
                <th class="num-col">Mo. Rent</th>
                <th class="num-col">Yr. Rent</th>
                <th class="num-col">Avg/Unit</th>
                <th class="num-col">Rent/SF</th>
              </tr>
            </thead>
            <tbody>
              ${renderMixRows(fData.unitMixTotal)}
              <tr class="total-row">
                <td>Total Residential Apartments</td>
                <td class="num-col">${formatNumber(fData.unitMixTotalTotal.units)}</td>
                <td class="num-col">${formatNumber(fData.unitMixTotalTotal.sqft)} sf</td>
                <td class="num-col">${formatNumber(fData.unitMixTotalTotal.avgSqft)} sf</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.rentMo)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.rentYr)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.avgRentUnit)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixTotalTotal.avgRentSqft)}/sf</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      ${hasComm ? `
      <div class="section-card">
        <div class="card-title" style="color: #b45309;">Commercial Space Rent Roll</div>
        <div class="underwriting-table-wrapper">
          <table class="underwriting-table">
            <thead>
              <tr>
                <th>Tenant Description</th>
                <th class="num-col">Area (SF)</th>
                <th class="num-col">Monthly Rent</th>
                <th class="num-col">Annual Rent</th>
                <th class="num-col">Annual Rent / SF</th>
              </tr>
            </thead>
            <tbody>
              ${fData.unitMixComm.map(item => `
                <tr>
                  <td>${item.unit}</td>
                  <td class="num-col">${formatNumber(item.sqft)} sf</td>
                  <td class="num-col">${formatCurrency(item.rentMo)}</td>
                  <td class="num-col">${formatCurrency(item.rentYr)}</td>
                  <td class="num-col">${formatCurrency(item.rentSqft)}/sf</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td>Total Commercial Roll</td>
                <td class="num-col">${formatNumber(fData.unitMixCommTotal.sqft)} sf</td>
                <td class="num-col">${formatCurrency(fData.unitMixCommTotal.rentMo)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixCommTotal.rentYr)}</td>
                <td class="num-col">${formatCurrency(fData.unitMixCommTotal.rentSqft)}/sf</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}
    </div>

    <!-- Page 5: Development Budget -->
    <div class="financials-print-section">
      <h2 style="font-size: 18px; border-bottom: 1px solid #94a3b8; padding-bottom: 6px; color: #000; margin-bottom: 16px;">5. ESTIMATED DEVELOPMENT BUDGET</h2>
      
      <div class="underwriting-table-wrapper">
        <table class="underwriting-table">
          <thead>
            <tr>
              <th>Expense Category / Sub-Item</th>
              <th class="num-col">Total Cost</th>
              <th class="num-col">Cost / ZFA</th>
              <th class="num-col">Cost / GSF</th>
              <th class="num-col">Percent %</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:#f8fafc; font-weight:700;"><td colspan="5">ACQUISITION COSTS</td></tr>
            ${fData.acquisitionCosts.map(item => `
              <tr><td>&nbsp;&nbsp;${item.name}</td><td class="num-col">${formatCurrency(item.total)}</td><td class="num-col">${formatCurrency(item.perZfa)}</td><td class="num-col">${formatCurrency(item.perGsf)}</td><td class="num-col">${formatPercent(item.percent)}</td></tr>
            `).join('')}
            <tr style="background:#f8fafc; font-weight:700;"><td colspan="5">HARD CONSTRUCTION COSTS</td></tr>
            ${fData.hardCosts.map(item => `
              <tr><td>&nbsp;&nbsp;${item.name}</td><td class="num-col">${formatCurrency(item.total)}</td><td class="num-col">${formatCurrency(item.perZfa)}</td><td class="num-col">${formatCurrency(item.perGsf)}</td><td class="num-col">${formatPercent(item.percent)}</td></tr>
            `).join('')}
            <tr style="background:#f8fafc; font-weight:700;"><td colspan="5">SOFT PROFESSIONAL FEES</td></tr>
            ${fData.softCosts.map(item => `
              <tr><td>&nbsp;&nbsp;${item.name}</td><td class="num-col">${formatCurrency(item.total)}</td><td class="num-col">${formatCurrency(item.perZfa)}</td><td class="num-col">${formatCurrency(item.perGsf)}</td><td class="num-col">${formatPercent(item.percent)}</td></tr>
            `).join('')}
            <tr style="background:#f8fafc; font-weight:700;"><td colspan="5">FINANCING & TRANSACTION FEES</td></tr>
            ${fData.financingCosts.map(item => `
              <tr><td>&nbsp;&nbsp;${item.name}</td><td class="num-col">${formatCurrency(item.total)}</td><td class="num-col">${formatCurrency(item.perZfa)}</td><td class="num-col">${formatCurrency(item.perGsf)}</td><td class="num-col">${formatPercent(item.percent)}</td></tr>
            `).join('')}
            <tr style="background:#f8fafc; font-weight:700;"><td colspan="5">INTEREST & CARRY COSTS</td></tr>
            ${fData.interestCarryCosts.map(item => `
              <tr><td>&nbsp;&nbsp;${item.name}</td><td class="num-col">${formatCurrency(item.total)}</td><td class="num-col">${formatCurrency(item.perZfa)}</td><td class="num-col">${formatCurrency(item.perGsf)}</td><td class="num-col">${formatPercent(item.percent)}</td></tr>
            `).join('')}
            <tr class="total-row" style="background:#e2e8f0;">
              <td>TOTAL PROJECT DEVELOPMENT COSTS</td>
              <td class="num-col">${formatCurrency(fData.budgetTotals.totalProject)}</td>
              <td class="num-col">${formatCurrency(fData.budgetTotals.totalProject / zfa)}</td>
              <td class="num-col">${formatCurrency(fData.budgetTotals.totalProject / gsf)}</td>
              <td class="num-col">100.00%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Page 6: 421(a) Tax Abatement Schedule -->
    <div class="financials-print-section">
      <h2 style="font-size: 18px; border-bottom: 1px solid #94a3b8; padding-bottom: 6px; color: #000; margin-bottom: 16px;">6. 421(A) TAX ABATEMENT BENEFIT SCHEDULE</h2>
      <div style="font-size: 11px; margin-bottom: 12px; line-height: 1.5;">
        * <strong>NPV of 35-Year Tax Abatement Savings:</strong> ${formatCurrency(fData.abatementNPV)} (at ${formatPercent(fData.abatementSummary.discountRate)} discount rate).<br/>
        * Prior taxable land assessed value is ${formatCurrency(fData.abatementSummary.priorAv)}. Values grow at ${formatPercent(fData.abatementSummary.avGrowthRate)} assessed value / ${formatPercent(fData.abatementSummary.taxRateGrowth)} tax rate annually.
      </div>
      <div class="underwriting-table-wrapper">
        <table class="underwriting-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Program Date</th>
              <th>Exempt %</th>
              <th class="num-col">Assessed Value</th>
              <th class="num-col">Unabated RET</th>
              <th class="num-col">Abated RET</th>
              <th class="num-col">RET Savings</th>
            </tr>
          </thead>
          <tbody>
            ${fData.abatementSchedule.map(s => `
              <tr>
                <td>Year ${s.year}</td>
                <td>${s.startDate}</td>
                <td>${formatPercent(s.percentExempt)}</td>
                <td class="num-col">${formatCurrency(s.taxableAssessment)}</td>
                <td class="num-col">${formatCurrency(s.unabatedRet)}</td>
                <td class="num-col" style="color: #b91c1c;">${formatCurrency(s.abatedRet)}</td>
                <td class="num-col" style="color: #16a34a; font-weight: 700;">${formatCurrency(s.retSavings)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// Sidebar Tab Button Switch Action Listeners
function setupTabListeners() {
  const tabsContainer = document.getElementById('sidebar-tabs');
  if (!tabsContainer) return;

  tabsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;

    // Remove active state
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update state & re-render
    activeTab = btn.dataset.tab;
    renderActiveTab();
  });
}

// Financials Sub-pills click handler (Delegated on report panel)
reportPanel.addEventListener('click', (e) => {
  // Recalculate model action button click handler
  if (e.target && e.target.id === 'recalculate-model-btn') {
    const form = document.getElementById('assumptions-form');
    if (!form) return;

    // Collect inputs
    const formData = new FormData(form);
    const as = activeUnderwritingData.abatementSummary || {};
    
    for (const [key, val] of formData.entries()) {
      let cleanVal = val.trim();
      const pctParams = ['capRate', 'ltc', 'discountRate', 'fmVacancy', 'hpdVacancy', 'commVacancy', 'unabatedTaxPct', 'mgmtFeePct', 'hardContingencyPct', 'softCostPct', 'financingCostPct', 'carryInterestPct', 'avGrowthRate', 'taxRateGrowth', 'fmPct', 'studioPct', 'oneBedPct', 'twoBedPct'];
      if (pctParams.includes(key)) {
        cleanVal = cleanVal.replace('%', '').trim();
        const num = parseFloat(cleanVal);
        as[key] = num > 1 ? num / 100 : num;
      } else {
        as[key] = parseFloat(cleanVal) || cleanVal;
      }
    }

    isCustomized = true;

    const lotArea = parseInt(plutoData.lotarea, 10) || 0;
    const zoningRules = getZoningRules(plutoData.zonedist1, plutoData.spdist1) || {
      resFar: 0, commFar: 0, facilFar: 0, baseHeight: 60, contextual: false, maxBuildingHeight: 300
    };
    const bblStr = String(currentBBL || plutoData.bbl || '').split('.')[0];
    const displayAddress = currentAddressName || plutoData.address || `${plutoData.block} Block, ${plutoData.lot} Lot`;

    if (bblStr === "1017230017") {
      // Preserve the verified structure, just update its math using recalculateUnderwriting
      recalculateUnderwriting(activeUnderwritingData);
    } else {
      // Re-generate complete proforma from the new custom assumptions
      activeUnderwritingData = estimateFinancials(lotArea, zoningRules, displayAddress, bblStr, as);
    }

    // Re-render model summary page with updated parameters
    activeFinancialSubTab = 'summary';
    renderFinancialsTab();
    return;
  }

  const btn = e.target.closest('.sub-pill-btn');
  if (!btn) return;

  // Toggle active tab button styling
  document.querySelectorAll('.sub-pill-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Update active state
  activeFinancialSubTab = btn.dataset.subtab;
  
  // Re-render financials view
  const finContainer = document.getElementById('financials-view-container');
  if (finContainer) {
    finContainer.innerHTML = renderFinancialsSubTabContent();
  }
});

// Inline inputs change listener
reportPanel.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'log-spoke-with') {
    syncInteractionFields();
    return;
  }
  if (e.target && ['log-company', 'log-work-phone', 'log-cell-phone', 'log-email', 'log-address'].includes(e.target.id)) {
    toggleCustomInputsVisibility();
    return;
  }

  // 1. General edit inputs (Cap Rate, LTC, Prior AV, discount rate, etc.)
  const input = e.target.closest('.inline-edit-input');
  if (input) {
    const param = input.dataset.param;
    let val = input.value.trim();

    if (!activeUnderwritingData) return;

    // Parse percent parameters if needed
    const pctParams = ['capRate', 'ltc', 'discountRate', 'fmVacancy', 'hpdVacancy', 'commVacancy', 'unabatedTaxPct', 'mgmtFeePct', 'hardContingencyPct', 'softCostPct', 'financingCostPct', 'carryInterestPct', 'avGrowthRate', 'taxRateGrowth'];
    if (pctParams.includes(param)) {
      if (typeof val === 'string') {
        val = val.replace('%', '').trim();
      }
      const num = parseFloat(val);
      activeUnderwritingData.abatementSummary[param] = num > 1 ? num / 100 : num;
      if (param === 'capRate') activeUnderwritingData.valuationSummary.capRate = activeUnderwritingData.abatementSummary[param];
      if (param === 'ltc') activeUnderwritingData.capitalization.ltc = activeUnderwritingData.abatementSummary[param];
    } else {
      activeUnderwritingData.abatementSummary[param] = parseFloat(val);
    }

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);
    renderFinancialsTab();
    return;
  }

  // 2. Rent roll input changes (FM, HPD, Comm)
  const rrInput = e.target.closest('.inline-rentroll-input');
  if (rrInput) {
    const mix = rrInput.dataset.mix;
    const index = parseInt(rrInput.dataset.index, 10);
    const field = rrInput.dataset.field;
    const val = rrInput.value.trim();

    if (!activeUnderwritingData) return;

    if (mix === 'FM') {
      activeUnderwritingData.unitMixFM[index][field] = parseFloat(val) || 0;
    } else if (mix === 'HPD') {
      activeUnderwritingData.unitMixHPD[index][field] = parseFloat(val) || 0;
    } else if (mix === 'Comm') {
      if (field === 'unit') {
        activeUnderwritingData.unitMixComm[index][field] = val;
      } else {
        activeUnderwritingData.unitMixComm[index][field] = parseFloat(val) || 0;
      }
    }

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);
    
    // Maintain the active subtab when re-rendering
    const finContainer = document.getElementById('financials-view-container');
    if (finContainer) {
      finContainer.innerHTML = renderFinancialsSubTabContent();
    }
    return;
  }

  // 3. Budget input changes
  const budgetInput = e.target.closest('.inline-budget-input');
  if (budgetInput) {
    const category = budgetInput.dataset.category;
    const index = parseInt(budgetInput.dataset.index, 10);
    const val = parseFloat(budgetInput.value.trim()) || 0;

    if (!activeUnderwritingData) return;

    activeUnderwritingData[category][index].total = val;

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);

    const finContainer = document.getElementById('financials-view-container');
    if (finContainer) {
      finContainer.innerHTML = renderFinancialsSubTabContent();
    }
    return;
  }

  // 3b. Budget rate input changes
  const budgetRateInput = e.target.closest('.inline-budget-rate-input');
  if (budgetRateInput) {
    const category = budgetRateInput.dataset.category;
    const index = parseInt(budgetRateInput.dataset.index, 10);
    const val = parseFloat(budgetRateInput.value.trim()) || 0;

    if (!activeUnderwritingData) return;

    activeUnderwritingData[category][index].rate = val;

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);

    const finContainer = document.getElementById('financials-view-container');
    if (finContainer) {
      finContainer.innerHTML = renderFinancialsSubTabContent();
    }
    return;
  }

  // 3c. Budget basis dropdown changes
  const budgetBasisSelect = e.target.closest('.inline-budget-basis-select');
  if (budgetBasisSelect) {
    const category = budgetBasisSelect.dataset.category;
    const index = parseInt(budgetBasisSelect.dataset.index, 10);
    const val = budgetBasisSelect.value.trim();

    if (!activeUnderwritingData) return;

    activeUnderwritingData[category][index].basis = val;

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);

    const finContainer = document.getElementById('financials-view-container');
    if (finContainer) {
      finContainer.innerHTML = renderFinancialsSubTabContent();
    }
    return;
  }

  // 4. Operating expense input changes
  const expenseInput = e.target.closest('.inline-expense-input');
  if (expenseInput) {
    const index = parseInt(expenseInput.dataset.index, 10);
    const val = parseFloat(expenseInput.value.trim()) || 0;

    if (!activeUnderwritingData) return;

    // Expenses are negative in our calculation array
    activeUnderwritingData.expenses[index].total = -Math.abs(val);

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);

    const finContainer = document.getElementById('financials-view-container');
    if (finContainer) {
      finContainer.innerHTML = renderFinancialsSubTabContent();
    }
    return;
  }

  // 5. Direct Senior Construction Loan capitalization input changes
  const capInput = e.target.closest('.inline-capitalization-input');
  if (capInput) {
    const field = capInput.dataset.field;
    const val = parseFloat(capInput.value.trim()) || 0;

    if (!activeUnderwritingData) return;

    if (field === 'constructionLoan') {
      const totalCost = activeUnderwritingData.budgetTotals.totalProject;
      const newLtc = totalCost > 0 ? val / totalCost : 0;
      activeUnderwritingData.abatementSummary.ltc = newLtc;
    }

    isCustomized = true;
    recalculateUnderwriting(activeUnderwritingData);

    const finContainer = document.getElementById('financials-view-container');
    if (finContainer) {
      finContainer.innerHTML = renderFinancialsSubTabContent();
    }
  }
});

// Click handler for contacts subform and logs
reportPanel.addEventListener('click', (e) => {
  // Set today datetime button click handler
  if (e.target && e.target.id === 'set-today-btn') {
    const logDatetimeInput = document.getElementById('log-datetime');
    if (logDatetimeInput) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      logDatetimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    return;
  }

  // Save contacts button click handler
  if (e.target && e.target.id === 'save-contacts-btn') {
    const newContacts = getContactsFromDOM();

    const contactsData = getPropertyContactsData() || { logs: [] };
    contactsData.contacts = newContacts;

    // For backward compatibility keep the first owner and sales broker
    const owner = newContacts.find(c => c.role === 'owner');
    if (owner) {
      contactsData.ownerFirstName = owner.firstName;
      contactsData.ownerLastName = owner.lastName;
    } else {
      contactsData.ownerFirstName = '';
      contactsData.ownerLastName = '';
    }

    const broker = newContacts.find(c => c.role === 'sales-broker');
    if (broker) {
      contactsData.salesBrokerFirstName = broker.firstName;
      contactsData.salesBrokerLastName = broker.lastName;
    } else {
      contactsData.salesBrokerFirstName = '';
      contactsData.salesBrokerLastName = '';
    }

    savePropertyContactsData(contactsData);

    const feedback = document.getElementById('contacts-save-feedback');
    if (feedback) {
      feedback.innerHTML = `<div class="save-success-msg">✓ Contact information saved successfully!</div>`;
      setTimeout(() => {
        feedback.innerHTML = '';
      }, 3000);
    }
    renderContactsTab();
    return;
  }

  // Add contact field button click handler
  if (e.target && e.target.id === 'add-contact-field-btn') {
    const currentContacts = getContactsFromDOM();
    
    currentContacts.push({
      firstName: '',
      lastName: '',
      role: 'other',
      company: '',
      workPhone: '',
      cellPhone: '',
      email: '',
      address: ''
    });
    
    const contactsData = getPropertyContactsData() || { logs: [] };
    contactsData.contacts = currentContacts;
    savePropertyContactsData(contactsData);
    renderContactsTab();
    return;
  }

  // Remove contact field button click handler
  const removeContactBtn = e.target.closest('.remove-contact-btn');
  if (removeContactBtn) {
    const index = parseInt(removeContactBtn.dataset.index, 10);
    const currentContacts = getContactsFromDOM().filter((_, i) => i !== index);
    
    const contactsData = getPropertyContactsData() || { logs: [] };
    contactsData.contacts = currentContacts;
    savePropertyContactsData(contactsData);
    renderContactsTab();
    return;
  }

  if (e.target && e.target.id === 'toggle-new-log-btn') {
    const container = document.getElementById('new-log-form-container');
    if (container.style.display === 'none') {
      container.style.display = 'block';
      e.target.innerText = '− Cancel';
    } else {
      container.style.display = 'none';
      e.target.innerText = '+ New Interaction';
    }
    return;
  }

  // Add contact log button click handler
  if (e.target && e.target.id === 'add-log-btn') {
    const spokeWithSelect = document.getElementById('log-spoke-with');
    const spokeWithValue = spokeWithSelect?.value || 'other';

    const contactsData = getPropertyContactsData() || { logs: [] };
    const ownerName = [contactsData.ownerFirstName, contactsData.ownerLastName].filter(Boolean).join(' ');
    const brokerName = [contactsData.salesBrokerFirstName, contactsData.salesBrokerLastName].filter(Boolean).join(' ');

    let spokeWith = '';
    let role = '';
    let company = '';
    let workPhone = '';
    let cellPhone = '';
    let email = '';
    let address = '';

    if (spokeWithValue === 'owner') {
      spokeWith = ownerName || 'Property Owner';
      role = 'owner';
    } else if (spokeWithValue === 'sales-broker') {
      spokeWith = brokerName || 'Sales Broker';
      role = 'sales-broker';
    } else if (spokeWithValue.startsWith('saved|')) {
      const parts = spokeWithValue.split('|');
      spokeWith = parts[1];
      role = parts[2] || 'other';
    } else if (spokeWithValue.startsWith('contact|')) {
      const parts = spokeWithValue.split('|');
      spokeWith = parts[1];
      role = parts[2] || 'other';
    } else {
      spokeWith = document.getElementById('log-custom-name')?.value.trim() || 'Other';
    }

    // Role
    role = document.getElementById('log-role')?.value || 'other';

    // Company
    const companySelectVal = document.getElementById('log-company')?.value;
    company = companySelectVal === 'custom' 
      ? (document.getElementById('log-custom-company')?.value.trim() || '')
      : (companySelectVal === 'none' ? '' : companySelectVal);

    // Work Phone
    const workPhoneSelectVal = document.getElementById('log-work-phone')?.value;
    workPhone = workPhoneSelectVal === 'custom' 
      ? (document.getElementById('log-custom-work-phone')?.value.trim() || '')
      : (workPhoneSelectVal === 'none' ? '' : workPhoneSelectVal);

    // Cell Phone
    const cellPhoneSelectVal = document.getElementById('log-cell-phone')?.value;
    cellPhone = cellPhoneSelectVal === 'custom' 
      ? (document.getElementById('log-custom-cell-phone')?.value.trim() || '')
      : (cellPhoneSelectVal === 'none' ? '' : cellPhoneSelectVal);

    // Email
    const emailSelectVal = document.getElementById('log-email')?.value;
    email = emailSelectVal === 'custom' 
      ? (document.getElementById('log-custom-email')?.value.trim() || '')
      : (emailSelectVal === 'none' ? '' : emailSelectVal);

    // Address
    const addressSelectVal = document.getElementById('log-address')?.value;
    address = addressSelectVal === 'custom' 
      ? (document.getElementById('log-custom-address')?.value.trim() || '')
      : (addressSelectVal === 'none' ? '' : addressSelectVal);

    const dateTime = document.getElementById('log-datetime')?.value || new Date().toISOString();
    const notes = document.getElementById('log-notes')?.value || '';

    contactsData.logs.push({
      id: String(Date.now()),
      spokeWith,
      role,
      company,
      workPhone,
      cellPhone,
      email,
      address,
      dateTime,
      notes
    });

    savePropertyContactsData(contactsData);
    renderContactsTab();
    return;
  }

  // Delete contact log entry button click handler
  const deleteLogBtn = e.target.closest('.log-delete-btn');
  if (deleteLogBtn) {
    const id = deleteLogBtn.dataset.id;
    const contactsData = getPropertyContactsData() || { ownerFirstName: '', ownerLastName: '', salesBrokerFirstName: '', salesBrokerLastName: '', logs: [] };
    contactsData.logs = contactsData.logs.filter(log => String(log.id || log.dateTime) !== String(id));
    savePropertyContactsData(contactsData);
    renderContactsTab();
    return;
  }
});

// Run Tab Button Listener initialization
setupTabListeners();

// Initialize Saved Locations UI and Events
renderSavedLocationsList();
setupSavedLocationsEvents();

// Viewport Sizing Mode Handlers
const viewportsContainer = document.querySelector('.viewports-container');
const btnSize2D = document.getElementById('btn-size-2d');
const btnSize3D = document.getElementById('btn-size-3d');

if (btnSize2D && btnSize3D) {
  btnSize2D.addEventListener('click', () => {
    if (viewportsContainer.classList.contains('maximized-2d')) {
      viewportsContainer.classList.remove('maximized-2d');
      btnSize2D.innerHTML = '⛶';
      btnSize2D.title = 'Maximize 2D Map';
    } else {
      viewportsContainer.classList.remove('maximized-3d');
      viewportsContainer.classList.add('maximized-2d');
      btnSize2D.innerHTML = '↕';
      btnSize2D.title = 'Restore Split View';
      btnSize3D.innerHTML = '⛶';
      btnSize3D.title = 'Maximize 3D Viewer';
    }
    // Force Leaflet and Three.js resize updates
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (map) map.invalidateSize();
    }, 100);
  });

  btnSize3D.addEventListener('click', () => {
    if (viewportsContainer.classList.contains('maximized-3d')) {
      viewportsContainer.classList.remove('maximized-3d');
      btnSize3D.innerHTML = '⛶';
      btnSize3D.title = 'Maximize 3D Viewer';
    } else {
      viewportsContainer.classList.remove('maximized-2d');
      viewportsContainer.classList.add('maximized-3d');
      btnSize3D.innerHTML = '↕';
      btnSize3D.title = 'Restore Split View';
      btnSize2D.innerHTML = '⛶';
      btnSize2D.title = 'Maximize 2D Map';
    }
    // Force Leaflet and Three.js resize updates
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (map) map.invalidateSize();
    }, 100);
  });
}

// Capture and update the 3D model screenshot for print media before printing
window.addEventListener('beforeprint', () => {
  const printImg = document.getElementById('print-3d-image');
  const printImgPlaceholder = document.getElementById('print-3d-image-placeholder');
  if (renderer && scene && camera) {
    // Force a render pass to ensure drawing buffer is complete
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    if (printImg) printImg.src = dataUrl;
    if (printImgPlaceholder) printImgPlaceholder.src = dataUrl;
  }
});

// Automatically load the default verified lot on startup
loadSite("1017230017", null, "33-35 W 125th St");

