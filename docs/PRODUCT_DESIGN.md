# Snowball Control: product and interaction proposal

**Superseded interaction proposal:** use [PRODUCT_DESIGN_V2.md](PRODUCT_DESIGN_V2.md) for the current layout and user-story behavior. This file preserves revision 1 for design history; its permanent Read/Find/Back/Attention/Reject controls and variable right-knob assignment no longer apply.

Status: proposed for review, 2026-09-05. This documents the user's product direction; it does not change the running firmware. The existing 12-pattern showcase is intentionally a hardware and UI experiment, not a failed implementation of this design.

## Product promise

Control daily AI coding work from a physical console: choose a machine and harness, open a project and session, read progress, dictate a prompt, hear the answer, change supported session settings, and inspect workspace content.

The primary unit of context is `(machine, harness instance, project/worktree, session)`. A harness is the application/runtime owning the coding session, not its model provider. Two installations or accounts of the same harness can be separate instances. Selecting another machine never migrates a running session implicitly.

The proposed first milestone supports one host and one native adapter, but the data model supports multiple registered machines and consoles from the beginning. Both Snowball-created and pre-existing sessions belong in the product; pre-existing sessions advertise whether they can be viewed, resumed, or controlled live. No unsupported feature should appear to work.

## Hardware assumptions and limits

Current code identifies 20 independent 128 x 128 RGB565 key displays and one 428 x 142 top display, plus two rotary encoders with push actions. There is no established touchscreen input. The user identifies a built-in microphone and speaker; microphone routing, capture quality, and simultaneous playback/capture still require a hardware spike. Speaker/audio facilities are documented but not end-to-end voice validated.

Use the top display as one continuous reader. Do not distribute sentences or code lines across disconnected key displays. At an 8 x 16 font, reserve roughly 48 characters per line, one context line, five content lines, and one control/status line. This is a starting pixel budget, subject to physical readability tests and larger-font mode; it is not a promise that long code review is comfortable. The host renders Markdown into a bounded document model; the device renders text, never arbitrary HTML.

The key grid is a spatial action and selection surface. Each key shows one stable purpose, its current value or state, and optionally a small count. Long identifiers receive short distinct labels on keys and full names in the top reader. The host view and speak-out complement the small display without making a desktop necessary for basic reading.

## User stories and acceptance criteria

| ID | Story and assessment | Interaction | Acceptance criterion |
|---|---|---|---|
| U01 | Select a machine; essential context | Machine key; cached online/offline host cards; left knob chooses | Selecting a host does not send a prompt or change any running task. Duplicate names remain distinguishable. Offline hosts cannot receive control actions. |
| U02 | Select a harness first or second; essential | Harness key filters registered instances across hosts when no host is chosen | Machine-first and harness-first converge on the same valid pair. Unsupported pairs remain explicit; no silent substitution. |
| U03 | Select a project; essential | Project key, favorites/recent cards, voice find | Selection uses a host-owned project ID and canonical root/worktree. Same folder names on different machines do not collide. |
| U04 | Select or create a session; essential | Session picker; New opens a draft with destination visible | A saved session can be read without resuming. New requires an explicit Send to create/start work; running external sessions show the actual control capability. |
| U05 | Scroll/read session; essential | Read key; left knob scrolls lines, press expands a selected tool/message; turn-jump keys | Incoming events do not move a historical reading position. A New activity indicator returns to Live explicitly. Full text is retrievable, summaries are labelled. |
| U06 | Voice prompt; essential, hardware unverified | Hold Talk to record; release to transcribe; inspect draft; Send separately | Mic state is visible, draft remains bound to its original destination, release does not submit, interrupted capture is marked incomplete. Tap-to-record is an accessibility setting. |
| U07 | Response speak-out; essential | Speak reads the selected answer/block; press again stops; optional auto-read final answer | Playback identifies its source session, stops locally immediately, excludes raw tool logs/code by default, and never speaks another machine's answer unexpectedly. |
| U08 | Volume/mute; essential and local | Right knob default volume; push toggles mute | Works without host/network. Mute stops current audio and suppresses alerts; mic capture has a separate visible state. |
| U09 | Model selector; essential, capability-dependent | Model key opens supported options; right knob previews; push commits | Options come from the selected harness/account/version. UI distinguishes requested, pending, and effective model; incompatible effort is explicitly reset. |
| U10 | Effort selector; essential where supported | Effort key and value reel; same preview/commit behavior | Native levels are preserved. Unsupported is shown, not converted to a cosmetic Low/High knob. Changes show whether they apply now, next turn, or require restart. |
| U11 | Access level; essential, high consequence | Access opens Ask / Approved / YOLO with exact native scope shown | Increasing access needs explicit review and a separate confirm press. It never expands because of timeout, selecting another host, or reconnect. Host-enforced policy limits remain visible. |
| U12 | Browse workspace; essential | Workspace key; folder/file cards; left knob selects, press opens; Back parent | Read-only access is rooted in the selected project. Paths, symlinks, file sizes, and revision changes are handled. Large files page rather than fill device memory. |
| U13 | View code and Markdown; essential but screen-limited | Top reader, wrap, line/page movement; Changes opens a diff; More offers Open on host | Monospace code preserves indentation, Markdown supports headings/lists/code, long lines can wrap, and source revision is displayed. A summary never substitutes for an exact diff. |
| U14 | Review approvals and stop work; essential supporting story | Attention key opens the exact request; Send key explicitly relabels to Approve once inside that view; Reject and Stop stay fixed | No approval from an old screen or held key. Decision carries exact request identity. Timeout/disconnect never approves. Stop distinguishes requested, acknowledged, and stopped. |
| U15 | Register and move among consoles/hosts; essential platform story | More > Devices; pair/revoke; visible controller ownership | An unpaired console can discover a name but cannot read sessions/files/audio. One session's controller can be transferred explicitly; another console cannot replay an approval. |

