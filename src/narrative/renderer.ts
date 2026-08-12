import type { GameEvent } from "../core/contracts.js";
import type { NarrativeBeat, NarrativeBlock } from "./contracts.js";

export interface NarrativeNameResolver {
  nameFor(characterId: string): string;
  locationNameFor(locationId: string): string;
}

/**
 * First-pass renderer: a deterministic, zero-model-call projection of one
 * committed GameEvent. Rich prose can later replace or extend these blocks,
 * but must retain the event IDs and revision supplied here.
 */
export class DeterministicNarrativeRenderer {
  public constructor(private readonly names: NarrativeNameResolver = new IdNarrativeNameResolver()) {}

  public render(event: GameEvent): NarrativeBeat {
    return {
      id: `beat:${event.id}`,
      sourceEventIds: [event.id],
      stateRevision: event.stateRevision,
      blocks: this.blocksFor(event),
    };
  }

  private blocksFor(event: GameEvent): NarrativeBlock[] {
    const payload = event.payload;
    switch (event.type) {
      case "player_spoke":
      case "character_spoke": {
        const speakerId = stringValue(payload.characterId, "unknown");
        return [{ id: event.id, kind: "dialogue", record: "backlog", speakerId, speakerName: this.names.nameFor(speakerId), text: stringValue(payload.text, "……") }];
      }
      case "character_moved": {
        const characterId = stringValue(payload.characterId, "unknown");
        const destination = stringValue(payload.to, "unknown");
        return [{ id: event.id, kind: "scene_transition", record: "world", locationId: destination, title: `${this.names.nameFor(characterId)}前往${this.names.locationNameFor(destination)}` }];
      }
      case "area_observed":
        return [{ id: event.id, kind: "narration", record: "backlog", text: `${this.names.nameFor(stringValue(payload.characterId, "player"))}环视了${this.names.locationNameFor(stringValue(payload.locationId, "unknown"))}。` }];
      case "object_inspected":
        return [{ id: event.id, kind: "narration", record: "backlog", text: stringValue(payload.description, "你仔细查看了眼前的事物。") }];
      case "object_interacted":
        return [{ id: event.id, kind: "system", record: "world", importance: "important", text: `${this.names.nameFor(stringValue(payload.characterId, "player"))}已对${stringValue(payload.objectId, "目标")}执行${stringValue(payload.method, "操作")}。` }];
      case "time_waited":
        return [{ id: event.id, kind: "narration", record: "backlog", text: "时间安静地流逝。" }];
      case "character_introduced":
        return [{ id: event.id, kind: "system", record: "world", importance: "important", text: `${this.names.nameFor(stringValue(payload.characterId, "unknown"))}已在${this.names.locationNameFor(stringValue(payload.locationId, "unknown"))}出现。` }];
      case "battle_started":
        return [{ id: event.id, kind: "system", record: "world", importance: "important", text: `战斗开始：${stringValue(payload.objective, "未知目标")}。` }];
      case "battle_round_resolved":
        return [{ id: event.id, kind: "system", record: "none", importance: "temporary", text: `第${numberValue(payload.turn, 0)}回合已结算。` }];
      case "battle_finished":
        return [{ id: event.id, kind: "system", record: "world", importance: "important", text: `战斗结束：${stringValue(payload.outcome, "结果未明")}。` }];
      case "action_rejected":
        return [{ id: event.id, kind: "system", record: "none", importance: "temporary", text: `这次尝试未能成立：${stringValue(payload.reason, "未知原因")}。` }];
    }
  }
}

export class IdNarrativeNameResolver implements NarrativeNameResolver {
  public nameFor(characterId: string): string { return characterId; }
  public locationNameFor(locationId: string): string { return locationId; }
}

function stringValue(value: unknown, fallback: string): string { return typeof value === "string" && value.trim() ? value : fallback; }
function numberValue(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
