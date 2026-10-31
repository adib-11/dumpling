import fs from "node:fs"
import path from "node:path"

// A Dump is a markdown file: frontmatter, the Owner's words, then optionally `## Image text` or `## Follow-up`
// (ingest skill, "A Dump"). This reads one without changing it.
export type DumpFile = {
  name: string
  fields: Record<string, string>
  // The frontmatter block, "---" lines included, ready to write back.
  head: string
  // The Owner's own words: the body up to the first section Ingest or the Owner's answer added.
  text: string
  // Those sections, from their heading on, or "".
  tail: string
  // When the Owner made it: `captured`, else the time in the file name. null when neither reads.
  captured: Date | null
}

export function parseDump(name: string, contents: string): DumpFile {
  const lines = contents.split("\n")
  const fields: Record<string, string> = {}
  let close = -1
  if (lines[0] === "---") {
    close = lines.indexOf("---", 1)
    for (let i = 1; close !== -1 && i < close; i++) {
      const sep = lines[i].indexOf(":")
      if (sep !== -1) fields[lines[i].slice(0, sep)] = lines[i].slice(sep + 1).trim()
    }
  }
  const head = close === -1 ? "" : `${lines.slice(0, close + 1).join("\n")}\n`
  const body = lines.slice(close + 1).join("\n")
  const section = /^## (Image text|Follow-up)[ \t]*$/m.exec(body)
  const text = (section ? body.slice(0, section.index) : body).trim()
  return { name, fields, head, text, tail: section ? body.slice(section.index) : "", captured: capturedAt(name, fields) }
}

export function readDump(file: string): DumpFile {
  return parseDump(path.basename(file, ".md"), fs.readFileSync(file, "utf8"))
}

// The file's contents with new Owner's words and everything else as it was.
export function withText(dump: DumpFile, text: string): string {
  return `${dump.head}${text.trim()}\n${dump.tail ? `\n${dump.tail}` : ""}`
}

function capturedAt(name: string, fields: Record<string, string>): Date | null {
  const stated = new Date(fields.captured ?? "")
  if (!Number.isNaN(stated.getTime())) return stated
  const stem = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)
  if (!stem) return null
  const [year, month, day, hour, minute, second] = stem.slice(1).map(Number)
  return new Date(year, month - 1, day, hour, minute, second)
}
