import { useEffect, useState } from 'react'
import { X, FolderOpen, RefreshCcw } from 'lucide-react'
import { apiFetch } from '../api.js'

interface SettingsDialogProps {
  onClose: () => void
}

function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [vaultPath, setVaultPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      await apiFetch<{ vault_path?: string }>('/settings/vault-path', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      onClose()
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
        setVaultPath(dir)
        await saveVaultPath(dir)
      }
    } catch {
      setError('Could not open the folder picker. Are you running the desktop app?')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveVaultPath(vaultPath.trim())
  }

  const busy = loading || saving

  return (
    <div className="dialogScrim" onClick={onClose}>
      <article className="bookDialog paperGrain scraperDialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialogIconButton dialogClose" onClick={onClose} aria-label="Close dialog">
          <X />
        </button>

        <h2>Vault Settings</h2>
        <p className="dialogAuthor" style={{ marginBottom: '1.5rem' }}>
          Point Bookscape at any folder. Use the Push/Pull icons in the top bar to sync
          your reading/finished books with notes in this vault.
        </p>

        <form onSubmit={handleSubmit} className="scraperForm">
          <div className="scraperField">
            <label htmlFor="vault-path" className="scraperLabel">Vault folder</label>
            <div className="scraperInputRow">
              <input
                id="vault-path"
                type="text"
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                disabled={busy}
                placeholder="/path/to/any/folder"
                className="scraperInput"
              />
              <button
                type="button"
                className="secondaryButton"
                onClick={handleBrowse}
                disabled={busy}
                aria-label="Browse for a folder"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          {error && <p className="scraperError">{error}</p>}

          {busy && (
            <div className="scraperStatus">
              <RefreshCcw className="syncIcon spinning" />
              <span className="scraperStatusText">
                {loading ? 'Loading vault path...' : 'Saving...'}
              </span>
            </div>
          )}

          <div className="scraperButtons">
            <button type="button" className="secondaryButton" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primaryButton" disabled={busy}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </article>
    </div>
  )
}

export default SettingsDialog
