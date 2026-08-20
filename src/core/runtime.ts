import { createHash, randomUUID } from "node:crypto";
import type {
  ActionResult,
  AgentAction,
  BattleState,
  CharacterState,
  RuntimeCharacterIntroductionRequest,
  RuntimeBattleStartRequest,
  GameEvent,
  GameMoment,
  GameState,
  Observation,
  PlayerAction,
  PlayerPrivateNote,
  RawPlayerInput,
} from "./contracts.js";
import { asAgentRunnerResolver, isCombinedTurnRunner, type AgentRunnerResolver, type AgentRunnerSource } from "./agent-runner.js";
import type { NavigationPlanner } from "./navigation.js";
import type { TurnCommitter } from "../persistence/turn-commit.js";
import type { StoryChapterPackage } from "./worldline.js";
import type { WorldStatePublisher } from "./world-state.js";
import type { InteractionCommandHandler } from "./interaction-command-handler.js";
import type { InteractionExecution } from "./interaction-execution.js";
import type { CombatActionHandler } from "./combat-action-handler.js";
import { SessionOperationQueue } from "../kernel/session-operation-queue.js";
import { IdempotencyRegistry } from "../kernel/idempotency.js";
import { RuntimeAuthority } from "../kernel/authority.js";
import { RuntimeTransaction } from "../kernel/transaction.js";
import type { CommandEnvelope } from "../protocol/command.js";

export type RuntimeEventListener = (event: GameEvent, recipientIds: readonly string[]) => void;
export interface ChapterEntryCommitter {
  commitEntry(input: { sessionId: string; playerId: string; chapter: StoryChapterPackage; now: string; checkpointRevision: number }): void;
}
export interface RuntimeChapterEntryRequest {
  id: string;
  sessionId: string;
  playerId: string;
  mode: "new" | "assumed_start";
  chapter: StoryChapterPackage;
}
export interface RuntimeCharacterInitiativeRequest {
  id: string;
  sessionId: string;
  playerId: string;
  characterId: string;
  reason: string;
  storySummon?: { packageId: string; nodeId: string };
}
export interface RuntimeCharacterApproachRequest {
  id: string;
  sessionId: string;
  playerId: string;
  characterId: string;
  expectedPlayerLocationId: string;
  reason: string;
}

export class GameRuntime {
  private readonly idempotency = new IdempotencyRegistry<ActionResult>();
  private readonly authority = new RuntimeAuthority();
  private readonly transaction = new RuntimeTransaction();
  private readonly operationQueue = new SessionOperationQueue();
  private readonly events: GameEvent[] = [];
  private readonly recipientsByEventId = new Map<string, readonly string[]>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly agents: AgentRunnerResolver;
  private nextSequence: number;
  private state: GameState;

  public constructor(
    state: GameState,
    agents: AgentRunnerSource,
    private readonly committer?: TurnCommitter,
    /** Retained only for positional compatibility; appearance policy is feature-owned. */
    _legacyIntroductionPolicy?: unknown,
    initialSequence = 0,
    private readonly chapterEntries?: ChapterEntryCommitter,
    private readonly worldStatePublisher?: WorldStatePublisher,
    private readonly navigation?: NavigationPlanner,
    private readonly interaction?: InteractionCommandHandler,
    private readonly combat?: CombatActionHandler,
  ) {
    this.agents = asAgentRunnerResolver(agents);
    this.state = { ...state, moment: normalizeGameMoment(state.sessionId, state.moment) };
    this.nextSequence = initialSequence;
  }

  public getState(): Readonly<GameState> {
    return structuredClone(this.state);
  }

  public getEvents(): readonly GameEvent[] {
    return [...this.events];
  }

  /** Events are emitted only after their enclosing TurnCommit succeeds. */
  public subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async handlePlayerAction(action: PlayerAction): Promise<ActionResult> {
    return this.execute(this.legacyCommand("player.action", action));
  }

