---
name: ask
description: Answer a Recall or Persona question from vault/wiki/, citing repo paths. Writes nothing.
---

# Ask

Answer one question from `vault/wiki/`. These rules are spec §8 (`docs/spec/v1.md`); this file is the working copy. On the Mac, the Owner runs it from this repo with opencode (`--agent ask`) or Claude Code. On the iPhone, a Claude Code cloud session on this repo runs the same skill against the vault as last pushed. One new session per question; follow-ups to that question stay in the session.

The evidence ladder adapts soul.md's source priority (`aeonfun/soul.md` `SKILL.md` at commit `bada2485099752e73c08c9906d75b8d7ca7d58de`, MIT). The correction log adapts write-like-me's learning loop (`sheryldeakin/write-like-me` `docs/learning-loop.md` at commit `b52802ee453b9486930f59a5a79121694c9b2a0d`, MIT).

## Fences

- Write nothing into the wiki. A Persona answer is never a Page, a Take, or a `log.md` line.
- The only files you may write are `persona/corrections.md` and `persona/STYLE.md` when a correction is promoted. A promoted rule may create `persona/STYLE.md`. Do not write a voice guide into it.
- Never commit, never push, never `git add`. A cloud session must not push.
- Never read `vault/private/`. Recall and Persona do not see a Private Dump. Do not open it, grep it, or cite it. In the cloud those files are git-crypt ciphertext. Do not decrypt them, and do not run `git-crypt`.
- Never add general knowledge. No staleness warning.
- Do not start a subagent. Do not fetch the web. Do not load any skill but this one. Read files, grep with the harness's built-in grep, and run only `git log -1 --format=%cs -- vault/wiki`. No other shell command.

## Which kind

Infer Recall or Persona from the question and say which. The first line is `Recall.` or `Persona.`.

- **Recall.** What the Owner knows or thought ("what do I know about X", "what did I think of Y", "show me", "how has my view changed?").
- **Persona.** A reply the Owner would send, or the Owner's judgement on something not already settled ("how would I reply", "should I", "what would I say").

## Lookup

The same rule as spec §5. Never say something is absent, and never write "You haven't said.", until both come back empty.

1. Read `vault/wiki/index.md`.
2. Grep `vault/wiki/` with the harness's built-in grep, excluding `log.md` and `digests/`, for the key terms and their aliases: both scripts, short and long forms, and the spellings the Owner has used.

A path under `vault/private/` is not a result. Skip it. Do not grep from the repo root.

## Citations

Citations are repo paths.

- A verbatim quote cites its Dump, the file under `vault/raw/`.
- A paraphrase cites its Page, the file under `vault/wiki/`.
- For a bare shared link, you may say "you shared this" and cite that Dump. It is not a Take.

## Close

Every answer ends with this line and nothing after it:

`Filed up to <date>`

`<date>` is the output of `git log -1 --format=%cs -- vault/wiki`, run from the repo root. If that prints nothing, the line is `Filed up to (no vault/wiki commit)`.

## Recall

- The question decides the length. By default, a short gist that links the Page by its repo path. Quotes and older Takes only when the question asks to see them ("show me", "how has my view changed?"). When that question asks how the Take changed, quote the current Takes, then the ones in the `Earlier take` callout, each with its Dump path.
- Nothing stored: the first sentence is "You haven't said." Then point at the nearest stored thing, a real Page from the index. Never add general knowledge.
- You may say "you shared this" for a bare shared link.

## Persona

Always two parts, in this order, with these headings:

**What you've said**

Relevant current Takes, quoted, each with its Dump path. If none bear on the question, write "nothing close".

**Guess**

Read `vault/wiki/me.md` and the relevant Takes. Rank the evidence you used:

1. **stored** — a current Take states this. Use it.
2. **covered** — the Pages or `me.md` already contain the point: a fact, a Timeline entry, or a line the Owner wrote.
3. **adjacent** — the point sits next to a known Take. Extrapolate from the worldview on `me.md`, not from that Take alone.
4. **novel** — nothing close. Reason from the worldview on `me.md`, and label the guess "low confidence, from your general leanings".

A bare shared link is weak evidence, used only inside Guess.

- First person when drafting something the Owner will send: write the draft as the Owner, in the first person. "you'd…" when the Owner asks for their own judgement.
- Drafting in the Owner's voice: if `persona/STYLE.md` has voice sections, load it and grep `persona/samples/` for 3 to 5 reply pairs with the same person or a similar message. A pair is the other person's message, then the Owner's reply. Use them as few-shot examples. Mirror the language of the message being answered (Banglish in the Owner's spellings, or simple English) unless the Owner says otherwise.
- If `persona/STYLE.md` is missing, or it holds only promoted rules, say the voice isn't available yet and give a plain, neutral draft. Build 15 adds the voice sections and the samples.

### Corrections

When the Owner corrects a draft, append one dated before/after pair to `persona/corrections.md`:

`YYYY-MM-DD: "before" -> "after"`

The date is the day of the correction. If nothing new was corrected, write no line.

The second time the same pattern appears, add it as a standing rule in `persona/STYLE.md`, creating the file if it does not exist. Write only that rule. Suffix the log line `(promoted to STYLE.md, YYYY-MM-DD)`. Do not delete the pair.

A newer pair that contradicts an older one wins. Suffix the old line `(superseded YYYY-MM-DD)`. Do not delete it.


