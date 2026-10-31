import { useEffect, useState, type FormEvent } from "react"
import { BotForm } from "./BotForm"
import { EngineForm } from "./EngineForm"

type Props = { botConnected: boolean; onBotConnected: () => void }

// Engine and key, bot, folder, backup remote and open at login (spec §5). Each change takes effect at once,
// with no restart.
export function Settings({ botConnected, onBotConnected }: Props) {
  const [engineSaved, setEngineSaved] = useState(false)
  return (
    <>
      <section aria-labelledby="settings-engine">
        <h2 id="settings-engine">Engine</h2>
        <EngineForm labelledBy="settings-engine" onChosen={() => setEngineSaved(true)} inSettings />
        {engineSaved && <p role="status">Saved. The next Ingest and question use it.</p>}
      </section>
      <Bot connected={botConnected} onConnected={onBotConnected} />
      <Folder />
      <BackupRemote />
      <OpenAtLogin />
    </>
  )
}

function Bot({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const [saved, setSaved] = useState(false)
  return (
    <section aria-labelledby="settings-bot">
      <h2 id="settings-bot">Bot</h2>
      <p>
        {connected
          ? "A bot is connected. To use another, paste its token; this one keeps working until the new bot gets /start."
          : "No bot is connected. Open BotFather, send /newbot, and paste the token it gives you."}
      </p>
      <BotForm
        inputId="settings-token"
        onConnected={() => {
          setSaved(true)
          onConnected()
        }}
      />
      {saved && <p role="status">Connected.</p>}
    </section>
  )
}

function Folder() {
  const [current, setCurrent] = useState<string | null>(null)
  const [folder, setFolder] = useState("")
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.dumpling.folder().then(setCurrent)
  }, [])

  async function browse() {
    const picked = await window.dumpling.pickFolder()
    if (picked) setFolder(picked)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setDone("")
    setBusy(true)
    const result = await window.dumpling.changeFolder(folder)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCurrent(folder.trim())
    setFolder("")
    setDone(
      result.created
        ? "Made a new second brain there. The old folder is left as it was."
        : "Now using that second brain. The old folder is left as it was.",
    )
  }

  return (
    <section aria-labelledby="settings-folder">
      <h2 id="settings-folder">Folder</h2>
      {current && <p>The second brain is in {current}.</p>}
      <p>
        Choose another second brain folder to use it, or an empty folder to make a new one. Nothing is moved or copied.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="settings-folder-path">Folder</label>
        <div className="row">
          <input
            id="settings-folder-path"
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
        {done && <p role="status">{done}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Use folder
          </button>
        </div>
      </form>
    </section>
  )
}

function OpenAtLogin() {
  const [on, setOn] = useState<boolean | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    void window.dumpling.openAtLogin().then(setOn)
  }, [])

  async function change(next: boolean) {
    setError("")
    setOn(next)
    const result = await window.dumpling.setOpenAtLogin(next)
    if (!result.ok) {
      setOn(!next)
      setError(result.error)
    }
  }

  return (
    <section aria-labelledby="settings-login">
      <h2 id="settings-login">Open at login</h2>
      <label className="choice">
        <input
          type="checkbox"
          checked={on ?? false}
          disabled={on === null}
          onChange={(event) => void change(event.target.checked)}
        />
        Open Dumpling when you log in, so Telegram drains and the daily Ingest runs
      </label>
      <p role="alert">{error}</p>
    </section>
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
