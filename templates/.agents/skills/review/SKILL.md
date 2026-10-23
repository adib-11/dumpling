---
name: review
description: Apply the Owner's ticked and annotated items from open Digests, after printing a plan and getting confirmation. Run by bin/review.
---

# Review

The Owner ticks and types after `→` in a Digest, then runs `bin/review`. These rules are spec §9 (`docs/spec/v1.md`); `bin/review` is the working copy of them. It prints a numbered plan, applies only what the Owner confirms, makes one commit per applied item, and pushes.

Do not apply an item yourself. Do not commit, do not push, and do not run `bin/review` (it commits). If the Owner asks you to review, tell them to run `bin/review` in this repo and answer the line it asks for. `bin/review --plan` only prints the plan.

The harness is not started. Confirmation is one line the wrapper reads, because `opencode run` and `claude -p` cannot ask, and the agent must not commit (ADR 0001). One commit per item needs the commit to sit between applies, so the wrapper both applies and commits. The plan it prints is the list it walks.

## Confirmation

Nothing is applied without a yes.

- `all` applies every item the plan marks to apply.
- A subset, `1 3` or `1,3`, applies those numbers, in numeric order. A number that is not marked to apply is skipped.
- `none` changes nothing: no files, no commits.

A declined item is listed and is not applied, including by `all` or by its number. An unticked line that has an answer is listed as `answered, not applied`, with the answer shown, and is not applied either. **Make private** is applied when it is ticked, the same as any other Proposal.

## What is in the plan

Open Digests are `vault/wiki/digests/YYYY-Www.md`, oldest week first. An item is included when:

- the checkbox is ticked (`- [x]` or `- [X]`), or
- there is text after the last `→` on the line.

A tick is the yes for a Proposal and for "Ingest wasn't sure" (merge, tag rename, new Page, Make private, disputed fact, side-by-side Takes, addendum). Unticked, with an answer, those are `answered, not applied`. They are never applied by `all` or by number. A rule change and a Could not file line are the exception: the answer is the instruction, so they apply without a tick.

Unticked, with nothing after `→`, is unanswered. It is not in the plan. The next Digest copies it forward. A filed-row `→` is not an item.

The answer is the text after the **last** `→`. A tag rename has an earlier `→` between the two spellings (`sci-fi`); that one is not the answer. Strip HTML comments before reading the answer. The plan shows that answer on every kind. An answer is a decline when it starts with `no`, `decline`, `skip`, `keep both`, or `leave it` (`no, it's just a cafe`). The decline already sits in the Digest, which is why a later Digest does not propose it again. Do not delete that line.

An item whose id is already in `vault/wiki/log.md` (`<!-- id: ... -->`) has been applied. It is not listed again.

A line with no `<!-- id: ... -->` keeps the text before `→` as its identity, the same rule the Digest uses for a line the Owner added.

## Items

- **Merge** (`merge:<old>:<kept>`). Keep the second Page. Move the first Page's Takes, Timeline and facts across with their citations. The intro moves as one block, so a Disputed or Unfetched callout stays one callout. Timeline entries are merged by date. One blank line sits before the next heading. Add the old name and its aliases to `aliases`. Tags stay on the kept Page. Rewrite `[[old]]` and `[[old|...]]` everywhere under `vault/wiki/`, including Digests and `log.md`, so the link points at the kept Page (the shown name stays). Matching is case-insensitive, the way Obsidian resolves a link: `[[Coffee]]` and `[[COFFEE]]` are the old Page too. A heading or block link keeps its part after `#`: `[[coffee#Timeline]]` becomes `[[caffeine#Timeline]]`. An alias is kept for that rewrite unless it is the name of a different live Page. Delete the old file. This is the one time a Digest file changes, and only the link target changes: the tick and the words after `→` stay.
- **Tag rename** (`tag:<from>:<to>`). On each Page, including `me.md`, replace the `from` tag with `to`. If `to` is already there, drop `from`.
- **Suggested Page** (`page:<slug>`, `place:<slug>`). Create `topics/<slug>.md` or `places/<slug>.md` with the italic name as the alias and the heading. No Take is invented.
- **Rule change** (`rule:…`, or `**Rule change**` with a path in backticks). Append the answer as a bullet. The only files this may touch are `AGENTS.md` and `.agents/skills/<name>/SKILL.md`.
- **Disputed fact** (`disputed:<page>`). Tick means it changed. The last fact in the Disputed callout becomes the current line; each earlier fact becomes a Timeline entry, still cited. An answer that is contained in one fact selects that fact instead. An unticked answer is not applied, so a note that matches no fact does not make the last fact current.
- **Side-by-side Takes** (`unsure:<page>`). Tick means the new Take replaces the old. The new Take is the one whose Dump is linked on the Digest line, not merely the latest date. The newest Take dated before that one moves into `> [!note]- Earlier take, outdated <date>`, still quoted. A later Take, or one from the same day, stays. If nothing is dated before the named Take, the Page is left as it is. If the line names no Dump, the newest current Take stays and the next newest is the one that moves.
- **Unmatched "re ..."** (`unmatched:<dump>`). Point the Addendum at the Dump named after `→`, or, if the answer names none, at the Likeliest Dump on the line. Set `addendum_to:` on that Dump.
- **Could not file.** `failed:<dump>` with answer `retry` moves the Dump from `inbox/failed/` back to `inbox/`. Any other answer moves it too, and the answer is written under `## Review` on the Dump. `unfetched:<dump>` removes the Unfetched callout and writes the answer on the Page.
- **Make private** (`private:<dump>`, or a Dump name on the line). A tick moves that Dump, and the files that share its name (a sidecar, an image), to `vault/private/YYYY/MM/`. A citation is the Dump's exact stem, bounded by a non-name character, so `…-mac` does not match `…-macbook`. Anything cut from that Dump leaves HEAD: lines under `## What I think` that cite it, including inside an earlier-take callout, plus Timeline lines and facts that cite it. A line that cites two Dumps is dropped whole, so the public half goes with the private one. A callout with no Takes left is removed. `summary` is rebuilt from the remaining current Takes (the newest quote) only when a Take was removed; if none remain, it becomes `Suggested from the Digest.`. If only facts or Timeline lines were removed, the summary stays, and the review log says `Summary on [[page]] may need a refresh.`, which the next Digest repeats in Health. `bin/index` rewrites `index.md` in the same commit. Past commits on GitHub keep the plaintext. The commit is refused, and the item is rolled back, when git-crypt is not initialized for `vault/private/**`.
- **Open thread.** A ticked line under Open threads ticks the same line in `open-threads.md`. The age (`— 18 days`) is not part of the line. A ticked Open thread is never unticked.

## Commits

Each applied item is its own commit, `review: <item>`, and includes a `log.md` bullet under `## [date] review | wk NN`. The bullet is written last. `bin/index` runs when a Page changed, and that `index.md` is part of the same commit. If an item fails halfway, only the paths that item made dirty are restored (`git checkout` for tracked paths that were clean before it, `git clean` for files it created). An Owner edit that was already dirty, and a Dump that was already in `inbox/`, stay. The id is not in `log.md`, so the next plan lists the item again. Earlier items stay committed. After the last item, `git push` to `PUSH_REMOTE` from `ingest.conf` (default `origin`), best-effort. The deploy key is that remote's SSH key, not a key in the repo. A failed push leaves the commits in place, notifies, and is a `push failed` line in the Digest's Health.

`bin/ingest` is what commits the Owner's checkbox and `→` edits as `owner edits`, before this run. `bin/review` does not make that commit. On `none` it does not commit anything.


