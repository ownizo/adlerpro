import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const policyDocuments = pgTable(
  'policy_documents',
  {
    id: text('id').primaryKey(),
    policyId: text('policy_id').notNull(),
    companyId: text('company_id'),
    individualClientId: text('individual_client_id'),
    uploadedByUserId: text('uploaded_by_user_id').notNull(),
    blobKey: text('blob_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('policy_documents_policy_id_idx').on(table.policyId)],
)
