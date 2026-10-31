import { useState, type FormEvent } from "react"

// The bot steps: BotFather, the token, then /start from the phone. Shown on Today until a bot is connected.
export function ConnectPhone({ onConnected }: { onConnected: () => void }) {
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
    if (!connected.ok) {
      setError(connected.error)
      setUsername(null)
      return
    }
    onConnected()
  }

  return (
    <section className="card" aria-labelledby="connect-title">
      <h2 id="connect-title">Connect your phone</h2>
      <p>
        Send Dumps and <code>/ask</code> from Telegram. Open BotFather, send <code>/newbot</code>, and paste the token
        it gives you. The bot chat lives on Telegram's servers until the app saves each message and deletes it from the
        chat.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="token">Bot token</label>
        <div className="row">
          <input
            id="token"
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
    </section>
  )
}
