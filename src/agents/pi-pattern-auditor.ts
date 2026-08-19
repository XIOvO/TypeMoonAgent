import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { CognitiveAuditVerdict } from "../core/cognitive-evolution.js";
import type { PatternConsolidationAuditor } from "../cif/pattern-consolidator.js";

const L2_AUDIT_PROMPT = [
  "You are an independent L2 cognitive-change auditor, not a generator.",
  "Do not rewrite the proposal. Check only whether its cited episodic memories support it, whether it is gradual, and whether it stays inside L2.",
  "Approve only a low-risk, evidence-complete relationship interpretation, fallible belief, or recurring goal. Defer uncertainty or medium/high risk; reject unsupported or out-of-scope proposals.",
  "Never change identity, values, personality, world facts, or the database. Call submit_cognitive_audit exactly once.",
].join("\n");

export class PiPatternAuditor implements PatternConsolidationAuditor {
  public constructor(private readonly options: { provider: string; modelId: string; apiKey?: string }) {}
  public async audit(input: Parameters<PatternConsolidationAuditor["audit"]>[0]): Promise<CognitiveAuditVerdict> {
    let submitted: CognitiveAuditVerdict | undefined;
    const submit = defineTool({ name: "submit_cognitive_audit", label: "Submit cognitive audit", description: "Approve, defer, or reject the unchanged L2 proposal.",
      parameters: Type.Object({ layer: Type.Literal("l2"), decision: Type.Union([Type.Literal("approve"), Type.Literal("defer"), Type.Literal("reject")]), risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]), citedInputIds: Type.Array(Type.String()), rationale: Type.String(), policyVersion: Type.Integer({ minimum: 1 }), nextObservation: Type.Optional(Type.String()) }),
      execute: async (_id, parameters) => { submitted = parameters as CognitiveAuditVerdict; return { content: [{ type: "text", text: "Audit received." }], details: {} }; } });
    const runtime = await ModelRuntime.create();
    if (this.options.apiKey) await runtime.setRuntimeApiKey(this.options.provider, this.options.apiKey);
    const model = runtime.getModel(this.options.provider, this.options.modelId);
    if (!model) throw new Error(`Pi model not found: ${this.options.provider}/${this.options.modelId}`);
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: `${process.cwd()}/.pi`, settingsManager, systemPromptOverride: () => L2_AUDIT_PROMPT });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: process.cwd(), model, modelRuntime: runtime, thinkingLevel: "low", noTools: "builtin", tools: ["submit_cognitive_audit"], customTools: [submit], resourceLoader: loader, sessionManager: SessionManager.inMemory(), settingsManager });
    await session.prompt(JSON.stringify(input));
    if (!submitted) throw new Error("Pi pattern auditor finished without submitting a verdict");
    return submitted;
  }
}
