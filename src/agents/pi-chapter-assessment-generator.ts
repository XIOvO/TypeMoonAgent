import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ChapterAssessmentGenerator, ChapterAssessmentProposal } from "../core/chapter-assessment.js";
import { CHAPTER_CAUSAL_ASSESSMENT_PROMPT } from "./chapter-assessment-prompts.js";

/** Low-frequency, tool-only analysis; it receives no database or Runtime authority. */
export class PiChapterAssessmentGenerator implements ChapterAssessmentGenerator {
  public constructor(private readonly options: { provider: string; modelId: string; apiKey?: string }) {}
  public async generate(input: Parameters<ChapterAssessmentGenerator["generate"]>[0]): Promise<ChapterAssessmentProposal> {
    let submitted: ChapterAssessmentProposal | undefined;
    const submit = defineTool({
      name: "submit_chapter_assessment", label: "Submit chapter assessment", description: "Submit a cited causal-impact proposal for the active chapter.",
      parameters: Type.Object({
        shouldApply: Type.Boolean(), sourceEventIds: Type.Array(Type.String()), canonSourceFragmentIds: Type.Array(Type.String()),
        changedFact: Type.Optional(Type.Object({ factKey: Type.String(), valueJson: Type.String(), canonBaselineJson: Type.String() })),
        divergence: Type.Optional(Type.Object({ significance: Type.Union([Type.Literal("minor"), Type.Literal("major"), Type.Literal("critical")]), affectedScope: Type.Union([Type.Literal("local"), Type.Literal("chapter"), Type.Literal("future"), Type.Literal("global")]), knownImpactNodeIds: Type.Array(Type.String()), pendingImpactChapterIds: Type.Array(Type.String()), status: Type.Literal("active"), rationale: Type.String() })),
        pendingImpactChapterIds: Type.Array(Type.String()), rationale: Type.String(),
      }),
      execute: async (_id, parameters) => {
        const raw = parameters as { shouldApply: boolean; sourceEventIds: string[]; canonSourceFragmentIds: string[]; changedFact?: { factKey: string; valueJson: string; canonBaselineJson: string }; divergence?: ChapterAssessmentProposal["divergence"]; pendingImpactChapterIds: string[]; rationale: string };
        submitted = {
          shouldApply: raw.shouldApply, sourceEventIds: raw.sourceEventIds, canonSourceFragmentIds: raw.canonSourceFragmentIds,
          ...(raw.changedFact ? { changedFact: { factKey: raw.changedFact.factKey, value: JSON.parse(raw.changedFact.valueJson), canonBaseline: JSON.parse(raw.changedFact.canonBaselineJson) } } : {}),
          ...(raw.divergence ? { divergence: raw.divergence } : {}), pendingImpactChapterIds: raw.pendingImpactChapterIds, rationale: raw.rationale,
        };
        return { content: [{ type: "text", text: "Chapter assessment received." }], details: {} };
      },
    });
    const runtime = await ModelRuntime.create();
    if (this.options.apiKey) await runtime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    const model = runtime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: `${process.cwd()}/.pi`, settingsManager, systemPromptOverride: () => CHAPTER_CAUSAL_ASSESSMENT_PROMPT });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: process.cwd(), model, modelRuntime: runtime, thinkingLevel: "low", noTools: "builtin", tools: ["submit_chapter_assessment"], customTools: [submit], resourceLoader: loader, sessionManager: SessionManager.inMemory(), settingsManager });
    await session.prompt(JSON.stringify(input));
    if (!submitted) throw new Error("Pi chapter assessor finished without submitting a proposal");
    return submitted;
  }
}
