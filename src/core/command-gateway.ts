import type {
  ActionResult,
  GameState,
  PlayerAction,
  RawPlayerInput,
  RuntimeBattleStartRequest,
  RuntimeCharacterIntroductionRequest,
} from "./contracts.js";
import type {
  RuntimeChapterEntryRequest,
  RuntimeCharacterApproachRequest,
  RuntimeCharacterInitiativeRequest,
  RuntimeEventListener,
} from "./runtime.js";
import type { CommandEnvelope } from "../protocol/command.js";

/**
 * The only authority-facing contract consumed by API and future game plugins.
 * Implementations decide how commands are validated and committed.
 */
export interface CommandGateway {
  getState(): Readonly<GameState>;
  subscribe(listener: RuntimeEventListener): () => void;
  execute(command: CommandEnvelope): Promise<ActionResult>;
  handlePlayerAction(action: PlayerAction): Promise<ActionResult>;
  handleRawPlayerInput(input: RawPlayerInput): Promise<ActionResult>;
  enterChapter(request: RuntimeChapterEntryRequest): Promise<ActionResult>;
  introduceCharacter(request: RuntimeCharacterIntroductionRequest): Promise<ActionResult>;
  startBattle(request: RuntimeBattleStartRequest): Promise<ActionResult>;
  runCharacterInitiative(request: RuntimeCharacterInitiativeRequest): Promise<ActionResult>;
  moveCharacterTowardPlayer(request: RuntimeCharacterApproachRequest): Promise<ActionResult>;
}
