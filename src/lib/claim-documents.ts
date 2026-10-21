import type { ClaimFileRef, ClaimTimelineEvent, Document } from './types'

// The client portal (millionguard.com) and the backoffice (admin.adlerrochefort.com)
// are two Netlify sites, so each one has its own Netlify Blobs store for the
// claim's operational data. A file a client uploads in the portal only lands in
// the portal's blob, never in the backoffice's. Every claim file also has a row
// in the shared Supabase `documents` table (storage path `claims/<claimId>/…`),
// so that row is what both sites merge in to see the same files.

export function claimStoragePrefix(claimId: string) {
  return `claims/${claimId}/`
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function contentTypeFromName(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

/** Adds the claim's files recorded in Supabase that this site's blob does not know about. */
export function mergeClaimDocuments(input: {
  claimId: string
  documents: ClaimFileRef[]
  timeline: ClaimTimelineEvent[]
  dbDocuments: Document[]
}): { documents: ClaimFileRef[]; timeline: ClaimTimelineEvent[] } {
  const prefix = claimStoragePrefix(input.claimId)
  const knownIds = new Set(input.documents.map((d) => d.id))
  const knownPaths = new Set(input.documents.map((d) => d.storagePath))
  const added: ClaimFileRef[] = []

  for (const row of input.dbDocuments) {
    if (!row.storagePath?.startsWith(prefix)) continue
    if (knownIds.has(row.id) || knownPaths.has(row.storagePath)) continue
    const uploadedByName = row.uploadedBy || 'Cliente'
    added.push({
      id: row.id,
      claimId: input.claimId,
      name: row.name,
      contentType: row.mimeType || contentTypeFromName(row.name),
      uploadedAt: row.uploadedAt,
      uploadedByName,
      // Backoffice uploads are always in the backoffice blob, so a row missing
      // there came from the client. The portal only shows the uploader's name.
      uploadedByRole: 'client',
      storagePath: row.storagePath,
      size: Number(row.size || 0),
    })
  }

  if (added.length === 0) return { documents: input.documents, timeline: input.timeline }

  const byDate = (a: { uploadedAt?: string; createdAt?: string }, b: { uploadedAt?: string; createdAt?: string }) =>
    new Date(a.uploadedAt ?? a.createdAt ?? 0).getTime() - new Date(b.uploadedAt ?? b.createdAt ?? 0).getTime()

  const documents = [...input.documents, ...added].sort(byDate)
  const timeline = [
    ...input.timeline,
    ...added.map((doc): ClaimTimelineEvent => ({
      id: `doc_${doc.id}`,
      type: 'document',
      message: `Documento adicionado: ${doc.name}`,
      createdAt: doc.uploadedAt,
      actorName: doc.uploadedByName,
      actorRole: doc.uploadedByRole,
    })),
  ].sort(byDate)

  return { documents, timeline }
}
