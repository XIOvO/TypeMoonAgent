import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildCifInitializationPrompt, type CifDraftGenerator, type CifInitializationBrief, type CifInitializationDraft } from "../cif/initializer.js";
import { CIF_INITIALIZATION_SYSTEM_PROMPT } from "../cif/prompts.js";

const confidence = Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]);
const section = Type.Union([
  Type.Literal("character_brief"),
  Type.Literal("self_model"), Type.Literal("core_schema"), Type.Literal("needs"), Type.Literal("values"),
  Type.Literal("possible_self"), Type.Literal("dream"), Type.Literal("commitment"),
  Type.Literal("appraisal_tendencies"), Type.Literal("emotional_pattern"), Type.Literal("practical_judgment"),
  Type.Literal("expression_filter"), Type.Literal("voice_embodiment"), Type.Literal("growth_boundaries"),
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
        profile: Type.Object({ ageOrLifeStage: Type.Optional(Type.String()), socialIdentity: Type.Optional(Type.String()), affiliation: Type.Optional(Type.String()), homeRegion: Type.Optional(Type.String()), objectiveStatus: Type.Optional(Type.String()), sourceChunkIds: Type.Array(Type.String()) }),
        capabilities: Type.Array(Type.Object({ category: Type.Union([Type.Literal("sensory"), Type.Literal("language"), Type.Literal("professional"), Type.Literal("special"), Type.Literal("limitation")]), content: Type.String(), mechanicalTags: Type.Array(Type.String()), sourceChunkIds: Type.Array(Type.String()) })),
        lifeContext: Type.Object({ scheduleSummary: Type.Optional(Type.String()), responsibilities: Type.Array(Type.String()), currentProblems: Type.Array(Type.String()), availableResources: Type.Array(Type.String()), missingResources: Type.Array(Type.String()), independentLifeSummary: Type.Optional(Type.String()), sourceChunkIds: Type.Array(Type.String()) }),
        objectiveRelationships: Type.Array(Type.Object({ targetId: Type.String(), relationType: Type.String(), sharedHistorySummary: Type.Optional(Type.String()), currentObjectiveStatus: Type.Optional(Type.String()), sourceChunkIds: Type.Array(Type.String()) })),
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
        CIF_INITIALIZATION_SYSTEM_PROMPT,
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
