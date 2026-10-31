import { useCallback, useEffect, useState } from "react"

// Reads something from the folder, and reads it again when the main process says a Dump arrived or an
// Ingest ended, and when the window gets focus (the Owner may have edited the folder, or a day may have turned).
export function useFolder<T>(read: () => Promise<T>): { value: T | undefined; reload: () => void } {
  const [value, setValue] = useState<T>()
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((each) => each + 1), [])

  useEffect(() => {
    let current = true
    void read().then((next) => {
      if (current) setValue(next)
    })
    return () => {
      current = false
    }
    // `read` is a stable bridge call, so only a change event reloads.
  }, [version])

  useEffect(() => {
    const stop = window.dumpling.onChange(reload)
    window.addEventListener("focus", reload)
    return () => {
      stop()
      window.removeEventListener("focus", reload)
    }
  }, [reload])

  return { value, reload }
}
