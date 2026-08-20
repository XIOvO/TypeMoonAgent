import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { StoryDirector, type CharacterAppearanceFactorsProvider, type CharacterAppearancePublicationPolicy } from "../../story/director.js";
import type { CharacterAppearanceRecommendation, CharacterAvailability, StorySignal } from "../../story/types.js";

export const STORY_APPEARANCE_CAPABILITY = "story.appearance";

/** Policy-owned entry point for deciding and committing character appearances. */
export interface StoryAppearanceController {
  recommend(signal: StorySignal): CharacterAppearanceRecommendation[];
  introduce(signal: StorySignal, recommendation: CharacterAppearanceRecommendation): Promise<void>;
}

export interface StoryAppearancePluginDependencies {
  availability: readonly CharacterAvailability[];
  publication: CharacterAppearancePublicationPolicy;
  commands: CommandGateway;
  factors?: CharacterAppearanceFactorsProvider;
}

class StoryAppearanceService extends Service implements StoryAppearanceController {
  public constructor(ctx: Context, private readonly controller: StoryAppearanceController) { super(ctx, "storyAppearance"); }
  public recommend(signal: StorySignal) { return this.controller.recommend(signal); }
  public introduce(signal: StorySignal, recommendation: CharacterAppearanceRecommendation) { return this.controller.introduce(signal, recommendation); }
}

/** Owns publication-aware character appearance policy; Runtime only commits accepted introductions. */
export function createStoryAppearancePlugin(dependencies: StoryAppearancePluginDependencies): CordisGamePluginDefinition {
  const director = new StoryDirector(dependencies.availability, dependencies.publication, dependencies.factors);
  const controller: StoryAppearanceController = {
    recommend: (signal) => director.recommend(dependencies.commands, signal),
    introduce: (signal, recommendation) => director.introduce(dependencies.commands, signal, recommendation),
  };
  return {
    manifest: {
      id: "feature.story-appearance",
      version: "1.0.0",
      configVersion: 1,
      requires: ["world.commandGateway"],
      provides: [{ id: STORY_APPEARANCE_CAPABILITY, serviceKey: "storyAppearance" }],
    },
    implementation: (ctx: Context) => { new StoryAppearanceService(ctx, controller); },
  };
}
