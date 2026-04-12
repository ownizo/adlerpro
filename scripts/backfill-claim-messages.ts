import * as db from '../src/lib/data.ts'
import { getClaimOperationalData } from '../src/lib/claim-ops.ts'
import { mergeClaimMessages } from '../src/lib/claim-message-sync.ts'

function claimMessageIdentity(message: {
  senderType: 'admin' | 'client'
  senderName: string
  message: string
  createdAt: string
}) {
  return [
    message.senderType,
    message.senderName.trim().replace(/\s+/g, ' '),
    message.message.trim().replace(/\s+/g, ' '),
    message.createdAt,
  ].join('::')
}

async function main() {
  const claims = await db.getClaims()
  let inserted = 0

  for (const claim of claims) {
    const [storedMessages, ops] = await Promise.all([
      db.getClaimMessages(claim.id),
      getClaimOperationalData(claim.id),
    ])

    const merged = mergeClaimMessages({
      claimId: claim.id,
      companyId: claim.companyId,
      individualClientId: claim.individualClientId,
      legacyMessages: storedMessages,
      ticketMessages: ops.messages,
    })

    const existingKeys = new Set(storedMessages.map((message) => claimMessageIdentity(message)))

    for (const message of merged) {
      const key = claimMessageIdentity(message)
      if (existingKeys.has(key)) continue

      await db.createClaimMessage({
        ...message,
        id: message.id,
        claimId: claim.id,
        companyId: claim.companyId,
        individualClientId: claim.individualClientId,
      })
      existingKeys.add(key)
      inserted += 1
    }
  }

  console.log(`Backfill finished. Inserted ${inserted} missing claim_messages row(s).`)
}

main().catch((error) => {
  console.error('[backfill-claim-messages] failed:', error)
  process.exitCode = 1
})
