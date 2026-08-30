import { useEffect, useRef, useState } from 'react'

export interface SearchableSelectOption {
  id: string
  label: string
  sublabel?: string
}

interface Props {
  options: SearchableSelectOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}

/**
 * Combobox de pesquisa leve, sem dependência nova (o projeto não tem Radix
 * nem cmdk/downshift instalado) — substitui o <select> gigante de
 * clientes/empresas por um campo onde escrever "Anna" filtra a lista em
 * tempo real. Fecha com Escape, seleciona com clique; não tenta replicar um
 * combobox WAI-ARIA completo, só o essencial para ser rápido de usar.
 */
export function SearchableSelect({ options, value, onChange, placeholder }: Props) {
  const selected = options.find((o) => o.id === value)
  const [query, setQuery] = useState(selected?.label ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(selected?.label ?? '')
  }, [selected?.label])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = query.trim() === '' || query === selected?.label
    ? options
    : options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div ref={containerRef} className="relative">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (e.target.value === '') onChange('') }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(selected?.label ?? '') } }}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-[14px] border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
          {filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => { onChange(option.id); setQuery(option.label); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-[14px] hover:bg-slate-50 flex flex-col"
            >
              <span className="text-slate-800">{option.label}</span>
              {option.sublabel && <span className="text-[12px] text-slate-400">{option.sublabel}</span>}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg px-3 py-2 text-[13px] text-slate-400">
          No results.
        </div>
      )}
    </div>
  )
}
