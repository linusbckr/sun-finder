/**
 * Ray-cast point-in-polygon (2D).
 * @param {[number,number]} point – [lng, lat]
 * @param {Array<[number,number]>} ring – exterior ring (closed or open)
 */
function pointInPolygon([px, py], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function firstRing(geometry) {
  if (!geometry) return null
  if (geometry.type === 'Polygon') return geometry.coordinates[0]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0]?.[0]
  return null
}

/**
 * Determine whether a venue receives direct sunlight.
 *
 * Algorithm: cast a ray from the venue toward the sun and check whether any
 * building along that ray is tall enough to block the light.
 *
 * @param {number} venueLat
 * @param {number} venueLng
 * @param {import('../utils/overpass').Building[]} buildings
 * @param {number} sunAzimuth  – SunCalc azimuth (radians, S=0, westward +)
 * @param {number} sunAltitude – SunCalc altitude (radians above horizon)
 * @returns {boolean}
 */
export function isVenueInSun(venueLat, venueLng, buildings, sunAzimuth, sunAltitude) {
  if (sunAltitude <= 0.01) return false   // below or at horizon

  // Unit vector toward sun in East/North coordinate space.
  // SunCalc azimuth: S=0 → (E,N) = (0,-1), W=π/2 → (-1,0), N=π → (0,1), E=-π/2 → (1,0)
  const dirE = -Math.sin(sunAzimuth)
  const dirN = -Math.cos(sunAzimuth)

  const cosLat = Math.cos(venueLat * Math.PI / 180)
  const tanAlt = Math.tan(sunAltitude)

  const MAX_DIST = 200  // metres — shadows longer than this are irrelevant at street level
  const STEPS = 40

  for (let s = 1; s <= STEPS; s++) {
    const d = (s / STEPS) * MAX_DIST

    // Geographic position d metres toward the sun
    const checkLat = venueLat + (d * dirN) / 111_320
    const checkLng = venueLng + (d * dirE) / (111_320 * cosLat)

    for (const building of buildings) {
      const ring = firstRing(building.geometry)
      if (!ring || ring.length < 3) continue

      if (pointInPolygon([checkLng, checkLat], ring)) {
        // Building height (fall back to 3 storeys × 3 m = 9 m)
        const levels = building.properties?.['building:levels']
        const h = Number(
          building.properties?.height ??
          building.properties?.['building:height'] ??
          (levels ? levels * 3 : 9)
        )
        // Shadow of a building of height h reaches d_shadow = h / tan(altitude).
        // If d ≤ d_shadow the venue is in that building's shadow.
        if (h >= d * tanAlt) return false
      }
    }
  }

  return true
}

/**
 * Annotate each venue with an `inSun` boolean.
 */
export function computeVenueSunStatus(venues, buildings, sunPosition) {
  const { azimuth, altitude } = sunPosition
  return venues.map((v) => ({
    ...v,
    inSun: isVenueInSun(v.lat, v.lng, buildings, azimuth, altitude),
  }))
}
