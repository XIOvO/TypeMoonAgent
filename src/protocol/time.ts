/**
 * Authoritative narrative time. It is independent from wall-clock timestamps,
 * which remain operational metadata for persistence and worker leases.
 */
export interface GameMoment {
  timelineId: string;
  tick: number;
  /** Optional game-owned display/calendar data; Runtime does not calculate it. */
  calendar?: Record<string, string | number | boolean>;
}
