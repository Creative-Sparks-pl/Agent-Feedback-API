# PRD: Agent-Feedback-API

## Introduction/Overview

Agent-Feedback-API is a thin operator-hosted proxy service that forwards feedback submissions from distributed agent bundles (starting with `ux-designer`) to GitHub Discussions on the operator's feedback repo. Given a slim JSON payload (`type`, `title`, `content`, `email`) and a Bearer token, it validates the request, adds operator-only GitHub credentials, and creates a new Discussion in the matching category via GitHub's GraphQL API.

The problem it solves: agent bundles are distributed to recipient developers. If the agent called the destination platform directly, every recipient bundle would carry the operator's API token — exposing the operator's account. The proxy isolates the secret server-side; the bundle only carries a low-stakes shared token. The agent stays portable, the operator's credentials never leave the operator's infrastructure, and feedback from every distributed copy of the agent lands in one centralized place.

**Why GitHub Discussions** (FIN-008). The original platform target was Featurebase, but Featurebase Free plan paywalls API access entirely (Professional plan required). GitHub Discussions on a public repo is the closest free-API match: GraphQL `createDiscussion` mutation works on free public repos, native categorization, public portal, comments + emoji-reaction voting all built in.

## Goals

1. Hold the GitHub PAT and repo/category IDs server-side so they never ship in agent bundles.
2. Accept a slim agent payload, validate it, and forward an enriched GraphQL request to GitHub Discussions API with operator credentials.
3. Authenticate incoming requests via a static shared bundle token so anonymous public POSTs are rejected.
4. Return a structured response (`{ ok, post_url }` on success; `{ ok: false, error, message }` on failure) that the agent's helper can present to the user without further interpretation.
5. Deploy on Vercel free tier with no external infrastructure dependencies (no Redis, no external log service at MVP).
6. Honor the upstream-locked agent contract — the agent side already specifies the request shape, response shape, and error codes; this proxy must implement that contract exactly. Platform pivot from Featurebase to GitHub Discussions does not change the agent-facing contract.

## User Stories

The "user" of this API is the `ux-designer` agent (and future Markdown-Agents bundles), not a human end user.

1. **As the `ux-designer` feedback-intake helper**, I want to POST a slim feedback payload with a Bearer token, so I can ship the user's submission to the operator without carrying the operator's GitHub PAT in my bundle.
2. **As the `ux-designer` feedback-intake helper**, I want to receive a stable, structured response (success post URL or named error code), so I can present a clear result to the user without interpreting GitHub's GraphQL response shape.
3. **As the API operator**, I want unauthenticated requests rejected, so the endpoint is not abused as an open relay to my GitHub repo.
4. **As the API operator**, I want to rotate the bundle token without changing the proxy contract, so I can refresh credentials by updating one env var and shipping a new agent bundle.
5. **As the API operator**, I want a documented manual smoke test, so I can verify each deploy with a single `curl` invocation.

## Functional Requirements

1. The server must expose a single endpoint at `POST /feedback`.
2. The endpoint must accept JSON with these fields:
   - `type` — must be exactly one of: `Bug`, `Feature request`, or `Feedback`.
   - `title` — non-empty string.
   - `content` — non-empty string (HTML allowed; GitHub renders the safe subset).
   - `email` — either a valid-shape email string, or `null`.
3. Every request must include an `Authorization: Bearer <token>` header. The server compares the token against the `FEEDBACK_BUNDLE_TOKEN` environment variable. Mismatch or missing header returns 401 with error code `invalid_token`.
4. If the body is missing fields, has wrong field types, has an invalid `type` value, or has a malformed email, the server must return 400 with error code `validation_error` and a short message.
5. The server must build a GraphQL `createDiscussion` mutation server-side, including:
   - `repositoryId` from environment variable `GITHUB_REPO_ID`.
   - `categoryId` selected by the agent's `type`: `Bug` → `GITHUB_CAT_BUG_ID`, `Feature request` → `GITHUB_CAT_FEATURE_ID`, `Feedback` → `GITHUB_CAT_FEEDBACK_ID`.
   - `title` from the request, verbatim.
   - `body` from the request's `content`, with a footer line appended (`_Reply-to: <email>_` when email is supplied; `_Submitted anonymously._` when null).
6. The server must POST the GraphQL request to `https://api.github.com/graphql` with `Authorization: Bearer <GITHUB_TOKEN>`, `Content-Type: application/json`, `Accept: application/json`, and `User-Agent: agent-feedback-api`.
7. On a successful GitHub response (HTTP 2xx with `data.createDiscussion.discussion.url` populated), the server must return 201 with body `{ "ok": true, "post_url": "..." }` where `post_url` is the Discussion URL.
8. On a GitHub error (HTTP 2xx with non-empty `errors` array, OR HTTP non-2xx, OR missing `discussion.url`), the server must return 502 with body `{ "ok": false, "error": "featurebase_error", "message": "..." }`. The error code name `featurebase_error` is preserved despite the platform pivot to keep the agent-side failure-handling branch (FIN-013 upstream) working without a coordinated change; treat it as "upstream platform rejected" semantically.
9. On an unexpected exception, the server must return 500 with body `{ "ok": false, "error": "internal_error", "message": "..." }`. The message must be generic — no stack traces, no secrets.
10. The server must reject any HTTP method other than `POST` on `/feedback` with 405.
11. The server must log one line at request start and one line at request end. Logs must include status and outcome, but must never include: the raw token, the GitHub PAT, the full request body, or the user's email.
12. All six secrets — `FEEDBACK_BUNDLE_TOKEN`, `GITHUB_TOKEN`, `GITHUB_REPO_ID`, `GITHUB_CAT_BUG_ID`, `GITHUB_CAT_FEATURE_ID`, `GITHUB_CAT_FEEDBACK_ID` — must live in Vercel project environment variables. None of them may be committed to the repo.

