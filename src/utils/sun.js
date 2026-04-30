import SunCalc from 'suncalc'

/**
 * Get sun position from SunCalc.
 * @returns {{ azimuth: number, altitude: number }}
 *   azimuth  – radians from south, positive westward (SunCalc convention)
 *   altitude – radians above horizon (0 = horizon, π/2 = zenith)
 */
export function getSunPosition(lat, lng, date) {
  const pos = SunCalc.getPosition(date, lat, lng)
  return {
    azimuth: pos.azimuth,
    altitude: pos.altitude,
  }
}

/**
 * Return sun colour based on altitude (degrees above horizon).
 */
function sunColor(altDeg) {
  if (altDeg < 0) return '#01052e'
  if (altDeg < 3) return '#b34700'
  if (altDeg < 10) return '#ff7c2a'
  if (altDeg < 20) return '#ffc040'
  if (altDeg < 35) return '#ffe08a'
  return '#ffffff'
}

/**
 * Convert a SunCalc sun position to a MapLibre LightSpecification.
 *
 * MapLibre position: [radial, azimuthal, polar]
 *   azimuthal – degrees from East, counter-clockwise
 *   polar     – degrees from zenith (0 = directly above, 90 = horizon)
 */
export function sunToMapLight(sunPosition) {
  const { azimuth, altitude } = sunPosition

  // compass bearing N=0, clockwise
  const compassBearing = ((azimuth * 180 / Math.PI) + 180 + 360) % 360
  // MapLibre azimuthal: East=0, counter-clockwise
  const mapAzimuthal = (90 - compassBearing + 360) % 360

  const altDeg = altitude * 180 / Math.PI
  const polar = Math.max(1, 90 - altDeg)

  const intensity = altDeg < 0 ? 0.05 : Math.min(0.9, 0.25 + altDeg / 90 * 0.65)

  return {
    anchor: 'map',
    color: sunColor(altDeg),
    intensity,
    position: [1.15, mapAzimuthal, polar],
  }
}

/**
 * Return a short human-readable description of the sun state.
 */
export function sunLabel(altitude) {
  const deg = altitude * 180 / Math.PI
  if (deg < -6) return 'Night'
  if (deg < 0) return 'Civil twilight'
  if (deg < 10) return 'Low sun'
  if (deg < 30) return 'Morning / afternoon'
  return 'High sun'
}

/**
 * Format a Date as HH:MM (24-hour).
 */
export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Build a Date from a base date and a minutes-since-midnight value.
 */
export function minutesToDate(minutes, baseDate = new Date()) {
  const d = new Date(baseDate)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}
