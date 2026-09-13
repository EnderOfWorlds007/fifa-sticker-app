# SOL review: browser OCR recovery coverage

- Thread: `01a09bd5-0418-7a00-9423-235763d5cdf1`
- Repository: `EnderOfWorlds007/fifa-sticker-app`
- Mission: Review the browser replay of lost photo-upload acknowledgement,
  Linux Chrome portability, and the expanded browser workflow.

## Initial verdict

No P0 or P1 findings. Two P2 test gaps were identified:

- The mock labelled every reconciliation request as `GET`, so an incorrect HTTP
  method could pass.
- The post-recovery assertion covered only the picker busy class rather than
  the complete restored UI contract.

## Resolution

- The mock records the actual request method and explicitly rejects anything
  other than `GET` during reconciliation.
- The browser test now checks the input, photo and camera controls, cancel
  visibility, `aria-busy`, button label, and busy styling after recovery.

## Final re-review

Verdict: **APPROVE** — no remaining P0, P1, or P2 findings.

## CI portability follow-up

The first GitHub Actions run exposed a Linux-only Chrome profile cleanup race
(`ENOTEMPTY` after the browser exited). Cleanup now uses the same bounded retry
policy as the established V2 browser harness. Test assertions and production
code were unchanged. The next run exposed that document readiness can precede
deferred ES-module evaluation on Linux; the test now explicitly awaits the
page's existing `need_lookup.js` module before clicking. Both changes remove
environment races without extending interaction timeouts or weakening behavior
assertions. The cleanup follow-up re-review verdict was **APPROVE**.
The module-readiness follow-up re-review verdict was also **APPROVE**.
