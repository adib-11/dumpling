import { useRef, type KeyboardEvent, type ReactNode } from "react"
import { tabs, type Tab } from "../src/main-window"
import { ConnectPhone } from "./ConnectPhone"
import { Inbox } from "./Inbox"
import { Pages } from "./Pages"
import { Settings } from "./Settings"
import { Today } from "./Today"

const labels: Record<Tab, string> = {
  today: "Today",
  inbox: "Inbox",
  pages: "Pages",
  ask: "Ask",
  settings: "Settings",
}

type Props = { tab: Tab; onTab: (tab: Tab) => void; connectPhone: boolean; onConnected: () => void }

// The five tabs (spec §5). Panels stay mounted while hidden, so a tab keeps what was typed in it.
export function Tabs({ tab, onTab, connectPhone, onConnected }: Props) {
  const buttons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  function move(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : tabs.indexOf(tab) + step
    if (step === 0 && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()
    const next = tabs[(index + tabs.length) % tabs.length]
    onTab(next)
    buttons.current[next]?.focus()
  }

  const panels: Record<Tab, ReactNode> = {
    today: (
      <>
        {connectPhone && <ConnectPhone onConnected={onConnected} />}
        <Today />
      </>
    ),
    inbox: <Inbox />,
    pages: <Pages active={tab === "pages"} />,
    ask: <p className="empty">Ask… in the menu opens the Ask window.</p>,
    settings: <Settings />,
  }

  return (
    <>
      <nav role="tablist" aria-label="Dumpling" onKeyDown={move}>
        {tabs.map((each) => (
          <button
            key={each}
            ref={(button) => {
              buttons.current[each] = button
            }}
            role="tab"
            id={`tab-${each}`}
            aria-selected={tab === each}
            aria-controls={`panel-${each}`}
            tabIndex={tab === each ? 0 : -1}
            onClick={() => onTab(each)}
          >
            {labels[each]}
          </button>
        ))}
      </nav>
      {tabs.map((each) => (
        <main key={each} role="tabpanel" id={`panel-${each}`} aria-labelledby={`tab-${each}`} hidden={tab !== each}>
          <h1>{labels[each]}</h1>
          {panels[each]}
        </main>
      ))}
    </>
  )
}
