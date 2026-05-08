# Operations Runbook

Day-to-day operations for the Agent-Feedback-API proxy: provisioning, smoke testing, bundle-token rotation. Read this before deploying, after each deploy, and whenever the bundle token needs to change.

---

## 1. Featurebase prerequisites (one-time)

Before the proxy can land posts in Featurebase, the operator's Featurebase account needs to be set up:

1. **Board exists.** A single board where every recipient's feedback lands. Note its ObjectId — that's `FEATUREBASE_BOARD_ID`.
2. **API key created.** Generate from Featurebase Settings → API. That's `FEATUREBASE_API_KEY`. Treat as a high-stakes secret — never commit, never log.
3. **(Optional) Portal URL.** If the board is published as a public portal, note the URL (e.g. `https://feedback.<operator>.featurebase.app`). That's `FEATUREBASE_PORTAL_URL`. The proxy uses this to construct full `post_url` values from Featurebase's slug; without it the proxy returns the slug directly.

> **Note on category encoding (FIN-007).** The proxy encodes the agent's `type` (Bug / Feature request / Feedback) as a **title prefix** (e.g. `[Bug] Original title`) rather than a Featurebase custom field. Reason: custom fields are paywalled on Featurebase Free, and the Free plan's two pre-named priority tags can't be renamed for category use. Filter posts by category by typing `[Bug]`, `[Feature request]`, or `[Feedback]` into the Featurebase dashboard search. If you later upgrade and want labelled-row category rendering, only `lib/map-outbound.ts` changes.

---

## 2. Vercel project provisioning (one-time)

1. **Create the project.** Vercel dashboard → Add New → Project → import the GitHub repo for `Agent-Feedback-API`.
2. **Confirm framework preset.** Vercel should auto-detect "Other" — leave the build command empty (the function is built by Vercel's TypeScript runtime).
3. **Set environment variables.** Vercel project Settings → Environment Variables. Add the three required keys for both `Production` and `Preview`:
   - `FEATUREBASE_API_KEY`
   - `FEATUREBASE_BOARD_ID`
   - `FEEDBACK_BUNDLE_TOKEN`
   
   Optional: also add `FEATUREBASE_PORTAL_URL` if you want full post URLs in responses.
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
    "content": "<p>This post was created by the deploy smoke test.</p>",
    "email": null
  }'
```

**Expected:**
- HTTP status `201`.
- Response body shape: `{ "ok": true, "post_url": "..." }`.
- The post visible in the Featurebase dashboard with the `Type` field set to `Feedback`.

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

After the smoke test passes, **delete the test post from the Featurebase dashboard** so it doesn't pollute the real feedback stream.

---

## 4. Bundle-token rotation

Cadence: **annually**, plus immediate rotation on any suspected leak. Token leak is low-stakes (POST-only, can't read submissions), but stale tokens shipped in old bundles forever is poor hygiene.

**Procedure:**

1. **Generate a new token.** Any sufficiently long random string (e.g. `openssl rand -hex 32`).
2. **Update Vercel env var.** Project Settings → Environment Variables → edit `FEEDBACK_BUNDLE_TOKEN` for both Production and Preview. Save.
3. **Redeploy.** Push any commit to `main` (or use Vercel dashboard's "Redeploy" button) so the new env var takes effect.
4. **Update the upstream agent bundle.** Edit `BUNDLE_TOKEN` in the `ux-designer` agent's `references/feedback-intake.md` to match the new token.
5. **Build + ship a new agent bundle.** Run the agent's IDE-bundle build script and distribute the new bundle to recipients.
6. **Update §5 below** with the new rotation date.

**Window of inconsistency.** Between step 3 and step 5 (new env active, old bundle still in users' hands), submissions from old bundles will return `401 invalid_token`. Recipients see the agent's failure path (FIN-013 upstream — retry or save-draft). Keep the window small by running steps 3–5 in one sitting.

---

## 5. Live deployment record

| Field | Value |
|---|---|
| Production URL | _(filled in by Step 10 — first deploy)_ |
| Last rotation date | _(filled in after first deploy or first rotation)_ |
| Featurebase board name | _(operator-supplied)_ |
| Notes | |

---

## 6. Things to log, things to never log

The proxy logs to Vercel platform logs only — no external service.

**OK to log:**
- Request method + start time.
- Hash prefix of the incoming token (`sha256(token).slice(0, 8)`).
- Response status, error code, upstream Featurebase status.
- Generic exception message (`unexpected_exception`).

**Never log:**
- Raw `Authorization` header value.
- `FEATUREBASE_API_KEY`.
- The full request body (it carries free-text user content and possibly an email).
- The user's email address, even on success.

If you spot a violation in Vercel logs, treat it as a deploy bug and revert.
