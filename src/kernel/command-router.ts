import type { CommandEnvelope, CommandResult } from "../protocol/command.js";

export type CommandHandler = (command: CommandEnvelope) => Promise<CommandResult> | CommandResult;

/** Maps normalized command types to one authority-owned handler. */
export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  public register(type: string, handler: CommandHandler): void {
    if (this.handlers.has(type)) throw new Error("command_handler_already_registered");
    this.handlers.set(type, handler);
  }

  public async execute(command: CommandEnvelope): Promise<CommandResult> {
    const handler = this.handlers.get(command.type);
    return handler
      ? handler(command)
      : { accepted: false, rejection: { code: "command.not_found", details: { type: command.type } } };
  }
}
