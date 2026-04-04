import type {
  Company,
  CompanyUser,
  Policy,
  Claim,
  Document,
  Alert,
  RiskReport,
  ApiConnection,
  UserMetricEvent,
} from './types'

const DEMO_COMPANY_ID = 'comp_001'

export function getSeedCompanies(): Company[] {
  return [
    {
      id: DEMO_COMPANY_ID,
      name: 'TechVista Lda.',
      nif: '509123456',
      sector: 'Tecnologia',
      contactName: 'Ana Ferreira',
      contactEmail: 'ana.ferreira@techvista.pt',
      contactPhone: '+351 912 345 678',
      accessEmail: 'portal@techvista.pt',
      address: 'Av. da Liberdade 110, 1250-146 Lisboa',
      createdAt: '2024-01-15T10:00:00Z',
    },
    {
      id: 'comp_002',
      name: 'Porto Construções S.A.',
      nif: '501987654',
      sector: 'Construção',
      contactName: 'Carlos Mendes',
      contactEmail: 'carlos@portoconstrucoes.pt',
      contactPhone: '+351 926 789 012',
      accessEmail: 'portal@portoconstrucoes.pt',
      address: 'Rua de Santa Catarina 500, 4000-446 Porto',
      createdAt: '2024-03-10T14:30:00Z',
    },
  ]
}

export function getSeedCompanyUsers(): CompanyUser[] {
  return [
    {
      id: 'usr_001',
      companyId: DEMO_COMPANY_ID,
      name: 'Ana Ferreira',
      email: 'ana.ferreira@techvista.pt',
      role: 'owner',
      accessPassword: 'Temp#1234',
      lastLoginAt: '2026-03-30T09:20:00Z',
      createdAt: '2024-01-15T10:10:00Z',
    },
    {
      id: 'usr_002',
      companyId: DEMO_COMPANY_ID,
      name: 'Miguel Duarte',
      email: 'miguel.duarte@techvista.pt',
      role: 'manager',
      accessPassword: 'Temp#1234',
      lastLoginAt: '2026-03-29T14:05:00Z',
      createdAt: '2024-04-11T08:30:00Z',
    },
    {
      id: 'usr_003',
      companyId: 'comp_002',
      name: 'Carlos Mendes',
      email: 'carlos@portoconstrucoes.pt',
      role: 'owner',
      accessPassword: 'Temp#1234',
      lastLoginAt: '2026-03-20T11:25:00Z',
      createdAt: '2024-03-10T14:40:00Z',
    },
  ]
}

