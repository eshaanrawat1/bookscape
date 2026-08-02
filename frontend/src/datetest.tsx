import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DateProperty from './components/DateProperty.js'
import './styles.css'

function Harness() {
  const [value, setValue] = useState('2026-02-01')
  return (
    <article className="bookDialog paperGrain" style={{ margin: '4rem auto' }}>
      <div className="trackingProps">
        <div className="trackingProp">
          <span className="trackingPropLabel"><span>Started</span></span>
          <span className="trackingPropValue">
            <DateProperty label="Started" value={value} onChange={setValue} />
          </span>
        </div>
      </div>
      <output id="probe">{value || '(empty)'}</output>
    </article>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
