import { useEffect, useState } from 'react'
import type { ClientTask, Company, IndividualClient, SalesOpportunity } from '@/lib/types'
import { fetchAllTasksByDueDate, adminUpdateClientTaskStatus, adminGenerateRenewalTasks, fetchSalesOpportunity } from '@/lib/server-fns'
import { completeTasksBulk } from '@/lib/crm-agent/today.functions'
import { formatDate } from '@/lib/utils'
import { SalesOpportunityDrawer } from './sales/SalesOpportunityDrawer'
import { buildOwnerLookup } from './sales/salesPipelineUi'

interface Props {
  companies: Company[]
  individualClients: IndividualClient[]
}

function resolveClientName(task: ClientTask, companies: Company[], clients: IndividualClient[]): string {
  if (task.companyId) return companies.find((c) => c.id === task.companyId)?.name ?? task.companyId
  return clients.find((c) => c.id === task.individualClientId)?.fullName ?? task.individualClientId ?? '—'
}

export function AdminTasksPanel({ companies, individualClients }: Props) {
  const [tasks, setTasks] = useState<ClientTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<{ created: number; skipped: number } | null>(null)
  const [openOpportunity, setOpenOpportunity] = useState<SalesOpportunity | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  async function loadTasks() {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAllTasksByDueDate({ data: {} })
      setTasks(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTasks() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    setGenerating(true)
    setGenerateResult(null)
    setError(null)
    try {
      const result = await adminGenerateRenewalTasks()
      setGenerateResult({ created: result.created, skipped: result.skipped })
      await loadTasks()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not generate renewal tasks')
    } finally {
      setGenerating(false)
    }
  }

  async function handleToggle(task: ClientTask) {
    const nextStatus: 'pending' | 'done' = task.status === 'pending' ? 'done' : 'pending'
    const snapshot = tasks
    // Optimistic — doesn't regroup immediately, to avoid a visual jump.
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, status: nextStatus, doneAt: nextStatus === 'done' ? new Date().toISOString() : undefined }
          : t,
      ),
    )
    setError(null)
    try {
      await adminUpdateClientTaskStatus({ data: { id: task.id, status: nextStatus } })
    } catch (err) {
      setTasks(snapshot)
      setError(err instanceof Error ? err.message : 'Could not update task')
    }
  }

  const today = new Date().toLocaleDateString('en-CA')
  const pending = tasks.filter((t) => t.status === 'pending')
  const overdue = pending.filter((t) => t.dueDate < today)
  const dueToday = pending.filter((t) => t.dueDate === today)
  const upcoming = pending.filter((t) => t.dueDate > today)
  const done = tasks.filter((t) => t.status === 'done')

  const selectableIds = pending.map((t) => t.id)
  const selectedIds = selectableIds.filter((id) => selected.has(id))
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(ids: string[]) {
    const allIn = ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)))
      return next
    })
  }

  async function handleBulkComplete() {
    if (selectedIds.length === 0) return
    if (!window.confirm(`Mark ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'} as done?`)) return
    setBulkBusy(true)
    setError(null)
    try {
      await completeTasksBulk({ data: { ids: selectedIds } })
      setSelected(new Set())
      await loadTasks()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete tasks')
    } finally {
      setBulkBusy(false)
    }
  }

  function renderGroup(title: string, groupTasks: ClientTask[], urgent = false) {
    if (groupTasks.length === 0) return null
    return (
      <div className="admin-task-list-group">
        <h3 className={`admin-task-list-heading${urgent ? ' admin-task-list-heading--overdue' : ''}`}>
          {groupTasks.some((t) => t.status === 'pending') && (() => {
            const ids = groupTasks.filter((t) => t.status === 'pending').map((t) => t.id)
            const n = ids.filter((id) => selected.has(id)).length
            return (
              <input
                type="checkbox"
                className="admin-task-select"
                checked={n === ids.length}
                ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length }}
                onChange={() => toggleGroup(ids)}
                aria-label={`Select all ${title.toLowerCase()} tasks`}
              />
            )
          })()}
          {title} ({groupTasks.length})
        </h3>
        <div>
          {groupTasks.map((task) => {
            const isDone = task.status === 'done'
            const isOverdue = task.status === 'pending' && task.dueDate < today
            const clientName = resolveClientName(task, companies, individualClients)
            return (
              <div
                key={task.id}
                className={`admin-task-list-row${isOverdue ? ' admin-task-list-row--overdue' : ''}${selected.has(task.id) ? ' admin-task-list-row--selected' : ''}`}
              >
                {isDone ? (
                  <span className="admin-task-select-spacer" aria-hidden="true" />
                ) : (
                  <input
                    type="checkbox"
                    className="admin-task-select"
                    checked={selected.has(task.id)}
                    onChange={() => toggleSelect(task.id)}
                    aria-label={`Select ${task.title}`}
                  />
                )}
                <button
                  className={`admin-task-checkbox${isDone ? ' admin-task-checkbox--done' : ''}`}
                  onClick={() => handleToggle(task)}
                  aria-label={isDone ? 'Mark open' : 'Mark done'}
                >
                  {isDone && <span className="text-white text-[10px] leading-none">✓</span>}
                </button>
                <div className="admin-task-main">
                  <p className={`admin-task-title${isDone ? ' admin-task-title--done' : ''}`}>
                    {task.title}
                  </p>
                  <div className="admin-task-meta">
                    <span className="admin-task-tag">{clientName}</span>
                    {task.source === 'opportunity' && task.opportunityId && (
                      <button
                        onClick={async () => {
                          const opp = await fetchSalesOpportunity({ data: task.opportunityId! })
                          if (opp) setOpenOpportunity(opp)
                        }}
                        className="admin-task-link"
                        title="View the linked sales opportunity"
                      >
                        Opportunity →
                      </button>
                    )}
                    <span className={`admin-task-due${isOverdue ? ' admin-task-due--overdue' : ''}`}>
                      Due {formatDate(task.dueDate)}
                    </span>
                    {isOverdue && <span className="admin-task-overdue-flag">Overdue</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const nothingVisible =
    overdue.length === 0 &&
    dueToday.length === 0 &&
    upcoming.length === 0 &&
    (filter === 'pending' || done.length === 0)

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Tasks</h1>
          <p className="admin-page-subtitle">
            {pending.length} open{overdue.length > 0 ? ` · ${overdue.length} overdue` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="admin-panel-link"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Generating…' : 'Generate renewal tasks'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 mb-4">
        <div className="admin-segmented">
          {(['pending', 'all'] as const).map((f) => (
            <button
              key={f}
              className={`admin-segmented-btn${filter === f ? ' admin-segmented-btn--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'pending' ? 'Open' : 'All'}
            </button>
          ))}
        </div>
        {generateResult !== null && (
          <p className="admin-muted-note">
            {generateResult.created} created
            {generateResult.skipped > 0 ? `, ${generateResult.skipped} already existed` : ''}
          </p>
        )}
      </div>

      {!loading && pending.length > 0 && (
        <div className={`admin-task-bulk${selectedIds.length ? ' admin-task-bulk--active' : ''}`}>
          <label className="admin-task-bulk-all">
            <input
              type="checkbox"
              className="admin-task-select"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = selectedIds.length > 0 && !allSelected }}
              onChange={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
              aria-label="Select all open tasks"
            />
            <span>{selectedIds.length ? `${selectedIds.length} selected` : `Select all open (${selectableIds.length})`}</span>
          </label>
          {selectedIds.length > 0 && (
            <div className="admin-task-bulk-actions">
              <button type="button" className="admin-task-bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
              <button type="button" className="admin-task-bulk-done" onClick={handleBulkComplete} disabled={bulkBusy}>
                {bulkBusy ? 'Completing…' : `Mark ${selectedIds.length} as done`}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="admin-panel admin-task-list">
          {renderGroup('Overdue', overdue, true)}
          {renderGroup('Today', dueToday)}
          {renderGroup('Upcoming', upcoming)}
          {filter === 'all' && renderGroup('Done', done)}
          {nothingVisible && (
            <p className="admin-muted-note">
              {tasks.length === 0 ? 'No tasks registered.' : 'No open tasks.'}
            </p>
          )}
        </div>
      )}

      {openOpportunity && (
        <SalesOpportunityDrawer
          opportunity={openOpportunity}
          owner={buildOwnerLookup(openOpportunity, individualClients, companies)}
          onClose={() => setOpenOpportunity(null)}
          onChanged={loadTasks}
        />
      )}
    </div>
  )
}
