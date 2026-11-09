import type { SVGProps } from 'react'

function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="6.4" r="2.8" />
      <path d="M12 13.4C9.5 11.3 5.8 11.2 3 12.8v6.3c2.8-1.6 6.5-1.5 9 .6" />
      <path d="M12 13.4c2.5-2.1 6.2-2.2 9-.6v6.3c-2.8-1.6-6.5-1.5-9 .6" />
      <path d="M12 13.4v6.3" />
    </svg>
  )
}

export default BrandMark
