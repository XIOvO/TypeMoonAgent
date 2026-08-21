import {
  defineCapability,
  defineEventSchema,
  definePlugin,
} from "agent-game-runtime/sdk";
import type {
  CommandEnvelope,
  CommandResult,
  PluginRuntimeContext,
} from "agent-game-runtime/sdk";

export interface GreetingCommandPayload {
  readonly name: string;
}

export interface GreetingEventPayload {
  readonly name: string;
  readonly message: string;
}

export interface SimpleGreetingCapability {
  execute(command: CommandEnvelope<GreetingCommandPayload>): Promise<CommandResult>;
}

export interface SimpleGreetingConfig {
  readonly prefix?: string;
}

export const SIMPLE_GREETING_CAPABILITY = defineCapability({
  id: "example.greeting",
  version: "1.0.0",
  scope: "public",
  description: "Turns a greeting command into a candidate greeting event.",
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
    },
  },
  outputSchema: {
    type: "object",
    required: ["accepted"],
    properties: {
      accepted: { type: "boolean" },
    },
  },
});

export const GREETING_SENT_EVENT = defineEventSchema({
  type: "example.greeting.sent",
  schemaVersion: 1,
  payloadSchema: {
    type: "object",
    required: ["name", "message"],
    properties: {
      name: { type: "string", minLength: 1 },
      message: { type: "string", minLength: 1 },
    },
  },
});

export const simpleGreetingPlugin = definePlugin({
  manifest: {
    id: "example.simple-greeting",
    version: "1.0.0",
    apiVersion: "0.3",
    configVersion: 1,
    type: "feature",
    description: "Minimal SDK reference plugin for a command/event loop.",
    provides: [SIMPLE_GREETING_CAPABILITY],
    ownsEvents: [{ namespace: "example.greeting", versions: [1] }],
  },
  setup(context: PluginRuntimeContext) {
    const prefix = readPrefix(context.config);
    const implementation: SimpleGreetingCapability = {
      async execute(command) {
        const name = command.payload.name.trim();
        if (command.type !== "example.greeting.send" || name.length === 0) {
          return {
            accepted: false,
            rejection: { code: "greeting.invalid_command" },
          };
        }
        return {
          accepted: true,
          events: [{
            type: GREETING_SENT_EVENT.type,
            payload: { name, message: prefix + ", " + name + "!" } satisfies GreetingEventPayload,
          }],
        };
      },
    };
    context.capabilities.provide(SIMPLE_GREETING_CAPABILITY, implementation);
    context.logger.info("simple greeting ready", { capability: SIMPLE_GREETING_CAPABILITY.id });
  },
});

function readPrefix(config: unknown): string {
  if (typeof config !== "object" || config === null || !("prefix" in config)) return "Hello";
  const prefix = (config as SimpleGreetingConfig).prefix?.trim();
  return prefix || "Hello";
}
