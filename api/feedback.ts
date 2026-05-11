import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { validate, isValidationFailure } from "../lib/validate.js";
import { toGraphQLRequest } from "../lib/map-outbound.js";
import { toEmailRelayPayload } from "../lib/email-relay.js";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const EMAIL_RELAY_TIMEOUT_MS = 5000;

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

interface GraphQLDiscussionResponse {
  data?: {
    createDiscussion?: {
      discussion?: {
        id?: string;
        url?: string;
        number?: number;
      };
    };
  };
  errors?: Array<{ message?: string; type?: string }>;
}

function extractDiscussion(graphqlBody: unknown): {
  url: string | null;
  number: number | null;
  errorMessage: string | null;
} {
  if (typeof graphqlBody !== "object" || graphqlBody === null) {
    return { url: null, number: null, errorMessage: "GitHub response was not a JSON object." };
  }
  const r = graphqlBody as GraphQLDiscussionResponse;

  if (Array.isArray(r.errors) && r.errors.length > 0) {
    const first = r.errors[0];
    return {
      url: null,
      number: null,
      errorMessage: `GitHub GraphQL error: ${first?.message ?? "unknown"}.`,
    };
  }

  const discussion = r.data?.createDiscussion?.discussion;
  const url = discussion?.url;
  const number = discussion?.number;
  if (typeof url === "string" && url.length > 0 && typeof number === "number") {
    return { url, number, errorMessage: null };
  }

  return {
    url: null,
    number: null,
    errorMessage: "GitHub response did not contain a discussion URL/number.",
  };
}

async function fireEmailRelay(
  payload: ReturnType<typeof toEmailRelayPayload>,
  url: string | undefined,
  apiKey: string | undefined
): Promise<void> {
  if (payload === null) return;
  if (!url || !apiKey) {
    console.warn("[feedback] email_relay_skipped reason=env_unset");
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_RELAY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.ok) {
      console.log(`[feedback] email_relay_ok status=${res.status}`);
    } else {
      console.error(`[feedback] email_relay_error upstream_status=${res.status}`);
    }
  } catch (err) {
    const reason = (err as Error)?.name === "AbortError" ? "timeout" : "exception";
    console.error(`[feedback] email_relay_error reason=${reason}`);
  } finally {
    clearTimeout(timer);
  }
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

    // Required GitHub env vars — fail fast if any missing.
    const githubToken = process.env.GITHUB_TOKEN;
    const repoId = process.env.GITHUB_REPO_ID;
    const categoryIdBug = process.env.GITHUB_CAT_BUG_ID;
    const categoryIdFeature = process.env.GITHUB_CAT_FEATURE_ID;
    const categoryIdFeedback = process.env.GITHUB_CAT_FEEDBACK_ID;
    if (
      !githubToken ||
      !repoId ||
      !categoryIdBug ||
      !categoryIdFeature ||
      !categoryIdFeedback
    ) {
      console.error("[feedback] internal_error message=missing_env");
      failure(res, 500, "internal_error", "Server is misconfigured.");
      return;
    }

    // Build outbound GraphQL request and POST.
    const outbound = toGraphQLRequest(result, {
      repoId,
      categoryIdBug,
      categoryIdFeature,
      categoryIdFeedback,
    });
    const upstream = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "agent-feedback-api",
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
        `GitHub GraphQL returned ${upstream.status}.`
      );
      return;
    }

    const githubBody = await upstream.json().catch(() => null);
    const { url, number, errorMessage } = extractDiscussion(githubBody);

    if (!url || number === null) {
      console.error(
        `[feedback] featurebase_error upstream_status=200_with_errors`
      );
      failure(
        res,
        502,
        "featurebase_error",
        errorMessage ?? "GitHub did not return a discussion URL."
      );
      return;
    }

    // Discussion landed. Now fire the email relay if applicable. We await
    // it (with a short timeout) so failures land in this request's logs, but
    // we never fail the response on relay errors — the Discussion is the
    // durable record; the email relay is a notification convenience.
    const relayPayload = toEmailRelayPayload(result, { url, number });
    await fireEmailRelay(
      relayPayload,
      process.env.MAKE_WEBHOOK_URL,
      process.env.MAKE_API_KEY
    );

    console.log(`[feedback] ok status=201 post_url=${url}`);
    success(res, url);
  } catch (err) {
    // Never leak err.message contents to the client; log a generic line locally.
    console.error("[feedback] internal_error message=unexpected_exception");
    failure(res, 500, "internal_error", "Unexpected server error.");
  }
}
