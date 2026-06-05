import { useEffect, useState } from 'react'
import type { ClientTask, Company, IndividualClient } from '@/lib/types'
import { fetchAllTasksByDueDate, adminUpdateClientTaskStatus, adminGenerateRenewalTasks } from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'

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

  async function loadTasks() {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAllTasksByDueDate({ data: {} })
      setTasks(result)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar tarefas')
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
      setError(err instanceof Error ? err.message : 'Erro ao gerar tarefas de renovação')
    } finally {
      setGenerating(false)
    }
  }

  async function handleToggle(task: ClientTask) {
    const nextStatus: 'pending' | 'done' = task.status === 'pending' ? 'done' : 'pending'
    const snapshot = tasks
    // Optimistic — não reagrupa imediatamente para evitar salto visual
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
      setError(err instanceof Error ? err.message : 'Erro ao atualizar tarefa')
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
      <div>
        <h3
          className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
            urgent ? 'text-red-500' : 'text-navy-500'
          }`}
        >
          {title} ({groupTasks.length})
        </h3>
        <div className="grid gap-2">
          {groupTasks.map((task) => {
            const isDone = task.status === 'done'
            const isOverdue = task.status === 'pending' && task.dueDate < today
            const clientName = resolveClientName(task, companies, individualClients)
            return (
              <div
                key={task.id}
                className="bg-white rounded-[4px] border border-navy-200 px-4 py-3 flex items-start gap-3"
              >
                <button
                  className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                    isDone ? 'bg-navy-600 border-navy-600' : 'border-navy-300 bg-white'
                  }`}
                  onClick={() => handleToggle(task)}
                  aria-label={isDone ? 'Marcar por fazer' : 'Marcar feita'}
                >
                  {isDone && <span className="text-white text-[10px] leading-none">✓</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm break-words ${
                      isDone ? 'line-through text-navy-400' : 'text-navy-700'
                    }`}
                  >
                    {task.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="text-xs text-navy-500 bg-navy-50 px-1.5 py-0.5 rounded">
                      {clientName}
                    </span>
                    <span
                      className={`text-xs ${
                        isOverdue ? 'text-red-500 font-medium' : 'text-navy-400'
                      }`}
                    >
                      Prazo: {formatDate(task.dueDate)}
                    </span>
                    {isOverdue && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                        Atrasada
                      </span>
                    )}
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-navy-700">
          Tarefas
          {pending.length > 0 && (
            <span className="ml-2 text-navy-500 font-normal">
              ({pending.length} por fazer
              {overdue.length > 0 ? `, ${overdue.length} atrasadas` : ''})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {(['pending', 'all'] as const).map((f) => (
            <button
              key={f}
              className={`px-3 py-1.5 rounded-[4px] text-sm font-medium ${
                filter === f
                  ? 'bg-navy-700 text-white'
                  : 'border border-navy-300 text-navy-600 hover:bg-navy-50'
              }`}
              onClick={() => setFilter(f)}
            >
              {f === 'pending' ? 'Por fazer' : 'Todas'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end mb-4 gap-3">
        <button
          className="px-3 py-1.5 rounded-[4px] text-sm font-medium border border-navy-300 text-navy-600 hover:bg-navy-50 disabled:opacity-40"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? 'A gerar…' : 'Gerar tarefas de renovação'}
        </button>
        {generateResult !== null && (
          <p className="text-sm text-navy-500">
            {generateResult.created} criada{generateResult.created !== 1 ? 's' : ''}
            {generateResult.skipped > 0 ? `, ${generateResult.skipped} já existia${generateResult.skipped !== 1 ? 'm' : ''}` : ''}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {renderGroup('Atrasadas', overdue, true)}
          {renderGroup('Hoje', dueToday)}
          {renderGroup('Próximas', upcoming)}
          {filter === 'all' && renderGroup('Feitas', done)}
          {nothingVisible && (
            <p className="text-navy-500">
              {tasks.length === 0 ? 'Sem tarefas registadas.' : 'Sem tarefas por fazer.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
