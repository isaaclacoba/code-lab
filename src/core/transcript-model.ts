// DOM-free model for the AI-track "transcript" scene: the honest picture of what
// an agent run actually is - a growing list of role-tagged messages that the
// model re-reads on every call. It makes the non-obvious truths visible: the
// model only ever writes text (an `assistant` message), so a tool result is
// written by YOUR code (a `tool` message); "memory" is just this list being
// re-sent; and instructions/skills/specs are just more text placed near the top.
// Pure data + one pure resolver so the author/label logic is unit-tested without
// a browser, mirroring tool-rack-model and memory-shelf-model.

/** The role a message carries in the conversation sent to the model. `developer`
 *  is the operator/instruction turn some APIs separate from `system`. */
export type MsgRole = "system" | "developer" | "user" | "assistant" | "tool";

/** Who actually authored a message. This is the crux of the tools lesson: the
 *  model only writes `assistant` text; a `tool` message is written by your code
 *  after it runs the function. `app` is your program (system prompt, injected
 *  instructions); `you` is the human turn. */
export type MsgAuthor = "you" | "model" | "code" | "app";

/** One message in the transcript. */
export interface TranscriptMessage {
  role: MsgRole;
  /** The message content (plain text; long text wraps). */
  text: string;
  /** Who wrote it. Defaults from the role when omitted. */
  by?: MsgAuthor;
  /** Spotlight this message - it was just added or changed this step. */
  hot?: boolean;
  /** A short aside under the message, e.g. "the model only emits text". */
  note?: string;
}

/** Which way the arrow points when a step shows an API round-trip. */
export type TranscriptFlow = "send" | "receive";

/** One snapshot of the transcript for a step. */
export interface TranscriptScene {
  /** Caption above the transcript. */
  caption?: string;
  /** The messages so far, in order. */
  messages?: TranscriptMessage[];
  /** A banner above the list, e.g. "API call 2 - the whole list is re-sent". */
  banner?: string;
  /** Show the send/receive arrow with the banner (app to model, or back). */
  flow?: TranscriptFlow | null;
}

/** The default author for each role, used when a message omits `by`. The model
 *  writes only assistant turns; your code writes tool results; your app writes
 *  the system/developer turns; you write the user turn. */
const ROLE_AUTHOR: Record<MsgRole, MsgAuthor> = {
  system: "app",
  developer: "app",
  user: "you",
  assistant: "model",
  tool: "code",
};

/** A message resolved for rendering: role, text, resolved author, spotlight,
 *  and optional note. Pure so the view is a thin renderer. */
export interface ResolvedMessage {
  role: MsgRole;
  text: string;
  author: MsgAuthor;
  hot: boolean;
  note?: string;
}

/** Resolve every message: fill in the author from the role when not overridden,
 *  default the spotlight to off, in order. Pure, so the defaulting is a
 *  unit-tested rule in the model (mirrors resolveRackTools / shelfStores). */
export function resolveTranscript(scene: TranscriptScene | null | undefined): ResolvedMessage[] {
  const messages = scene?.messages ?? [];
  return messages.map((m) => ({
    role: m.role,
    text: m.text,
    author: m.by ?? ROLE_AUTHOR[m.role],
    hot: Boolean(m.hot),
    note: m.note,
  }));
}

/** The author of a message, honouring an explicit `by` over the role default.
 *  Exposed on its own so a lesson (or a test) can ask "who wrote this?" without
 *  resolving the whole list. Pure. */
export function authorOf(message: TranscriptMessage): MsgAuthor {
  return message.by ?? ROLE_AUTHOR[message.role];
}