  /** Compatibility command facade; Runtime owns validation and commit only. */
  public async execute(command: CommandEnvelope): Promise<ActionResult> {
    switch (command.type) {
      case "player.action": return this.handleOnce(command.id, requestFingerprint(command.payload as object), () => this.handlePlayerActionOnce(command.payload as PlayerAction));
      case "player.raw_input": return this.handleOnce(command.id, requestFingerprint(command.payload as object), () => this.handleRawPlayerInputOnce(command.payload as RawPlayerInput));
      case "story.enter_chapter": return this.handleOnce(command.id, requestFingerprint(command.payload as object), async () => this.enterChapterOnce(command.payload as RuntimeChapterEntryRequest));
      case "story.introduce_character": return this.handleOnce(command.id, requestFingerprint(command.payload as object), async () => this.introduceCharacterOnce(command.payload as RuntimeCharacterIntroductionRequest));
      case "combat.start": return this.handleOnce(command.id, requestFingerprint(command.payload as object), async () => this.startBattleOnce(command.payload as RuntimeBattleStartRequest));
      case "world.character_initiative": return this.handleOnce(command.id, requestFingerprint(command.payload as object), () => this.runCharacterInitiativeOnce(command.payload as RuntimeCharacterInitiativeRequest));
      case "world.character_approach": return this.handleOnce(command.id, requestFingerprint(command.payload as object), async () => this.moveCharacterTowardPlayerOnce(command.payload as RuntimeCharacterApproachRequest));
      case "interaction.execute": return this.handleOnce(command.id, requestFingerprint(command.payload as object), () => this.executeInteractionOnce(command.payload as InteractionExecution));
      default: throw new Error("command_not_found");
    }
  }

  private legacyCommand<T extends { id: string; sessionId: string }>(type: string, payload: T): CommandEnvelope<T> {
    const actorId = "actorId" in payload && typeof payload.actorId === "string" ? payload.actorId : undefined;
    return { id: payload.id, sessionId: payload.sessionId, type, ...(actorId ? { actorId } : {}), payload, causation: {}, correlationId: `legacy:${payload.sessionId}:${payload.id}` };
  }

  /** Trusted background entry point for one same-scene NPC opener. */
  public async runCharacterInitiative(request: RuntimeCharacterInitiativeRequest): Promise<ActionResult> {
    return this.execute(this.legacyCommand("world.character_initiative", request));
  }

  /** Trusted background movement: exactly one normal map edge toward a known player location. */
  public async moveCharacterTowardPlayer(request: RuntimeCharacterApproachRequest): Promise<ActionResult> {
    return this.execute(this.legacyCommand("world.character_approach", request));
  }

  private moveCharacterTowardPlayerOnce(request: RuntimeCharacterApproachRequest): ActionResult {
    const player = this.state.characters[request.playerId];
    const character = this.state.characters[request.characterId];
    if (request.sessionId !== this.state.sessionId || !player || !character || character.id === player.id) throw new Error("character_approach_unavailable");
    if (this.state.battle?.status === "active" || player.locationId !== request.expectedPlayerLocationId || character.locationId === player.locationId) throw new Error("character_approach_ineligible");
    const route = this.navigation?.findRoute(this.state, character.locationId, player.locationId);
    const destination = route?.kind === "reachable" ? route.steps[0] : undefined;
    if (!destination) throw new Error("character_approach_path_unavailable");
    const from = character.locationId;
    const witnesses = this.visibleAt(from);
    character.locationId = destination;
    const event = this.append("character_moved", { characterId: character.id, from, to: destination, reason: request.reason }, { systemActionId: request.id }, undefined, [...witnesses, ...this.visibleAt(destination)]);
    return this.finish(request.id, [event]);
  }

