import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain, defaultSecondBrainFolder } from "../src/create-second-brain"

const templatesDir = path.join(__dirname, "..", "templates")

function tempFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "second-brain-"))
}

test("the default folder is Documents/Second Brain", () => {
  const home = path.join("/home/ada")
  const documents = path.join(home, "Documents")
  assert.equal(
    defaultSecondBrainFolder(home, documents),
    `${documents}${path.sep}Second Brain`,
  )
  assert.equal(defaultSecondBrainFolder(home, home), `${documents}${path.sep}Second Brain`)
  const custom = path.join("/data", "docs")
  assert.equal(defaultSecondBrainFolder(home, custom), `${custom}${path.sep}Second Brain`)
})

test("createSecondBrain writes the v1 layout and fixed wiki files", async () => {
  const folder = tempFolder()
  await createSecondBrain(folder, { templatesDir })

  const index = [
    "# Index",
    "",
    "## people",
    "",
    "| Page | Tags | Summary | Updated |",
    "| --- | --- | --- | --- |",
    "",
    "## works",
    "",
    "| Page | Tags | Summary | Updated |",
    "| --- | --- | --- | --- |",
    "",
    "## topics",
    "",
    "| Page | Tags | Summary | Updated |",
    "| --- | --- | --- | --- |",
    "",
    "## projects",
    "",
    "| Page | Tags | Summary | Updated |",
    "| --- | --- | --- | --- |",
    "",
    "## places",
    "",
    "| Page | Tags | Summary | Updated |",
    "| --- | --- | --- | --- |",
    "",
  ].join("\n")

  const me = [
    "---",
    "type: person",
    "aliases: []",
    "tags: []",
    "summary: The Owner.",
    "updated:",
    "---",
    "",
    "# Me",
    "",
    "## What I think",
    "",
    "## Timeline",
    "",
  ].join("\n")

  assert.equal(fs.readFileSync(path.join(folder, "vault/wiki/index.md"), "utf8"), index)
  assert.equal(fs.readFileSync(path.join(folder, "vault/wiki/log.md"), "utf8"), "# Log\n")
  assert.equal(
    fs.readFileSync(path.join(folder, "vault/wiki/open-threads.md"), "utf8"),
    "# Open threads\n",
  )
  assert.equal(fs.readFileSync(path.join(folder, "vault/wiki/me.md"), "utf8"), me)
  assert.equal(fs.readFileSync(path.join(folder, "inbox/.gitkeep"), "utf8"), "")
  assert.equal(fs.readFileSync(path.join(folder, "vault/raw/.gitkeep"), "utf8"), "")
  for (const kind of ["people", "works", "topics", "projects", "places"]) {
    assert.equal(fs.readFileSync(path.join(folder, "vault/wiki", kind, ".gitkeep"), "utf8"), "")
  }
  assert.equal(fs.readFileSync(path.join(folder, ".gitignore"), "utf8"), ".state/\n")
})

test("createSecondBrain copies the app-owned templates and records the source commit", async () => {
  const folder = tempFolder()
  await createSecondBrain(folder, { templatesDir })

  for (const name of ["AGENTS.md", "CONTEXT.md", "opencode.json"]) {
    assert.equal(
      fs.readFileSync(path.join(folder, name), "utf8"),
      fs.readFileSync(path.join(templatesDir, name), "utf8"),
    )
  }
  for (const skill of ["ask", "digest", "ingest", "review", "voice"]) {
    const relative = path.join(".agents", "skills", skill, "SKILL.md")
    assert.equal(
      fs.readFileSync(path.join(folder, relative), "utf8"),
      fs.readFileSync(path.join(templatesDir, relative), "utf8"),
    )
  }
  assert.equal(
    fs.readFileSync(path.join(folder, "SOURCE_COMMIT"), "utf8").trim(),
    "a6bdf23909469797e94944e89b420a561af405c4",
  )
  const fences = JSON.parse(fs.readFileSync(path.join(folder, "opencode.json"), "utf8"))
  assert.equal(fences.share, "disabled")
  assert.deepEqual(fences.agent.ingest.permission.edit, {
    "*": "deny",
    "vault/wiki/**": "allow",
    "vault/follow-ups.md": "allow",
  })
})

