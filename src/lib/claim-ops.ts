import { getStore } from '@netlify/blobs'
import type {
  ClaimOperationalData,
  ClaimParticipant,
  ClaimTimelineEvent,
  ClaimMessage,
  ClaimFileRef,
  ClaimTeamNote,
} from './types'

const CLAIM_OPS_STORE = getStore({ name: 'claim-ops', consistency: 'strong' })

function keyForClaim(claimId: string) {
  return `claims/${claimId}.json`
}

function defaultOperationalData(claimId: string): ClaimOperationalData {
  return {
    claimId,
    timeline: [],
    teamNotes: [],
    messages: [],
    documents: [],
    updatedAt: new Date().toISOString(),
  }
}

function normalizeParticipant(value: unknown): ClaimParticipant | undefined {
  if (!value || typeof value !== 'object') return undefined
  const src = value as Partial<ClaimParticipant>
  if (!src.id || !src.name || !src.role) return undefined
  if (src.role !== 'admin' && src.role !== 'client') return undefined
  return {
    id: String(src.id),
    name: String(src.name),
    role: src.role,
    email: typeof src.email === 'string' ? src.email : undefined,
  }
}

function normalizeTimeline(items: unknown): ClaimTimelineEvent[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const src = item as Partial<ClaimTimelineEvent>
      if (!src?.id || !src?.type || !src?.message || !src?.createdAt || !src?.actorName || !src?.actorRole) return null
      return {
        id: String(src.id),
        type: src.type,
        message: String(src.message),
        createdAt: String(src.createdAt),
        actorName: String(src.actorName),
        actorRole: src.actorRole,
      } as ClaimTimelineEvent
    })
    .filter((item): item is ClaimTimelineEvent => Boolean(item))
}

function normalizeNotes(items: unknown): ClaimTeamNote[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const src = item as Partial<ClaimTeamNote>
      if (!src?.id || !src?.note || !src?.createdAt || !src?.authorName) return null
      return {
        id: String(src.id),
        note: String(src.note),
        createdAt: String(src.createdAt),
        authorName: String(src.authorName),
      }
    })
    .filter((item): item is ClaimTeamNote => Boolean(item))
}

function normalizeMessages(items: unknown): ClaimMessage[] {
  if (!Array.isArray(items)) return []
  const out: ClaimMessage[] = []
  for (const item of items) {
    const src = item as Partial<ClaimMessage>
    if (!src?.id || !src?.body || !src?.createdAt || !src?.senderName || !src?.senderRole) continue
    if (src.senderRole !== 'admin' && src.senderRole !== 'client') continue
    out.push({
      id: String(src.id),
      body: String(src.body),
      createdAt: String(src.createdAt),
      senderName: String(src.senderName),
      senderRole: src.senderRole,
      senderEmail: typeof src.senderEmail === 'string' ? src.senderEmail : undefined,
    })
  }
  return out
}

function normalizeDocuments(items: unknown): ClaimFileRef[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      const src = item as Partial<ClaimFileRef>
      if (!src?.id || !src?.claimId || !src?.name || !src?.contentType || !src?.uploadedAt || !src?.uploadedByName || !src?.uploadedByRole || !src?.storagePath) {
        return null
      }
      if (src.uploadedByRole !== 'admin' && src.uploadedByRole !== 'client') return null
      return {
        id: String(src.id),
        claimId: String(src.claimId),
        name: String(src.name),
        contentType: String(src.contentType),
        uploadedAt: String(src.uploadedAt),
        uploadedByName: String(src.uploadedByName),
        uploadedByRole: src.uploadedByRole,
        storagePath: String(src.storagePath),
        size: Number(src.size ?? 0),
      }
    })
    .filter((item): item is ClaimFileRef => Boolean(item))
}

function normalizeOperationalData(claimId: string, value: unknown): ClaimOperationalData {
  if (!value || typeof value !== 'object') return defaultOperationalData(claimId)
  const src = value as Partial<ClaimOperationalData>
  return {
    claimId,
    responsible: normalizeParticipant(src.responsible),
    timeline: normalizeTimeline(src.timeline),
    teamNotes: normalizeNotes(src.teamNotes),
    messages: normalizeMessages(src.messages),
    documents: normalizeDocuments(src.documents),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : new Date().toISOString(),
  }
}

export async function getClaimOperationalData(claimId: string): Promise<ClaimOperationalData> {
  const raw = await CLAIM_OPS_STORE.get(keyForClaim(claimId), { type: 'json' })
  return normalizeOperationalData(claimId, raw)
}

export async function saveClaimOperationalData(data: ClaimOperationalData): Promise<void> {
  await CLAIM_OPS_STORE.setJSON(keyForClaim(data.claimId), {
    ...data,
    updatedAt: new Date().toISOString(),
  })
}

export async function updateClaimOperationalData(
  claimId: string,
  updater: (current: ClaimOperationalData) => ClaimOperationalData | Promise<ClaimOperationalData>,
): Promise<ClaimOperationalData> {
  const current = await getClaimOperationalData(claimId)
  const updated = await updater(current)
  const normalized = normalizeOperationalData(claimId, {
    ...updated,
    claimId,
    updatedAt: new Date().toISOString(),
  })
  await saveClaimOperationalData(normalized)
  return normalized
}

export async function getClaimOperationalSummaryMap(claimIds: string[]) {
  const summary: Record<string, {
    responsibleName?: string
    messagesCount: number
    documentsCount: number
    lastMessageAt?: string
    updatedAt?: string
  }> = {}

  await Promise.all(
    claimIds.map(async (claimId) => {
      const ops = await getClaimOperationalData(claimId)
      const lastMessage = ops.messages[ops.messages.length - 1]
      summary[claimId] = {
        responsibleName: ops.responsible?.name,
        messagesCount: ops.messages.length,
        documentsCount: ops.documents.length,
        lastMessageAt: lastMessage?.createdAt,
        updatedAt: ops.updatedAt,
      }
    }),
  )

  return summary
}
