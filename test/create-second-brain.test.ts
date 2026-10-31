import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exec } from "dugite"
import { createSecondBrain, defaultSecondBrainFolder, openSecondBrain, secondBrainPath } from "../src/create-second-brain"

const templatesDir = path.join(__dirname, "..", "templates")

function tempFolder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "second-brain-"))
}

test("the default folder is Documents/Dumpling", () => {
  const home = path.join("/home/ada")
  const documents = path.join(home, "Documents")
  assert.equal(
    defaultSecondBrainFolder(home, documents),
    `${documents}${path.sep}Dumpling`,
  )
  assert.equal(defaultSecondBrainFolder(home, home), `${documents}${path.sep}Dumpling`)
  const custom = path.join("/data", "docs")
  assert.equal(defaultSecondBrainFolder(home, custom), `${custom}${path.sep}Dumpling`)
})

test("createSecondBrain writes the v1 layout and fixed wiki files", async () => {
  const folder = tempFolder()
  await createSecondBrain(folder, templatesDir)

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
  await createSecondBrain(folder, templatesDir)

  for (const name of ["AGENTS.md", "CONTEXT.md", "opencode.json"]) {
    assert.equal(
      fs.readFileSync(path.join(folder, name), "utf8"),
      fs.readFileSync(path.join(templatesDir, name), "utf8"),
    )
  }
  for (const skill of ["ask", "ingest"]) {
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
  const ingest = fs.readFileSync(path.join(folder, ".agents/skills/ingest/SKILL.md"), "utf8")
  assert.match(ingest, /Every Dump is a Telegram Dump/)
  assert.match(ingest, /Rule changes are proposed in the daily message only/)
  assert.doesNotMatch(ingest, /Shortcuts/)
  assert.doesNotMatch(ingest, /private: true/)
  assert.doesNotMatch(ingest, /Digest/)

  const ask = fs.readFileSync(path.join(folder, ".agents/skills/ask/SKILL.md"), "utf8")
  assert.doesNotMatch(ask, /cloud session/)
  assert.doesNotMatch(ask, /git-crypt/)

  for (const dropped of ["digest", "review", "voice"]) {
    assert.equal(fs.existsSync(path.join(folder, ".agents", "skills", dropped)), false)
  }

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
    const created = await createSecondBrain(folder, templatesDir)
    assert.match(created.commit, /^[0-9a-f]{40}$/)

    const head = await exec(["rev-parse", "HEAD"], folder)
    assert.equal(head.exitCode, 0)
    assert.equal(head.stdout.trim(), created.commit)

    const subject = await exec(["log", "-1", "--format=%s"], folder)
    assert.equal(subject.stdout.trim(), "create second brain")

    const author = await exec(["log", "-1", "--format=%an%n%ae"], folder)
    assert.equal(author.stdout, "Dumpling\ndumpling@localhost\n")

    const branch = await exec(["rev-parse", "--abbrev-ref", "HEAD"], folder)
    assert.equal(branch.stdout.trim(), "main")

    const tree = await exec(["ls-tree", "-r", "--name-only", "HEAD"], folder)
    assert.deepEqual(tree.stdout.trim().split("\n").sort(), [
      ".agents/skills/ask/SKILL.md",
      ".agents/skills/ingest/SKILL.md",
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

  await assert.rejects(() => createSecondBrain(folder, path.join(parent, "missing-templates")))

  assert.equal(fs.existsSync(folder), false)
})

test("a failed create leaves an existing empty folder empty", async () => {
  const folder = tempFolder()
  const saved = process.env.LOCAL_GIT_DIRECTORY
  process.env.LOCAL_GIT_DIRECTORY = path.join(folder, "not-a-git")
  try {
    await assert.rejects(() => createSecondBrain(folder, templatesDir))
  } finally {
    if (saved === undefined) delete process.env.LOCAL_GIT_DIRECTORY
    else process.env.LOCAL_GIT_DIRECTORY = saved
  }

  assert.deepEqual(fs.readdirSync(folder), [])
})

test("createSecondBrain refuses a folder that already has files", async () => {
  const folder = tempFolder()
  fs.writeFileSync(path.join(folder, "keep.txt"), "leave me\n")

  await assert.rejects(() => createSecondBrain(folder, templatesDir), /not empty/)

  assert.equal(fs.readFileSync(path.join(folder, "keep.txt"), "utf8"), "leave me\n")
  assert.equal(fs.readdirSync(folder).sort().join(","), "keep.txt")
})

test("createSecondBrain refuses a relative folder", async () => {
  await assert.rejects(() => createSecondBrain("Second Brain", templatesDir), /full folder path/)

  assert.equal(fs.existsSync(path.resolve("Second Brain")), false)
})

test("opening an existing second brain uses it as it is", async () => {
  const folder = tempFolder()
  const created = await createSecondBrain(folder, templatesDir)
  fs.writeFileSync(path.join(folder, "vault/wiki/topics/sleep.md"), "# Sleep\n")

  assert.deepEqual(await openSecondBrain(folder, templatesDir), { created: false })

  assert.equal(fs.readFileSync(path.join(folder, "vault/wiki/topics/sleep.md"), "utf8"), "# Sleep\n")
  const head = await exec(["rev-parse", "HEAD"], folder)
  assert.equal(head.stdout.trim(), created.commit)
})

test("opening an empty folder makes a new second brain in it", async () => {
  const folder = path.join(tempFolder(), "Dumpling")

  assert.deepEqual(await openSecondBrain(folder, templatesDir), { created: true })

  const subject = await exec(["log", "-1", "--format=%s"], folder)
  assert.equal(subject.stdout.trim(), "create second brain")
})

test("opening a folder of other files refuses it and leaves it alone", async () => {
  const folder = tempFolder()
  fs.writeFileSync(path.join(folder, "taxes.pdf"), "pdf")

  await assert.rejects(
    () => openSecondBrain(folder, templatesDir),
    /That folder has other files in it\. Choose a second brain folder or an empty one\./,
  )

  assert.deepEqual(fs.readdirSync(folder), ["taxes.pdf"])
})

test("a chosen folder must be a full path with no .. in it, and comes back normalized", () => {
  const home = path.join(tempFolder(), "ada")
  assert.equal(secondBrainPath(path.join(home, "Dumpling") + path.sep), path.join(home, "Dumpling"))
  assert.equal(secondBrainPath(`${home}${path.sep}.${path.sep}Dumpling`), path.join(home, "Dumpling"))

  assert.throws(() => secondBrainPath("Dumpling"), /full folder path/)
  assert.throws(() => secondBrainPath(`${home}${path.sep}..${path.sep}..${path.sep}etc`), /full folder path/)
  assert.throws(() => secondBrainPath(`${home}${path.sep}..`), /full folder path/)
  assert.throws(() => secondBrainPath(`${home}\0${path.sep}Dumpling`), /full folder path/)
  assert.throws(() => secondBrainPath(""), /full folder path/)
})

test("opening a folder through .. refuses it and touches nothing", async () => {
  const parent = tempFolder()
  const brain = path.join(parent, "brain")
  await createSecondBrain(brain, templatesDir)
  const outside = path.join(parent, "outside")

  await assert.rejects(
    () => openSecondBrain(`${brain}${path.sep}..${path.sep}outside`, templatesDir),
    /full folder path/,
  )
  await assert.rejects(() => createSecondBrain(`${brain}${path.sep}..${path.sep}outside`, templatesDir), /full folder path/)

  assert.equal(fs.existsSync(outside), false)
})

test("opening a relative folder refuses it, even when it is a second brain", async () => {
  const parent = tempFolder()
  await createSecondBrain(path.join(parent, "brain"), templatesDir)
  const saved = process.cwd()
  process.chdir(parent)
  try {
    await assert.rejects(() => openSecondBrain("brain", templatesDir), /full folder path/)
  } finally {
    process.chdir(saved)
  }
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
