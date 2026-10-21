import { supabaseAdmin } from './supabase-admin'
import { findOrphanPaths, type StorageReferences } from './storage-orphans'

const BUCKET = 'documents'
const PAGE = 1000

async function listAllPaths(prefix = ''): Promise<string[]> {
  const paths: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`Could not list storage: ${error.message}`)
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      // Folders come back without an id.
      if (entry.id) paths.push(path)
      else paths.push(...(await listAllPaths(path)))
    }
    if (!data || data.length < PAGE) return paths
  }
}

async function column(table: string, name: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from(table).select(name).not(name, 'is', null)
  if (error) throw new Error(`Could not read ${table}: ${error.message}`)
  return (data ?? []).map((row: any) => String(row[name]))
}

async function loadReferences(): Promise<StorageReferences> {
  const [docPaths, policyPaths, expensePaths, policyIds, clientIds, claimIds] = await Promise.all([
    column('documents', 'storage_path'),
    column('policies', 'storage_path'),
    column('company_expenses', 'file_path'),
    column('policies', 'id'),
    column('individual_clients', 'id'),
    column('claims', 'id'),
  ])
  return {
    paths: new Set([...docPaths, ...policyPaths, ...expensePaths]),
    policyIds: new Set(policyIds),
    clientIds: new Set(clientIds),
    claimIds: new Set(claimIds),
  }
}

export async function listOrphanFiles() {
  const [paths, refs] = await Promise.all([listAllPaths(), loadReferences()])
  const orphans = findOrphanPaths(paths, refs)
  return { totalFiles: paths.length, orphans }
}

// Only deletes paths that are still orphans at the time of the call, so a
// stale list on screen cannot remove a file that was linked in the meantime.
export async function deleteOrphanFiles(requested: string[]) {
  const { orphans } = await listOrphanFiles()
  const allowed = new Set(orphans)
  const toDelete = requested.filter((path) => allowed.has(path))
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100)
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).remove(batch)
    if (error) throw new Error(`Could not delete files: ${error.message}`)
    deleted += data?.length ?? 0
  }
  return { deleted, skipped: requested.length - toDelete.length }
}