## Default layout

### Desktop focus and manual selection

User-confirmed priority: **Codex first, then Antigravity and OpenCode**. Claude/Gemini are extensibility references, not first-release commitments.

Settings > Session selection offers **Follow desktop** or **Manual / pinned**. Follow desktop uses the reported foreground harness window and its selected session on the selected machine; it never substitutes the newest or busiest session. If several windows are open, use actual window focus plus a session identity from a supported integration. If focus cannot be resolved, show `Desktop focus unavailable` and retain the current selection. Background focus changes do not move a draft, recording, approval review, or historical reader; display a pending focus-change indicator and resume following when that activity ends. Manual selection pins the device until the user explicitly resumes Follow desktop. Persist this preference per console and machine. Discovering UI focus is observation, not proof of live-control ownership.

Add acceptance story U16: changing the focused desktop session updates a following console, a pinned console remains unchanged, ambiguous focus never selects a session by guess, and a pending draft keeps its original destination. More exposes the setting; Session shows `Following` or `Pinned`.

Position names below are visual rows top to bottom and columns left to right. The framebuffer IDs follow `get_mapped_key_index()` in current code; confirm chassis orientation with a numbered physical test before adopting the bindings. Do not infer numbering from the old schema's illustrative layout.

| Visual row | Left | | | | Right |
|---|---|---|---|---|---|
| 1: context | Machine (K17) | Harness (K13) | Project (K9) | Session (K5) | New (K1) |
| 2: inspect | Read (K18) | Workspace (K14) | Changes (K10) | Find (K6) | Back (K2) |
| 3: configure | Model (K19) | Effort (K15) | Access (K11) | Attention (K7) | More (K3) |
| 4: act | Talk (K20) | Send (K16) | Speak (K12) | Reject (K8) | Stop (K4) |

**Left knob: navigate.** Rotate to select or scroll the active reader; push opens the highlighted item or expands/collapses a block. Faster rotation accelerates long-list traversal, never approval decisions. Back is always visible. Reader shortcuts offer previous/next turn and Live; no hidden chord is necessary. Optional long push returns Home.

**Right knob: adjust.** Normally volume, push mute. In an explicitly opened model/effort/setting selector, rotate previews a value and push commits ordinary changes. A displayed footer always names the current assignment. Closing the selector returns to volume. Access escalation is staged by the knob but confirmed on the visibly labelled confirm key after review. The Speak key opens audio controls when needed during another setting edit.

Top and bottom rows stay in place. Pickers may repurpose the middle two rows into up to eight choice cards, with Back (K2) and More/Next page (K3) reserved. Pressing the initiating context key again closes its picker. The top reader shows the highlighted item's full name and explanation. The home layout returns when the picker closes.

Prefer this stable arrangement over a universal mode wheel that changes every key. It reduces navigation effort and keeps Stop reachable. Optional favorites may replace middle-row shortcuts later; context, Talk, Reject, and Stop must remain predictable.

### Top display states

