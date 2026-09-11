# Client error observability

The V2 scanner retains privacy-safe diagnostics for OCR failures before it shows
an error to the user. This covers Scanner, Compare, and Trade photo uploads.

## What is retained

Each report uses a fixed schema containing opaque event, operation, request,
upload, and job identifiers; app build; timestamp; operation and phase;
categorical error code; retryability; HTTP status; attempt number; and the
browser's online/offline state.

Reports never contain the photo, OCR token, URL, request or response body,
free-form exception message, or stack trace.

## Delivery and recovery

- The browser writes each report to IndexedDB before scheduling delivery.
- Delivery uses the configured OCR backend and saved OCR token, without delaying
  the visible error message on network I/O.
- Offline, authentication, rate-limit, and server failures remain queued and are
  retried at startup, when connectivity returns, and after authenticated OCR
  success.
- Permanently rejected reports move to a local dead-letter store so one invalid
  record cannot block later diagnostics.
- The browser removes a queued report only after the backend acknowledges it.
- User-visible references are shortened opaque IDs that can be correlated with
  retained backend evidence.

The OCR backend owns server-side retention, authentication, schema validation,
and request/job correlation. Development evidence is retained without automatic
pruning.
