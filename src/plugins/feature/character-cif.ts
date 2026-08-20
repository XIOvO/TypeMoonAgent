import { Service, type Context } from "@deepseek-ai/cordis";
import type { CharacterContextProvider, CharacterContextRequest } from "../../cif/character-context-provider.js";
import type { CharacterIdentityProvider, CharacterIdentityRequest } from "../../cif/character-identity-provider.js";
import type { CharacterMemoryProvider, CharacterMemoryRecallRequest } from "../../cif/character-memory-provider.js";
import type { EpistemicProvider, PublicEpistemicState } from "../../cif/epistemic-provider.js";
import type { InterpretiveModelProvider } from "../../cif/interpretive-model-provider.js";
import type { CharacterContext, IdentityModel, InterpretiveModel, MemoryRecall } from "../../cif/types.js";
import type { CordisPluginDefinitionV2 } from "../../platform/cordis-platform.js";
import type { PluginManifestV2 } from "../../platform/plugin-manifest.js";
import type { CapabilityId, PluginId } from "../../protocol/ids.js";

export const CHARACTER_CONTEXT_CAPABILITY = "character.context" as CapabilityId;
export const CHARACTER_MEMORY_CAPABILITY = "character.memory" as CapabilityId;
export const CHARACTER_IDENTITY_CAPABILITY = "character.identity" as CapabilityId;
export const CHARACTER_EPISTEMIC_CAPABILITY = "character.epistemic" as CapabilityId;
export const CHARACTER_INTERPRETATION_CAPABILITY = "character.interpretation" as CapabilityId;
export const CHARACTER_CIF_PLUGIN_ID = "feature.character-cif" as PluginId;

const CAPABILITY_VERSION = "1.0.0";

export const CHARACTER_CIF_MANIFEST: PluginManifestV2 = {
  id: CHARACTER_CIF_PLUGIN_ID,
  version: "1.0.0",
  apiVersion: "0.3.0",
  configVersion: 1,
  type: "feature",
  permissions: ["character.read"],
  provides: [
    { id: CHARACTER_CONTEXT_CAPABILITY, version: CAPABILITY_VERSION, scope: "public", description: "Builds a bounded read-only character context." },
    { id: CHARACTER_MEMORY_CAPABILITY, version: CAPABILITY_VERSION, scope: "public", description: "Recalls character-owned memories without exposing storage." },
    { id: CHARACTER_IDENTITY_CAPABILITY, version: CAPABILITY_VERSION, scope: "public", description: "Reads versioned identity sections selected by context." },
    { id: CHARACTER_EPISTEMIC_CAPABILITY, version: CAPABILITY_VERSION, scope: "public", description: "Projects character knowledge and uncertainty." },
    { id: CHARACTER_INTERPRETATION_CAPABILITY, version: CAPABILITY_VERSION, scope: "public", description: "Reads the latest live interpretive models." },
  ],
};

export interface CharacterCifProviders {
  context: CharacterContextProvider;
  memory: CharacterMemoryProvider;
  identity: CharacterIdentityProvider;
  epistemic: EpistemicProvider;
  interpretation: InterpretiveModelProvider;
}

class CharacterContextCapability extends Service implements CharacterContextProvider {
  public constructor(ctx: Context, private readonly provider: CharacterContextProvider) { super(ctx, "characterContext"); }
  public build(request: CharacterContextRequest): Promise<CharacterContext> { return this.provider.build(request); }
}

class CharacterMemoryCapability extends Service implements CharacterMemoryProvider {
  public constructor(ctx: Context, private readonly provider: CharacterMemoryProvider) { super(ctx, "characterMemory"); }
  public recall(request: CharacterMemoryRecallRequest): Promise<MemoryRecall> { return this.provider.recall(request); }
}

class CharacterIdentityCapability extends Service implements CharacterIdentityProvider {
  public constructor(ctx: Context, private readonly provider: CharacterIdentityProvider) { super(ctx, "characterIdentity"); }
  public getIdentity(request: CharacterIdentityRequest): Promise<readonly IdentityModel[]> { return this.provider.getIdentity(request); }
}

class CharacterEpistemicCapability extends Service implements EpistemicProvider {
  public constructor(ctx: Context, private readonly provider: EpistemicProvider) { super(ctx, "characterEpistemic"); }
  public getStates(request: Parameters<EpistemicProvider["getStates"]>[0]): Promise<readonly PublicEpistemicState[]> { return this.provider.getStates(request); }
}

class CharacterInterpretationCapability extends Service implements InterpretiveModelProvider {
  public constructor(ctx: Context, private readonly provider: InterpretiveModelProvider) { super(ctx, "characterInterpretation"); }
  public getModels(request: Parameters<InterpretiveModelProvider["getModels"]>[0]): Promise<readonly InterpretiveModel[]> { return this.provider.getModels(request); }
}

/** Composes the five public, read-only CIF providers behind one feature plugin. */
export function createCharacterCifPlugin(providers: CharacterCifProviders): CordisPluginDefinitionV2 {
  return {
    manifest: CHARACTER_CIF_MANIFEST,
    bindings: [
      { capabilityId: CHARACTER_CONTEXT_CAPABILITY, serviceKey: "characterContext" },
      { capabilityId: CHARACTER_MEMORY_CAPABILITY, serviceKey: "characterMemory" },
      { capabilityId: CHARACTER_IDENTITY_CAPABILITY, serviceKey: "characterIdentity" },
      { capabilityId: CHARACTER_EPISTEMIC_CAPABILITY, serviceKey: "characterEpistemic" },
      { capabilityId: CHARACTER_INTERPRETATION_CAPABILITY, serviceKey: "characterInterpretation" },
    ],
    implementation: (ctx: Context) => {
      new CharacterContextCapability(ctx, providers.context);
      new CharacterMemoryCapability(ctx, providers.memory);
      new CharacterIdentityCapability(ctx, providers.identity);
      new CharacterEpistemicCapability(ctx, providers.epistemic);
      new CharacterInterpretationCapability(ctx, providers.interpretation);
    },
  };
}
