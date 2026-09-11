# SOL review: estimated recovered geometry implementation

- Thread: `01a091b9-b6ed-74d0-8464-3ebb767ea520`
- Mission: review the backend/mobile correction that preserves a recovered
  identity while refusing to present its unverified card boundary as resolved.
- Status: complete; final re-review approved.

## Mobile findings

The app preserves `geometry_status`, keeps a correctly matched identity and
insignia out of both review queues, and uses the observed code marker for
drawing, zoom, and hit-testing. Estimated geometry is displayed in a distinct
gold-dashed state with explicit “code accepted; card boundary estimated” copy.
The V2 cache update is internally consistent under `build-42a76c25ccf2`, and
the recovery page has a new pathname.

## Cross-repository finding and resolution

The initial review found that the backend review canvas still hit-tested the
hidden estimated full-card polygon. That P2 was fixed by using marker-only
geometry consistently for rendering, hit-testing, and phantom metadata,
excluding estimates from card-size calibration, and rejecting full-card
rotation corrections until the boundary is redrawn or resolved.

## Final verdict

APPROVE. No remaining P0, P1, or P2 findings.
