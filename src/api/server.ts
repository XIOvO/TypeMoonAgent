import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { PlayerAction, RawPlayerInput } from "../core/contracts.js";
import { DeterministicPlayerInputInterpreter, type PlayerInputInterpreter } from "../core/player-input.js";
import { GameRuntime } from "../core/runtime.js";
import { buildPlayerVisibleState } from "./projection.js";
import { CifDraftService } from "../cif/draft-service.js";
import { CifInitializer, type CharacterIntroductionRequest } from "../cif/initializer.js";
import { CifInitializationPublisher } from "../cif/publisher.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { DeterministicNarrativeRenderer } from "../narrative/renderer.js";

export interface CifAdminDependencies {
  repository: SqliteCifRepository;
  initializer: CifInitializer;
  publisher: CifInitializationPublisher;
  draftService?: CifDraftService;
}

export function createGameApiServer(runtime: GameRuntime, cifAdmin?: CifAdminDependencies, playerInputInterpreter: PlayerInputInterpreter = new DeterministicPlayerInputInterpreter()): Server {
  const narrativeRenderer = new DeterministicNarrativeRenderer();
  return createServer(async (request, response) => {
    try {
      const requestUrl = request.url ? new URL(request.url, "http://localhost") : undefined;
      if (request.method === "GET" && requestUrl && await serveStatic(requestUrl.pathname, response)) return;
      const cifMatch = requestUrl?.pathname.match(/^\/sessions\/([^/]+)\/cif\/(brief|drafts)(?:\/([^/]+)\/(approve))?$/);
      if (cifMatch && requestUrl) return handleCifRequest(request, response, cifMatch, runtime, cifAdmin);
      const match = requestUrl?.pathname.match(/^\/sessions\/([^/]+)\/(state|actions|events)$/);
      if (!match || !requestUrl) return send(response, 404, { error: "not_found" });
      const [, sessionId, resource] = match;
      if (sessionId !== runtime.getState().sessionId) return send(response, 404, { error: "unknown_session" });
      if (request.method === "GET" && resource === "state") {
        const playerId = requestUrl.searchParams.get("playerId");
        if (!playerId) return send(response, 400, { error: "playerId_required" });
        return send(response, 200, buildPlayerVisibleState(runtime.getState(), playerId));
      }
      if (request.method === "GET" && resource === "events") {
        const playerId = requestUrl.searchParams.get("playerId");
        if (!playerId) return send(response, 400, { error: "playerId_required" });
        if (!runtime.getState().characters[playerId]) return send(response, 404, { error: "unknown_player" });
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        response.write("event: ready\ndata: {}\n\n");
        const unsubscribe = runtime.subscribe((event, recipients) => {
          if (!recipients.includes(playerId)) return;
          response.write(`event: game_event\ndata: ${JSON.stringify(event)}\n\n`);
          response.write(`event: narrative_beat\ndata: ${JSON.stringify(narrativeRenderer.render(event))}\n\n`);
        });
        request.on("close", unsubscribe);
        return;
      }
      if (request.method === "POST" && resource === "actions") {
        const raw = await readJson<Partial<PlayerAction & RawPlayerInput>>(request);
        if (isAutoRawInput(raw)) {
          if (raw.sessionId !== sessionId) return send(response, 400, { error: "session_mismatch" });
          try {
            return send(response, 200, await runtime.handleRawPlayerInput(raw));
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "combined_turn_runner_unavailable") throw error;
          }
        }
        const parsed = await parsePlayerInput(raw, playerInputInterpreter);
        if (parsed.kind === "needs_interpreter") return send(response, 422, { error: parsed.reason });
        if (parsed.action.sessionId !== sessionId) return send(response, 400, { error: "session_mismatch" });
        return send(response, 200, await runtime.handlePlayerAction(parsed.action));
      }
      return send(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      return send(response, 400, { error: error instanceof Error ? error.message : "invalid_request" });
    }
  });
}