| State | Continuous display | Keys and knob behavior |
|---|---|---|
| Home / live session | Compact machine + harness identity; session title; latest human-readable update; current knob legends | Context keys show selected values; Attention shows unresolved count |
| Picker | Full selected name, availability, and nearby options | Middle keys select cards; left moves focus; setting value uses right |
| Reader / file / diff | One context line; paginated body with line/turn location; Live/stale indication | Left scrolls; explicit turn/page keys; right remains volume |
| Recording / draft | Destination pinned; Recording/Transcribing/Draft state; transcript preview | Talk records, Send only submits a ready draft; Stop discards active capture after explicit draft-discard choice if text exists |
| Approval review | Machine, project/session, operation, scope, request number; scrollable exact details | Send becomes Approve once only after explicit entry; Reject declines that request; Stop interrupts its turn |
| Disconnected | Offline and age of cached content; last known session state | Reading and volume work; send/config/approve disabled; mic may create a local draft but cannot auto-send later |

Approval arrival raises Attention and an optional short sound; it does not steal reader focus or change Send while the user is dictating. Entering approval review requires a fresh press after all previously held keys are released. Returning restores the prior reading position and draft. Another device resolving it disables the stale approval immediately.

## Interaction vocabulary from the current showcase

| Existing pattern | Product use | Constraint |
|---|---|---|
| P1 same-label toggle | Mute, Live follow, optional auto-speak | Text/icon state accompanies color |
| P2 changing-label toggle | Speak/Stop speech, Record/Finish in accessible tap mode | Never turn harmless action into approval without entering a review view |
| P3 vertical list | Three nearby harnesses, access choices | Full explanation remains in top display |
| P4 vertical carousel | Model or session preview | Centered item is a preview until committed |
| P5 2x2 icon grid | Optional favorites/page position within a key | A key is one switch: four icons are not four touch targets; knob selects then press confirms |
| P6 horizontal strip | Reader modes: Conversation / Tools / Changes | One selected mode and visible label |
| P7 momentary hold | Push-to-talk | Release ends capture, not Send |
| P8 live number | Volume, unread count, recording duration | Only real measurements; no invented latency |
| P9 sparkline | Microphone level or audio playback activity | Local feedback; not model token activity disguised as voice |
| P10 pulse | Brief attention transition or confirmed recording indicator | Avoid perpetual decorative motion; support reduced motion |
| P11 circular dial | Volume/focus indicator with upright text | Rotating labels impair reading; retain ticks, keep words upright |
| P12 value reel | Effort/volume selection and numeric feedback | Continuous scroll for feedback, explicit commit for settings |

## Voice and reading decisions

Default voice path: local capture -> selected host speech-to-text -> device transcript draft -> explicit Send -> harness text prompt. This makes the same physical flow work across harnesses. A native harness voice adapter is optional only if it can preserve destination, draft review, cancellation, and acknowledgement semantics. Do not simulate a desktop dictation shortcut and assume the microphone source is the MK20.

Default speak-out path: selected assistant text -> host speech synthesis -> device playback. Stream sentence-sized chunks, identify the source turn, and stop/duck playback when recording starts. Start with half-duplex push-to-talk to avoid speaker feedback; full-duplex needs echo-cancellation and hardware validation. Choose local or configured cloud speech per host; expose that choice and keep credentials on the host. Do not upload audio in this design phase.

Do not auto-read tool output, code blocks, hidden reasoning, or all sessions. Speak can explicitly read a selected code block or exact approval details. Auto-read, if enabled, applies to final answers from the focused session. Voice correction uses re-record/replace or a host editor; a 20-key text editor is outside the first release.

## Access semantics

Ask means use the harness's configured interactive policy; it does not necessarily mean every read requires a keypress. Approved means a named, bounded grant (for example, workspace edits allowed and shell commands still asked). YOLO means the broadest no-prompt mode allowed by that harness and host policy, with exact remaining sandbox limits shown. These are proposed UX categories, not interchangeable native permission values.

The adapter supplies supported policy options, scope, effective enforcement, and when changes take effect. Separate approval policy from filesystem/network sandbox permissions. An attached session with read-only control cannot change policy. A session with pending approval cannot silently resolve it by changing access mode. YOLO is per session, visibly persistent while active, and is not the default for a new machine/session.

## Validation tasks before firmware integration

1. Show the physical key numbers and verify orientation, encoder direction/click, and held-key release behavior.
2. Read a 20-line answer and a short code diff at arm's length; measure readability and navigation errors, not only rendering speed.
3. Compare carousel versus simple list selection using long machine/project names. Keep literal content on the top display.
4. Capture microphone speech and play it back; establish ALSA devices, usable sample formats, gain, mute, underruns, and speaker feedback behavior.
5. Walk through machine-first and harness-first selection, draft destination locking, unsupported settings, offline state, and simultaneous approval/recording.
6. Keep the showcase runnable as a separate mode while implementing the product flow incrementally.

Related: [middleware proposal](MIDDLEWARE.md), [delivery roadmap](ROADMAP.md).
