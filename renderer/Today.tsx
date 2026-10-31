import { useState } from "react"
import type { TodayDump, TodayView } from "../src/today"
import { useFolder } from "./useFolder"

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""

const day = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })

// What the Owner needs each day (spec §5): what came in, what was filed, what failed, and what is open.
export function Today() {
  const { value: view } = useFolder(() => window.dumpling.today())
  if (!view) return null
  return (
    <>
      {view.failure && <Failure failure={view.failure} />}
      <Stats stats={view.stats} />
      <DumpList id="today-captured" title="Captured today" dumps={view.captured} empty="Nothing captured today yet." />
      <DumpList id="today-filed" title="Filed today" dumps={view.filed} empty="Nothing filed today yet." />
      <DumpList
        id="today-follow-ups"
        title="Follow-ups waiting for an answer"
        dumps={view.followUps}
        empty="No Follow-ups are waiting."
        note="Reply to the bot's question in Telegram."
      />
      <OpenThreads threads={view.openThreads} />
    </>
  )
}

function Failure({ failure }: { failure: NonNullable<TodayView["failure"]> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function retry() {
    setError("")
    setBusy(true)
    const result = await window.dumpling.retryIngest()
    setBusy(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <section className="card failure" aria-labelledby="today-failure">
      <h2 id="today-failure">The last Ingest failed</h2>
      <p>
        {day(failure.when)}: {failure.reason}
      </p>
      {failure.stash && (
        <p>
          Its edits are in the git stash <code>{failure.stash}</code>. The Dumps are still in the Inbox.
        </p>
      )}
      <button type="button" onClick={() => void retry()} disabled={busy}>
        {busy ? "Retrying…" : "Retry"}
      </button>
      <p role="alert">{error}</p>
    </section>
  )
}

function Stats({ stats }: { stats: TodayView["stats"] }) {
  const items: [string, string][] = [
    ["Dumps this week", String(stats.dumpsThisWeek)],
    ["Engine cost this month", `$${stats.costThisMonth.toFixed(2)}`],
    ["Pages", String(stats.pages)],
    [
      "Last Ingest",
      stats.lastIngest ? `${day(stats.lastIngest.when)}${stats.lastIngest.status === "ok" ? "" : `, ${stats.lastIngest.status}`}` : "never",
    ],
  ]
  return (
    <dl className="stats" aria-label="Stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function DumpList(props: {
  id: string
  title: string
  dumps: (TodayDump & { title?: string | null })[]
  empty: string
  note?: string
}) {
  return (
    <section aria-labelledby={props.id}>
      <h2 id={props.id}>{props.title}</h2>
      {props.dumps.length === 0 ? (
        <p className="empty">{props.empty}</p>
      ) : (
        <>
          {props.note && <p className="empty">{props.note}</p>}
          <ul className="dumps">
            {props.dumps.map((dump) => (
              <li key={dump.name}>
                <span className="meta">
                  {clock(dump.captured)} {dump.device}
                  {dump.title ? ` → ${dump.title}` : ""}
                </span>
                <span>{dump.preview || `(${dump.kind})`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function OpenThreads({ threads }: { threads: TodayView["openThreads"] }) {
  return (
    <section aria-labelledby="today-threads">
      <h2 id="today-threads">Open threads</h2>
      {threads.length === 0 ? (
        <p className="empty">Nothing is open.</p>
      ) : (
        <ul className="dumps">
          {threads.map((thread, index) => (
            <li key={index}>
              <span className="meta">
                {thread.date ?? ""}
                {thread.page ? ` → ${thread.page}` : ""}
              </span>
              <span>{thread.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
