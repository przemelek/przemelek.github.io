/* ==========================================================================
   GEOSPOTTER - Core Application Logic
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. App State & Local Storage Keys
// --------------------------------------------------------------------------
const STORAGE_SETTINGS_KEY = 'geospotter_settings_v1';

// Default presets (fallback when GPS is disabled or for instant simulation)
const LOCATION_PRESETS = {
  podgorze: { name: "Current Location (Podgórze, Kraków)", lat: 50.046679, lon: 19.950907 },
  krakow: { name: "Kraków Main Market", lat: 50.0619, lon: 19.9373 },
  warsaw: { name: "Warsaw Old Town", lat: 52.2479, lon: 21.0142 },
  paris: { name: "Paris - Eiffel Tower", lat: 48.8584, lon: 2.2945 },
  london: { name: "London - Big Ben", lat: 51.5007, lon: -0.1246 },
  newyork: { name: "New York - Times Square", lat: 40.7580, lon: -73.9855 },
  tokyo: { name: "Tokyo - Shibuya", lat: 35.6595, lon: 139.7004 },
  rome: { name: "Rome - Colosseum", lat: 41.8902, lon: 12.4922 },
  berlin: { name: "Berlin - Brandenburg Gate", lat: 52.5163, lon: 13.3777 }
};

// Initial state
const state = {
  userPos: { lat: 50.046679, lon: 19.950907, accuracy: 5, isSimulated: true }, // Default to test location
  searchCenter: { lat: 50.046679, lon: 19.950907 },
  radius: 1000,            // meters: 50, 200, 500, 1000, 2000, 5000, 10000
  sourceFilter: 'all',     // 'all' | 'wikipedia' | 'wikimapia' | 'wikidata'
  categoryFilter: 'all',   // 'all' | 'culture' | 'historic' | 'architecture' | 'infrastructure' | 'parks' | 'religious' | 'streets'
  textFilter: '',          // search keyword in places
  sortOrder: 'distance-asc',// 'distance-asc' | 'distance-desc' | 'name-asc'
  wikipediaLang: 'pl',     // default to Polish for Poland coordinates (auto-switches or selectable)
  wikimapiaKey: 'example', // default trial key (CORS enabled)
  maxResults: 50,
  mapLayer: 'osm',         // 'osm' (Pure OpenStreetMap - NO API key needed) | 'topo'
  places: [],              // unified normalized places array
  activePlaceId: null,     // currently selected/focused place
  isFetching: false,
  gpsWatchId: null
};

// --------------------------------------------------------------------------
// 2. Geodesic Calculations & Helpers
// --------------------------------------------------------------------------

/**
 * Calculates geodesic distance between two coordinates in meters (Haversine formula).
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Calculates bearing from point 1 to point 2 in degrees [0, 360).
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return Math.round((brng + 360) % 360);
}

/**
 * Returns cardinal direction and compass arrow for a given bearing angle.
 */
function getBearingInfo(bearing) {
  const directions = [
    { label: 'N',  arrow: '↑', min: 337.5, max: 22.5 },
    { label: 'NE', arrow: '↗', min: 22.5,  max: 67.5 },
    { label: 'E',  arrow: '→', min: 67.5,  max: 112.5 },
    { label: 'SE', arrow: '↘', min: 112.5, max: 157.5 },
    { label: 'S',  arrow: '↓', min: 157.5, max: 202.5 },
    { label: 'SW', arrow: '↙', min: 202.5, max: 247.5 },
    { label: 'W',  arrow: '←', min: 247.5, max: 292.5 },
    { label: 'NW', arrow: '↖', min: 292.5, max: 337.5 }
  ];

  for (const d of directions) {
    if (d.label === 'N') {
      if (bearing >= 337.5 || bearing < 22.5) return d;
    } else if (bearing >= d.min && bearing < d.max) {
      return d;
    }
  }
  return { label: 'N', arrow: '↑' };
}

/**
 * Formats a distance in meters into human readable string.
 */
