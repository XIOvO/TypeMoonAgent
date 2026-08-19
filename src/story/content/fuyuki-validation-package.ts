import type { StoryChapterPackage } from "../../core/worldline.js";

/**
 * A deliberately small integration fixture, not a claim to model all of
 * Fuyuki. Real chapter packages will be generated/reviewed from canon sources.
 */
export const fuyukiValidationPackage: StoryChapterPackage = {
  packageId: "validation:fuyuki:v1", contentType: "main", contentId: "fuyuki",
  canonAnchor: "fgo:singularity-f:fuyuki:entry", entryNodeId: "fuyuki:secure-gate", sourceFragmentIds: ["canon:validation:fuyuki"], version: 1,
  nodeRules: [
    {
      id: "fuyuki:secure-gate", when: { type: "object_interacted", payloadEquals: { objectId: "fuyuki_singularity_gate" } },
      transition: { status: "active", activeNodeId: "fuyuki:rescue", completeNodeIds: ["fuyuki:secure-gate"] },
      fact: { factKey: "fuyuki.singularity_gate", value: { secured: true } },
    },
    {
      id: "fuyuki:rescue", when: { type: "object_interacted", payloadEquals: { objectId: "olga_rescue_device" } },
      requiresFacts: [{ factKey: "fuyuki.singularity_gate", valueEquals: { secured: true } }],
      transition: { status: "completed", completeNodeIds: ["fuyuki:rescue"], divertNodeIds: ["canon:olga-death"] },
      fact: {
        factKey: "olga_marie.status", value: { status: "alive", locationId: "chaldea" }, canonBaseline: { status: "dead" },
        divergence: { significance: "critical", affectedScope: "global", knownImpactNodeIds: ["u-olga-origin"], pendingImpactChapterIds: ["lostbelt-prologue"], status: "active", rationale: "A branch rule confirmed that the rescue changed Olga Marie's status." },
      },
    },
  ],
  assessmentPolicies: [{
    factKey: "fuyuki.artifact.status", allowedValue: { secured: [true, false] }, allowedCanonBaseline: { secured: [true, false] },
    allowedEventTypes: ["object_interacted"], allowedCanonSourceFragmentIds: ["canon:validation:fuyuki"],
    allowedSignificances: ["minor", "major"], allowedAffectedScopes: ["local", "chapter"],
    allowedKnownImpactNodeIds: ["fuyuki:artifact-path"], allowedPendingImpactChapterIds: ["fuyuki:aftermath"],
  }],
};
