import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

// The app's copy of the ask skill, ported from tests/ask.sh in adib-11/second-brain. The
// maintainer-repo cases (the .claude symlink, the owner guide, the .ignore ripgrep check) have no
// counterpart here, and the cloud-session and git-crypt lines are dropped by design.

const skill = fs.readFileSync(
  path.join(__dirname, "..", "templates", ".agents", "skills", "ask", "SKILL.md"),
  "utf8",
)

// [ask.sh name, line the skill must contain]
const lines: [name: string, needle: string][] = [
  ["says which kind", "Recall."],
  ["says Persona", "Persona."],
  ["writes nothing into the wiki", "Write nothing into the wiki"],
  ["never commits or pushes", "Never commit"],
  ["never pushes", "never push"],
  ["lookup reads the index", "vault/wiki/index.md"],
  ["lookup greps the wiki", "Grep `vault/wiki/`"],
  ["lookup skips log.md", "log.md"],
  ["lookup skips digests", "digests/"],
  ["absence waits for index and grep", "until both come back empty"],
  ["private dumps stay unread", "Never read `vault/private/`"],
  ["private dumps are not opened or cited", "Do not open it, grep it, or cite it."],
  ["citations are repo paths", "vault/raw/"],
  ["a paraphrase cites the Page", "A paraphrase cites its Page"],
  ["filed up to uses the spec command", "git log -1 --format=%cs -- vault/wiki"],
  ["every answer ends Filed up to", "Filed up to"],
  ["recall length follows the question", "show me"],
  ["view change asks for quotes and older Takes", "how has my view changed?"],
  ["nothing stored says You have not said", "You haven't said."],
  ["no general knowledge", "general knowledge"],
  ["no staleness warning", "No staleness warning"],
  ["a bare shared link is you shared this", "you shared this"],
  ["persona opens with what you have said", "What you've said"],
  ["persona then guesses", "**Guess**"],
  ["guess reads me.md", "me.md"],
  ["ladder stored", "**stored**"],
  ["ladder covered", "**covered**"],
  ["ladder adjacent", "**adjacent**"],
  ["ladder novel", "**novel**"],
  ["novel guess is low confidence", "low confidence, from your general leanings"],
  ["adjacent uses the worldview", "worldview on `me.md`"],
  ["shared link is weak and only inside Guess", "only inside Guess"],
  ["drafting is first person", "first person"],
  ["judgement is you would", "you'd…"],
  ["voice file", "persona/STYLE.md"],
  ["voice missing is said", "the voice isn't available yet"],
  ["samples are few-shot", "persona/samples/"],
  ["three to five pairs", "3 to 5"],
  ["mirrors Banglish", "Banglish"],
  ["correction log file", "persona/corrections.md"],
  ["correction is a before after pair", '"before" -> "after"'],
  ["second appearance promotes", "second time"],
  ["second appearance creates the rule file", "creating the file if it does not exist"],
  ["promoted lines stay", "Do not delete"],
  ["soul.md commit recorded", "bada2485099752e73c08c9906d75b8d7ca7d58de"],
  ["write-like-me commit recorded", "b52802ee453b9486930f59a5a79121694c9b2a0d"],
  ["run with the ask agent", "--agent ask"],
]

for (const [name, needle] of lines) {
  test(`the ask skill ${name}`, () => {
    assert.ok(skill.includes(needle), `missing: ${JSON.stringify(needle)}`)
  })
}

test("the ask skill is not a stub and drops the cloud lines", () => {
  assert.ok(!skill.includes("Rules not written yet"))
  assert.ok(!skill.includes("cloud session"))
  assert.ok(!skill.includes("git-crypt"))
})

// The opencode ask agent fence from tests/ask.sh: cannot read private Dumps, cannot write the wiki,
// and its only shell command is the one git log behind "Filed up to".
const log = "git log -1 --format=%cs -- vault/wiki"

test("the opencode ask agent fence", () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "templates", "opencode.json"), "utf8"),
  ) as {
    agent: {
      ask: Record<string, Record<string, unknown> | string>
      ingest: Record<string, Record<string, unknown> | string>
    }
  }
  const ask = cfg.agent.ask.permission as {
    edit: Record<string, string>
    read: Record<string, string>
    list: Record<string, string>
    glob: Record<string, string>
    bash: Record<string, string>
    shell: Record<string, string>
    task: string
    webfetch: string
    websearch: string
    skill: Record<string, string>
  }
  assert.equal(ask.edit["*"], "deny")
  assert.equal(ask.edit["persona/corrections.md"], "allow")
  assert.equal(ask.edit["persona/STYLE.md"], "allow")
  assert.equal("vault/wiki/**" in ask.edit, false)
  assert.equal(ask.read["vault/private/**"], "deny")
  assert.equal(ask.list["vault/private/**"], "deny")
  assert.equal(ask.glob["vault/private/**"], "deny")
  for (const key of ["bash", "shell"] as const) {
    assert.equal(ask[key]["*"], "deny")
    assert.equal(ask[key][log], "allow")
    assert.equal("git log *" in ask[key], false)
  }
  assert.equal(ask.task, "deny")
  assert.equal(ask.webfetch, "deny")
  assert.equal(ask.websearch, "deny")
  assert.equal(ask.skill["*"], "deny")
  assert.equal(ask.skill["ask"], "allow")

  const ingest = cfg.agent.ingest.permission as {
    edit: Record<string, string>
    read: Record<string, string>
    bash: unknown
  }
  assert.equal(ingest.edit["vault/wiki/**"], "allow")
  assert.equal(ingest.edit["vault/follow-ups.md"], "allow")
  assert.equal(ingest.read["vault/private/**"], "deny")
  assert.equal(ingest.bash, "deny")
})
