import { useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react"

// The same limit src/main.ts holds.
const maxImageBytes = 20 * 1024 * 1024

type Attached = { name: string; bytes: Uint8Array }

// The quick capture box (spec v0.2 §6): text, a link, or an image pasted or dropped on it. Enter saves and the
// main process closes the box; Esc closes it with nothing saved. Shift+Enter starts a new line.
export function Capture() {
  const [text, setText] = useState("")
  const [image, setImage] = useState<Attached | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  async function attach(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      setError("Only images can be dropped here.")
      return
    }
    if (file.size > maxImageBytes) {
      setError("That image is over 20 MB.")
      return
    }
    setError("")
    setImage({ name: file.name || "pasted image", bytes: new Uint8Array(await file.arrayBuffer()) })
  }

  async function save(): Promise<void> {
    if (busy) return
    setError("")
    setBusy(true)
    const result = await window.dumpling.capture(text, image?.bytes ?? null)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      box.current?.focus()
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  function keyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      void window.dumpling.closeCapture()
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void save()
    }
  }

  function paste(event: ClipboardEvent) {
    const file = [...event.clipboardData.files].find((each) => each.type.startsWith("image/"))
    if (!file) return
    event.preventDefault()
    void attach(file)
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) {
      void attach(file)
      return
    }
    const dropped = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain")
    if (dropped) setText((before) => (before ? `${before}\n${dropped}` : dropped))
  }

  return (
    <main className="capture" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <h1 className="sr-only">Quick capture</h1>
      <form onSubmit={submit} onKeyDown={keyDown}>
        <label htmlFor="capture-text">Dump</label>
        <textarea
          ref={box}
          id="capture-text"
          autoFocus
          value={text}
          placeholder="A thought or a link. Paste or drop an image."
          onChange={(event) => setText(event.target.value)}
          onPaste={paste}
        />
        {image && (
          <p className="capture-image">
            Image: {image.name}{" "}
            <button type="button" onClick={() => setImage(null)}>
              Remove
            </button>
          </p>
        )}
        <p role="alert">{error}</p>
        <p className="capture-hint">{busy ? "Saving…" : "Enter saves. Esc closes."}</p>
      </form>
    </main>
  )
}
