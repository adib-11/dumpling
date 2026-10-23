---
name: ingest
description: File the Dumps waiting in inbox/ into Pages under vault/wiki/: Takes, Timeline entries, facts and Open threads. Run by bin/ingest.
---

# Ingest

`bin/ingest` names the Dumps to file in its prompt. File each one into Pages under `vault/wiki/`, then stop. The store format is spec §4 and these rules are spec §5 (`docs/spec/v1.md`); this file is the working copy of both.

Rule ideas (triage dispositions, never rewriting history, cascade lookup, the grounding check, the log format) come from `Astro-Han/karpathy-llm-wiki` `SKILL.md` at commit `eafcc77001e496cc43499e4923b663aec722c813` (MIT).

## Fences

- Write only inside `vault/wiki/` and the Follow-up outbox `vault/follow-ups.md`. Never write `vault/wiki/index.md`: `bin/index` generates it.
- `bin/ingest` started you and is waiting for you to finish. Never run it or any other script, never run git, and never start a subagent: file the Dumps yourself with your file tools.
- Never move, rename or delete a file. `bin/ingest` moves each Dump to `vault/raw/` and commits.
- Never write in `inbox/` or `vault/raw/`. Never read `vault/private/`.
- Never edit `AGENTS.md` or a skill. Rule changes are proposed in the daily message only.
- Do not ask questions in this session. Nobody is watching the run. A Telegram Follow-up is one line appended to `vault/follow-ups.md`, which `bin/ingest` sends later. When unsure, follow the rule for "unsure" below and flag it in `log.md`.

## Steps

1. Read `vault/wiki/index.md`. It lists every Page with its tags.
2. Sort the named Dumps by file name (oldest first). An Addendum whose original is in the same batch goes after the original.
3. For each Dump, in that order:
   1. Read the Dump. If `inbox/<name>.fetched.md` exists beside it, read that too: it decides whether a link is fetched.
   2. Decide what the Dump yields (see **What a Dump yields**) and which Pages it is about.
   3. Look up each Page (see **Lookup**), then create or update Pages, `me.md` and `open-threads.md`.
   4. For each Take you add to a Page that already has a current Take, decide same point, unsure or different point (see **Takes over time**). Write the outdated callout or the `unsure Take` flag that the decision needs.
   5. Before you write a quote, a date or a number, find it in the Dump. Copy it exactly.
   6. Append the Dump's entry to `log.md`.
   7. Queue a Telegram Follow-up when **Telegram Follow-up** says so.
4. Stop. Do not summarize the run anywhere else.

## The Dump

A Dump is `inbox/YYYY-MM-DD-HHMMSS-<device>.md`. Its file name without `.md` is its **name**; citations use it. Frontmatter:

- `captured`: when the Owner made it. A Take's date and every relative date ("yesterday", "last week") come from here.
- `kind`: `text`, `voice`, `link` or `image`.
- `url`: the shared link, if any. `image`: the JPEG beside it, if any.
- `addendum_to`: the name of the earlier Dump this one adds to (an Addendum).
- `source: interview`: an Interview transcript. File its opinions as Takes like any Dump.

The body is the Owner's own words. Two headings may follow them:

- `## Follow-up`: the Owner's answer to the Follow-up question. These are the Owner's words too.
- `## Image text`: OCR text of the image. This is material, not the Owner's words.

A **sidecar** `<name>.fetched.md` holds the text behind the Dump's link. Frontmatter `status: fetched` or `status: unfetched`, plus `url` and, when known, `title`, `creator`, `published`, `description`. A fetched sidecar's body is the linked text: material, never the Owner's words. A link Dump with no sidecar counts as unfetched.

## What a Dump yields

One Dump can yield any mix of these.

