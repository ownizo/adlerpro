// Company expense categories, mapped to the Portuguese SNC chart of accounts.
// Class 62 = Fornecimentos e serviços externos (FSE); 43 = Ativos fixos tangíveis.
// The SNC code is guidance for the accountant, who confirms the final posting.

export type ExpenseCategory = {
  key: string
  label: string
  snc: string
  sncLabel: string
  hint: string
}

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  { key: 'material_escritorio', label: 'Material de escritório', snc: '6233', sncLabel: 'Material de escritório', hint: 'Toner, tinteiros, papel, envelopes, canetas, agrafos, pastas, consumíveis de impressão.' },
  { key: 'mobiliario_equipamento', label: 'Mobiliário e equipamento', snc: '435', sncLabel: 'Equipamento administrativo', hint: 'Cadeiras e secretárias de escritório, armários, computadores, monitores, impressoras. Bens até 1.000 € podem, em regra, ser gastos do próprio ano.' },
  { key: 'ferramentas_utensilios', label: 'Pequenos equipamentos e utensílios', snc: '6231', sncLabel: 'Ferramentas e utensílios de desgaste rápido', hint: 'Teclados, ratos, cabos, carregadores, discos externos, acessórios de duração inferior a um ano.' },
  { key: 'software_subscricoes', label: 'Software e subscrições', snc: '6221', sncLabel: 'Trabalhos especializados', hint: 'Licenças e subscrições SaaS (Google Workspace, Netlify, Supabase, Claude, InvoiceXpress), alojamento web, domínios.' },
  { key: 'servicos_especializados', label: 'Serviços especializados', snc: '6221', sncLabel: 'Trabalhos especializados', hint: 'Contabilidade, advogados, consultoria, design, informática, tradução.' },
  { key: 'publicidade_marketing', label: 'Publicidade e marketing', snc: '6222', sncLabel: 'Publicidade e propaganda', hint: 'Anúncios online, impressão de flyers e cartões de visita, patrocínios, brindes.' },
  { key: 'comunicacoes', label: 'Comunicações', snc: '6262', sncLabel: 'Comunicação', hint: 'Telemóvel, internet, telefone, CTT e portes.' },
  { key: 'rendas_alugueres', label: 'Rendas e alugueres', snc: '6261', sncLabel: 'Rendas e alugueres', hint: 'Cowork, aluguer de sala de reuniões, aluguer de equipamento.' },
  { key: 'deslocacoes_estadas', label: 'Deslocações e estadas', snc: '6251', sncLabel: 'Deslocações e estadas', hint: 'Comboio, avião, táxi/TVDE, portagens, estacionamento, alojamento em viagem.' },
  { key: 'combustiveis', label: 'Combustíveis', snc: '6242', sncLabel: 'Combustíveis', hint: 'Gasóleo, gasolina, GPL, carregamento elétrico.' },
  { key: 'refeicoes_representacao', label: 'Refeições e representação', snc: '6266', sncLabel: 'Despesas de representação', hint: 'Refeições com clientes ou parceiros, ofertas a clientes, receções.' },
  { key: 'formacao_documentacao', label: 'Formação e documentação técnica', snc: '6232', sncLabel: 'Livros e documentação técnica', hint: 'Livros, assinaturas técnicas, cursos e exames (ex.: CII).' },
  { key: 'quotas_associacoes', label: 'Quotas e associações', snc: '6268', sncLabel: 'Outros serviços', hint: 'Quotas de associações e câmaras de comércio (afpop, BPCC, NCA), ordens profissionais.' },
  { key: 'seguros', label: 'Seguros', snc: '6263', sncLabel: 'Seguros', hint: 'Seguros da própria empresa: RC profissional, multirriscos, automóvel.' },
  { key: 'conservacao_reparacao', label: 'Conservação e reparação', snc: '6226', sncLabel: 'Conservação e reparação', hint: 'Reparação de equipamento, assistência técnica, manutenção.' },
  { key: 'energia_agua', label: 'Energia e água', snc: '6241', sncLabel: 'Eletricidade / água', hint: 'Eletricidade, gás e água imputáveis à atividade.' },
  { key: 'limpeza_higiene', label: 'Limpeza, higiene e conforto', snc: '6267', sncLabel: 'Limpeza, higiene e conforto', hint: 'Produtos de limpeza, serviços de limpeza, água e café para o escritório.' },
  { key: 'servicos_bancarios', label: 'Serviços bancários', snc: '6918', sncLabel: 'Outros gastos de financiamento', hint: 'Comissões bancárias, comissões Stripe e de terminais de pagamento.' },
  { key: 'taxas_impostos', label: 'Taxas e impostos', snc: '681', sncLabel: 'Impostos', hint: 'Taxa de supervisão ASF, IUC, imposto do selo, taxas camarárias.' },
  { key: 'outros', label: 'Outros', snc: '6268', sncLabel: 'Outros serviços', hint: 'Despesas que não encaixam nas restantes categorias.' },
] as const

export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key)

export function expenseCategory(key: string | null | undefined): ExpenseCategory {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
}

export function isExpenseCategory(key: unknown): key is string {
  return typeof key === 'string' && EXPENSE_CATEGORY_KEYS.includes(key)
}

/** First day of the month (YYYY-MM-01) for an ISO date, or null. */
export function monthOf(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return `${date.slice(0, 7)}-01`
}
