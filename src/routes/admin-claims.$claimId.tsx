import { createFileRoute, Link, Navigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/AppLayout'
import { useIdentity } from '@/lib/identity-context'
import {
  adminAssignClaimOwner,
  adminDeleteClaimDocument,
  adminGetDocumentUrl,
  adminUpdateClaimStatus,
  adminUploadClaimDocument,
  adminUpsertClaimInternalNote,
  fetchAdminClaimDetail,
} from '@/lib/server-fns'
import { supabase } from '@/lib/supabase'
import type { AdminClaimDetail, ClaimStatus, ClaimTimelineEventType } from '@/lib/types'
import { CLAIM_STATUS_LABELS } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useEffect, useMemo, useRef, useState } from 'react'

export const Route = createFileRoute('/admin-claims/$claimId')({
  component: AdminClaimDetailPage,
  head: () => ({ meta: [{ title: 'Admin • Detalhe do Sinistro' }] }),
})

function AdminClaimDetailPage() {
  const { user, ready } = useIdentity()
  const { claimId } = Route.useParams()
  const [detail, setDetail] = useState<AdminClaimDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newNote, setNewNote] = useState('')
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({})
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [updatingAssignee, setUpdatingAssignee] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAdminClaimDetail({ data: claimId })
      setDetail(data)
      setEditingNotes(
        data.internalNotes.reduce<Record<string, string>>((acc, note) => {
          acc[note.id] = note.body
          return acc
        }, {})
      )
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao carregar detalhe do sinistro.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!ready || !user || !user.roles?.includes('admin')) return
    load()
  }, [ready, user, claimId])

  const statusValue = detail?.claim.status ?? 'submitted'
  const assigneeValue = detail?.claim.assignedTo ?? ''

  const timeline = useMemo(() => detail?.timeline ?? [], [detail])

  const updateStatus = async (nextStatus: ClaimStatus) => {
    if (!detail || detail.claim.status === nextStatus) return
    setUpdatingStatus(true)
    try {
      await adminUpdateClaimStatus({ data: { claimId: detail.claim.id, status: nextStatus } })
      await load()
    } catch {
      alert('Não foi possível alterar o estado do sinistro.')
    } finally {
      setUpdatingStatus(false)
    }
  }

  const updateAssignee = async (assignedTo: string) => {
    if (!detail) return
    setUpdatingAssignee(true)
    try {
      await adminAssignClaimOwner({
        data: {
          claimId: detail.claim.id,
          assignedTo: assignedTo || undefined,
        },
      })
      await load()
    } catch {
      alert('Não foi possível alterar o responsável.')
    } finally {
      setUpdatingAssignee(false)
    }
  }

  const createNote = async () => {
    if (!detail || !newNote.trim()) return
    setSavingNoteId('new')
    try {
      await adminUpsertClaimInternalNote({ data: { claimId: detail.claim.id, body: newNote } })
      setNewNote('')
      await load()
    } catch {
      alert('Não foi possível criar a nota interna.')
    } finally {
      setSavingNoteId(null)
    }
  }

  const saveExistingNote = async (noteId: string) => {
    if (!detail) return
    const body = (editingNotes[noteId] || '').trim()
    if (!body) return

    setSavingNoteId(noteId)
    try {
      await adminUpsertClaimInternalNote({
        data: {
          claimId: detail.claim.id,
          noteId,
          body,
        },
      })
      await load()
    } catch {
      alert('Não foi possível atualizar a nota interna.')
    } finally {
      setSavingNoteId(null)
    }
  }

  const uploadDocument = async (file?: File) => {
    if (!detail || !file) return
    setUploadingDoc(true)
    try {
      const storagePath = `claims/${detail.claim.id}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('documents').upload(storagePath, file)
      if (uploadError) throw uploadError

      await adminUploadClaimDocument({
        data: {
          claimId: detail.claim.id,
          companyId: detail.claim.companyId || undefined,
          name: file.name,
          storagePath,
          size: file.size,
          category: file.type.startsWith('image/') ? 'claim' : 'claim',
        },
      })
      await load()
    } catch {
      alert('Não foi possível carregar o documento.')
    } finally {
      setUploadingDoc(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const openDocument = async (storagePath: string) => {
    try {
      const { url } = await adminGetDocumentUrl({ data: { storagePath } })
      window.open(url, '_blank')
    } catch {
      alert('Não foi possível abrir o documento.')
    }
  }

  const removeDocument = async (documentId: string) => {
    if (!detail) return
    if (!window.confirm('Remover documento deste sinistro?')) return
    try {
      await adminDeleteClaimDocument({ data: { claimId: detail.claim.id, documentId } })
      await load()
    } catch {
      alert('Não foi possível remover o documento.')
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" />
  if (!user.roles?.includes('admin')) return <Navigate to="/dashboard" />

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-navy-700">Detalhe do Sinistro</h1>
            <p className="text-sm text-navy-500 mt-1">Gestão operacional completa para equipa interna.</p>
          </div>
          <Link to="/admin-claims" className="px-3 py-2 border border-navy-200 rounded-[2px] text-sm text-navy-600 hover:bg-navy-50">
            Voltar à lista
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gold-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error || !detail ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-[4px] p-4 text-sm">{error || 'Sinistro não encontrado.'}</div>
        ) : (
          <>
            <section className="bg-white border border-navy-200 rounded-[4px] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500 mb-3">Cabeçalho</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <Field label="Cliente">{detail.clientName}</Field>
                <Field label="Apólice">
                  {detail.policy ? `${detail.policy.policyNumber} · ${detail.policy.insurer}` : 'Sem apólice associada'}
                </Field>
                <Field label="Tipo">{detail.claim.title}</Field>
                <Field label="Valor">{formatCurrency(detail.claim.estimatedValue || 0)}</Field>
                <Field label="Data">{formatDate(detail.claim.incidentDate)}</Field>
                <Field label="Estado">
                  <select
                    value={statusValue}
                    disabled={updatingStatus}
                    onChange={(event) => void updateStatus(event.target.value as ClaimStatus)}
                    className="w-full px-2.5 py-1.5 border border-navy-200 rounded text-sm bg-white"
                  >
                    {Object.entries(CLAIM_STATUS_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Responsável">
                  <select
                    value={assigneeValue}
                    disabled={updatingAssignee}
                    onChange={(event) => void updateAssignee(event.target.value)}
                    className="w-full px-2.5 py-1.5 border border-navy-200 rounded text-sm bg-white"
                  >
                    <option value="">Sem responsável</option>
                    {detail.assigneeOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white border border-navy-200 rounded-[4px] p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500 mb-3">Timeline</h2>
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {timeline.length === 0 ? (
                    <p className="text-sm text-navy-500">Sem eventos registados.</p>
                  ) : timeline.map((event) => (
                    <div key={event.id} className="border border-navy-100 rounded-[4px] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-navy-700">{event.title}</p>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${eventTypeClass(event.type)}`}>
                          {event.type}
                        </span>
                      </div>
                      {event.details && <p className="text-xs text-navy-600 mt-1">{event.details}</p>}
                      <p className="text-[11px] text-navy-400 mt-1">{event.createdBy} · {formatDate(event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <section className="bg-white border border-navy-200 rounded-[4px] p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500 mb-3">Notas internas</h2>
                  <div className="space-y-2 mb-4">
                    <textarea
                      value={newNote}
                      onChange={(event) => setNewNote(event.target.value)}
                      rows={3}
                      placeholder="Adicionar nota interna (não visível no Pro)."
                      className="w-full px-3 py-2 border border-navy-200 rounded text-sm"
                    />
                    <button
                      disabled={savingNoteId === 'new' || !newNote.trim()}
                      onClick={() => void createNote()}
                      className="px-3 py-2 bg-navy-700 text-white text-xs font-semibold rounded-[2px] disabled:opacity-50"
                    >
                      {savingNoteId === 'new' ? 'A guardar...' : 'Guardar nota'}
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                    {detail.internalNotes.length === 0 ? (
                      <p className="text-sm text-navy-500">Ainda não existem notas internas.</p>
                    ) : detail.internalNotes.map((note) => (
                      <div key={note.id} className="border border-navy-100 rounded-[4px] p-3">
                        <textarea
                          value={editingNotes[note.id] || ''}
                          onChange={(event) => setEditingNotes((prev) => ({ ...prev, [note.id]: event.target.value }))}
                          rows={3}
                          className="w-full px-2.5 py-2 border border-navy-200 rounded text-sm"
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[11px] text-navy-400">{note.createdBy} · {formatDate(note.updatedAt || note.createdAt)}</p>
                          <button
                            disabled={savingNoteId === note.id || !(editingNotes[note.id] || '').trim()}
                            onClick={() => void saveExistingNote(note.id)}
                            className="px-2.5 py-1.5 border border-navy-300 text-xs rounded hover:bg-navy-50 disabled:opacity-50"
                          >
                            {savingNoteId === note.id ? 'A guardar...' : 'Atualizar'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-white border border-navy-200 rounded-[4px] p-5">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-500">Documentos</h2>
                    <button
                      disabled={uploadingDoc}
                      onClick={() => fileRef.current?.click()}
                      className="px-2.5 py-1.5 bg-navy-700 text-white text-xs font-semibold rounded-[2px] disabled:opacity-50"
                    >
                      {uploadingDoc ? 'A carregar...' : 'Upload'}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      onChange={(event) => void uploadDocument(event.target.files?.[0])}
                    />
                  </div>

                  <div className="space-y-2">
                    {detail.documents.length === 0 ? (
                      <p className="text-sm text-navy-500">Sem documentos associados a este sinistro.</p>
                    ) : detail.documents.map((document) => (
                      <div key={document.id} className="flex items-center justify-between gap-2 border border-navy-100 rounded-[4px] p-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-navy-700 truncate">{document.name}</p>
                          <p className="text-[11px] text-navy-400">{formatDate(document.uploadedAt)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => void openDocument(document.blobKey)}
                            className="px-2 py-1 border border-navy-200 text-xs rounded hover:bg-navy-50"
                          >
                            Ver
                          </button>
                          <button
                            onClick={() => void removeDocument(document.id)}
                            className="px-2 py-1 border border-red-200 text-red-700 text-xs rounded hover:bg-red-50"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-400 mb-1">{label}</p>
      <div className="text-sm text-navy-700">{children}</div>
    </div>
  )
}

function eventTypeClass(type: ClaimTimelineEventType): string {
  const map: Record<ClaimTimelineEventType, string> = {
    status_change: 'bg-blue-50 text-blue-700 border border-blue-200',
    upload: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    assignment: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
    note_created: 'bg-violet-50 text-violet-700 border border-violet-200',
    note_updated: 'bg-purple-50 text-purple-700 border border-purple-200',
    team_action: 'bg-gray-50 text-gray-700 border border-gray-200',
  }
  return map[type]
}
