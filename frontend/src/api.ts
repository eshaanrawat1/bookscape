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

async function readErrorDetail(res: Response, path: string): Promise<Error> {
  let detail = ''
  try {
    const payload = await res.json()
    detail = payload?.detail ? `: ${payload.detail}` : ''
  } catch {
    detail = ''
  }
  return new Error(`API ${path} -> ${res.status}${detail}`)
}

// Streams newline-delimited JSON events from a POST endpoint, yielding each
// parsed line as it arrives (used for the scraper's staged progress events).
async function* apiFetchStream<T = unknown>(path: string, body: unknown): AsyncGenerator<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw await readErrorDetail(res, path)
  }
  if (!res.body) {
    throw new Error(`API ${path} -> empty response body`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) yield JSON.parse(line) as T
    }
  }
  const rest = buffer.trim()
  if (rest) yield JSON.parse(rest) as T
}

export { apiFetch, apiFetchStream, BOOTSTRAP_RETRIES, BOOTSTRAP_RETRY_DELAY_MS }
