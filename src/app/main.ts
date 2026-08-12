import type { AgentRunner } from "../core/agent-runner.js";
import { createGameApiServer } from "../api/server.js";
import type { AgentAction, GameState, Observation } from "../core/contracts.js";
import { CharacterContextBuilder } from "../cif/context-builder.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { PiAgentRunner } from "../agents/pi-agent-runner.js";
import { PiPlayerInputInterpreter } from "../agents/pi-player-input-interpreter.js";
import { PiCifDraftGenerator } from "../agents/pi-cif-draft-generator.js";
import { CifDraftService } from "../cif/draft-service.js";
import { CifInitializer } from "../cif/initializer.js";
import { CifInitializationPublisher } from "../cif/publisher.js";
import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import { GameRuntime } from "../core/runtime.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";

class DemoMashAgent implements AgentRunner {
  public async run(observation: Observation): Promise<AgentAction> {
    return {
      id: crypto.randomUUID(), sessionId: observation.sessionId, actorId: observation.recipientId,
      observationId: observation.id, utterance: "好的，前辈。我在听。", requests: [],
    };
  }
}

const repository = new SqliteCifRepository(process.env.GAME_DB_PATH ?? "game.sqlite");
const state = repository.loadWorldState("demo") ?? initialState();
const contextBuilder = new CharacterContextBuilder(repository);
const lore = new SqliteLoreRepository(process.env.LORE_DB_PATH ?? "lore.sqlite");
const mashAgent = createMashAgent(contextBuilder);
const runtime = new GameRuntime(
  state, { mash: mashAgent }, new SqliteTurnCommitter(repository),
  { hasPublishedInitialization: (sessionId, characterId) => repository.hasPublishedInitialization(sessionId, characterId) },
  repository.nextObjectiveSequence("demo") - 1,
);
const initializer = new CifInitializer(lore);
const publisher = new CifInitializationPublisher(repository);
const draftService = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? new CifDraftService(repository, new PiCifDraftGenerator({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY }), "pi-cif-initializer")
  : undefined;
const playerInputInterpreter = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? new PiPlayerInputInterpreter({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY })
  : undefined;
const server = createGameApiServer(runtime, { repository, initializer, publisher, draftService }, playerInputInterpreter);
const port = Number(process.env.PORT ?? 3000);

server.listen(port, "127.0.0.1", () => {
  const mode = process.env.PI_PROVIDER && process.env.PI_MODEL ? "Pi Agent" : "演示角色（配置 PI_PROVIDER 与 PI_MODEL 后启用 Pi）";
  console.log(`Agent Game 正在 http://127.0.0.1:${port} 运行；${mode}`);
});

function createMashAgent(builder: CharacterContextBuilder): AgentRunner {
  const provider = process.env.PI_PROVIDER;
  const modelId = process.env.PI_MODEL;
  if (!provider || !modelId) return new DemoMashAgent();
  return new PiAgentRunner({ provider, modelId, apiKey: process.env.PI_API_KEY }, builder);
}

function initialState(): GameState {
  return {
    sessionId: "demo", revision: 0,
    characters: {
      player: { id: "player", locationId: "chaldea_hall", mood: "calm" },
      mash: { id: "mash", locationId: "chaldea_hall", mood: "calm" },
    },
    locations: {
      chaldea_hall: { id: "chaldea_hall", exits: ["cafeteria"] },
      cafeteria: { id: "cafeteria", exits: ["chaldea_hall"] },
    },
    objects: {
      chaldea_hall_notice: { id: "chaldea_hall_notice", kind: "document", locationId: "chaldea_hall", visible: true, tags: ["notice", "chaldea"], inspectText: "A Chaldea duty notice is pinned to the wall." },
      cafeteria_door: { id: "cafeteria_door", kind: "door", locationId: "chaldea_hall", visible: true, tags: ["door"], inspectText: "The cafeteria door is closed but unlocked.", state: { open: false, locked: false } },
    },
  };
}