function formatDistance(meters) {
  if (meters === null || meters === undefined || isNaN(meters)) return '-- m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// --------------------------------------------------------------------------
// 2.5 Categories & Semantic Classification
// --------------------------------------------------------------------------
const CATEGORY_DEFINITIONS = {
  culture: { key: 'culture', label: '🎨 Culture & Museum', color: '#8b5cf6' },
  historic: { key: 'historic', label: '📜 Historic & Memorial', color: '#f43f5e' },
  architecture: { key: 'architecture', label: '🏛️ Architecture', color: '#f59e0b' },
  infrastructure: { key: 'infrastructure', label: '🌉 Bridges & Transit', color: '#06b6d4' },
  parks: { key: 'parks', label: '🌳 Parks & Squares', color: '#10b981' },
  religious: { key: 'religious', label: '✝️ Sacred', color: '#3b82f6' },
  streets: { key: 'streets', label: '🏠 Addresses', color: '#64748b' },
  other: { key: 'other', label: '📍 Landmarks', color: '#0ea5e9' }
};

function classifyPlace(title, description, tags = [], source = '') {
  const text = `${title} ${description || ''} ${(tags || []).join(' ')}`.toLowerCase();

  if (/muzeum|galeria|teatr|cricoteka|kino|filharmonia|opera|museum|gallery|theatre|cinema|arts_centre/.test(text)) {
    return CATEGORY_DEFINITIONS.culture;
  }
  if (/kościół|synagoga|cerkiew|cmentarz|parafia|dekanat|klasztor|bazylika|kaplica|church|synagogue|mosque|temple|cemetery|convent|monastery/.test(text)) {
    return CATEGORY_DEFINITIONS.religious;
  }
  if (/most|kładka|tunel|dworzec|stacja|lotnisko|port|wiadukt|przejście|bridge|station|railway|tunnel|airport/.test(text)) {
    return CATEGORY_DEFINITIONS.infrastructure;
  }
  if (/getto|pomnik|pamięci|tablica|kopiec|zabytek|kurhan|ruiny|zamek|fort|bunkier|memorial|monument|ruins|castle|fortress/.test(text)) {
    return CATEGORY_DEFINITIONS.historic;
  }
  if (/park|plac|skwer|ogród|rezerwat|las|błonia|square|garden|nature|forest/.test(text)) {
    return CATEGORY_DEFINITIONS.parks;
  }
  if (/^ul\.|^ulica|avenue|street|boulevard|aleja|droga/.test(title.trim().toLowerCase())) {
    return CATEGORY_DEFINITIONS.streets;
  }
  if (/kamienica|budynek|dom|dwór|pałac|willa|dworek|komunalna|szkoła|building|house|palace|villa|mansion/.test(text)) {
    return CATEGORY_DEFINITIONS.architecture;
  }

  return CATEGORY_DEFINITIONS.other;
}

// --------------------------------------------------------------------------
// 3. Map Management (Leaflet)
// --------------------------------------------------------------------------
let map = null;
let userMarker = null;
let radiusCircle = null;
let placesLayerGroup = null;
let currentTileLayer = null;
const placeMarkers = new Map();
const placePolygons = new Map();

// Tile Providers (100% Free OpenStreetMap & Community Mirrors - ZERO API keys required, no localhost block)
const TILE_PROVIDERS = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap France | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 20
  },
  hot: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles by <a href="https://www.hotosm.org/">HOT</a>',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 19
  },
  esri: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 17
  }
};

function initMap(initialLat, initialLon) {
  map = L.map('map', {
    center: [initialLat, initialLon],
    zoom: 15,
    zoomControl: true,
    attributionControl: true
  });

  // Set default tile layer
  setMapLayer(state.mapLayer);

  // Layer group for all places markers
  placesLayerGroup = L.layerGroup().addTo(map);

  // Track map move to display "Search This Area" if user pans away from current center
  map.on('moveend', () => {
    if (!state.searchCenter) return;
    const center = map.getCenter();
    const distFromCenter = calculateDistance(state.searchCenter.lat, state.searchCenter.lon, center.lat, center.lng);
    const searchHereBtn = document.getElementById('search-here-btn');
    if (distFromCenter > Math.max(state.radius * 0.3, 100)) {
      searchHereBtn.classList.remove('hidden');
    } else {
      searchHereBtn.classList.add('hidden');
    }
  });
}

function setMapLayer(layerKey) {
  if (currentTileLayer) {
    map.removeLayer(currentTileLayer);
  }
  const config = TILE_PROVIDERS[layerKey] || TILE_PROVIDERS.osm;
  currentTileLayer = L.tileLayer(config.url, {
    attribution: config.attribution,
    subdomains: config.subdomains || 'abc',
    maxZoom: config.maxZoom || 19
  }).addTo(map);

  state.mapLayer = TILE_PROVIDERS[layerKey] ? layerKey : 'osm';
  saveSettings();

  // Update UI dropdown active state
  document.querySelectorAll('.layer-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layer === state.mapLayer);
  });
}

function updateUserLocationMarker(lat, lon, accuracy) {
  if (!map) return;

  const beaconHtml = `
    <div class="user-beacon-marker" title="Your Location (${accuracy ? '±' + Math.round(accuracy) + 'm' : ''})">
      <div class="user-beacon-pulse"></div>
      <div class="user-beacon-center"></div>
    </div>
  `;

  const icon = L.divIcon({
    className: 'custom-beacon-div-icon',
    html: beaconHtml,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  if (!userMarker) {
    userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lon]);
  }

  updateRadiusCircle(lat, lon);
}

function updateRadiusCircle(lat, lon) {
  if (!map) return;

  if (radiusCircle) {
    radiusCircle.setLatLng([lat, lon]);
    radiusCircle.setRadius(state.radius);
  } else {
    radiusCircle = L.circle([lat, lon], {
      radius: state.radius,
      color: '#06b6d4',
      weight: 1.5,
      opacity: 0.8,
      fillColor: '#06b6d4',
      fillOpacity: 0.08,
      dashArray: '5, 5'
    }).addTo(map);
  }
}

function zoomToRadiusBounds() {
  if (radiusCircle && map) {
    map.fitBounds(radiusCircle.getBounds(), {
      padding: [30, 30],
      maxZoom: 18,
      animate: true
    });
  }
}

