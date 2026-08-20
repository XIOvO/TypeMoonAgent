/** Checks exact and caret semver requirements for capability contracts. */
export function isCapabilityVersionCompatible(provided: string, requirement: string | undefined): boolean {
  if (requirement === undefined || requirement === "") return true;
  const actual = parseVersion(provided);
  if (!actual) return false;
  if (!requirement.startsWith("^")) {
    const expected = parseVersion(requirement);
    return expected !== undefined && compare(actual, expected) === 0;
  }
  const minimum = parseVersion(requirement.slice(1));
  if (!minimum || compare(actual, minimum) < 0) return false;
  const upper: Semver = minimum.major > 0
    ? { major: minimum.major + 1, minor: 0, patch: 0 }
    : minimum.minor > 0
      ? { major: 0, minor: minimum.minor + 1, patch: 0 }
      : { major: 0, minor: 0, patch: minimum.patch + 1 };
  return compare(actual, upper) < 0;
}

interface Semver { major: number; minor: number; patch: number; }

function parseVersion(value: string): Semver | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : undefined;
}

function compare(left: Semver, right: Semver): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
