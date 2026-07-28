import { useEffect, useState } from 'react'
import { X, FolderOpen, RefreshCcw } from 'lucide-react'
import { apiFetch } from '../api.js'
import type { SyncPullResult, SyncPushResult } from '../types.js'

interface SettingsDialogProps {
  onClose: () => void
  onDataChanged?: () => Promise<void>
}

type SettingsResult = ({ kind: 'pull' } & SyncPullResult) | ({ kind: 'push' } & SyncPushResult)

function SettingsDialog({ onClose, onDataChanged }: SettingsDialogProps) {
  const [vaultPath, setVaultPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null)
  const [result, setResult] = useState<SettingsResult | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<{ vault_path?: string }>('/settings/vault-path')
      .then((data) => {
        if (!cancelled) setVaultPath(data.vault_path || '')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the vault path.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function saveVaultPath(path: string) {
    setSaving(true)
    setError(null)
    try {
      const data = await apiFetch<{ vault_path?: string }>('/settings/vault-path', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      setVaultPath(data.vault_path || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the vault path.')
    } finally {
      setSaving(false)
    }
  }

  async function handleBrowse() {
    try {
      const { open } = await import('@tauri-apps/api/dialog')
      const dir = await open({ directory: true, multiple: false })
      if (typeof dir === 'string' && dir) {
        await saveVaultPath(dir)
      }
    } catch {
      setError('Could not open the folder picker. Are you running the desktop app?')
    }
  }

  async function runPull() {
    setBusy('pull')
    setError(null)
    setResult(null)
    try {
      const data = await apiFetch<SyncPullResult>('/sync/obsidian', { method: 'POST' })
      setResult({ kind: 'pull', ...data })
      await onDataChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pull from Obsidian failed.')
    } finally {
      setBusy(null)
    }
  }

  async function runPush() {
    setBusy('push')
    setError(null)
    setResult(null)
    try {
      const data = await apiFetch<SyncPushResult>('/sync/obsidian/push', { method: 'POST' })
      setResult({ kind: 'push', ...data })
      await onDataChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push to Obsidian failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dialogScrim" onClick={onClose}>
      <article className="bookDialog paperGrain scraperDialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialogIconButton dialogClose" onClick={onClose} aria-label="Close dialog">
          <X />
        </button>

        <h2>Obsidian Vault</h2>
        <p className="dialogAuthor" style={{ marginBottom: '1.5rem' }}>
          Point Bookscape at any folder to Push your reading/finished books out as notes,
          or Pull existing notes back in.
        </p>

        <div className="scraperForm">
          <div className="scraperField">
            <label htmlFor="vault-path" className="scraperLabel">Vault folder</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="vault-path"
                type="text"
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                onBlur={(e) => saveVaultPath(e.target.value.trim())}
                disabled={loading || saving}
                placeholder="/path/to/any/folder"
                className="scraperInput"
              />
              <button
                type="button"
                className="secondaryButton"
                onClick={handleBrowse}
                disabled={loading || saving}
                aria-label="Browse for a folder"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          {error && <p className="scraperError">{error}</p>}

          {result && (
            <div className="scraperStatus" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem' }}>
              {result.kind === 'pull' ? (
                <span className="scraperStatusText">
                  Scanned {result.scanned_files}, imported {result.imported}
                  {result.skipped?.length ? `, skipped ${result.skipped.length}` : ''}.
                </span>
              ) : (
                <span className="scraperStatusText">
                  Wrote {result.written}, removed {result.deleted}
                  {result.skipped_collisions?.length ? `, ${result.skipped_collisions.length} collision(s) skipped` : ''}.
                </span>
              )}
              {(result.kind === 'push' ? result.skipped_collisions : []).map((c) => (
                <span key={c.filename} className="scraperError">
                  "{c.filename}" claimed by {c.uids.join(', ')} — rename in Obsidian and Push again.
                </span>
              ))}
            </div>
          )}

          <div className="scraperButtons">
            <button
              type="button"
              className="secondaryButton"
              onClick={runPull}
              disabled={!vaultPath || busy !== null}
            >
              {busy === 'pull' ? <RefreshCcw className="syncIcon spinning" size={16} /> : 'Pull from Vault'}
            </button>
            <button
              type="button"
              className="primaryButton"
              onClick={runPush}
              disabled={!vaultPath || busy !== null}
            >
              {busy === 'push' ? <RefreshCcw className="syncIcon spinning" size={16} /> : 'Push to Vault'}
            </button>
          </div>
        </div>
      </article>
    </div>
  )
}

export default SettingsDialog
