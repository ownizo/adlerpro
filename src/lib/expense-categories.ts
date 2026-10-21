// Company expense categories, mapped to the Portuguese SNC chart of accounts.
// Class 62 = Fornecimentos e serviços externos (FSE); 43 = Ativos fixos tangíveis.
// The SNC code is guidance for the accountant, who confirms the final posting.

export type ExpenseCategory = {
  key: string
  label: string
  /** Backoffice label (the backoffice is English; exports keep the Portuguese label). */
  labelEn: string
  snc: string
  sncLabel: string
  hint: string
  hintEn: string
}

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  { key: 'material_escritorio', label: 'Material de escritório', labelEn: 'Office supplies', snc: '6233', sncLabel: 'Material de escritório', hint: 'Toner, tinteiros, papel, envelopes, canetas, agrafos, pastas, consumíveis de impressão.', hintEn: 'Toner, ink cartridges, paper, envelopes, pens, staples, folders, printing supplies.' },
  { key: 'mobiliario_equipamento', label: 'Mobiliário e equipamento', labelEn: 'Furniture and equipment', snc: '435', sncLabel: 'Equipamento administrativo', hint: 'Cadeiras e secretárias de escritório, armários, computadores, monitores, impressoras. Bens até 1.000 € podem, em regra, ser gastos do próprio ano.', hintEn: 'Office chairs and desks, cabinets, computers, monitors, printers. Items up to €1,000 can usually be expensed in the same year.' },
  { key: 'ferramentas_utensilios', label: 'Pequenos equipamentos e utensílios', labelEn: 'Small equipment and tools', snc: '6231', sncLabel: 'Ferramentas e utensílios de desgaste rápido', hint: 'Teclados, ratos, cabos, carregadores, discos externos, acessórios de duração inferior a um ano.', hintEn: 'Keyboards, mice, cables, chargers, external drives, accessories lasting less than a year.' },
  { key: 'software_subscricoes', label: 'Software e subscrições', labelEn: 'Software and subscriptions', snc: '6221', sncLabel: 'Trabalhos especializados', hint: 'Licenças e subscrições SaaS (Google Workspace, Netlify, Supabase, Claude, InvoiceXpress), alojamento web, domínios.', hintEn: 'SaaS licences and subscriptions (Google Workspace, Netlify, Supabase, Claude, InvoiceXpress), web hosting, domains.' },
  { key: 'servicos_especializados', label: 'Serviços especializados', labelEn: 'Professional services', snc: '6221', sncLabel: 'Trabalhos especializados', hint: 'Contabilidade, advogados, consultoria, design, informática, tradução.', hintEn: 'Accounting, lawyers, consulting, design, IT, translation.' },
  { key: 'publicidade_marketing', label: 'Publicidade e marketing', labelEn: 'Advertising and marketing', snc: '6222', sncLabel: 'Publicidade e propaganda', hint: 'Anúncios online, impressão de flyers e cartões de visita, patrocínios, brindes.', hintEn: 'Online ads, printing of flyers and business cards, sponsorships, giveaways.' },
  { key: 'comunicacoes', label: 'Comunicações', labelEn: 'Communications', snc: '6262', sncLabel: 'Comunicação', hint: 'Telemóvel, internet, telefone, CTT e portes.', hintEn: 'Mobile phone, internet, landline, CTT and postage.' },
  { key: 'rendas_alugueres', label: 'Rendas e alugueres', labelEn: 'Rent and hire', snc: '6261', sncLabel: 'Rendas e alugueres', hint: 'Cowork, aluguer de sala de reuniões, aluguer de equipamento.', hintEn: 'Coworking, meeting room hire, equipment hire.' },
  { key: 'deslocacoes_estadas', label: 'Deslocações e estadas', labelEn: 'Travel and accommodation', snc: '6251', sncLabel: 'Deslocações e estadas', hint: 'Comboio, avião, táxi/TVDE, portagens, estacionamento, alojamento em viagem.', hintEn: 'Train, flights, taxi/ride-hailing, tolls, parking, travel accommodation.' },
  { key: 'combustiveis', label: 'Combustíveis', labelEn: 'Fuel', snc: '6242', sncLabel: 'Combustíveis', hint: 'Gasóleo, gasolina, GPL, carregamento elétrico.', hintEn: 'Diesel, petrol, LPG, EV charging.' },
  { key: 'refeicoes_representacao', label: 'Refeições e representação', labelEn: 'Meals and entertainment', snc: '6266', sncLabel: 'Despesas de representação', hint: 'Refeições com clientes ou parceiros, ofertas a clientes, receções.', hintEn: 'Meals with clients or partners, client gifts, receptions.' },
  { key: 'formacao_documentacao', label: 'Formação e documentação técnica', labelEn: 'Training and technical literature', snc: '6232', sncLabel: 'Livros e documentação técnica', hint: 'Livros, assinaturas técnicas, cursos e exames (ex.: CII).', hintEn: 'Books, technical subscriptions, courses and exams (e.g. CII).' },
  { key: 'quotas_associacoes', label: 'Quotas e associações', labelEn: 'Memberships and associations', snc: '6268', sncLabel: 'Outros serviços', hint: 'Quotas de associações e câmaras de comércio (afpop, BPCC, NCA), ordens profissionais.', hintEn: 'Association and chamber of commerce fees (afpop, BPCC, NCA), professional bodies.' },
  { key: 'seguros', label: 'Seguros', labelEn: 'Insurance', snc: '6263', sncLabel: 'Seguros', hint: 'Seguros da própria empresa: RC profissional, multirriscos, automóvel.', hintEn: "The company's own insurance: professional liability, property, motor." },
  { key: 'conservacao_reparacao', label: 'Conservação e reparação', labelEn: 'Maintenance and repairs', snc: '6226', sncLabel: 'Conservação e reparação', hint: 'Reparação de equipamento, assistência técnica, manutenção.', hintEn: 'Equipment repairs, technical support, maintenance.' },
  { key: 'energia_agua', label: 'Energia e água', labelEn: 'Energy and water', snc: '6241', sncLabel: 'Eletricidade / água', hint: 'Eletricidade, gás e água imputáveis à atividade.', hintEn: 'Electricity, gas and water attributable to the business.' },
  { key: 'limpeza_higiene', label: 'Limpeza, higiene e conforto', labelEn: 'Cleaning and hygiene', snc: '6267', sncLabel: 'Limpeza, higiene e conforto', hint: 'Produtos de limpeza, serviços de limpeza, água e café para o escritório.', hintEn: 'Cleaning products, cleaning services, water and coffee for the office.' },
  { key: 'servicos_bancarios', label: 'Serviços bancários', labelEn: 'Bank charges', snc: '6918', sncLabel: 'Outros gastos de financiamento', hint: 'Comissões bancárias, comissões Stripe e de terminais de pagamento.', hintEn: 'Bank charges, Stripe and card terminal fees.' },
  { key: 'taxas_impostos', label: 'Taxas e impostos', labelEn: 'Fees and taxes', snc: '681', sncLabel: 'Impostos', hint: 'Taxa de supervisão ASF, IUC, imposto do selo, taxas camarárias.', hintEn: 'ASF supervision fee, IUC, stamp duty, municipal fees.' },
  { key: 'outros', label: 'Outros', labelEn: 'Other', snc: '6268', sncLabel: 'Outros serviços', hint: 'Despesas que não encaixam nas restantes categorias.', hintEn: 'Expenses that do not fit the other categories.' },
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
