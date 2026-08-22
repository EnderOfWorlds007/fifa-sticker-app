# SOL review: V2 child-friendly UX

Thread: `01a02b13-7b0b-7bf0-91be-d8d0aca08c15`

## Assumptions

- Primary users include independent readers around age 9, with adults assisting younger children.
- The collection is stored locally; scanning may send photos to the configured Mac backend.
- A completed trade atomically updates owned quantities and duplicates.
- The storyboard is conceptual, not an accessibility-complete implementation.

## Overall finding

The proposal is a substantial improvement over the live v2 product. The four-destination model is coherent, the first-scan journey is understandable, and the language is markedly clearer. It is not yet implementation-ready: recovery semantics, trade direction, quantity handling, first-launch prerequisites, privacy messaging, and several failure states remain underspecified.

## Must-fix

### Define real transaction and Undo semantics

- Make scan imports, pasted bulk updates, restores, resets, and completed trades atomic transactions.
- Before confirmation, show exact additions, removals, already-owned cards, duplicate-count changes, and unresolved cards.
- Prevent duplicate submission and double completion.
- Define Undo duration, persistence across reload/relaunch, and behavior after later collection changes.
- Keep a plain-language activity record and support restoring the pre-change snapshot.
- Use immediate toggle plus visible Undo for one sticker; reserve confirmation for bulk or high-impact changes.
- Require a backup/review step for reset and restore.

### Do not silently infer trade direction

- Always show “We read this as: your friend has/needs these” with a prominent Change action.
- Auto-advance only at high confidence; ask explicitly when confidence is lower.
- Preserve quantities throughout recognition, comparison, baskets, review, and completion.
- Test mixed messages with offers and needs, negation, corrections, multiple teams, and informal language.
- Do not save the original friend message by default; retain parsed card data unless the user chooses otherwise.

### Fix first-launch prerequisite dead ends

- If the collection is empty, keep the selected goal but first ask the user to show what they own.
- Return to the original goal once the initial inventory exists.
- Offer “I’m starting with an empty album.”
- Distinguish stickers found from stickers newly added.

### Make recognition review honest and safe

- Show the net collection change before saving and keep Review all visible.
- Explain uncertain results individually and allow replace, remove, or mark unreadable.
- Handle zero results, many uncertain results, partial pages, duplicate scans, unsupported codes, and conflicting variants.
- Do not show verified checkmarks for lighting or framing unless the app actually detects those conditions.

### Add safety-critical states

Design and test camera denial, no camera, scanner offline, timeout, upload/storage failure, no or partial recognition, unsupported codes, duplicate rescans, unavailable outgoing cards, stale drafts, interrupted confirmation, wizard resume/cancel, Undo expiry/conflict, failed restore, and shared-device use.

## Should-fix

- Keep Home, Album, Trade, and Scan, but make Trade internally: Check a friend’s list, Start a trade, Resume active trade, then secondary History.
- During capture, review, and confirmation, use a focused task shell with Back and Cancel instead of competing bottom navigation.
- Put Skip or “I know how” on every tutorial coach; remember it per device and scan type and make Replay available from Help.
- Specify focus movement, concise status announcements, meaningful correction labels, visible step names at narrow widths, reduced motion, high contrast, screen reader tests, and 200% text support.
- Explain where photos are sent, retention and deletion before upload; provide manual input if permission or privacy consent is declined.
- Separate child-facing routine tools from adult maintenance tools such as reset, restore, device transfer, and scanner configuration.

## Later

- Prefer concrete progress such as “17 of 20” and avoid pressure-based streaks or celebration.
- Expand research beyond five consecutive successes across ages, reading abilities, languages, motor abilities, collection states, and assistive technologies.
- Test adults separately on privacy, backup, scanner configuration, restore, and reset.

## Priority summary

- **Must-fix:** transaction/Undo model, explicit trade interpretation, first-launch prerequisites, honest recognition review, and failure/recovery states.
- **Should-fix:** Trade hierarchy, focused task navigation, skippable tutorials, dynamic accessibility, privacy wording, and maintenance-tool separation.
- **Later:** motivational refinement and broader validation coverage.
