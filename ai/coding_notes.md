# Coding Notes and Minimal Fix Guidance

## Startup script
The supplied startup script launches `store-api.js` and `src/server.js` with environment variables. No obvious syntax error was identified from the snippet alone.

Relevant configuration:
- Store API port defaults to `4000`.
- Help desk port defaults to `3000`.
- `STORE_API_URL` defaults to `http://localhost:<storePort>`.

Potential deployment caveat: `localhost` is only appropriate when the app can reach the store API in the same network namespace. This was a caveat, not a confirmed bug.

## Frontend accessibility checklist
1. Use visible `<label>` elements associated with inputs by matching `for` and `id`.
2. Prefer native controls so keyboard navigation works by default.
3. Keep focus indicators visible, e.g. with `:focus-visible`.
4. Use semantic landmarks and headings.
5. Announce errors and status changes using an appropriate live region; avoid redundant announcements.
6. Mark loading regions busy while a request is in progress.
7. Associate validation text with its field and reflect invalid state when appropriate.

## Missing inputs for a precise review
The conversation did not include the actual lookup page HTML/template, CSS, or frontend JavaScript. Those are needed to identify specific accessibility defects and provide exact minimal patches.
