import fs from "node:fs"
import path from "node:path"
import { markdownToBlocks, wikiTargets, withoutWikiBrackets, type ResolveLink } from "./page-markdown"
import { pageKinds, type Backlink, type PageGroup, type PageHit, type PageKind, type PageSummary, type PageView } from "./page-view"
import { parseFrontmatter } from "./write-index"

// The Pages of a second brain, read from vault/wiki/ (spec §5). Everything here only reads; nothing in the
// Pages tab can change a Page.

function wikiDir(brain: string): string {
  return path.join(brain, "vault", "wiki")
}

// Where a Page's text starts: after its frontmatter block, if it has one.
function splitFrontmatter(text: string): string {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  return match ? text.slice(match[0].length) : text
}

function pageText(brain: string, id: string): string {
  return fs.readFileSync(path.join(wikiDir(brain), `${id}.md`), "utf8")
}

function summarise(id: string, kind: PageKind, text: string): PageSummary {
  const fm = parseFrontmatter(text)
  const heading = /^#[ \t]+(.+?)[ \t]*$/m.exec(splitFrontmatter(text))?.[1]
  const summary = fm.summary
  return {
    id,
    kind,
    title: heading ?? path.basename(id),
    summary: Array.isArray(summary) ? summary.join(", ") : (summary ?? ""),
  }
}

function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
}

// Resolves a wiki link's target the way Obsidian does: by path under wiki/ when it has a slash, else by file
// name, ignoring case and any `#heading` or `^block`. Two Pages with one file name: the earlier kind wins.
function pageResolver(brain: string, groups: PageGroup[]): (from: string) => ResolveLink {
  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const { pages } of groups) {
    for (const page of pages) {
      byId.set(page.id.toLowerCase(), page.id)
      const name = path.basename(page.id).toLowerCase()
      if (!byName.has(name)) byName.set(name, page.id)
    }
  }
  return (from) => (target) => {
    const name = target.replace(/[#^].*$/, "").trim().replace(/\.md$/i, "")
    if (name === "") return { kind: "page", id: from }
    const id = byId.get(name.toLowerCase()) ?? byName.get(name.toLowerCase())
    if (id) return { kind: "page", id }
    return exists(brain, name) ? { kind: "elsewhere" } : { kind: "missing" }
  }
}

// A file that is not a Page: a Dump, still in inbox/ or filed under raw/YYYY/MM/, or a list in wiki/.
function exists(brain: string, name: string): boolean {
  if (name !== path.basename(name)) return false
  return [
    path.join(wikiDir(brain), `${name}.md`),
    path.join(brain, "inbox", `${name}.md`),
    path.join(brain, "vault", "raw", name.slice(0, 4), name.slice(5, 7), `${name}.md`),
  ].some((file) => fs.existsSync(file))
}

export async function readPage(brain: string, id: string): Promise<PageView | null> {
  const groups = listPages(brain)
  const summary = groups.flatMap((group) => group.pages).find((page) => page.id === id)
  if (!summary) return null
  const resolver = pageResolver(brain, groups)
  const text = pageText(brain, id)
  return {
    id,
    kind: summary.kind,
    title: summary.title,
    blocks: await markdownToBlocks(splitFrontmatter(text), resolver(id)),
    backlinks: backlinks(brain, groups, resolver, id),
  }
}

// The Pages whose text links to `id`. It reads every Page. INDEX SEAM: at thousands of Pages, keep a
// links-to table, updated after each Ingest, and look `id` up in it instead.
function backlinks(brain: string, groups: PageGroup[], resolver: (from: string) => ResolveLink, id: string): Backlink[] {
  return groups
    .flatMap((group) => group.pages)
    .filter((other) => other.id !== id)
    .filter((other) => {
      const resolve = resolver(other.id)
      const text = pageText(brain, other.id)
      return wikiTargets(splitFrontmatter(text)).some((target) => {
        const found = resolve(target)
        return found.kind === "page" && found.id === id
      })
    })
    .map((other) => ({ id: other.id, title: other.title }))
}

export function listPages(brain: string): PageGroup[] {
  const wiki = wikiDir(brain)
  const groups: PageGroup[] = []
  for (const kind of pageKinds) {
    const files =
      kind === "me" ? (fs.existsSync(path.join(wiki, "me.md")) ? ["me.md"] : []) : markdownFiles(path.join(wiki, kind))
    const pages = files.map((name) => {
      const id = kind === "me" ? "me" : `${kind}/${name.slice(0, -3)}`
      return summarise(id, kind, pageText(brain, id))
    })
    if (pages.length > 0) groups.push({ kind, pages })
  }
  return groups
}

const snippetLength = 160

// Pages whose name, aliases, summary or text hold every word of `query`, in any case; a word in the name or an
// alias ranks above one in the text. It reads every Page. INDEX SEAM: at thousands of Pages, build a
// full-text index after each Ingest and answer from it; `PageHit` stays the same.
export function searchPages(brain: string, query: string): PageHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "")
  if (words.length === 0) return []
  const hits: { hit: PageHit; score: number }[] = []
  for (const page of listPages(brain).flatMap((group) => group.pages)) {
    const text = pageText(brain, page.id)
    const aliases = parseFrontmatter(text).aliases
    const names = [path.basename(page.id), page.title, ...(Array.isArray(aliases) ? aliases : [aliases ?? ""])].join("\n").toLowerCase()
    const body = withoutWikiBrackets(splitFrontmatter(text))
    const rest = `${page.summary}\n${body}`.toLowerCase()
    let score = 0
    for (const word of words) {
      if (names.includes(word)) score += 2
      else if (rest.includes(word)) score += 1
      else {
        score = 0
        break
      }
    }
    if (score > 0) hits.push({ score, hit: { id: page.id, kind: page.kind, title: page.title, snippet: snippet(body, words) } })
  }
  return hits.sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title)).map(({ hit }) => hit)
}

// The first line of text that holds a query word, else the first line of text.
function snippet(body: string, words: string[]): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
  const line = lines.find((each) => words.some((word) => each.toLowerCase().includes(word))) ?? lines[0] ?? ""
  return line.length > snippetLength ? `${line.slice(0, snippetLength - 1)}…` : line
}
