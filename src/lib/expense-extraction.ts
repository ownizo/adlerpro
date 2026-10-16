import { EXPENSE_CATEGORIES } from './expense-categories.ts'
import { completeExpenseFields, normaliseExpenseFields, type ExpenseFields } from './expense-validation.ts'

export const EXPENSE_COMPANY = {
  name: 'Ownizo, Unipessoal Lda. (Adler & Rochefort)',
}

export function expenseExtractionPrompt(): string {
  const categories = EXPENSE_CATEGORIES
    .map((c) => `- ${c.key}: ${c.label} — ${c.hint}`)
    .join('\n')
  return `You are reading a supplier invoice, receipt or simplified invoice (fatura, fatura-recibo, fatura simplificada, recibo) issued to a Portuguese company, ${EXPENSE_COMPANY.name}. The document may be a phone photo (possibly skewed or partially blurred) or a PDF, and is usually in Portuguese.

Extract the data and reply with ONLY one JSON object, no markdown fences, with exactly these keys:
{
  "supplier_name": "issuer / seller company name",
  "supplier_nif": "issuer VAT number (NIF/NIPC), digits only for Portuguese numbers",
  "buyer_nif": "customer NIF printed on the document, or null",
  "document_type": "e.g. Fatura, Fatura-Recibo, Fatura Simplificada, Recibo, Nota de Crédito",
  "invoice_number": "document number exactly as printed (e.g. FT 2026A/1234)",
  "atcud": "ATCUD code if printed, or null",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "currency": "ISO code, normally EUR",
  "net_amount": 0.00,
  "vat_amount": 0.00,
  "total_amount": 0.00,
  "vat_lines": [{"rate": 23, "base": 0.00, "vat": 0.00}],
  "line_items": [{"description": "item", "quantity": 1, "total": 0.00}],
  "payment_method": "e.g. Multibanco, MB WAY, Cartão, Transferência, Numerário, or null",
  "description": "short Portuguese summary of what was bought (max 120 characters)",
  "category": "one key from the list below"
}

Category keys:
${categories}

Rules:
- Amounts are numbers with a dot as the decimal separator (convert 1.234,56 to 1234.56). Never invent amounts; use null when not visible.
- net_amount is the taxable base (sem IVA), vat_amount the total VAT, total_amount the amount payable (com IVA).
- Portuguese VAT rates are 23%, 13% and 6% on the mainland; 22/16/5% in Madeira and 16/9/4% in the Azores. Use 0 for exempt lines ("isento", "M07", etc.).
- For a credit note (Nota de Crédito) return the amounts as positive numbers; the document_type identifies it.
- Dates on Portuguese documents are usually DD-MM-YYYY or DD/MM/YYYY; convert to YYYY-MM-DD.
- Office supplies such as toner, ink, paper → material_escritorio. Office chairs, desks, computers, monitors, printers → mobiliario_equipamento.
- Use null for anything you cannot read with reasonable confidence.`
}

/** Extracts the first JSON object from a model reply and normalises it. */
export function parseExtractionReply(reply: string): { fields: ExpenseFields; raw: Record<string, unknown> } {
  const match = reply.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('A resposta da IA não contém JSON.')
  const raw = JSON.parse(match[0]) as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  // Normalise field by field so one unreadable value never discards the rest.
  for (const [key, value] of Object.entries(raw)) {
    try {
      Object.assign(safe, normaliseExpenseFields({ [key]: value }))
    } catch {
      // Ignore invalid individual values (e.g. an unknown category).
    }
  }
  const fields = completeExpenseFields(safe as ExpenseFields)
  if (!fields.category) fields.category = 'outros'
  return { fields, raw }
}
