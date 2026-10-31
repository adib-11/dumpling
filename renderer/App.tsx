import { useCallback, useEffect, useState } from "react"
import type { Tab, WindowState } from "../src/main-window"
import { EngineForm } from "./EngineForm"
import { FolderForm } from "./FolderForm"
import { Tabs } from "./Tabs"

export function App() {
  const [state, setState] = useState<WindowState | null>(null)
  const [tab, setTab] = useState<Tab>("today")

  const refresh = useCallback(() => {
    void window.dumpling.state().then(setState)
  }, [])

  useEffect(() => {
    refresh()
    window.dumpling.onTab(setTab)
  }, [refresh])

  if (!state) return null
  if (state.step === "folder") {
    return (
      <main className="first-run">
        <FolderForm onCreated={refresh} />
      </main>
    )
  }
  if (state.step === "engine") {
    return (
      <main className="first-run">
        <h1 id="engine-title">Choose the Engine</h1>
        <EngineForm labelledBy="engine-title" onChosen={refresh} />
      </main>
    )
  }
  return <Tabs tab={tab} onTab={setTab} connectPhone={state.connectPhone} onConnected={refresh} />
}
