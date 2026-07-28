const BASE = 'http://127.0.0.1:9876/api'
const BOOTSTRAP_RETRIES = 2
const BOOTSTRAP_RETRY_DELAY_MS = 500

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options)
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
  return res.json()
}

export { apiFetch, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS }
