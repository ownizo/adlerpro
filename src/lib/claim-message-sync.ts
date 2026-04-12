import type { ClaimMessage, ClaimOperationalData, ClaimTicketMessage } from './types'

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function sortByCreatedAt<T extends { createdAt: string; id: string }>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (timeDiff !== 0) return timeDiff
      return a.id.localeCompare(b.id)
    })
}

function claimMessageKey(input: {
  senderRole: 'admin' | 'client'
  senderName: string
  body: string
  createdAt: string
}) {
  return [
    input.senderRole,
    normalizeText(input.senderName),
    normalizeText(input.body),
    input.createdAt,
  ].join('::')
}

export function claimMessageToTicketMessage(message: ClaimMessage): ClaimTicketMessage {
  return {
    id: message.id,
    body: message.message,
    createdAt: message.createdAt,
    senderRole: message.senderType,
    senderName: message.senderName,
  }
}

export function claimTicketMessageToClaimMessage(
  message: ClaimTicketMessage,
  claimId: string,
  companyId?: string,
  individualClientId?: string,
): ClaimMessage {
  return {
    id: message.id,
    claimId,
    companyId,
    individualClientId,
    senderType: message.senderRole,
    senderName: message.senderName,
    message: message.body,
    createdAt: message.createdAt,
    // Client-authored messages are already "read" from the client perspective.
    readAt: message.senderRole === 'client' ? message.createdAt : null,
  }
}

export function mergeClaimMessages(params: {
  claimId: string
  companyId?: string
  individualClientId?: string
  legacyMessages: ClaimMessage[]
  ticketMessages: ClaimTicketMessage[]
}): ClaimMessage[] {
  const merged = new Map<string, ClaimMessage>()

  for (const message of params.ticketMessages) {
    const asLegacy = claimTicketMessageToClaimMessage(message, params.claimId, params.companyId, params.individualClientId)
    merged.set(
      claimMessageKey({
        senderRole: asLegacy.senderType,
        senderName: asLegacy.senderName,
        body: asLegacy.message,
        createdAt: asLegacy.createdAt,
      }),
      asLegacy,
    )
  }

  for (const message of params.legacyMessages) {
    merged.set(
      claimMessageKey({
        senderRole: message.senderType,
        senderName: message.senderName,
        body: message.message,
        createdAt: message.createdAt,
      }),
      message,
    )
  }

  return sortByCreatedAt(Array.from(merged.values()))
}

export function mergeClaimTicketMessages(params: {
  legacyMessages: ClaimMessage[]
  ticketMessages: ClaimTicketMessage[]
}): ClaimTicketMessage[] {
  const merged = new Map<string, ClaimTicketMessage>()

  for (const message of params.legacyMessages) {
    const asTicket = claimMessageToTicketMessage(message)
    merged.set(
      claimMessageKey({
        senderRole: asTicket.senderRole,
        senderName: asTicket.senderName,
        body: asTicket.body,
        createdAt: asTicket.createdAt,
      }),
      asTicket,
    )
  }

  for (const message of params.ticketMessages) {
    merged.set(
      claimMessageKey({
        senderRole: message.senderRole,
        senderName: message.senderName,
        body: message.body,
        createdAt: message.createdAt,
      }),
      message,
    )
  }

  return sortByCreatedAt(Array.from(merged.values()))
}

export function mergeClaimOperationalMessages(
  ops: ClaimOperationalData,
  legacyMessages: ClaimMessage[],
): ClaimOperationalData {
  const mergedMessages = mergeClaimTicketMessages({
    legacyMessages,
    ticketMessages: ops.messages,
  })

  const lastMessageAt = mergedMessages[mergedMessages.length - 1]?.createdAt
  const updatedAt = [ops.updatedAt, lastMessageAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .at(-1) ?? ops.updatedAt

  return {
    ...ops,
    messages: mergedMessages,
    updatedAt,
  }
}
