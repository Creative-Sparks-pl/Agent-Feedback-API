// Pure request validator for the feedback proxy. The handler in
// api/feedback.ts is the only place that performs I/O.

export type FeedbackType = "Bug" | "Feature request" | "Feedback" | "Question";

export interface ValidatedBody {
  type: FeedbackType;
  title: string;
  content: string;
  email: string | null;
}

export type ErrorCode =
  | "invalid_token"
  | "validation_error"
  | "featurebase_error"
  | "internal_error";

export interface ValidationFailure {
  error: ErrorCode;
  message: string;
}

export type ValidationResult = ValidatedBody | ValidationFailure;

interface ValidateInput {
  headers: { authorization?: string | string[] };
  body: unknown;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  "Bug",
  "Feature request",
  "Feedback",
  "Question",
]);

// Single-line shape check — local@domain.tld with no spaces. Featurebase does
// its own validation upstream; this guards the obvious garbage case.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readAuthHeader(headers: ValidateInput["headers"]): string | null {
  const raw = headers.authorization;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validate(req: ValidateInput): ValidationResult {
  // 1. Authorization
  const auth = readAuthHeader(req.headers);
  if (!auth || !auth.startsWith("Bearer ")) {
    return {
      error: "invalid_token",
      message: "Missing or malformed Authorization header.",
    };
  }
  const token = auth.slice("Bearer ".length).trim();
  const expected = process.env.FEEDBACK_BUNDLE_TOKEN;
  if (!expected || token !== expected) {
    return { error: "invalid_token", message: "Bearer token does not match." };
  }

  // 2. Body shape
  if (!isPlainObject(req.body)) {
    return {
      error: "validation_error",
      message: "Request body must be a JSON object.",
    };
  }

  const { type, title, content, email } = req.body;

  if (typeof type !== "string" || !VALID_TYPES.has(type)) {
    return {
      error: "validation_error",
      message:
        'Field "type" must be one of: Bug, Feature request, Feedback, Question.',
    };
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    return {
      error: "validation_error",
      message: 'Field "title" must be a non-empty string.',
    };
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    return {
      error: "validation_error",
      message: 'Field "content" must be a non-empty string.',
    };
  }

  let normalizedEmail: string | null;
  if (email === null || email === undefined) {
    normalizedEmail = null;
  } else if (typeof email === "string" && EMAIL_PATTERN.test(email)) {
    normalizedEmail = email;
  } else {
    return {
      error: "validation_error",
      message: 'Field "email" must be null or a valid email address.',
    };
  }

  return {
    type: type as FeedbackType,
    title,
    content,
    email: normalizedEmail,
  };
}

export function isValidationFailure(
  result: ValidationResult
): result is ValidationFailure {
  return (result as ValidationFailure).error !== undefined;
}