function renderPlaceMarkersOnMap(places) {
  if (!map || !placesLayerGroup) return;

  placesLayerGroup.clearLayers();
  placeMarkers.clear();
  placePolygons.clear();

  places.forEach(place => {
    let pinClass = 'pin-wikimapia';
    let pinLetter = 'M';
    let badgeClass = 'badge-wikimapia';
    let badgeLabel = 'Wikimapia';

    if (place.source === 'wikipedia') {
      pinClass = 'pin-wikipedia';
      pinLetter = 'W';
      badgeClass = 'badge-wikipedia';
      badgeLabel = 'Wikipedia';
    } else if (place.source === 'wikidata') {
      pinClass = 'pin-wikidata';
      pinLetter = 'D';
      badgeClass = 'badge-wikidata';
      badgeLabel = 'Wikidata';
    }

    const baseColor = place.category?.color || (place.source === 'wikipedia' ? '#2563eb' : (place.source === 'wikidata' ? '#a855f7' : '#d97706'));

    // Popup content
    const popupHtml = `
      <div class="popup-container">
        <div class="popup-header">
          <span class="card-badge ${badgeClass}">${badgeLabel}</span>
          ${place.category ? `<span class="card-category-tag">${place.category.label}</span>` : ''}
          <span class="card-distance font-tech">${formatDistance(place.distance)}</span>
        </div>
        <h4 class="popup-title">${escapeHtml(place.title)}</h4>
        ${place.polygon ? `<span class="shape-indicator">📐 Footprint Shape Available</span>` : ''}
        ${place.extract ? `<p class="popup-desc">${escapeHtml(place.extract)}</p>` : ''}
        <div class="popup-footer">
          <a href="${place.url}" target="_blank" rel="noopener noreferrer" class="popup-link">
            Open in ${badgeLabel} ↗
          </a>
          <button class="btn-card-action" onclick="window.showPlaceDetails('${place.id}')">
            Details
          </button>
        </div>
      </div>
    `;

    // 1. Draw polygon shape if available (building footprint, park border, quarter)
    if (place.polygon && Array.isArray(place.polygon) && place.polygon.length >= 3) {
      // Wikimapia polygon points are {x: lon, y: lat}
      const latlngs = place.polygon.map(pt => [pt.y, pt.x]);
      const poly = L.polygon(latlngs, {
        color: baseColor,
        weight: 2,
        opacity: 0.9,
        fillColor: baseColor,
        fillOpacity: 0.25
      });

      poly.bindPopup(popupHtml, { maxWidth: 280 });

      poly.on('click', () => {
        highlightPlaceCard(place.id);
      });

      poly.on('mouseover', () => {
        poly.setStyle({ weight: 3.5, fillOpacity: 0.45, color: '#06b6d4' });
      });

      poly.on('mouseout', () => {
        if (state.activePlaceId !== place.id) {
          poly.setStyle({ weight: 2, fillOpacity: 0.25, color: baseColor });
        }
      });

      poly.addTo(placesLayerGroup);
      placePolygons.set(place.id, poly);
    }

    // 2. Draw center POI Pin Marker
    const icon = L.divIcon({
      className: 'custom-pin-wrapper',
      html: `<div class="custom-pin ${pinClass}" style="width: 24px; height: 24px; font-size: 11px;">${pinLetter}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14]
    });

    const marker = L.marker([place.lat, place.lon], { icon });
    marker.bindPopup(popupHtml, { maxWidth: 280 });

    marker.on('click', () => {
      highlightPlaceCard(place.id);
    });

    marker.addTo(placesLayerGroup);
    placeMarkers.set(place.id, marker);
  });
}

function focusPlaceOnMap(placeId, openPopup = true) {
  const place = state.places.find(p => p.id === placeId);
  const marker = placeMarkers.get(placeId);
  const poly = placePolygons.get(placeId);

  // Reset previously active polygon styles
  placePolygons.forEach((p, id) => {
    const isWiki = id.startsWith('wiki_');
    p.setStyle({
      weight: 2,
      fillOpacity: 0.25,
      color: isWiki ? '#2563eb' : '#d97706'
    });
  });

  if (poly) {
    poly.setStyle({
      weight: 4,
      fillOpacity: 0.5,
      color: '#06b6d4'
    });
  }

  if (place && map) {
    if (poly) {
      map.fitBounds(poly.getBounds(), {
        padding: [60, 60],
        maxZoom: 18,
        animate: true
      });
    } else {
      map.flyTo([place.lat, place.lon], Math.max(map.getZoom(), 16), {
        duration: 0.8
      });
    }

    if (openPopup) {
      if (poly) {
        setTimeout(() => poly.openPopup(), 350);
      } else if (marker) {
        setTimeout(() => marker.openPopup(), 350);
      }
    }
  }
}

// --------------------------------------------------------------------------
// 4. API Fetchers: Wikipedia & Wikimapia (with in-memory smart caching)
// --------------------------------------------------------------------------
const wikimapiaCache = new Map(); // key: lat_lon -> rawPlaces
const wikipediaCache = new Map(); // key: lang_lat_lon_radius -> results

/**
 * Fetches Wikipedia geocoded articles around given coordinates.
 */
async function fetchWikipediaPlaces(lat, lon, radius, lang, limit) {
  const cacheKey = `${lang}_${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}_${limit}`;
  if (wikipediaCache.has(cacheKey)) {
    return wikipediaCache.get(cacheKey);
  }

  try {
    // MediaWiki generator geosearch with image thumbnail, description, extracts
    const url = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
      action: 'query',
      generator: 'geosearch',
      ggscoord: `${lat}|${lon}`,
      ggsradius: Math.min(radius, 10000).toString(),
      ggslimit: limit.toString(),
      prop: 'coordinates|pageimages|description|extracts',
      exintro: '1',
      explaintext: '1',
      exsentences: '2',
      piprop: 'thumbnail',
      pithumbsize: '240',
      format: 'json',
      origin: '*'
    });

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Wikipedia HTTP ${resp.status}`);
    const data = await resp.json();

    const pages = data.query?.pages || {};
    const results = [];

    for (const pid of Object.keys(pages)) {
      const p = pages[pid];
      if (!p.coordinates || p.coordinates.length === 0) continue;

      const pLat = p.coordinates[0].lat;
      const pLon = p.coordinates[0].lon;
      const dist = calculateDistance(lat, lon, pLat, pLon);
      const bearing = calculateBearing(lat, lon, pLat, pLon);
      const bearingInfo = getBearingInfo(bearing);

      results.push({
        id: `wiki_${p.pageid}`,
        source: 'wikipedia',
        title: p.title,
        lat: pLat,
        lon: pLon,
        distance: dist,
        bearing: bearing,
        cardinal: bearingInfo.label,
        arrow: bearingInfo.arrow,
        extract: p.extract || p.description || '',
        thumbnail: p.thumbnail ? p.thumbnail.source : null,
        url: `https://${lang}.wikipedia.org/?curid=${p.pageid}`,
        category: classifyPlace(p.title, p.extract || p.description, [], 'wikipedia'),
        polygon: null
      });
    }

    wikipediaCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn('Wikipedia fetch warning:', err);
    return [];
  }
}

/**
 * Fetches Wikimapia places around given coordinates.
 */
async function fetchWikimapiaPlaces(lat, lon, radius, key, limit) {
  const coordKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;

  try {
    let rawPlaces = [];

    if (wikimapiaCache.has(coordKey)) {
      rawPlaces = wikimapiaCache.get(coordKey);
    } else {
      const effectiveKey = key && key.trim() ? key.trim() : 'example';
      const url = `https://api.wikimapia.org/?` + new URLSearchParams({
        function: 'place.getnearest',
        lat: lat.toString(),
        lon: lon.toString(),
        count: Math.max(limit, 50).toString(),
        key: effectiveKey,
        format: 'json'
      });

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Wikimapia HTTP ${resp.status}`);
      const data = await resp.json();

      if (data.debug && data.debug.code && data.debug.code !== 1) {
        console.warn('Wikimapia API debug message:', data.debug.message);
      }

      rawPlaces = data.places || [];
      if (rawPlaces.length > 0) {
        wikimapiaCache.set(coordKey, rawPlaces);
      }
    }

    const results = [];

    for (const p of rawPlaces) {
      const pLat = p.location?.lat;
      const pLon = p.location?.lon;
      if (pLat === undefined || pLon === undefined) continue;

      const dist = calculateDistance(lat, lon, pLat, pLon);
      if (dist > radius) continue; // Filter out places beyond the selected radius

      const bearing = calculateBearing(lat, lon, pLat, pLon);
      const bearingInfo = getBearingInfo(bearing);

      results.push({
        id: `mapia_${p.id}`,
        source: 'wikimapia',
        title: p.title || 'Untitled Wikimapia Point',
        lat: pLat,
        lon: pLon,
        distance: dist,
        bearing: bearing,
        cardinal: bearingInfo.label,
        arrow: bearingInfo.arrow,
        extract: p.description || (p.tags ? p.tags.join(', ') : 'Wikimapia landmark point'),
        thumbnail: null,
        url: p.url || `https://wikimapia.org/${p.id}`,
        category: classifyPlace(p.title, p.description, p.tags, 'wikimapia'),
        polygon: p.polygon || null
      });
    }

    return results;
  } catch (err) {
    console.warn('Wikimapia fetch warning:', err);
    // If rate-limited or offline, return cached if available
    if (wikimapiaCache.has(coordKey)) {
      const rawPlaces = wikimapiaCache.get(coordKey);
      return rawPlaces.map(p => {
        const pLat = p.location?.lat || 0;
        const pLon = p.location?.lon || 0;
        const dist = calculateDistance(lat, lon, pLat, pLon);
        const bearing = calculateBearing(lat, lon, pLat, pLon);
        const bearingInfo = getBearingInfo(bearing);
        return {
          id: `mapia_${p.id}`,
          source: 'wikimapia',
          title: p.title || 'Untitled Wikimapia Point',
          lat: pLat,
          lon: pLon,
          distance: dist,
          bearing: bearing,
          cardinal: bearingInfo.label,
          arrow: bearingInfo.arrow,
          extract: p.description || '',
          thumbnail: null,
          url: p.url || `https://wikimapia.org/${p.id}`,
          category: classifyPlace(p.title, p.description, p.tags, 'wikimapia'),
          polygon: p.polygon || null
        };
      }).filter(p => p.distance <= radius);
    }
    return [];
  }
}

