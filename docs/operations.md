# Operations Runbook

Day-to-day operations for the Agent-Feedback-API proxy: provisioning, smoke testing, bundle-token rotation. Read this before deploying, after each deploy, and whenever the bundle token needs to change.

Platform: **GitHub Discussions** (FIN-008 — pivoted from Featurebase due to its Free-plan API paywall).

---

## 1. GitHub Discussions prerequisites (one-time)

Before the proxy can land posts, the operator's GitHub side needs setup:

### 1.1 Create the feedback repo

Public repo, owned by the operator's GitHub org (e.g. `Creative-Sparks-pl/feedback`). Public is required so the Discussions portal is browsable by recipients without auth and so anyone can react/comment.

```bash
gh repo create Creative-Sparks-pl/feedback --public \
  --description "Feedback intake from the ux-designer agent and other Markdown-Agents bundles."
```

### 1.2 Enable Discussions

GitHub repo Settings → General → scroll to **Features** → tick **Discussions**. Or via API:

```bash
gh api -X PATCH repos/Creative-Sparks-pl/feedback -f has_discussions=true
```

### 1.3 Create the three Discussion categories

GitHub repo → Discussions tab → "Discussions categories" pencil icon → create three categories with names:

- **Bug reports** (Format: Discussion. Description: "Something not working.")
- **Feature requests** (Format: Discussion. Description: "An idea or improvement.")
- **Feedback** (Format: Discussion. Description: "General reflections.")

You can delete the default categories (Q&A, Show and tell, etc.) or leave them — the proxy only writes into the three above.

### 1.4 Generate a fine-grained PAT

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.

- **Token name:** `agent-feedback-api proxy`
- **Expiration:** 1 year (rotation cadence — see §4)
- **Resource owner:** Creative-Sparks-pl (or whichever owns the feedback repo)
- **Repository access:** Only select repositories → choose `feedback`
- **Repository permissions** → set:
  - **Discussions:** Read and write
  - All others: leave at "No access"

Click Generate. Copy the token (`github_pat_...`) — you'll only see it once. That's `GITHUB_TOKEN`.

### 1.5 Fetch the GraphQL IDs

Run these once to capture the repo's global ID and the three category IDs.

**Repo ID:**

```bash
gh api graphql -f query='
  query {
    repository(owner: "Creative-Sparks-pl", name: "feedback") {
      id
    }
  }
'
```

The `id` field in the response is `GITHUB_REPO_ID`. Format: a base64-style string like `R_kgDOMz...`.

**Category IDs:**

```bash
gh api graphql -f query='
  query {
    repository(owner: "Creative-Sparks-pl", name: "feedback") {
      discussionCategories(first: 20) {
        nodes { id name }
      }
    }
  }
'
```

The response lists every category with its `id` and `name`. Map them by name:

- Category named **Bug reports** → `GITHUB_CAT_BUG_ID`
- Category named **Feature requests** → `GITHUB_CAT_FEATURE_ID`
- Category named **Feedback** → `GITHUB_CAT_FEEDBACK_ID`

---

## 2. Vercel project provisioning (one-time)

1. **Create the project.** https://vercel.com/new → import `Creative-Sparks-pl/Agent-Feedback-API` from GitHub.
2. **Confirm framework preset.** Vercel auto-detects "Other" — leave the build command empty.
3. **Set environment variables.** Vercel project Settings → Environment Variables. Add **all six** keys for both `Production` and `Preview`:
   - `FEEDBACK_BUNDLE_TOKEN` — generate with `openssl rand -hex 32` (any sufficiently long random string).
   - `GITHUB_TOKEN` — the PAT from §1.4.
   - `GITHUB_REPO_ID` — from §1.5.
   - `GITHUB_CAT_BUG_ID` — from §1.5.
   - `GITHUB_CAT_FEATURE_ID` — from §1.5.
   - `GITHUB_CAT_FEEDBACK_ID` — from §1.5.
4. **Trigger first deploy.** Push to `main` (or click "Deploy" in the Vercel dashboard). Vercel auto-deploys subsequent pushes to `main` thereafter.
5. **Capture the production URL.** Vercel assigns a URL like `https://agent-feedback-api-<hash>.vercel.app` (or your custom domain if attached). Record it in §5 below.

---

## 3. Smoke test (after every deploy)

Run this `curl` against the live URL with a real-but-disposable test payload. Replace `<PROXY_URL>` and `<BUNDLE_TOKEN>` with your values.

