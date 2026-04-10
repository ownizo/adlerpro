import test from 'node:test'
import assert from 'node:assert/strict'

import {
  claimMessageToTicketMessage,
  claimTicketMessageToClaimMessage,
  mergeClaimMessages,
  mergeClaimOperationalMessages,
} from './claim-message-sync.ts'
import type { ClaimMessage, ClaimOperationalData, ClaimTicketMessage } from './types'

test('mergeClaimMessages deduplicates mirrored legacy and operational entries', () => {
  const legacy: ClaimMessage = {
    id: 'legacy-1',
    claimId: 'clm_1',
    companyId: 'cmp_1',
    senderType: 'admin',
    senderName: 'Admin',
    senderUserId: 'usr_1',
    message: 'Precisamos do orçamento do reparador.',
    createdAt: '2026-04-10T10:00:00.000Z',
    readAt: null,
  }

  const ticket: ClaimTicketMessage = {
    id: 'ops-1',
    senderRole: 'admin',
    senderName: 'Admin',
    body: 'Precisamos do orçamento do reparador.',
    createdAt: '2026-04-10T10:00:00.000Z',
  }

  const merged = mergeClaimMessages({
    claimId: 'clm_1',
    companyId: 'cmp_1',
    legacyMessages: [legacy],
    ticketMessages: [ticket],
  })

  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.id, 'legacy-1')
  assert.equal(merged[0]?.message, legacy.message)
})

test('mergeClaimOperationalMessages keeps old legacy history visible in workspace order', () => {
  const legacy: ClaimMessage = {
    id: 'legacy-older',
    claimId: 'clm_1',
    companyId: 'cmp_1',
    senderType: 'client',
    senderName: 'Cliente',
    message: 'Já anexei a fotografia.',
    createdAt: '2026-04-09T08:00:00.000Z',
    readAt: '2026-04-09T08:00:00.000Z',
  }

  const ops: ClaimOperationalData = {
    claimId: 'clm_1',
    timeline: [],
    teamNotes: [],
    documents: [],
    updatedAt: '2026-04-10T10:00:00.000Z',
    messages: [
      {
        id: 'ops-newer',
        senderRole: 'admin',
        senderName: 'Admin',
        body: 'Recebido. Vamos avançar com a peritagem.',
        createdAt: '2026-04-10T10:00:00.000Z',
      },
    ],
  }

  const merged = mergeClaimOperationalMessages(ops, [legacy])

  assert.equal(merged.messages.length, 2)
  assert.deepEqual(
    merged.messages.map((item) => item.body),
    ['Já anexei a fotografia.', 'Recebido. Vamos avançar com a peritagem.'],
  )
  assert.equal(merged.updatedAt, '2026-04-10T10:00:00.000Z')
})

test('message conversion preserves sender role and canonical fields', () => {
  const ticket = claimMessageToTicketMessage({
    id: 'legacy-2',
    claimId: 'clm_2',
    companyId: 'cmp_2',
    senderType: 'client',
    senderName: 'Ana Cliente',
    senderUserId: 'usr_client',
    message: 'Segue atualização.',
    createdAt: '2026-04-10T12:00:00.000Z',
    readAt: '2026-04-10T12:00:00.000Z',
  })

  const legacy = claimTicketMessageToClaimMessage(ticket, 'clm_2', 'cmp_2')

  assert.equal(ticket.senderRole, 'client')
  assert.equal(legacy.senderType, 'client')
  assert.equal(legacy.message, 'Segue atualização.')
  assert.equal(legacy.claimId, 'clm_2')
})
