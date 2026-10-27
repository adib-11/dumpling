const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { createSecondBrain } = require("../dist/create-second-brain")
const { freeEngine, keyEngine, keyProviders } = require("../dist/engine")
const { ingestNow, spawnOpencode } = require("../dist/ingest-now")

// Runs the real ingest skill on tests/fixtures/ingest/ with one model, then makes the checks of
// tests/ingest-fixtures.sh in adib-11/second-brain and prints the pass rate. The scratch brain is kept for a
// reviewer to read the Pages. Needs the network, `npm run build` and `node scripts/fetch-opencode.js`; a
// Key Engine's model needs its provider's key in the env (OPENAI_API_KEY,
// GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY or OPENROUTER_API_KEY). Not part of `npm test`.
// Run: node scripts/ingest-fixtures.js opencode/glm-5.3-flash-free
const model = process.argv[2]
if (!model) {
  console.error("usage: node scripts/ingest-fixtures.js <provider/model>")
  process.exit(2)
}
const root = path.join(__dirname, "..")
const fixtures = path.join(root, "tests", "fixtures", "ingest")
const bin = path.join(root, "vendor", "opencode", process.platform === "win32" ? "opencode.exe" : "opencode")
// A Key Engine's model takes its key from that provider's env variable, as the app passes it.
const provider = Object.keys(keyProviders).find((id) => keyProviders[id].model.split("/")[0] === model.split("/")[0])
const engine = provider
  ? { ...keyEngine(provider, process.env[keyProviders[provider].env] ?? ""), models: [model] }
  : { ...freeEngine, models: [model] }

