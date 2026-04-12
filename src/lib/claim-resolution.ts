import type { Claim, ClaimStatus } from './types'

const ACTIVE_CLAIM_STATUSES = new Set<ClaimStatus>([
  'submitted',
  'under_review',
  'documentation',
  'assessment',
  'approved',
])

function claimTimestamp(claim: Claim) {
  return (
    new Date(claim.createdAt || claim.claimDate || claim.incidentDate).getTime()
    || new Date(claim.claimDate || claim.incidentDate).getTime()
    || 0
  )
}

export function isActiveClaim(claim: Claim) {
  return ACTIVE_CLAIM_STATUSES.has(claim.status)
}

export function sortClaimsByRecency(claims: Claim[]) {
  return claims
    .slice()
    .sort((a, b) => {
      const diff = claimTimestamp(b) - claimTimestamp(a)
      if (diff !== 0) return diff
      return b.id.localeCompare(a.id)
    })
}

export function selectPreferredClaimForPolicy(claims: Claim[]) {
  const activeClaims = claims.filter(isActiveClaim)
  const pool = activeClaims.length > 0 ? activeClaims : claims
  return sortClaimsByRecency(pool)[0]
}

export function normalizeClaimsByPolicy(claims: Claim[]) {
  const withPolicy = new Map<string, Claim[]>()
  const withoutPolicy: Claim[] = []

  for (const claim of claims) {
    if (!claim.policyId) {
      withoutPolicy.push(claim)
      continue
    }

    const group = withPolicy.get(claim.policyId)
    if (group) group.push(claim)
    else withPolicy.set(claim.policyId, [claim])
  }

  const normalized = [
    ...withoutPolicy,
    ...Array.from(withPolicy.values())
      .map((group) => selectPreferredClaimForPolicy(group))
      .filter((claim): claim is Claim => Boolean(claim)),
  ]

  return sortClaimsByRecency(normalized)
}
