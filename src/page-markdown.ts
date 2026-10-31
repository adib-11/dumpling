import type { Token, Tokens } from "marked" with { "resolution-mode": "import" }
import type { Block, Inline } from "./page-view"

// Page markdown to the block tree the Pages tab draws (spec §5). The tree has no raw HTML in it, no image
// and no link but http and https, so a Page, which the Engine writes from whatever a Dump linked to, can
// neither run script nor load anything when it is opened.

export type LinkTarget = { kind: "page"; id: string } | { kind: "missing" } | { kind: "elsewhere" }

export type ResolveLink = (target: string) => LinkTarget

// `[[target]]`, `[[target|label]]`, and `![[embed]]`.
const wikiLink = /(!?)\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]/g

// What each wiki link in the markdown names, as written. An embed is drawn as a label, never as a link, so it
// names nothing.
export function wikiTargets(markdown: string): string[] {
  return [...markdown.matchAll(wikiLink)].filter((match) => match[1] !== "!").map((match) => match[2].trim())
}

// The text a wiki link shows: `[[page|Label]]` as `Label`, `[[page]]` as `page`.
export function withoutWikiBrackets(text: string): string {
  return text.replace(wikiLink, (_all, _embed, target: string, label?: string) => label?.trim() || target.trim())
}

export async function markdownToBlocks(markdown: string, resolve: ResolveLink): Promise<Block[]> {
  const { marked } = await import("marked")
  return blocks(marked.lexer(markdown, { gfm: true }), resolve)
}

function blocks(tokens: Token[], resolve: ResolveLink): Block[] {
  const out: Block[] = []
  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        out.push({ type: "heading", depth: token.depth, children: inlines(token.tokens ?? [], resolve) })
        break
      case "paragraph":
      case "text":
        out.push({ type: "paragraph", children: inlines(token.tokens ?? [token], resolve) })
        break
      case "list":
        out.push({
          type: "list",
          ordered: token.ordered,
          items: (token as Tokens.List).items.map((item) => ({
            checked: item.task ? Boolean(item.checked) : null,
            children: blocks(item.tokens, resolve),
          })),
        })
        break
      case "blockquote":
        out.push(quote(token as Tokens.Blockquote, resolve))
        break
      case "code":
        out.push({ type: "code", text: token.text })
        break
      case "table": {
        const table = token as Tokens.Table
        out.push({
          type: "table",
          head: table.header.map((cell) => inlines(cell.tokens, resolve)),
          rows: table.rows.map((row) => row.map((cell) => inlines(cell.tokens, resolve))),
        })
        break
      }
      case "hr":
        out.push({ type: "rule" })
        break
      case "html":
        // Shown as the text it is; never as markup.
        out.push({ type: "paragraph", children: [{ type: "text", text: token.raw.trim() }] })
        break
    }
  }
  return out
}

// `> [!warning] Disputed` is an Obsidian callout: the kind, a title on the same line, and the rest of the
// quote as its body. A `-` after the kind means collapsed.
function quote(token: Tokens.Blockquote, resolve: ResolveLink): Block {
  const [first, ...after] = token.tokens
  const lead = first?.type === "paragraph" ? (first as Tokens.Paragraph).tokens : []
  const marker = lead[0]?.type === "text" ? /^\[!([\w-]+)\]([+-]?)[ \t]*/.exec((lead[0] as Tokens.Text).text) : null
  if (!marker || first?.type !== "paragraph") return { type: "quote", children: blocks(token.tokens, resolve) }

  const title: Token[] = []
  const body: Token[] = []
  const firstText = (lead[0] as Tokens.Text).text.slice(marker[0].length)
  let inTitle = true
  for (const part of [{ type: "text", raw: firstText, text: firstText } as Token, ...lead.slice(1)]) {
    if (!inTitle) {
      body.push(part)
    } else if (part.type === "text" && (part as Tokens.Text).text.includes("\n")) {
      const text = (part as Tokens.Text).text
      const at = text.indexOf("\n")
      title.push({ type: "text", raw: text.slice(0, at), text: text.slice(0, at) } as Token)
      const rest = text.slice(at + 1)
      if (rest !== "") body.push({ type: "text", raw: rest, text: rest } as Token)
      inTitle = false
    } else {
      title.push(part)
    }
  }
  const kind = marker[1].toLowerCase()
  const titleInlines = inlines(title, resolve)
  return {
    type: "callout",
    kind,
    title: titleInlines.some((part) => part.type !== "text" || part.text.trim() !== "")
      ? titleInlines
      : [{ type: "text", text: kind }],
    collapsed: marker[2] === "-",
    children: [
      ...(body.length > 0 ? [{ type: "paragraph" as const, children: inlines(body, resolve) }] : []),
      ...blocks(after, resolve),
    ],
  }
}

function inlines(tokens: Token[], resolve: ResolveLink): Inline[] {
  const out: Inline[] = []
  for (const token of tokens) {
    switch (token.type) {
      case "text":
        if ((token as Tokens.Text).tokens) out.push(...inlines((token as Tokens.Text).tokens ?? [], resolve))
        else out.push(...withWikiLinks(token.text, resolve))
        break
      case "escape":
        out.push({ type: "text", text: token.text })
        break
      case "strong":
      case "em":
      case "del":
        out.push({ type: token.type, children: inlines(token.tokens ?? [], resolve) })
        break
      case "codespan":
        out.push({ type: "code", text: token.text })
        break
      case "br":
        out.push({ type: "br" })
        break
      case "link": {
        const children = inlines(token.tokens ?? [], resolve)
        if (isWebAddress(token.href)) out.push({ type: "link", href: token.href, children })
        else out.push(...children)
        break
      }
      case "image":
        out.push({ type: "text", text: token.text })
        break
      default:
        // Inline html and anything else: its source, as text.
        out.push({ type: "text", text: token.raw })
    }
  }
  return merge(out)
}

function isWebAddress(href: string): boolean {
  try {
    const { protocol } = new URL(href)
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

function withWikiLinks(text: string, resolve: ResolveLink): Inline[] {
  const out: Inline[] = []
  let from = 0
  for (const match of text.matchAll(wikiLink)) {
    if (match.index > from) out.push({ type: "text", text: text.slice(from, match.index) })
    const target = match[2].trim()
    const label = match[3]?.trim() || target
    const found = match[1] === "!" ? ({ kind: "elsewhere" } as const) : resolve(target)
    out.push(
      found.kind === "page"
        ? { type: "page-link", id: found.id, label }
        : found.kind === "missing"
          ? { type: "missing-link", label }
          : { type: "elsewhere-link", label },
    )
    from = match.index + match[0].length
  }
  if (from < text.length) out.push({ type: "text", text: text.slice(from) })
  return out
}

// Adjacent text runs become one, and empty ones go.
function merge(parts: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (part.type === "text" && part.text === "") continue
    if (part.type === "text" && last?.type === "text") last.text += part.text
    else out.push(part)
  }
  return out
}
