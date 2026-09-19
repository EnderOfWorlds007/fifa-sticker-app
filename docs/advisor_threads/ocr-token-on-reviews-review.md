# SOL review: OCR token on Reviews

Thread: `01a0bb63-efad-7821-8a76-2f9fb0a467c0`

## Findings

- Reuse the existing OCR controller and browser-persisted URL/token settings; do not create a second credential store or embed a token in source.
- Put a compact, collapsed **OCR backend** panel near the top of Reviews so it is discoverable without displacing the review queue.
- Keep the token masked and make clear that changing it here also changes Scan on this browser.
- Keep Save and Test separate, disable Test while it runs, and expose status through an accessible live region.

## Risks

- Browser storage is readable by same-origin JavaScript, so the UI must not imply stronger security than browser-local persistence provides.
- Generic connection failures may hide whether the problem is authentication, network access, or an incompatible backend.
- A token must never appear in HTML, generated assets, logs, status text, or repository source.

## Recommendation applied

Add the existing URL, masked token, Save, Test, and status bindings to `v2/reviews/index.html`. Reuse `photo_scanner.js` initialization so values saved on Scan automatically load on Reviews and vice versa. Add a source-level regression test for the controls, live status semantics, password masking, and absence of an embedded value.
