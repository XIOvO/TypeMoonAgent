import type { CifContextTag } from "./context-tags.js";
import { CORE_IDENTITY_SECTIONS, identitySectionsForContextTags, uniqueIdentitySections } from "./identity-sections.js";
import type { IdentityModel, IdentitySection } from "./types.js";

export interface CharacterIdentityRequest {
  sessionId: string;
  characterId: string;
  sections?: readonly IdentitySection[];
  contextTags?: readonly CifContextTag[];
}

export interface CharacterIdentityReader {
  listIdentity(sessionId: string, characterId: string, sections?: readonly IdentitySection[]): IdentityModel[];
}

/** Public read-only identity capability; identity selection is driven by known context tags. */
export interface CharacterIdentityProvider {
  getIdentity(request: CharacterIdentityRequest): Promise<readonly IdentityModel[]>;
}

export class ReaderCharacterIdentityProvider implements CharacterIdentityProvider {
  public constructor(private readonly reader: CharacterIdentityReader) {}

  public async getIdentity(request: CharacterIdentityRequest): Promise<readonly IdentityModel[]> {
    const sections = uniqueIdentitySections([
      ...(request.sections ?? CORE_IDENTITY_SECTIONS),
      ...identitySectionsForContextTags(request.contextTags ?? []),
    ]);
    return this.reader.listIdentity(request.sessionId, request.characterId, sections);
  }
}
