# SOL review: high-contrast estimated card geometry

Thread: `01a09218-bd86-7dc3-9bb3-b1f3a720f15a`

Status: Complete.

## Findings

- Use bright magenta `#ff5cf4` for estimated geometry. It is substantially distinct from the blue and green edition outlines and the amber actionable-review state.
- Draw a complete dash-dot estimated outline with a dark under-stroke. The pattern and text must communicate the state independently of color.
- Keep the accepted card identity visible inside the estimate. Geometry uncertainty must not downgrade an accepted code.
- Use the copy “Magenta dash-dot — Code accepted; card outline estimated” and keep “Amber dashed — Needs review” exclusive to actionable review states.
- Tapping inside the visible estimate may select it, but selection must not promote the geometry to resolved.
- Never feed display estimates into authoritative occupancy, overlap, correction, or persisted backend geometry.
- If a plausible card estimate is unavailable, retain the code-anchor marker rather than inventing an extent.

## Applied decision

The public app uses the backend's retained estimated polygon only for review display, calibrates implausible size against nearby resolved cards, and leaves the raw payload unchanged. The canvas renders a magenta dash-dot outline over a dark keyline with the accepted code centered inside it. `code_only` and other non-resolved states still fall back to their observed code anchor.

## Implementation review

SOL's first code-review pass requested four P2 corrections: reject implausible quadrilaterals, preserve magenta geometry during insignia-only review, display the catalogue name as well as the code, and make the legend swatch's dash-dot claim visually accurate. The implementation now includes all four corrections and behavioral regression coverage.

The first re-review found two further P2 edge cases: catalogue names could race the asynchronous projection load, and the insignia-review badge could be clipped off rotated cards. Projection loading now precedes review-slot normalization, while label clipping is isolated and badge placement interpolates from a polygon vertex toward its centroid.

Final re-review: **APPROVE**. No remaining P0, P1, or P2 findings. SOL independently verified deterministic catalogue-name fallback, rotated-card badge visibility, polygon plausibility and anchor fallback, independent magenta/amber state semantics, code-and-name labels, hit-testing consistency, and coherent V2 cache identity.

## Acceptance criteria

- Estimated cards with a four-sided polygon show a complete outline and readable code.
- Nearby resolved cards may calibrate a visibly undersized or oversized display estimate.
- Magenta dash-dot and amber dashed states remain distinct by hue, pattern, copy, and purpose.
- Review hit-testing follows the visible outline without persisting or authorizing the display correction.
- Missing estimates fall back safely to the observed code marker.
