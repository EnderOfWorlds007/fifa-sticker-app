# Playwright + Chrome Testing From Codex

Use this when a Codex thread needs to test the deployed GitHub Pages app with the installed Chrome browser.

## Browser Runtime

Chrome is installed as a macOS app:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

Do not stop at "Chromium is not installed." Playwright can launch the installed Chrome app with `executablePath`.

The shell `node` may not resolve `playwright` from the repo. In this environment, the Codex runtime package is available here:

```text
/Users/ionut/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
```

Use an absolute import in temporary test scripts:

```js
import { chromium } from "/Users/ionut/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
```

Launch Chrome:

```js
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
```

This usually requires running the script with Codex shell escalation because it launches a GUI browser binary and needs network access.

## OCR Backend Auth

The deployed Pages app reads OCR settings from browser storage:

```js
localStorage.setItem("panini.recognitionBaseUrl.v1", "https://ionuts-macbook-pro.tail0bd2ca.ts.net");
localStorage.setItem("panini.ocrToken.v1", token);
localStorage.setItem("panini.debugReviewToken", token);
```

For local automated tests, read the token from:

```text
/Users/ionut/.panini-scanner/ocr.env
```

Do not print the token.

## Tailscale / Chrome Private Network Access

Headless Chrome can block GitHub Pages fetching the Tailscale backend with:

```text
Access to fetch at 'https://ionuts-macbook-pro.tail0bd2ca.ts.net/...' from origin
'https://enderofworlds007.github.io' has been blocked by CORS policy:
Permission was denied for this request to access the `local` address space.
```

Disabling Chrome features was not sufficient in this session. The reliable workaround is to let the deployed page run normally, but intercept backend requests with Playwright `page.route()` and fulfill them from Node. That bypasses Chrome's Private Network Access check while still testing the deployed frontend bundle, DOM, layout, and rendering logic.

```js
await page.route("https://ionuts-macbook-pro.tail0bd2ca.ts.net/**", async (route) => {
  const request = route.request();
  const headers = { ...request.headers(), authorization: `Bearer ${token}` };
  delete headers.host;

  const upstream = await fetch(request.url(), {
    method: request.method(),
    headers,
    body: request.method() === "GET" || request.method() === "HEAD"
      ? undefined
      : await request.postDataBuffer(),
  });

  const body = Buffer.from(await upstream.arrayBuffer());
  await route.fulfill({
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "access-control-allow-origin": "https://enderofworlds007.github.io",
    },
    body,
  });
});
```

## Example Visual Assertion

For `v2/photo-code-debug-review/`, a useful mobile test is:

1. Seed OCR backend/token storage.
2. Load the deployed Pages URL with a cache-busting query string.
3. Wait for `.slotListButton`.
4. Click the first card.
5. Assert `.debugCheck img` exists and has non-zero natural/client size.
6. Save a screenshot.

Example assertions:

```js
const result = await page.evaluate(() => {
  const checks = [...document.querySelectorAll(".debugCheck")].map((el) => {
    const img = el.querySelector("img");
    const rect = img?.getBoundingClientRect();
    return {
      label: el.querySelector("strong span")?.textContent?.trim() || "",
      hasImg: Boolean(img),
      srcPrefix: img?.getAttribute("src")?.slice(0, 30) || "",
      naturalWidth: img?.naturalWidth || 0,
      naturalHeight: img?.naturalHeight || 0,
      clientWidth: rect ? Math.round(rect.width) : 0,
      clientHeight: rect ? Math.round(rect.height) : 0,
    };
  });
  return {
    status: document.querySelector("#debugStatus")?.textContent?.trim() || "",
    slotButtonCount: document.querySelectorAll(".slotListButton").length,
    checkCount: checks.length,
    imageCount: document.querySelectorAll(".debugCheck img").length,
    checks,
  };
});
```

The debug-image fix was validated with:

```text
slotButtonCount: 23
checkCount: 7
imageCount: 7
each debug image: naturalWidth 900, naturalHeight 540, clientWidth 340, clientHeight 204
```

## Temporary Script Location

For throwaway scripts, use `/private/tmp/*.mjs`. Do not commit tokens or screenshots. Commit reusable instructions here instead.
