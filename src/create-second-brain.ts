import fs from "node:fs"
import path from "node:path"
import { exec } from "dugite"

const pageKinds = ["people", "works", "topics", "projects", "places"]
const indexTable = ["| Page | Tags | Summary | Updated |", "| --- | --- | --- | --- |", ""]
const indexMd = ["# Index", ""]
  .concat(pageKinds.flatMap((kind) => [`## ${kind}`, "", ...indexTable]))
  .join("\n")

const gitName = "Second Brain"
const gitEmail = "second-brain@localhost"

const meMd = [
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

export function defaultSecondBrainFolder(homeDir: string, documentsDir: string): string {
  const documentsIsHome = path.resolve(documentsDir) === path.resolve(homeDir)
  const base = documentsIsHome ? path.join(homeDir, "Documents") : documentsDir
  return path.join(base, "Second Brain")
}

export async function createSecondBrain(folder: string, templatesDir: string): Promise<{ commit: string }> {
  if (!path.isAbsolute(folder)) {
    throw new Error(`Choose a full folder path, not ${folder}`)
  }
  const existed = fs.existsSync(folder)
  if (existed && fs.readdirSync(folder).length > 0) {
    throw new Error(`Second brain folder is not empty: ${folder}`)
  }
  fs.mkdirSync(folder, { recursive: true })
  try {
    fs.cpSync(templatesDir, folder, { recursive: true })
    write(folder, "vault/wiki/index.md", indexMd)
    write(folder, "vault/wiki/log.md", "# Log\n")
    write(folder, "vault/wiki/open-threads.md", "# Open threads\n")
    write(folder, "vault/wiki/me.md", meMd)
    write(folder, "inbox/.gitkeep", "")
    write(folder, "vault/raw/.gitkeep", "")
    for (const kind of pageKinds) {
      write(folder, path.join("vault/wiki", kind, ".gitkeep"), "")
    }
    write(folder, ".gitignore", ".state/\n")

    await git(["init", "-b", "main"], folder)
    await git(["config", "user.name", gitName], folder)
    await git(["config", "user.email", gitEmail], folder)
    await git(["add", "-A"], folder)
    await git(["commit", "-m", "create second brain", "--no-gpg-sign"], folder, {
      GIT_AUTHOR_NAME: gitName,
      GIT_AUTHOR_EMAIL: gitEmail,
      GIT_COMMITTER_NAME: gitName,
      GIT_COMMITTER_EMAIL: gitEmail,
    })
    const head = await exec(["rev-parse", "HEAD"], folder)
    if (head.exitCode !== 0) {
      throw new Error(head.stderr || "git rev-parse HEAD failed")
    }
    return { commit: head.stdout.trim() }
  } catch (error) {
    rollback(folder, existed)
    throw error
  }
}

function rollback(folder: string, existed: boolean): void {
  if (!existed) {
    fs.rmSync(folder, { recursive: true, force: true })
    return
  }
  for (const entry of fs.readdirSync(folder)) {
    fs.rmSync(path.join(folder, entry), { recursive: true, force: true })
  }
}

export async function git(
  args: string[],
  folder: string,
  env?: Record<string, string>,
): Promise<void> {
  const result = await exec(args, folder, env ? { env } : undefined)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

function write(folder: string, relativePath: string, contents: string): void {
  const fullPath = path.join(folder, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, contents)
}
