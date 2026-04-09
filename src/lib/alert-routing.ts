import type { Alert } from '@/lib/types'

const ALERT_DESTINATIONS: Record<Alert['type'], string> = {
  renewal: '/policies',
  claim_update: '/claims',
  payment: '/dashboard',
  document: '/policies',
  general: '/alerts',
}

export function getAlertDestination(type: Alert['type']): string {
  return ALERT_DESTINATIONS[type] ?? '/alerts'
}
