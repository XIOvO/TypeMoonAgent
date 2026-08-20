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
import { ServantProfileAccessPolicy } from "../cif/servant-profile-access.js";
import { CifInitializationPublisher } from "../cif/publisher.js";
import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import { GameRuntime } from "../core/runtime.js";
import { PiMemoryConsolidationGenerator } from "../agents/pi-memory-consolidation-generator.js";
import { PiPatternConsolidationGenerator } from "../agents/pi-pattern-consolidation-generator.js";
import { PiPatternAuditor } from "../agents/pi-pattern-auditor.js";
import { CifPatternPublisher } from "../cif/pattern-publisher.js";
import { BranchWorldlineProjector } from "../story/branch-projector.js";
import { StaticStoryChapterCatalog, StoryChapterPackageService } from "../story/chapter-packages.js";
import { ChapterAssessmentScheduler, ChapterAssessmentWorker } from "../story/chapter-assessment.js";
import { PiChapterAssessmentGenerator } from "../agents/pi-chapter-assessment-generator.js";
import { bootstrap } from "../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../platform/cordis-platform.js";
import { createSqliteDurableJobsPlugin, EventTaskRegistry, SqliteDurableJobQueue, type EventTaskRegistry as EventTasksCapability, WORLD_EVENT_TASKS_CAPABILITY } from "../plugins/system/durable-jobs.js";
import { createRuntimeCommandAuthoritySystem, WORLD_COMMAND_GATEWAY_CAPABILITY } from "../plugins/system/command-authority.js";
import type { CommandGateway } from "../core/command-gateway.js";
import { WorldStateStore } from "../core/world-state.js";
import { createWorldStatePlugin } from "../plugins/system/world-state.js";
import { createSqlitePersistenceSystem } from "../plugins/system/persistence.js";
import { StateBackedWorldMap } from "../core/world-map.js";
import { exitGraphNavigation } from "../core/navigation.js";
import { createWorldMapPlugin } from "../plugins/system/world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "../plugins/system/world-navigation.js";
import { createWorldSimulationPlugin } from "../plugins/feature/world-simulation.js";
import { createStoryChaptersPlugin, WORLD_STORY_CHAPTERS_CAPABILITY, type StoryChapterController } from "../plugins/feature/story-chapters.js";
import { createStorySummonPlugin } from "../plugins/feature/story-summon.js";
import { createStoryAppearancePlugin } from "../plugins/feature/story-appearance.js";
import { createSimpleCombatPlugin } from "../plugins/feature/simple-combat.js";
import { SimpleCombatActionHandler } from "../plugins/feature/simple-combat-rules.js";
import { createPlayerNavigationPlugin } from "../plugins/feature/player-navigation.js";
import { chaldeaOpeningAvailability } from "../story/availability.js";
import { createMemoryConsolidationPlugin } from "../plugins/feature/memory-consolidation.js";
import { createCifPatternsPlugin } from "../plugins/feature/cif-patterns.js";
import { createCifPublicationPlugin } from "../plugins/feature/cif-publication.js";
import { createMemoryEvolutionPolicyPlugin } from "../plugins/feature/memory-evolution-policy.js";
import { createSceneLifecyclePlugin } from "../plugins/feature/scene-lifecycle.js";
import { createInteractionCoordinatorPlugin, DurableInteractionCommandHandler } from "../plugins/feature/interaction-coordinator.js";

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
const worldStateStore = new WorldStateStore(state);
const worldMap = new StateBackedWorldMap(worldStateStore);
const worldNavigation = new CommittedWorldNavigation(worldStateStore, exitGraphNavigation);
const eventTaskRegistry = new EventTaskRegistry();
const worldJobs = new SqliteDurableJobQueue(repository);
const chapters = new StoryChapterPackageService(repository);
// Production chapters enter this catalog only after their source fragment IDs resolve in lore.sqlite.
const chapterCatalog = new StaticStoryChapterCatalog([]);
const worldline = new BranchWorldlineProjector(repository, chapters);
const chapterAssessmentScheduler = new ChapterAssessmentScheduler(repository);
if (!repository.getStoryContext(state.sessionId)) worldline.initialize({
  sessionId: state.sessionId, playerId: "player", canonAnchor: "fgo:chaldea:arrival",
  checkpointRevision: state.revision, updatedAt: new Date().toISOString(),
});
const persistence = createSqlitePersistenceSystem(repository, { eventTasks: eventTaskRegistry, worldline });
const contextBuilder = new CharacterContextBuilder(repository);
const patternPublisher = new CifPatternPublisher(repository);
const lore = new SqliteLoreRepository(process.env.LORE_DB_PATH ?? "lore.sqlite");
const mashAgent = createMashAgent(contextBuilder);
const interactionHandler = new DurableInteractionCommandHandler(repository, repository);
const combatHandler = new SimpleCombatActionHandler();
const runtime = new GameRuntime(
  state, { mash: mashAgent }, persistence.turnCommitter,
  undefined,
  repository.nextObjectiveSequence("demo") - 1,
  chapters,
  worldStateStore,
  worldNavigation,
  interactionHandler,
  combatHandler,
);
const commandAuthority = createRuntimeCommandAuthoritySystem(runtime);
const storyChaptersPlugin = createStoryChaptersPlugin(chapters, chapterCatalog, commandAuthority.gateway);
const storySummonPlugin = createStorySummonPlugin({
  sessionId: state.sessionId,
  jobs: worldJobs,
  chapters: repository,
  catalog: chapterCatalog,
  commands: commandAuthority.gateway,
  eventTasks: eventTaskRegistry,
});
const storyAppearancePlugin = createStoryAppearancePlugin({ availability: chaldeaOpeningAvailability, publication: repository, factors: repository, commands: commandAuthority.gateway });
const simpleCombatPlugin = createSimpleCombatPlugin(commandAuthority.gateway);
const playerNavigationPlugin = createPlayerNavigationPlugin(commandAuthority.gateway);
const memoryConsolidationPlugin = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? createMemoryConsolidationPlugin({
    sessionId: state.sessionId, jobs: worldJobs, store: repository,
    generator: new PiMemoryConsolidationGenerator({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY }),
    commands: commandAuthority.gateway,
  })
  : undefined;
