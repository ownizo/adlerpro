import { useEffect, useRef, useState } from 'react'
import type { ClientTask } from '@/lib/types'
import {
  fetchClientTasks,
  adminCreateClientTask,
  adminUpdateClientTaskStatus,
  adminDeleteClientTask,
} from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'

interface Props {
  companyId?: string
  individualClientId?: string
}

function sortByDueDate(tasks: ClientTask[]): ClientTask[] {
  return [...tasks].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}

export function ClientTasks({ companyId, individualClientId }: Props) {
  const [tasks, setTasks] = useState<ClientTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const tempIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientTasks({ data: { companyId, individualClientId } })
      .then((result) => {
        if (!cancelled) setTasks(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar tarefas')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, individualClientId])

  async function handleAdd() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle || !dueDate) return

    const capturedDueDate = dueDate
    const tempId = `__temp_${++tempIdRef.current}`
    const optimistic: ClientTask = {
      id: tempId,
      companyId,
      individualClientId,
      title: trimmedTitle,
      dueDate: capturedDueDate,
      status: 'pending',
      createdAt: new Date().toISOString(),
      source: 'manual',
    }

    setTasks((prev) => sortByDueDate([...prev, optimistic]))
    setTitle('')
    setDueDate('')
    setSaving(true)
    setError(null)

    try {
      const result = await adminCreateClientTask({
        data: { companyId, individualClientId, title: trimmedTitle, dueDate: capturedDueDate },
      })
      setTasks((prev) => sortByDueDate(prev.map((t) => (t.id === tempId ? result.task : t))))
    } catch (err) {
      setTasks((prev) => prev.filter((t) => t.id !== tempId))
      setTitle(trimmedTitle)
      setDueDate(capturedDueDate)
      setError(err instanceof Error ? err.message : 'Erro ao guardar tarefa')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(task: ClientTask) {
    const nextStatus: 'pending' | 'done' = task.status === 'pending' ? 'done' : 'pending'
    const snapshot = tasks
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

  async function handleDelete(taskId: string) {
    if (!window.confirm('Apagar esta tarefa?')) return

    const snapshot = tasks
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    setError(null)

    try {
      await adminDeleteClientTask({ data: taskId })
    } catch (err) {
      setTasks(snapshot)
      setError(err instanceof Error ? err.message : 'Erro ao apagar tarefa')
    }
  }

  // Local date in YYYY-MM-DD — compara directamente com dueDate do servidor (tipo date)
  const today = new Date().toLocaleDateString('en-CA')
  const canAdd = title.trim().length > 0 && dueDate.length > 0 && !saving

  return (
    <div>
      <h4 className="text-sm font-semibold text-navy-700 mb-3">Tarefas</h4>

      {/* Criar tarefa */}
      <div className="mb-4 space-y-2">
        <input
          type="text"
          className="w-full rounded-[4px] border border-navy-200 px-3 py-2 text-sm text-navy-700 placeholder:text-navy-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
          placeholder="Título da tarefa…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
        />
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="flex-1 rounded-[4px] border border-navy-200 px-3 py-2 text-sm text-navy-700 focus:outline-none focus:ring-1 focus:ring-gold-400"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={saving}
          />
          <button
            className="px-3 py-2 rounded-[4px] bg-navy-700 text-white text-sm font-medium disabled:opacity-40 whitespace-nowrap"
            onClick={handleAdd}
            disabled={!canAdd}
          >
            {saving ? 'A guardar…' : 'Adicionar tarefa'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-navy-400">A carregar…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-navy-400">Sem tarefas.</p>
      ) : (
        <div className="grid gap-2">
          {tasks.map((task) => {
            const isOverdue = task.status === 'pending' && task.dueDate < today
            const isDone = task.status === 'done'
            const isTemp = task.id.startsWith('__temp_')
            return (
              <div
                key={task.id}
                className={`bg-white rounded-[4px] border px-4 py-3 flex items-start justify-between gap-3 ${
                  isOverdue ? 'border-red-300' : 'border-navy-200'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {/* Checkbox toggle */}
                  <button
                    className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                      isDone ? 'bg-navy-600 border-navy-600' : 'border-navy-300 bg-white'
                    }`}
                    onClick={() => handleToggle(task)}
                    disabled={isTemp}
                    aria-label={isDone ? 'Marcar por fazer' : 'Marcar feita'}
                  >
                    {isDone && <span className="text-white text-[10px] leading-none">✓</span>}
                  </button>

                  <div className="min-w-0">
                    <p
                      className={`text-sm break-words ${
                        isDone ? 'line-through text-navy-400' : 'text-navy-700'
                      }`}
                    >
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p
                        className={`text-xs ${
                          isOverdue ? 'text-red-500 font-medium' : 'text-navy-400'
                        }`}
                      >
                        Prazo: {formatDate(task.dueDate)}
                      </p>
                      {isOverdue && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                          Atrasada
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {!isTemp && (
                  <button
                    className="flex-shrink-0 text-xs text-red-400 hover:text-red-600"
                    onClick={() => handleDelete(task.id)}
                  >
                    Apagar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
