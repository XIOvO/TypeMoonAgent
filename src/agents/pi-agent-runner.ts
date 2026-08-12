import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentRunner } from "../core/agent-runner.js";
import type { AgentAction, BattleDirective, CombinedTurnProposal, Observation, RawPlayerInput } from "../core/contracts.js";
import { CharacterContextBuilder } from "../cif/context-builder.js";
import { buildCifPiPrompt } from "../cif/pi-prompt.js";

/**
 * Pi SDK adapter. The only tools exposed to a game character are explicitly
 * registered below; Pi's file and shell tools are intentionally not enabled.
 */
export class PiAgentRunner implements AgentRunner {
  public constructor(
    private readonly options: { provider: string; modelId: string; apiKey?: string },
    private readonly contextBuilder: CharacterContextBuilder,
  ) {}

  public async run(observation: Observation): Promise<AgentAction> {
    let submitted: AgentAction | undefined;
    const submitGameAction = defineTool({
      name: "submit_game_action",
      label: "Submit game action",
      description: "Submit the character's spoken response and requested game actions. This is the only way to request a world change.",
      parameters: Type.Object({
        utterance: Type.Optional(Type.String()),
        moves: Type.Array(Type.Object({ destination: Type.String() })),
      }),
      execute: async (_toolCallId, parameters) => {
        submitted = {
          id: crypto.randomUUID(), sessionId: observation.sessionId, actorId: observation.recipientId,
          observationId: observation.id, utterance: parameters.utterance,
          requests: parameters.moves.map((move) => ({ type: "move", actorId: observation.recipientId, destination: move.destination })),
        };
        return { content: [{ type: "text", text: "Action submitted to Game Runtime for validation." }], details: {} };
      },
    });

    const modelRuntime = await ModelRuntime.create();
    if (this.options.apiKey) await modelRuntime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    const model = modelRuntime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(), agentDir: `${process.cwd()}/.pi`, settingsManager,
      systemPromptOverride: () => [
        "You are a game character operating under the Character Identity Framework (CIF).",
        "Observation contains current scene facts. CIF context contains your subjective evidence, beliefs, identity, and internal state; it is not omniscient truth.",
        "Privately evaluate the situation, form emotions and candidate goals, use practical judgment, then apply an expression filter before responding.",
        "Never invent hidden facts or claim an action succeeded. Use submit_game_action exactly once; put dialogue in utterance and only request a move when appropriate.",
      ].join("\n"),
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: process.cwd(), model, modelRuntime, thinkingLevel: "low",
      noTools: "builtin", tools: ["submit_game_action"], customTools: [submitGameAction],
      resourceLoader: loader, sessionManager: SessionManager.inMemory(), settingsManager,
    });
    const characterContext = this.contextBuilder.build(observation.sessionId, observation.recipientId);
    await session.prompt(buildCifPiPrompt(observation, characterContext));
    if (!submitted) throw new Error("Pi Agent finished without calling submit_game_action");
    return submitted;
  }

  public async runCombined(observation: Observation, input: RawPlayerInput): Promise<CombinedTurnProposal> {
    let submitted: CombinedTurnProposal | undefined;
    const submit = defineTool({
      name: "submit_turn_proposal", label: "Submit combined turn proposal",
      description: "Submit one candidate player interpretation and one character response. Runtime will validate all world changes.",
      parameters: Type.Object({
        player: Type.Object({
          type: Type.Union([Type.Literal("dialogue"), Type.Literal("action"), Type.Literal("combat")]),
          publicText: Type.Optional(Type.String()), targetIds: Type.Array(Type.String()),
          intent: Type.Optional(Type.String()), destination: Type.Optional(Type.String()), approach: Type.Optional(Type.String()),
          privateThought: Type.Optional(Type.String()),
        }),
        battle: Type.Optional(Type.Object({
          participation: Type.Union([Type.Literal("command"), Type.Literal("delegate"), Type.Literal("quick_resolve")]),
          commands: Type.Optional(Type.Array(Type.Object({
            actorId: Type.Optional(Type.String()),
            intent: Type.Union([Type.Literal("attack"), Type.Literal("defend"), Type.Literal("skill"), Type.Literal("item"), Type.Literal("retreat"), Type.Literal("analyze")]),
            targetId: Type.Optional(Type.String()),
          }))),
          delegateTo: Type.Optional(Type.Array(Type.String())),
        })),
        character: Type.Object({ utterance: Type.Optional(Type.String()), moves: Type.Array(Type.Object({ destination: Type.String() })) }),
      }),
      execute: async (_toolCallId, parameters) => {
        const candidate = parameters as {
          player: { type: "dialogue" | "action" | "combat"; publicText?: string; targetIds: string[]; intent?: string; destination?: string; approach?: string; privateThought?: string };
          battle?: BattleDirective;
          character: { utterance?: string; moves: Array<{ destination: string }> };
        };
        submitted = {
          player: {
            type: candidate.player.type, publicText: candidate.player.publicText, targetIds: candidate.player.targetIds,
            parameters: compact({ intent: candidate.player.intent, destination: candidate.player.destination, approach: candidate.player.approach }),
            privateThought: candidate.player.privateThought,
          },
          battle: candidate.battle,
          character: {
            id: crypto.randomUUID(), sessionId: observation.sessionId, actorId: observation.recipientId, observationId: observation.id,
            utterance: candidate.character.utterance,
            requests: candidate.character.moves.map((move) => ({ type: "move", actorId: observation.recipientId, destination: move.destination })),
          },
        };
        return { content: [{ type: "text", text: "Combined proposal submitted for Runtime validation." }], details: {} };
      },
    });
    const { session } = await this.createSession([submit], ["submit_turn_proposal"], [
      "You are a game character operating under the Character Identity Framework (CIF).",
      "Interpret the player's raw input into public speech, attempted action, and optional private thought.",
      "Private thought must never affect the character response: respond only to public speech and observable action attempts.",
      "When observation.incomingAction.type is combat, choose battle.participation: command for concrete orders, delegate for letting companions act, quick_resolve only for explicit requests such as 'quickly finish' or 'skip the battle'. Include battle commands or delegateTo when needed.",
      "Never invent action outcomes. Use submit_turn_proposal exactly once.",
    ]);
    const characterContext = this.contextBuilder.build(observation.sessionId, observation.recipientId);
    await session.prompt(JSON.stringify({ task: "Produce one combined turn proposal.", observation, rawPlayerInput: input.content, cifContext: characterContext }));
    if (!submitted) throw new Error("Pi Agent finished without calling submit_turn_proposal");
    return submitted;
  }

  private async createSession(customTools: ReturnType<typeof defineTool>[], tools: string[], systemPrompt: string[]) {
    const modelRuntime = await ModelRuntime.create();
    if (this.options.apiKey) await modelRuntime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    const model = modelRuntime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: `${process.cwd()}/.pi`, settingsManager, systemPromptOverride: () => systemPrompt.join("\n") });
    await loader.reload();
    return createAgentSession({ cwd: process.cwd(), model, modelRuntime, thinkingLevel: "low", noTools: "builtin", tools, customTools, resourceLoader: loader, sessionManager: SessionManager.inMemory(), settingsManager });
  }
}

function compact(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string>;
}
