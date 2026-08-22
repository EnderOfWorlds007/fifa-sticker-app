# V2 child-friendly UX concept

Status: reviewed concept

This revision incorporates the SOL review recorded in
[`docs/advisor_threads/child-friendly-v2-ux-review.md`](advisor_threads/child-friendly-v2-ux-review.md).

## Product promise

The app should feel like a helpful sticker-album companion, not an inventory
database. A child should always be able to answer three questions without
reading instructions:

1. What can I do here?
2. What should I do next?
3. Did it work?

The interface should show one primary decision at a time, use concrete verbs,
preview changes before saving them, and keep recovery visible through Back,
Cancel, and Undo.

## Problems in the current experience

- Getting Started presents scanning, pasting, dictation, backend state, and
  album results together before the user understands the first goal.
- Collection exposes summary metrics, filters, sorting, paste updates, album
  review, activity, backup behavior, and up to 1,034 cards on one screen.
- Compare asks users to understand list direction before showing a result.
- Build Trade exposes lifecycle language such as draft, reserve, complete, and
  cancel before the user has assembled a trade.
- Technical terms such as OCR backend, normalized text, inventory snapshot,
  and variants compete with the task.
- Empty states describe the system but rarely give one obvious next action.

## Navigation model

Use four persistent destinations:

- **Home** — progress and the next useful action.
- **Album** — what is owned, missing, and newly added.
- **Trade** — compare a friend's list and manage an active exchange.
- **Scan** — add cards using the camera.

Keep clearly labelled Help and Settings outside the four primary destinations;
do not imply profiles unless profiles exist. Do not make onboarding, inventory
internals, review tools, or trade-state terminology primary navigation.

Within **Trade**, use one child-facing hierarchy: Check a friend's list, Start a
trade, Resume active trade, then a visually secondary History. Do not reintroduce
Compare, Build Trade, and Trades as separate concepts.

## Journey 1: first launch and first useful result

**Story:** Sam, age 9, opens the app with a partly filled album and no knowledge
of card codes.

1. **Welcome** — “What do you want to do?” with three large choices: Add my
   stickers, Find missing stickers, Trade with a friend.
2. **Resolve prerequisites** — if the collection is empty, say “First, show us
   what you already have,” offer Scan my album, Scan loose stickers, and Type a
   list, plus “I’m starting with an empty album.” Remember the original goal and
   return to it after setup.
3. **Camera coach** — show one example image and neutral tips: two pages visible,
   good light, hold still. Use checks only for conditions the app truly detects.
   Keep Take photo primary and “I know how” visible.
4. **Recognition review** — show “18 stickers found” and the exact net change:
   new, already owned, extra copies, and unreadable. Surface uncertain results,
   keep Review all visible, and allow replace, remove, or mark unreadable.
5. **Confirm and succeed** — Save 14 new stickers is the primary action. Then say
   “14 added · 4 already in your album,” with View my album primary and Scan
   another page secondary.

Success measure: a new user records the first real card without encountering
technical configuration or reading more than one short sentence per screen.

## Journey 2: check a friend's trade message

**Story:** Sam receives `JPN — 1, 5, 7 (x3), 15, 18 (x2), 20 (x2)` from a friend.

1. **Trade start** — choose Paste a message, Take a photo, or Type card numbers.
2. **Visible interpretation** — parse immediately, preserve every quantity, and
   always show “We read this as: your friend has these” with a prominent Change
   action. Auto-advance only at high confidence; otherwise ask the user to choose.
3. **Plain-language result** — two visual groups: “You need from them” and “You
   can give them.” Put “Already in your album” behind a small disclosure.
4. **Correct mistakes** — tapping any card changes or removes it before the
   trade starts.
5. **Start trade** — create the exchange with a single primary action. Store the
   parsed cards, not the friend's original message, unless the user opts in.

Success measure: a child can paste a list and explain the result aloud without
knowing the terms occurrence, inventory projection, or direction mode.

## Journey 3: complete a physical trade

**Story:** Sam is standing beside a friend and both are exchanging stickers.

1. Show two clearly separated baskets: **You give** and **You get**.
2. Add by scanning, pasting, or tapping a recent comparison result.
3. Show unavailable outgoing cards inline and explain what to do.
4. Replace lifecycle controls with one progressive action: Review trade, then
   Confirm trade. Put Save for later in a quiet secondary position.
5. On confirmation, show additions, removals, new extra copies, unavailable
   outgoing cards, unresolved cards, and any quantity changed since comparison.
6. Complete the exchange as one atomic update, block double submission, and
   finish with a calm success state and a visible, time-bounded Undo action.

Success measure: no trade can change collection state without a human-readable
review, and recovery is possible immediately after confirmation.

## Screen system

### Home

- Greeting plus one progress statement: “You found 742 of 1,034 stickers.”
- One prominent next action based on state, such as Scan another album page.
- Three compact actions: Add stickers, Check a trade, See missing.
- Resume an unfinished trade only when one exists.

### Album

- Default to teams, not 1,034 individual cards.
- Each team row shows a small progress bar and “17 of 20.”
- Opening a team reveals its cards; search remains available.
- Put bulk paste, album correction, backup, and reset under More tools.
- Separate routine tools from adult maintenance. Reset and restore require backup
  and explicit review and must never sit beside routine actions.

### Trade

- Start with the three input methods, not an empty result dashboard.
- Use “friend has” and “friend needs” in explanations; reserve Give/Get for the
  final two-sided basket.
