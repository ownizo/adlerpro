interface Props {
  view: 'kanban' | 'list'
  onViewChange: (view: 'kanban' | 'list') => void
  status: 'all' | 'open' | 'won' | 'lost'
  onStatusChange: (status: 'all' | 'open' | 'won' | 'lost') => void
  onCreate: () => void
}

const STATUS_OPTIONS: Array<{ value: 'open' | 'won' | 'lost'; label: string }> = [
  { value: 'open', label: 'All open' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
]

/**
 * Pipeline header — title + primary action, then a second row with the
 * open/won/lost status switch on the left and the Kanban/List view toggle
 * on the right. Pipeline stops being "a component tucked at the bottom of
 * an admin page" and gets the same page structure as any real CRM
 * workspace — see requirement "pipeline header".
 */
export function SalesToolbar({ view, onViewChange, status, onStatusChange, onCreate }: Props) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="admin-page-title">Pipeline</h1>
        <button onClick={onCreate} className="admin-create-button">
          + Create opportunity
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <div className="admin-segmented">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onStatusChange(status === option.value ? 'all' : option.value)}
              className={`admin-segmented-btn${status === option.value ? ' admin-segmented-btn--active' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="admin-segmented">
          <button
            onClick={() => onViewChange('kanban')}
            className={`admin-segmented-btn${view === 'kanban' ? ' admin-segmented-btn--active' : ''}`}
          >
            Kanban
          </button>
          <button
            onClick={() => onViewChange('list')}
            className={`admin-segmented-btn${view === 'list' ? ' admin-segmented-btn--active' : ''}`}
          >
            List
          </button>
        </div>
      </div>
    </div>
  )
}
