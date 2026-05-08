import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { validate, isValidationFailure } from "../lib/validate.js";
import { toFeaturebasePayload } from "../lib/map-outbound.js";

const FEATUREBASE_POSTS_URL = "https://do.featurebase.app/v2/posts";

interface FailureBody {
  ok: false;
  error: "invalid_token" | "validation_error" | "featurebase_error" | "internal_error";
  message: string;
}

interface SuccessBody {
  ok: true;
  post_url: string;
}

function failure(
  res: VercelResponse,
  status: number,
  error: FailureBody["error"],
  message: string
): void {
  const body: FailureBody = { ok: false, error, message };
  res.status(status).json(body);
}

function success(res: VercelResponse, post_url: string): void {
  const body: SuccessBody = { ok: true, post_url };
  res.status(201).json(body);
}

function tokenHash(authHeader: string | string[] | undefined): string {
  const raw =
    typeof authHeader === "string"
      ? authHeader
      : Array.isArray(authHeader) && authHeader.length > 0
      ? authHeader[0]
      : "";
  const token = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : "";
  if (!token) return "none";
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}

function extractPostUrl(featurebaseResponse: unknown, portalUrl: string | undefined): string {
  // Try common shapes Featurebase may return; fall back to the slug-only string.
  if (typeof featurebaseResponse !== "object" || featurebaseResponse === null) {
    return "";
  }
  const r = featurebaseResponse as Record<string, unknown>;

  // 1. Direct url field on the response
  if (typeof r.url === "string") return r.url;

  // 2. submission.url or submission.slug
  const submission = (r.submission ?? r.post) as Record<string, unknown> | undefined;
  if (submission && typeof submission === "object") {
    if (typeof submission.url === "string") return submission.url;
    if (typeof submission.slug === "string") {
      return portalUrl
        ? `${portalUrl.replace(/\/$/, "")}/p/${submission.slug}`
        : submission.slug;
    }
  }

  // 3. top-level slug
  if (typeof r.slug === "string") {
    return portalUrl ? `${portalUrl.replace(/\/$/, "")}/p/${r.slug}` : r.slug;
  }

  return "";
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  console.log(
    `[feedback] start method=${req.method} token-hash=${tokenHash(req.headers.authorization)}`
  );

  // Method gate — reject anything that isn't POST before doing further work.
  if (req.method !== "POST") {
    failure(res, 405, "validation_error", "Only POST is supported.");
    return;
  }

  try {
    // Validation (token + body shape).
    const result = validate({ headers: req.headers, body: req.body });
    if (isValidationFailure(result)) {
      const status = result.error === "invalid_token" ? 401 : 400;
      console.log(`[feedback] ${result.error} reason=${result.message}`);
      failure(res, status, result.error, result.message);
      return;
    }

    // Required Featurebase env vars — fail fast if any missing.
    const apiKey = process.env.FEATUREBASE_API_KEY;
    const boardId = process.env.FEATUREBASE_BOARD_ID;
    if (!apiKey || !boardId) {
      console.error("[feedback] internal_error message=missing_env");
      failure(res, 500, "internal_error", "Server is misconfigured.");
      return;
    }

    // Optional portal URL — used to construct full post_url from FB slug.
    const portalUrl = process.env.FEATUREBASE_PORTAL_URL;

    // Build outbound and POST.
    const outbound = toFeaturebasePayload(result, { boardId });
    const upstream = await fetch(FEATUREBASE_POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(outbound),
    });

    if (!upstream.ok) {
      console.error(
        `[feedback] featurebase_error upstream_status=${upstream.status}`
      );
      failure(
        res,
        502,
        "featurebase_error",
        `Featurebase returned ${upstream.status}.`
      );
      return;
    }

    const featurebaseBody = await upstream.json().catch(() => null);
    const post_url = extractPostUrl(featurebaseBody, portalUrl);
    console.log(`[feedback] ok status=201 post_url=${post_url}`);
    success(res, post_url);
  } catch (err) {
    // Never leak err.message contents to the client; log a generic line locally.
    console.error("[feedback] internal_error message=unexpected_exception");
    failure(res, 500, "internal_error", "Unexpected server error.");
  }
}
