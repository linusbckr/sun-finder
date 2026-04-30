// Endpoint waterfall — tried in order; on 429/504/network error the next one is used.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// Typed error lets callers show a targeted "server busy" UI
export class OverpassBusyError extends Error {
  constructor(tried = []) {
    super(`All Overpass endpoints busy or unreachable (tried: ${tried.join(', ')})`)
    this.name = 'OverpassBusyError'
  }
}

// AbortSignal with a per-endpoint wall-clock timeout
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), ms)
  return ctrl.signal
}

async function queryEndpoint(url, q) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(q)}`,
    signal:  timeoutSignal(14_000),   // 14 s wall-clock (QL says timeout:10)
  })

  if (res.status === 429 || res.status === 504) {
    throw new OverpassBusyError([url])
  }
  if (!res.ok) throw new Error(`Overpass ${res.status} at ${url}`)

  return res.json()
}

/**
 * Run an Overpass QL query, trying each endpoint in turn.
 * Only throws OverpassBusyError when ALL endpoints are exhausted.
 */
async function query(q) {
  const tried = []
  let lastErr

  for (const url of OVERPASS_ENDPOINTS) {
    tried.push(url)
    try {
      return await queryEndpoint(url, q)
    } catch (err) {
      lastErr = err
      const isBusy    = err instanceof OverpassBusyError
      const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError'
      const isNetwork = err instanceof TypeError   // fetch network failure

      if (isBusy || isTimeout || isNetwork) {
        console.warn(`[Overpass] ${url} unavailable (${err.message}) — trying next endpoint`)
        continue
      }
      // Any other error (bad query, 400, etc.) is not retriable
      throw err
    }
  }

  throw new OverpassBusyError(tried)
}

// ---------------------------------------------------------------------------
// Venues  –  cafés, bars, restaurants with outdoor seating
// ---------------------------------------------------------------------------

/** @typedef {{ id:number, lat:number, lng:number, name:string, amenity:string, cuisine?:string, openingHours?:string, inSun:boolean }} Venue */

/**
 * Fetch outdoor-seating venues within 800 m of `center`.
 * @param {{ lat:number, lng:number }} center
 * @returns {Promise<Venue[]>}
 */
export async function fetchVenues({ lat, lng }) {
  const q = `
[out:json][timeout:10];
(
  node["amenity"~"^(cafe|bar|restaurant)$"]["outdoor_seating"="yes"](around:800,${lat},${lng});
  way["amenity"~"^(cafe|bar|restaurant)$"]["outdoor_seating"="yes"](around:800,${lat},${lng});
);
out body center;
`
  const data = await query(q)

  return data.elements
    .filter((el) => el.lat != null || el.center != null)
    .map((el) => ({
      id:           el.id,
      lat:          el.lat  ?? el.center.lat,
      lng:          el.lon  ?? el.center.lon,
      name:         el.tags?.name         ?? 'Unnamed',
      amenity:      el.tags?.amenity      ?? 'place',
      cuisine:      el.tags?.cuisine,
      openingHours: el.tags?.opening_hours,
      website:      el.tags?.website,
      inSun:        false,
    }))
}

// ---------------------------------------------------------------------------
// Buildings  –  footprints + heights for the shadow engine
// ---------------------------------------------------------------------------

/**
 * Fetch building footprints within 800 m of `center`.
 * @param {{ lat:number, lng:number }} center
 * @returns {Promise<import('geojson').Feature[]>}
 */
export async function fetchBuildings({ lat, lng }) {
  const q = `
[out:json][timeout:10];
(
  way["building"](around:800,${lat},${lng});
);
out body geom;
`
  const data = await query(q)

  return data.elements
    .filter((el) => el.geometry?.length >= 3)
    .map((el) => ({
      type: 'Feature',
      geometry: {
        type:        'Polygon',
        coordinates: [el.geometry.map((pt) => [pt.lon, pt.lat])],
      },
      properties: {
        height: el.tags?.height
          ? parseFloat(el.tags.height)
          : el.tags?.['building:levels']
          ? parseFloat(el.tags['building:levels']) * 3
          : 9,
        'building:levels': el.tags?.['building:levels'],
        building:          el.tags?.building,
      },
    }))
}

// ---------------------------------------------------------------------------
// Reverse geocoding  –  friendly city name via Nominatim
// ---------------------------------------------------------------------------

export async function reverseGeocode(lat, lng) {
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en-US,en' }, signal: timeoutSignal(8_000) }
    )
    const data = await res.json()
    const a    = data.address ?? {}
    return a.city ?? a.town ?? a.village ?? a.county ?? a.country ?? 'your area'
  } catch {
    return 'your area'
  }
}
