// Pure mapper from agent-side payload to Featurebase-side payload. The
// handler in api/feedback.ts performs the outbound POST.
//
// Category encoding: Featurebase Free plan paywalls custom fields and limits
// tags to two predefined priority labels, so per FIN-007 we encode the
// agent's `type` as a title prefix instead. The operator filters in the
// Featurebase dashboard by typing the prefix (e.g. `[Bug]`) into search.

import type { ValidatedBody } from "./validate.js";

export interface OutboundEnv {
  boardId: string;
}

export interface FeaturebasePayload {
  title: string;
  content: string;
  boardId: string;
  author?: { email: string };
}

export function toFeaturebasePayload(
  body: ValidatedBody,
  env: OutboundEnv
): FeaturebasePayload {
  const payload: FeaturebasePayload = {
    title: `[${body.type}] ${body.title}`,
    content: body.content,
    boardId: env.boardId,
  };

  if (body.email !== null) {
    payload.author = { email: body.email };
  }

  return payload;
}
