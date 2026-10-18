import type { Config } from '@netlify/functions'
import { verifyAccessToken } from '../../src/lib/crm-agent/oauth.ts'
import { CRM_TOOLS, CRM_INSTRUCTIONS } from '../../src/lib/crm-agent/tools.ts'
import { ToolError } from '../../src/lib/crm-agent/core.ts'

// MCP server (Streamable HTTP, stateless JSON responses) that lets Claude
// work inside the CRM. Auth: OAuth access token issued by /oauth/token.

export const config: Config = { path: '/api/mcp' }

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
}

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const toolByName = new Map(CRM_TOOLS.map((t) => [t.name, t]))

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } })
}

function unauthorized(req: Request) {
  const base = `https://${new URL(req.url).host}`
  return json({ error: 'unauthorized' }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp", scope="crm"`,
  })
}

async function handle(msg: RpcRequest): Promise<unknown | undefined> {
  const id = msg.id ?? null
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

  if (msg.id === undefined || msg.method.startsWith('notifications/')) return undefined

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '')
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'adler-rochefort-crm', title: 'Adler & Rochefort CRM', version: '1.0.0' },
        instructions: CRM_INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({
        tools: CRM_TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false },
        })),
      })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const tool = toolByName.get(name)
      if (!tool) return fail(-32602, `Unknown tool: ${name}`)
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const result = await tool.handler(args)
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] })
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Erro interno: ${err instanceof Error ? err.message : String(err)}`
        if (!(err instanceof ToolError)) console.error(`mcp tool ${name} failed`, err)
        return ok({ content: [{ type: 'text', text: message }], isError: true })
      }
    }
    case 'resources/list':
      return ok({ resources: [] })
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] })
    case 'prompts/list':
      return ok({ prompts: [] })
    default:
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token || !(await verifyAccessToken(token))) return unauthorized(req)

  if (req.method === 'GET') return json({ error: 'SSE stream not supported; use POST' }, 405, { Allow: 'POST' })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' })

  let body: unknown
  try { body = await req.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as RpcRequest)))).filter((r) => r !== undefined)
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS })
  }
  const res = await handle(body as RpcRequest)
  if (res === undefined) return new Response(null, { status: 202, headers: CORS })
  return json(res)
}
