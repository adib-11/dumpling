import { useEffect, useRef, useState, type FormEvent } from "react"

// What the Ask window did: one Recall or Persona question, answered from the Pages by the ask skill. The question
// box takes focus each time Ask… in the menu opens the tab (focusRequest goes up), as the window's did.
export function Ask({ focusRequest }: { focusRequest: number }) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (focusRequest > 0) box.current?.focus()
  }, [focusRequest])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setAnswer("")
    setBusy(true)
    const result = await window.dumpling.ask(question)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setAnswer(result.answer)
  }

  return (
    <>
      <p>
        Answers come from your own Pages, with citations, and end with how far the vault is filed. Nothing you ask is
        stored.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="question">Question</label>
        <textarea
          ref={box}
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <p role="alert">{error}</p>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>
      <p className="answer" aria-live="polite">
        {answer}
      </p>
    </>
  )
}