  private async runCharacterInitiativeOnce(request: RuntimeCharacterInitiativeRequest): Promise<ActionResult> {
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      const player = this.state.characters[request.playerId];
      const character = this.state.characters[request.characterId];
      const runner = character ? this.agents.resolve(character.id) : undefined;
      if (request.sessionId !== this.state.sessionId || !player || !character || !runner) throw new Error("proactive_initiative_unavailable");
      if (this.state.battle?.status === "active" || player.locationId !== character.locationId) throw new Error("proactive_initiative_ineligible");
      const trigger: PlayerAction = {
        id: request.id, sessionId: request.sessionId, actorId: request.playerId, type: "action",
        parameters: { intent: "world_tick_proactive", reason: request.reason },
      };
      const observation = this.buildObservation(character, trigger);
      const agentAction = await runner.run(observation);
      if (agentAction.actorId !== character.id || agentAction.observationId !== observation.id || agentAction.requests.length) {
        throw new Error("invalid_proactive_agent_action");
      }
      const utterance = agentAction.utterance?.trim();
      if (!utterance) return this.finish(request.id, []);
      const event = this.append("character_spoke", {
        characterId: character.id, targetId: player.id, text: utterance, locationId: character.locationId,
      }, { systemActionId: request.id }, agentAction, this.visibleAt(character.locationId));
      const events = [event];
      if (request.storySummon) events.push(this.append("story_summon_opened", {
        packageId: request.storySummon.packageId, nodeId: request.storySummon.nodeId, characterId: character.id, playerId: player.id,
      }, { systemActionId: request.id }, agentAction, this.visibleAt(character.locationId)));
      return this.finish(request.id, events);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  private async handlePlayerActionOnce(action: PlayerAction): Promise<ActionResult> {
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      return await this.resolveAction(action);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  private async executeInteractionOnce(execution: InteractionExecution): Promise<ActionResult> {
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      const action = execution.action;
      const player = this.state.characters[execution.playerId];
      const target = execution.leadCharacterId ? this.state.characters[execution.leadCharacterId] : undefined;
      if (
        execution.sessionId !== this.state.sessionId ||
        action.sessionId !== execution.sessionId ||
        action.id !== execution.playerActionId ||
        action.actorId !== execution.playerId ||
        action.type !== "dialogue" ||
        !player || !target ||
        player.locationId !== execution.sceneId || target.locationId !== execution.sceneId
      ) return this.finish(execution.id, []);
      const runner = this.agents.resolve(target.id);
      if (!runner) return this.finish(execution.id, []);
      const observation = this.buildObservation(target, { ...action, targetIds: [target.id] });
      const agentAction = await runner.run(observation);
      if (agentAction.actorId !== target.id || agentAction.observationId !== observation.id) {
        return this.reject(action, "invalid_agent_action", [], execution.id);
      }
      return this.resolveAgentAction(action, agentAction, [], undefined, execution.id);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  /**
   * One-model social-turn path. The target's combined runner proposes both a
   * parsed player intent and a character response; Runtime validates both.
   */
  public async handleRawPlayerInput(input: RawPlayerInput): Promise<ActionResult> {
    return this.execute(this.legacyCommand("player.raw_input", input));
  }

  private async handleRawPlayerInputOnce(input: RawPlayerInput): Promise<ActionResult> {
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      if (input.sessionId !== this.state.sessionId || !this.state.characters[input.actorId]) {
        return this.reject({ id: input.id, sessionId: input.sessionId, actorId: input.actorId, type: "action" }, "invalid_raw_player_input");
      }
      const activeBattle = this.state.battle?.status === "active" ? this.state.battle : undefined;
      const targetId = input.targetIds?.[0] ?? (activeBattle
        ? Object.keys(activeBattle.allies).find((characterId) => characterId !== input.actorId && this.agents.resolve(characterId))
        : undefined);
      const target = targetId ? this.state.characters[targetId] : undefined;
      const runner = target ? this.agents.resolve(target.id) : undefined;
      if (!target || !runner || !isCombinedTurnRunner(runner)) throw new Error("combined_turn_runner_unavailable");
      const provisional: PlayerAction = {
        id: input.id, sessionId: input.sessionId, actorId: input.actorId,
        type: activeBattle ? "combat" : "dialogue", content: input.content, targetIds: [target.id],
        parameters: { rawInputMode: "auto" },
      };
      const observation = this.buildObservation(target, provisional);
      const proposal = await runner.runCombined(observation, input);
      if (activeBattle) {
        const action: PlayerAction = {
          id: input.id, sessionId: input.sessionId, actorId: input.actorId, type: "combat", content: input.content,
          targetIds: proposal.player.targetIds, parameters: proposal.battle ? { ...proposal.battle } : {},
        };
        return this.resolveBattleAction(action);
      }
      const action: PlayerAction = {
        id: input.id, sessionId: input.sessionId, actorId: input.actorId, type: proposal.player.type,
        content: proposal.player.publicText, targetIds: proposal.player.targetIds ?? [target.id], parameters: proposal.player.parameters,
      };
      if (action.type !== "dialogue") return this.resolveWorldAction(action);
      if (action.targetIds?.[0] !== target.id || !action.content?.trim()) return this.reject(action, "invalid_combined_player_intent");
      const playerEvent = this.append("player_spoke", { characterId: action.actorId, targetId: target.id, text: action.content.trim(), locationId: this.state.characters[action.actorId]?.locationId }, action, undefined, this.visibleAt(this.state.characters[action.actorId]?.locationId));
      if (proposal.character.actorId !== target.id || proposal.character.observationId !== observation.id) return this.reject(action, "invalid_agent_action", [playerEvent]);
      const privateNote = proposal.player.privateThought?.trim() ? {
        id: randomUUID(), sessionId: input.sessionId, playerId: input.actorId, sourceInputId: input.id,
        content: proposal.player.privateThought.trim(), createdAt: new Date().toISOString(),
      } satisfies PlayerPrivateNote : undefined;
      return this.resolveAgentAction(action, proposal.character, [playerEvent], privateNote);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  private handleOnce(actionId: string, fingerprint: string, operation: () => Promise<ActionResult>): Promise<ActionResult> {
    return this.idempotency.run({ id: actionId, fingerprint, operation, enqueue: (run) => this.enqueue(run), load: () => this.loadPriorAction(actionId, fingerprint) });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return this.operationQueue.enqueue(this.state.sessionId, operation);
  }

  private loadPriorAction(actionId: string, fingerprint: string): ActionResult | undefined { return this.committer?.getProcessedActionResult?.(actionId, fingerprint); }

  /** Trusted story operation. The chapter context and its L0 event commit together. */
  public async enterChapter(request: RuntimeChapterEntryRequest): Promise<ActionResult> {
    return this.execute(this.legacyCommand("story.enter_chapter", request));
  }

  private enterChapterOnce(request: RuntimeChapterEntryRequest): ActionResult {
    if (!this.committer || !this.chapterEntries) throw new Error("chapter_entry_committer_unavailable");
    if (request.sessionId !== this.state.sessionId) throw new Error("session_mismatch");
    if (!this.state.characters[request.playerId]) throw new Error("unknown_player");
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      const event = this.append("chapter_entered", {
        playerId: request.playerId, packageId: request.chapter.packageId, contentType: request.chapter.contentType,
        contentId: request.chapter.contentId, canonAnchor: request.chapter.canonAnchor, entryNodeId: request.chapter.entryNodeId,
        mode: request.mode,
      }, { systemActionId: request.id }, undefined, [request.playerId]);
      return this.finish(request.id, [event], undefined, [() => this.chapterEntries!.commitEntry({
        sessionId: request.sessionId, playerId: request.playerId, chapter: request.chapter,
        now: event.createdAt, checkpointRevision: event.stateRevision,
      })]);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  /**
   * Trusted story/GM operation that makes a policy-approved character present
   * in the objective world. It cannot be reached through PlayerAction.
   */
  public async introduceCharacter(request: RuntimeCharacterIntroductionRequest): Promise<ActionResult> {
    return this.execute(this.legacyCommand("story.introduce_character", request));
  }

  private introduceCharacterOnce(request: RuntimeCharacterIntroductionRequest): ActionResult {
    if (request.sessionId !== this.state.sessionId) throw new Error("session_mismatch");
    if (this.state.characters[request.characterId]) throw new Error("character_already_introduced");
    if (!this.state.locations[request.locationId]) throw new Error("introduction_location_unknown");
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      this.state.characters[request.characterId] = { id: request.characterId, locationId: request.locationId, mood: request.mood ?? "calm" };
      const recipients = this.visibleAt(request.locationId);
      const event = this.append("character_introduced", {
        characterId: request.characterId, locationId: request.locationId, reason: request.reason,
      }, { systemActionId: request.id }, undefined, recipients);
      return this.finish(request.id, [event]);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  /**
   * Trusted story/GM operation. It establishes objective combat state before
   * any player input is interpreted as a combat command.
   */
  public async startBattle(request: RuntimeBattleStartRequest): Promise<ActionResult> {
    return this.execute(this.legacyCommand("combat.start", request));
  }

  private startBattleOnce(request: RuntimeBattleStartRequest): ActionResult {
    if (request.sessionId !== this.state.sessionId) throw new Error("session_mismatch");
    if (this.state.battle?.status === "active") throw new Error("battle_already_active");
    if (!this.state.locations[request.locationId]) throw new Error("battle_location_unknown");
    if (!request.objective.trim()) throw new Error("battle_objective_required");
    const stateBefore = structuredClone(this.state);
    const eventCountBefore = this.events.length;
    const sequenceBefore = this.nextSequence;
    try {
      const allies = this.validateBattleSide(request.allies, request.locationId, true);
      const enemies = this.validateBattleSide(request.enemies, request.locationId, false);
      this.state.battle = { id: request.id, locationId: request.locationId, status: "active", turn: 1, objective: request.objective.trim(), allies, enemies };
      const event = this.append("battle_started", {
        battleId: request.id, locationId: request.locationId, objective: request.objective.trim(),
        allies: Object.values(allies).map((combatant) => ({ id: combatant.id, hp: combatant.hp, maxHp: combatant.maxHp })),
        enemies: Object.values(enemies).map((combatant) => ({ id: combatant.id, hp: combatant.hp, maxHp: combatant.maxHp })),
      }, { systemActionId: request.id }, undefined, this.battleRecipients(this.state.battle));
      return this.finish(request.id, [event]);
    } catch (error) {
      const rolledBack = this.events.splice(eventCountBefore);
      for (const event of rolledBack) this.recipientsByEventId.delete(event.id);
      this.state = stateBefore;
      this.nextSequence = sequenceBefore;
      throw error;
    }
  }

  private async resolveAction(action: PlayerAction): Promise<ActionResult> {
    if (action.sessionId !== this.state.sessionId) return this.reject(action, "session_mismatch");
    if (!this.state.characters[action.actorId]) return this.reject(action, "unknown_actor");

    if (action.type === "action") return this.resolveWorldAction(action);
    if (action.type === "combat") return this.resolveBattleAction(action);

    if (!action.content?.trim()) return this.reject(action, "dialogue_requires_content_and_target");
    const targetId = this.interaction?.resolveTarget({ state: this.getState(), action, requestedTargetId: action.targetIds?.[0] }) ?? action.targetIds?.[0];
    const target = targetId ? this.state.characters[targetId] : undefined;
    if (!target) return this.reject(action, "dialogue_requires_content_and_target");
    const resolvedAction: PlayerAction = targetId === action.targetIds?.[0] ? action : { ...action, targetIds: [target.id] };

    // Dialogue's validation above establishes a target; this keeps the
    // runtime resilient if further action types are added later.
    if (!target) return this.reject(action, "target_missing");
    const runner = this.agents.resolve(target.id);
    if (!runner) return this.reject(action, "target_has_no_agent");
    const dialogueEvent = this.append("player_spoke", {
      characterId: action.actorId, targetId: target.id, text: action.content.trim(), locationId: this.state.characters[action.actorId]?.locationId,
    }, resolvedAction, undefined, this.visibleAt(this.state.characters[action.actorId]?.locationId));
    if (this.interaction?.createExecutionCommitEffect) {
      return this.finish(resolvedAction.id, [dialogueEvent], undefined, [
        this.interaction.createExecutionCommitEffect({
          action: resolvedAction, targetId: target.id, sceneId: this.state.characters[resolvedAction.actorId]!.locationId,
          createdAt: dialogueEvent.createdAt,
        }),
      ]);
    }
    const observation = this.buildObservation(target, resolvedAction);
    const agentAction = await runner.run(observation);
    if (agentAction.actorId !== target.id || agentAction.observationId !== observation.id) {
      return this.reject(resolvedAction, "invalid_agent_action", [dialogueEvent]);
    }
    return this.resolveAgentAction(resolvedAction, agentAction, [dialogueEvent]);
  }

  private resolveWorldAction(action: PlayerAction): ActionResult {
    const kind = action.parameters?.intent ?? action.parameters?.action;
    if (typeof kind !== "string" && !action.content?.trim()) return this.reject(action, "action_requires_content_or_intent");
    if (kind === "move") return this.resolvePlayerMove(action);
    if (kind === "observe") {
      const actor = this.state.characters[action.actorId];
      return this.finish(action.id, [this.append("area_observed", {
        characterId: actor.id,
        locationId: actor.locationId,
        visibleEntityIds: this.visibleAt(actor.locationId),
      }, action, undefined, this.visibleAt(actor.locationId))]);
    }
    if (kind === "wait") {
      const actor = this.state.characters[action.actorId];
      const from = this.currentMoment();
      this.advanceGameTime();
      return this.finish(action.id, [this.append("time_waited", {
        characterId: actor.id,
        locationId: actor.locationId,
        ticks: 1,
        fromTick: from.tick,
        toTick: this.currentMoment().tick,
      }, action, undefined, this.visibleAt(actor.locationId))]);
    }
    if (kind === "inspect") return this.resolveInspect(action);
    if (kind === "interact") return this.resolveInteract(action);
    // Freeform actions are valid player attempts even when this Runtime has no
    // deterministic resolver yet. A later GM/action-resolver extension may
    // interpret them; until then, fail explicitly rather than inventing facts.
    return this.reject(action, "action_requires_resolver");
  }

  private resolveBattleAction(action: PlayerAction): ActionResult {
    if (!this.combat) return this.reject(action, "combat_provider_unavailable");
    const resolution = this.combat.resolve({ state: this.getState(), action });
    if (!resolution.accepted) return this.reject(action, resolution.reason);
    this.state.battle = structuredClone(resolution.battle);
    const events = resolution.events.map((event) => this.append(event.type as GameEvent["type"], event.payload as Record<string, unknown>, action, undefined, event.recipients ?? []));
    return this.finish(action.id, events);
  }

  private validateBattleSide(combatants: readonly import("./contracts.js").BattleCombatant[], locationId: string, allies: boolean): Record<string, import("./contracts.js").BattleCombatant> {
    if (combatants.length === 0) throw new Error(allies ? "battle_requires_allies" : "battle_requires_enemies");
    const side: Record<string, import("./contracts.js").BattleCombatant> = {};
    for (const combatant of combatants) {
      if (!combatant.id || side[combatant.id] || !Number.isFinite(combatant.hp) || !Number.isFinite(combatant.maxHp) || combatant.maxHp <= 0 || combatant.hp <= 0 || combatant.hp > combatant.maxHp) {
        throw new Error("invalid_battle_combatant");
      }
      if (allies && this.state.characters[combatant.id]?.locationId !== locationId) throw new Error("battle_ally_not_at_location");
      side[combatant.id] = { id: combatant.id, hp: combatant.hp, maxHp: combatant.maxHp, states: [...combatant.states] };
    }
    return side;
  }

  private battleRecipients(battle: BattleState, playerId?: string): string[] {
    return [...new Set([playerId, ...Object.keys(battle.allies).filter((id) => this.state.characters[id])].filter((id): id is string => Boolean(id)))];
  }

  private buildObservation(recipient: CharacterState, action: PlayerAction): Observation {
    return {
      id: randomUUID(), sessionId: this.state.sessionId, recipientId: recipient.id, triggerActionId: action.id,
      scene: { id: recipient.locationId, visibleEntityIds: Object.values(this.state.characters)
        .filter((character) => character.locationId === recipient.locationId).map((character) => character.id) },
      incomingAction: { actorId: action.actorId, type: action.type, content: action.content, parameters: action.parameters },
      selfState: structuredClone(recipient),
      constraints: ["Only describe facts in this observation or returned by authorized tools.", "Use submit_game_action for state changes."],
    };
  }

  private resolvePlayerMove(action: PlayerAction): ActionResult {
    const destination = action.parameters?.destination;
    if (typeof destination !== "string") return this.reject(action, "move_requires_destination");
    const event = this.createMoveEvent(action, action.actorId, destination);
    return event ? this.finish(action.id, [event]) : this.reject(action, "destination_unreachable");
  }

  private resolveInspect(action: PlayerAction): ActionResult {
    const object = this.localVisibleObject(action);
    if (!object) return this.reject(action, "inspect_target_unavailable");
    return this.finish(action.id, [this.append("object_inspected", {
      characterId: action.actorId, objectId: object.id, objectKind: object.kind,
      description: object.inspectText ?? `You inspect ${object.id}.`, tags: object.tags,
    }, action, undefined, [action.actorId])]);
  }

  private resolveInteract(action: PlayerAction): ActionResult {
    const object = this.localVisibleObject(action);
    if (!object) return this.reject(action, "interact_target_unavailable");
    const method = typeof action.parameters?.method === "string" ? action.parameters.method : "use";
    if (object.kind === "door" && (method === "open" || method === "close")) {
      const current = object.state?.open;
      if (method === "open" && object.state?.locked === true) return this.reject(action, "object_locked");
      if (method === "open" && current === true) return this.reject(action, "object_already_open");
      if (method === "close" && current !== true) return this.reject(action, "object_already_closed");
      object.state = { ...object.state, open: method === "open" };
    }
    const actor = this.state.characters[action.actorId];
    return this.finish(action.id, [this.append("object_interacted", {
      characterId: action.actorId, objectId: object.id, objectKind: object.kind, method,
      state: structuredClone(object.state ?? {}),
    }, action, undefined, this.visibleAt(actor.locationId))]);
  }

  private localVisibleObject(action: PlayerAction) {
    const targetId = typeof action.parameters?.targetId === "string" ? action.parameters.targetId : action.targetIds?.[0];
    const object = targetId ? this.state.objects?.[targetId] : undefined;
    const actor = this.state.characters[action.actorId];
    return object && actor && object.visible && object.locationId === actor.locationId ? object : undefined;
  }

  private resolveAgentAction(
    action: PlayerAction,
    agentAction: AgentAction,
    priorEvents: GameEvent[] = [],
    playerPrivateNote?: PlayerPrivateNote,
    resultActionId = action.id,
  ): ActionResult {
    const events: GameEvent[] = [...priorEvents];
    try {
      this.authority.assertAllowed({ kind: "agent", id: agentAction.actorId }, { kind: "agent_action", actorId: agentAction.actorId });
    } catch {
      return this.reject(action, "agent_action_unauthorized", events, resultActionId);
    }
    for (const request of agentAction.requests) {
      if (request.actorId !== agentAction.actorId) return this.reject(action, "agent_cannot_move_other_character", events, resultActionId);
      if (!this.canMove(request.actorId, request.destination)) return this.reject(action, "destination_unreachable", events, resultActionId);
    }
    if (agentAction.utterance) {
      const locationId = this.state.characters[agentAction.actorId]?.locationId;
      events.push(this.append("character_spoke", {
        characterId: agentAction.actorId, targetId: action.actorId, text: agentAction.utterance,
        ...(locationId ? { locationId } : {}),
      }, action, agentAction, this.visibleAt(locationId)));
    }
    for (const request of agentAction.requests) {
      const event = this.createMoveEvent(action, request.actorId, request.destination, agentAction);
      if (!event) throw new Error("validated movement became unavailable before commit");
      events.push(event);
    }
    return this.finish(resultActionId, events, playerPrivateNote);
  }

  private createMoveEvent(action: PlayerAction, actorId: string, destination: string, agentAction?: AgentAction): GameEvent | undefined {
    const actor = this.state.characters[actorId];
    const current = this.state.locations[actor.locationId];
    if (!current?.exits.includes(destination) || !this.state.locations[destination]) return undefined;
    const from = actor.locationId;
    const witnesses = this.visibleAt(from);
    actor.locationId = destination;
    return this.append("character_moved", { characterId: actorId, from, to: destination }, action, agentAction, [...witnesses, ...this.visibleAt(destination)]);
  }

  private canMove(actorId: string, destination: string): boolean {
    const actor = this.state.characters[actorId];
    return actor !== undefined && this.state.locations[actor.locationId]?.exits.includes(destination) === true && this.state.locations[destination] !== undefined;
  }

  private reject(action: PlayerAction, reason: string, priorEvents: GameEvent[] = [], resultActionId = action.id): ActionResult {
    return this.finish(resultActionId, [...priorEvents, this.append("action_rejected", { reason }, action, undefined, [action.actorId])]);
  }

  private append(type: GameEvent["type"], payload: Record<string, unknown>, causation: GameEvent["causation"] | PlayerAction, agentAction?: AgentAction, recipients: string[] = []): GameEvent {
    this.state.revision += 1;
    const baseCausation = "actorId" in causation ? { playerActionId: causation.id } : causation;
    const event: GameEvent = { id: randomUUID(), sessionId: this.state.sessionId, createdAt: new Date().toISOString(), sequence: ++this.nextSequence, type, payload,
      causation: {
        ...baseCausation,
        ...(agentAction?.id ? { agentActionId: agentAction.id } : {}),
      }, stateRevision: this.state.revision, moment: structuredClone(this.currentMoment()) };
    this.events.push(event);
    this.recipientsByEventId.set(event.id, recipients);
    return event;
  }

  private visibleAt(locationId: string | undefined): string[] {
    if (!locationId) return [];
    return Object.values(this.state.characters).filter((character) => character.locationId === locationId).map((character) => character.id);
  }

  private currentMoment(): GameMoment {
    return this.state.moment!;
  }

  private advanceGameTime(): void {
    const current = this.currentMoment();
    if (current.tick === Number.MAX_SAFE_INTEGER) throw new Error("game_tick_overflow");
    this.state.moment = { ...current, tick: current.tick + 1 };
  }

  private finish(actionId: string, events: GameEvent[], playerPrivateNote?: PlayerPrivateNote, commitEffects?: readonly (() => void)[]): ActionResult {
    const result = { actionId, events, stateRevision: this.state.revision };
    const requestFingerprint = this.idempotency.activeFingerprint(actionId);
    if (!requestFingerprint) throw new Error("missing_action_fingerprint");
    this.transaction.commit({
      commit: () => this.committer?.commit({ actionId, requestFingerprint, sessionId: this.state.sessionId, stateRevision: result.stateRevision, worldState: structuredClone(this.state), events, recipientsByEventId: this.recipientsByEventId, playerPrivateNote, commitEffects }),
      publish: () => {
        this.worldStatePublisher?.publishCommittedState(this.state);
        this.idempotency.remember(actionId, requestFingerprint, result);
        for (const event of events) {
          const recipients = this.recipientsByEventId.get(event.id) ?? [];
          for (const listener of this.listeners) listener(event, recipients);
        }
      },
    });
    return result;
  }
}

function requestFingerprint(request: object): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(request))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, canonicalize(child)]));
}

function defaultGameMoment(sessionId: string): GameMoment {
  return { timelineId: `session:${sessionId}`, tick: 0 };
}

function normalizeGameMoment(sessionId: string, moment: GameMoment | undefined): GameMoment {
  if (!moment) return defaultGameMoment(sessionId);
  if (!moment.timelineId.trim() || !Number.isSafeInteger(moment.tick) || moment.tick < 0) throw new Error("invalid_game_moment");
  if (moment.calendar && Object.values(moment.calendar).some((value) => !["string", "number", "boolean"].includes(typeof value))) {
    throw new Error("invalid_game_calendar");
  }
  return structuredClone(moment);
}
