/** Shared result vocabulary for AI review of L2 and future L3 cognitive changes. */
export type CognitiveLayer = "l2" | "l3";
export interface CognitiveAuditVerdict {
  layer: CognitiveLayer;
  decision: "approve" | "defer" | "reject";
  risk: "low" | "medium" | "high";
  citedInputIds: string[];
  rationale: string;
  policyVersion: number;
  nextObservation?: string;
}

export function validateCognitiveAuditVerdict(input: {
  layer: CognitiveLayer;
  allowedInputIds: readonly string[];
  requiredInputId: string;
  minimumDistinctInputs?: number;
  verdict: CognitiveAuditVerdict;
}): string[] {
  const errors: string[] = [];
  if (input.verdict.layer !== input.layer) errors.push("audit_layer_mismatch");
  if (!Number.isSafeInteger(input.verdict.policyVersion) || input.verdict.policyVersion < 1) errors.push("audit_policy_version_invalid");
  if (!input.verdict.rationale.trim()) errors.push("audit_rationale_empty");
  if (input.verdict.decision === "approve") {
    const cited = new Set(input.verdict.citedInputIds);
    if (cited.size < (input.minimumDistinctInputs ?? 2)) errors.push("audit_requires_minimum_distinct_inputs");
    if (!cited.has(input.requiredInputId)) errors.push("audit_requires_trigger_input");
    if ([...cited].some((id) => !input.allowedInputIds.includes(id))) errors.push("audit_references_unknown_input");
  }
  return [...new Set(errors)];
}
