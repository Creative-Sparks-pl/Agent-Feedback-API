// Pure mapper from agent-side payload to Featurebase-side payload. The
// handler in api/feedback.ts performs the outbound POST.

import type { ValidatedBody } from "./validate.js";

export interface OutboundEnv {
  boardId: string;
  fieldTypeId: string;
}

export interface FeaturebasePayload {
  title: string;
  content: string;
  boardId: string;
  customFields: Record<string, string>;
  author?: { email: string };
}

export function toFeaturebasePayload(
  body: ValidatedBody,
  env: OutboundEnv
): FeaturebasePayload {
  const payload: FeaturebasePayload = {
    title: body.title,
    content: body.content,
    boardId: env.boardId,
    customFields: { [env.fieldTypeId]: body.type },
  };

  if (body.email !== null) {
    payload.author = { email: body.email };
  }

  return payload;
}
