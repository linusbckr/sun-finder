import { useCallback } from 'react'
import { formatTime, minutesToDate, sunLabel } from '../utils/sun'

const TICK_LABELS = ['0h', '6h', '12h', '18h', '24h']

export default function TimeSlider({ time, onChange, sunPosition }) {
  const totalMinutes = time.getHours() * 60 + time.getMinutes()
  const isDay = sunPosition.altitude > 0
  const label = sunLabel(sunPosition.altitude)

  const handleChange = useCallback(
    (e) => {
      onChange(minutesToDate(Number(e.target.value), time))
    },
    [onChange, time]
  )

  const handleNow = useCallback(() => {
    onChange(new Date())
  }, [onChange])

  return (
    <div className="glass rounded-2xl px-5 py-4 w-full">
      {/* Top row: time + label + Now button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span
            className="text-2xl font-semibold tabular-nums tracking-tight"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatTime(time)}
          </span>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{
              background: isDay ? 'rgba(250,204,21,0.18)' : 'rgba(148,163,184,0.15)',
              color: isDay ? '#fde047' : '#94a3b8',
            }}
          >
            {isDay ? '☀️' : '🌙'} {label}
          </span>
        </div>

        <button
          onClick={handleNow}
          className="text-xs font-medium px-3 py-1.5 rounded-full transition-all"
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
        >
          Now
        </button>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={1439}
        step={1}
        value={totalMinutes}
        onChange={handleChange}
        className="time-range"
        aria-label="Select time of day"
      />

      {/* Tick labels */}
      <div className="flex justify-between mt-2 px-0.5">
        {TICK_LABELS.map((t) => (
          <span key={t} className="text-xs opacity-40" style={{ fontSize: '10px' }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}
