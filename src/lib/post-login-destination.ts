import type { ViewerSegment } from './server-fns'
import { getMySegment } from './server-fns'

/** Rotas existentes para onde se pode navegar após o login. */
export type PostLoginRoute = '/admin' | '/dashboard' | '/one/dashboard'

/**
 * Resultado da decisão de destino pós-login:
 *   - { status: 'redirect', to } → navegar para uma rota existente
 *   - { status: 'unconfigured' } → conta autenticada mas SEM perfil de cliente
 *       (b2b/b2c) associado; o chamador mostra "conta por configurar".
 *   - { status: 'error' }        → não foi possível resolver o segmento (falha
 *       persistente). Distinto de 'unconfigured' e de qualquer destino de
 *       portal: o chamador oferece "tentar novamente". NUNCA cai para um portal
 *       por omissão (um B2C com falha não pode acabar no portal B2B).
 * Em nenhum caso há ecrã em branco ou loop de redirect.
 */
export type PostLoginDecision =
  | { status: 'redirect'; to: PostLoginRoute }
  | { status: 'unconfigured' }
  | { status: 'error' }

/**
 * Regra de decisão de destino pós-login — FONTE ÚNICA de verdade.
 * Decide pelo SEGMENTO derivado (não pelo hostname). Ordem ESTRITA:
 *   1. admin             → /admin            (destino admin atual)
 *   2. segment 'b2b'     → /dashboard         (portal atual)
 *   3. segment 'b2c'     → /one/dashboard     (TEMPORÁRIO até existir a Carteira)
 *   4. unknown & !admin  → 'unconfigured'     (conta por configurar)
 * O segmento provém de getMySegment/deriveSegment (server-fns); isAdmin vem do
 * role já presente na sessão (app_metadata.roles) e não é recalculado aqui.
 */
export function decidePostLogin(input: { isAdmin: boolean; segment: ViewerSegment }): PostLoginDecision {
  if (input.isAdmin) return { status: 'redirect', to: '/admin' }
  if (input.segment === 'b2b') return { status: 'redirect', to: '/dashboard' }
  if (input.segment === 'b2c') return { status: 'redirect', to: '/one/dashboard' }
  return { status: 'unconfigured' }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Resolve a decisão apenas no momento da decisão de destino (não por navegação).
 * Pressupõe que a sessão já está disponível (logo após o sign-in ou no callback).
 * Admin nem chega a resolver o segmento — evita o round-trip desnecessário.
 *
 * Tenta getMySegment até 2x com um pequeno intervalo, para absorver uma falha
 * transitória (ex.: cookie de sessão ainda não propagado). Se o erro PERSISTIR,
 * devolve { status: 'error' } — nunca um destino de portal por omissão, para que
 * um B2C com falha não acabe erradamente no portal B2B.
 */
export async function resolvePostLogin(isAdmin: boolean): Promise<PostLoginDecision> {
  if (isAdmin) return { status: 'redirect', to: '/admin' }
  const attempts = 2
  for (let i = 0; i < attempts; i++) {
    try {
      const { segment } = await getMySegment()
      return decidePostLogin({ isAdmin: false, segment })
    } catch {
      if (i < attempts - 1) await sleep(300)
    }
  }
  return { status: 'error' }
}
