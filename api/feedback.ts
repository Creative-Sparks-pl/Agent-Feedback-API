import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { validate, isValidationFailure } from "../lib/validate.js";
import { toGraphQLRequest } from "../lib/map-outbound.js";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

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

function extractDiscussionUrl(graphqlBody: unknown): {
  url: string | null;
  errorMessage: string | null;
} {
  if (typeof graphqlBody !== "object" || graphqlBody === null) {
    return { url: null, errorMessage: "GitHub response was not a JSON object." };
  }
  const r = graphqlBody as GraphQLDiscussionResponse;

  if (Array.isArray(r.errors) && r.errors.length > 0) {
    const first = r.errors[0];
    return {
      url: null,
      errorMessage: `GitHub GraphQL error: ${first?.message ?? "unknown"}.`,
    };
  }

  const url = r.data?.createDiscussion?.discussion?.url;
  if (typeof url === "string" && url.length > 0) {
    return { url, errorMessage: null };
  }

  return {
    url: null,
    errorMessage: "GitHub response did not contain a discussion URL.",
  };
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
    const { url, errorMessage } = extractDiscussionUrl(githubBody);

    if (!url) {
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

    console.log(`[feedback] ok status=201 post_url=${url}`);
    success(res, url);
  } catch (err) {
    // Never leak err.message contents to the client; log a generic line locally.
    console.error("[feedback] internal_error message=unexpected_exception");
    failure(res, 500, "internal_error", "Unexpected server error.");
  }
}
