import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'
import { isExpenseCategory } from './expense-categories'
import { assertExpenseId, validateStartUpload } from './expense-validation'

const MONTH = /^\d{4}-\d{2}-01$/

export const fetchExpenses = createServerFn({ method: 'GET' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { from?: string; to?: string; category?: string }) => {
    const d = data ?? {}
    if (d.from !== undefined && !MONTH.test(d.from)) throw new Error('Período inválido.')
    if (d.to !== undefined && !MONTH.test(d.to)) throw new Error('Período inválido.')
    if (d.category !== undefined && !isExpenseCategory(d.category)) throw new Error('Categoria inválida.')
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
    if (!data || typeof data.fields !== 'object' || data.fields === null || Array.isArray(data.fields)) throw new Error('Dados inválidos.')
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
