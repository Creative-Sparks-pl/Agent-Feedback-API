import { test } from "node:test";
import assert from "node:assert/strict";
import { toFeaturebasePayload } from "../../lib/map-outbound.js";
import type { ValidatedBody } from "../../lib/validate.js";

const ENV = {
  boardId: "BOARD_OBJECT_ID_12345",
  fieldTypeId: "FIELD_TYPE_OBJECT_ID_67890",
};

function bodyOf(overrides: Partial<ValidatedBody> = {}): ValidatedBody {
  return {
    type: "Bug",
    title: "Export drops trailing whitespace",
    content: "<p>Steps to reproduce…</p>",
    email: null,
    ...overrides,
  };
}

test("boardId from env appears in the payload", () => {
  const payload = toFeaturebasePayload(bodyOf(), ENV);
  assert.equal(payload.boardId, ENV.boardId);
});

test("type Bug maps into customFields under fieldTypeId key", () => {
  const payload = toFeaturebasePayload(bodyOf({ type: "Bug" }), ENV);
  assert.equal(payload.customFields[ENV.fieldTypeId], "Bug");
});

test("type Feature request maps into customFields under fieldTypeId key", () => {
  const payload = toFeaturebasePayload(
    bodyOf({ type: "Feature request" }),
    ENV
  );
  assert.equal(payload.customFields[ENV.fieldTypeId], "Feature request");
});

test("type Feedback maps into customFields under fieldTypeId key", () => {
  const payload = toFeaturebasePayload(bodyOf({ type: "Feedback" }), ENV);
  assert.equal(payload.customFields[ENV.fieldTypeId], "Feedback");
});

test("title and content pass through verbatim", () => {
  const body = bodyOf({
    title: "Specific title text",
    content: "<p>Specific content body.</p>",
  });
  const payload = toFeaturebasePayload(body, ENV);
  assert.equal(payload.title, "Specific title text");
  assert.equal(payload.content, "<p>Specific content body.</p>");
});

test("non-null email becomes author.email", () => {
  const payload = toFeaturebasePayload(
    bodyOf({ email: "user@example.com" }),
    ENV
  );
  assert.deepEqual(payload.author, { email: "user@example.com" });
});

test("null email omits the author key entirely (not author: { email: null })", () => {
  const payload = toFeaturebasePayload(bodyOf({ email: null }), ENV);
  assert.strictEqual(payload.author, undefined);
  assert.ok(!("author" in payload));
});
