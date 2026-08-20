import type { CommandEnvelope, CommandResult } from "../protocol/command.js";
import { isStoryCommand, type StoryCommand } from "../protocol/story-commands.js";

export type StoryCommandHandler = (command: StoryCommand) => Promise<CommandResult> | CommandResult;

/** Capability-aware bridge: S1 declares contracts without migrating any current handler. */
export class StoryCommandDispatcher {
  public constructor(private readonly handlers: Partial<Record<StoryCommand["type"], StoryCommandHandler>> = {}) {}

  public execute(command: CommandEnvelope): Promise<CommandResult> | CommandResult {
    if (!isStoryCommand(command)) return { accepted: false, rejection: { code: "story.command_invalid", details: { type: command.type } } };
    const handler = this.handlers[command.type];
    return handler
      ? handler(command)
      : { accepted: false, rejection: { code: "story.capability_unavailable", details: { capability: command.type } } };
  }
}
