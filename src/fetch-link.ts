import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Fetches the link of each Dump with a `url` into <name>.fetched.md beside it (v1 spec §7), so the agent
// only reads a sidecar. Ported route for route from bin/fetch-link in adib-11/second-brain.
// A Dump that already has a sidecar is never fetched again. Any failure, paywall or 404 writes
// `status: unfetched` with a reason and whatever title and description were found.

export type LinkTools = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  // Runs yt-dlp with these arguments and resolves to its exit code.
  ytDlp: (args: string[]) => Promise<number>
}

// yt-dlp needs a JavaScript runtime for YouTube; the app ships deno beside it.
export function ytDlpAt(bin: string, deno: string): LinkTools["ytDlp"] {
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(bin, ["--js-runtimes", `deno:${deno}`, ...args], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 300_000,
      })
      child.on("error", () => resolve(127))
      child.on("close", (code) => resolve(code ?? 1))
    })
}

type Meta = { title?: string; creator?: string; published?: string; description?: string }

const browserUa =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
// The v1 routes were proven with curl. Instagram and LinkedIn answer a curl user-agent with the tags we read.
const plainUa = "curl/8.7.1"
// Caption tracks, in order of preference. Never a bare `bn`: on most videos it is a machine
// translation, and YouTube answers those with HTTP 429.
const subLangs = ["en", "en-orig", "bn-orig"]

export async function fetchLinks(dumps: string[], tools: LinkTools): Promise<void> {
  for (const dump of dumps.filter((file) => !file.endsWith(".fetched.md"))) {
    const sidecar = dump.replace(/\.md$/, ".fetched.md")
    if (fs.existsSync(sidecar)) continue
    const url = urlOf(dump)
    if (url === undefined) continue
    const meta: Meta = {}
    let text = ""
    let why = ""
    try {
      text = await route(url, { tools, meta })
    } catch (error) {
      why = error instanceof Error ? error.message : String(error)
    }
    const status = /\S/.test(text) ? "fetched" : "unfetched"
    if (status === "unfetched") why ||= "no text"
    writeSidecar(sidecar, url, status, why, meta, text)
  }
}

type Ctx = { tools: LinkTools; meta: Meta }

async function route(url: string, ctx: Ctx): Promise<string> {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(url)
  if (!m) throw new Error("not a web link")
  const host = m[1].toLowerCase()
  const urlPath = m[2]
  if (/(?:^|\.)youtube\.com$|^youtu\.be$/.test(host)) return youtube(url, ctx)
  const status = /\/status(?:es)?\/(\d+)/.exec(urlPath)
  if (/(?:^|\.)(?:x|twitter|fxtwitter|vxtwitter|fixupx)\.com$/.test(host) && status) return xPost(status[1], ctx)
  if (host === "lnkd.in") return lnkdIn(url, ctx)
  if (/(?:^|\.)linkedin\.com$/.test(host)) {
    return urlPath.startsWith("/pulse/") ? linkedinPulse(url, ctx) : linkedinPost(url, ctx)
  }
  if (host === "podcasts.apple.com") return applePodcast(url, ctx)
  if (/(?:^|\.)(?:instagram|tiktok)\.com$/.test(host)) return caption(url, ctx)
  // ponytail: Spotify and other podcast apps take this route and come back unfetched with a title;
  // add an iTunes search by show name if the Owner shares them often.
  return article(url, ctx)
}

// Generic article or PDF: one fetch, then pdfjs or defuddle.
async function article(url: string, ctx: Ctx): Promise<string> {
  const page = await get(url, ctx, { ua: true })
  if (/application\/pdf/i.test(page.type) || page.bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return pdf(page.bytes)
  }
  const html = page.text()
  og(html, ctx.meta)
  if (/"isAccessibleForFree"\s*:\s*"?false/i.test(html)) throw new Error("paywall")
  return defuddle(html, url, ctx.meta)
}

async function pdf(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  const pages: string[] = []
  try {
    const doc = await task.promise
    for (let n = 1; n <= doc.numPages; n++) {
      const { items } = await (await doc.getPage(n)).getTextContent()
      pages.push(items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""))
    }
  } finally {
    await task.destroy()
  }
  const text = pages.join("\n\n")
  if (!/\w/.test(text)) throw new Error("pdf has no text")
  return text
}

async function defuddle(html: string, url: string, meta: Meta): Promise<string> {
  const { Defuddle } = await import("defuddle/node")
  // useAsync false: some extractors would call third-party APIs.
  const d = await Defuddle(html, url, { markdown: true, useAsync: false }).catch(() => {
    throw new Error("defuddle failed")
  })
  if (d.title) meta.title = d.title
  if (d.author) meta.creator = d.author
  if (d.published) meta.published = d.published
  if (d.description) meta.description = d.description
  if ((d.wordCount ?? 0) < 50) throw new Error("no readable text")
  return d.content
}

