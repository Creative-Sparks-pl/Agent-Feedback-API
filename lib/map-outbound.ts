// Pure mapper from agent-side payload to GitHub Discussions GraphQL request.
// The handler in api/feedback.ts performs the outbound POST.
//
// Platform: GitHub Discussions (FIN-008). Each agent `type` maps to one
// pre-created Discussion category in the operator's feedback repo. The
// operator's email goes inside the Discussion body (Discussions has no
// per-discussion author.email field — the Discussion is authored by the
// PAT's owner).

import type { ValidatedBody, FeedbackType } from "./validate.js";

export interface OutboundEnv {
  repoId: string;
  categoryIdBug: string;
  categoryIdFeature: string;
  categoryIdFeedback: string;
  categoryIdQuestion: string;
}

export interface GraphQLRequest {
  query: string;
  variables: {
    input: {
      repositoryId: string;
      categoryId: string;
      title: string;
      body: string;
    };
  };
}

export const CREATE_DISCUSSION_MUTATION = `mutation CreateDiscussion($input: CreateDiscussionInput!) {
  createDiscussion(input: $input) {
    discussion {
      id
      url
      number
    }
  }
}`;

function categoryIdForType(type: FeedbackType, env: OutboundEnv): string {
  switch (type) {
    case "Bug":
      return env.categoryIdBug;
    case "Feature request":
      return env.categoryIdFeature;
    case "Feedback":
      return env.categoryIdFeedback;
    case "Question":
      return env.categoryIdQuestion;
  }
}

function buildDiscussionBody(body: ValidatedBody): string {
  // The agent ships HTML in `content`. GitHub's Markdown engine accepts a
  // safe subset of HTML inline, so we pass it through. The footer signals
  // whether a reply-to address is available WITHOUT leaking the address
  // itself — the email goes via the Make-webhook private channel (see
  // lib/email-relay.ts), never into the public Discussion body.
  const trailer = body.email
    ? `\n\n---\n\n_A reply-to address was provided; available via the operator's inbox._`
    : `\n\n---\n\n_Submitted anonymously._`;
  return body.content + trailer;
}

export function toGraphQLRequest(
  body: ValidatedBody,
  env: OutboundEnv
): GraphQLRequest {
  return {
    query: CREATE_DISCUSSION_MUTATION,
    variables: {
      input: {
        repositoryId: env.repoId,
        categoryId: categoryIdForType(body.type, env),
        title: body.title,
        body: buildDiscussionBody(body),
      },
    },
  };
}
