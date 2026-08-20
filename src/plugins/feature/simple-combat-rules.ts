import type { BattleCommand, BattleDirective, BattleState } from "../../core/contracts.js";
import type { CombatActionHandler, CombatActionResolution } from "../../core/combat-action-handler.js";
import type { ProposedEvent } from "../../protocol/command.js";

/** Deterministic reference rules owned by feature.simple-combat rather than Runtime. */
export class SimpleCombatActionHandler implements CombatActionHandler {
  public resolve({ state, action }: Parameters<CombatActionHandler["resolve"]>[0]): CombatActionResolution {
    const battle = state.battle ? structuredClone(state.battle) : undefined;
    if (!battle || battle.status !== "active") return { accepted: false, reason: "battle_not_active" };
    const directive = readDirective(action.parameters);
    if (!directive) return { accepted: false, reason: "battle_directive_required" };
    if (directive.participation === "command") return this.commands(state, action.actorId, battle, directive.commands ?? []);
    if (directive.participation === "delegate") return this.delegate(state, action.actorId, battle, directive.delegateTo ?? []);
    return this.quick(state, action.actorId, battle);
  }

  private commands(state: Parameters<CombatActionHandler["resolve"]>[0]["state"], playerId: string, battle: BattleState, commands: BattleCommand[]): CombatActionResolution {
    if (!commands.length) return { accepted: false, reason: "battle_commands_required" };
    const changes: Array<Record<string, unknown>> = [];
    for (const command of commands) {
      const actorId = command.actorId ?? playerId;
      if (!battle.allies[actorId] || battle.allies[actorId].hp <= 0) return { accepted: false, reason: "battle_actor_unavailable" };
      const change = apply(battle, actorId, command);
      if (!change) return { accepted: false, reason: "battle_target_unavailable" };
      changes.push(change);
      if (battle.status === "resolved") break;
    }
    return finish(state, playerId, battle, "command", changes);
  }

  private delegate(state: Parameters<CombatActionHandler["resolve"]>[0]["state"], playerId: string, battle: BattleState, requestedIds: string[]): CombatActionResolution {
    const ids = requestedIds.length ? requestedIds : Object.keys(battle.allies).filter((id) => id !== playerId);
    const actors = ids.filter((id) => battle.allies[id]?.hp > 0);
    if (!actors.length) return { accepted: false, reason: "no_available_companion" };
    const changes: Array<Record<string, unknown>> = [];
    for (const actorId of actors) {
      const targetId = firstLivingEnemy(battle);
      if (!targetId) break;
      const change = apply(battle, actorId, { intent: "attack", targetId });
      if (change) changes.push(change);
    }
    return finish(state, playerId, battle, "delegate", changes);
  }

  private quick(state: Parameters<CombatActionHandler["resolve"]>[0]["state"], playerId: string, battle: BattleState): CombatActionResolution {
    const allyHp = Object.values(battle.allies).reduce((total, combatant) => total + Math.max(0, combatant.hp), 0);
    const enemyHp = Object.values(battle.enemies).reduce((total, combatant) => total + Math.max(0, combatant.hp), 0);
    const outcome = allyHp >= enemyHp ? "victory" : "withdrawn";
    if (outcome === "victory") for (const enemy of Object.values(battle.enemies)) enemy.hp = 0;
    battle.status = "resolved";
    battle.outcome = outcome;
    const recipients = battleRecipients(state, battle, playerId);
    return { accepted: true, battle, events: [
      { type: "battle_round_resolved", payload: { battleId: battle.id, turn: battle.turn, participation: "quick_resolve", prototype: true, changes: [{ outcome, note: "Prototype quick resolver; no detailed exchange was simulated." }] }, recipients },
      { type: "battle_finished", payload: { battleId: battle.id, locationId: battle.locationId, outcome, objective: battle.objective }, recipients },
    ] };
  }
}

function finish(state: Parameters<CombatActionHandler["resolve"]>[0]["state"], playerId: string, battle: BattleState, participation: BattleDirective["participation"], changes: Array<Record<string, unknown>>): CombatActionResolution {
  if (!firstLivingEnemy(battle)) { battle.status = "resolved"; battle.outcome = "victory"; }
  const turn = battle.turn;
  if (battle.status === "active") battle.turn += 1;
  const recipients = battleRecipients(state, battle, playerId);
  const events: ProposedEvent[] = [{ type: "battle_round_resolved", payload: { battleId: battle.id, turn, participation, prototype: true, changes }, recipients }];
  if (battle.status === "resolved") events.push({ type: "battle_finished", payload: { battleId: battle.id, locationId: battle.locationId, outcome: battle.outcome, objective: battle.objective }, recipients });
  return { accepted: true, battle, events };
}

function apply(battle: BattleState, actorId: string, command: BattleCommand): Record<string, unknown> | undefined {
  if (command.intent === "attack") { const targetId = command.targetId ?? firstLivingEnemy(battle); const target = targetId ? battle.enemies[targetId] : undefined; if (!target || target.hp <= 0) return undefined; target.hp = Math.max(0, target.hp - 1); return { actorId, intent: "attack", targetId, damage: 1, targetHp: target.hp }; }
  if (command.intent === "defend") { const actor = battle.allies[actorId]; if (!actor.states.includes("guarded")) actor.states.push("guarded"); return { actorId, intent: "defend", state: "guarded" }; }
  if (command.intent === "retreat") { battle.status = "resolved"; battle.outcome = "withdrawn"; return { actorId, intent: "retreat", outcome: "withdrawn" }; }
  if (command.intent === "analyze") return { actorId, intent: "analyze", targetId: command.targetId ?? firstLivingEnemy(battle) };
  return { actorId, intent: command.intent, state: "queued_for_future_combat_module" };
}

function readDirective(parameters: Record<string, unknown> | undefined): BattleDirective | undefined {
  const participation = parameters?.participation;
  if (participation !== "command" && participation !== "delegate" && participation !== "quick_resolve") return undefined;
  const commands = Array.isArray(parameters?.commands) ? parameters.commands.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Record<string, unknown>; const intent = candidate.intent;
    if (intent !== "attack" && intent !== "defend" && intent !== "skill" && intent !== "item" && intent !== "retreat" && intent !== "analyze") return [];
    return [{ actorId: typeof candidate.actorId === "string" ? candidate.actorId : undefined, intent, targetId: typeof candidate.targetId === "string" ? candidate.targetId : undefined } satisfies BattleCommand];
  }) : undefined;
  const delegateTo = Array.isArray(parameters?.delegateTo) ? parameters.delegateTo.filter((value): value is string => typeof value === "string") : undefined;
  return { participation, commands, delegateTo };
}

function firstLivingEnemy(battle: BattleState): string | undefined { return Object.values(battle.enemies).find((combatant) => combatant.hp > 0)?.id; }
function battleRecipients(state: Parameters<CombatActionHandler["resolve"]>[0]["state"], battle: BattleState, playerId: string): string[] { return [...new Set([playerId, ...Object.keys(battle.allies).filter((id) => state.characters[id])])]; }
