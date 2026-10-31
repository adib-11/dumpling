import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { listPages, readPage, searchPages } from "../src/pages"

function brainWith(pages: Record<string, string>): string {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "pages-"))
  for (const [file, text] of Object.entries(pages)) {
    const target = path.join(brain, "vault", "wiki", file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  return brain
}

const rahim = `---
type: person
aliases:
  - রহিম
tags: [family]
summary: My cousin in Dhaka.
updated: 2026-10-02
---

# রহিম

## Timeline

- 2026-09-13: Watched [[dune-part-two|Dune: Part Two]] with him. ([[2026-09-14-231000-iphone|Dump 14 Sep]])
`

const dune = `---
type: work
aliases:
  - "Dune: Part Two"
summary: Film, 2024.
---

# Dune: Part Two

## What I think

- 2026-09-14: "the sound design alone is worth the ticket" ([[2026-09-14-231000-iphone|Dump 14 Sep]])
`

test("listPages groups Pages by kind, in the order of the five kinds, with me last", () => {
  const brain = brainWith({
    "works/dune-part-two.md": dune,
    "people/rahim.md": rahim,
    "people/nadia.md": "---\ntype: person\n---\n\nNo heading here.\n",
    "me.md": "---\ntype: person\nsummary: Self-observations.\n---\n\n# Me\n",
    "index.md": "# Index\n",
    "log.md": "# Log\n",
    "open-threads.md": "# Open threads\n",
    "topics/notes.txt": "not a Page",
  })

  assert.deepEqual(listPages(brain), [
    {
      kind: "people",
      pages: [
        { id: "people/nadia", kind: "people", title: "nadia", summary: "" },
        { id: "people/rahim", kind: "people", title: "রহিম", summary: "My cousin in Dhaka." },
      ],
    },
    {
      kind: "works",
      pages: [{ id: "works/dune-part-two", kind: "works", title: "Dune: Part Two", summary: "Film, 2024." }],
    },
    { kind: "me", pages: [{ id: "me", kind: "me", title: "Me", summary: "Self-observations." }] },
  ])
})

test("listPages is empty for a folder with no wiki yet", () => {
  assert.deepEqual(listPages(fs.mkdtempSync(path.join(os.tmpdir(), "pages-"))), [])
})

test("readPage renders the body to blocks, and a wiki link opens the Page it names", async () => {
  const brain = brainWith({
    "people/rahim.md": rahim,
    "works/dune-part-two.md": dune,
    "log.md": "# Log\n",
    "open-threads.md": "# Open threads\n",
    "../raw/2026/09/2026-09-14-231000-iphone.md": "---\ndevice: iphone\n---\nhi\n",
  })

  const page = await readPage(brain, "people/rahim")

  assert.ok(page)
  assert.equal(page.id, "people/rahim")
  assert.equal(page.kind, "people")
  assert.equal(page.title, "রহিম")
  assert.deepEqual(page.blocks, [
    { type: "heading", depth: 1, children: [{ type: "text", text: "রহিম" }] },
    { type: "heading", depth: 2, children: [{ type: "text", text: "Timeline" }] },
    {
      type: "list",
      ordered: false,
      items: [
        {
          checked: null,
          children: [
            {
              type: "paragraph",
              children: [
                { type: "text", text: "2026-09-13: Watched " },
                { type: "page-link", id: "works/dune-part-two", label: "Dune: Part Two" },
                { type: "text", text: " with him. (" },
                { type: "elsewhere-link", label: "Dump 14 Sep" },
                { type: "text", text: ")" },
              ],
            },
          ],
        },
      ],
    },
  ])
})

test("a wiki link to a Page that does not exist is marked missing, and one to a wiki list is not", async () => {
  const brain = brainWith({
    "topics/sleep.md": "# Sleep\n\nSee [[caffeine]], [[Sleep#Timeline]], [[people/nobody|Nobody]] and [[open-threads]].\n",
    "open-threads.md": "# Open threads\n",
  })

  const page = await readPage(brain, "topics/sleep")

  assert.deepEqual(page?.blocks[1], {
    type: "paragraph",
    children: [
      { type: "text", text: "See " },
      { type: "missing-link", label: "caffeine" },
      { type: "text", text: ", " },
      { type: "page-link", id: "topics/sleep", label: "Sleep#Timeline" },
      { type: "text", text: ", " },
      { type: "missing-link", label: "Nobody" },
      { type: "text", text: " and " },
      { type: "elsewhere-link", label: "open-threads" },
      { type: "text", text: "." },
    ],
  })
})

test("a Page cannot put markup, an image or a script link on screen", async () => {
  const brain = brainWith({
    "topics/hostile.md": [
      "# Hostile",
      "",
      "<img src=x onerror=alert(1)> and [click](javascript:alert(1)) and [site](https://example.com/a) and ![pixel](https://tracker.example/p.gif)",
      "",
      "<script>alert(2)</script>",
      "",
    ].join("\n"),
  })

  const page = await readPage(brain, "topics/hostile")

  assert.deepEqual(page?.blocks.slice(1), [
    {
      type: "paragraph",
      children: [
        { type: "text", text: "<img src=x onerror=alert(1)> and click and " },
        { type: "link", href: "https://example.com/a", children: [{ type: "text", text: "site" }] },
        { type: "text", text: " and pixel" },
      ],
    },
    { type: "paragraph", children: [{ type: "text", text: "<script>alert(2)</script>" }] },
  ])
})

test("readPage turns an Obsidian callout into a callout with its title and body", async () => {
  const brain = brainWith({
    "works/dune.md": [
      "# Dune",
      "",
      "> [!warning] Disputed",
      "> Two dates for the release.",
      "> - 2024-03-01: one",
      "",
      "> [!note]- Earlier take",
      "> - 2026-09-14: \"ending felt rushed\"",
      "",
      "> A plain quote.",
      "",
    ].join("\n"),
  })

  const page = await readPage(brain, "works/dune")

  assert.deepEqual(page?.blocks.slice(1), [
    {
      type: "callout",
      kind: "warning",
      title: [{ type: "text", text: "Disputed" }],
      collapsed: false,
      children: [
        { type: "paragraph", children: [{ type: "text", text: "Two dates for the release." }] },
        {
          type: "list",
          ordered: false,
          items: [{ checked: null, children: [{ type: "paragraph", children: [{ type: "text", text: "2024-03-01: one" }] }] }],
        },
      ],
    },
    {
      type: "callout",
      kind: "note",
      title: [{ type: "text", text: "Earlier take" }],
      collapsed: true,
      children: [
        {
          type: "list",
          ordered: false,
          items: [
            { checked: null, children: [{ type: "paragraph", children: [{ type: "text", text: '2026-09-14: "ending felt rushed"' }] }] },
          ],
        },
      ],
    },
    { type: "quote", children: [{ type: "paragraph", children: [{ type: "text", text: "A plain quote." }] }] },
  ])
})

test("readPage returns nothing for an id that is not a listed Page", async () => {
  const brain = brainWith({ "topics/sleep.md": "# Sleep\n" })
  fs.writeFileSync(path.join(brain, "secret.md"), "# Secret\n")

  assert.equal(await readPage(brain, "../../secret"), null)
  assert.equal(await readPage(brain, "log"), null)
  assert.equal(await readPage(brain, "topics/nope"), null)
})

test("a Page lists the Pages that link to it, once each, and not itself", async () => {
  const brain = brainWith({
    "works/dune-part-two.md": "# Dune: Part Two\n\nSee [[dune-part-two]] again.\n",
    "people/rahim.md": rahim,
    "people/nadia.md": "# Nadia\n\n[[dune-part-two|Dune]] twice: [[Works/Dune-Part-Two#Timeline]].\n",
    "topics/sleep.md": "# Sleep\n\nNothing about films.\n",
    // An embed is drawn as a label, not a link, so it is not a link here either.
    "topics/film.md": "# Film\n\n![[dune-part-two]]\n",
    "log.md": "# Log\n\n- Updated: [[dune-part-two|Dune: Part Two]]\n",
  })

  const page = await readPage(brain, "works/dune-part-two")

  assert.deepEqual(page?.backlinks, [
    { id: "people/nadia", title: "Nadia" },
    { id: "people/rahim", title: "রহিম" },
  ])
  assert.deepEqual((await readPage(brain, "topics/sleep"))?.backlinks, [])
})

test("searchPages finds Pages by words in their name, alias or text, names first", () => {
  const brain = brainWith({
    "works/dune-part-two.md": dune,
    "people/rahim.md": rahim,
    "topics/sleep.md": "---\ntype: topic\n---\n\n# Sleep\n\nI sleep badly after coffee. The sound of rain helps.\n",
    "topics/sound.md": "---\ntype: topic\nsummary: Noise.\n---\n\n# Sound\n\nSleep needs quiet.\n",
    "log.md": "# Log\n\nsleep sleep sleep\n",
  })

  assert.deepEqual(searchPages(brain, "sleep"), [
    { id: "topics/sleep", kind: "topics", title: "Sleep", snippet: "I sleep badly after coffee. The sound of rain helps." },
    { id: "topics/sound", kind: "topics", title: "Sound", snippet: "Sleep needs quiet." },
  ])
  // Every word must appear, in any order and case; the alias counts as a name.
  assert.deepEqual(
    searchPages(brain, "SOUND ticket").map((hit) => hit.id),
    ["works/dune-part-two"],
  )
  // A snippet shows a wiki link as its label.
  assert.equal(
    searchPages(brain, "ticket")[0].snippet,
    '- 2026-09-14: "the sound design alone is worth the ticket" (Dump 14 Sep)',
  )
  assert.deepEqual(searchPages(brain, "রহিম").map((hit) => hit.id), ["people/rahim"])
  assert.deepEqual(searchPages(brain, "   "), [])
  assert.deepEqual(searchPages(brain, "nothing like this"), [])
  // Frontmatter keys are not text.
  assert.deepEqual(searchPages(brain, "type"), [])
})
