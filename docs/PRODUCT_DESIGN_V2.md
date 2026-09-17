# Snowball Control interaction design — revision 5

Revision 5 adds a distinct editing-target treatment: filled keys indicate configured values; amber border plus `Editing` marks the one field currently being changed, mirrored on the top display. Applies to Project, Session, Model, Effort, and Access including access confirmation. See the portable simulator specification for details.

**Current specification:** [portable simulator and revision 4 behavior](simulator/README.md). This supersedes the older rules below concerning empty states, cascading resets, picker Close keys, and Workspace knob focus. Descendants now resolve automatically to remembered/first valid values. Context keys highlight committed selections. Project/session windows track knob navigation across all five row-3 keys. Workspace rotation scrolls five-item rows without selecting an item. The previous revisions below remain historical rationale, not conflicting implementation requirements.

## Revision 3: global rows and fullscreen modals (2026-09-06)

These user-approved rules supersede the temporary-navigation and question-pagination details below. The existing filename is retained for links.

- Session surface: row 1 holds context; row 4 holds voice and progress. Middle rows serve the current task. The right knob always controls volume/mute.
- Workspace and Settings open fullscreen modals over the current surface. Their own labeled icon occupies the upper-left key (K17); pressing it closes the modal and restores the prior surface and reading position. Opening a modal stops speech. Preserve session, draft, and navigation state; freeze automatic focus adoption while a modal is open.
- Workspace: row 1 is Workspace/Close, Up, Previous 15, Next 15, Stop. Rows 2–4 contain up to 15 folder/file tiles. This fullscreen browsing mode intentionally uses the bottom row for items. Left rotation moves focus and scrolls the grid by rows at the viewport edge; push opens the focused item. Up restores the parent directory and its selection. Selecting a file displays its contents on the top screen; left rotation then scrolls the file. Up returns to the file grid; Workspace closes the entire modal. Right volume/mute remains available; Speak is unavailable for file content.
- Settings uses the same upper-left close anchor, with General, Audio, Display, and Stop on the remaining top keys. The lower keys show settings for the selected category; unused keys stay dark.
- Questions use the upper three rows for three visible options, one option spanning five separately rendered keys. Left rotation scrolls one option row at a time through longer lists. Keep selection by stable option ID when offscreen. Row 4 remains Other (hold to dictate), Submit, Speak, Later, Stop. Permission prompts have no Other. Selection never submits implicitly; any segment of a row selects the same option.
- Modal and question key-map changes invalidate stale presses. Incoming requests remain pending against their original session; do not silently replace an active modal. Real incoming-event handling remains an integration task.

Review simulator: `snowball-controls-v3.html` in the thread visualization directory. File names/content and device settings are illustrative; it does not read the workspace, record audio, or control a harness. Browser checks covered fullscreen keys, file scrolling, return to session, Settings entry, and selection/submission after scrolling a seven-option question. Physical readability and incoming-event races remain untested.

Status: review proposal, revised 2026-09-05 following user feedback. This is the current interaction specification; PRODUCT_DESIGN.md is the superseded first proposal. The hardware showcase remains intact. First harness: Codex; next: Antigravity and OpenCode.

## Core flow

Machine and Harness are small collections: a few registered machines and normally fewer than three enabled harnesses. Each gets a self-contained display key. A press cycles to the next value; an on-key carousel shows the current value and position. No knob or top-screen picker is needed. A single available value is static. Cycle in stable registration order, not a changing online-status order; an offline machine remains identifiable and cannot receive commands. Settings manages registrations and enabled harnesses.

Either selector may be used first. Retain the other selection when valid; show an unavailable combination without silently choosing another harness. Every actual Machine or Harness change clears Project and Session, even when an identically named project exists at the destination. This clears the device selection only; it does not stop, move, or delete the previously selected task. A one-value/no-change press does not reset context.

Project selection always clears Session. Session and New require a valid project. Selecting a Session immediately shows its conversation on the top screen. New immediately shows an empty conversation for that project; a native session may be created lazily on the first explicit Send if required by the adapter. There is no Read button and no separate reading mode to enter.

