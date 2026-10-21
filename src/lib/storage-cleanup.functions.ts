import { createServerFn } from '@tanstack/react-start'
import { requireRoleMiddleware } from '@/middleware/identity'

export const adminListOrphanFiles = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .handler(async () => {
    const { listOrphanFiles } = await import('./storage-cleanup.server')
    return listOrphanFiles()
  })

export const adminDeleteOrphanFiles = createServerFn({ method: 'POST' })
  .middleware([requireRoleMiddleware('admin')])
  .inputValidator((data: { paths: string[] }) => {
    if (!Array.isArray(data?.paths) || data.paths.some((p) => typeof p !== 'string')) throw new Error('Invalid file list.')
    if (data.paths.length > 5000) throw new Error('Too many files in one request.')
    return { paths: data.paths }
  })
  .handler(async ({ data }) => {
    const { deleteOrphanFiles } = await import('./storage-cleanup.server')
    return deleteOrphanFiles(data.paths)
  })
