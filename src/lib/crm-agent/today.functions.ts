import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'

// "Hoje" screen: the same brief Claude gets from today_overview, plus the
// small actions Hugo does by hand (complete, postpone, quick-add).

export const fetchToday = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .handler(async () => {
    const { CRM_TOOLS } = await import('./tools')
    const tool = CRM_TOOLS.find((t) => t.name === 'today_overview')!
    return (await tool.handler({ lead_hours: 72, renewal_days: 60 })) as TodayData
  })

export const setTodayTask = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { id: string; status?: 'pending' | 'done'; due_date?: string }) => {
    if (typeof d?.id !== 'string' || d.id.length > 64) throw new Error('id inválido')
    if (d.status && d.status !== 'pending' && d.status !== 'done') throw new Error('estado inválido')
    if (d.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.due_date)) throw new Error('data inválida')
    return { id: d.id, status: d.status, due_date: d.due_date }
  })
  .handler(async ({ data }) => {
    const { sb, logActivity } = await import('./core')
    const fields: Record<string, unknown> = {}
    if (data.status) { fields.status = data.status; fields.done_at = data.status === 'done' ? new Date().toISOString() : null }
    if (data.due_date) fields.due_date = data.due_date
    const { data: row, error } = await sb().from('client_tasks').update(fields).eq('id', data.id).select('title').single()
    if (error) throw new Error(error.message)
    await logActivity('hugo', data.status === 'done' ? 'complete_task' : 'update_task', 'client_task', data.id, String(row?.title ?? ''))
    return { ok: true }
  })

export const quickAddTask = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((d: { title: string; due_date?: string; priority?: number }) => {
    const title = typeof d?.title === 'string' ? d.title.trim().slice(0, 200) : ''
    if (!title) throw new Error('Escreva a tarefa.')
    const due = d.due_date && /^\d{4}-\d{2}-\d{2}$/.test(d.due_date) ? d.due_date : undefined
    const priority = d.priority === 1 || d.priority === 3 ? d.priority : 2
    return { title, due_date: due, priority }
  })
  .handler(async ({ data }) => {
    const { sb, lisbonDate, logActivity } = await import('./core')
    const id = crypto.randomUUID()
    const { error } = await sb().from('client_tasks').insert({
      id, title: data.title, due_date: data.due_date ?? lisbonDate(), status: 'pending', source: 'manual', priority: data.priority, created_by: 'hugo',
    })
    if (error) throw new Error(error.message)
    await logActivity('hugo', 'create_task', 'client_task', id, data.title)
    return { id }
  })

type Row = { [key: string]: string | number | boolean | null | undefined; client?: string | null }
export type TodayData = {
  today: string
  tasks: { overdue: Row[]; today: Row[]; next_3_days: Row[] }
  new_leads: Row[]
  opportunities_not_contacted: Row[]
  follow_ups_due: Row[]
  renewals: Row[]
  emails_awaiting_reply: Row[]
  expenses_to_review: number
  pipeline_open_count: number
}
