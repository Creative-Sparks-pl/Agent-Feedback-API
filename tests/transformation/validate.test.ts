import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  isValidationFailure,
  type FeedbackType,
} from "../../lib/validate.js";

const TOKEN = "test-bundle-token-12345";

let priorToken: string | undefined;

beforeEach(() => {
  priorToken = process.env.FEEDBACK_BUNDLE_TOKEN;
  process.env.FEEDBACK_BUNDLE_TOKEN = TOKEN;
});

afterEach(() => {
  if (priorToken === undefined) {
    delete process.env.FEEDBACK_BUNDLE_TOKEN;
  } else {
    process.env.FEEDBACK_BUNDLE_TOKEN = priorToken;
  }
});

function goodBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "Bug" as FeedbackType,
    title: "Export drops trailing whitespace",
    content: "<p>Steps to reproduce…</p>",
    email: null,
    ...overrides,
  };
}

function authHeaders(token: string = TOKEN) {
  return { authorization: `Bearer ${token}` };
}

test("missing Authorization header returns invalid_token", () => {
  const result = validate({ headers: {}, body: goodBody() });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "invalid_token");
});

test("wrong token returns invalid_token", () => {
  const result = validate({
    headers: authHeaders("wrong-token"),
    body: goodBody(),
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "invalid_token");
});

test("malformed Authorization (no Bearer prefix) returns invalid_token", () => {
  const result = validate({
    headers: { authorization: TOKEN },
    body: goodBody(),
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "invalid_token");
});

test("missing type returns validation_error", () => {
  const { type: _omit, ...body } = goodBody();
  const result = validate({ headers: authHeaders(), body });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "validation_error");
});

test("invalid type value returns validation_error", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ type: "Spam" }),
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "validation_error");
});

test("type Bug is accepted", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ type: "Bug" }),
  });
  assert.ok(!isValidationFailure(result));
  assert.equal(result.type, "Bug");
});

test("type Feature request is accepted", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ type: "Feature request" }),
  });
  assert.ok(!isValidationFailure(result));
  assert.equal(result.type, "Feature request");
});

test("type Feedback is accepted", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ type: "Feedback" }),
  });
  assert.ok(!isValidationFailure(result));
  assert.equal(result.type, "Feedback");
});

test("empty title returns validation_error", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ title: "   " }),
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "validation_error");
});

test("empty content returns validation_error", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ content: "" }),
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "validation_error");
});

test("email null is accepted", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ email: null }),
  });
  assert.ok(!isValidationFailure(result));
  assert.equal(result.email, null);
});

test("valid email is accepted", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ email: "user@example.com" }),
  });
  assert.ok(!isValidationFailure(result));
  assert.equal(result.email, "user@example.com");
});

test("malformed email returns validation_error", () => {
  const result = validate({
    headers: authHeaders(),
    body: goodBody({ email: "not-an-email" }),
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "validation_error");
});

test("non-object body returns validation_error", () => {
  const result = validate({
    headers: authHeaders(),
    body: "this is a string, not an object",
  });
  assert.ok(isValidationFailure(result));
  assert.equal(result.error, "validation_error");
});
