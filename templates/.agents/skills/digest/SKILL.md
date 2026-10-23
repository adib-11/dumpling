---
name: digest
description: Write the weekly Digest in vault/wiki/digests/ from the week's log.md, a lint pass and git log.
---

# Digest

`bin/ingest` writes the Digest by running `bin/digest`, then commits it. The file is `vault/wiki/digests/YYYY-Www.md` (ISO week of the Monday–Sunday just finished). These rules are spec §9 (`docs/spec/v1.md`); `bin/digest` is the working copy of them.

Do not write a Digest yourself, and do not edit one that already exists. The Owner's ticks and the words after `→ ` are theirs. A second run in the same week writes no second Digest. Never run `bin/ingest`, never commit, and never push.

## When it is written

The first Ingest run on or after Monday, covering the previous Monday to Sunday. If that run is later in the week because Monday was missed, it still covers that finished week, not the days of the new week already past. A run on Sunday does not write the week still in progress.

Frontmatter: `type: digest`, `week` (`YYYY-Www`), `covers` (`YYYY-MM-DD to YYYY-MM-DD`), `written` (the run's date).

The run notifies `Digest wk NN: N things need you`. N is the number of checkbox items under Needs you.

## Sections, in order

1. **At a glance** (a `> [!abstract]` callout). Dumps filed and failed, Pages created and updated, how many things need the Owner, Ingest runs out of 7 days with missed days named, cost.
2. **Needs you.** Checkbox items, each ending in `→ ` for a free-text answer. Tick to accept. Leave unticked, with nothing after `→ `, to see it again next week. Then the Owner runs `bin/review`.
   - **Proposals:** merges, tag renames, suggested Pages (a thing in about 3 Dumps), place Pages (a place in about 3 Dumps), rule changes to `AGENTS.md` or a skill.
   - **Ingest wasn't sure:** a disputed fact (tick = it changed), Takes left side by side (tick = the new one replaces the old), an unmatched "re ..." Addendum. The likeliest earlier Dump is the one from the 30 days before that shares the most words with the "re ..." text. No shared words means no guess.
3. **Could not file.** Dumps in `inbox/failed/` and unfetched links, each with `→ `.
4. **Filed this week.** A table Dump | Went to | Fix, one row per Dump. The Owner writes a correction after `→` on a row.
5. **Open threads.** The open ones, oldest first, with age. Ticking here equals ticking in `open-threads.md`.
6. **Health.** The per-day run strip (ok, failed with its stash name, no run, push failed), runner and model, lint notes, `index.md` flagged when it is past 40 KB (40960 bytes), the count of `#miss` Dumps, and the count of `possible duplicate` flags whose Page exists.
7. **Questions you could ask.** 2 or 3 `ask` questions, each citing a Page.

## Where the lines come from

- **Filed, disputed, side by side, unmatched "re ...", unfetched, merge.** That week's `log.md` entries (the heading date). A merge is proposed from `possible duplicate of [[page]]` on an entry that created a Page. Nothing here is applied.
- **Failed Dumps.** Files in `inbox/failed/`. The at-a-glance "failed" count is the ones whose name falls in the week.
- **Open threads.** Unticked lines in `open-threads.md`.
- **Run strip, runner, model, cost.** `.state/runs.tsv`, one line per run, for the seven days. No Ingest line that day is `no run` in the glance. `status=failed` shows the stash name. `push=failed` on a run that otherwise succeeded shows `push failed`. A row whose runner is not `opencode` or `claude` (a `bin/review` push failure) still shows in that day's cell, and does not count toward "Ingest ran" or the Runners line. A review log line `Summary on [[page]] may need a refresh.` from a day in the week is repeated in the Health lint.
- **Health counts.** `bin/health`. An orphan is a Page in `people/`, `works/`, `topics/`, `projects/` or `places/` with no inbound wikilink from another Page or from `open-threads.md` (`log.md`, `index.md` and `digests/` do not count). A `#miss` Dump is a Dump whose body contains `#miss` (the Owner's mark for an `ask` that missed). A duplicate flag counts when the Page it names exists.
- **Git log.** Ingest commits whose author date is in the week are counted in Health. The filed list itself comes from `log.md`.
- **Suggested Page.** The same plain-text name, two or more Capitalized words, in 3 or more Dumps, and no Page with that name or alias. A name that shows up as `in/at/from/to <name>` is proposed as a place Page instead. A tag rename is proposed only when two tags are the same letters aside from hyphens and case, and one spelling is on strictly more Pages. `bin/digest` does not guess a rule change; a rule change only comes back by rollover.
- **Run strip.** An ok day is `ok, N` with that day's Dump count, the same shape as the Digest the Owner picked.

## Rollover

Unanswered items (unticked, nothing after `→ `) are copied from the latest Digest into the next one, including a line the Owner added that has no id. A ticked item, or one with an answer after `→ ` (including a decline such as "no, it's just a cafe"), is not proposed again; that answer is read from every earlier Digest, so a decline stays declined after the week that hid it. Old Digest files are never edited.

## Borrowed ideas

Recorded at the commits that were read. Ideas only; the checks are this repo's.

- `SamurAIGPT/llm-wiki-agent` `tools/health.py` @ `5c5e056435b317f0fa9bef327ae86a76b2a3073a` — a deterministic health pass, including whether `index.md` matches the files on disk. No LLM.
- `SamurAIGPT/llm-wiki-agent` `tools/lint.py` @ `11f66f1166994b35de2d7d3d0b246cb28847bbf2` — an orphan is a Page with no inbound link; a Page is suggested around 3 mentions.
- `eugeniughelbur/obsidian-second-brain` `scripts/vault_health.py` @ `7b098c2793651956eb3b5dc8e1ac2ccbe8a9d3de` — the same orphan rule, and suggested questions that cite a Page.


