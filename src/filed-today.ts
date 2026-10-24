import path from "node:path"
import { read } from "./check-ingest"

// The daily "Filed today" message, from the log.md entries of the Dumps this run filed. It stands in for
// the weekly Digest. Nothing filed: no message.
export function filedToday(brain: string, filed: string[], failed: number): string | undefined {
  if (filed.length === 0) return undefined
  const wiki = path.join(brain, "vault", "wiki")
  const names = new Set(filed)
  // The newest entry per Dump, so an Undo and a re-file count once.
  const entries = new Map<string, { fields: Record<string, string>; rules: string[] }>()
  for (const chunk of read(path.join(wiki, "log.md")).split(/^(?=## \[)/m)) {
    const fields: Record<string, string> = {}
    const rules: string[] = []
    for (const [, key, value] of chunk.matchAll(/^- ([A-Za-z][^:\n]*): (.*)$/gm)) {
      if (key === "Rule change") rules.push(value)
      else fields[key] = value
    }
    const name = /\[\[([^\]|]+)/.exec(fields.Raw ?? "")?.[1]
    if (name && names.has(name)) entries.set(name, { fields, rules })
  }
  const created = new Set<string>()
  const updated = new Set<string>()
  const rules: string[] = []
  let unfetched = 0
  for (const entry of entries.values()) {
    for (const page of pagesIn(entry.fields.Created)) created.add(page)
    for (const page of pagesIn(entry.fields.Updated)) updated.add(page)
    if ((entry.fields.Flags ?? "").split(/;\s*/).includes("unfetched link")) unfetched += 1
    rules.push(...entry.rules)
  }
  for (const page of created) updated.delete(page)
  const threadsAdded = read(path.join(wiki, "open-threads.md"))
    .split("\n")
    .filter((line) => line.startsWith("- [") && filed.some((name) => line.includes(`[[${name}|`))).length
  return [
    "Filed today",
    `Dumps: ${filed.length} filed, ${failed} failed.`,
    `Pages: ${created.size} created, ${updated.size} updated.`,
    `Unfetched links: ${unfetched}.`,
    `Open threads added: ${threadsAdded}.`,
    ...(rules.length > 0 ? ["Rule changes Ingest proposes:", ...rules.map((rule) => `- ${rule}`)] : []),
  ].join("\n")
}

// Wikilinked Pages only: a bare `open-threads` is not a Page.
function pagesIn(field = ""): string[] {
  return [...field.matchAll(/\[\[([^\]|]+)/g)].map((match) => match[1])
}
