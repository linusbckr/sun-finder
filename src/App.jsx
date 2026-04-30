import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { debounce } from 'lodash'
import MapView from './components/MapView'
import TimeSlider from './components/TimeSlider'
import { getSunPosition } from './utils/sun'
import { computeVenueSunStatus } from './utils/shadow'
import { fetchVenues, fetchBuildings, reverseGeocode, OverpassBusyError } from './utils/overpass'

const DEFAULT_LOCATION = { lat: 52.49, lng: 13.35 }  // Berlin Schöneberg

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Equirectangular distance in metres between two lat/lng points.
 * Accurate enough for the ≤ 50 m cache threshold at city latitudes.
 */
function distanceMeters(a, b) {
  const R    = 6_371_000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180 *
    Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return R * Math.sqrt(dLat * dLat + dLng * dLng)
}

// ── Icons ────────────────────────────────────────────────────────────────────

function SunIcon({ size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={style}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function SpinnerIcon({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round"
      style={{ animation: 'spin 0.9s linear infinite', flexShrink: 0 }}>
      <path d="M12 2a10 10 0 1 0 10 10" />
    </svg>
  )
}

// ── VenueList ─────────────────────────────────────────────────────────────────

function VenueList({ venues, isLoading, city, overpassError, onRetry }) {
  const sunny  = venues.filter((v) =>  v.inSun)
  const shaded = venues.filter((v) => !v.inSun)

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="text-xs font-semibold uppercase tracking-widest opacity-40 mb-1">
        {isLoading
          ? <span className="flex items-center gap-1.5"><SpinnerIcon size={11} /> Searching…</span>
          : `${venues.length} spots in ${city}`}
      </div>

      {overpassError && !isLoading && (
        <div className="text-sm mt-3 text-center">
          <p style={{ color: '#fb923c' }}>
            {overpassError === 'busy' ? '⏳ Server busy' : '⚠️ Fetch failed'}
          </p>
          <button onClick={onRetry}
            className="mt-2 text-xs px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(251,146,60,0.2)', color: '#fb923c' }}>
            Try again
          </button>
        </div>
      )}

      {venues.length === 0 && !isLoading && !overpassError && (
        <div className="text-sm opacity-50 mt-4 text-center">
          No outdoor seating found.<br />
          <span className="text-xs opacity-70">Try panning or zooming the map.</span>
        </div>
      )}

      {sunny.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: '#fde047' }}>
            ☀️ In the sun ({sunny.length})
          </div>
          {sunny.map((v) => <VenueRow key={v.id} venue={v} />)}
        </div>
      )}

      {shaded.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-medium mb-1 opacity-50">
            🌥 In the shade ({shaded.length})
          </div>
          {shaded.map((v) => <VenueRow key={v.id} venue={v} />)}
        </div>
      )}
    </div>
  )
}

function VenueRow({ venue }) {
  return (
    <div className="px-3 py-2 rounded-xl text-sm cursor-default"
      style={{
        background:   venue.inSun ? 'rgba(250,204,21,0.1)' : 'rgba(148,163,184,0.07)',
        borderLeft:   `3px solid ${venue.inSun ? '#fde047' : '#475569'}`,
        marginBottom: 4,
      }}>
      <div className="font-medium truncate">{venue.name}</div>
      <div className="text-xs opacity-50 capitalize">{venue.amenity}</div>
    </div>
  )
}

// ── SunCompass ────────────────────────────────────────────────────────────────