export function getSeedApiConnections(): ApiConnection[] {
  return [
    {
      id: 'api_001',
      service: 'Bizapis',
      status: 'connected',
      latency: '120ms',
      endpoint: '/api/verify-seguro',
      lastSync: new Date().toISOString(),
      notes: 'Consulta de seguros por matrícula',
    },
    {
      id: 'api_002',
      service: 'RegCheck',
      status: 'connected',
      latency: '90ms',
      endpoint: '/api/verify-plate',
      lastSync: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
      notes: 'Validação de matrículas',
    },
    {
      id: 'api_003',
      service: 'OpenAI',
      status: 'connected',
      latency: '340ms',
      endpoint: '/api/extract-policy',
      lastSync: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      notes: 'Extração de dados de apólices',
    },
    {
      id: 'api_004',
      service: 'Análise de Parceiros',
      status: 'degraded',
      latency: '510ms',
      endpoint: '/api/analyze-partner',
      lastSync: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
  ]
}

export function getSeedUserMetricEvents(): UserMetricEvent[] {
  return [
    {
      id: 'evt_001',
      companyId: DEMO_COMPANY_ID,
      userId: 'usr_001',
      timestamp: '2026-03-30T09:20:00Z',
      type: 'login',
      description: 'Início de sessão no painel de cliente',
    },
    {
      id: 'evt_002',
      companyId: DEMO_COMPANY_ID,
      userId: 'usr_001',
      timestamp: '2026-03-30T09:32:00Z',
      type: 'document_upload',
      description: 'Upload de documento da apólice RC Profissional',
    },
    {
      id: 'evt_003',
      companyId: DEMO_COMPANY_ID,
      userId: 'usr_002',
      timestamp: '2026-03-29T14:05:00Z',
      type: 'login',
      description: 'Início de sessão no painel de cliente',
    },
    {
      id: 'evt_004',
      companyId: 'comp_002',
      userId: 'usr_003',
      timestamp: '2026-03-20T11:25:00Z',
      type: 'login',
      description: 'Início de sessão no painel de cliente',
    },
  ]
}

export function getSeedPolicies(): Policy[] {
  return [
    {
      id: 'pol_001',
      companyId: DEMO_COMPANY_ID,
      type: 'property',
      insurer: 'Fidelidade',
      policyNumber: 'FID-2024-001234',
      description: 'Seguro Multi-Riscos do escritório sede em Lisboa',
      startDate: '2024-01-01',
      endDate: '2025-01-01',
      annualPremium: 4500,
      insuredValue: 750000,
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'pol_002',
      companyId: DEMO_COMPANY_ID,
      type: 'liability',
      insurer: 'Allianz',
      policyNumber: 'ALZ-2024-005678',
      description: 'Responsabilidade Civil Profissional',
      startDate: '2024-03-01',
      endDate: '2025-03-01',
      annualPremium: 3200,
      insuredValue: 500000,
      status: 'active',
      createdAt: '2024-03-01T00:00:00Z',
    },
    {
      id: 'pol_003',
      companyId: DEMO_COMPANY_ID,
      type: 'workers_comp',
      insurer: 'Tranquilidade',
      policyNumber: 'TRQ-2024-009012',
      description: 'Acidentes de Trabalho - 45 colaboradores',
      startDate: '2024-06-01',
      endDate: '2025-06-01',
      annualPremium: 8900,
      insuredValue: 2000000,
      status: 'active',
      createdAt: '2024-06-01T00:00:00Z',
    },
    {
      id: 'pol_004',
      companyId: DEMO_COMPANY_ID,
      type: 'cyber',
      insurer: 'AXA',
      policyNumber: 'AXA-2024-003456',
      description: 'Seguro Ciber-Risco e Proteção de Dados',
      startDate: '2024-02-15',
      endDate: '2025-02-15',
      annualPremium: 6700,
      insuredValue: 1000000,
      status: 'expiring',
      createdAt: '2024-02-15T00:00:00Z',
    },
    {
      id: 'pol_005',
      companyId: DEMO_COMPANY_ID,
      type: 'auto',
      insurer: 'Generali',
      policyNumber: 'GEN-2024-007890',
      description: 'Frota automóvel - 8 viaturas',
      startDate: '2024-04-01',
      endDate: '2025-04-01',
      annualPremium: 5600,
      insuredValue: 320000,
      status: 'active',
      createdAt: '2024-04-01T00:00:00Z',
    },
    {
      id: 'pol_006',
      companyId: DEMO_COMPANY_ID,
      type: 'health',
      insurer: 'Multicare',
      policyNumber: 'MLC-2024-002345',
      description: 'Seguro de Saúde Coletivo - 45 colaboradores',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      annualPremium: 22500,
      insuredValue: 0,
      status: 'expired',
      createdAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'pol_007',
      companyId: 'comp_002',
      type: 'property',
      insurer: 'Fidelidade',
      policyNumber: 'FID-2024-004567',
      description: 'Seguro de Obra - Empreendimento Matosinhos',
      startDate: '2024-05-01',
      endDate: '2026-05-01',
      annualPremium: 15000,
      insuredValue: 5000000,
      status: 'active',
      createdAt: '2024-05-01T00:00:00Z',
    },
    {
      id: 'pol_008',
      companyId: 'comp_002',
      type: 'workers_comp',
      insurer: 'Tranquilidade',
      policyNumber: 'TRQ-2024-006789',
      description: 'Acidentes de Trabalho - 120 operários',
      startDate: '2024-03-15',
      endDate: '2025-03-15',
      annualPremium: 28000,
      insuredValue: 8000000,
      status: 'active',
      createdAt: '2024-03-15T00:00:00Z',
    },
  ]
}

export function getSeedClaims(): Claim[] {
  return [
    {
      id: 'clm_001',
      policyId: 'pol_001',
      companyId: DEMO_COMPANY_ID,
      title: 'Inundação no escritório - Piso 2',
      description:
        'Rotura de canalização provocou inundação no piso 2 do escritório, danificando equipamento informático e mobiliário.',
      claimDate: '2024-09-15',
      incidentDate: '2024-09-14',
      estimatedValue: 25000,
      status: 'assessment',
      steps: [
        { status: 'submitted', date: '2024-09-15', notes: 'Sinistro reportado' },
        { status: 'under_review', date: '2024-09-16', notes: 'Análise iniciada pela seguradora' },
        { status: 'documentation', date: '2024-09-18', notes: 'Documentação adicional solicitada' },
        { status: 'assessment', date: '2024-09-25', notes: 'Perito designado para avaliação' },
      ],
      createdAt: '2024-09-15T08:30:00Z',
    },
    {
      id: 'clm_002',
      policyId: 'pol_005',
      companyId: DEMO_COMPANY_ID,
      title: 'Acidente viatura 45-AB-67',
      description:
        'Colisão traseira em hora de ponta na A5. Danos na traseira do veículo, sem feridos.',
      claimDate: '2024-10-02',
      incidentDate: '2024-10-01',
      estimatedValue: 8500,
      status: 'approved',
      steps: [
        { status: 'submitted', date: '2024-10-02', notes: 'Participação submetida' },
        { status: 'under_review', date: '2024-10-03', notes: 'Em análise' },
        { status: 'documentation', date: '2024-10-05', notes: 'Relatório policial anexado' },
        { status: 'assessment', date: '2024-10-10', notes: 'Orçamento da oficina aprovado' },
        { status: 'approved', date: '2024-10-15', notes: 'Indemnização aprovada: 7.800 EUR' },
      ],
      createdAt: '2024-10-02T14:00:00Z',
    },
    {
      id: 'clm_003',
      policyId: 'pol_003',
      companyId: DEMO_COMPANY_ID,
      title: 'Acidente de trabalho - Queda em armazém',
      description:
        'Colaborador sofreu queda no armazém durante operação de inventário. Fratura no pulso direito.',
      claimDate: '2024-11-10',
      incidentDate: '2024-11-10',
      estimatedValue: 12000,
      status: 'under_review',
      steps: [
        { status: 'submitted', date: '2024-11-10', notes: 'Sinistro participado' },
        { status: 'under_review', date: '2024-11-11', notes: 'Documentação médica em análise' },
      ],
      createdAt: '2024-11-10T16:45:00Z',
    },
  ]
}

export function getSeedDocuments(): Document[] {
  return [
    {
      id: 'doc_001',
      companyId: DEMO_COMPANY_ID,
      name: 'Apólice Multi-Riscos FID-2024-001234.pdf',
      category: 'policy',
      size: 245000,
      uploadedBy: 'Sistema',
      uploadedAt: '2024-01-02T10:00:00Z',
      blobKey: 'documents/comp_001/doc_001.pdf',
    },
    {
      id: 'doc_002',
      companyId: DEMO_COMPANY_ID,
      name: 'Certificado RC Profissional.pdf',
      category: 'certificate',
      size: 180000,
      uploadedBy: 'Ana Ferreira',
      uploadedAt: '2024-03-05T14:20:00Z',
      blobKey: 'documents/comp_001/doc_002.pdf',
    },
    {
      id: 'doc_003',
      companyId: DEMO_COMPANY_ID,
      name: 'Relatório Sinistro Inundação.pdf',
      category: 'claim',
      size: 520000,
      uploadedBy: 'Sistema',
      uploadedAt: '2024-09-16T09:15:00Z',
      blobKey: 'documents/comp_001/doc_003.pdf',
    },
    {
      id: 'doc_004',
      companyId: DEMO_COMPANY_ID,
      name: 'Fatura Prémio Q4 2024.pdf',
      category: 'invoice',
      size: 95000,
      uploadedBy: 'Sistema',
      uploadedAt: '2024-10-01T08:00:00Z',
      blobKey: 'documents/comp_001/doc_004.pdf',
    },
    {
      id: 'doc_005',
      companyId: DEMO_COMPANY_ID,
      name: 'Relatório Risco Anual 2024.pdf',
      category: 'report',
      size: 890000,
      uploadedBy: 'IA Adler & Rochefort',
      uploadedAt: '2024-12-15T11:30:00Z',
      blobKey: 'documents/comp_001/doc_005.pdf',
    },
  ]
}

export function getSeedAlerts(): Alert[] {
  return [
    {
      id: 'alr_001',
      companyId: DEMO_COMPANY_ID,
      type: 'renewal',
      title: 'Renovação Próxima',
      message:
        'A apólice de Ciber-Risco (AXA-2024-003456) expira em 45 dias. Contacte o seu gestor para renovação.',
      read: false,
      createdAt: '2024-12-28T09:00:00Z',
    },
    {
      id: 'alr_002',
      companyId: DEMO_COMPANY_ID,
      type: 'claim_update',
      title: 'Atualização de Sinistro',
      message:
        'O perito foi designado para avaliação do sinistro de inundação (CLM-001). Visita agendada para a próxima semana.',
      read: false,
      createdAt: '2024-12-20T15:30:00Z',
    },
    {
      id: 'alr_003',
      companyId: DEMO_COMPANY_ID,
      type: 'payment',
      title: 'Pagamento Processado',
      message: 'O prémio trimestral de 11.225 EUR foi debitado com sucesso.',
      read: true,
      createdAt: '2024-12-15T10:00:00Z',
    },
    {
      id: 'alr_004',
      companyId: DEMO_COMPANY_ID,
      type: 'document',
      title: 'Novo Documento',
      message:
        'O relatório de risco anual 2024 foi gerado e está disponível no Cofre de Documentos.',
      read: true,
      createdAt: '2024-12-15T11:30:00Z',
    },
    {
      id: 'alr_005',
      companyId: DEMO_COMPANY_ID,
      type: 'general',
      title: 'Feliz Ano Novo',
      message:
        'A equipa Adler & Rochefort deseja-lhe um excelente 2025. O nosso escritório estará encerrado de 24 a 26 de dezembro.',
      read: true,
      createdAt: '2024-12-20T08:00:00Z',
    },
  ]
}

export function getSeedRiskReports(): RiskReport[] {
  return [
    {
      id: 'rpt_001',
      companyId: DEMO_COMPANY_ID,
      generatedAt: '2024-12-15T11:30:00Z',
      summary:
        'Perfil de risco global: Moderado. Principais áreas de atenção: ciber-risco e continuidade de negócio.',
      content: `# Relatório de Risco Anual 2024 - TechVista Lda.

## Resumo Executivo
A TechVista Lda. apresenta um perfil de risco global **moderado**, com uma carteira de seguros bem diversificada. As principais áreas de atenção identificadas são o ciber-risco e a continuidade de negócio.

## Análise por Área

### Propriedade e Ativos
- **Risco**: Baixo a Moderado
- Escritório sede adequadamente coberto
- Recomendação: Atualizar valor segurado face à valorização imobiliária

### Responsabilidade Civil
- **Risco**: Moderado
- Cobertura RC Profissional adequada para o volume de negócios atual
- Recomendação: Considerar aumento do capital segurado se faturação crescer >20%

### Ciber-Risco
- **Risco**: Elevado
- Setor tecnológico com elevada exposição a ataques cibernéticos
- Apólice atual com limite de 1M EUR pode ser insuficiente
- Recomendação: Aumentar cobertura para 2M EUR e incluir cláusula de ransomware

### Recursos Humanos
- **Risco**: Baixo
- Seguro de acidentes de trabalho adequado para 45 colaboradores
- Seguro de saúde coletivo com boa cobertura

## Recomendações Prioritárias
1. Renovar e reforçar apólice de ciber-risco antes do vencimento
2. Considerar seguro de interrupção de negócio (atualmente não coberto)
3. Atualizar inventário de ativos para reavaliação do seguro multi-riscos`,
    },
  ]
}