Settings > Session selection chooses Follow desktop or Manual/pinned. Follow uses actual harness-window focus plus a reported session ID, never most recent activity. Manual context selection pins and suspends following so a desktop event cannot immediately undo the requested reset. Re-enabling Follow explicitly adopts a valid desktop context. Freeze following during draft/recording, question answering, and historical reading. Unknown focus leaves the current selection intact and reports unavailability. UI focus does not grant control ownership.

## Default hardware layout

Visual positions are top-to-bottom, left-to-right. Parenthesized IDs follow the current code's framebuffer mapping and still need a numbered chassis check.

| Row | Column 1 | Column 2 | Column 3 | Column 4 | Column 5 |
|---|---|---|---|---|---|
| Context | Machine (K17) | Harness (K13) | Project (K9) | Session (K5) | New (K1) |
| Settings/workspace | Model (K18) | Effort (K14) | Access (K10) | Workspace (K6) | Settings (K2) |
| Contextual | Previous turn (K19) | Next turn (K15) | Latest (K11) | Changes (K7) | Unassigned (K3) |
| Conversation | Talk (K20) | Send (K16) | Speak (K12) | Unassigned (K8) | Stop (K4) |

The middle contextual row changes with the active view. Previous/Next/Latest are optional direct shortcuts to the left knob, enabled only when useful. Empty keys stay dark rather than receive filler functions. No permanent Read, Find, Back, Attention, More, or Reject key.

**Left knob:** scroll conversation lines, navigate a larger project/session/file list, push to open the selected item or expand a question card. Avoid a knob-only requirement for the two small context selectors.

**Right knob:** volume; push mute. Keep it consistently available while browsing settings or answering questions. Model and effort selectors use direct choice cards (and the left knob for longer lists); they do not temporarily steal the volume knob. This replaces revision 1's context-dependent right knob.

**Top screen:** selected conversation by default, including question cards in chronological context. Project/session pickers and workspace/settings views temporarily use it for details. Closing returns to the same conversation position. Do not split conversation paragraphs or code across disconnected key displays. Retain the 428 x 142 pixel/physical readability constraint and use paged text. There is no touch input assumption.

## Temporary navigation

Project/Session opens a paged choice layout with direct item keys and optional left-knob navigation. Show a contextual Close key to return without selecting. Workspace shows folders/files; Up appears only where a parent exists, and Close/Session returns to the conversation. Opening a file shows a read-only continuous reader; Code/Markdown and diff views retain source/revision context. Long lists use paging; search is not required for first-release selection.

There is no keyboard on the device, so revision 1's Find key was premature. If search is added later, explicitly enter a labelled voice-search field and show its transcript before applying it, or use a companion text input. Never interpret a normal coding prompt as a search keyword implicitly.

Settings is the named destination for follow/pin preference, enabled harnesses, paired machines, audio behavior, display preferences and diagnostics. It is not a generic More bucket. Pairing/authentication mechanics remain in MIDDLEWARE.md.

## Questions and approval cards

Normalize a harness's UserAskQuestion-style event into a typed interaction card embedded in the conversation. When the selected session requires an answer, display that card on the top screen and temporarily replace the ordinary grid with answer rows. Context selection is not mixed with answer keys. Stop remains bottom-right (K4) as a deliberate emergency anchor; the rest of the grid can change.

Example for three choices:

```text
[ A ] [ Session ] [ reader  ] [         ] [         ]
[ B ] [ Voice   ] [ input   ] [         ] [         ]
[ C ] [ Workspace] [browser ] [         ] [         ]
[Other] [Submit  ] [ Speak   ] [ Later   ] [ Stop    ]
```

Each row is one logical option spanning five separate switches. Pressing ANY tile in the row selects that same option, including continuation/unused label tiles. All tiles highlight together. Break at words, not arbitrary character fragments like `Opt` / `ion`; keep full option text accessible on the top screen. A long label occupies more tiles, then continues in the reader; it never silently loses meaningful text. Color is accompanied by the option letter and a Selected/check indicator.

Selection stages an answer. Submit sends it. This permits inspecting a row, changing selection, and supporting multi-select questions without an accidental immediate response. In multi-select, a second row press toggles that option; Submit validates the required minimum/maximum. More than three choices uses a labelled Next options page, preserving staged selections. Multiple questions use question progress and explicit Next/Submit according to the harness contract. Disabled native choices remain disabled.

