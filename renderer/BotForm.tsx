import { useState, type FormEvent } from "react"

// The bot steps: BotFather, the token, then /start from the phone. Today's Connect your phone card and
// Settings both use it. A bot already connected keeps working until the new one's /start arrives.
export function BotForm({ inputId, onConnected }: { inputId: string; onConnected: () => void }) {
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [username, setUsername] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    const checked = await window.dumpling.checkToken(token)
    if (!checked.ok) {
      setError(checked.error)
      setBusy(false)
      return
    }
    setUsername(checked.username)
    const connected = await window.dumpling.waitStart()
    setBusy(false)
    setUsername(null)
    if (!connected.ok) {
      setError(connected.error)
      return
    }
    setToken("")
    onConnected()
  }

  return (
    <>
      <form onSubmit={submit}>
        <label htmlFor={inputId}>Bot token</label>
        <div className="row">
          <input
            id={inputId}
            type="password"
            spellCheck={false}
            autoComplete="off"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <button type="button" onClick={() => void window.dumpling.openBotFather()}>
            Open BotFather
          </button>
        </div>
        <p role="alert">{error}</p>
        <div className="actions">
          <button type="submit" disabled={busy}>
            Check
          </button>
        </div>
      </form>
      {username && <p role="status">Now send /start to @{username} from your phone.</p>}
    </>
  )
}
