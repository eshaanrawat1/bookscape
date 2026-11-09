const BASE = 'http://127.0.0.1:9876/api'
const TOKEN_HEADER = 'X-Bookscape-Token'
// Outlasts the ~30.5s cold-start wait_for_backend() in src-tauri/src/main.rs.
const BOOTSTRAP_RETRIES = 34
const BOOTSTRAP_RETRY_DELAY_MS = 1000

let tokenPromise: Promise<string> | null = null

// Proves a request came from this window. Failures aren't cached, since IPC can lag on cold start.
function apiToken(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = import('@tauri-apps/api/tauri')
      .then(({ invoke }) => invoke<string>('api_token'))
      .catch((err) => {
        tokenPromise = null
        throw err
      })
  }
  return tokenPromise
}

async function authorizedHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra)
  headers.set(TOKEN_HEADER, await apiToken())
  return headers
}

async function apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: await authorizedHeaders(options?.headers),
  })
  if (!res.ok) {
    throw await readErrorDetail(res, path)
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

// Yields each parsed line of a newline-delimited JSON POST stream as it arrives.
async function* apiFetchStream<T = unknown>(path: string, body: unknown): AsyncGenerator<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: await authorizedHeaders({ 'Content-Type': 'application/json' }),
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
