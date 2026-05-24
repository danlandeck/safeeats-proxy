// SafeEats Proxy API - Vercel Serverless Function
// Routes food inspection searches to the correct city API
// and enforces strict geographic filtering before returning results.

const CITY_CONFIGS = {
  seattle: {
    url: 'https://data.kingcounty.gov/resource/f29f-zza5.json',
    nameField: 'name',
    buildQuery: (q) => ({
      $where: `upper(name) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'name ASC',
    }),
    normalize: (r) => ({
      id: r.business_id || r.inspection_serial_num || `${r.name}-${r.address}`,
      name: r.name || '',
      address: r.address || '',
      city: r.city || '',
      zip: r.zip_code || '',
      phone: r.phone || '',
      lat: r.latitude || null,
      lng: r.longitude || null,
      inspection_date: r.inspection_date || '',
      inspection_score: r.inspection_score || null,
      inspection_result: r.inspection_result || '',
      grade: r.grade || '',
      description: r.description || '',
      violation_description: r.violation_description || '',
      violation_points: r.violation_points || 0,
    }),
    // Hard geographic filter — drop anything not in King County WA
    geoFilter: (r) => {
      const city = (r.city || '').toUpperCase();
      const zip = (r.zip || '').replace(/\s/g, '');
      const validZips = /^98(0[0-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])$/;
      const kcCities = ['SEATTLE','BELLEVUE','KIRKLAND','REDMOND','RENTON','KENT',
        'AUBURN','FEDERAL WAY','BURIEN','SHORELINE','BOTHELL','ISSAQUAH',
        'SAMMAMISH','MERCER ISLAND','TUKWILA','DES MOINES','KENMORE','COVINGTON',
        'MAPLE VALLEY','BLACK DIAMOND','ENUMCLAW','SNOQUALMIE','NORTH BEND',
        'FALL CITY','CARNATION','DUVALL','WOODINVILLE','MEDINA','CLYDE HILL',
        'YARROW POINT','HUNTS POINT','NEWCASTLE','NORMANDY PARK','ALGONA',
        'PACIFIC','MILTON','EDGEWOOD','SKYWAY','WHITE CENTER','LAKE FOREST PARK'];
      return kcCities.includes(city) || validZips.test(zip);
    },
  },

  nyc: {
    url: 'https://data.cityofnewyork.us/resource/43nn-pn8j.json',
    nameField: 'dba',
    buildQuery: (q) => ({
      $where: `upper(dba) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'dba ASC',
    }),
    normalize: (r) => ({
      id: r.camis || `${r.dba}-${r.building}-${r.street}`,
      name: r.dba || '',
      address: `${r.building || ''} ${r.street || ''}`.trim(),
      city: r.boro || '',
      zip: r.zipcode || '',
      phone: r.phone || '',
      lat: r.latitude || null,
      lng: r.longitude || null,
      inspection_date: r.inspection_date || '',
      inspection_score: r.score || null,
      inspection_result: r.action || '',
      grade: r.grade || '',
      description: r.cuisine_description || '',
      violation_description: r.violation_description || '',
      violation_points: 0,
    }),
    geoFilter: (r) => {
      const validBoros = ['MANHATTAN','BROOKLYN','QUEENS','BRONX','STATEN ISLAND','BK','MN','QN','BX','SI'];
      return validBoros.includes((r.city || '').toUpperCase());
    },
  },

  chicago: {
    url: 'https://data.cityofchicago.org/resource/4ijn-s7e5.json',
    nameField: 'aka_name',
    buildQuery: (q) => ({
      $where: `upper(aka_name) like '%${q.toUpperCase()}%' OR upper(legal_name) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'aka_name ASC',
    }),
    normalize: (r) => ({
      id: r.license_ || `${r.aka_name}-${r.address}`,
      name: r.aka_name || r.legal_name || '',
      address: r.address || '',
      city: r.city || 'Chicago',
      zip: r.zip || '',
      phone: r.license_description || '',
      lat: r.latitude || null,
      lng: r.longitude || null,
      inspection_date: r.inspection_date || '',
      inspection_score: null,
      inspection_result: r.results || '',
      grade: r.results || '',
      description: r.facility_type || '',
      violation_description: r.violations || '',
      violation_points: 0,
    }),
    geoFilter: (r) => (r.city || 'Chicago').toUpperCase() === 'CHICAGO' || (r.city || '') === '',
  },

  austin: {
    url: 'https://data.austintexas.gov/resource/ecmv-9xxi.json',
    nameField: 'restaurant_name',
    buildQuery: (q) => ({
      $where: `upper(restaurant_name) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'restaurant_name ASC',
    }),
    normalize: (r) => ({
      id: r.restaurant_id || `${r.restaurant_name}-${r.address}`,
      name: r.restaurant_name || '',
      address: r.address || '',
      city: r.city || 'Austin',
      zip: r.zip_code || '',
      phone: '',
      lat: r.latitude || null,
      lng: r.longitude || null,
      inspection_date: r.inspection_date || '',
      inspection_score: r.score || null,
      inspection_result: '',
      grade: r.grade || '',
      description: r.facility_id || '',
      violation_description: '',
      violation_points: 0,
    }),
    geoFilter: (r) => {
      const zip = (r.zip || '').replace(/\s/g, '');
      const city = (r.city || '').toUpperCase();
      return city.includes('AUSTIN') || zip.startsWith('787') || city === '';
    },
  },

  sf: {
    url: 'https://data.sfgov.org/resource/pyih-qa8i.json',
    nameField: 'business_name',
    buildQuery: (q) => ({
      $where: `upper(business_name) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'business_name ASC',
    }),
    normalize: (r) => ({
      id: r.business_id || `${r.business_name}-${r.business_address}`,
      name: r.business_name || '',
      address: r.business_address || '',
      city: r.business_city || 'San Francisco',
      zip: r.business_postal_code || '',
      phone: r.business_phone_number || '',
      lat: r.business_latitude || null,
      lng: r.business_longitude || null,
      inspection_date: r.inspection_date || '',
      inspection_score: r.inspection_score || null,
      inspection_result: '',
      grade: r.inspection_score >= 90 ? 'A' : r.inspection_score >= 80 ? 'B' : r.inspection_score >= 70 ? 'C' : '',
      description: r.business_description || '',
      violation_description: r.violation_description || '',
      violation_points: 0,
    }),
    geoFilter: (r) => {
      const city = (r.city || '').toUpperCase();
      const zip = (r.zip || '').replace(/\s/g, '');
      return city.includes('SAN FRANCISCO') || city.includes('SF') || zip.startsWith('941') || city === '';
    },
  },

  la: {
    url: 'https://data.lacounty.gov/resource/ga4s-mqqp.json',
    nameField: 'facility_name',
    buildQuery: (q) => ({
      $where: `upper(facility_name) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'facility_name ASC',
    }),
    normalize: (r) => ({
      id: r.facility_id || `${r.facility_name}-${r.facility_address}`,
      name: r.facility_name || '',
      address: r.facility_address || '',
      city: r.facility_city || '',
      zip: r.facility_zip || '',
      phone: '',
      lat: r.latitude || null,
      lng: r.longitude || null,
      inspection_date: r.activity_date || '',
      inspection_score: r.score || null,
      inspection_result: '',
      grade: r.grade || '',
      description: r.pe_description || '',
      violation_description: r.violation_description || '',
      violation_points: r.points || 0,
    }),
    geoFilter: (r) => {
      const zip = (r.zip || '').replace(/\s/g, '');
      const city = (r.city || '').toUpperCase();
      // LA County zips: 900xx-918xx
      return /^9(0[0-9]{3}|1[0-8][0-9]{2})$/.test(zip) || city.includes('LOS ANGELES') || city.includes('LA') || city === '';
    },
  },

  montgomery: {
    url: 'https://data.montgomerycountymd.gov/resource/6dba-2py5.json',
    nameField: 'establishmentname',
    buildQuery: (q) => ({
      $where: `upper(establishmentname) like '%${q.toUpperCase()}%'`,
      $limit: 100,
      $order: 'establishmentname ASC',
    }),
    normalize: (r) => ({
      id: r.objectid || `${r.establishmentname}-${r.address}`,
      name: r.establishmentname || '',
      address: r.address || '',
      city: r.city || '',
      zip: r.zip || '',
      phone: r.phonenumber || '',
      lat: r.y || null,
      lng: r.x || null,
      inspection_date: r.inspectiondate || '',
      inspection_score: null,
      inspection_result: r.result || '',
      grade: r.result || '',
      description: r.category || '',
      violation_description: '',
      violation_points: 0,
    }),
    geoFilter: (r) => {
      const state = (r.city || '').toUpperCase();
      // Montgomery County MD zip codes: 20800-20999
      const zip = (r.zip || '').replace(/\s/g, '');
      return /^20[89][0-9]{2}$/.test(zip) || state.includes('MD') || state === '';
    },
  },
};