- Results use card names and codes together where known.
- Hide counts, colors, or variants until they affect the exchange.

### Scan

- Begin with the camera, not a side selector and backend status.
- Infer front/back when possible; ask only after uncertainty.
- Translate technical availability into task language: “Scanner ready” or
  “Scanner is offline—type card numbers instead.”
- Keep advanced diagnostics out of the child-facing flow.
- Before first upload, say where the photo goes, whether it is kept, and how to
  delete it. Always provide a manual path when camera access is declined.

## Focused task shell

Capture, recognition review, and trade confirmation temporarily replace the
bottom navigation with a visible Back and Cancel. Warn only when leaving would
discard meaningful work. Save a resumable draft explicitly rather than implying
that every interruption is recoverable. Restore primary navigation on completion.

## Change and recovery contract

- A scan import, pasted bulk update, restore, reset, or completed trade is one
  atomic transaction: all intended changes are saved together or none are.
- The review names every addition, removal, already-owned card, extra-copy change,
  and unresolved card before confirmation.
- One-card toggles save immediately and show Undo; bulk or high-impact changes use
  a review screen first.
- Activity uses plain language and stores a pre-change snapshot. Undo survives a
  reload for its stated duration; after a later conflicting change, offer Review
  and restore rather than silently overwriting newer work.
- Disable confirmation while saving and make transaction IDs idempotent so a
  retry, double tap, reload, or interrupted response cannot apply twice.

## Tutorial strategy

- No long onboarding carousel. Teach one action immediately before it is used.
- Use a three-step coach for the first album scan and first loose-card scan.
- Provide “I know how” on every coach and remember completion per device and scan
  type. Required permission and safety messages are never skippable tutorials.
- Replay tutorials from Help using task names, such as “How to scan my album.”
- Use example content that can be safely tried without saving.
- After an error, explain the physical correction: move closer, add light, show
  both pages, or retake the photo.
- Never use tutorial text to compensate for an unclear primary action.
- Every core task must remain understandable and completable with tutorials off.

## Language rules

- Prefer: Add stickers, You give, You get, Friend has, Friend needs, Try again,
  Save for later, Scanner ready.
- Avoid in the main flow: OCR, normalized, occurrence, projection, snapshot,
  source, payload, reserve, transaction, backend, schema, variant.
- Buttons use a verb plus object and describe the immediate result.
- Empty states always offer one useful action.

## Visual direction

- Friendly album aesthetic with warm paper surfaces and one energetic accent.
- Large tap targets and high-contrast type; never rely on color alone.
- Use sticker silhouettes and album-page shapes as functional illustrations.
- Keep one filled primary button per screen.
- Use motion only to connect cause and effect, such as a scanned sticker moving
  into the album; respect reduced-motion preferences.
- Celebrate completed tasks briefly without obscuring the next action.

## Accessibility and child-safety constraints

- Target WCAG 2.2 AA contrast and 44-by-44-pixel minimum touch targets.
- Support 320-pixel-wide screens and 200% text without clipped actions.
- Pair icons with labels and preserve native focus order.
- Move focus to each new screen heading; announce concise status changes in a
  dedicated live region rather than making the whole screen live.
- Keep step names visible at narrow widths. Give card-correction controls names
  that include the card, current interpretation, and action.
- Test keyboard, VoiceOver/TalkBack, reduced motion, high contrast, and both color
  schemes, as well as 320-pixel width and 200% text.
- Do not expose destructive actions in routine action rows.
- Follow the Change and recovery contract for every collection-changing action.
- Explain network/device transfer truthfully; do not call processing local when a
  photo crosses devices. Minimize saved photos and message text.

## Required empty, error, and resume states

Each state needs a plain explanation, one safe primary action, and a manual or
cancel path where relevant:

- Camera permission denied, no camera, scanner offline, timeout, upload failure,
  storage failure, and privacy declined.
- No cards found, partial recognition, many uncertain results, duplicate rescan,
  unsupported code/edition, and conflicting variants.
- Outgoing card unavailable, stale quantity/draft, one-sided or empty trade,
  interrupted confirmation, and completion already applied.
- Back/reload during a wizard, abandoned tutorial, resumable draft, Undo expired,
  Undo conflict after later edits, failed restore, and shared-device use.

## Delivery sequence

1. Replace first launch with goal selection and the guided first-scan flow.
2. Create the simplified Home screen and reduce bottom navigation to four items.
3. Refactor Compare into input, interpretation, result, and Start trade steps.
4. Refactor Build Trade into basket, review, and confirmation steps.
5. Collapse Collection into team progress with advanced tools separated.
6. Implement the transaction, idempotency, activity, snapshot, and Undo contract.
7. Add the specified empty/error/resume states, privacy disclosure, contextual
   tutorials, accessibility behavior, and instrumentation.

## Validation plan

- Test with children and adults who have not seen the app.
- Give task prompts without explaining controls: add one sticker, find Messi,
  check a friend's list, and complete a two-card trade.
- Record first-tap accuracy, completion, time, requests for help, incorrect
  destructive actions, and whether participants can explain the result.
- Test empty, partial, nearly complete, and duplicate-heavy collections with
  multiple child age bands, reading abilities, languages, motor abilities, and
  assistive technologies. Test tutorial-on and tutorial-off conditions.
- Measure interpretation accuracy, correction discovery, accidental changes,
  recovery success, and whether users understand what was saved.
- Five consecutive independent completions are a release gate, not sufficient
  evidence on their own. Test adults separately on privacy, backup, scanner
  configuration, restore, and reset.