/**
 * Fetches Wikidata structured landmark entities around given coordinates.
 */
const wikidataCache = new Map();

async function fetchWikidataPlaces(lat, lon, radius, lang, limit) {
  const radiusKm = (radius / 1000).toFixed(3);
  const cacheKey = `data_${lang}_${lat.toFixed(3)}_${lon.toFixed(3)}_${radius}`;
  if (wikidataCache.has(cacheKey)) {
    return wikidataCache.get(cacheKey);
  }

  try {
    const sparql = `SELECT ?item ?itemLabel ?itemDescription ?typeLabel ?coord ?image WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  OPTIONAL { ?item wdt:P31 ?type . }
  OPTIONAL { ?item wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
} LIMIT ${Math.min(limit, 35)}`;

    const url = 'https://query.wikidata.org/sparql?' + new URLSearchParams({
      query: sparql,
      format: 'json'
    });

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/sparql-results+json' }
    });
    if (!resp.ok) throw new Error(`Wikidata HTTP ${resp.status}`);
    const data = await resp.json();

    const bindings = data.results?.bindings || [];
    const results = [];
    const seenIds = new Set();

    for (const b of bindings) {
      const itemUrl = b.item?.value || '';
      const qId = itemUrl.split('/').pop();
      if (!qId || seenIds.has(qId)) continue;
      seenIds.add(qId);

      const title = b.itemLabel?.value || qId;
      const typeLabel = b.typeLabel?.value || '';
      const desc = b.itemDescription?.value || typeLabel;
      const coordStr = b.coord?.value || '';
      const m = coordStr.match(/Point\(([-\d\.]+)\s+([-\d\.]+)\)/);
      if (!m) continue;

      const pLon = parseFloat(m[1]);
      const pLat = parseFloat(m[2]);
      const dist = calculateDistance(lat, lon, pLat, pLon);
      const bearing = calculateBearing(lat, lon, pLat, pLon);
      const bearingInfo = getBearingInfo(bearing);
      const category = classifyPlace(title, `${desc} ${typeLabel}`, [typeLabel], 'wikidata');

      results.push({
        id: `data_${qId}`,
        source: 'wikidata',
        title: title,
        lat: pLat,
        lon: pLon,
        distance: dist,
        bearing: bearing,
        cardinal: bearingInfo.label,
        arrow: bearingInfo.arrow,
        extract: desc ? `${desc}${typeLabel && desc !== typeLabel ? ' • ' + typeLabel : ''}` : 'Wikidata landmark',
        thumbnail: b.image ? b.image.value : null,
        url: itemUrl,
        category: category,
        polygon: null
      });
    }

    wikidataCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn('Wikidata fetch warning:', err);
    return [];
  }
}

