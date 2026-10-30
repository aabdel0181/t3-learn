# Side chats: product requirements

Status: draft for review · Owner: med · Date: 2026-10-22
Companion design: [2026-10-22-side-chat-design.md](./2026-10-22-side-chat-design.md)

## 1. The need

### The moment

med uses AI to learn new things. While learning about reinforcement-learning
environments, the AI kept assuming knowledge med didn't have. Each clarifying
question went into the main conversation, and each answer assumed something
else, so med asked again. A few rounds later, neither med nor the AI knew
where the actual lesson had stopped. The AI started treating the clarifications
as the topic.

The clarifying questions were not tangents. They were needed to understand the
lesson. What hurt was where they went: into the same conversation as the
lesson, where they used up the AI's attention and broke the thread for both of
them.

### What T3 Code offers today, and why it isn't enough

- **Cite** (select text in a reply → Cite) puts the quote into the _same_
  conversation's composer. That is exactly the path that derails the lesson.
- **Fork** (a hidden icon under each reply, shown on hover) copies the _whole_
  conversation into a new thread. The fork carries all the baggage, lives as a
  separate thread in the sidebar, and its way back is **Merge back** (hidden in
  thread details → Lineage), which replays up to ~16k of the fork's transcript
  into the parent.

Neither keeps the lesson clean, and neither is discoverable at the moment of
confusion.

### What a real solution looks like

The user needs to:

1. **Ask about one exact piece** of an answer, right where they're reading it.
2. **Get an answer at the right level.** The helper knows what is being taught
   and how far along they are, but not every word.
3. **Go as deep as needed.** A clarification can need its own clarification.
4. **Come back to exactly where they were**, with the lesson untouched.
5. **Have the main AI adjust only when it matters.** If the detour revealed
   something the teacher should know ("they didn't know what an observation
   space is"), the teacher hears it in one line. If not, nothing comes back.
6. **See the whole shape** of their detours when they've gone deep, and jump
   anywhere in it.

## 2. Users and surfaces

- People who learn by talking to an AI in T3 Code. They read long answers
  carefully, so clarifications come mid-read.
- v1 surfaces: **desktop app and web** (med uses T3 Code mostly on a Mac).
  Mobile is later, before any upstream proposal. v1 must not break the phone
  app.
- All providers T3 Code supports (Claude, Codex, Cursor, OpenCode, Pi, Grok,
  ACP agents).

## 3. Goals, non-goals, anti-goals

**Goals**

- The lesson conversation never contains side-chat traffic.
- Opening a side chat takes one action from a highlight.
- The side chat starts with enough context to answer at the right level.
- Returning is one action, and the lesson continues where it stopped.

**Non-goals (v1)**

- Mobile UI for side chats (viewing, opening, or the map).
- Letting the user read or edit the return note before it's sent.
- Side chats started from user messages, or from selections that span more
  than one reply.
- The main AI resuming on its own after a side chat ends.
- Syncing which side-chat panel is open across devices.
- Agent/MCP tools for opening and closing side chats.
- "Open side chat as a full thread".
- Slash commands or plan mode in the side-chat composer.
- An upstream pull request. That follows an upstream "Ideas" discussion once
  med loves the feature.

**Anti-goals (a failure even if it technically works)**

- Side-chat questions or answers leaking into the lesson's AI context.
- The main AI replying or changing course on its own when a side chat ends.
- The user having to manage, approve or tidy notes.
- Side chats cluttering the thread list.
- The app noticeably slower, or the phone app broken or cluttered beyond what
  an ordinary fork already causes.
- Losing the lesson view while asking (the side chat must sit beside it).

## 4. Requirements

Each requirement has acceptance criteria (AC) a tester can check.

### R1. Ask from a highlight

When the user selects text inside one AI reply, the selection toolbar offers
**Ask in side chat** next to **Cite**.

- AC: Selecting text in a finished AI reply shows both buttons. Clicking
  _Ask in side chat_ opens the side-chat panel with the selected text pinned at
  the top, and the cursor in the side-chat composer.
- AC: While that reply is still streaming, the button is disabled with a
  tooltip explaining why.
- AC: The same works inside a side chat (nested), starting a side chat whose
  parent is that side chat.
- AC: Keyboard: with a selection active, a shortcut opens the side chat.

### R2. Context going in: a summary plus the highlight

The side chat's AI receives a short summary of the parent conversation, the
highlighted text (with the sentence around it), and the user's question. It
does not receive the parent's full transcript.

- AC: The first prompt sent to the side chat's AI contains the summary and the
  excerpt and contains none of the parent's messages verbatim (beyond the
  excerpt).
- AC: For a nested side chat, the summary covers the chain: the lesson, plus
  the side chat it came from.
- AC: The summary starts being written the moment the user clicks Ask. If it
  still isn't ready when they send, sending waits briefly ("Preparing
  context…", capped at ~15s), then
  goes out with a minimal fallback: the lesson's topic and the paragraph around
  the highlight. It never falls back to a transcript.

### R3. Isolation

Nothing said in a side chat appears in, or is sent to, the parent, except the
optional note from R5.

- AC: After a side chat with several turns, the parent's next prompt contains
  none of the side chat's messages.