export default async function handler(req, res) {
  // CORS headers — allow SafeEats frontend to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { city, q } = req.query;

  if (!city || !q) {
    return res.status(400).json({ error: 'Missing required params: city and q' });
  }

  const cityKey = city.toLowerCase().trim();
  const config = CITY_CONFIGS[cityKey];

  if (!config) {
    return res.status(400).json({
      error: `Unknown city: "${city}". Valid options: ${Object.keys(CITY_CONFIGS).join(', ')}`,
    });
  }

  const searchTerm = q.trim();
  if (searchTerm.length < 2) {
    return res.status(400).json({ error: 'Search term must be at least 2 characters' });
  }

  try {
    const params = new URLSearchParams(config.buildQuery(searchTerm));
    const apiUrl = `${config.url}?${params.toString()}`;

    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'X-App-Token': process.env.SOCRATA_APP_TOKEN || '',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[SafeEats] ${cityKey} API error ${response.status}:`, errText);
      return res.status(502).json({
        error: `Upstream API error for ${city}`,
        status: response.status,
        detail: errText,
      });
    }

    const raw = await response.json();

    if (!Array.isArray(raw)) {
      console.error(`[SafeEats] ${cityKey} returned non-array:`, raw);
      return res.status(502).json({ error: `Unexpected response format from ${city} API` });
    }

    // Normalize to common schema
    const normalized = raw.map(config.normalize);

    // HARD geographic filter — city-specific, drops anything that doesn't belong
    const filtered = normalized.filter(config.geoFilter);

    // Deduplicate by name+address (inspection data often has one row per violation)
    const seen = new Set();
    const deduped = filtered.filter((r) => {
      const key = `${r.name}||${r.address}`.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.status(200).json({
      city: cityKey,
      query: searchTerm,
      count: deduped.length,
      results: deduped,
    });
  } catch (err) {
    console.error(`[SafeEats] Unhandled error for ${cityKey}:`, err);
    return res.status(500).json({ error: 'Internal proxy error', detail: err.message });
  }
}
