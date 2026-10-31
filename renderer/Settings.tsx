import { useEffect, useState, type FormEvent } from "react"
import { EngineForm } from "./EngineForm"

// Holds what the setup window did after first run: change the Engine and set the backup remote. The rest of
// Settings comes later.
export function Settings() {
  const [engineSaved, setEngineSaved] = useState(false)
  return (
    <>
      <section aria-labelledby="settings-engine">
        <h2 id="settings-engine">Engine</h2>
        <EngineForm labelledBy="settings-engine" onChosen={() => setEngineSaved(true)} inSettings />
        {engineSaved && <p role="status">Saved. The next Ingest and question use it.</p>}
      </section>
      <BackupRemote />
    </>
  )
}

function BackupRemote() {
  const [url, setUrl] = useState("")
  const [isSet, setIsSet] = useState<boolean | null>(null)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.dumpling.backupRemote().then(setIsSet)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setSaved(false)
    setBusy(true)
    const result = await window.dumpling.saveRemote(url)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setIsSet(url.trim() !== "")
    setUrl("")
    setSaved(true)
  }

  return (
    <section aria-labelledby="settings-remote">
      <h2 id="settings-remote">Backup remote</h2>
      <p>
        Optional. After each Ingest the app pushes the folder to this remote. A failed push changes nothing here; it
        shows in the tray. Leave it blank to stop pushing.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="remote">Remote URL</label>
        <div className="row">
          <input
            id="remote"
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        {isSet !== null && <p>{isSet ? "A remote is set." : "No remote is set."}</p>}
        <p role="alert">{error}</p>
        {saved && <p role="status">Saved.</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </section>
  )
}