test("createSecondBrain makes a first commit with the bundled git", async () => {
  const folder = tempFolder()
  const trap = fs.mkdtempSync(path.join(os.tmpdir(), "git-trap-"))
  fs.writeFileSync(
    path.join(trap, "git"),
    "#!/bin/sh\necho system-git-called >&2\nexit 97\n",
  )
  fs.chmodSync(path.join(trap, "git"), 0o755)
  const emptyConfig = path.join(trap, "gitconfig")
  fs.writeFileSync(emptyConfig, "")

  const saved = snapshotEnv([
    "PATH",
    "GIT_EXEC_PATH",
    "LOCAL_GIT_DIRECTORY",
    "GIT_CONFIG_GLOBAL",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ])
  process.env.PATH = trap
  process.env.GIT_CONFIG_GLOBAL = emptyConfig
  delete process.env.GIT_EXEC_PATH
  delete process.env.LOCAL_GIT_DIRECTORY
  delete process.env.GIT_AUTHOR_NAME
  delete process.env.GIT_AUTHOR_EMAIL
  delete process.env.GIT_COMMITTER_NAME
  delete process.env.GIT_COMMITTER_EMAIL

  try {
    const created = await createSecondBrain(folder, { templatesDir })
    assert.match(created.commit, /^[0-9a-f]{40}$/)

    const head = await exec(["rev-parse", "HEAD"], folder)
    assert.equal(head.exitCode, 0)
    assert.equal(head.stdout.trim(), created.commit)

    const subject = await exec(["log", "-1", "--format=%s"], folder)
    assert.equal(subject.stdout.trim(), "create second brain")

    const author = await exec(["log", "-1", "--format=%an%n%ae"], folder)
    assert.equal(author.stdout, "Second Brain\nsecond-brain@localhost\n")

    const branch = await exec(["rev-parse", "--abbrev-ref", "HEAD"], folder)
    assert.equal(branch.stdout.trim(), "main")

    const tree = await exec(["ls-tree", "-r", "--name-only", "HEAD"], folder)
    assert.deepEqual(tree.stdout.trim().split("\n").sort(), [
      ".agents/skills/ask/SKILL.md",
      ".agents/skills/digest/SKILL.md",
      ".agents/skills/ingest/SKILL.md",
      ".agents/skills/review/SKILL.md",
      ".agents/skills/voice/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CONTEXT.md",
      "SOURCE_COMMIT",
      "inbox/.gitkeep",
      "opencode.json",
      "vault/raw/.gitkeep",
      "vault/wiki/index.md",
      "vault/wiki/log.md",
      "vault/wiki/me.md",
      "vault/wiki/open-threads.md",
      "vault/wiki/people/.gitkeep",
      "vault/wiki/places/.gitkeep",
      "vault/wiki/projects/.gitkeep",
      "vault/wiki/topics/.gitkeep",
      "vault/wiki/works/.gitkeep",
    ])
  } finally {
    restoreEnv(saved)
  }
})

test("a failed create removes a folder it had just created", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "second-brain-fail-"))
  const folder = path.join(parent, "brain")

  await assert.rejects(() => createSecondBrain(folder, { templatesDir: path.join(parent, "missing-templates") }))

  assert.equal(fs.existsSync(folder), false)
})

test("a failed create leaves an existing empty folder empty", async () => {
  const folder = tempFolder()
  const saved = process.env.LOCAL_GIT_DIRECTORY
  process.env.LOCAL_GIT_DIRECTORY = path.join(folder, "not-a-git")
  try {
    await assert.rejects(() => createSecondBrain(folder, { templatesDir }))
  } finally {
    if (saved === undefined) delete process.env.LOCAL_GIT_DIRECTORY
    else process.env.LOCAL_GIT_DIRECTORY = saved
  }

  assert.deepEqual(fs.readdirSync(folder), [])
})

test("createSecondBrain refuses a folder that already has files", async () => {
  const folder = tempFolder()
  fs.writeFileSync(path.join(folder, "keep.txt"), "leave me\n")

  await assert.rejects(() => createSecondBrain(folder, { templatesDir }), /not empty/)

  assert.equal(fs.readFileSync(path.join(folder, "keep.txt"), "utf8"), "leave me\n")
  assert.equal(fs.readdirSync(folder).sort().join(","), "keep.txt")
})

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(saved: Map<string, string | undefined>): void {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
