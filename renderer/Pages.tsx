import { useEffect, useState, type FormEvent } from "react"
import type { PageGroup, PageHit, PageKind, PageView } from "../src/page-view"
import { PageBlocks } from "./PageBlocks"

const kindLabels: Record<PageKind, string> = {
  people: "People",
  works: "Works",
  topics: "Topics",
  projects: "Projects",
  places: "Places",
  me: "Me",
}

// The Pages tab (spec §5): the Pages by kind, one Page as rendered markdown with the Pages that link to it,
// and search. It only reads. The lists are read again each time the tab is shown, since Ingest changes them.
export function Pages({ active }: { active: boolean }) {
  const [groups, setGroups] = useState<PageGroup[] | null>(null)
  // The Pages opened so far, newest last, so Back returns along the same path.
  const [trail, setTrail] = useState<string[]>([])
  const [view, setView] = useState<PageView | null>(null)
  const [obsidian, setObsidian] = useState(false)
  const [query, setQuery] = useState("")
  // null: not searching. Otherwise the words last searched for, and what they found.
  const [found, setFound] = useState<{ words: string; hits: PageHit[] } | null>(null)
  const current = trail[trail.length - 1]

  useEffect(() => {
    if (!active) return
    let stale = false
    void window.dumpling.pages().then((next) => !stale && setGroups(next))
    void window.dumpling.obsidianInstalled().then((installed) => !stale && setObsidian(installed))
    return () => {
      stale = true
    }
  }, [active])

  useEffect(() => {
    if (!active || current === undefined) return
    let stale = false
    void window.dumpling.page(current).then((next) => {
      if (stale) return
      // A Page gone since the list was read: back to the last one that is there.
      if (next === null) setTrail((before) => before.slice(0, -1))
      else setView(next)
    })
    return () => {
      stale = true
    }
  }, [active, current])

  function open(id: string) {
    setTrail((before) => (before[before.length - 1] === id ? before : [...before, id]))
  }

  function back() {
    setView(null)
    setTrail((before) => before.slice(0, -1))
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    const words = query.trim()
    setFound(words === "" ? null : { words, hits: await window.dumpling.searchPages(words) })
  }

  if (current !== undefined) {
    return (
      <PageReader
        view={view?.id === current ? view : null}
        obsidian={obsidian}
        onOpen={open}
        onBack={back}
      />
    )
  }

  return (
    <>
      <form role="search" onSubmit={search}>
        <label htmlFor="page-search">Search Pages</label>
        <div className="row">
          <input
            id="page-search"
            type="search"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit">Search</button>
        </div>
      </form>
      {found !== null ? (
        <SearchResults found={found} onOpen={open} onClear={() => setFound(null)} />
      ) : groups === null ? null : groups.length === 0 ? (
        <p className="empty">No Pages yet. Ingest files your Dumps into Pages.</p>
      ) : (
        groups.map((group) => (
          <section key={group.kind} aria-labelledby={`pages-${group.kind}`}>
            <h2 id={`pages-${group.kind}`}>{kindLabels[group.kind]}</h2>
            <ul className="page-list">
              {group.pages.map((page) => (
                <li key={page.id}>
                  <button type="button" className="page-link" onClick={() => open(page.id)}>
                    {page.title}
                  </button>
                  {page.summary !== "" && <span className="page-summary"> {page.summary}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  )
}

function SearchResults({
  found,
  onOpen,
  onClear,
}: {
  found: { words: string; hits: PageHit[] }
  onOpen: (id: string) => void
  onClear: () => void
}) {
  return (
    <section aria-label="Search results">
      <p role="status">
        {found.hits.length === 0 ? `No Pages match “${found.words}”.` : `Pages matching “${found.words}”:`}{" "}
        <button type="button" className="page-link" onClick={onClear}>
          Show all Pages
        </button>
      </p>
      <ul className="page-list">
        {found.hits.map((hit) => (
          <li key={hit.id}>
            <button type="button" className="page-link" onClick={() => onOpen(hit.id)}>
              {hit.title}
            </button>
            <span className="page-summary"> {kindLabels[hit.kind]}</span>
            {hit.snippet !== "" && <p className="snippet">{hit.snippet}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function PageReader({
  view,
  obsidian,
  onOpen,
  onBack,
}: {
  view: PageView | null
  obsidian: boolean
  onOpen: (id: string) => void
  onBack: () => void
}) {
  const startsWithTitle = view?.blocks[0]?.type === "heading" && view.blocks[0].depth === 1
  return (
    <>
      <div className="row page-bar">
        <button type="button" onClick={onBack}>
          Back
        </button>
        {view && obsidian && (
          <button type="button" onClick={() => void window.dumpling.openInObsidian(view.id)}>
            Open in Obsidian
          </button>
        )}
      </div>
      {view && (
        <article className="page">
          {!startsWithTitle && <h2>{view.title}</h2>}
          <PageBlocks blocks={view.blocks} onOpen={onOpen} />
          {view.backlinks.length > 0 && (
            <section aria-labelledby="backlinks">
              <h2 id="backlinks">Linked from</h2>
              <ul className="page-list">
                {view.backlinks.map((link) => (
                  <li key={link.id}>
                    <button type="button" className="page-link" onClick={() => onOpen(link.id)}>
                      {link.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </>
  )
}
