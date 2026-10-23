import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fetchLinks, type LinkTools } from "../src/fetch-link"

// Ported from tests/fetch-link.sh in adib-11/second-brain. HTTP and yt-dlp are fakes; defuddle and
// pdfjs-dist are the real ones, so no test touches the network.

type Page = { status?: number; type?: string; body: string | Uint8Array<ArrayBuffer> }

const inbox = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-link-"))
const web = new Map<string, Page>()
const calls: { url: string; ua: string }[] = []
const ytCalls: string[][] = []
// Files yt-dlp writes beside its -o template, by suffix (".info.json", ".en.vtt"); null means it fails.
let youtube: Record<string, string> | null = null

const tools: LinkTools = {
  fetch: async (url, init) => {
    const ua = new Headers(init?.headers).get("user-agent") ?? ""
    calls.push({ url, ua })
    const page = web.get(url)
    if (!page) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })
    return new Response(page.body, {
      status: page.status ?? 200,
      headers: { "content-type": page.type ?? "text/html" },
    })
  },
  ytDlp: async (args) => {
    ytCalls.push(args)
    const template = args[args.indexOf("-o") + 1]
    if (!youtube) return 1
    for (const [suffix, text] of Object.entries(youtube)) fs.writeFileSync(template + suffix, text)
    return 0
  },
}

function dump(name: string, url: string): string {
  const file = path.join(inbox, `${name}.md`)
  fs.writeFileSync(file, `---\ncaptured: x\ndevice: iphone\nkind: link\nurl: ${url}\n---\n${url}\n`)
  return file
}

async function fetchDump(name: string, url: string): Promise<string> {
  await fetchLinks([dump(name, url)], tools)
  return side(name)
}

function side(name: string): string {
  return fs.readFileSync(path.join(inbox, `${name}.fetched.md`), "utf8")
}

function body(sidecar: string): string {
  return sidecar.replace(/^---\n[\s\S]*?\n---\n/, "")
}

function lines(sidecar: string): string[] {
  return sidecar.split("\n")
}

const words = "Rest is not the absence of work but a part of it. ".repeat(8)
web.set("https://example.com/rest", {
  type: "text/html; charset=utf-8",
  body: `<html><head><title>Deep Rest | Example</title>
<meta property="og:title" content="Deep Rest">
<meta name="author" content="Mira Hossain">
<meta property="article:published_time" content="2026-09-28T08:00:00Z">
<meta name="description" content="On rest."></head>
<body><article><h1>Deep Rest</h1><p>Rest is part of the work.</p><p>${words}</p></article></body></html>`,
})

test("article: fetched with defuddle's text and metadata", async () => {
  const s = await fetchDump("a1", "https://example.com/rest")
  const l = lines(s)
  assert.ok(l.includes("status: fetched"), s)
  assert.ok(l.includes('url: "https://example.com/rest"'))
  assert.ok(l.includes('title: "Deep Rest"'))
  assert.ok(l.includes('creator: "Mira Hossain"'))
  assert.ok(l.includes("published: 2026-09-28"))
  assert.ok(l.includes('description: "On rest."'))
  assert.ok(lines(body(s)).includes("Rest is part of the work."))
  assert.match(calls.at(-1)?.ua ?? "", /Mozilla/)
})

test("paywall: unfetched with the og: title and description, no body", async () => {
  web.set("https://news.example.com/paid", {
    body: `<meta property="og:title" content="Dhaka&#39;s metro is not enough" />
<meta name="description"
  content="The new lines carry thousands.">
<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>`,
  })
  const s = await fetchDump("a2", "https://news.example.com/paid")
  const l = lines(s)
  assert.ok(l.includes("status: unfetched"), s)
  assert.ok(l.includes('reason: "paywall"'))
  assert.ok(l.includes(`title: "Dhaka's metro is not enough"`))
  assert.ok(l.includes('description: "The new lines carry thousands."'))
  assert.equal(body(s), "")
})

