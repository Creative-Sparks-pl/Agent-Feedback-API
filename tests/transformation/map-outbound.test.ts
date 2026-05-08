import { test } from "node:test";
import assert from "node:assert/strict";
import { toFeaturebasePayload } from "../../lib/map-outbound.js";
import type { ValidatedBody } from "../../lib/validate.js";

const ENV = {
  boardId: "BOARD_OBJECT_ID_12345",
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

test("type Bug prefixes the title with [Bug]", () => {
  const payload = toFeaturebasePayload(
    bodyOf({ type: "Bug", title: "Original title" }),
    ENV
  );
  assert.equal(payload.title, "[Bug] Original title");
});

test("type Feature request prefixes the title with [Feature request]", () => {
  const payload = toFeaturebasePayload(
    bodyOf({ type: "Feature request", title: "Original title" }),
    ENV
  );
  assert.equal(payload.title, "[Feature request] Original title");
});

test("type Feedback prefixes the title with [Feedback]", () => {
  const payload = toFeaturebasePayload(
    bodyOf({ type: "Feedback", title: "Original title" }),
    ENV
  );
  assert.equal(payload.title, "[Feedback] Original title");
});

test("content passes through verbatim", () => {
  const body = bodyOf({ content: "<p>Specific content body.</p>" });
  const payload = toFeaturebasePayload(body, ENV);
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

test("payload has no customFields key (FIN-007 — drop custom-field encoding)", () => {
  const payload = toFeaturebasePayload(bodyOf(), ENV);
  assert.ok(
    !("customFields" in payload),
    "customFields must not appear on the Free-plan payload"
  );
});
