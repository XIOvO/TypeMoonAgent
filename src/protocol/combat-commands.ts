import type { CapabilityDefinition } from "./capability.js";
import type { CommandEnvelope } from "./command.js";
import type { CapabilityId } from "./ids.js";

export const COMBAT_RESOLVE_CAPABILITY = "combat.resolve";

export type CombatActionIntent = "attack" | "defend" | "skill" | "item" | "retreat" | "analyze";

export interface CombatActionCommand {
  actorId?: string;
  intent: CombatActionIntent;
  targetId?: string;
}

export type CombatResolveCommandPayload =
  | { participation: "command"; commands: CombatActionCommand[] }
  | { participation: "delegate"; delegateTo?: string[] }
  | { participation: "quick_resolve" };

export type CombatResolveCommand = CommandEnvelope<CombatResolveCommandPayload> & { type: typeof COMBAT_RESOLVE_CAPABILITY; actorId: string };

export const COMBAT_RESOLVE_COMMAND_SCHEMA = {
  oneOf: [
    { type: "object", required: ["participation", "commands"], additionalProperties: false, properties: {
      participation: { const: "command" },
      commands: { type: "array", minItems: 1, items: { type: "object", required: ["intent"], additionalProperties: false, properties: {
        actorId: { type: "string", minLength: 1 },
        intent: { enum: ["attack", "defend", "skill", "item", "retreat", "analyze"] },
        targetId: { type: "string", minLength: 1 },
      } } },
    } },
    { type: "object", required: ["participation"], additionalProperties: false, properties: {
      participation: { const: "delegate" },
      delegateTo: { type: "array", items: { type: "string", minLength: 1 } },
    } },
    { type: "object", required: ["participation"], additionalProperties: false, properties: { participation: { const: "quick_resolve" } } },
  ],
} as const;

/** Public, serializable capability contract. C2 supplies its first provider. */
export const COMBAT_RESOLVE_CAPABILITY_DEFINITION: CapabilityDefinition = {
  id: COMBAT_RESOLVE_CAPABILITY as CapabilityId,
  version: "1.0.0",
  scope: "public",
  description: "Resolve one existing battle through commands, delegation, or quick resolution.",
  inputSchema: COMBAT_RESOLVE_COMMAND_SCHEMA,
};

export function isCombatResolveCommand(command: CommandEnvelope): command is CombatResolveCommand {
  if (command.type !== COMBAT_RESOLVE_CAPABILITY || !text(command.actorId) || !record(command.payload)) return false;
  const payload = command.payload;
  if (payload.participation === "command") return fields(payload, ["participation", "commands"]) && Array.isArray(payload.commands) && payload.commands.length > 0 && payload.commands.every(isAction);
  if (payload.participation === "delegate") return fields(payload, ["participation", "delegateTo"]) && (payload.delegateTo === undefined || ids(payload.delegateTo));
  return payload.participation === "quick_resolve" && fields(payload, ["participation"]);
}

function isAction(value: unknown): value is CombatActionCommand {
  return record(value) && fields(value, ["actorId", "intent", "targetId"]) && intent(value.intent) && (value.actorId === undefined || text(value.actorId)) && (value.targetId === undefined || text(value.targetId));
}

function intent(value: unknown): value is CombatActionIntent { return value === "attack" || value === "defend" || value === "skill" || value === "item" || value === "retreat" || value === "analyze"; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.every(text); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fields(value: Record<string, unknown>, names: readonly string[]): boolean { return Object.keys(value).every((name) => names.includes(name) && value[name] !== undefined); }
