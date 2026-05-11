import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toGraphQLRequest,
  CREATE_DISCUSSION_MUTATION,
} from "../../lib/map-outbound.js";
import type { ValidatedBody } from "../../lib/validate.js";

const ENV = {
  repoId: "REPO_GLOBAL_ID_12345",
  categoryIdBug: "CAT_BUG_ID",
  categoryIdFeature: "CAT_FEATURE_ID",
  categoryIdFeedback: "CAT_FEEDBACK_ID",
  categoryIdQuestion: "CAT_QUESTION_ID",
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

test("request carries the createDiscussion mutation query", () => {
  const req = toGraphQLRequest(bodyOf(), ENV);
  assert.equal(req.query, CREATE_DISCUSSION_MUTATION);
  assert.ok(
    req.query.includes("createDiscussion"),
    "mutation must call createDiscussion"
  );
});

test("repositoryId from env appears in the input", () => {
  const req = toGraphQLRequest(bodyOf(), ENV);
  assert.equal(req.variables.input.repositoryId, ENV.repoId);
});

test("type Bug routes to categoryIdBug", () => {
  const req = toGraphQLRequest(bodyOf({ type: "Bug" }), ENV);
  assert.equal(req.variables.input.categoryId, ENV.categoryIdBug);
});

test("type Feature request routes to categoryIdFeature", () => {
  const req = toGraphQLRequest(bodyOf({ type: "Feature request" }), ENV);
  assert.equal(req.variables.input.categoryId, ENV.categoryIdFeature);
});

test("type Feedback routes to categoryIdFeedback", () => {
  const req = toGraphQLRequest(bodyOf({ type: "Feedback" }), ENV);
  assert.equal(req.variables.input.categoryId, ENV.categoryIdFeedback);
});

test("type Question routes to categoryIdQuestion", () => {
  const req = toGraphQLRequest(bodyOf({ type: "Question" }), ENV);
  assert.equal(req.variables.input.categoryId, ENV.categoryIdQuestion);
});

test("title is prefixed with [UXD Feedback] for operator scannability", () => {
  const req = toGraphQLRequest(
    bodyOf({ title: "Original title with no prefix" }),
    ENV
  );
  assert.equal(req.variables.input.title, "[UXD Feedback] Original title with no prefix");
});

test("content appears at the top of the discussion body", () => {
  const req = toGraphQLRequest(
    bodyOf({ content: "<p>Specific content body.</p>" }),
    ENV
  );
  assert.ok(
    req.variables.input.body.startsWith("<p>Specific content body.</p>"),
    "content must lead the discussion body"
  );
});

test("non-null email does NOT leak into the public discussion body (email-relay handles it privately)", () => {
  const req = toGraphQLRequest(
    bodyOf({ email: "user@example.com" }),
    ENV
  );
  assert.ok(
    !req.variables.input.body.includes("user@example.com"),
    "email address must not appear in the public Discussion body — it goes via the Make webhook relay"
  );
  assert.ok(
    req.variables.input.body.includes("reply-to address was provided"),
    "trailer should indicate a reply-to is available without disclosing it"
  );
});

test("null email yields an anonymous trailer (no email leaked)", () => {
  const req = toGraphQLRequest(bodyOf({ email: null }), ENV);
  assert.ok(
    !req.variables.input.body.includes("@"),
    "null email must not leak any address-shaped string"
  );
  assert.ok(
    req.variables.input.body.includes("anonymously"),
    "trailer should mark anonymous submissions"
  );
});

test("payload has no Featurebase-era keys (FIN-008 — platform pivot)", () => {
  const req = toGraphQLRequest(bodyOf(), ENV) as unknown as Record<string, unknown>;
  assert.ok(!("boardId" in req), "no boardId at top level");
  assert.ok(!("customFields" in req), "no customFields at top level");
});
