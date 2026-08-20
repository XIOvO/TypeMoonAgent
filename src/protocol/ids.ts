/**
 * Stable protocol scalar types. Brands exist only at compile time, so values
 * remain plain strings and numbers in JSON, storage, and transport.
 */
declare const stringIdBrand: unique symbol;
declare const numericValueBrand: unique symbol;

type BrandedString<Kind extends string> = string & { readonly [stringIdBrand]: Kind };
type BrandedNumber<Kind extends string> = number & { readonly [numericValueBrand]: Kind };

export type SessionId = BrandedString<"SessionId">;
export type EntityId = BrandedString<"EntityId">;
export type ActionId = BrandedString<"ActionId">;
export type AgentActionId = BrandedString<"AgentActionId">;
export type ObservationId = BrandedString<"ObservationId">;
export type CommandId = BrandedString<"CommandId">;
export type EventId = BrandedString<"EventId">;
export type JobId = BrandedString<"JobId">;
export type PluginId = BrandedString<"PluginId">;
export type CapabilityId = BrandedString<"CapabilityId">;

export type StateRevision = BrandedNumber<"StateRevision">;
export type EventSequence = BrandedNumber<"EventSequence">;
