const BASE = 'http://127.0.0.1:9876/api'
// The Tauri shell can take up to ~30.5s to finish launching the backend on a
// cold first run (see wait_for_backend() in src-tauri/src/main.rs). Keep
// retrying at least that long so we don't give up before the backend is up.
const BOOTSTRAP_RETRIES = 34
const BOOTSTRAP_RETRY_DELAY_MS = 1000

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
