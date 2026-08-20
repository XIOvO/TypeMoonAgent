import type { CommandEnvelope } from "./command.js";

export const STORY_ENTER_CAPABILITY = "story.enter";
export const STORY_EVALUATE_CAPABILITY = "story.evaluate";
export const STORY_PROGRESS_CAPABILITY = "story.progress";

export interface StoryEnterCommandPayload {
  playerId: string;
  packageId: string;
  mode: "new" | "resume" | "assumed_start";
}

export interface StoryEvaluateCommandPayload {
  packageId: string;
  eventIds: string[];
}

export interface StoryProgressCommandPayload {
  playerId: string;
  packageId: string;
  nodeId: string;
  sourceEventIds: string[];
}

export type StoryCommand =
  | CommandEnvelope<StoryEnterCommandPayload> & { type: typeof STORY_ENTER_CAPABILITY }
  | CommandEnvelope<StoryEvaluateCommandPayload> & { type: typeof STORY_EVALUATE_CAPABILITY }
  | CommandEnvelope<StoryProgressCommandPayload> & { type: typeof STORY_PROGRESS_CAPABILITY };

/** JSON-serializable contracts; handlers are introduced by the next migration stage. */
export const STORY_COMMAND_SCHEMAS = {
  [STORY_ENTER_CAPABILITY]: { type: "object", required: ["playerId", "packageId", "mode"], additionalProperties: false, properties: { playerId: { type: "string", minLength: 1 }, packageId: { type: "string", minLength: 1 }, mode: { enum: ["new", "resume", "assumed_start"] } } },
  [STORY_EVALUATE_CAPABILITY]: { type: "object", required: ["packageId", "eventIds"], additionalProperties: false, properties: { packageId: { type: "string", minLength: 1 }, eventIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } } } },
  [STORY_PROGRESS_CAPABILITY]: { type: "object", required: ["playerId", "packageId", "nodeId", "sourceEventIds"], additionalProperties: false, properties: { playerId: { type: "string", minLength: 1 }, packageId: { type: "string", minLength: 1 }, nodeId: { type: "string", minLength: 1 }, sourceEventIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } } } },
} as const;

export function isStoryCommand(command: CommandEnvelope): command is StoryCommand {
  const payload = command.payload;
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  if (command.type === STORY_ENTER_CAPABILITY) return fields(value, ["playerId", "packageId", "mode"]) && text(value.playerId) && text(value.packageId) && (value.mode === "new" || value.mode === "resume" || value.mode === "assumed_start");
  if (command.type === STORY_EVALUATE_CAPABILITY) return fields(value, ["packageId", "eventIds"]) && text(value.packageId) && ids(value.eventIds);
  return command.type === STORY_PROGRESS_CAPABILITY && fields(value, ["playerId", "packageId", "nodeId", "sourceEventIds"]) && text(value.playerId) && text(value.packageId) && text(value.nodeId) && ids(value.sourceEventIds);
}

function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every(text); }
function fields(value: Record<string, unknown>, names: readonly string[]): boolean { return Object.keys(value).length === names.length && names.every((name) => name in value); }
