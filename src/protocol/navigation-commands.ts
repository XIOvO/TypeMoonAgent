import type { CapabilityDefinition } from "./capability.js";
import type { CommandEnvelope } from "./command.js";
import type { CapabilityId } from "./ids.js";

export const NAVIGATION_MOVE_CAPABILITY = "navigation.move";

export interface NavigationMoveCommandPayload {
  destination: string;
}

export type NavigationMoveCommand = CommandEnvelope<NavigationMoveCommandPayload> & { type: typeof NAVIGATION_MOVE_CAPABILITY; actorId: string };

export const NAVIGATION_MOVE_COMMAND_SCHEMA = {
  type: "object",
  required: ["destination"],
  additionalProperties: false,
  properties: { destination: { type: "string", minLength: 1 } },
} as const;

export const NAVIGATION_MOVE_CAPABILITY_DEFINITION: CapabilityDefinition = {
  id: NAVIGATION_MOVE_CAPABILITY as CapabilityId,
  version: "1.0.0",
  scope: "public",
  description: "Move one player through a legal adjacent exit.",
  inputSchema: NAVIGATION_MOVE_COMMAND_SCHEMA,
};

export function isNavigationMoveCommand(command: CommandEnvelope): command is NavigationMoveCommand {
  return command.type === NAVIGATION_MOVE_CAPABILITY && typeof command.actorId === "string" && command.actorId.trim().length > 0 &&
    !!command.payload && typeof command.payload === "object" && !Array.isArray(command.payload) &&
    Object.keys(command.payload).length === 1 && typeof (command.payload as Record<string, unknown>).destination === "string" &&
    ((command.payload as Record<string, unknown>).destination as string).trim().length > 0;
}
