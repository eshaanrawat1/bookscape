import { Star } from 'lucide-react'

function StarRating({ value }) {
  return (
    <span className="starRating">
      <Star />
      {value.toFixed(1)}
    </span>
  )
}

export default StarRating
