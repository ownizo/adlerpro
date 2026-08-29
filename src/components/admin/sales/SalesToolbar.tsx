interface Props {
  view: 'kanban' | 'list'
  onViewChange: (view: 'kanban' | 'list') => void
  onCreate: () => void
}

/**
 * Cabeçalho do workspace comercial — título + ação primária + alternância
 * Kanban/Lista. O Comercial deixa de parecer "um componente inserido ao
 * fundo de uma página de admin" e passa a ter a mesma estrutura de página
 * que qualquer workspace de CRM a sério — ver requisito "pipeline header".
 */
export function SalesToolbar({ view, onViewChange, onCreate }: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 className="text-[26px] font-semibold text-slate-800 tracking-tight">Comercial</h1>
        <p className="text-[14px] text-slate-500 mt-0.5">Gerir oportunidades de venda e follow-ups</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex bg-slate-100 rounded-md p-0.5">
          <button
            onClick={() => onViewChange('kanban')}
            className={`px-3 py-1.5 text-[13px] font-medium rounded ${view === 'kanban' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Kanban
          </button>
          <button
            onClick={() => onViewChange('list')}
            className={`px-3 py-1.5 text-[13px] font-medium rounded ${view === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Lista
          </button>
        </div>
        <button
          onClick={onCreate}
          className="px-3.5 py-2 text-[14px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
        >
          + Oportunidade
        </button>
      </div>
    </div>
  )
}
