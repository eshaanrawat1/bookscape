import { useState } from 'react'
import { Flame, Plus } from 'lucide-react'
import { collectionIdFromName } from '../utils.js'
import { mainNav, shelfNav } from '../constants.js'
import { useLibraryData } from '../context/LibraryDataContext.jsx'

function Sidebar({ active, onSelect }) {
  const { collections, createCollection: onCreateCollection, renameCollection: onRenameCollection } = useLibraryData()
  const [editingId, setEditingId] = useState(null)
  const [draftName, setDraftName] = useState('')
  const [collectionError, setCollectionError] = useState('')
  const [saving, setSaving] = useState(false)

  const startRename = (collection) => {
    setEditingId(collection.id)
    setDraftName(collection.name)
    setCollectionError('')
  }

  const finishRename = async (collection) => {
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
      setCollectionError(err.message || 'Could not rename collection.')
    } finally {
      setSaving(false)
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
      setCollectionError(err.message || 'Could not create collection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="sidebar paperGrain">
      <div className="brand">
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
                <span className="collectionCount">{`(${bookCount})`}</span>
              </div>
            )
          })}
        </div>
        {collectionError && <p className="collectionError">{collectionError}</p>}
      </section>
    </aside>
  )
}

function NavButton({ item, active, onSelect }) {
  const Icon = item.icon
  return (
    <button className={active ? 'navButton active' : 'navButton'} onClick={() => onSelect(item.id)}>
      <Icon />
      <span>{item.label}</span>
    </button>
  )
}

export default Sidebar