async function handleCifRequest(request: IncomingMessage, response: ServerResponse, match: RegExpMatchArray, runtime: GameRuntime, admin?: CifAdminDependencies): Promise<void> {
  if (!admin) return send(response, 503, { error: "cif_admin_unavailable" });
  const [, sessionId, resource, draftId, operation] = match;
  if (sessionId !== runtime.getState().sessionId) return send(response, 404, { error: "unknown_session" });
  if (request.method === "GET" && resource === "drafts" && !draftId) {
    const url = new URL(request.url ?? "", "http://localhost");
    const characterId = url.searchParams.get("characterId");
    if (!characterId) return send(response, 400, { error: "characterId_required" });
    return send(response, 200, admin.repository.listInitializationDrafts(sessionId, characterId));
  }
  if (request.method === "POST" && resource === "brief") {
    const introduction = await readJson<CharacterIntroductionRequest>(request);
    if (introduction.sessionId !== sessionId) return send(response, 400, { error: "session_mismatch" });
    return send(response, 200, admin.initializer.buildBrief(introduction));
  }
  if (request.method === "POST" && resource === "drafts" && !draftId) {
    if (!admin.draftService) return send(response, 503, { error: "cif_draft_model_not_configured" });
    const introduction = await readJson<CharacterIntroductionRequest>(request);
    if (introduction.sessionId !== sessionId) return send(response, 400, { error: "session_mismatch" });
    return send(response, 201, await admin.draftService.create(admin.initializer.buildBrief(introduction)));
  }
  if (request.method === "POST" && resource === "drafts" && draftId && operation === "approve") {
    const draft = admin.repository.getInitializationDraft(draftId);
    if (!draft || draft.brief.request.sessionId !== sessionId) return send(response, 404, { error: "unknown_draft" });
    if (draft.status !== "draft") return send(response, 409, { error: "draft_not_pending_review" });
    admin.repository.setInitializationDraftStatus(draftId, "approved", new Date().toISOString());
    const approved = admin.repository.getInitializationDraft(draftId);
    if (!approved) throw new Error("draft_disappeared_before_publish");
    admin.publisher.publish(approved);
    return send(response, 200, admin.repository.getInitializationDraft(draftId));
  }
  return send(response, 405, { error: "method_not_allowed" });
}

const staticFiles: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", contentType: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
  "/expression-lab": { file: "expression-lab.html", contentType: "text/html; charset=utf-8" },
  "/expression-lab.css": { file: "expression-lab.css", contentType: "text/css; charset=utf-8" },
  "/expression-lab.js": { file: "expression-lab.js", contentType: "text/javascript; charset=utf-8" },
  "/assets/mash-expression-sheet.png": { file: "../98001000_merged.png", contentType: "image/png" },
};

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const asset = staticFiles[pathname];
  if (!asset) return false;
  const content = await readFile(new URL(`../../public/${asset.file}`, import.meta.url));
  response.writeHead(200, { "content-type": asset.contentType, "cache-control": "no-cache" });
  response.end(content);
  return true;
}

function isAutoRawInput(value: Partial<PlayerAction & RawPlayerInput>): value is RawPlayerInput {
  return typeof value.id === "string" && typeof value.sessionId === "string" && typeof value.actorId === "string" && typeof value.content === "string" && value.mode === "auto";
}

async function parsePlayerInput(value: Partial<PlayerAction & RawPlayerInput>, interpreter: PlayerInputInterpreter): Promise<import("../core/contracts.js").ParsedPlayerIntent> {
  if (typeof value.id !== "string" || typeof value.sessionId !== "string" || typeof value.actorId !== "string" || (value.type !== "dialogue" && value.type !== "action" && value.type !== "combat")) {
    if (typeof value.id !== "string" || typeof value.sessionId !== "string" || typeof value.actorId !== "string" || typeof value.content !== "string" || (value.mode !== "dialogue" && value.mode !== "action" && value.mode !== "combat" && value.mode !== "auto")) {
      throw new Error("invalid_player_input");
    }
    return interpreter.interpret(value as RawPlayerInput);
  }
  return { kind: "resolved", action: value as PlayerAction };
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 64_000) throw new Error("request_too_large");
  }
  return JSON.parse(body) as T;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
