import type { CommandGateway } from "../core/command-gateway.js";
import type { CharacterRuntimeStateStore } from "./world-tick.js";
import type { WorldSimulationExecutor, WorldSimulationInput } from "./world-tick.js";

/** Bridges a verified candidate to Runtime without granting a model world-write access. */
export class RuntimeWorldSimulationExecutor implements WorldSimulationExecutor {
  public constructor(private readonly commands: CommandGateway, private readonly states: CharacterRuntimeStateStore, private readonly playerId: string) {}

  public async execute(input: WorldSimulationInput): Promise<void> {
    if (input.reason === "approach_player") {
      if (!input.targetLocationId) throw new Error("player_approach_target_required");
      await this.commands.moveCharacterTowardPlayer({
        id: `world-approach:${input.jobId}`, sessionId: input.sessionId, playerId: this.playerId,
        characterId: input.actorId, expectedPlayerLocationId: input.targetLocationId, reason: input.reason,
      });
      return;
    }
    const result = await this.commands.runCharacterInitiative({
      id: `world-simulation:${input.jobId}`, sessionId: input.sessionId, playerId: this.playerId,
      characterId: input.actorId, reason: input.reason,
    });
    if (!result.events.some((event) => event.type === "character_spoke")) return;
    const state = this.states.getRuntimeState(input.sessionId, input.actorId);
    if (!state) return;
    this.states.saveRuntimeState({ ...state, lastProactiveInteractionTick: input.moment.tick, updatedAt: result.events[0]!.createdAt });
  }
}
