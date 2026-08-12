import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ParsedPlayerIntent, PlayerAction, RawPlayerInput } from "../core/contracts.js";
import type { PlayerInputInterpreter } from "../core/player-input.js";

type SubmittedIntent = {
  type: PlayerAction["type"];
  publicText?: string;
  targetIds: string[];
  intent?: string;
  destination?: string;
  approach?: string;
  privateThought?: string;
};

/**
 * A low-privilege Pi adapter for mixed player text. It has no Runtime, file,
 * shell, database, lore, or character tools: it can only submit a candidate.
 */
export class PiPlayerInputInterpreter implements PlayerInputInterpreter {
  public constructor(private readonly options: { provider: string; modelId: string; apiKey?: string }) {}

  public async interpret(input: RawPlayerInput): Promise<ParsedPlayerIntent> {
    let submitted: SubmittedIntent | undefined;
    const submit = defineTool({
      name: "submit_player_intent",
      label: "Submit player intent",
      description: "Submit one bounded interpretation candidate. This does not change the game world.",
      parameters: Type.Object({
        type: Type.Union([Type.Literal("dialogue"), Type.Literal("action"), Type.Literal("combat")]),
        publicText: Type.Optional(Type.String()), targetIds: Type.Array(Type.String()),
        intent: Type.Optional(Type.String()), destination: Type.Optional(Type.String()), approach: Type.Optional(Type.String()),
        privateThought: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, parameters) => {
        submitted = parameters as SubmittedIntent;
        return { content: [{ type: "text", text: "Interpretation candidate received for Runtime validation." }], details: {} };
      },
    });
    const runtime = await ModelRuntime.create();
    if (this.options.apiKey) await runtime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    const model = runtime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(), agentDir: `${process.cwd()}/.pi`, settingsManager,
      systemPromptOverride: () => [
        "You interpret one player's freeform game input into a bounded candidate; you are not a narrator or world authority.",
        "Separate public speech from private thought. Never include private thought in publicText.",
        "Choose one primary lane: dialogue, action, or combat. Preserve uncertainty in intent/approach rather than inventing results.",
        "Use submit_player_intent exactly once. You cannot make any world change.",
      ].join("\n"),
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: process.cwd(), model, modelRuntime: runtime, thinkingLevel: "low", noTools: "builtin",
      tools: ["submit_player_intent"], customTools: [submit], resourceLoader: loader,
      sessionManager: SessionManager.inMemory(), settingsManager,
    });
    await session.prompt(JSON.stringify({
      task: "Interpret this player input. Return only facts expressed by the player, not imagined outcomes.",
      input: { content: input.content, targetIds: input.targetIds ?? [], parameters: input.parameters ?? {} },
    }));
    if (!submitted) throw new Error("Pi input interpreter finished without calling submit_player_intent");
    return {
      kind: "resolved",
      action: {
        id: input.id, sessionId: input.sessionId, actorId: input.actorId, type: submitted.type,
        content: submitted.publicText, targetIds: submitted.targetIds,
        parameters: compact({ intent: submitted.intent, destination: submitted.destination, approach: submitted.approach }),
      },
      privateThought: submitted.privateThought,
    };
  }
}

function compact(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string>;
}
