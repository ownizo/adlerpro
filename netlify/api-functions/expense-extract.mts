import type { Config } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { authenticateRequest } from '../lib/policy-auth.mts'
import { expenseExtractionPrompt, parseExtractionReply } from '../../src/lib/expense-extraction.ts'

// Reads an uploaded expense invoice (photo or PDF) with Claude and stores the
// extracted fields on the expense row for review. Admin only.

const BUCKET = 'expenses'
const PRIMARY_MODEL = process.env.EXPENSE_AI_MODEL || 'claude-sonnet-5-5'
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001'
const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function admin() {
  return createClient(process.env.VITE_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function readWithClaude(client: Anthropic, model: string, content: Anthropic.MessageParam['content']) {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  })
  return response.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

export default async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })

  let user
  try {
    user = await authenticateRequest(req)
  } catch (res) {
    if (res instanceof Response) return res
    return Response.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const roles = Array.isArray(user.app_metadata?.roles) ? user.app_metadata.roles : []
  if (!roles.includes('admin')) return Response.json({ error: 'Sem permissão' }, { status: 403 })

  let id = ''
  try {
    const body = await req.json() as { id?: unknown }
    id = typeof body.id === 'string' ? body.id : ''
  } catch { /* handled below */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Despesa inválida' }, { status: 400 })

  const supabase = admin()
  const { data: expense, error: loadError } = await supabase
    .from('company_expenses')
    .select('id, status, file_path, file_mime')
    .eq('id', id)
    .maybeSingle()
  if (loadError || !expense) return Response.json({ error: 'Despesa não encontrada' }, { status: 404 })
  if (expense.status === 'confirmed') return Response.json({ error: 'A despesa já está confirmada' }, { status: 409 })

  const fail = async (message: string, detail: string) => {
    console.error('[expense-extract]', id, detail)
    await supabase.from('company_expenses')
      .update({ status: 'failed', ai_error: detail.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq('id', id).neq('status', 'confirmed')
    return Response.json({ error: message }, { status: 502 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fail('O serviço de IA não está configurado.', 'ANTHROPIC_API_KEY missing')

  await supabase.from('company_expenses')
    .update({ status: 'processing', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id).neq('status', 'confirmed')

  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(expense.file_path)
  if (downloadError || !blob) return fail('Não foi possível ler o ficheiro carregado.', downloadError?.message ?? 'download failed')

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
    return fail('Formato de imagem não suportado pela leitura automática (ex.: HEIC). Preencha os dados manualmente ou carregue em JPG/PDF.', `unsupported mime ${expense.file_mime}`)
  }

  const client = new Anthropic({ apiKey })
  let reply = ''
  let modelUsed = PRIMARY_MODEL
  try {
    reply = await readWithClaude(client, PRIMARY_MODEL, content)
  } catch (error: any) {
    // Fall back when the preferred model is unavailable for this API key.
    if (error?.status === 404 || (error?.status === 400 && /model/i.test(String(error?.message)))) {
      try {
        modelUsed = FALLBACK_MODEL
        reply = await readWithClaude(client, FALLBACK_MODEL, content)
      } catch (fallbackError: any) {
        return fail('A leitura automática falhou. Tente novamente ou preencha manualmente.', String(fallbackError?.message ?? fallbackError))
      }
    } else {
      const busy = /rate.?limit|overloaded/i.test(String(error?.message))
      return fail(busy ? 'O serviço de IA está ocupado. Tente novamente dentro de momentos.' : 'A leitura automática falhou. Tente novamente ou preencha manualmente.', String(error?.message ?? error))
    }
  }

  let parsed
  try {
    parsed = parseExtractionReply(reply)
  } catch (error: any) {
    return fail('Não foi possível interpretar a fatura. Preencha os dados manualmente.', `${error?.message}: ${reply.slice(0, 500)}`)
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('company_expenses')
    .update({
      ...parsed.fields,
      status: 'review',
      ai_extracted: parsed.raw,
      ai_model: modelUsed,
      ai_error: null,
      extracted_at: now,
      updated_at: now,
    })
    .eq('id', id)
    .neq('status', 'confirmed')
    .select('*')
    .maybeSingle()
  if (updateError || !updated) return fail('Não foi possível guardar os dados extraídos.', updateError?.message ?? 'update returned no row')

  return Response.json({ expense: updated })
}

export const config: Config = {
  path: '/api/expense-extract',
}
