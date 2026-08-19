import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { MemoryConsolidationGenerator, MemoryConsolidationProposal } from "../cif/memory-consolidator.js";
import type { MemoryConsolidationTask } from "../cif/types.js";
import { L1_SCENE_MEMORY_PROMPT } from "./memory-prompts.js";

/** A low-frequency worker: it can propose memories, but has no game or database tools. */
export class PiMemoryConsolidationGenerator implements MemoryConsolidationGenerator {
  public constructor(private readonly options: { provider: string; modelId: string; apiKey?: string }) {}

  public async generate(task: MemoryConsolidationTask, evidence: Array<{ id: string; content: string; sourceEventIds: string[] }>): Promise<MemoryConsolidationProposal> {
    let submitted: MemoryConsolidationProposal | undefined;
    const submit = defineTool({
      name: "submit_memory_consolidation", label: "Submit memory consolidation",
      description: "Decide whether this character should retain a long-term memory from the supplied witnessed evidence.",
      parameters: Type.Object({
        shouldRemember: Type.Boolean(), summary: Type.Optional(Type.String()), subjectiveInterpretation: Type.Optional(Type.String()),
        emotions: Type.Array(Type.Object({ type: Type.String(), intensity: Type.Number(), targetId: Type.Optional(Type.String()) })),
        salience: Type.Number(),
        publicSummary: Type.Optional(Type.String()),
        openThreads: Type.Array(Type.String()), storyPressures: Type.Array(Type.String()),
      }),
      execute: async (_toolCallId, parameters) => {
        submitted = parameters as MemoryConsolidationProposal;
        return { content: [{ type: "text", text: "Memory proposal received." }], details: {} };
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
        L1_SCENE_MEMORY_PROMPT,
      ].join("\n"),
    });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: process.cwd(), model, modelRuntime: runtime, thinkingLevel: "low", noTools: "builtin", tools: ["submit_memory_consolidation"], customTools: [submit], resourceLoader: loader, sessionManager: SessionManager.inMemory(), settingsManager });
    await session.prompt(JSON.stringify({ task, witnessedEvidence: evidence }));
    if (!submitted) throw new Error("Pi memory consolidator finished without submitting a proposal");
    return submitted;
  }
}