function SunCompass({ azimuth, altitude }) {
  const bearing = ((azimuth * 180 / Math.PI) + 180 + 360) % 360
  const altDeg  = (altitude * 180 / Math.PI).toFixed(0)
  const isDay   = altitude > 0
  const needle  = isDay ? '#fde047' : '#475569'

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.08)' }}
        title={`Sun bearing ${bearing.toFixed(0)}° · altitude ${altDeg}°`}>
        <div style={{
          width: 3, height: 14, borderRadius: 2, background: needle,
          transformOrigin: 'bottom center',
          transform: `rotate(${bearing}deg) translateX(-50%)`,
          position: 'absolute', bottom: '50%', left: '50%',
        }} />
        <div className="absolute rounded-full"
          style={{ width: 5, height: 5, background: needle }} />
      </div>
      <span style={{ fontSize: 10, opacity: 0.4 }}>{altDeg}°</span>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [userLocation,  setUserLocation]  = useState(null)
  const [locationState, setLocationState] = useState('pending')  // pending | granted | denied | unavailable
  const [city,          setCity]          = useState('Berlin Schöneberg')

  const [mapBounds,     setMapBounds]     = useState(null)
  const [selectedTime,  setSelectedTime]  = useState(new Date())
  const [buildings,     setBuildings]     = useState([])
  const [venues,        setVenues]        = useState([])
  const [isLoading,     setIsLoading]     = useState(false)
  const [fetchPending,  setFetchPending]  = useState(false)   // debounce queued but not fired yet
  const [overpassError, setOverpassError] = useState(null)    // null | 'busy' | 'error'
  const [showPanel,     setShowPanel]     = useState(false)

  const isFetchingRef  = useRef(false)
  const lastBoundsRef  = useRef(null)
  const lastCenterRef  = useRef(null)   // for the 50 m cache check

  // ── Geolocation ────────────────────────────────────────────────────────────
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationState('unavailable')
      return
    }
    setLocationState('pending')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserLocation(loc)
        setLocationState('granted')
        const name = await reverseGeocode(loc.lat, loc.lng)
        setCity(name)
      },
      () => setLocationState('denied'),
      { timeout: 10_000, maximumAge: 60_000 }
    )
  }, [])

  useEffect(() => { requestLocation() }, [requestLocation])

  // ── Sun position ───────────────────────────────────────────────────────────
  const sunPosition = useMemo(() => {
    const loc = userLocation ?? DEFAULT_LOCATION
    return getSunPosition(loc.lat, loc.lng, selectedTime)
  }, [userLocation, selectedTime])

  // ── Overpass fetch with 50 m cache ─────────────────────────────────────────
  const doFetch = useCallback(async (bounds) => {
    setFetchPending(false)   // debounce has fired — clear the "queued" indicator

    if (isFetchingRef.current) return
    isFetchingRef.current = true
    lastBoundsRef.current = bounds

    const center = {
      lat: (bounds.south + bounds.north) / 2,
      lng: (bounds.west  + bounds.east)  / 2,
    }

    // ── Cache check: skip if centre hasn't moved > 50 m ─────────────────────
    if (lastCenterRef.current && distanceMeters(lastCenterRef.current, center) < 50) {
      isFetchingRef.current = false
      return
    }
    lastCenterRef.current = center

    setIsLoading(true)
    setOverpassError(null)

    try {
      const [newBuildings, newVenues] = await Promise.all([
        fetchBuildings(center),
        fetchVenues(center),
      ])
      setBuildings(newBuildings)
      setVenues(newVenues)
    } catch (err) {
      console.error('[App] Overpass fetch failed:', err)
      setOverpassError(err instanceof OverpassBusyError ? 'busy' : 'error')
    } finally {
      setIsLoading(false)
      isFetchingRef.current = false
    }
  }, [])

  // 1500 ms debounce — only fires after the user has stopped panning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchData = useCallback(debounce(doFetch, 1500), [doFetch])

  const handleRetry = useCallback(() => {
    lastCenterRef.current = null   // invalidate cache so retry always goes through
    if (lastBoundsRef.current) doFetch(lastBoundsRef.current)
  }, [doFetch])

  useEffect(() => {
    if (!mapBounds) return
    setFetchPending(true)    // map moved — debounce queued
    fetchData(mapBounds)
  }, [mapBounds, fetchData])

  // ── Shadow annotation ──────────────────────────────────────────────────────
  const venuesWithSun = useMemo(
    () => computeVenueSunStatus(venues, buildings, sunPosition),
    [venues, buildings, sunPosition]
  )
  const sunCount   = venuesWithSun.filter((v) =>  v.inSun).length
  const shadeCount = venuesWithSun.filter((v) => !v.inSun).length

  const showFetchIndicator = fetchPending || isLoading

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // position:fixed + inset:0 gives the root a rock-solid full-screen footprint
    // regardless of any ancestor transform or scroll context.
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Spin keyframe — injected once, no external CSS file needed */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Map (fills entire viewport) ── */}
      <MapView
        center={userLocation}
        sunPosition={sunPosition}
        buildings={buildings}
        venues={venuesWithSun}
        onBoundsChange={setMapBounds}
      />

      {/* ── Header card ── */}
      <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 20 }}>
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ minWidth: 200 }}>
          <div className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
            style={{ background: 'rgba(250,204,21,0.15)' }}>
            <SunIcon size={20} style={{ color: '#fde047' }} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight">Sun Finder</div>
            <div className="text-xs opacity-50 leading-tight mt-0.5">
              {isLoading ? (
                <span className="flex items-center gap-1">
                  <SpinnerIcon size={10} /> Searching {city}…
                </span>
              ) : overpassError ? (
                <span style={{ color: '#fb923c' }}>
                  {overpassError === 'busy' ? 'Server busy' : 'Fetch failed'}
                </span>
              ) : venues.length === 0 ? (
                'Move map to search'
              ) : (
                <>
                  <span style={{ color: '#fde047' }}>☀ {sunCount}</span>
                  {' · '}
                  <span style={{ color: '#94a3b8' }}>🌥 {shadeCount}</span>
                  {' in '}{city}
                </>
              )}
            </div>
          </div>
          <div className="ml-auto flex-shrink-0">
            <SunCompass azimuth={sunPosition.azimuth} altitude={sunPosition.altitude} />
          </div>
        </div>
      </div>

      {/* ── Location banner + Enable Location button ── */}
      {(locationState === 'denied' || locationState === 'unavailable') && (
        <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20, whiteSpace: 'nowrap' }}>
          <div className="glass rounded-full flex items-center gap-2 px-3 py-2 text-xs"
            style={{ border: '1px solid rgba(251,146,60,0.3)' }}>
            <span style={{ color: '#fb923c' }}>📍 Showing Berlin Schöneberg</span>
            {locationState === 'denied' && (
              <button onClick={requestLocation}
                className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: 'rgba(251,146,60,0.25)', color: '#fb923c' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(251,146,60,0.4)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(251,146,60,0.25)')}>
                Enable Location
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Small "Fetching data…" corner indicator ──────────────────────────
           Appears as soon as the map moves (debounce queued) and stays until
           the Overpass request completes. Positioned bottom-right so it doesn't
           obscure the time slider or sidebar. Non-blocking (pointer-events:none). ── */}
      {showFetchIndicator && (
        <div style={{ position: 'absolute', bottom: 112, right: 16, zIndex: 20, pointerEvents: 'none' }}>
          <div className="glass rounded-full flex items-center gap-1.5 px-3 py-1.5">
            <SpinnerIcon size={11} color="#fde047" />
            <span className="text-xs" style={{ opacity: 0.75 }}>
              {isLoading ? 'Fetching data…' : 'Updating…'}
            </span>
          </div>
        </div>
      )}

      {/* ── Overpass error banner (appears above the time slider) ── */}
      {overpassError && !isLoading && (
        <div style={{ position: 'absolute', bottom: 144, left: '50%', transform: 'translateX(-50%)', zIndex: 20, whiteSpace: 'nowrap' }}>
          <div className="glass rounded-2xl flex items-center gap-3 px-4 py-3 text-sm"
            style={{ border: '1px solid rgba(251,146,60,0.35)' }}>
            <span style={{ color: '#fb923c' }}>
              {overpassError === 'busy' ? '⏳ Overpass server busy' : '⚠️ Could not load venues'}
            </span>
            <button onClick={handleRetry}
              className="px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: 'rgba(251,146,60,0.2)', color: '#fb923c' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(251,146,60,0.35)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(251,146,60,0.2)')}>
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar ── */}
      <div className="hidden md:flex absolute top-4 right-16 z-20 flex-col"
        style={{ width: 240, maxHeight: 'calc(100vh - 180px)' }}>
        <div className="glass rounded-2xl p-4 overflow-y-auto flex-1">
          <VenueList venues={venuesWithSun} isLoading={isLoading} city={city}
            overpassError={overpassError} onRetry={handleRetry} />
        </div>
      </div>

      {/* ── Mobile toggle button ── */}
      <div className="md:hidden absolute top-4 right-4 z-20">
        <button onClick={() => setShowPanel((v) => !v)}
          className="glass rounded-full w-11 h-11 flex items-center justify-center text-base"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
          aria-label="Toggle venue list">
          {showPanel ? '✕' : '🏠'}
        </button>
      </div>

      {/* ── Mobile bottom sheet ── */}
      {showPanel && (
        <div className="md:hidden absolute bottom-28 left-0 right-0 z-20 px-4"
          style={{ maxHeight: '45vh', overflow: 'hidden' }}>
          <div className="glass rounded-2xl p-4 overflow-y-auto" style={{ maxHeight: '45vh' }}>
            <VenueList venues={venuesWithSun} isLoading={isLoading} city={city}
              overpassError={overpassError} onRetry={handleRetry} />
          </div>
        </div>
      )}

      {/* ── Time slider ── */}
      <div style={{
        position: 'absolute', bottom: 24, left: 0, right: 0,
        zIndex: 20, display: 'flex', justifyContent: 'center', padding: '0 16px',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div className="w-full max-w-xl">
          <TimeSlider time={selectedTime} onChange={setSelectedTime} sunPosition={sunPosition} />
        </div>
      </div>
    </div>
  )
}