/**
 * Triggers a combined fetch of all data sources for the current center and radius.
 */
async function refreshNearbyData(centerLat, centerLon) {
  if (state.isFetching) return;
  state.isFetching = true;

  const cardsContainer = document.getElementById('cards-container');
  const summaryText = document.getElementById('places-summary-text');

  cardsContainer.innerHTML = `
    <div class="empty-state">
      <div class="spinner"></div>
      <p>Scanning ${formatDistance(state.radius)} around position for Wikipedia, Wikimapia &amp; Wikidata places...</p>
    </div>
  `;
  summaryText.textContent = `Scanning within ${formatDistance(state.radius)}...`;

  try {
    const [wikiRes, mapiaRes, dataRes] = await Promise.allSettled([
      fetchWikipediaPlaces(centerLat, centerLon, state.radius, state.wikipediaLang, state.maxResults),
      fetchWikimapiaPlaces(centerLat, centerLon, state.radius, state.wikimapiaKey, state.maxResults),
      fetchWikidataPlaces(centerLat, centerLon, state.radius, state.wikipediaLang, state.maxResults)
    ]);

    const wikiPlaces = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
    const mapiaPlaces = mapiaRes.status === 'fulfilled' ? mapiaRes.value : [];
    const dataPlaces = dataRes.status === 'fulfilled' ? dataRes.value : [];

    // Combine and deduplicate
    const combined = [...wikiPlaces, ...mapiaPlaces, ...dataPlaces];

    state.places = combined;
    applyFiltersAndRender();
    updateRadiusCircle(centerLat, centerLon);
    zoomToRadiusBounds();
  } catch (err) {
    console.error('Data fetch error:', err);
    cardsContainer.innerHTML = `
      <div class="empty-state">
        <p style="color: var(--accent-rose)">Failed to fetch nearby places. Please verify connection and try again.</p>
        <button class="btn-primary" onclick="window.triggerRefresh()">Retry</button>
      </div>
    `;
  } finally {
    state.isFetching = false;
  }
}

// --------------------------------------------------------------------------
// 5. Filtering, Sorting & Card Rendering
// --------------------------------------------------------------------------

