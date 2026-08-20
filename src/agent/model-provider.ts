/** Provider-neutral input for one text generation request. */
export interface ModelGenerationRequest {
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  maxOutputTokens?: number;
  metadata?: Readonly<Record<string, string>>;
}

/** Provider-neutral text result. Tool calls remain an Agent-adapter concern. */
export interface ModelGenerationResult {
  modelId: string;
  text: string;
  finishReason: "stop" | "length";
}

/**
 * Minimal boundary for model access. Runtime depends on AgentProvider only and
 * therefore never receives a model provider or provider-specific SDK value.
 */
export interface ModelProvider {
  readonly id: string;
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResult>;
}