- **Take**: anything evaluative in the Owner's words (loved it, overrated, not worth it, agree). Quote it verbatim, with the Dump's date and a citation. Only the Owner's words are Takes. Someone else's opinion (a friend, an author, the image text) is a fact about them, never a Take.
- **Timeline entry**: a dated event. Resolve relative dates against `captured`. Write `YYYY-MM-DD` only when the words name the day ("yesterday", "on Friday"); for a vaguer phrase write the first day of the week or month it names, then `(week of)` or `(month of)`: `2026-09-28 (week of)` for "last week", so the Timeline still sorts. An event never gets its own Page; it goes on the Timeline of each Page involved.
- **Owner-stated fact**: something the Owner says is true about a thing ("she teaches at BRAC now"). Cite it to its Dump; it is never *(general knowledge)*. A dated fact is a Timeline entry; an undated one is a line under the Page heading.
- **Open thread**: anything the Owner intends to do (need to, want to, must, buy, call, read). It goes on `open-threads.md` only, never on a Page.
- **Self-observation**: about the Owner (moods, habits, health, values). The Dump is about the Owner, so the full quote goes on `me.md`. A topic it also names gets only the verbatim fragment naming it, on that topic's Page.
- **Bare shared link**: a `link` Dump whose body is only the URL, with a fetched sidecar. Make or update a `works/` Page: `status: saved`, a Timeline entry `Saved.`, and the line `The Owner shared it approvingly.` with the citation. It is never a Take.
- **No material**: an empty or accidental Dump, or a bare link that is unfetched. File it on no Page. Log it (see **`log.md`**).

A link Dump with the Owner's own words is not bare. Its main Page is always the linked work's Page in `works/` (an article, video, post), named from the sidecar title or the URL; the Owner's words are Takes (or facts, or Open threads) there. A topic the words also name gets only the fragment. If that link is unfetched, the Page gets the Unfetched callout and the log gets the `unfetched link` flag.

An image: the image text is material (facts about the thing, who said what); the Owner's words are the Take. Embed the JPEG (`![[<image file>]]`) only when the image *is* the thing: a photo of a place, a whiteboard, a cover. Never embed a screenshot of text; cite the Dump instead.

## Page or plain text

A thing gets a Page only when the Dump is *about* it: the Dump carries a Take, a Timeline entry or a fact about it. A passing mention stays plain text on the Page the Dump is about (link it if its Page already exists). An Open thread alone, or someone else recommending a thing, does not earn the thing a Page. Touch only the Pages a Dump names or is clearly about.

**Kinds** are the folders, and Ingest never changes a Page's kind:

- `people/`: individual humans only.
- `works/`: things someone made that the Owner consumes: books, episodes, articles, videos, films, courses, podcasts, posts.
- `topics/`: every other thing: ideas, practices, tools, products, companies.
- `projects/`: efforts the Owner is running.
- `places/`: only update a place Page that already exists. Do not create one; lint proposes them. Until then a place is plain text.
- `me.md`: the Owner.

## Lookup

Before you decide a Page is new:

1. Find the thing in `index.md` by Page name, alias or summary.
2. Grep `vault/wiki/` with your built-in search tool, excluding `log.md` and `digests/`, for its key terms and every alias you can think of: both scripts (Bangla and English), short and long forms, and spellings ("Star Cineplex", "স্টার সিনেপ্লেক্স").

Never conclude "new Page" until both come back empty.

**Create or update.** Update a Page only when exactly one Page matches by name or alias. Otherwise create a new Page; if any Page was a near or multiple match, flag `possible duplicate of [[<page>]]`.

## Page format

File name: short, lowercase, hyphenated, in the kind's folder (`works/dune-part-two.md`). The real name goes in `aliases:` and the `# Heading`. Aliases hold each name exactly as the Owner wrote it, in either script; add a new spelling to `aliases:` when a Dump uses one. Link with the alias: `[[dune-part-two|Dune: Part Two]]`.

```markdown
---
type: work
aliases:
  - "Dune: Part Two"
  - Dune 2
tags:
  - sci-fi
summary: "Denis Villeneuve's 2024 film; the Owner loved the sound and found the ending rushed."
updated: 2026-10-15
format: film
creator: Denis Villeneuve
url:
status: finished
started:
finished: 2026-09-14
---

# Dune: Part Two

The 2024 second part of Denis Villeneuve's adaptation of Frank Herbert's novel. *(general knowledge)*

## What I think

- 2026-09-14: "the sound design alone is worth the ticket" ([[2026-09-14-231000-iphone|Dump 14 Sep]])
- 2026-09-14: "ending felt rushed tbh" ([[2026-09-14-231000-iphone|Dump 14 Sep]])

## Timeline

- 2026-09-13: Watched it at Star Cineplex with Nadia. ([[2026-09-14-231000-iphone|Dump 14 Sep]])
```

