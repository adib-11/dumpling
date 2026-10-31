import { useState, type FormEvent } from "react"
import type { InboxDump } from "../src/inbox"
import { useFolder } from "./useFolder"

// The Dumps waiting for the next Ingest. The Owner can fix or remove one before it is filed (spec §5).
export function Inbox() {
  const { value: dumps } = useFolder(() => window.dumpling.inbox())
  if (!dumps) return null
  if (dumps.length === 0) return <p className="empty">Nothing is waiting. Dumps wait here for the next Ingest.</p>
  return (
    <ul className="dumps inbox">
      {dumps.map((dump) => (
        <Row key={dump.name} dump={dump} />
      ))}
    </ul>
  )
}

function Row({ dump }: { dump: InboxDump }) {
  const [mode, setMode] = useState<"read" | "edit" | "delete">("read")
  const [text, setText] = useState(dump.text)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const when = dump.captured
    ? new Date(dump.captured).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : dump.name
  const label = `Dump from ${when}`

  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError("")
    setBusy(true)
    const result = await work()
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMode("read")
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    await run(() => window.dumpling.editDump(dump.name, text))
  }

  return (
    <li>
      <span className="meta">
        {when} {dump.device}
        {dump.kind === "text" ? "" : `, ${dump.kind}`}
      </span>
      {mode === "edit" ? (
        <form onSubmit={save}>
          <label htmlFor={`edit-${dump.name}`}>Text of the {label}</label>
          <textarea
            id={`edit-${dump.name}`}
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                setText(dump.text)
                setError("")
                setMode("read")
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className="body">{dump.text || `(${dump.kind})`}</span>
          {mode === "delete" ? (
            <div className="actions">
              <span>Delete this Dump?</span>
              <button type="button" onClick={() => setMode("read")}>
                Keep
              </button>
              <button type="button" disabled={busy} onClick={() => void run(() => window.dumpling.deleteDump(dump.name))}>
                Delete
              </button>
            </div>
          ) : (
            <div className="actions">
              <button
                type="button"
                aria-label={`Edit ${label}`}
                onClick={() => {
                  setText(dump.text)
                  setMode("edit")
                }}
              >
                Edit
              </button>
              <button type="button" aria-label={`Delete ${label}`} onClick={() => setMode("delete")}>
                Delete
              </button>
            </div>
          )}
        </>
      )}
      <p role="alert">{error}</p>
    </li>
  )
}