// YouTube: captions through yt-dlp (it needs deno), metadata from its info JSON.
async function youtube(url: string, ctx: Ctx): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-link-"))
  try {
    const v = path.join(dir, "v")
    // --ignore-errors: a failed caption track would otherwise stop the info JSON being written.
    // The exit code is non-zero also when one caption track fails, so the files decide.
    const code = await ctx.tools.ytDlp([
      "--ignore-errors", "--skip-download", "--ignore-no-formats-error", "--no-playlist", "--write-subs",
      "--write-auto-subs", "--sub-langs", subLangs.join(","), "--sub-format", "vtt", "--write-info-json",
      "-q", "--no-warnings", "-o", v, url,
    ])
    if (fs.existsSync(`${v}.info.json`)) {
      const info = JSON.parse(fs.readFileSync(`${v}.info.json`, "utf8"))
      ctx.meta.title = info.title
      ctx.meta.creator = info.channel ?? info.uploader
      ctx.meta.published = info.upload_date
      ctx.meta.description = info.description
    } else {
      try {
        const o = JSON.parse(
          (await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, ctx)).text(),
        )
        ctx.meta.title = o.title
        ctx.meta.creator = o.author_name
      } catch {
        // No title either; the sidecar keeps the URL.
      }
    }
    const vtt = subLangs.map((lang) => `${v}.${lang}.vtt`).find((file) => fs.existsSync(file))
    if (!vtt) throw new Error(code ? `yt-dlp exited ${code}` : "no captions")
    return subsText(fs.readFileSync(vtt, "utf8"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// X post or thread, unrolled by fxtwitter.
async function xPost(id: string, ctx: Ctx): Promise<string> {
  const d = JSON.parse((await get(`https://api.fxtwitter.com/2/thread/${id}`, ctx)).text())
  const s = d.status
  if (!s) throw new Error("post not found")
  ctx.meta.creator = `${s.author.name} (@${s.author.screen_name})`
  ctx.meta.title = `${s.author.name} on X`
  if (s.created_timestamp) ctx.meta.published = isoDay(s.created_timestamp)
  const posts: { text?: string }[] = d.thread?.length ? d.thread : [s]
  let text = posts.map((post) => post.text ?? "").join("\n\n")
  if (s.quote) text += `\n\nQuoting @${s.quote.author.screen_name}: ${s.quote.text}`
  return text
}

// lnkd.in answers 200 with an interstitial; the target is the external_url_click anchor.
async function lnkdIn(url: string, ctx: Ctx): Promise<string> {
  const html = (await get(url, ctx)).text()
  const anchor = /<a\b[^>]*external_url_click[^>]*>/.exec(html)?.[0]
  const target = anchor && /\bhref="([^"]+)"/.exec(anchor)?.[1]
  if (!target) throw new Error("no target on the lnkd.in page")
  return route(unhtml(target), ctx)
}

