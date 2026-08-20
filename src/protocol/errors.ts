/** Stable machine-readable error codes for public protocol validation. */
export type ErrorCode =
  | "action.invalid"
  | "action.id_conflict"
  | "state.revision_conflict"
  | "capability.not_found"
  | "capability.version_mismatch"
  | "plugin.dependency_cycle"
  | "plugin.permission_denied"
  | "agent.provider_not_found"
  | "persistence.commit_failed";

/** A validation failure that callers must handle by code, not display text. */
export interface ValidationIssue {
  code: ErrorCode;
  field?: string;
  details?: Record<string, unknown>;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };
