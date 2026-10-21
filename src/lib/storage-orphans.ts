// Decides which files in the `documents` bucket are no longer linked to any
// record. Kept free of I/O so the rule can be tested on its own.

export type StorageReferences = {
  paths: Set<string> // storage_path / file_path values stored on rows
  policyIds: Set<string>
  clientIds: Set<string>
  claimIds: Set<string>
}

export function isLinkedPath(path: string, refs: StorageReferences): boolean {
  if (refs.paths.has(path)) return true
  const parts = path.split('/')
  // {owner}/policies/{policyId}/file and {owner}/claims/{claimId}/file
  if (parts.length >= 4 && parts[1] === 'policies') return refs.policyIds.has(parts[2])
  if (parts.length >= 4 && parts[1] === 'claims') return refs.claimIds.has(parts[2])
  // claims/{claimId}/file
  if (parts.length >= 3 && parts[0] === 'claims') return refs.claimIds.has(parts[1])
  // individual/{clientId}/file
  if (parts.length >= 3 && parts[0] === 'individual') return refs.clientIds.has(parts[1])
  return false
}

export function findOrphanPaths(paths: string[], refs: StorageReferences): string[] {
  return paths.filter((path) => !path.endsWith('.emptyFolderPlaceholder') && !isLinkedPath(path, refs))
}
