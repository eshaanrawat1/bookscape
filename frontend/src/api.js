const BASE = 'http://127.0.0.1:9876/api'
const ROOT_BASE = BASE.replace(/\/api$/, '')
const BOOTSTRAP_RETRIES = 2
const BOOTSTRAP_RETRY_DELAY_MS = 500

async function apiFetch(path, options) {
  const url = `${BASE}${path}`
  console.log(`[API Fetch] ${options?.method || 'GET'} ${url}`)
  const res = await fetch(url, options)
  console.log(`[API Fetch] ${url} -> Status: ${res.status}`)
  if (!res.ok) {
    let detail = ''
    try {
      const payload = await res.json()
      detail = payload?.detail ? `: ${payload.detail}` : ''
      console.log(`[API Fetch] Error payload:`, payload)
    } catch {
      detail = ''
    }
    const error = `API ${path} -> ${res.status}${detail}`
    console.error(`[API Fetch] Error:`, error)
    throw new Error(error)
  }
  const data = await res.json()
  console.log(`[API Fetch] Success:`, path, data)
  return data
}

async function postJsonWithFallback(path) {
  const targets = [
    `${BASE}${path}`,
  ]

  let lastError = null
  for (const url of targets) {
    try {
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        let detail = ''
        try {
          const payload = await res.json()
          detail = payload?.detail ? `: ${payload.detail}` : ''
        } catch {
          detail = ''
        }
        throw new Error(`API ${path} -> ${res.status}${detail}`)
      }
      return await res.json()
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error(`API ${path} failed`)
}

export { apiFetch, postJsonWithFallback, BASE, ROOT_BASE, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS }
