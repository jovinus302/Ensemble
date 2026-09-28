// Channel model: members, messages, attachments, cards. The web app is the first adapter;
// a real Slack integration would be another ChannelAdapter implementation.
import type { ActorKind, Id } from "@ensemble/core";

export interface Member {
  id: Id;
  kind: ActorKind;
  displayName: string;
  /** Role from the team template, e.g. "designer" or "research-agent". */
  role?: string;
}

export interface Attachment {
  id: Id;
  name: string;
  mimeType: string;
  /** Where the content can be fetched; storage is the adapter's concern. */
  uri: string;
}

export type CardKind =
  | "plan_approval"
  | "verification_approval"
  | "goal_approval"
  | "decision_confirmation";

export interface Card {
  id: Id;
  kind: CardKind;
  /** Ledger entity the card acts on (plan, criterion, goal, decision). */
  subjectId: Id;
  status: "open" | "resolved" | "withdrawn";
}

export interface ChannelMessage {
  id: Id;
  channelId: Id;
  authorId: Id;
  text: string;
  attachments: Attachment[];
  card?: Card;
  /** Thread root message id, if this is a reply. */
  threadId?: Id;
  at: string;
}

export interface ChannelAdapter {
  post(message: Omit<ChannelMessage, "id" | "at">): Promise<ChannelMessage>;
  subscribe(channelId: Id, onMessage: (message: ChannelMessage) => void): () => void;
}
