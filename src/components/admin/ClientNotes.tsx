import { useEffect, useRef, useState } from 'react'
import type { ClientNote } from '@/lib/types'
import { fetchClientNotes, adminCreateClientNote, adminDeleteClientNote } from '@/lib/server-fns'
import { formatDate } from '@/lib/utils'

interface Props {
  companyId?: string
  individualClientId?: string
}

export function ClientNotes({ companyId, individualClientId }: Props) {
  const [notes, setNotes] = useState<ClientNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const tempIdRef = useRef(0)

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

  async function handleAdd() {
    const trimmed = body.trim()
    if (!trimmed) return

    const tempId = `__temp_${++tempIdRef.current}`
    const optimistic: ClientNote = {
      id: tempId,
      companyId,
      individualClientId,
      body: trimmed,
      authorName: '…',
      createdAt: new Date().toISOString(),
    }

    setNotes((prev) => [optimistic, ...prev])
    setBody('')
    setSaving(true)
    setError(null)

    try {
      const result = await adminCreateClientNote({ data: { companyId, individualClientId, body: trimmed } })
      setNotes((prev) => prev.map((n) => (n.id === tempId ? result.note : n)))
    } catch (err) {
      setNotes((prev) => prev.filter((n) => n.id !== tempId))
      setBody(trimmed)
      setError(err instanceof Error ? err.message : 'Erro ao guardar nota')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(noteId: string) {
    if (!window.confirm('Apagar esta nota?')) return

    const snapshot = notes
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    setError(null)

    try {
      await adminDeleteClientNote({ data: noteId })
    } catch (err) {
      setNotes(snapshot)
      setError(err instanceof Error ? err.message : 'Erro ao apagar nota')
    }
  }

  const canAdd = body.trim().length > 0 && !saving

  return (
    <div>
      <h4 className="text-sm font-semibold text-navy-700 mb-3">Notas</h4>

      {/* Adicionar nota */}
      <div className="mb-4 space-y-2">
        <textarea
          className="w-full rounded-[4px] border border-navy-200 px-3 py-2 text-sm text-navy-700 placeholder:text-navy-400 focus:outline-none focus:ring-1 focus:ring-gold-400 resize-none"
          rows={3}
          placeholder="Escrever nota…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={saving}
        />
        <div className="flex justify-end">
          <button
            className="px-3 py-1.5 rounded-[4px] bg-navy-700 text-white text-sm font-medium disabled:opacity-40"
            onClick={handleAdd}
            disabled={!canAdd}
          >
            {saving ? 'A guardar…' : 'Adicionar nota'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-navy-400">A carregar…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-navy-400">Sem notas.</p>
      ) : (
        <div className="grid gap-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="bg-white rounded-[4px] border border-navy-200 px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-navy-700 break-words">{note.body}</p>
                <p className="text-xs text-navy-400 mt-1">
                  {note.authorName ?? 'Admin'} · {formatDate(note.createdAt)}
                </p>
              </div>
              {!note.id.startsWith('__temp_') && (
                <button
                  className="flex-shrink-0 text-xs text-red-400 hover:text-red-600"
                  onClick={() => handleDelete(note.id)}
                >
                  Apagar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
