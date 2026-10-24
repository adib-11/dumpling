const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { fetchLinks, ytDlpAt } = require("../dist/fetch-link")

// Runs the link fetcher on one real URL per route (plus a 404 and a paywall) and prints each sidecar's
// status, reason, title and word count. Needs the network, `npm run build` and `node scripts/fetch-yt-dlp.js`;
// rerun when yt-dlp or a site changes. Not part of `npm test`.
// Run: node scripts/fetch-link-live.js
const urls = {
  article: "https://paulgraham.com/greatwork.html",
  pdf: "https://arxiv.org/pdf/1706.03762",
  youtube: "https://youtu.be/arj7oStGLkU?si=share",
  x: "https://x.com/jack/status/20?s=46",
  "podcast-transcript":
    "https://podcasts.apple.com/us/podcast/podcast-hosts-are-your-friends-but-better/id1325018583?i=1000796562231",
  "podcast-no-transcript": "https://podcasts.apple.com/us/podcast/trumps-midterm-travel/id1222114325?i=1000796470412",
  instagram: "https://www.instagram.com/p/BsOGulcndj-/?igsh=share",
  tiktok: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
  "linkedin-iphone":
    "https://www.linkedin.com/posts/yuriiveremchuk_linkedin-gets-rid-of-carousels-heres-what-activity-7130176643926474752-teuh?utm_source=share&utm_medium=member_ios&rcm=ACoAAA",
  "linkedin-video":
    "https://www.linkedin.com/posts/reidhoffman_a-few-weeks-ago-i-went-to-linkedin-to-source-activity-7338958271199813634-V-nP",
  "linkedin-document": "https://www.linkedin.com/feed/update/urn:li:ugcPost:6997236318300762112/",
  "linkedin-repost":
    "https://www.linkedin.com/posts/matthewhuntme_the-ultimate-linkedin-post-swipe-file-activity-7035342118554394624-XI0Y",
  "lnkd.in": "https://lnkd.in/dByEzTE9",
  "linkedin-pulse":
    "https://www.linkedin.com/pulse/my-new-deadline-20-years-give-away-virtually-all-wealth-bill-gates-zlybc",
  404: "https://example.com/does-not-exist",
  paywall: "https://www.lennysnewsletter.com/p/how-to-tell-if-a-startup-has-a-moat",
  "bot-blocked": "https://www.nytimes.com/2026/10/14/technology/anthropic-ipo-revenue-profit.html",
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-link-live-"))
  try {
    const exe = process.platform === "win32" ? ".exe" : ""
    const vendor = path.join(__dirname, "..", "vendor")
    const dumps = Object.entries(urls).map(([name, url]) => {
      const file = path.join(dir, `${name}.md`)
      fs.writeFileSync(file, `---\nurl: ${url}\n---\n${url}\n`)
      return file
    })
    await fetchLinks(dumps, {
      fetch,
      ytDlp: ytDlpAt(path.join(vendor, "yt-dlp", `yt-dlp${exe}`), path.join(vendor, "deno", `deno${exe}`)),
    })
    for (const name of Object.keys(urls)) {
      const sidecar = fs.readFileSync(path.join(dir, `${name}.fetched.md`), "utf8")
      const [, head = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(sidecar) ?? []
      const field = (key) => new RegExp(`^${key}: (.*)$`, "m").exec(head)?.[1] ?? ""
      const words = body.split(/\s+/).filter(Boolean).length
      console.log(
        `${name.padEnd(22)} ${field("status").padEnd(9)} ${String(words).padStart(6)} words  ${field("reason")} ${field("title")}`,
      )
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
