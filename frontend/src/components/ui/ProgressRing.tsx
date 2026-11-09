interface ProgressRingProps {
  value: number
  total: number
  /** Outer diameter in px. The stroke scales off it. */
  size?: number
  /** The ring is drawn as an image, so this is the only thing that reads it out. */
  label: string
}

// A dash-gap circle rather than an arc path: one number, and no seam at 100%.
function ProgressRing({ value, total, size = 44, label }: ProgressRingProps) {
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
      aria-label={label}
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
    </div>
  )
}

export default ProgressRing
