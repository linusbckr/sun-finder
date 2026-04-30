import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { sunToMapLight } from '../utils/sun'

// ── Reliable primary style: OSM raster tiles, no API key required ───────────
// Using this directly avoids any dependency on external JSON style files that
// can fail, timeout, or require auth tokens.
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 22 }],
}

// Building extrusion colours that read clearly on OSM's light beige background
const BUILDING_COLOR = 'rgba(100, 116, 139, 0.82)'  // slate-500 / 82 %

function popupHtml(venue) {
  const color = venue.inSun ? '#fde047' : '#94a3b8'
  const label = venue.inSun ? '☀️ In the sun' : '🌥 In the shade'
  return `
    <div style="padding:14px 16px 12px;min-width:170px;">
      <div style="font-size:14px;font-weight:600;margin-bottom:3px;line-height:1.3;">
        ${venue.name}
      </div>
      <div style="font-size:11px;opacity:.55;text-transform:capitalize;margin-bottom:8px;">
        ${venue.amenity}${venue.cuisine ? ` · ${venue.cuisine}` : ''}
      </div>
      <div style="font-size:12px;font-weight:500;color:${color};margin-bottom:${venue.openingHours ? '6px' : '0'};">
        ${label}
      </div>
      ${venue.openingHours
        ? `<div style="font-size:11px;opacity:.5;">🕐 ${venue.openingHours}</div>` : ''}
    </div>`
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MapView({ center, sunPosition, buildings, venues, onBoundsChange }) {
  const containerRef   = useRef(null)
  const mapRef         = useRef(null)
  const styleLoadedRef = useRef(false)
  const markersRef     = useRef([])
  const userMarkerRef  = useRef(null)

  // Stable refs so event callbacks always see the latest prop values
  const onBoundsChangeRef = useRef(onBoundsChange)
  const sunPositionRef    = useRef(sunPosition)
  const buildingsRef      = useRef(buildings)
  useEffect(() => { onBoundsChangeRef.current = onBoundsChange }, [onBoundsChange])
  useEffect(() => { sunPositionRef.current    = sunPosition    }, [sunPosition])
  useEffect(() => { buildingsRef.current      = buildings      }, [buildings])

  // ── One-time map initialisation ──────────────────────────────────────────
  useEffect(() => {
    // Guard: skip if already initialised or container not yet in DOM
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container:  containerRef.current,
      style:      OSM_STYLE,           // inline object — never needs a network request to resolve
      center:     [13.35, 52.49],      // Berlin Schöneberg
      zoom:       15,
      pitch:      45,
      bearing:    -10,
      antialias:  true,
      projection: 'mercator',
    })

    // Controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')

    // ── setupLayers ─────────────────────────────────────────────────────────
    // Registered with on('load') not once() so it is safe to call after any
    // future setStyle() invocation (guards prevent double-adding).
    function setupLayers() {
      styleLoadedRef.current = true

      // Buildings source
      if (!map.getSource('buildings-geojson')) {
        map.addSource('buildings-geojson', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      // 3-D buildings layer — only add if it doesn't already exist
      if (!map.getLayer('buildings-3d')) {
        map.addLayer({
          id:     'buildings-3d',
          type:   'fill-extrusion',
          source: 'buildings-geojson',
          paint: {
            'fill-extrusion-color':   BUILDING_COLOR,
            'fill-extrusion-height':  ['coalesce', ['get', 'height'], 9],
            'fill-extrusion-base':    0,
            'fill-extrusion-opacity': 0.82,
          },
        })
      }

      // Flush state accumulated while the style was still loading
      try { map.setLight(sunToMapLight(sunPositionRef.current)) } catch (_) { /* no-op on raster */ }

      const src = map.getSource('buildings-geojson')
      if (src && buildingsRef.current.length > 0) {
        src.setData({ type: 'FeatureCollection', features: buildingsRef.current })
      }

      // Emit initial viewport so App.jsx triggers the first Overpass fetch
      emitBounds()
    }

    function emitBounds() {
      if (!mapRef.current) return
      const b = map.getBounds()
      onBoundsChangeRef.current({
        south: b.getSouth(), west: b.getWest(),
        north: b.getNorth(), east: b.getEast(),
      })
    }

    map.on('load', setupLayers)
    map.on('moveend', emitBounds)

    mapRef.current = map

    // ── resize() after first layout tick ────────────────────────────────────
    // MapLibre reads container dimensions synchronously at construction.
    // If CSS hasn't been applied yet the canvas is 0 × 0 and the map is blank.
    // A 100 ms defer guarantees the browser has painted the container.
    const resizeTimer = setTimeout(() => {
      if (mapRef.current) mapRef.current.resize()
    }, 100)

    return () => {
      clearTimeout(resizeTimer)
      styleLoadedRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fly to user location ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    map.flyTo({ center: [center.lng, center.lat], zoom: 15.5, duration: 2000, essential: true })

    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([center.lng, center.lat])
    } else {
      const el = document.createElement('div')
      el.className = 'user-dot'
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([center.lng, center.lat])
        .addTo(map)
    }
  }, [center])

  // ── Sun light ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoadedRef.current) return
    try { map.setLight(sunToMapLight(sunPosition)) } catch (_) { /* no-op on raster base */ }
  }, [sunPosition])

  // ── 3-D buildings data ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleLoadedRef.current) return
    const src = map.getSource('buildings-geojson')
    if (src) src.setData({ type: 'FeatureCollection', features: buildings })
  }, [buildings])

  // ── Venue markers (DOM-level — no style dependency) ──────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    venues.forEach((venue) => {
      const el = document.createElement('div')
      el.className = `venue-marker ${venue.inSun ? 'in-sun' : 'in-shade'}`
      el.innerHTML = `<div class="marker-pip"><span class="marker-pip-inner">${venue.inSun ? '☀️' : '🌥'}</span></div>`

      const popup = new maplibregl.Popup({ offset: 28, closeButton: true, maxWidth: '240px' })
        .setHTML(popupHtml(venue))

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([venue.lng, venue.lat])
        .setPopup(popup)
        .addTo(map)

      markersRef.current.push(marker)
    })
  }, [venues])

  // ── Render ───────────────────────────────────────────────────────────────
  // Explicit inline dimensions are more reliable than Tailwind utility classes
  // because they don't depend on CSS load order or class name generation.
  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}
    />
  )
}
