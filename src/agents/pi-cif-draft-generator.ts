import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildCifInitializationPrompt, type CifDraftGenerator, type CifInitializationBrief, type CifInitializationDraft } from "../cif/initializer.js";

const confidence = Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]);
const section = Type.Union([
  Type.Literal("self_model"), Type.Literal("core_schema"), Type.Literal("needs"), Type.Literal("values"),
  Type.Literal("possible_self"), Type.Literal("dream"), Type.Literal("commitment"),
]);

/** Pi worker for a rare initialization job. It has no file, shell, database, or game-state tool. */
export class PiCifDraftGenerator implements CifDraftGenerator {
  public constructor(private readonly options: { provider: string; modelId: string; apiKey?: string }) {}

  public async generate(brief: CifInitializationBrief): Promise<CifInitializationDraft> {
    let submitted: CifInitializationDraft | undefined;
    const submit = defineTool({
      name: "submit_cif_initialization_draft", label: "Submit CIF initialization draft",
      description: "Submit one evidence-cited CIF draft. This tool does not publish or modify a character.",
      parameters: Type.Object({
        characterId: Type.String(), variantId: Type.String(), storyPointId: Type.String(),
        identity: Type.Array(Type.Object({ section, content: Type.String(), sourceChunkIds: Type.Array(Type.String()), confidence })),
        initialKnowledge: Type.Array(Type.Object({ proposition: Type.String(), sourceChunkIds: Type.Array(Type.String()), confidence })),
        initialRelationships: Type.Array(Type.Object({ targetId: Type.String(), summary: Type.String(), sourceChunkIds: Type.Array(Type.String()), confidence })),
        initialRuntimeState: Type.Object({ mood: Type.Union([Type.Literal("calm"), Type.Literal("alert")]), activeGoals: Type.Array(Type.String()) }),
        reviewFlags: Type.Array(Type.String()),
      }),
      execute: async (_toolCallId, parameters) => {
        submitted = parameters;
        return { content: [{ type: "text", text: "Draft received for validation and review." }], details: {} };
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
        "You are a cautious CIF initialization researcher.",
        "Use only the supplied canon evidence. Do not infer future facts or session memories.",
        "Every claim must cite supplied sourceChunkIds. Omit unsupported claims and add a review flag.",
        "Call submit_cif_initialization_draft exactly once. Your draft will not be published automatically.",
      ].join("\n"),
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: process.cwd(), model, modelRuntime: runtime, thinkingLevel: "low", noTools: "builtin",
      tools: ["submit_cif_initialization_draft"], customTools: [submit], resourceLoader: loader,
      sessionManager: SessionManager.inMemory(), settingsManager,
    });
    await session.prompt(buildCifInitializationPrompt(brief));
    if (!submitted) throw new Error("Pi initializer finished without calling submit_cif_initialization_draft");
    return submitted;
  }
}
