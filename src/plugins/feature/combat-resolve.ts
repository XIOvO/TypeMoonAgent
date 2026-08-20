import type { ActionResult } from "../../core/contracts.js";
import type { CommandEnvelope } from "../../protocol/command.js";

/** Stable controller contract supplied by every combat.resolve provider. */
export interface CombatResolveController {
  execute(command: CommandEnvelope): Promise<ActionResult>;
}
