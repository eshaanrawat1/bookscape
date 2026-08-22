interface ProgressRingProps {
  value: number
  total: number
  /** Outer diameter in px. The stroke and the label scale off it. */
  size?: number
  label?: string
  /** Off for rings small enough that a numeral inside would not be legible. */
  showLabel?: boolean
}

// A ring rather than a bar because what it reports is a fraction of a countable
// set — four books, three of them read — and an arc closing on itself reads as
// "how much of this is left" in a way a bar the width of its column does not.
//
// Drawn as a stroked circle with a dash gap rather than an arc path: the
// geometry is one number (how much of the circumference to paint) instead of
// trigonometry, and it degenerates correctly at both ends — a zero-length dash
// paints nothing, and a full-length one paints the whole ring without the
// seam an arc from 0° to 360° leaves behind.
function ProgressRing({ value, total, size = 44, label, showLabel = true }: ProgressRingProps) {
  const safeTotal = Math.max(0, total || 0)
  const safeValue = Math.min(safeTotal, Math.max(0, value || 0))
  const fraction = safeTotal > 0 ? safeValue / safeTotal : 0

  const stroke = Math.max(2, size * 0.1)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div
      className="progressRing"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label || `${safeValue} of ${safeTotal}`}
    >
      {/* Rotated so the arc starts at twelve o'clock rather than three. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="progressRingTrack"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="progressRingValue"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {showLabel && <span className="progressRingLabel">{safeValue}</span>}
    </div>
  )
}

export default ProgressRing
