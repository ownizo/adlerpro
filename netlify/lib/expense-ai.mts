import Anthropic from '@anthropic-ai/sdk'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expenseExtractionPrompt, parseExtractionReply } from '../../src/lib/expense-extraction.ts'
import { expenseWarnings } from '../../src/lib/expense-validation.ts'

// Shared invoice reading for the admin upload and the phone capture link.

export const EXPENSE_BUCKET = 'expenses'
const PRIMARY_MODEL = process.env.EXPENSE_AI_MODEL || 'claude-sonnet-5-5'
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001'
const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export function expenseAdminClient(): SupabaseClient {
  return createClient(process.env.VITE_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function readWithClaude(client: Anthropic, model: string, content: Anthropic.MessageParam['content']) {
  const response = await client.messages.create({ model, max_tokens: 4096, messages: [{ role: 'user', content }] })
  return response.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

export type ExtractionResult =
  | { ok: true; expense: Record<string, any> }
  | { ok: false; status: number; error: string }

/**
 * Reads the stored invoice for `id` with Claude and saves the fields.
 * With `autoConfirm`, a clean reading (total, date, consistent amounts, valid
 * NIF) is confirmed straight away; anything doubtful stays "Por rever".
 */
export async function extractExpense(supabase: SupabaseClient, id: string, options: { autoConfirm?: boolean } = {}): Promise<ExtractionResult> {
  const { data: expense, error: loadError } = await supabase
    .from('company_expenses').select('id, status, file_path, file_mime').eq('id', id).maybeSingle()
  if (loadError || !expense) return { ok: false, status: 404, error: 'Despesa não encontrada.' }
  if (expense.status === 'confirmed') return { ok: false, status: 409, error: 'A despesa já está confirmada.' }

  const fail = async (status: number, message: string, detail: string): Promise<ExtractionResult> => {
    console.error('[expense-ai]', id, detail)
    await supabase.from('company_expenses')
      .update({ status: 'failed', ai_error: detail.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', id).neq('status', 'confirmed')
    return { ok: false, status, error: message }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fail(500, 'O serviço de IA não está configurado.', 'ANTHROPIC_API_KEY missing')

  await supabase.from('company_expenses')
    .update({ status: 'processing', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id).neq('status', 'confirmed')

  const { data: blob, error: downloadError } = await supabase.storage.from(EXPENSE_BUCKET).download(expense.file_path)
  if (downloadError || !blob) return fail(502, 'Não foi possível ler o ficheiro enviado.', downloadError?.message ?? 'download failed')

  const bytes = Buffer.from(await blob.arrayBuffer())
  const base64 = bytes.toString('base64')
  const isPdf = expense.file_mime === 'application/pdf' || bytes.subarray(0, 4).toString('latin1') === '%PDF'
  const prompt = expenseExtractionPrompt()

  let content: Anthropic.MessageParam['content']
  if (isPdf) {
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: prompt },
    ]
  } else if (CLAUDE_IMAGE_TYPES.has(expense.file_mime)) {
    content = [
      { type: 'image', source: { type: 'base64', media_type: expense.file_mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: base64 } },
      { type: 'text', text: prompt },
    ]
  } else {
    return fail(415, 'Formato de imagem não suportado pela leitura automática. Use JPG ou PDF.', `unsupported mime ${expense.file_mime}`)
  }

  const client = new Anthropic({ apiKey })
  let reply = ''
  let modelUsed = PRIMARY_MODEL
  try {
    reply = await readWithClaude(client, PRIMARY_MODEL, content)
  } catch (error: any) {
    if (error?.status === 404 || (error?.status === 400 && /model/i.test(String(error?.message)))) {
      try {
        modelUsed = FALLBACK_MODEL
        reply = await readWithClaude(client, FALLBACK_MODEL, content)
      } catch (fallbackError: any) {
        return fail(502, 'A leitura automática falhou. Tente novamente.', String(fallbackError?.message ?? fallbackError))
      }
    } else {
      const busy = /rate.?limit|overloaded/i.test(String(error?.message))
      return fail(502, busy ? 'O serviço de IA está ocupado. Tente novamente dentro de momentos.' : 'A leitura automática falhou. Tente novamente.', String(error?.message ?? error))
    }
  }

  let parsed
  try {
    parsed = parseExtractionReply(reply)
  } catch (error: any) {
    return fail(422, 'Não foi possível interpretar a fatura.', `${error?.message}: ${reply.slice(0, 500)}`)
  }

  const fields = parsed.fields
  const clean = options.autoConfirm === true && expenseWarnings({
    net_amount: fields.net_amount ?? null,
    vat_amount: fields.vat_amount ?? null,
    total_amount: fields.total_amount ?? null,
    invoice_date: fields.invoice_date ?? null,
    supplier_nif: fields.supplier_nif ?? null,
    reference_month: fields.reference_month ?? null,
  }).length === 0 && !!fields.supplier_name

  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('company_expenses')
    .update({
      ...fields,
      status: clean ? 'confirmed' : 'review',
      confirmed_at: clean ? now : null,
      ai_extracted: parsed.raw,
      ai_model: modelUsed,
      ai_error: null,
      extracted_at: now,
      updated_at: now,
    })
    .eq('id', id).neq('status', 'confirmed')
    .select('*').maybeSingle()
  if (updateError || !updated) return fail(500, 'Não foi possível guardar os dados extraídos.', updateError?.message ?? 'update returned no row')
  return { ok: true, expense: updated }
}
