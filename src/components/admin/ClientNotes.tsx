import { useEffect, useState } from 'react'
import type { ClientNote } from '@/lib/types'
import { fetchClientNotes } from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'

interface Props {
  companyId?: string
  individualClientId?: string
}

export function ClientNotes({ companyId, individualClientId }: Props) {
  const [notes, setNotes] = useState<ClientNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientNotes({ data: { companyId, individualClientId } })
      .then((result) => {
        if (!cancelled) setNotes(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar notas')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, individualClientId])

  return (
    <div>
      <h4 className="text-sm font-semibold text-navy-700 mb-3">Notas</h4>
      {loading ? (
        <p className="text-sm text-navy-400">A carregar…</p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-navy-400">Sem notas.</p>
      ) : (
        <div className="grid gap-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="bg-white rounded-[4px] border border-navy-200 px-4 py-3"
            >
              <p className="text-sm text-navy-700">{note.body}</p>
              <p className="text-xs text-navy-400 mt-1">
                {note.authorName ?? 'Admin'} · {formatDate(note.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
