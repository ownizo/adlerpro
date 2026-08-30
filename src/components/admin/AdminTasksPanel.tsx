import { useEffect, useState } from 'react'
import type { ClientTask, Company, IndividualClient, SalesOpportunity } from '@/lib/types'
import { fetchAllTasksByDueDate, adminUpdateClientTaskStatus, adminGenerateRenewalTasks, fetchSalesOpportunity } from '@/lib/server-fns'
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

  function renderGroup(title: string, groupTasks: ClientTask[], urgent = false) {
    if (groupTasks.length === 0) return null
    return (
      <div className="admin-task-list-group">
        <h3 className={`admin-task-list-heading${urgent ? ' admin-task-list-heading--overdue' : ''}`}>
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
                className={`admin-task-list-row${isOverdue ? ' admin-task-list-row--overdue' : ''}`}
              >
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