// LinkedIn post: one plain fetch with the query dropped (commentUrn kept); text from JSON-LD.
async function linkedinPost(url: string, ctx: Ctx): Promise<string> {
  const [base, query = ""] = url.split(/\?(.*)/s)
  const comment = /(?:^|&)(commentUrn=[^&#]*)/.exec(query)?.[1]
  const html = (await get(comment ? `${base}?${comment}` : base, ctx)).text()
  og(html, ctx.meta)
  delete ctx.meta.description // the post text again, plus a comment count
  const p = ld(html).find((o) => isType(o, ["SocialMediaPosting", "VideoObject", "Article"]))
  if (!p) throw new Error("no JSON-LD (private or deleted post?)")
  const who = p.creator ?? p.author // video posts use creator, not author
  if (who?.name) ctx.meta.creator = who.name
  ctx.meta.published = p.datePublished ?? p.uploadDate
  ctx.meta.title = p.headline ?? p.name ?? ctx.meta.title
  let text: string = p.articleBody ?? p.description ?? ""
  const shared = p.sharedContent
  if (shared && typeof shared === "object") {
    text += `\n\nRepost of ${shared.author?.name ?? "unknown"}:\n\n${shared.headline ?? ""}`
  }
  if (p.transcript) text += `\n\n## Transcript\n\n${p.transcript}`
  // Document post: the page's manifest names a JSON file with each page's text (undocumented, best-effort).
  const manifest = /manifestUrl&quot;:&quot;(.*?)&quot;/.exec(html)?.[1]
  if (manifest) {
    try {
      const m = JSON.parse((await get(unhtml(manifest), ctx)).text())
      const pages = JSON.parse((await get(m.transcriptManifestUrl, ctx)).text()).pages
      if (Array.isArray(pages) && pages.length > 0) text += `\n\n## Document\n\n${pages.join("\n\n")}`
    } catch {
      // The post text stands without the pages.
    }
  }
  return text
}

async function linkedinPulse(url: string, ctx: Ctx): Promise<string> {
  const html = (await get(url, ctx)).text()
  og(html, ctx.meta)
  const text = await defuddle(html, url, ctx.meta)
  const art = ld(html).find((o) => isType(o, ["Article"]))
  if (art) {
    // defuddle misreads the author on LinkedIn
    ctx.meta.title = art.name ?? ctx.meta.title
    if (art.author?.name) ctx.meta.creator = art.author.name
    ctx.meta.published = art.datePublished ?? ctx.meta.published
  }
  return text
}

// Apple Podcasts: the iTunes lookup gives the feed and the episode; then the feed's transcript.
async function applePodcast(url: string, ctx: Ctx): Promise<string> {
  const show = /\/id(\d+)/.exec(url)?.[1]
  if (!show) throw new Error("no show id in the link")
  const episode = /[?&]i=(\d+)/.exec(url)?.[1]
  const lookup = `https://itunes.apple.com/lookup?id=${show}&entity=podcastEpisode&limit=200`
  const results: Ld[] = JSON.parse((await get(lookup, ctx)).text()).results ?? []
  const pod = results.find((r) => r.wrapperType === "track")
  if (!pod) throw new Error("show not found on iTunes")
  ctx.meta.creator = pod.collectionName
  const e = episode && results.find((r) => String(r.trackId) === episode)
  if (!e) {
    ctx.meta.title = pod.collectionName
    throw new Error(episode ? "episode not in the iTunes lookup" : "show link, not an episode")
  }
  ctx.meta.title = e.trackName
  ctx.meta.published = e.releaseDate
  ctx.meta.description = e.description
  return podcastTranscript(pod.feedUrl, e.episodeGuid, ctx)
}

// ponytail: v1 ran yap (Mac only) on the MP3 when the feed has no transcript. The app has no
// cross-platform transcriber that takes hour-long audio, so the episode stays unfetched with its title.
async function podcastTranscript(feed: string | undefined, guid: string | undefined, ctx: Ctx): Promise<string> {
  const rss = feed ? (await get(feed, ctx)).text() : ""
  const item = (rss.match(/<item\b[\s\S]*?<\/item>/g) ?? []).find((i) => guid && unhtml(i).includes(guid)) ?? ""
  // [type, url] per <podcast:transcript>, VTT first and JSON last.
  const rank = (type: string) => (/vtt/.test(type) ? 0 : /json/.test(type) ? 2 : 1)
  const transcripts = (item.match(/<podcast:transcript\b[^>]*>/g) ?? [])
    .flatMap((tag) => {
      const u = /\burl="([^"]+)"/.exec(tag)?.[1]
      return u ? [{ type: /\btype="([^"]*)"/.exec(tag)?.[1] ?? "", url: unhtml(u) }] : []
    })
    .sort((a, b) => rank(a.type) - rank(b.type))
  const t = transcripts[0]
  if (!t) throw new Error("no transcript")
  const text = (await get(t.url, ctx)).text()
  if (!/json/.test(t.type)) return subsText(text) // VTT, SRT, HTML and plain text all reduce to lines
  const segments: { body?: string }[] = JSON.parse(text).segments ?? []
  return segments.flatMap((segment) => segment.body ?? []).join(" ")
}

// Instagram and TikTok: only the caption. Instagram gives og: tags to a plain user-agent only; TikTok
// gives none, but the page JSON holds the caption when fetched with a browser user-agent.
async function caption(link: string, ctx: Ctx): Promise<string> {
  const url = link.replace(/[?#].*/s, "")
  const tiktok = /tiktok\.com/i.test(url)
  const html = (await get(url, ctx, { ua: tiktok })).text()
  og(html, ctx.meta)
  if (tiktok) {
    const desc = /"desc":("(?:[^"\\]|\\.)+")/.exec(html)?.[1] // the first non-empty one is the video's
    if (desc) ctx.meta.description ??= JSON.parse(desc)
    const nickname = /"nickname":("(?:[^"\\]|\\.)+")/.exec(html)?.[1]
    if (nickname) {
      ctx.meta.creator = JSON.parse(nickname)
      ctx.meta.title = `${ctx.meta.creator} on TikTok`
    }
    const created = /"createTime":"?(\d+)/.exec(html)?.[1]
    if (created) ctx.meta.published = isoDay(Number(created))
  }
  const text = ctx.meta.description
  delete ctx.meta.description
  if (text === undefined) throw new Error("no caption")
  return text
}

