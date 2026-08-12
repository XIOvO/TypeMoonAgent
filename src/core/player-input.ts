import type { ParsedPlayerIntent, PlayerAction, RawPlayerInput } from "./contracts.js";

/**
 * A replaceable boundary for interpreting freeform player input. A future Pi
 * adapter may implement this interface; Runtime still receives only a bounded
 * PlayerAction and remains the sole world authority.
 */
export interface PlayerInputInterpreter {
  interpret(input: RawPlayerInput): Promise<ParsedPlayerIntent>;
}

/** Zero-cost path for UI controls that already identify the input lane. */
export class DeterministicPlayerInputInterpreter implements PlayerInputInterpreter {
  public async interpret(input: RawPlayerInput): Promise<ParsedPlayerIntent> {
    if (input.mode === "auto") return { kind: "needs_interpreter", reason: "ambiguous_freeform_input" };
    const action: PlayerAction = {
      id: input.id, sessionId: input.sessionId, actorId: input.actorId, type: input.mode,
      content: input.content, targetIds: input.targetIds, parameters: input.parameters,
    };
    return { kind: "resolved", action };
  }
}
