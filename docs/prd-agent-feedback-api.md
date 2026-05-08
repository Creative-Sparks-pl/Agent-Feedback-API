# PRD: Agent-Feedback-API

## Introduction/Overview

Agent-Feedback-API is a small server that receives feedback submissions from AI agents and forwards them to Featurebase (the operator's feedback-tracking tool). The agent sends a simple JSON request — what kind of feedback it is, a title, the content, and an optional email — and this server adds the operator's private credentials and forwards the request to Featurebase.

The problem it solves: the agent is distributed as a bundle that anyone can install. If the agent talked to Featurebase directly, every installed copy would carry the operator's Featurebase API key. That key would let any recipient read every other recipient's submissions. The proxy keeps that key on the server and never lets it ship in the agent. Recipients install the agent without configuring anything, and all feedback lands in the operator's single Featurebase board.

## Goals

1. Keep the operator's Featurebase API key, board ID, and custom-field ID on the server only — never ship them in any agent bundle.
2. Accept a small JSON request from the agent, validate it, add server-side credentials, and forward an enriched request to Featurebase.
3. Reject requests that do not carry a valid shared bundle token, so the endpoint cannot be used as an open relay.
4. Return a simple, predictable response shape so the agent can show the user a clear success message or error without parsing complicated upstream errors.
5. Run on Vercel's free tier with no extra infrastructure (no databases, no external log services, no message queues).

## User Stories

The "user" of this API is the AI agent (specifically the `ux-designer` agent's feedback-intake helper), not a human end user. Phrasing below treats the agent as the actor.

1. **As the feedback-intake helper**, I want to send a small JSON payload with a Bearer token and receive a stable response, so I can submit feedback to Featurebase without ever touching the operator's API key.
2. **As the feedback-intake helper**, I want a clear error code when something goes wrong (`invalid_token`, `validation_error`, `featurebase_error`, `internal_error`), so I can present a meaningful message to the user without parsing free-text error strings.
3. **As the feedback-intake helper**, I want the success response to include the live Featurebase post URL, so I can show the user where their submission landed.
4. **As the operator**, I want unauthenticated requests rejected so the endpoint cannot be abused.
5. **As the operator**, I want to rotate the bundle token by changing one server-side environment variable and shipping a new agent bundle, with no other moving parts.

## Functional Requirements

1. The server must expose a single endpoint at `POST /feedback`.
2. The endpoint must accept JSON with these fields:
   - `type` — must be exactly one of: `Bug`, `Feature request`, or `Feedback`.
   - `title` — non-empty string.
   - `content` — non-empty string (HTML allowed).
   - `email` — either a valid-shape email string, or `null`.
3. Every request must include an `Authorization: Bearer <token>` header. The server compares the token against the `FEEDBACK_BUNDLE_TOKEN` environment variable. Mismatch or missing header returns 401 with error code `invalid_token`.
4. If the body is missing fields, has wrong field types, has an invalid `type` value, or has a malformed email, the server must return 400 with error code `validation_error` and a short message.
5. The server must build the outbound Featurebase request server-side, including:
   - `boardId` — from environment variable `FEATUREBASE_BOARD_ID`.
   - `customFields` — a single key from environment variable `FEATUREBASE_FIELD_TYPE_ID`, mapped to the request's `type` value.
   - `title` and `content` — copied verbatim from the request.
   - `author.email` — included only when the request supplied a non-null email; omitted otherwise.
6. The server must POST the outbound request to `https://do.featurebase.app/v2/posts` with the header `Authorization: Bearer <FEATUREBASE_API_KEY>`.
7. On a successful Featurebase response (2xx), the server must return 201 with body `{ "ok": true, "post_url": "..." }` where `post_url` is taken from the Featurebase response.
8. On a non-2xx Featurebase response or unreachable upstream, the server must return 502 with body `{ "ok": false, "error": "featurebase_error", "message": "..." }`. The message names the upstream status but does not leak Featurebase response internals.
9. On an unexpected exception, the server must return 500 with body `{ "ok": false, "error": "internal_error", "message": "..." }`. The message must be generic — no stack traces, no secrets.
10. The server must reject any HTTP method other than `POST` on `/feedback` with 405.
11. The server must log one line at request start and one line at request end. Logs must include status and outcome, but must never include: the raw token, the Featurebase API key, the full request body, or the user's email.
12. All four secrets — `FEATUREBASE_API_KEY`, `FEATUREBASE_BOARD_ID`, `FEATUREBASE_FIELD_TYPE_ID`, `FEEDBACK_BUNDLE_TOKEN` — must live in Vercel project environment variables. None of them may be committed to the repo.

## Non-Goals (Out of Scope)

- **No multi-tenant Featurebase setup.** All recipients submit to the same operator-owned board. Per-recipient Featurebase configuration is not supported.
- **No rate limiting at MVP.** The Bearer-token check is the only gate. If abuse appears, a per-IP rate limit can be added later.
- **No reading existing feedback.** The server is write-only. There is no endpoint to fetch, list, or reply to posts.
- **No external log service at MVP.** No Logflare, Axiom, or Datadog. Vercel platform logs only.
- **No automated integration test against Featurebase.** Featurebase has no public sandbox, so running tests against the real board would write garbage. Verification is a manual `curl` smoke test after each deploy.
- **No CORS configuration.** The agent runs in a CLI or IDE process, not a browser. Browser-origin requests are not supported.
- **No retry logic on the server.** If Featurebase is unreachable, the server returns `featurebase_error` immediately. The agent decides whether to retry or save the draft locally.
- **No additional endpoints at MVP.** No health check, no `/version`, no metrics endpoint. These can be added later if operational need surfaces.
- **No support for multiple boards or multiple custom fields.** A single board, a single field for category. Volume does not justify routing logic.

## Design Considerations

This is a headless API — there is no UI. The "design" is the request and response JSON shape, which is locked verbatim by the upstream agent project (`ux-designer` feedback-intake design doc, section 10). This server mirrors that contract; it does not redesign it.

The response shape is built for the agent to consume mechanically:

- Every response carries a top-level boolean `ok`.
- Success responses carry `post_url`.
- Error responses carry a short stable `error` code and a human-readable `message`.

The agent can branch on `ok` and `error` without parsing free text. Stable error codes are part of the contract: `invalid_token`, `validation_error`, `featurebase_error`, `internal_error`.

Logs are plain-text but `grep`-friendly — each line follows a `[feedback] <event> key=value` shape. No structured-log shipper at MVP.

## Technical Considerations

- **Hosting & runtime:** Vercel Node.js Serverless Functions, written in TypeScript. Same stack as Phantom-Browser, so contributors only need to learn one Vercel pattern.
- **Source layout:** Vercel convention. The handler lives at `api/feedback.ts`. Pure helpers (validator, outbound-payload builder) live under `lib/`. Tests live under `tests/`.
- **Dependencies:** as few as possible. The handler uses native `fetch` and `@vercel/node` types. No web framework, no validation library at MVP — the validator is hand-rolled and small.
- **Cold starts:** a few hundred milliseconds on the free tier. Acceptable because feedback submission is rare and follows a multi-sentence user description, so the user does not notice.
- **Function config:** `vercel.json` declares `maxDuration: 10` (one outbound HTTP call) and `memory: 256` (smallest reasonable).
- **Secrets:** stored in Vercel project environment variables for both production and preview deployments. Local development uses `.env.local`, which is gitignored.
- **Tests:** unit tests for the validator and the outbound-payload builder, run via `node --import tsx --test tests/**/*.test.ts`. No integration test against a live board.
- **Deploy:** GitHub push to `main` auto-deploys via Vercel. Vercel runs `tsc --noEmit` as part of build.
- **Token rotation:** rotating the bundle token requires updating the Vercel environment variable and shipping a new agent bundle. Cadence is annual, plus immediate rotation on any suspected leak.
- **Upstream contract:** owned by the `ux-designer` agent project. Do not change the request/response shape here without changing it upstream first and re-mirroring.

## Success Metrics

1. A `curl` POST against the deployed server, with a valid token and a well-formed body, creates a real post in the operator's Featurebase board with the correct category, and the server returns the live post URL.
2. A POST with a missing or wrong token returns 401 `invalid_token`.
3. A POST with a malformed body (missing field, wrong `type` value, empty `title`, empty `content`, malformed email) returns 400 `validation_error`.
4. A POST while Featurebase is unreachable returns 502 `featurebase_error`.
5. The `ux-designer` feedback-intake helper, running against the deployed server, completes the full end-to-end flow: user describes feedback, agent drafts and previews, user approves, server submits, helper announces the post URL.
6. Vercel platform logs show one start line and one end line per request, and no log line contains the raw token, the Featurebase API key, the full request body, or the user's email.

## Open Questions

None. All internal-build questions are resolved. External-contract questions are owned by the upstream agent project and resolved there.
