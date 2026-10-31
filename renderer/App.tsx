import { useCallback, useEffect, useState } from "react"
import type { Tab, WindowState } from "../src/main-window"
import logo from "../assets/logo.svg"
import { EngineForm } from "./EngineForm"
import { FolderForm } from "./FolderForm"
import { Tabs } from "./Tabs"

export function App() {
  const [state, setState] = useState<WindowState | null>(null)
  const [tab, setTab] = useState<Tab>("today")
  const [askRequest, setAskRequest] = useState(0)

  const refresh = useCallback(() => {
    void window.dumpling.state().then(setState)
  }, [])

  useEffect(() => {
    refresh()
    window.dumpling.onTab((asked) => {
      setTab(asked)
      if (asked === "ask") setAskRequest((count) => count + 1)
    })
  }, [refresh])

  if (!state) return null
  if (state.step === "folder") {
    return (
      <main className="first-run">
        <img className="logo" src={logo} alt="" />
        <FolderForm onCreated={refresh} />
      </main>
    )
  }
  if (state.step === "engine") {
    return (
      <main className="first-run">
        <img className="logo" src={logo} alt="" />
        <h1 id="engine-title">Choose the Engine</h1>
        <EngineForm labelledBy="engine-title" onChosen={refresh} />
      </main>
    )
  }
  return (
    <Tabs
      tab={tab}
      onTab={setTab}
      connectPhone={state.connectPhone}
      onConnected={refresh}
      askRequest={askRequest}
    />
  )
}
