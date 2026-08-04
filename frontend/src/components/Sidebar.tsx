import { useState } from 'react'
import { Flame, Plus, X, type LucideIcon } from 'lucide-react'
import { collectionIdFromName } from '../utils.js'
import { mainNav, shelfNav } from '../constants.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import type { Collection } from '../types.js'

interface SidebarProps {
  active: string
  onSelect: (viewId: string) => void
}

function Sidebar({ active, onSelect }: SidebarProps) {
  const {
    collections,
    createCollection: onCreateCollection,
    renameCollection: onRenameCollection,
    deleteCollection: onDeleteCollection,
  } = useLibraryData()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [collectionError, setCollectionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Collection | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const startRename = (collection: Collection) => {
    setEditingId(collection.id)
    setDraftName(collection.name)
    setCollectionError('')
  }

  const finishRename = async (collection: Collection) => {
    const clean = draftName.trim().replace(/\s+/g, ' ')
    if (clean === collection.name) {
      setEditingId(null)
      setCollectionError('')
      return
    }
    if (!clean) {
      setCollectionError('Collection name is required.')
      return
    }
    if (collections.some((item) => item.id !== collection.id && item.name.toLowerCase() === clean.toLowerCase())) {
      setCollectionError('Collection names must be unique.')
      return
    }

    setSaving(true)
    try {
      await onRenameCollection(collection, clean)
      setEditingId(null)
      setCollectionError('')
    } catch (err) {
      setCollectionError(err instanceof Error ? err.message : 'Could not rename collection.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDeleteCollection(pendingDelete)
      setPendingDelete(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete collection.')
    } finally {
      setDeleting(false)
    }
  }

  const createCollection = async () => {
    setSaving(true)
    setCollectionError('')
    try {
      const createdName = await onCreateCollection()
      setEditingId(collectionIdFromName(createdName))
      setDraftName(createdName)
    } catch (err) {
      setCollectionError(err instanceof Error ? err.message : 'Could not create collection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="sidebar paperGrain">
      <div className="brand" data-tauri-drag-region>
        <div className="brandMark">
          <Flame />
        </div>
        <div>
          <p className="brandName">Bookscape</p>
          <p className="brandTag">your reading corner</p>
        </div>
      </div>

      <section className="navSection">
        <p className="sectionLabel">Home</p>
        {mainNav.map((item) => (
          <NavButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </section>

      <section className="navSection">
        <p className="sectionLabel">My Shelves</p>
        {shelfNav.map((item) => (
          <NavButton key={item.id} item={item} active={active === item.id} onSelect={onSelect} />
        ))}
      </section>

      <section className="navSection collectionsSection">
        <div className="sectionHeader">
          <p className="sectionLabel">Collections</p>
          <button className="plusButton" aria-label="New collection" onClick={createCollection} disabled={saving}>
            <Plus />
          </button>
        </div>
        <div className="collectionList">
          {collections.map((collection) => {
            const id = `collection:${collection.id}`
            const isActive = active === id
            const isEditing = editingId === collection.id
            const bookCount = (collection.books?.length ?? collection.bookIds?.length ?? 0)
            return (
              <div
                key={collection.id}
                role="button"
                tabIndex={0}
                className={isActive ? 'collectionButton active' : 'collectionButton'}
                onClick={() => onSelect(id)}
                onKeyDown={(event) => {
                  if (isEditing) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(id)
                  }
                }}
              >
                <span className="collectionDot" />
                {isEditing ? (
                  <form
                    className="collectionEditForm"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onSubmit={(event) => {
                      event.preventDefault()
                      finishRename(collection)
                    }}
                  >
                    <input
                      className="collectionNameInput"
                      value={draftName}
                      autoFocus
                      disabled={saving}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={(event) => {
                        if (event.currentTarget.dataset.cancelRename === 'true') return
                        finishRename(collection)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.currentTarget.dataset.cancelRename = 'true'
                          setEditingId(null)
                          setCollectionError('')
                        }
                      }}
                      aria-label={`Rename ${collection.name}`}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="collectionNameButton"
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      startRename(collection)
                    }}
                  >
                    {collection.name}
                  </button>
                )}
                <button
                  type="button"
                  className="collectionCount"
                  aria-label={`Delete ${collection.name}`}
                  title={`Delete ${collection.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDeleteError(null)
                    setPendingDelete(collection)
                  }}
                >
                  <span className="collectionCountValue" aria-hidden="true">{`(${bookCount})`}</span>
                  <span className="collectionCountIcon" aria-hidden="true"><X /></span>
                </button>
              </div>
            )
          })}
        </div>
        {collectionError && <p className="collectionError">{collectionError}</p>}
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete “${pendingDelete.name}”?`}
          message="This collection will be removed for good. Your books stay in the library — this can't be undone."
          confirmLabel="Delete collection"
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (deleting) return
            setPendingDelete(null)
            setDeleteError(null)
          }}
        />
      )}
    </aside>
  )
}

interface NavItem {
  id: string
  label: string
  icon: LucideIcon
}

interface NavButtonProps {
  item: NavItem
  active: boolean
  onSelect: (id: string) => void
}

function NavButton({ item, active, onSelect }: NavButtonProps) {
  const Icon = item.icon
  return (
    <button className={active ? 'navButton active' : 'navButton'} onClick={() => onSelect(item.id)}>
      <Icon />
      <span>{item.label}</span>
    </button>
  )
}

export default Sidebar
