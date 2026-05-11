import { test } from "node:test";
import assert from "node:assert/strict";
import { toEmailRelayPayload } from "../../lib/email-relay.js";
import type { ValidatedBody } from "../../lib/validate.js";

const DISCUSSION = {
  url: "https://github.com/Creative-Sparks-pl/feedback/discussions/42",
  number: 42,
};

function bodyOf(overrides: Partial<ValidatedBody> = {}): ValidatedBody {
  return {
    type: "Bug",
    title: "Wireframe export drops trailing whitespace",
    content: "<p>Steps to reproduce…</p>",
    email: "user@example.com",
    ...overrides,
  };
}

test("null email skips the relay entirely (returns null)", () => {
  const payload = toEmailRelayPayload(bodyOf({ email: null }), DISCUSSION);
  assert.equal(payload, null);
});

test("non-null email produces a payload with subject + body + reply_to", () => {
  const payload = toEmailRelayPayload(bodyOf(), DISCUSSION);
  assert.ok(payload !== null);
  assert.equal(typeof payload.subject, "string");
  assert.equal(typeof payload.body, "string");
  assert.equal(typeof payload.reply_to, "string");
});

test("subject includes the bracketed type and the title", () => {
  const payload = toEmailRelayPayload(bodyOf({ type: "Bug" }), DISCUSSION);
  assert.ok(payload !== null);
  assert.ok(payload.subject.includes("[Bug]"));
  assert.ok(
    payload.subject.includes("Wireframe export drops trailing whitespace")
  );
});

test("subject uses each type verbatim in the bracket", () => {
  const bug = toEmailRelayPayload(bodyOf({ type: "Bug" }), DISCUSSION);
  const feat = toEmailRelayPayload(bodyOf({ type: "Feature request" }), DISCUSSION);
  const fb = toEmailRelayPayload(bodyOf({ type: "Feedback" }), DISCUSSION);
  assert.ok(bug?.subject.includes("[Bug]"));
  assert.ok(feat?.subject.includes("[Feature request]"));
  assert.ok(fb?.subject.includes("[Feedback]"));
});

test("reply_to equals the body's email", () => {
  const payload = toEmailRelayPayload(
    bodyOf({ email: "specific@example.com" }),
    DISCUSSION
  );
  assert.equal(payload?.reply_to, "specific@example.com");
});

test("body includes the discussion URL", () => {
  const payload = toEmailRelayPayload(bodyOf(), DISCUSSION);
  assert.ok(payload?.body.includes(DISCUSSION.url));
});

test("body includes the user's reply-to address", () => {
  const payload = toEmailRelayPayload(
    bodyOf({ email: "specific@example.com" }),
    DISCUSSION
  );
  assert.ok(payload?.body.includes("specific@example.com"));
});

test("body includes the discussion number", () => {
  const payload = toEmailRelayPayload(bodyOf(), DISCUSSION);
  assert.ok(payload?.body.includes("#42"));
});

test("body includes the full submission content (not just a link)", () => {
  const payload = toEmailRelayPayload(
    bodyOf({
      content: "<p>Specific HTML content the user wrote</p><p>With multiple paragraphs</p>",
    }),
    DISCUSSION
  );
  assert.ok(
    payload?.body.includes("Specific HTML content the user wrote"),
    "operator should read the full submission in the email without clicking through"
  );
  assert.ok(
    payload?.body.includes("With multiple paragraphs"),
    "all paragraphs from the agent's content should appear in the email body"
  );
});
