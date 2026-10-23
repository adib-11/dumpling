# Second brain

A private, single-Owner store of everything the Owner does, watches, reads and thinks. Dumps wait in `inbox/`; Ingest files them into markdown Pages under `vault/wiki/`; Recall and Persona questions are answered from those Pages. The build spec is `docs/spec/v1.md`.

Use the vocabulary in `CONTEXT.md` (Owner, Dump, Inbox, Ingest, Page, Take, Open thread, Digest, Recall, Persona, ...) exactly, and avoid the words it lists under _Avoid_.

## Rules

- **Files and shell only** (`docs/adr/0001-harness-agnostic-files-and-shell.md`). Assume only reading and writing files and running shell commands. Never use a harness's built-in web fetch, MCP servers, hooks, harness-only commands or harness memory. Fetch links with shell tools.
- **Wrapper scripts commit, never the agent.** Do not run `git commit` or `git push`; `bin/ingest`, `bin/review` and the other wrappers do that.
- **`vault/wiki/index.md` is generated.** `bin/index` writes it from Page frontmatter after each Ingest chunk. Never edit it, by hand or as the agent; change the Page's frontmatter instead.

## Skills

Each skill is a plain `SKILL.md` file. Read the file when its task comes up.

- ingest: `.agents/skills/ingest/SKILL.md`
- ask: `.agents/skills/ask/SKILL.md`