const cifPatternsPlugin = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? createCifPatternsPlugin({
    sessionId: state.sessionId, jobs: worldJobs, store: repository,
    generator: new PiPatternConsolidationGenerator({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY }),
    auditor: new PiPatternAuditor({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY }),
    publisher: patternPublisher,
    commands: commandAuthority.gateway,
  })
  : undefined;
const cifPublicationPlugin = createCifPublicationPlugin(repository, patternPublisher);
const memoryEvolutionPolicyPlugin = cifPatternsPlugin
  ? createMemoryEvolutionPolicyPlugin({ sessionId: state.sessionId, jobs: worldJobs, store: repository, commands: commandAuthority.gateway, characterIds: () => Object.keys(commandAuthority.gateway.getState().characters) })
  : undefined;
const sceneLifecyclePlugin = createSceneLifecyclePlugin({ sessionId: state.sessionId, playerId: "player", jobs: worldJobs, store: repository, commands: commandAuthority.gateway, eventTasks: eventTaskRegistry });
const interactionCoordinatorPlugin = createInteractionCoordinatorPlugin({ sessionId: state.sessionId, playerId: "player", jobs: worldJobs, world: worldStateStore, states: repository, store: repository, handler: interactionHandler, commands: commandAuthority.gateway, eventTasks: eventTaskRegistry });
const worldSimulationPlugin = createWorldSimulationPlugin({
  sessionId: state.sessionId,
  playerId: "player",
  jobs: worldJobs,
  history: persistence.history,
  states: repository,
  commands: commandAuthority.gateway,
  navigation: worldNavigation,
  eventTasks: eventTaskRegistry,
});
const platform = await bootstrap(new CordisPlatformAdapter(), {
  profileId: "default-story",
  plugins: [
    { plugin: createSqliteDurableJobsPlugin(repository, eventTaskRegistry, worldJobs) },
    { plugin: persistence.plugin },
    { plugin: createWorldStatePlugin(worldStateStore) },
    { plugin: createWorldMapPlugin(worldMap) },
    { plugin: createWorldNavigationPlugin(worldNavigation) },
    { plugin: commandAuthority.plugin },
    { plugin: sceneLifecyclePlugin },
    { plugin: interactionCoordinatorPlugin },
    { plugin: storyChaptersPlugin },
    { plugin: storySummonPlugin },
    { plugin: storyAppearancePlugin },
    { plugin: simpleCombatPlugin },
    { plugin: playerNavigationPlugin },
    { plugin: worldSimulationPlugin },
    ...(memoryConsolidationPlugin ? [{ plugin: memoryConsolidationPlugin }] : []),
    ...(cifPatternsPlugin ? [{ plugin: cifPatternsPlugin }] : []),
    ...(memoryEvolutionPolicyPlugin ? [{ plugin: memoryEvolutionPolicyPlugin }] : []),
    { plugin: cifPublicationPlugin },
  ],
});
const eventTasks = platform.get<EventTasksCapability>(WORLD_EVENT_TASKS_CAPABILITY);
const commandGateway = platform.get<CommandGateway>(WORLD_COMMAND_GATEWAY_CAPABILITY);
const storyChapters = platform.get<StoryChapterController>(WORLD_STORY_CHAPTERS_CAPABILITY);
eventTasks.register(chapterAssessmentScheduler);
const initializer = new CifInitializer(lore, new ServantProfileAccessPolicy(lore, repository));
const publisher = new CifInitializationPublisher(repository);
const draftService = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? new CifDraftService(repository, new PiCifDraftGenerator({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY }), "pi-cif-initializer", publisher)
  : undefined;
const playerInputInterpreter = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? new PiPlayerInputInterpreter({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY })
  : undefined;
const chapterAssessmentWorker = process.env.PI_PROVIDER && process.env.PI_MODEL
  ? new ChapterAssessmentWorker(repository, new PiChapterAssessmentGenerator({ provider: process.env.PI_PROVIDER, modelId: process.env.PI_MODEL, apiKey: process.env.PI_API_KEY }), lore)
  : undefined;
const wakeChapterAssessmentWorker = (sessionId: string) => {
  if (!chapterAssessmentWorker) return;
  void chapterAssessmentWorker.processNext(sessionId).catch((error: unknown) => console.error("chapter assessment failed", error));
};
commandGateway.subscribe((event) => { wakeChapterAssessmentWorker(event.sessionId); });
if (chapterAssessmentWorker) {
  wakeChapterAssessmentWorker(state.sessionId);
  setInterval(() => { wakeChapterAssessmentWorker(state.sessionId); }, 30_000).unref();
}
const server = createGameApiServer(commandGateway, { repository, initializer, publisher, draftService }, playerInputInterpreter, { chapters: storyChapters });
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