```bash
curl -i -X POST '<PROXY_URL>/api/feedback' \
  -H 'Authorization: Bearer <BUNDLE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "Feedback",
    "title": "Smoke test — please ignore",
    "content": "<p>This Discussion was created by the deploy smoke test.</p>",
    "email": null
  }'
```

**Expected:**
- HTTP status `201`.
- Response body shape: `{ "ok": true, "post_url": "https://github.com/Creative-Sparks-pl/feedback/discussions/N" }`.
- The Discussion visible at that URL, in the **Feedback** category, with the title `Smoke test — please ignore` and the body containing the `<p>` content + an `_Submitted anonymously._` footer.

**Negative checks (also run):**

```bash
# Wrong token → 401 invalid_token
curl -i -X POST '<PROXY_URL>/api/feedback' \
  -H 'Authorization: Bearer wrong-token' \
  -H 'Content-Type: application/json' \
  -d '{"type":"Feedback","title":"x","content":"x","email":null}'

# GET method → 405
curl -i -X GET '<PROXY_URL>/api/feedback' \
  -H 'Authorization: Bearer <BUNDLE_TOKEN>'
```

After the smoke test passes, **delete the test Discussion from the GitHub repo** so it doesn't pollute the real feedback stream.

---

## 4. Bundle-token rotation

Cadence: **annually**, plus immediate rotation on any suspected leak. Token leak is low-stakes (POST-only, can't read or modify Discussions), but stale tokens shipped in old bundles forever is poor hygiene.

**Procedure:**

1. **Generate a new token.** Any sufficiently long random string (e.g. `openssl rand -hex 32`).
2. **Update Vercel env var.** Project Settings → Environment Variables → edit `FEEDBACK_BUNDLE_TOKEN` for both Production and Preview. Save.
3. **Redeploy.** Push any commit to `main` (or use Vercel dashboard's "Redeploy" button) so the new env var takes effect.
4. **Update the upstream agent bundle.** Edit `BUNDLE_TOKEN` in the `ux-designer` agent's `references/feedback-intake.md` to match the new token.
5. **Build + ship a new agent bundle.** Run the agent's IDE-bundle build script and distribute the new bundle to recipients.
6. **Update §5 below** with the new rotation date.

**Window of inconsistency.** Between step 3 and step 5 (new env active, old bundle still in users' hands), submissions from old bundles will return `401 invalid_token`. Recipients see the agent's failure path (FIN-013 upstream — retry or save-draft). Keep the window small by running steps 3–5 in one sitting.

### GitHub PAT rotation

Separate from bundle-token rotation. The `GITHUB_TOKEN` PAT expires per its configured lifetime (1 year recommended). GitHub emails the operator a few days before expiry. To rotate:

1. Generate a new fine-grained PAT with the same scope (Discussions: read/write on the feedback repo only).
2. Update `GITHUB_TOKEN` in Vercel env (production + preview).
3. Redeploy.
4. Revoke the old PAT in GitHub Settings.

PAT rotation does NOT require a new agent bundle — the PAT only lives on the proxy.

---

## 5. Live deployment record

| Field | Value |
|---|---|
| Production URL | `https://agent-feedback-api.vercel.app` |
| Per-deployment URL pattern | `agent-feedback-<hash>-tmaciag-7741s-projects.vercel.app` |
| Last bundle-token rotation date | 2026-05-10 (initial generation) |
| Last GitHub PAT rotation date | 2026-05-10 (initial generation; expires 2027-05-11) |
| Feedback repo | `Creative-Sparks-pl/feedback` |
| Discussion portal | `https://github.com/Creative-Sparks-pl/feedback/discussions` |
| First successful smoke test | 2026-05-10 — discussion #1 created end-to-end |
| Notes | |

---

## 6. Things to log, things to never log

The proxy logs to Vercel platform logs only — no external service.

**OK to log:**
- Request method + start time.
- Hash prefix of the incoming token (`sha256(token).slice(0, 8)`).
- Response status, error code, upstream GitHub HTTP status.
- Generic exception message (`unexpected_exception`).

**Never log:**
- Raw `Authorization` header value.
- `GITHUB_TOKEN`.
- The full request body (it carries free-text user content and possibly an email).
- The user's email address, even on success.

If you spot a violation in Vercel logs, treat it as a deploy bug and revert.
