import { useEffect, useState, type FormEvent } from "react"
import type { OfferedProvider } from "../src/main-window"

type Props = { labelledBy: string; onChosen: () => void; inSettings?: boolean }

// Start free (selected) or Use my own key. It says where the Dumps go for the choice (spec §3).
// In Settings it starts on the current Engine.
export function EngineForm({ labelledBy, onChosen, inSettings = false }: Props) {
  const [engine, setEngine] = useState<"free" | "key">("free")
  const [offered, setOffered] = useState<OfferedProvider[]>([])
  const [provider, setProvider] = useState("")
  const [key, setKey] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([window.dumpling.providers(), inSettings ? window.dumpling.engine() : null]).then(
      ([list, current]) => {
        setOffered(list)
        const currentKey = list.find((each) => each.id === current)
        setProvider(currentKey?.id ?? list[0]?.id ?? "")
        if (currentKey) setEngine("key")
      },
    )
  }, [inSettings])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    if (engine === "free") {
      await window.dumpling.startFree()
      setBusy(false)
      onChosen()
      return
    }
    const result = await window.dumpling.saveKey(provider, key)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setKey("")
    onChosen()
  }

  const chosen = offered.find((each) => each.id === provider)

  return (
    <form onSubmit={submit}>
      <fieldset aria-labelledby={labelledBy}>
        <label className="choice">
          <input type="radio" name="engine" checked={engine === "free"} onChange={() => setEngine("free")} />
          Start free
        </label>
        <p className="choice-note">
          No key and no account. Your Dumps go to opencode's servers in the US and EU, to a free model that keeps no
          data and does not train on it. Voice notes wait until you add a key.
        </p>
        <label className="choice">
          <input type="radio" name="engine" checked={engine === "key"} onChange={() => setEngine("key")} />
          Use my own key
        </label>
        <p className="choice-note">Your Dumps go to the provider you pick, on your own key.</p>
      </fieldset>
      {engine === "key" && (
        <>
          <fieldset aria-label="Provider">
            {offered.map((each) => (
              <label className="choice" key={each.id}>
                <input
                  type="radio"
                  name="provider"
                  checked={provider === each.id}
                  onChange={() => setProvider(each.id)}
                />
                {each.label}
              </label>
            ))}
          </fieldset>
          {chosen && <p>{whereDumpsGo(chosen)}</p>}
          <label htmlFor="key">API key</label>
          <div className="row">
            <input
              id="key"
              type="password"
              spellCheck={false}
              autoComplete="off"
              required
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <button type="button" onClick={() => void window.dumpling.openKeyPage(provider)}>
              Get a key
            </button>
          </div>
        </>
      )}
      <p role="alert">{error}</p>
      <div className="actions">
        <button type="submit" disabled={busy}>
          {engine === "key" ? "Save key" : inSettings ? "Save" : "Continue"}
        </button>
      </div>
    </form>
  )
}

// Only OpenAI gets the line about training.
function whereDumpsGo(provider: OfferedProvider): string {
  const training = provider.id === "openai" ? " OpenAI does not use API data for training by default." : ""
  const voice = provider.audio ? "" : " Voice notes wait until you add an OpenAI or Gemini key."
  return `Your Dumps go to ${provider.label}, and Ingest uses your key with ${provider.model}.${training}${voice} The key is stored in the OS keychain.`
}