### R4. Nesting

Side chats can be opened from side chats, to any depth.

- AC: The panel's breadcrumb shows the path (Lesson › "observation space" ›
  "Box") and each crumb navigates there.

### R5. Done, and an optional note

**Done** ends a side chat. The AI reviews it and writes a one-to-two-line note
for the parent only if the parent's AI should teach differently because of it.
Otherwise no note is made.

- AC: Pressing Done closes the panel's side chat view (back to its parent side
  chat for nested ones, or the panel closes) without waiting for the note.
- AC: Done always works. If the side chat's AI is still answering, Done stops
  it first. Done also finishes any open side chats nested under it, and their
  notes feed into this one's note.
- AC: A side chat closed with no messages disappears. **Discard** (overflow
  menu) deletes a side chat without sending a note.
- AC: For a side chat where the user revealed a gap ("I didn't know what X
  was"), a note is produced. For a trivial side chat, no note is produced.
- AC: The user is never asked to approve or edit the note.
- AC: Pressing Done is optional. Sending a message in the lesson finishes every
  idle open side chat under it, and their notes ride along with that message.
  The same goes for sending in a side chat that has its own open side chats.
  A side chat whose AI is still answering stays open, and so does one nobody
  has written in yet, with its draft.

### R6. The lesson stays quiet; the note rides along

The parent does not start a turn when a side chat ends. Any ready notes go with
the user's next message in the parent, as context for the AI. They are not
shown as a message in the conversation. A collapsed "Side-chat notes included"
divider marks where they went in.

- AC: After Done, the parent shows no new AI activity.
- AC: The parent's next prompt contains every ready note from side chats that
  ended since its last turn, one line each, labeled with what was highlighted.
- AC: This holds when the parent is busy and the next message is queued, and
  when several side chats ended.
- AC: A note still being written when the user sends is waited for briefly
  ("Adding side-chat note…", capped at ~15s), and otherwise goes with the
  following message.
- AC: Notes go only with the user's own messages, never with automatic runs
  (wakes, scheduled tasks). Notes never make the lesson's turn fail. If they
  don't fit, they're dropped.

### R7. Reopen and redo

A finished side chat can be reopened and continued. Pressing Done again
replaces its earlier note if that note hasn't been delivered yet, and adds a
fresh note if it has.

- AC: Reopening shows the full side chat history and a working composer.

### R8. Marks in the lesson

Each highlight that started a side chat stays marked in the parent reply, with
a small tag that opens the side chat.

- AC: The mark survives scrolling, reloads and app restarts.
- AC: If the text can't be located any more (say the reply was re-rendered
  differently), the side chat is still reachable from a tag on that reply.
- AC: Opening a finished side chat shows the note it sent, or "no note sent".

### R9. Map

A **Map** tab in the right panel shows the lesson and all its side chats as a
**diagram** (boxes joined by lines, the lesson at the top), each labeled by its
highlighted text, with an open/done indicator. It may become an outline later.

- AC: A wide diagram scrolls inside the panel, and the current side chat is
  scrolled into view.
- AC: Clicking a side chat opens it in the panel. Clicking the lesson focuses
  the lesson.
- AC: Works with keyboard (arrow keys, Enter) and in light and dark themes.
- AC: Reachable from the command palette.

### R10. Housekeeping

- AC: Side chats do not appear in the left thread list. Selecting one keeps
  its lesson highlighted there.
- AC: Deleting or archiving a lesson does the same to its side chats.
- AC: A side chat never blocks cleanup of the lesson's worktree.
- AC: Approvals or questions raised by a side chat's AI are visible and
  answerable in the side-chat panel.

### R11. Compatibility and performance

- AC: An unmodified (official) T3 Code client, including the phone app, can
  still load every thread list and conversation from a server running this
  fork. Side chats may appear there as ordinary forks.
- AC: A client of this fork connected to an older server hides
  _Ask in side chat_ rather than sending something the server can't handle.
- AC: With a side chat open beside a streaming lesson, scrolling and typing
  stay smooth. No extra data is sent to the lesson's stream.

## 5. Success

- med runs a real learning session (like the RL one) with three or more side
  chats, including one nested, and the lesson picks up cleanly after each one.
  The AI's next lesson message reflects the notes where there were any.
- med says "I love it" and keeps using it for two weeks. That is the trigger
  for the upstream Ideas discussion.

## 6. Release

1. Build in med's GitHub fork of T3 Code, on a feature branch, merged into the
   fork's `main` through a pull request.
2. med uses it day to day as a **Mac desktop build of the fork**, downloaded
   from the fork's GitHub Releases, connected to projects on med's **Ubuntu
   machine, whose T3 Code server also runs the fork**. Both are built from the
   same fork commit, keep med's data, and have auto-update turned off. med
   switches the Ubuntu server with a one-line script that can also switch it
   back.
3. Write user docs (`docs/user/side-chats.md`), a short demo video, and a
   changelog entry.
4. When med loves it: open an Ideas discussion on `pingdotgg/t3code` with the
   demo. Add mobile support and agent tools if maintainers want them, then open
   the upstream PR, linked to the approved discussion.
