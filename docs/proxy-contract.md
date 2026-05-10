# Proxy Contract

This is the external contract for the Agent-Feedback-API proxy: the request shape from the agent, the proxy's response shape, error codes, env vars, and the outbound mapping to GitHub Discussions.

**Ownership.** The agent-facing request shape (request body + Authorization header + response shape on success) is owned upstream at `d:\Dev\Markdown-Agents\agents\ux-designer\projects\2026-05-07-feedback-intake-workflow\plans\2026-05-07-feedback-intake-design.md` §10 — do not change those fields here without changing upstream first. The **outbound mapping to GitHub Discussions** is owned in this repo (tracked by FIN-008 — platform pivot from Featurebase due to Free-plan API paywall).

---

## Endpoint contract

### Request

```http
POST /feedback HTTP/1.1
Host: <operator's proxy hostname>
Authorization: Bearer <BUNDLE_TOKEN>
Content-Type: application/json

{
  "type": "Bug" | "Feature request" | "Feedback",
  "title": "Wireframe export drops trailing whitespace",
  "content": "<p>When I export a wireframe via Download MD button, trailing whitespace in copy fields gets stripped.</p>",
  "email": "user@example.com" | null
}
```

### Response (success — 201)

```json
{ "ok": true, "post_url": "https://feedback.<operator>.featurebase.app/p/<slug>" }
```

### Response (failure)

```json
{ "ok": false, "error": "<short code>", "message": "<human-readable>" }
```

### Error codes

| Code | Status | Condition |
|---|---|---|
| `invalid_token` | 401 | Missing or wrong `Authorization` header. |
| `validation_error` | 400 | Body missing required field, wrong type, invalid `type` enum, or malformed email. |
| `featurebase_error` | 502 | Featurebase API rejected the outbound POST or was unreachable. |
| `internal_error` | 500 | Unexpected exception inside the proxy. |

Method gate: any HTTP method other than `POST` returns 405.

---

## Server-side environment variables

The proxy reads these six required values from `process.env` at request time. None of them ship in any agent bundle.

```
FEEDBACK_BUNDLE_TOKEN     # Static shared token; matched against incoming Authorization header
GITHUB_TOKEN              # GitHub fine-grained PAT, scoped to the operator's feedback repo only
                          # with `Discussions: read and write` permission
GITHUB_REPO_ID            # GraphQL global node ID of the operator's feedback repo
GITHUB_CAT_BUG_ID         # GraphQL ID of the "Bug reports" Discussion category
GITHUB_CAT_FEATURE_ID     # GraphQL ID of the "Feature requests" Discussion category
GITHUB_CAT_FEEDBACK_ID    # GraphQL ID of the "Feedback" Discussion category
```

See `docs/operations.md` §1 for the `gh api graphql` queries that fetch the repo + category IDs from GitHub.

---

## Outbound to GitHub Discussions

The proxy converts the agent's slim payload into a GraphQL `createDiscussion` mutation against `https://api.github.com/graphql`. The agent's `type` selects the Discussion category by env-var lookup (1:1 mapping — `Bug` → `GITHUB_CAT_BUG_ID`, `Feature request` → `GITHUB_CAT_FEATURE_ID`, `Feedback` → `GITHUB_CAT_FEEDBACK_ID`).

**GraphQL request body:**

```json
{
  "query": "mutation CreateDiscussion($input: CreateDiscussionInput!) { createDiscussion(input: $input) { discussion { id url number } } }",
  "variables": {
    "input": {
      "repositoryId": "<env GITHUB_REPO_ID>",
      "categoryId": "<env GITHUB_CAT_*_ID for this type>",
      "title": "<from agent>",
      "body": "<from agent>\n\n---\n\n_Reply-to: <email>_  OR  _Submitted anonymously._"
    }
  }
}
```

**Headers:** `Authorization: Bearer <env GITHUB_TOKEN>`, `Content-Type: application/json`, `Accept: application/json`, `User-Agent: agent-feedback-api` (GitHub requires a User-Agent header).

**Response handling:**
- HTTP 2xx with `data.createDiscussion.discussion.url` populated → 201 success with `post_url` set to that URL.
- HTTP 2xx with non-empty `errors` array → 502 `featurebase_error` with the first error message.
- HTTP non-2xx → 502 `featurebase_error` with the upstream status code.

**Note on the email field.** GitHub Discussions has no per-discussion `author.email` field — every Discussion is authored by the PAT's owner (the operator). The user's email, when supplied, is appended to the Discussion body inside a small footer (`_Reply-to: user@example.com_`) so the operator can see and reach back. When the user omits email, the footer reads `_Submitted anonymously._`.

**Note on the error code name.** The error code `featurebase_error` is kept for upstream-platform errors despite the platform pivot — the agent-facing contract is owned upstream and renaming the code would break the agent's failure-handling branch (FIN-013 upstream). Treat `featurebase_error` as "upstream platform rejected" semantically, not as a literal Featurebase reference.

The proxy POSTs the mapped payload to `https://do.featurebase.app/v2/posts` with header `Authorization: Bearer <env FEATUREBASE_API_KEY>` and `Content-Type: application/json`.

On Featurebase's 2xx response, the proxy extracts the post URL from the response body and returns it inside the success-shape `post_url` field.
