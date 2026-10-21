import { createServerFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { requireRoleMiddleware } from '@/middleware/identity'
import { isExpenseCategory } from './expense-categories'
import { assertExpenseId, validateStartUpload } from './expense-validation'

const MONTH = /^\d{4}-\d{2}-01$/

export const fetchExpenses = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { from?: string; to?: string; category?: string }) => {
    const d = data ?? {}
    if (d.from !== undefined && !MONTH.test(d.from)) throw new Error('Invalid period.')
    if (d.to !== undefined && !MONTH.test(d.to)) throw new Error('Invalid period.')
    if (d.category !== undefined && !isExpenseCategory(d.category)) throw new Error('Invalid category.')
    return { from: d.from, to: d.to, category: d.category }
  })
  .handler(async ({ data }) => {
    const { listExpenses } = await import('./expenses.server')
    return listExpenses(data)
  })

export const fetchExpense = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { id: string }) => ({ id: assertExpenseId(data?.id) }))
  .handler(async ({ data }) => {
    const { getExpense } = await import('./expenses.server')
    return getExpense(data.id)
  })

export const beginExpenseUpload = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator(validateStartUpload)
  .handler(async ({ data, context }) => {
    const { startExpenseUpload } = await import('./expenses.server')
    return startExpenseUpload(data, context.user.id)
  })

export const saveExpense = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { id: string; fields: Record<string, unknown>; confirm?: boolean }) => {
    if (!data || typeof data.fields !== 'object' || data.fields === null || Array.isArray(data.fields)) throw new Error('Invalid data.')
    return { id: assertExpenseId(data.id), fields: data.fields, confirm: data.confirm === true }
  })
  .handler(async ({ data }) => {
    const { updateExpense } = await import('./expenses.server')
    return updateExpense(data.id, data.fields, data.confirm)
  })

export const reopenExpenseFn = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { id: string }) => ({ id: assertExpenseId(data?.id) }))
  .handler(async ({ data }) => {
    const { reopenExpense } = await import('./expenses.server')
    return reopenExpense(data.id)
  })

export const removeExpense = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { id: string }) => ({ id: assertExpenseId(data?.id) }))
  .handler(async ({ data }) => {
    const { deleteExpense } = await import('./expenses.server')
    return deleteExpense(data.id)
  })

export const fetchExpenseFileUrl = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { id: string; download?: boolean }) => ({ id: assertExpenseId(data?.id), download: data?.download === true }))
  .handler(async ({ data }) => {
    const { expenseFileUrl } = await import('./expenses.server')
    return expenseFileUrl(data.id, data.download)
  })

export const createCaptureLinkFn = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { label: string; email?: string | null; expiryDays: number }) => {
    const label = typeof data?.label === 'string' ? data.label.trim() : ''
    if (!label || label.length > 120) throw new Error('Give the link a name (e.g. Hugo phone).')
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Invalid email.')
    if (![30, 90, 365].includes(data.expiryDays)) throw new Error('Invalid validity.')
    return { label, email: email || null, expiryDays: data.expiryDays }
  })
  .handler(async ({ data, context }) => {
    const { createCaptureLink } = await import('./expenses.server')
    return createCaptureLink(data, context.user.id, getRequestUrl().origin)
  })

export const fetchCaptureLinks = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .handler(async () => {
    const { listCaptureLinks } = await import('./expenses.server')
    return listCaptureLinks()
  })

export const revokeCaptureLinkFn = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { id: string }) => ({ id: assertExpenseId(data?.id) }))
  .handler(async ({ data }) => {
    const { revokeCaptureLink } = await import('./expenses.server')
    return revokeCaptureLink(data.id)
  })