function applyFiltersAndRender() {
  const cardsContainer = document.getElementById('cards-container');
  const summaryText = document.getElementById('places-summary-text');
  const countAll = document.getElementById('count-all');
  const countWiki = document.getElementById('count-wiki');
  const countMapia = document.getElementById('count-mapia');
  const countData = document.getElementById('count-data');

  // Compute total counts
  const totalWiki = state.places.filter(p => p.source === 'wikipedia').length;
  const totalMapia = state.places.filter(p => p.source === 'wikimapia').length;
  const totalData = state.places.filter(p => p.source === 'wikidata').length;

  if (countAll) countAll.textContent = state.places.length;
  if (countWiki) countWiki.textContent = totalWiki;
  if (countMapia) countMapia.textContent = totalMapia;
  if (countData) countData.textContent = totalData;

  // Filter by source
  let filtered = state.places.filter(p => {
    if (state.sourceFilter === 'wikipedia') return p.source === 'wikipedia';
    if (state.sourceFilter === 'wikimapia') return p.source === 'wikimapia';
    if (state.sourceFilter === 'wikidata') return p.source === 'wikidata';
    return true;
  });

  // Filter by category / label
  if (state.categoryFilter && state.categoryFilter !== 'all') {
    filtered = filtered.filter(p => p.category?.key === state.categoryFilter);
  }

  // Filter by text search keyword
  if (state.textFilter && state.textFilter.trim()) {
    const q = state.textFilter.toLowerCase().trim();
    filtered = filtered.filter(p => {
      return p.title.toLowerCase().includes(q) || (p.extract && p.extract.toLowerCase().includes(q));
    });
  }

  // Sort
  if (state.sortOrder === 'distance-asc') {
    filtered.sort((a, b) => a.distance - b.distance);
  } else if (state.sortOrder === 'distance-desc') {
    filtered.sort((a, b) => b.distance - a.distance);
  } else if (state.sortOrder === 'name-asc') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  }

  // Update map markers with filtered places
  renderPlaceMarkersOnMap(filtered);

  // Render cards
  if (filtered.length === 0) {
    cardsContainer.innerHTML = `
      <div class="empty-state">
        <p>No interesting places found within ${formatDistance(state.radius)} matching your filters.</p>
        <p class="subtle-note">Try selecting another category, larger radius (e.g. 2 km or 5 km), or clearing your search.</p>
      </div>
    `;
    summaryText.textContent = `0 places found (${formatDistance(state.radius)} radius)`;
    return;
  }

  summaryText.textContent = `Found ${filtered.length} places within ${formatDistance(state.radius)}`;

  cardsContainer.innerHTML = filtered.map(place => {
    let badgeClass = 'badge-wikimapia';
    let badgeLabel = 'Wikimapia';
    if (place.source === 'wikipedia') {
      badgeClass = 'badge-wikipedia';
      badgeLabel = 'Wikipedia';
    } else if (place.source === 'wikidata') {
      badgeClass = 'badge-wikidata';
      badgeLabel = 'Wikidata';
    }

    const isActive = state.activePlaceId === place.id;

    return `
      <article class="place-card ${isActive ? 'active-target' : ''}" id="card-${place.id}" onclick="window.onCardClicked('${place.id}')">
        ${place.thumbnail 
          ? `<img src="${place.thumbnail}" alt="${escapeHtml(place.title)}" class="card-thumbnail" loading="lazy">` 
          : `<div class="card-thumbnail-placeholder">${place.source === 'wikipedia' ? '📖' : (place.source === 'wikidata' ? '🌐' : '📍')}</div>`
        }
        <div class="card-content">
          <div class="card-top-row">
            <div style="display: flex; gap: 5px; align-items: center; flex-wrap: wrap;">
              <span class="card-badge ${badgeClass}">${badgeLabel}</span>
              ${place.category ? `<span class="card-category-tag">${place.category.label}</span>` : ''}
            </div>
            <span class="card-distance" title="Bearing: ${place.bearing}° ${place.cardinal}">
              <span class="bearing-arrow">${place.arrow}</span> ${formatDistance(place.distance)}
            </span>
          </div>
          <h3 class="card-title" title="${escapeHtml(place.title)}">${escapeHtml(place.title)}</h3>
          ${place.extract ? `<p class="card-description">${escapeHtml(place.extract)}</p>` : ''}
          <div class="card-actions">
            <button class="btn-card-action" onclick="event.stopPropagation(); window.focusPlaceOnMap('${place.id}')">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              </svg>
              Show on Map
            </button>
            <a href="${place.url}" target="_blank" rel="noopener noreferrer" class="btn-card-action" onclick="event.stopPropagation()">
              Open ${badgeLabel} ↗
            </a>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function highlightPlaceCard(placeId) {
  state.activePlaceId = placeId;

  document.querySelectorAll('.place-card').forEach(card => {
    card.classList.toggle('active-target', card.id === `card-${placeId}`);
  });

  const targetCard = document.getElementById(`card-${placeId}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Global functions attached to window for HTML event handlers
window.onCardClicked = function(placeId) {
  highlightPlaceCard(placeId);
  focusPlaceOnMap(placeId, true);
};

window.focusPlaceOnMap = function(placeId) {
  highlightPlaceCard(placeId);
  focusPlaceOnMap(placeId, true);
};

window.triggerRefresh = function() {
  if (state.searchCenter) {
    refreshNearbyData(state.searchCenter.lat, state.searchCenter.lon);
  }
};

window.showPlaceDetails = function(placeId) {
  const place = state.places.find(p => p.id === placeId);
  if (!place) return;

  const modal = document.getElementById('place-modal');
  const body = document.getElementById('modal-body');
  const isWiki = place.source === 'wikipedia';

  body.innerHTML = `
    <div class="detail-modal-content">
      ${place.thumbnail ? `<img src="${place.thumbnail}" alt="${escapeHtml(place.title)}" class="detail-modal-img">` : ''}
      <div class="card-top-row">
        <span class="card-badge ${isWiki ? 'badge-wikipedia' : 'badge-wikimapia'}">
          ${isWiki ? 'Wikipedia' : 'Wikimapia'}
        </span>
        <span class="card-distance font-tech">
          ${place.arrow} ${formatDistance(place.distance)} (${place.cardinal} / ${place.bearing}°)
        </span>
      </div>
      <h2 class="detail-modal-title">${escapeHtml(place.title)}</h2>
      <p class="subtle-note">Coordinates: ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}</p>
      ${place.extract ? `<p class="detail-modal-extract">${escapeHtml(place.extract)}</p>` : ''}
      <div class="detail-modal-actions">
        <a href="${place.url}" target="_blank" rel="noopener noreferrer" class="btn-primary w-full" style="text-align: center; text-decoration: none;">
          Open Original Page ↗
        </a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}" target="_blank" rel="noopener noreferrer" class="btn-card-action" style="padding: 10px; font-size: 0.8rem; font-weight: 600;">
          Navigate 🚗
        </a>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
};

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --------------------------------------------------------------------------
// 6. Geolocation & Presets Setup
// --------------------------------------------------------------------------

function setupGeolocation() {
  const pill = document.getElementById('gps-status-pill');
  const label = document.getElementById('gps-status-label');

  // Immediately initialize with test/default coordinates so user sees data right away
  const defaultLat = LOCATION_PRESETS.podgorze.lat;
  const defaultLon = LOCATION_PRESETS.podgorze.lon;
  
  if (!map) {
    initMap(defaultLat, defaultLon);
    updateUserLocationMarker(defaultLat, defaultLon, 5);
    refreshNearbyData(defaultLat, defaultLon);
  }

  if (!('geolocation' in navigator)) {
    label.textContent = 'NO GPS SUPPORT';
    pill.className = 'status-pill status-simulated';
    return;
  }

  pill.className = 'status-pill status-locking';
  label.textContent = 'ACQUIRING GPS...';

  state.gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const acc = position.coords.accuracy;

      pill.className = 'status-pill status-active';
      label.textContent = `GPS (±${Math.round(acc)}m)`;

      const hadRealPos = state.userPos && !state.userPos.isSimulated;
      state.userPos = { lat, lon, accuracy: acc, isSimulated: false };
      state.searchCenter = { lat, lon };
      
      updateUserLocationMarker(lat, lon, acc);

      if (!hadRealPos) {
        map.setView([lat, lon], 15);
        refreshNearbyData(lat, lon);
      }
    },
    (err) => {
      console.warn('Geolocation error or rejected:', err.message);
      pill.className = 'status-pill status-simulated';
      label.textContent = 'LOCATION: PODGÓRZE';
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}

function applyLocation(lat, lon, accuracy = null, isSimulated = false) {
  state.userPos = { lat, lon, accuracy, isSimulated };
  state.searchCenter = { lat, lon };

  const pill = document.getElementById('gps-status-pill');
  const label = document.getElementById('gps-status-label');

  if (isSimulated) {
    pill.className = 'status-pill status-simulated';
    label.textContent = 'SIMULATED COORDS';
  }

  if (!map) {
    initMap(lat, lon);
  } else {
    map.setView([lat, lon], 15);
  }

  updateUserLocationMarker(lat, lon, accuracy);
  refreshNearbyData(lat, lon);
}

// --------------------------------------------------------------------------
// 7. Settings Persistence & UI Wiring
// --------------------------------------------------------------------------

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.radius) state.radius = parsed.radius;
      if (parsed.wikipediaLang) state.wikipediaLang = parsed.wikipediaLang;
      if (parsed.wikimapiaKey) state.wikimapiaKey = parsed.wikimapiaKey;
      if (parsed.mapLayer && parsed.mapLayer === 'topo') {
        state.mapLayer = 'topo';
      } else {
        state.mapLayer = 'osm'; // Always force pure OpenStreetMap Standard
      }
      if (parsed.maxResults) state.maxResults = parsed.maxResults;
    } else {
      state.mapLayer = 'osm';
      // Auto-detect language from browser
      const navLang = (navigator.language || 'en').split('-')[0].toLowerCase();
      if (['en', 'pl', 'de', 'fr', 'es', 'it', 'uk'].includes(navLang)) {
        state.wikipediaLang = navLang;
      }
    }
  } catch (e) {
    console.warn('Failed loading settings:', e);
    state.mapLayer = 'osm';
  }

  // Sync controls UI
  document.querySelectorAll('.btn-radius').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.radius, 10) === state.radius);
  });

  const wikiLangSelect = document.getElementById('wiki-lang-select');
  if (wikiLangSelect) wikiLangSelect.value = state.wikipediaLang;
  const quickLangLabel = document.getElementById('quick-lang-label');
  if (quickLangLabel) quickLangLabel.textContent = state.wikipediaLang.toUpperCase();

  const maxResultsSelect = document.getElementById('max-results-select');
  if (maxResultsSelect) maxResultsSelect.value = state.maxResults.toString();
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify({
      radius: state.radius,
      wikipediaLang: state.wikipediaLang,
      wikimapiaKey: state.wikimapiaKey,
      mapLayer: state.mapLayer,
      maxResults: state.maxResults
    }));
  } catch (e) {
    console.warn('Failed saving settings:', e);
  }
}

function setupEventListeners() {
  // Radius Buttons
  document.querySelectorAll('.btn-radius').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-radius').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.radius = parseInt(btn.dataset.radius, 10);
      saveSettings();

      if (state.searchCenter) {
        refreshNearbyData(state.searchCenter.lat, state.searchCenter.lon);
      }
    });
  });

  // Source Filter Buttons (All / Wikipedia / Wikimapia / Wikidata)
  document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sourceFilter = btn.dataset.source;
      applyFiltersAndRender();
    });
  });

  // Category / Label Filter Buttons (All / Culture / Historic / Architecture / etc.)
  document.querySelectorAll('.btn-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-cat').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.categoryFilter = btn.dataset.category;
      applyFiltersAndRender();
    });
  });

  const quickLangBtn = document.getElementById('quick-lang-btn');
  const quickLangLabel = document.getElementById('quick-lang-label');
  if (quickLangLabel) quickLangLabel.textContent = state.wikipediaLang.toUpperCase();

  if (quickLangBtn) {
    quickLangBtn.addEventListener('click', () => {
      state.wikipediaLang = state.wikipediaLang === 'pl' ? 'en' : 'pl';
      if (quickLangLabel) quickLangLabel.textContent = state.wikipediaLang.toUpperCase();
      const wikiLangSelect = document.getElementById('wiki-lang-select');
      if (wikiLangSelect) wikiLangSelect.value = state.wikipediaLang;
      saveSettings();
      if (state.searchCenter) {
        refreshNearbyData(state.searchCenter.lat, state.searchCenter.lon);
      }
    });
  }

  // Text search input
  const textInput = document.getElementById('text-filter');
  const clearBtn = document.getElementById('clear-filter-btn');

  textInput.addEventListener('input', (e) => {
    state.textFilter = e.target.value;
    clearBtn.classList.toggle('hidden', !state.textFilter);
    applyFiltersAndRender();
  });

  clearBtn.addEventListener('click', () => {
    textInput.value = '';
    state.textFilter = '';
    clearBtn.classList.add('hidden');
    applyFiltersAndRender();
  });

  // Sorting
  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.sortOrder = e.target.value;
    applyFiltersAndRender();
  });

  // Recenter button
  document.getElementById('recenter-btn').addEventListener('click', () => {
    if (state.userPos) {
      state.searchCenter = { lat: state.userPos.lat, lon: state.userPos.lon };
      map.setView([state.userPos.lat, state.userPos.lon], 16);
      document.getElementById('search-here-btn').classList.add('hidden');
      refreshNearbyData(state.userPos.lat, state.userPos.lon);
    }
  });

  // "Search This Area" floating button
  document.getElementById('search-here-btn').addEventListener('click', () => {
    const center = map.getCenter();
    state.searchCenter = { lat: center.lat, lon: center.lng };
    document.getElementById('search-here-btn').classList.add('hidden');
    refreshNearbyData(center.lat, center.lng);
  });

  // Map layer toggle menu
  const layerToggleBtn = document.getElementById('layer-toggle-btn');
  const layerMenu = document.getElementById('layer-menu');
  layerToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    layerMenu.classList.toggle('hidden');
  });

  document.querySelectorAll('.layer-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      setMapLayer(btn.dataset.layer);
      layerMenu.classList.add('hidden');
    });
  });

  document.addEventListener('click', () => {
    layerMenu.classList.add('hidden');
  });

  // Mobile View Navigation (Split / Map / List)
  const mainWorkspace = document.getElementById('main-workspace');
  document.querySelectorAll('.view-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const view = btn.dataset.view;
      mainWorkspace.className = `main-workspace layout-${view}`;

      // Trigger map resize after layout change
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 100);
    });
  });

  // Presets Modal
  const presetsBtn = document.getElementById('presets-btn');
  const presetsModal = document.getElementById('presets-modal');
  const presetsCloseBtn = document.getElementById('presets-close-btn');

  presetsBtn.addEventListener('click', () => presetsModal.classList.remove('hidden'));
  presetsCloseBtn.addEventListener('click', () => presetsModal.classList.add('hidden'));

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lon = parseFloat(btn.dataset.lon);
      applyLocation(lat, lon, 10, true);
      presetsModal.classList.add('hidden');
    });
  });

  // Custom coordinates form
  document.getElementById('custom-coords-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = parseFloat(document.getElementById('custom-lat').value);
    const lon = parseFloat(document.getElementById('custom-lon').value);
    if (!isNaN(lat) && !isNaN(lon)) {
      applyLocation(lat, lon, 10, true);
      presetsModal.classList.add('hidden');
    }
  });

  // Settings Modal
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close-btn');

  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  settingsCloseBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

  document.getElementById('save-settings-btn').addEventListener('click', () => {
    const langSelect = document.getElementById('wiki-lang-select');
    const keyInput = document.getElementById('wikimapia-key-input');
    const maxSelect = document.getElementById('max-results-select');

    state.wikipediaLang = langSelect.value;
    state.wikimapiaKey = keyInput.value.trim() || 'example';
    state.maxResults = parseInt(maxSelect.value, 10) || 50;

    saveSettings();
    settingsModal.classList.add('hidden');

    if (state.searchCenter) {
      refreshNearbyData(state.searchCenter.lat, state.searchCenter.lon);
    }
  });

  // Place detail modal close
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('place-modal').classList.add('hidden');
  });

  // Close modals on backdrop click
  [presetsModal, settingsModal, document.getElementById('place-modal')].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // GPS Status Pill Click -> refresh
  document.getElementById('gps-status-pill').addEventListener('click', () => {
    if (state.userPos && !state.userPos.isSimulated) {
      applyLocation(state.userPos.lat, state.userPos.lon, state.userPos.accuracy, false);
    } else {
      setupGeolocation();
    }
  });
}

// --------------------------------------------------------------------------
// 8. Service Worker Registration
// --------------------------------------------------------------------------
function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('ServiceWorker registered:', reg.scope))
        .catch(err => console.log('ServiceWorker registration error:', err));
    });
  }
}

// --------------------------------------------------------------------------
// 9. App Bootstrapping
// --------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
  registerServiceWorker();
  setupGeolocation();
});