## Non-Goals (Out of Scope)

- **No multi-tenant setup.** All recipients submit to the same operator-owned feedback repo. Per-recipient routing is not supported.
- **No rate limiting at MVP.** The Bearer-token check is the only gate. If abuse appears, a per-IP rate limit can be added later.
- **No reading existing Discussions.** The server is write-only. There is no endpoint to fetch, list, or reply to Discussions.
- **No external log service at MVP.** No Logflare, Axiom, or Datadog. Vercel platform logs only.
- **No automated integration test against GitHub's live API.** Verification is a manual `curl` smoke test after each deploy.
- **No CORS configuration.** The agent runs in a CLI or IDE process, not a browser. Browser-origin requests are not supported.
- **No retry logic on the server.** If GitHub is unreachable, the server returns `featurebase_error` immediately. The agent decides whether to retry or save the draft locally.
- **No additional endpoints at MVP.** No health check, no `/version`, no metrics endpoint. These can be added later if operational need surfaces.
- **No support for multiple repos or dynamic category creation.** A single feedback repo, three pre-created categories captured as env vars. Volume does not justify routing logic.
- **No write access to non-Discussions GitHub resources.** The PAT is scoped to `Discussions: read and write` on the feedback repo only — it cannot create Issues, modify code, or read other repos.

## Design Considerations

This is a headless API — no UI. The "design" is the request and response JSON shape. The agent-facing fields are locked verbatim by the upstream `ux-designer` design doc §10 — the proxy implements that contract; it does not redesign it. The platform pivot from Featurebase to GitHub Discussions did not change the agent-facing fields (the slim payload `{ type, title, content, email }` is platform-agnostic by design).

The response shape is built for the agent to consume mechanically:

- Every response carries a top-level boolean `ok`.
- Success responses carry `post_url` (now pointing to a GitHub Discussion).
- Error responses carry a short stable `error` code and a human-readable `message`.

Stable error codes are part of the contract: `invalid_token`, `validation_error`, `featurebase_error`, `internal_error`. The `featurebase_error` name is intentionally preserved across the platform pivot to avoid a coordinated change with the agent's failure-handling branch.

Logs are plain-text but `grep`-friendly — each line follows a `[feedback] <event> key=value` shape. No structured-log shipper at MVP.

## Technical Considerations

- **Hosting & runtime:** Vercel Node.js Serverless Functions, written in TypeScript. Same stack as Phantom-Browser.
- **Source layout:** Vercel convention. Handler at `api/feedback.ts`. Pure helpers (validator, GraphQL request builder) under `lib/`. Tests under `tests/`.
- **Dependencies:** as few as possible. The handler uses native `fetch` and `@vercel/node` types. No GraphQL client library, no web framework, no validation library at MVP — the validator is hand-rolled and small, and GraphQL requests are plain JSON-over-HTTP.
- **Cold starts:** a few hundred milliseconds on the free tier. Acceptable because feedback submission is rare and follows a multi-sentence user description.
- **Function config:** `vercel.json` declares `maxDuration: 10` and `memory: 256`.
- **Secrets:** stored in Vercel project environment variables for both production and preview deployments. Local development uses `.env.local`, which is gitignored.
- **Tests:** unit tests for the validator and the GraphQL request builder, run via `node --import tsx --test tests/**/*.test.ts`. No integration test against GitHub's live API.
- **Deploy:** GitHub push to `main` auto-deploys via Vercel. Vercel runs `tsc --noEmit` as part of build.
- **Token rotation:** rotating the bundle token requires updating the Vercel environment variable and shipping a new agent bundle. Cadence is annual, plus immediate rotation on any suspected leak. The GitHub PAT rotates separately on its own expiry (1 year recommended) — PAT rotation does not require a new bundle.
- **Upstream contract:** the agent-facing payload is owned by the `ux-designer` agent project. Do not change the request/response shape here without changing it upstream first and re-mirroring. The outbound mapping (now GitHub Discussions GraphQL) is owned in this repo and tracked by FIN-008.

## Success Metrics

1. A `curl` POST against the deployed server, with a valid token and a well-formed body, creates a real GitHub Discussion in the operator's feedback repo with the correct category, and the server returns the live Discussion URL.
2. A POST with a missing or wrong token returns 401 `invalid_token`.
3. A POST with a malformed body (missing field, wrong `type` value, empty `title`, empty `content`, malformed email) returns 400 `validation_error`.
4. A POST while GitHub's API is unreachable returns 502 `featurebase_error`.
5. The `ux-designer` feedback-intake helper, running against the deployed server, completes the full end-to-end flow: user describes feedback, agent drafts and previews, user approves, server submits, helper announces the Discussion URL.
6. Vercel platform logs show one start line and one end line per request, and no log line contains the raw token, the GitHub PAT, the full request body, or the user's email.

## Open Questions

None on the build side. Open on the operator side: which GitHub org owns the feedback repo (defaulting to Creative-Sparks-pl), whether to attach a custom domain to the Vercel deployment, what cadence to revisit Featurebase pricing in case the API access becomes free in the future.
