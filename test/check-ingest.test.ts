import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { checkIngest } from "../src/check-ingest"

async function git(args: string[], cwd: string): Promise<void> {
  const result = await exec(args, cwd, {
    env: {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  })
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout)
}

test("check-ingest names the six chunk problems and ignores committed lines", async () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), "check-ingest-"))
  fs.mkdirSync(path.join(brain, "inbox"), { recursive: true })
  fs.mkdirSync(path.join(brain, "vault", "wiki", "works"), { recursive: true })
  fs.mkdirSync(path.join(brain, "vault", "raw", "2026", "09"), { recursive: true })

  fs.writeFileSync(
    path.join(brain, "vault", "raw", "2026", "09", "2026-09-30-080000-iphone.md"),
    "---\ncaptured: 2026-09-30T08:00:00+06:00\n---\nloved it, দারুণ ছিল\n",
  )
  fs.writeFileSync(
    path.join(brain, "vault", "wiki", "works", "old.md"),
    '# Page\n- 2026-09-30: "Owner hand edit not in the Dump" ([[2026-09-30-080000-iphone|Dump 30 Sep]])\n',
  )
  fs.writeFileSync(
    path.join(brain, "vault", "wiki", "log.md"),
    "# Log\n- Raw: [[2026-09-30-080000-iphone]]\n",
  )

  await git(["init", "-b", "main"], brain)
  await git(["config", "user.name", "t"], brain)
  await git(["config", "user.email", "t@t"], brain)
  await git(["config", "core.autocrlf", "false"], brain)
  await git(["add", "-A"], brain)
  await git(["commit", "-m", "init", "--no-gpg-sign"], brain)

  fs.writeFileSync(
    path.join(brain, "inbox", "2026-10-01-080000-iphone.md"),
    "---\ncaptured: 2026-10-01T08:00:00+06:00\n---\nthe ending was rushed\n",
  )
  fs.writeFileSync(
    path.join(brain, "inbox", "2026-10-07-200000-iphone.md"),
    "---\ncaptured: 2026-10-07T20:00:00+06:00\naddendum_to: 2026-10-01-080000-iphone\n---\nactually fine\n",
  )
  fs.writeFileSync(
    path.join(brain, "inbox", "2026-10-01-080000-iphone.fetched.md"),
    "---\nstatus: fetched\n---\nthe article says rest matters\n",
  )
  fs.appendFileSync(path.join(brain, "vault", "wiki", "log.md"), "- Raw: [[2026-10-01-080000-iphone]]\n")
  fs.appendFileSync(
    path.join(brain, "vault", "wiki", "works", "old.md"),
    [
      '- 2026-10-01: "the ending was rushed" ([[2026-10-01-080000-iphone|Dump 1 Oct]])',
      '- 2026-10-01: "the ending felt rushed" ([[2026-10-01-080000-iphone|Dump 1 Oct]])',
      '- 2026-10-01: "the article says rest matters" ([[2026-10-01-080000-iphone|Dump 1 Oct]])',
      '- 2026-10-07: "actually fine" ([[2026-10-07-200000-iphone|Dump 7 Oct]])',
      '- 2026-10-01: "the ending was rushed" ([[2026-10-01-080000-iphone|Dump 2 Oct]])',
      "- 2026-10-01: Saw it. ([[2026-10-01-999999-iphone|Dump 1 Oct]])",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(brain, "vault", "wiki", "works", "new.md"),
    [
      "# New",
      '- 2026-09-30: "দারুণ ছিল" ([[2026-09-30-080000-iphone|Dump 30 Sep]])',
      '- 2026-09-30: "দারুণ ছিল" [it was great] ([[2026-09-30-080000-iphone|Dump 30 Sep]])',
      "",
    ].join("\n"),
  )

  const problems = await checkIngest(brain, [
    "inbox/2026-10-01-080000-iphone.md",
    "inbox/2026-10-07-200000-iphone.md",
  ])
  assert.deepEqual(
    problems.filter((line) => line.includes("2026-10-07-200000-iphone") && line.includes("no entry")),
    ['log.md has no entry with "- Raw: [[2026-10-07-200000-iphone]]" for inbox/2026-10-07-200000-iphone.md'],
  )
  assert.ok(problems.some((line) => line.includes('quote "the ending felt rushed" is not word for word')))
  assert.ok(
    problems.some((line) =>
      line.includes(
        "cite 2026-10-07-200000-iphone as [[2026-10-07-200000-iphone|Addendum 7 Oct]], not |Dump 7 Oct",
      ),
    ),
  )
  assert.ok(problems.some((line) => line.includes("not |Dump 2 Oct")))
  assert.ok(problems.some((line) => line.includes("[[2026-10-01-999999-iphone]] names no Dump")))
  assert.ok(
    problems.some((line) => line.includes('works/new.md: quote "দারুণ ছিল" needs an [English gloss]')),
  )
  assert.equal(problems.length, 6)

  const windowsPath = await checkIngest(brain, ["inbox\\2026-10-07-200000-iphone.md"])
  assert.ok(
    windowsPath.some((line) =>
      line.includes('no entry with "- Raw: [[2026-10-07-200000-iphone]]" for inbox\\2026-10-07-200000-iphone.md'),
    ),
  )
  assert.ok(windowsPath.some((line) => line.includes("দারুণ ছিল")))

  await git(["add", "-A"], brain)
  assert.deepEqual(await checkIngest(brain, []), [])
})