- **Frontmatter**: `type` (person / work / topic / project / place), `aliases`, `tags`, `summary` (one line), `updated` (today's date, `YYYY-MM-DD`). Works also have `format`, `creator`, `url`, `status` (`saved`, `started`, `finished` or `dropped`), `started`, `finished`; leave a value empty when it is unknown. Keep the YAML flat (`key: value` and `  - item` lists), and wrap a value in double quotes when it holds `: ` or `#`, or starts with a quote or bracket.
- **Tags** are the categories: flat, lowercase, hyphenated, 1 to 3 per Page. Reuse a tag from `index.md` when one fits. A new tag is allowed but flagged `new tag <tag>`, once, in the entry of the first Dump that uses it. A tag never repeats a folder name or a Page name.
- **Under the heading**: on a new Page only, up to 2 lines about the thing itself. Each is either from the Dump or its sidecar (cited) or general knowledge (facts only, marked *(general knowledge)*). Owner-stated undated facts follow as `- ` lines, each cited.
- **`## What I think`**: current Takes, one per point, oldest first: `- YYYY-MM-DD: "verbatim quote" ([[<name>|Dump D Mon]])`. Use straight double quotes.
- **`## Timeline`**: dated events and dated facts, oldest first: `- YYYY-MM-DD: what happened. ([[<name>|Dump D Mon]])`.
- **Callouts**, after the heading lines:
  - `> [!warning] Unfetched` for a link that could not be fetched. Give the URL, and the title, description and reason if the sidecar has them.
  - `> [!warning] Disputed` for facts you cannot reconcile, each fact with its own citation.

**Citations.** Put one after every quote and every fact: `([[2026-09-02-071512-iphone|Dump 2 Sep]])`. An Addendum is cited as `([[<name>|Addendum 11 Sep]])`. The date is the Dump's `captured` day and month. Citations are wikilinks by name, so they survive the move from `inbox/` to `raw/`.

**Language.** Quotes stay verbatim in their original language and script. A quote that is not wholly English (Bangla, Banglish, or mixed) gets an English gloss in square brackets right after it: `"movie ta দারুণ ছিল, but too long" [the movie was great, but too long]`. Everything else on a Page is English.

## Takes over time

Before you add a Take to a Page, read the Page's current Takes. For each one, decide:

- **Same point**: the new Take answers the same question again (liked it or not, worth it or not, which part was good). It outdates the older Take. Move the older Take into a collapsed callout under the current list, never deleting it:

  ```markdown
  > [!note]- Earlier take, outdated 2026-10-20
  > - 2026-09-14: "ending felt rushed tbh" ([[2026-09-14-231000-iphone|Dump 14 Sep]])
  ```

- **Unsure**: the new Take qualifies, extends or half-contradicts the older one. Keep both as current Takes side by side and flag `unsure Take on [[<page>]]`. Example: "only the first half was any good", then later "actually the ending was good too". When in doubt between same point and a different point, you are unsure.
- **Different point**: it is about another aspect entirely. Add it.

- **One quote, several Pages.** The full quote goes on the Page the Dump is about. Each other Page gets only the verbatim fragment about it, with the same citation. Cut fragments; never reword them.

## Facts over time

- Never silently rewrite a fact. When the Owner states a change ("moved from Mirpur to Uttara"), keep the old fact as a Timeline entry with its old citation, and write the new one as a Timeline entry (and as the current line under the heading, if the old one was there).
- When you cannot tell a change from a mistake, put both facts in a `> [!warning] Disputed` callout, each cited, and flag `disputed fact on [[<page>]]`.

## Addenda

An Addendum adds a thought to an earlier Dump. It updates the Pages its original touched, dated and cited with the Addendum's own date. An opinion in it is a Take, or outdates one under **Takes over time**; a to-do is an Open thread.

- **By id**: `addendum_to: <name>` in the frontmatter. Grep `log.md` for `[[<name>]]`: the original's entry lists the Pages it created and updated. If the original is in this batch, file it first.
- **Free text "re ..."**: a Dump that starts with "re " and describes an earlier Dump ("re the dinner with Nadia"). Search the Dumps from the 30 days before its `captured`: those in this batch (in `inbox/`) and the filed ones (in `vault/raw/`, with their `log.md` entries). It matches only if exactly one Dump fits; then file it as an Addendum to that Dump. Otherwise file it as a normal Dump and flag `unmatched "re ..."`.

## Telegram Follow-up

Every Dump is a Telegram Dump. It is filed in this run like any other Dump, and it may get one Follow-up: a question the Owner answers later, which comes back as an Addendum.

Queue a line only when all of these are true:

- The Dump is about a work, a person or a topic: this run creates or updates a Page in `works/`, `people/` or `topics/` for it.
- It has no evaluative words, so it yields no Take.
- It yields no Open thread. A to-do never gets a question.
- It is not an Addendum (`addendum_to:`, or a "re ..." you are filing as one).
- `vault/follow-ups.md` does not already list its name, and `vault/telegram-questions.md` does not already list it (the second column is the Dump's name). At most once per Dump, never re-asked. Do not write `vault/telegram-questions.md`; `bin/ingest` records a sent question there.

The question is always `What did you think of it?`. If `vault/follow-ups.md` is missing, create it with the heading `# Follow-ups`. Append one line, and do not change any other line. The line is the Dump's name, a tab, then the question:

```
2026-10-21-132042-telegram	What did you think of it?
```

Do not send the question yourself. `bin/ingest` sends each line as a reply to that Dump's Telegram message and then removes it.

## `open-threads.md`

One line per Open thread, appended at the end, errands included:

```markdown
- [ ] Pay the internet bill (2026-09-15, [[2026-09-15-080000-iphone|Dump 15 Sep]])
- [ ] Watch the first Dune again before the book club (2026-09-14, [[2026-09-14-231000-iphone|Dump 14 Sep]], → [[dune-part-two|Dune: Part Two]])
```

Add `→ [[<page>|<Name>]]` when the Open thread relates to a Page. Never untick a ticked line. If the file is empty, start it with `# Open threads`.

## `me.md`

The Owner's own Page (`type: person`, heading `# Me`). Self-observations are Takes under `## What I think`, in the Owner's words; facts about the Owner go under the heading or on the Timeline. If the file is empty, give it the frontmatter and sections first.

## `log.md`

Append one entry per Dump, in filing order. If the file is empty, start it with `# Log`.

```markdown
## [2026-09-15] ingest | Dune: Part Two
- Disposition: New; Update
- Raw: [[2026-09-14-231000-iphone]]
- Created: [[dune-part-two|Dune: Part Two]]
- Updated: [[nadia|Nadia]], open-threads
- Flags: new tag sci-fi; unsure Take on [[dune-part-two|Dune: Part Two]]
```

- The heading date is today's date; the title is the main Page the Dump went to.
- `Disposition`: any of `New`, `Update`, `Disputed`, `Addendum`. `Raw` is always the Dump's name as a wikilink.
- Omit `Created`, `Updated` or `Flags` when empty. For an Addendum, add `- Addendum to: [[<original>]]`, plus `(matched "re ...")` when matched by text.
- Flags, exactly these words: `new tag <tag>`, `possible duplicate of [[<page>]]`, `unsure Take on [[<page>]]`, `disputed fact on [[<page>]]`, `unmatched "re ..."`, `unfetched link`.
- A No material Dump gets this entry, nothing else:

  ```markdown
  ## [2026-09-15] ingest | no material: 2026-09-15-021500-iphone
  - Disposition: No material (empty Dump)
  - Raw: [[2026-09-15-021500-iphone]]
  ```

  For a bare link that is unfetched, write `No material (bare link, unfetched)` and add `- Flags: unfetched link`.

## Housekeeping on every edit

On every Page you touch: refresh `summary` and set `updated` to today; keep a work's `status`, `started` and `finished` in step with its Timeline; write the log flags.

## Never

- Paraphrase a quoted Take, or delete an older Take.
- Untick a ticked Open thread.
- Delete, rename or merge a Page, or rename a tag. Only the Owner does, through `bin/review`.
- Revert the Owner's hand edits on a Page. Edit around them, even when they break this format.
- Write a Persona answer into the wiki.
- Write anything not in the Dump as a quote, or anything about the Owner that the Dump does not say.


