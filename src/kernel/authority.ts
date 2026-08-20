export type RuntimePrincipal =
  | { kind: "player"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "system"; id: string };

export type RuntimeRequest =
  | { kind: "player_action"; actorId: string }
  | { kind: "agent_action"; actorId: string }
  | { kind: "system_action" };

/** Validates who may propose a request; it never settles world state. */
export class RuntimeAuthority {
  public assertAllowed(principal: RuntimePrincipal, request: RuntimeRequest): void {
    if (principal.kind === "system" && request.kind === "system_action") return;
    if (principal.kind === "player" && request.kind === "player_action" && principal.id === request.actorId) return;
    if (principal.kind === "agent" && request.kind === "agent_action" && principal.id === request.actorId) return;
    throw new Error("runtime_authority_denied");
  }
}
