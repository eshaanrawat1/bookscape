import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { apiFetch } from '../../api.js'
import Dialog, { DialogStatus, type DialogCloseProps } from './Dialog.jsx'
import { errorMessage } from '../../utils.js'

function SettingsDialog({ onClose }: DialogCloseProps) {
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
        if (!cancelled) setError(errorMessage(err, 'Could not load the vault path.'))
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
      setError(errorMessage(err, 'Could not save the vault path.'))
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
    <Dialog label="Vault Settings" className="scraperDialog" busy={saving} onClose={onClose}>
      <h2>Vault Settings</h2>
      <p className="dialogDescription">
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
          <DialogStatus>{loading ? 'Loading vault path...' : 'Saving...'}</DialogStatus>
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
    </Dialog>
  )
}

export default SettingsDialog
