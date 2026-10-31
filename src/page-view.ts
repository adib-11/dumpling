// What the Pages tab shows (spec §5). The main process reads and renders Pages into these shapes; the renderer
// only draws them. Shared by the main process, the preload and the renderer, so it imports nothing.

export const pageKinds = ["people", "works", "topics", "projects", "places", "me"] as const

export type PageKind = (typeof pageKinds)[number]

// `id` is the Page's path under vault/wiki/ without `.md` (`people/rahim`, `me`). It is the only handle the
// renderer holds; the main process looks it up in its own list.
export type PageSummary = { id: string; kind: PageKind; title: string; summary: string }

export type PageGroup = { kind: PageKind; pages: PageSummary[] }

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "br" }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  // Only http and https links get here; any other link keeps its text and loses the address.
  | { type: "link"; href: string; children: Inline[] }
  | { type: "page-link"; id: string; label: string }
  | { type: "missing-link"; label: string }
  // A wiki link to something that exists but is not a Page: a Dump, `log`, `open-threads`, an embedded image.
  | { type: "elsewhere-link"; label: string }

export type Block =
  | { type: "heading"; depth: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: { checked: boolean | null; children: Block[] }[] }
  | { type: "quote"; children: Block[] }
  // An Obsidian callout (`> [!warning] Disputed`), which Pages use for outdated Takes and disputed facts.
  | { type: "callout"; kind: string; title: Inline[]; collapsed: boolean; children: Block[] }
  | { type: "code"; text: string }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "rule" }

export type Backlink = { id: string; title: string }

export type PageView = {
  id: string
  kind: PageKind
  title: string
  blocks: Block[]
  // The Pages whose text links here, by title.
  backlinks: Backlink[]
}

export type PageHit = { id: string; kind: PageKind; title: string; snippet: string }
