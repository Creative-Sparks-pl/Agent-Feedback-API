// Pure builder for the Make.com email-relay webhook payload.
//
// The proxy builds a finished subject + body + reply-to, and Make's Gmail
// module plugs them straight into the email fields. Make is a dumb pipe —
// any email-template change happens here in code, not in Make.
//
// The relay is the private channel that carries the user's email. The public
// Discussion never sees it.
//
// If `body.email` is null, the relay is skipped entirely (returns null) —
// nothing to notify about and no reply-to address.
// If env vars MAKE_WEBHOOK_URL / MAKE_API_KEY are missing, the handler skips
// the relay (graceful degradation — the Discussion still lands; the operator
// just doesn't get an inbox notification).

import type { ValidatedBody } from "./validate.js";

export interface EmailRelayPayload {
  subject: string;
  body: string;
  reply_to: string;
}

export function toEmailRelayPayload(
  body: ValidatedBody,
  discussion: { url: string; number: number }
): EmailRelayPayload | null {
  if (body.email === null) return null;

  const subject = `[UXD Feedback] [${body.type}] ${body.title}`;

  // Tiny HTML escape — body.title and body.email come from validated user
  // input. body.content is already HTML (the agent ships HTML deliberately,
  // see helper §Drafting rules), so we pass it through verbatim.
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const html = [
    `<p>A new <strong>${esc(body.type)}</strong> was submitted via the ux-designer agent.</p>`,
    `<p>`,
    `<strong>Title:</strong> ${esc(body.title)}<br>`,
    `<strong>Reply-to:</strong> ${esc(body.email)}<br>`,
    `<strong>Discussion #${discussion.number}:</strong> <a href="${discussion.url}">${discussion.url}</a>`,
    `</p>`,
    `<hr>`,
    `<div>${body.content}</div>`,
    `<hr>`,
    `<p><em>Reply directly to this email — Gmail's Reply will land in the user's inbox.</em></p>`,
  ].join("\n");

  return {
    subject,
    body: html,
    reply_to: body.email,
  };
}
