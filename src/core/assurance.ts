/**
 * World ID Agent Pass assurance classes (`acr` claim values) and the tiers the
 * policy engine asks for. Source: auth.world.org/docs/guides/step-up.
 *
 * Tiers are ordered: fresh < human < strong. Each tier maps to the exact set
 * of `acr` values we accept; `null` means "fresh authentication of any kind".
 */

export const ACR = {
  orb: "https://world.org/oidc/acr/orb",
  selfie: "https://world.org/oidc/acr/selfie",
  orbFace: "https://world.org/oidc/acr/orb-face",
  selfieFace: "https://world.org/oidc/acr/selfie-face",
} as const;

export type AcrValue = (typeof ACR)[keyof typeof ACR];

export const ASSURANCE_TIERS = ["fresh", "human", "strong"] as const;
export type AssuranceTier = (typeof ASSURANCE_TIERS)[number];

export type AcrRequirements = Record<AssuranceTier, readonly AcrValue[] | null>;

export const DEFAULT_ACR_REQUIREMENTS: AcrRequirements = {
  // Any fresh login (passkey or World ID proof); freshness is enforced via max_age=0.
  fresh: null,
  human: [ACR.selfie, ACR.selfieFace, ACR.orb, ACR.orbFace],
  strong: [ACR.orbFace],
};

export function tierRank(tier: AssuranceTier): number {
  return ASSURANCE_TIERS.indexOf(tier);
}

export function strongerTier(
  a: AssuranceTier,
  b: AssuranceTier,
): AssuranceTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/**
 * The OIDC `claims` request parameter for a tier, or undefined when the tier
 * places no constraint on `acr`.
 */
export function acrClaimsParam(
  tier: AssuranceTier,
  requirements: AcrRequirements = DEFAULT_ACR_REQUIREMENTS,
): string | undefined {
  const values = requirements[tier];
  if (values === null) return undefined;
  return JSON.stringify({ id_token: { acr: { essential: true, values } } });
}
