import {
  COMBAT_RESOLVE_CAPABILITY_DEFINITION,
  defineEventSchema,
  definePlugin,
  isCombatResolveCommand,
} from "agent-game-runtime/sdk";
import type {
  CombatActionCommand,
  CombatActionIntent,
  CombatResolveCommand,
  CommandEnvelope,
  CommandResult,
  PluginRuntimeContext,
} from "agent-game-runtime/sdk";

export interface CombatResolveCapability {
  execute(command: CommandEnvelope): Promise<CommandResult>;
}

export interface SimpleCombatConfig {
  readonly attackDamage?: number;
}

export interface CombatActionResolvedPayload {
  readonly actorId: string;
  readonly intent: CombatActionIntent;
  readonly targetId?: string;
  readonly outcome: string;
  readonly damage?: number;
}

export const COMBAT_ACTION_RESOLVED_EVENT = defineEventSchema({
  type: "combat.action.resolved",
  schemaVersion: 1,
  payloadSchema: {
    type: "object",
    required: ["actorId", "intent", "outcome"],
    additionalProperties: false,
    properties: {
      actorId: { type: "string", minLength: 1 },
      intent: { enum: ["attack", "defend", "skill", "item", "retreat", "analyze"] },
      targetId: { type: "string", minLength: 1 },
      outcome: { type: "string", minLength: 1 },
      damage: { type: "integer", minimum: 0 },
    },
  },
});

export const COMBAT_CONTROL_DELEGATED_EVENT = defineEventSchema({
  type: "combat.control.delegated",
  schemaVersion: 1,
  payloadSchema: {
    type: "object",
    required: ["actorId", "delegateTo"],
    additionalProperties: false,
    properties: {
      actorId: { type: "string", minLength: 1 },
      delegateTo: { type: "array", items: { type: "string", minLength: 1 } },
    },
  },
});

export const COMBAT_QUICK_RESOLVED_EVENT = defineEventSchema({
  type: "combat.battle.quick_resolved",
  schemaVersion: 1,
  payloadSchema: {
    type: "object",
    required: ["actorId", "outcome"],
    additionalProperties: false,
    properties: {
      actorId: { type: "string", minLength: 1 },
      outcome: { const: "resolved" },
    },
  },
});

export const simpleCombatPlugin = definePlugin({
  manifest: {
    id: "example.simple-combat",
    version: "1.0.0",
    apiVersion: "0.3",
    configVersion: 1,
    type: "feature",
    description: "Portable deterministic combat.resolve reference provider.",
    provides: [COMBAT_RESOLVE_CAPABILITY_DEFINITION],
    ownsEvents: [
      { namespace: "combat.action", versions: [1] },
      { namespace: "combat.control", versions: [1] },
      { namespace: "combat.battle", versions: [1] },
    ],
  },
  setup(context: PluginRuntimeContext) {
    const attackDamage = readAttackDamage(context.config);
    const implementation: CombatResolveCapability = {
      async execute(command) {
        if (!isCombatResolveCommand(command)) {
          return {
            accepted: false,
            rejection: { code: "combat.command_invalid" },
          };
        }
        return resolve(command, attackDamage);
      },
    };
    context.capabilities.provide(COMBAT_RESOLVE_CAPABILITY_DEFINITION, implementation);
    context.logger.info("simple combat ready", {
      capability: COMBAT_RESOLVE_CAPABILITY_DEFINITION.id,
      attackDamage,
    });
  },
});

function resolve(command: CombatResolveCommand, attackDamage: number): CommandResult {
  if (command.payload.participation === "command") {
    return {
      accepted: true,
      events: command.payload.commands.map((action) => ({
        type: COMBAT_ACTION_RESOLVED_EVENT.type,
        payload: resolveAction(action, command.actorId, attackDamage),
      })),
    };
  }
  if (command.payload.participation === "delegate") {
    return {
      accepted: true,
      events: [{
        type: COMBAT_CONTROL_DELEGATED_EVENT.type,
        payload: {
          actorId: command.actorId,
          delegateTo: command.payload.delegateTo ?? [],
        },
      }],
    };
  }
  return {
    accepted: true,
    events: [{
      type: COMBAT_QUICK_RESOLVED_EVENT.type,
      payload: {
        actorId: command.actorId,
        outcome: "resolved",
      },
    }],
  };
}

function resolveAction(
  action: CombatActionCommand,
  fallbackActorId: string,
  attackDamage: number,
): CombatActionResolvedPayload {
  const actorId = action.actorId ?? fallbackActorId;
  const target = action.targetId ? { targetId: action.targetId } : {};
  if (action.intent === "attack") {
    return { actorId, intent: action.intent, ...target, outcome: "hit", damage: attackDamage };
  }
  const outcomes: Record<Exclude<CombatActionIntent, "attack">, string> = {
    defend: "guarded",
    skill: "skill_applied",
    item: "item_applied",
    retreat: "retreat_requested",
    analyze: "analysis_completed",
  };
  return { actorId, intent: action.intent, ...target, outcome: outcomes[action.intent] };
}

function readAttackDamage(config: unknown): number {
  if (typeof config !== "object" || config === null || !("attackDamage" in config)) return 1;
  const damage = (config as SimpleCombatConfig).attackDamage;
  return typeof damage === "number" && Number.isInteger(damage) && damage >= 0 ? damage : 1;
}