test("404 and an unreachable host: unfetched with the reason", async () => {
  web.set("https://example.com/missing", { status: 404, body: "gone" })
  await fetchLinks([dump("a3", "https://example.com/missing"), dump("a4", "https://unreachable.example/x")], tools)
  assert.ok(lines(side("a3")).includes('reason: "HTTP 404"'), side("a3"))
  assert.ok(lines(side("a4")).includes("status: unfetched"))
  assert.ok(lines(side("a4")).includes('reason: "fetch failed (ENOTFOUND)"'), side("a4"))
})

test("no readable text: unfetched, keeping the page title", async () => {
  web.set("https://open.spotify.com/episode/abc", { body: "<title>Spotify – Web Player</title>" })
  const s = await fetchDump("a5", "https://open.spotify.com/episode/abc")
  const l = lines(s)
  assert.ok(l.includes("status: unfetched"), s)
  assert.ok(l.includes('reason: "no readable text"'))
  assert.ok(l.includes('title: "Spotify – Web Player"'))
})

// A one-page PDF with one line of Helvetica text.
function pdf(text: string): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let out = "%PDF-1.4\n"
  const offsets = objects.map((object, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${object}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

test("pdf: the text, by content type or by the %PDF- header", async () => {
  web.set("https://arxiv.org/pdf/1", { type: "application/pdf", body: pdf("The paper text.") })
  web.set("https://example.com/paper", { type: "application/octet-stream", body: pdf("Served as bytes.") })
  await fetchLinks([dump("p1", "https://arxiv.org/pdf/1"), dump("p2", "https://example.com/paper")], tools)
  assert.ok(lines(side("p1")).includes("status: fetched"), side("p1"))
  assert.equal(body(side("p1")), "The paper text.\n")
  assert.equal(body(side("p2")), "Served as bytes.\n")
})

test("youtube: caption text without timings, tags or rolling repeats, metadata from the info JSON", async () => {
  youtube = {
    ".info.json":
      '{"title":"Inside the Mind","channel":"TED","upload_date":"20160406","description":"Tim Urban\\nknows procrastination."}',
    ".en.vtt": `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:02.000 align:start position:0%
so<00:00:01.500><c> in</c><c> college</c>

00:00:02.000 --> 00:00:03.000
so in college
I was a government major

1
00:00:03.000 --> 00:00:04.000
I was a government major
`,
  }
  const s = await fetchDump("y1", "https://youtu.be/arj7oStGLkU?si=share")
  youtube = null
  const l = lines(s)
  assert.equal(body(s), "so in college\nI was a government major\n")
  assert.ok(l.includes('title: "Inside the Mind"'), s)
  assert.ok(l.includes('creator: "TED"'))
  assert.ok(l.includes("published: 2016-04-06"))
  assert.ok(l.includes('description: "Tim Urban knows procrastination."'))
  const args = ytCalls.at(-1) ?? []
  assert.ok(args.includes("--skip-download") && args.includes("--write-auto-subs"))
  assert.equal(args.at(-1), "https://youtu.be/arj7oStGLkU?si=share")
})

test("youtube without captions: unfetched, title from oEmbed", async () => {
  web.set(
    "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dnocaptions",
    { type: "application/json", body: '{"title":"Some video","author_name":"Someone"}' },
  )
  const s = await fetchDump("y2", "https://www.youtube.com/watch?v=nocaptions")
  const l = lines(s)
  assert.ok(l.includes("status: unfetched"), s)
  assert.ok(l.includes('reason: "yt-dlp exited 1"'))
  assert.ok(l.includes('title: "Some video"'))
  assert.ok(l.includes('creator: "Someone"'))
})

test("x: the self-thread through fxtwitter, with author and date", async () => {
  web.set("https://api.fxtwitter.com/2/thread/20", {
    type: "application/json",
    body: '{"code":200,"status":{"text":"first","created_timestamp":1760000000,"author":{"name":"Jack","screen_name":"jack"},"quote":{"text":"quoted","author":{"screen_name":"ev"}}},"thread":[{"text":"first"},{"text":"second"}]}',
  })
  const s = await fetchDump("x1", "https://x.com/jack/status/20?s=46&t=abc")
  const l = lines(s)
  assert.ok(l.includes("status: fetched"), s)
  assert.ok(l.includes('creator: "Jack (@jack)"'))
  assert.ok(l.includes('title: "Jack on X"'))
  assert.ok(l.includes("published: 2025-10-09"))
  assert.equal(body(s), "first\n\nsecond\n\nQuoting @ev: quoted\n")
})

test("linkedin post from the iPhone app: query dropped, JSON-LD text, author and date", async () => {
  web.set("https://www.linkedin.com/posts/someone_slug-activity-7130176643926474752-teuh", {
    body: `<meta property="og:title" content="LinkedIn gets rid of… | Yurii">
<script type="application/ld+json">
  {"@context":"http://schema.org","@type":"SocialMediaPosting","headline":"LinkedIn gets rid of Carousels!","datePublished":"2023-11-14T12:56:24.162Z","articleBody":"LinkedIn gets rid of Carousels!\\nHere's what to do.","author":{"@type":"Person","name":"Yurii Veremchuk"}}
</script>`,
  })
  const s = await fetchDump(
    "l1",
    "https://www.linkedin.com/posts/someone_slug-activity-7130176643926474752-teuh?utm_source=share&utm_medium=member_ios&rcm=ACoAAB",
  )
  const l = lines(s)
  assert.equal(calls.at(-1)?.url, "https://www.linkedin.com/posts/someone_slug-activity-7130176643926474752-teuh")
  assert.doesNotMatch(calls.at(-1)?.ua ?? "", /Mozilla/)
  assert.ok(l.includes('creator: "Yurii Veremchuk"'), s)
  assert.ok(l.includes("published: 2023-11-14"))
  assert.ok(l.includes('title: "LinkedIn gets rid of Carousels!"'))
  assert.ok(lines(body(s)).includes("Here's what to do."))
})

test("linkedin repost, video, document post, comment link and 404", async () => {
  web.set("https://www.linkedin.com/feed/update/urn:li:activity:1/?commentUrn=urn%3Ali%3Acomment%3A(1,2)", {
    body: `<script type="application/ld+json">{"@type":"SocialMediaPosting","datePublished":"2024-01-02T00:00:00Z","author":{"name":"Reposter"},"sharedContent":{"headline":"The original words.","author":{"name":"Original Author"}}}</script>`,
  })
  web.set("https://www.linkedin.com/posts/video-activity-2", {
    body: `<script type="application/ld+json">{"@type":"VideoObject","name":"A talk","description":"Post text.","transcript":"Spoken words.","creator":{"name":"Reid"},"uploadDate":"2025-06-01T00:00:00Z"}</script>`,
  })
  web.set("https://ee.linkedin.com/posts/doc-activity-3", {
    body: `<script type="application/ld+json">{"@type":"SocialMediaPosting","articleBody":"Caption.","author":{"name":"Matt"},"datePublished":"2022-11-12T00:00:00Z"}</script>
<code>{&quot;manifestUrl&quot;:&quot;https://media.licdn.com/manifest?e=1&amp;t=x&quot;}</code>`,
  })
  web.set("https://media.licdn.com/manifest?e=1&t=x", {
    type: "application/json",
    body: '{"transcriptManifestUrl":"https://media.licdn.com/transcript"}',
  })
  web.set("https://media.licdn.com/transcript", {
    type: "application/json",
    body: '{"pages":["Page one text.","Page two text."]}',
  })
  web.set("https://www.linkedin.com/posts/private-activity-4", { status: 404, body: "not found" })
  await fetchLinks(
    [
      dump(
        "l2",
        "https://www.linkedin.com/feed/update/urn:li:activity:1/?commentUrn=urn%3Ali%3Acomment%3A(1,2)&utm_source=share",
      ),
      dump("l3", "https://www.linkedin.com/posts/video-activity-2"),
      dump("l4", "https://ee.linkedin.com/posts/doc-activity-3"),
      dump("l5", "https://www.linkedin.com/posts/private-activity-4"),
    ],
    tools,
  )
  assert.ok(lines(side("l2")).includes('creator: "Reposter"'), side("l2"))
  assert.equal(body(side("l2")), "Repost of Original Author:\n\nThe original words.\n")
  const l3 = side("l3")
  assert.ok(lines(l3).includes('creator: "Reid"'), l3)
  assert.ok(lines(l3).includes("published: 2025-06-01"))
  assert.equal(body(l3), "Post text.\n\n## Transcript\n\nSpoken words.\n")
  assert.equal(body(side("l4")), "Caption.\n\n## Document\n\nPage one text.\n\nPage two text.\n")
  assert.ok(lines(side("l5")).includes('reason: "HTTP 404"'), side("l5"))
})

test("lnkd.in: the target is read off the interstitial and fetched by its own route", async () => {
  web.set("https://lnkd.in/dByEzTE9", {
    body: `<a class="artdeco-button" data-tracking-control-name="external_url_click" data-tracking-will-navigate href="https://example.com/rest?a=1&amp;b=2">go</a>`,
  })
  const rest = web.get("https://example.com/rest")
  assert.ok(rest)
  web.set("https://example.com/rest?a=1&b=2", rest)
  const s = await fetchDump("k1", "https://lnkd.in/dByEzTE9")
  assert.equal(calls.at(-1)?.url, "https://example.com/rest?a=1&b=2")
  assert.ok(lines(s).includes('title: "Deep Rest"'), s)
  assert.ok(lines(s).includes('url: "https://lnkd.in/dByEzTE9"'))
})

test("linkedin pulse: body from defuddle, title, author and date from JSON-LD", async () => {
  web.set("https://www.linkedin.com/pulse/my-new-deadline-bill-gates-zlybc", {
    body: `<html><head><title>My new deadline | LinkedIn</title>
<meta name="author" content="403 Articles">
<script type="application/ld+json">{"@type":"Article","name":"My new deadline","author":{"name":"Bill Gates"},"datePublished":"2025-05-08T00:00:00Z"}</script>
</head><body><article><p>The article body.</p><p>${words}</p></article></body></html>`,
  })
  const s = await fetchDump("u1", "https://www.linkedin.com/pulse/my-new-deadline-bill-gates-zlybc")
  const l = lines(s)
  assert.ok(l.includes('creator: "Bill Gates"'), s)
  assert.ok(l.includes('title: "My new deadline"'))
  assert.ok(l.includes("published: 2025-05-08"))
  assert.ok(lines(body(s)).includes("The article body."))
})

test("instagram: the caption from og: tags, with a plain user-agent", async () => {
  web.set("https://www.instagram.com/p/abc/", {
    body: '<meta property="og:title" content="Chef on Instagram"><meta property="og:description" content="12 likes - chef: &quot;Salt early.&quot;">',
  })
  const s = await fetchDump("i1", "https://www.instagram.com/p/abc/?igsh=xyz")
  assert.ok(lines(s).includes("status: fetched"), s)
  assert.ok(lines(s).includes('title: "Chef on Instagram"'))
  assert.equal(body(s), '12 likes - chef: "Salt early."\n')
  assert.equal(calls.at(-1)?.url, "https://www.instagram.com/p/abc/")
  assert.doesNotMatch(calls.at(-1)?.ua ?? "", /Mozilla/)
})

test("tiktok: the caption from the page JSON, with a browser user-agent", async () => {
  web.set("https://www.tiktok.com/@scout2015/video/6718335390845095173", {
    body: '<title>TikTok - Make Your Day</title><script>{"desc":"","x":{"createTime":"1564234358","desc":"Scramble \\u0026 guess \\"it\\"","author":{"nickname":"Scout"}}}</script>',
  })
  const s = await fetchDump("i2", "https://www.tiktok.com/@scout2015/video/6718335390845095173?_r=1&_t=x")
  const l = lines(s)
  assert.ok(l.includes("status: fetched"), s)
  assert.ok(l.includes('title: "Scout on TikTok"'))
  assert.ok(l.includes('creator: "Scout"'))
  assert.ok(l.includes("published: 2019-07-27"))
  assert.equal(body(s), 'Scramble & guess "it"\n')
  assert.match(calls.at(-1)?.ua ?? "", /Mozilla/)
})

test("apple podcasts: the feed's transcript, VTT preferred; no transcript is unfetched with the episode", async () => {
  web.set("https://itunes.apple.com/lookup?id=1434243584&entity=podcastEpisode&limit=200", {
    type: "application/json",
    body: JSON.stringify({
      results: [
        { wrapperType: "track", collectionName: "The Show", feedUrl: "https://feed.example/rss" },
        {
          wrapperType: "podcastEpisode",
          trackId: 1000786117598,
          trackName: "#501 – DHH",
          releaseDate: "2026-08-26T21:47:04Z",
          episodeGuid: "https://show.example/?p=6506",
          episodeUrl: "https://cdn.example/501.mp3",
        },
        {
          wrapperType: "podcastEpisode",
          trackId: 7,
          trackName: "#7 – No transcript",
          releaseDate: "2026-01-01T00:00:00Z",
          description: "An episode.",
          episodeGuid: "guid-7",
          episodeUrl: "https://cdn.example/7.mp3",
        },
      ],
    }),
  })
  web.set("https://feed.example/rss", {
    type: "application/rss+xml",
    body: `<rss><channel><language>en-us</language>
<item><title>#501 – DHH</title><guid isPermaLink="false">https://show.example/?p=6506</guid>
<podcast:transcript url="https://show.example/501.json" type="application/json" />
<podcast:transcript url="https://show.example/501.vtt" type="text/vtt" />
<enclosure url="https://cdn.example/501.mp3" type="audio/mpeg" /></item>
<item><title>#7</title><guid>guid-7</guid><enclosure url="https://cdn.example/7.mp3" type="audio/mpeg"/></item>
</channel></rss>`,
  })
  web.set("https://show.example/501.vtt", {
    type: "text/vtt",
    body: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v DHH>Ruby is a joy.",
  })
  await fetchLinks(
    [
      dump("c1", "https://podcasts.apple.com/us/podcast/501-dhh/id1434243584?i=1000786117598"),
      dump("c2", "https://podcasts.apple.com/us/podcast/7/id1434243584?i=7"),
    ],
    tools,
  )
  const c1 = side("c1")
  assert.ok(lines(c1).includes("status: fetched"), c1)
  assert.ok(lines(c1).includes('title: "#501 – DHH"'))
  assert.ok(lines(c1).includes('creator: "The Show"'))
  assert.ok(lines(c1).includes("published: 2026-08-26"))
  assert.equal(body(c1), "Ruby is a joy.\n")
  assert.ok(!calls.some((call) => call.url.endsWith("501.json")))
  const c2 = side("c2")
  assert.ok(lines(c2).includes("status: unfetched"), c2)
  assert.ok(lines(c2).includes('reason: "no transcript"'))
  assert.ok(lines(c2).includes('title: "#7 – No transcript"'))
  assert.ok(lines(c2).includes('description: "An episode."'))
  assert.ok(!calls.some((call) => call.url.endsWith(".mp3")))
})

test("never re-fetch a Dump with a sidecar; no url, no sidecar; sidecars are not Dumps", async () => {
  const all = fs.readdirSync(inbox).map((name) => path.join(inbox, name))
  assert.ok(all.some((file) => file.endsWith(".fetched.md")))
  const before = { http: calls.length, yt: ytCalls.length }
  const text = path.join(inbox, "t1.md")
  fs.writeFileSync(text, "---\ncaptured: x\nkind: text\n---\njust words\n")
  await fetchLinks([...all, text], tools)
  assert.deepEqual({ http: calls.length, yt: ytCalls.length }, before)
  assert.equal(fs.existsSync(path.join(inbox, "t1.fetched.md")), false)
  assert.equal(fs.existsSync(path.join(inbox, "a1.fetched.fetched.md")), false)
})
