// Scenario mode replays scripted human turns through the same engine as free mode;
// only the source of human input differs. PM and agent turns are always live LLM calls.
import type { Id } from "@ensemble/core";

export interface ScriptedStep {
  /** Member id of the human speaking (e.g. "user", "designer"). */
  as: Id;
  text: string;
  attachments?: { name: string; mimeType: string; content: string }[];
  /** Wait for this ledger event type before posting, so the script follows the real flow. */
  waitFor?: string;
}

export interface Scenario {
  key: string;
  title: string;
  /** intent.md / product-state-model.md section this scenario reproduces. */
  source: string;
  members: { id: Id; kind: "human" | "agent" | "pm"; displayName: string; role?: string }[];
  steps: ScriptedStep[];
}
export { SCENE_NOW, sceneTasks, sceneEvents, scene1, scene2, scene3 } from './scene-fixtures.ts';
