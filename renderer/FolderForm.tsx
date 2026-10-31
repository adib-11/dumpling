import { useEffect, useState, type FormEvent } from "react"

export function FolderForm({ onCreated }: { onCreated: () => void }) {
  const [folder, setFolder] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.dumpling.defaultFolder().then(setFolder)
  }, [])

  async function browse() {
    const picked = await window.dumpling.pickFolder()
    if (picked) setFolder(picked)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    const result = await window.dumpling.create(folder)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated()
  }

  return (
    <>
      <h1>Choose a folder</h1>
      <p>
        This is where the second brain lives. The app creates the vault and a git history in the folder you pick. The
        usual place is Documents/Dumpling.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="folder">Folder</label>
        <div className="row">
          <input
            id="folder"
            type="text"
            spellCheck={false}
            required
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
          <button type="button" onClick={browse}>
            Browse
          </button>
        </div>
        <p role="alert">{error}</p>
        <div className="actions">
          <button type="submit" disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </>
  )
}
