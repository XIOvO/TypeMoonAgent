import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { CifPatternProposal } from "../cif/types.js";
import type { PatternConsolidationBrief, PatternConsolidationGenerator } from "../cif/pattern-consolidator.js";
import { L2_PATTERN_CONSOLIDATION_PROMPT } from "./memory-prompts.js";

/** L2 can only emit a cited proposal; it has no persistence or game tools. */
export class PiPatternConsolidationGenerator implements PatternConsolidationGenerator {
  public constructor(private readonly options: { provider: string; modelId: string; apiKey?: string }) {}

  public async generate(brief: PatternConsolidationBrief): Promise<CifPatternProposal> {
    let submitted: CifPatternProposal | undefined;
    const submit = defineTool({
      name: "submit_pattern_consolidation", label: "Submit L2 pattern consolidation",
      description: "Submit a cited, bounded L2 proposal or an explicit no-change decision.",
      parameters: Type.Object({
        shouldPropose: Type.Boolean(), characterId: Type.String(), sourceEpisodeIds: Type.Array(Type.String()), rationale: Type.Optional(Type.String()),
        relationship: Type.Optional(Type.Object({ targetId: Type.String(), content: Type.String(), confidence: Type.Number() })),
        belief: Type.Optional(Type.Object({ proposition: Type.String(), status: Type.Union([Type.Literal("accepted"), Type.Literal("likely"), Type.Literal("possible"), Type.Literal("uncertain"), Type.Literal("contested"), Type.Literal("rejected"), Type.Literal("unknown"), Type.Literal("outdated")]), confidence: Type.Number() })),
        recurringGoal: Type.Optional(Type.Object({ content: Type.String(), confidence: Type.Number() })),
      }),
      execute: async (_toolCallId, parameters) => { submitted = parameters as CifPatternProposal; return { content: [{ type: "text", text: "Pattern proposal received." }], details: {} }; },
    });
    const runtime = await ModelRuntime.create();
    if (this.options.apiKey) await runtime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    const model = runtime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: `${process.cwd()}/.pi`, settingsManager, systemPromptOverride: () => L2_PATTERN_CONSOLIDATION_PROMPT });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: process.cwd(), model, modelRuntime: runtime, thinkingLevel: "low", noTools: "builtin", tools: ["submit_pattern_consolidation"], customTools: [submit], resourceLoader: loader, sessionManager: SessionManager.inMemory(), settingsManager });
    await session.prompt(JSON.stringify(brief));
    if (!submitted) throw new Error("Pi pattern consolidator finished without submitting a proposal");
    return submitted;
  }
}