type Got = { bytes: Buffer; type: string; text: () => string }

// One GET. Throws on a network failure or an HTTP error.
async function get(url: string, ctx: Ctx, options: { ua?: boolean } = {}): Promise<Got> {
  let response: Response
  let bytes: Buffer
  try {
    response = await ctx.tools.fetch(url, {
      headers: { "user-agent": options.ua ? browserUa : plainUa },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    })
    bytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    throw new Error(`fetch failed${code ? ` (${code})` : ""}`)
  }
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
  return { bytes, type: response.headers.get("content-type") ?? "", text: () => bytes.toString("utf8") }
}

// og:title and og:description (or the plain description and <title>), never overriding a value already found.
function og(html: string, meta: Meta): void {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)/i.exec(tag)?.[1].toLowerCase()
    const value = (/\bcontent\s*=\s*"([^"]*)"/i.exec(tag) ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag))?.[1]
    if (key === undefined || value === undefined) continue
    if (key === "og:title") meta.title ??= unhtml(value)
    if (key === "description" || key === "og:description") meta.description ??= unhtml(value)
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  if (title !== undefined) meta.title ??= unhtml(title)
}

function writeSidecar(file: string, url: string, status: string, why: string, meta: Meta, text: string): void {
  const flat: Meta = {}
  for (const key of ["title", "creator", "published", "description"] as const) {
    // Values come from parsed JSON, so a number (or worse) can turn up where a string belongs.
    const value = String(meta[key] ?? "").replace(/\s+/g, " ").trim()
    if (value) flat[key] = value
  }
  if (flat.description) flat.description = Array.from(flat.description).slice(0, 500).join("")
  const date = flat.published && /^(\d{4})-?(\d\d)-?(\d\d)/.exec(flat.published)
  let fm = `---\nurl: ${JSON.stringify(url)}\nstatus: ${status}\n`
  if (status === "unfetched") fm += `reason: ${JSON.stringify(why)}\n`
  if (date) fm += `published: ${date[1]}-${date[2]}-${date[3]}\n`
  for (const key of ["title", "creator", "description"] as const) {
    if (flat[key]) fm += `${key}: ${JSON.stringify(flat[key])}\n`
  }
  const content = `${fm}---\n${status === "fetched" ? `${text.trim()}\n` : ""}`
  // Write then rename: a half-written sidecar would stop the link from ever being fetched.
  fs.writeFileSync(`${file}.tmp`, content)
  fs.renameSync(`${file}.tmp`, file)
}

// Parsed JSON from a page or an API: whatever shape the site sends.
type Ld = Record<string, any>

function ld(html: string): Ld[] {
  const out: unknown[] = []
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let d: unknown
    try {
      d = JSON.parse(m[1])
    } catch {
      continue
    }
    for (const o of Array.isArray(d) ? d : [d]) {
      out.push(...(o && typeof o === "object" && Array.isArray(o["@graph"]) ? o["@graph"] : [o]))
    }
  }
  return out.filter((o): o is Ld => !!o && typeof o === "object" && !Array.isArray(o))
}

function isType(o: Ld, types: string[]): boolean {
  return [o["@type"]].flat().some((t) => types.includes(t))
}

// Caption or transcript text: no header, cue numbers, timings, tags or rolling repeats.
function subsText(subs: string): string {
  const out: string[] = []
  for (const raw of subs.split(/\r?\n/)) {
    if (/-->/.test(raw) || /^\d+$/.test(raw) || /^(?:WEBVTT|Kind:|Language:|NOTE\b)/.test(raw)) continue
    const line = unhtml(raw.replace(/<[^>]*>/g, "")).trim()
    if (line !== "" && line !== out.at(-1)) out.push(line)
  }
  return out.join("\n")
}

function isoDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

function urlOf(dump: string): string | undefined {
  const lines = fs.readFileSync(dump, "utf8").split(/\r?\n/)
  if (!/^---\s*$/.test(lines[0] ?? "")) return undefined
  for (const line of lines.slice(1)) {
    if (/^---\s*$/.test(line)) return undefined
    const m = /^url:\s*(\S.*?)\s*$/.exec(line)
    if (m) return m[1].replace(/^(["'])(.*)\1$/, "$2")
  }
  return undefined
}

function unhtml(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
  return s
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => char(parseInt(hex, 16), entity))
    .replace(/&#(\d+);/g, (entity, dec: string) => char(Number(dec), entity))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => named[name])
}

function char(code: number, entity: string): string {
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity
}
