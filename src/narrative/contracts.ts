/**
 * A browser-facing, replayable plan derived only from committed Runtime facts.
 * It never grants the renderer authority to change GameState.
 */
export interface NarrativeBeat {
  id: string;
  sourceEventIds: string[];
  stateRevision: number;
  blocks: NarrativeBlock[];
}

export type NarrativeBlock = DialogueBlock | NarrationBlock | ThoughtBlock | SystemBlock | SceneTransitionBlock;

export interface BaseNarrativeBlock {
  id: string;
  /** Where a completed block is allowed to appear. The browser records it only after playback finishes. */
  record: "backlog" | "world" | "private" | "none";
}

export interface DialogueBlock extends BaseNarrativeBlock {
  kind: "dialogue";
  speakerId: string;
  speakerName: string;
  text: string;
}

export interface NarrationBlock extends BaseNarrativeBlock {
  kind: "narration";
  text: string;
}

/** Only explicitly player-visible inner material may use this block. */
export interface ThoughtBlock extends BaseNarrativeBlock {
  kind: "thought";
  text: string;
}

/** A concise presentation of an already-settled objective fact. */
export interface SystemBlock extends BaseNarrativeBlock {
  kind: "system";
  text: string;
  importance: "temporary" | "important";
}

/** The sole block allowed to request a location or time title change. */
export interface SceneTransitionBlock extends BaseNarrativeBlock {
  kind: "scene_transition";
  locationId: string;
  title: string;
}