Other is present only if the request supports a custom answer. Hold it to dictate into this question's answer, release to review, then Submit. This is distinct from Talk sending a new agent prompt. For a free-text-only question, remap the grid to dictate/review/submit controls. Without microphone availability, offer a supported host-answer handoff rather than pretending text entry exists.

Permission requests use the same temporary surface with native choices such as Allow once and Deny. Reject/Deny exists here only when applicable. Do not manufacture Ask/Approve options for ordinary information cards, or map an informational question to permission approval. Access escalation is a separate settings confirmation, not a UserAskQuestion response.

Incoming remaps wait until held keys are released. Bind every rendered layout to an interaction ID and layout generation; a press begun before remapping cannot act on the new layout. During recording or draft review, defer takeover and keep the request in the timeline. Non-focused sessions do not seize this console. An unresolved card remains accessible by scrolling to it and pressing the left knob; no dedicated Attention key is needed.

Later dismisses the temporary answer layout but leaves the card pending. It is not a rejection. Reopening restores selection when the request is still valid. If another client resolves it, invalidate the option layout and show the outcome. Restore the previous conversation location after resolution. Disconnect, timeout and context changes never synthesize an answer.

## Voice, speak and stop

Talk is enabled in a selected/new conversation: hold to capture, release to transcribe/review, Send explicitly. Do not require an on-device keyboard. Optional tap-to-record belongs in Settings. Speech remains simulated until microphone and speaker hardware have been verified.

Speak is enabled only while speakable selected-session content is on the top screen, including the displayed question card. It is disabled in machine/project/session pickers, Settings, workspace/file viewers, recording and empty New conversations. A transcript draft is not an assistant response and does not enable automatic speak-out. Leaving session content stops speech. Pressing Speak again stops playback without interrupting the coding agent. Right-knob mute remains local and works in every view.

Stop remains at K4 and targets the selected task, or the request's owning task while answering. It also immediately stops local playback/capture. Display request/acknowledged/stopped states honestly; cancellation does not promise rollback. A stop during capture preserves any earlier draft and marks the interrupted capture, rather than silently sending or deleting it.

Changing Machine/Harness/Project/Session preserves unsent drafts under their original complete destination ID; a reset must not retarget them. A later matching session offers Restore draft explicitly. The simulated v2 keeps saved drafts in memory only and does not yet implement restoration or persistence.

## Reuse of current UI elements

Machine/Harness: P2/P4/P6 on-key current-value cycle; no top-screen picker. Model/Effort: P3/P4 direct selector cards; native options only. Follow/mute: P1 toggle. Talk: P7 hold and P9 mic level once real capture exists. Volume: P8/P12 value with optional P11 ticks and upright text. Questions: a new grouped-row composition of existing text/highlight primitives. P5's multiple icons remain one physical switch; separate choices must use separate switches or explicit selection. Pulse only marks a brief state transition, not a persistent distraction.

## Acceptance checklist (supersedes v1 interaction details)

- U01/U02: Machine and Harness each cycle two small fixture values using only their key; no selector view or knob change. Every actual change clears Project and Session.
- U03/U04: Project clears Session; Session/New disabled without project; selecting Session/New opens the top-screen conversation automatically.
- U05/U13: Left scroll and optional Previous/Next/Latest work; workspace Code/Markdown/diff is read-only; contextual Up/Close returns correctly.
- U06: Hold/release creates a destination-bound draft; Send is explicit. Context reset never submits or retargets it.
- U07/U08: Speak enabled for displayed session content and question cards only; leaving that content stops playback; right knob stays volume/mute.
- U09/U10/U11: Native model/effort/access capability limits remain; setting controls do not repurpose the volume knob; permission expansion is explicitly confirmed.
- U12: File navigation requires no keyword entry; Up/Close exists only in temporary navigation.
- U14: Question and permission events replace the grid; every segment of an option row selects the same answer; Submit is explicit; multi-select, free text, paging, stale IDs and held-key transitions have defined behavior.
- U15/U16: Settings owns registrations and follow/pin; manual context changes cannot be undone by an arriving UI-focus event.

The v2 simulator demonstrates the small selectors, cascading reset, session opening, conditional Speak, contextual navigation, single/multiple choice and permission rows, simulated dictation and Settings. It does not implement real harness events, audio, file paging, focus observation, draft restoration, or a production permission gate. The external Simulated event selector belongs to the demonstration, not the device layout.
