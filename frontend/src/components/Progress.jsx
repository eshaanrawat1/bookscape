function Progress({ value }) {
  const safeValue = Math.min(100, Math.max(0, value || 0))
  return (
    <div className="progressTrack">
      <div style={{ width: `${safeValue}%` }} />
    </div>
  )
}

export default Progress
