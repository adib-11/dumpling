# Second Brain

A personal, single-user store of everything the owner does, watches, reads and thinks, kept structured by AI so it can recall what the owner knows and answer as the owner would.

## Language

**Owner**:
The one person whose life the second brain records. The only user.
_Avoid_: user, author

**Dump**:
A raw, possibly vague piece of input the Owner hands over (text, voice note, link, screenshot), unstructured and unedited.
_Avoid_: note, entry, capture

**Recall**:
A question answered from what the Owner has stored ("what do I know about X", "what did I think of Y").
_Avoid_: search, lookup

**Persona**:
A question answered in the Owner's voice and judgement, extrapolating from stored opinions to things never explicitly stored ("how would I reply to this").
_Avoid_: clone, twin, impersonation

**Inbox**:
Where Dumps wait, untouched, until the next Ingest.
_Avoid_: queue, drafts

**Ingest**:
One run in which the AI takes the Dumps in the Inbox and files their knowledge into structured pages.
_Avoid_: sync, processing, import

**Follow-up**:
The single question the AI may send back about a Dump that carries no opinion ("what did you think of it?").
_Avoid_: prompt, clarification

**Addendum**:
A Dump the Owner adds later that points at an earlier Dump, adding a thought to it. Any number per Dump, before or after that Dump is filed.
_Avoid_: follow-up, reply, edit

**Private Dump**:
A Dump the Owner marks private when capturing it. It is never sent to a cloud model and never stored unencrypted off the Mac, so it is never filed into Pages, and Recall and Persona never see it.
_Avoid_: secret, sensitive, locked

**Page**:
One file in the store's wiki about one person, work, topic, project or place, written by Ingest.
_Avoid_: note, article

**Take**:
One dated opinion of the Owner's, quoted word for word from a Dump. A newer Take outdates an older one but never erases it.
_Avoid_: belief, stance, view

**Open thread**:
A to-do found in a Dump, kept on the single open-threads list until the Owner ticks it off.
_Avoid_: task, todo

**Style sample**:
A piece of the Owner's own unpolished writing (a WhatsApp reply with the message it answers, an Interview answer) that teaches Persona the Owner's voice. Writing polished by AI is never a Style sample.
_Avoid_: training data, corpus

**Interview**:
A session the Owner starts by hand in which Persona sends made-up incoming messages and opinion questions and the Owner answers in their own words. It is kept as one Dump.
_Avoid_: training, chat, fine-tune

**Digest**:
The weekly summary of what Ingest filed, for the Owner to review.
_Avoid_: report, changelog

## Relationships

- A **Dump** comes from the **Owner**, waits in the **Inbox**, and is filed by an **Ingest**
- A **Dump** gets at most one **Follow-up** (the AI asks) but any number of **Addenda** (the Owner adds)
- An **Addendum** is itself a **Dump**; the earlier Dump it points at is never edited
- A **Private Dump** waits in the **Inbox** like any Dump but no **Ingest** files it
- An **Addendum** to a **Private Dump** is itself a **Private Dump**
- An **Ingest** files a **Dump** into **Pages**: its opinions become **Takes**, its to-dos become **Open threads**
- A **Digest** covers every **Ingest** in its week
- **Persona** builds on **Recall**: it draws on the Owner's stored opinions and style
- **Persona** learns the Owner's voice only from **Style samples**; an **Interview** is a **Dump** whose opinions become **Takes** and whose answers are **Style samples**

## Example dialogue

> **Owner:** "I just dumped a link to that podcast plus 'loved the bit on sleep, disagree on caffeine'."
> **Dev:** "So one **Dump**. Later a **Recall** question like 'what do I think about caffeine?' should surface that disagreement, and a **Persona** question like 'should I have coffee at 4pm?' should answer the way you would."