async function main() {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-fixtures-"))
  await createSecondBrain(brain, path.join(root, "templates"))
  for (const name of fs.readdirSync(fixtures)) fs.copyFileSync(path.join(fixtures, name), path.join(brain, "inbox", name))
  const started = Date.now()
  const result = await ingestNow({ brain, engine, runner: (run) => spawnOpencode(bin, run), notify: console.log })
  const minutes = ((Date.now() - started) / 60000).toFixed(1)

  const wikiDir = path.join(brain, "vault", "wiki")
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "")
  const raw = (name) => path.join(brain, "vault", "raw", name.slice(0, 4), name.slice(5, 7), `${name}.md`)
  const pages = (dir, skip = []) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { recursive: true, encoding: "utf8" })
          .filter((name) => name.endsWith(".md") && !skip.some((s) => name.startsWith(s)))
          .map((name) => path.join(dir, name))
      : []
  const wiki = pages(wikiDir, ["digests"])
  const citing = (sub, name) => pages(path.join(wikiDir, sub)).filter((file) => read(file).includes(`[[${name}`))
  const log = read(path.join(wikiDir, "log.md"))
  const logEntry = (name) => log.split(/^(?=## \[)/m).filter((entry) => entry.includes(`Raw: [[${name}]]`)).join("")
  const names = fs
    .readdirSync(fixtures)
    .filter((name) => name.endsWith(".md") && !name.endsWith(".fetched.md"))
    .map((name) => name.slice(0, -3))

  const checks = []
  const check = (label, ok) => checks.push([label, Boolean(ok)])
  check("ingest succeeded", result.status === "ok")
  check("inbox empty", fs.readdirSync(path.join(brain, "inbox")).every((name) => name === "failed" || name === ".gitkeep"))
  for (const name of names) {
    check(`filed Dump unchanged: ${name}`, read(path.join(fixtures, `${name}.md`)) === read(raw(name)))
    check(`log.md entry: ${name}`, log.includes(`- Raw: [[${name}]]`))
  }
  const cites = new Set()
  for (const file of wiki) {
    for (const match of read(file).matchAll(/\[\[(\d{4}-\d\d-\d\d-\d{6}-[a-z]+)(\|[^\]]*)?\]\]/g)) cites.add(match[1])
  }
  for (const cite of cites) check(`citation resolves: ${cite}`, fs.existsSync(raw(cite)))
  const misquoted = []
  const unglossed = []
  for (const file of wiki.filter((f) => path.basename(f) !== "log.md")) {
    for (const line of read(file).split("\n")) {
      const cited = /\[\[(\d{4}-\d\d-\d\d-\d{6}-[a-z]+)\|/.exec(line)
      if (cited) {
        const src = read(raw(cited[1])) + read(raw(cited[1]).replace(/\.md$/, ".fetched.md"))
        for (const quote of line.matchAll(/"([^"]{4,})"/g)) if (!src.includes(quote[1])) misquoted.push(`${file}: ${quote[1]}`)
      }
      for (const quote of line.matchAll(/"([^"]*\p{Script=Bengali}[^"]*)"( *\[)?/gu)) {
        if (!quote[2]) unglossed.push(`${file}: ${quote[1]}`)
      }
    }
  }
  check("quotes are verbatim", misquoted.length === 0)
  check("Bangla quotes have an English gloss", unglossed.length === 0)
  const anyWiki = (needle) => wiki.some((file) => read(file).includes(needle))
  const newTags = [...log.matchAll(/new tag ([a-z0-9-]+)/g)].map((m) => m[1])
  check("empty Dump is no material", log.includes("ingest | no material: 2026-10-10-010203-iphone"))
  check("failed bare link is no material", log.includes("ingest | no material: 2026-10-05-221500-iphone"))
  check(
    "unfetched link with a comment gets the callout",
    citing("works", "2026-10-13-080000-iphone").some((f) => read(f).includes("[!warning] Unfetched")),
  )
  check("relative date resolved", citing("people", "2026-10-02-213000-mac").some((f) => read(f).includes("2026-10-01")))
  check("changed fact keeps the old one", citing("people", "2026-10-09-190500-iphone").some((f) => read(f).includes("Pathao")))
  check(
    "Open threads listed",
    read(path.join(wikiDir, "open-threads.md")).split("\n").filter((l) => l.includes("[[2026-10-03-073000-iphone")).length >= 2,
  )
  check("re ... Addendum matched", logEntry("2026-10-08-093000-mac").includes("2026-10-02-213000-mac"))
  check("Addendum cited as Addendum", anyWiki("[[2026-10-07-200000-iphone|Addendum 7 Oct]]"))
  check("self-observation's full quote on me.md", read(path.join(wikiDir, "me.md")).includes("calmer in the mornings, I think. I"))
  const selfTopics = citing("topics", "2026-10-06-064500-iphone")
  check(
    "self-observation's topic gets only the fragment",
    selfTopics.length > 0 && selfTopics.every((f) => !read(f).includes("snap at people")),
  )
  check(
    "Addendum Take outdates or is flagged unsure",
    citing("works", "2026-10-07-200000-iphone").some((f) => read(f).includes("[!note]- Earlier take")) ||
      logEntry("2026-10-07-200000-iphone").includes("unsure Take"),
  )
  check("a recommendation alone earns no Page", citing("works", "2026-10-08-093000-mac").length === 0)
  check("each new tag flagged once", new Set(newTags).size === newTags.length)
  check("screenshot of text not embedded", !anyWiki("![[2026-10-12-163000-iphone.jpg"))
  check("bare shared link is a work", citing("works", "2026-10-04-120000-iphone").length > 0)

  for (const [label, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${label}`)
  for (const line of [...misquoted, ...unglossed]) console.log(`     ${line}`)
  const passed = checks.filter(([, ok]) => ok).length
  console.log(`\n${model}: ${passed}/${checks.length} checks passed, ${result.dumps} Dumps filed, ${minutes} min`)
  console.log(`status ${result.status}${result.reason ? ` (${result.reason})` : ""}, cost $${result.cost.toFixed(4)}`)
  console.log(`Scratch brain: ${brain}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
