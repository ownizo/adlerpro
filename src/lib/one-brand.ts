/**
 * one-brand — brand + locale resolution for the individual-client (B2C) portal
 * (the `/one/*` routes).
 *
 * The same bundle powers two B2C front-ends that share ONE Supabase backend,
 * database and RLS:
 *   • osmeusseguros.com  → brand "Os Meus Seguros", Portuguese (the default)
 *   • mycovervault.com   → brand "My Cover Vault", English (UK conventions)
 *
 * The portals differ ONLY in language and branding — never in which clients or
 * data are shown. Everything here is keyed on the deploy, so the Portuguese
 * portal and the admin backoffice are byte-for-byte unchanged: when the deploy
 * is not My Cover Vault, `isMyCoverVault()` is `false` and the Portuguese
 * bundle (identical to the previous hard-coded strings) is returned.
 *
 * Detection order:
 *   1. Runtime hostname (`*.mycovervault.com`) — authoritative in the browser.
 *   2. Build-time flag injected by Vite from SITE_NAME / URL (see vite.config).
 */

declare const __IS_MYCOVERVAULT__: boolean

export function isMyCoverVault(): boolean {
  if (typeof window !== 'undefined') {
    return window.location.hostname.endsWith('mycovervault.com')
  }
  return __IS_MYCOVERVAULT__
}

export type OneLocale = 'pt-PT' | 'en-GB'

export function oneLocale(): OneLocale {
  return isMyCoverVault() ? 'en-GB' : 'pt-PT'
}

/* ─────────── locale-aware formatting ───────────
 * Premiums are held in EUR (Portuguese insurers). The English portal keeps the
 * currency (EUR) but formats it the UK way (€1,234.56) and uses DD/MM/YYYY
 * dates, as expected by English-speaking expats. */

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat(oneLocale(), { style: 'currency', currency: 'EUR' }).format(n)
}

export function fmtDate(s: string): string {
  if (!s) return '—'
  return isMyCoverVault()
    ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date(s).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(s: string): string {
  if (!s) return '—'
  return isMyCoverVault()
    ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(s).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ─────────── brand identity ─────────── */

export interface OneBrand {
  name: string
  tagline: string
  /** Small line under the wordmark on the login screen. */
  portalSubtitle: string
  /** <html>/document title and PWA-style title. */
  docTitle: string
  /** Regulatory disclosure line shown in the login footer. */
  regulatoryFooter: string
}

const BRAND_PT: OneBrand = {
  name: 'Os Meus Seguros',
  tagline: 'by Adler & Rochefort',
  portalSubtitle: 'Portal de Clientes Individuais',
  docTitle: 'Os Meus Seguros',
  regulatoryFooter: 'Adler & Rochefort · Ownizo Unipessoal Lda. · ASF n.º 425591790/3',
}

const BRAND_MCV: OneBrand = {
  name: 'My Cover Vault',
  tagline: 'by Adler & Rochefort',
  portalSubtitle: 'Client Portal',
  docTitle: 'My Cover Vault',
  regulatoryFooter: 'Adler & Rochefort · Ownizo Unipessoal Lda. · ASF reg. 425591790/3',
}

export function oneBrand(): OneBrand {
  return isMyCoverVault() ? BRAND_MCV : BRAND_PT
}

/* ─────────── UI strings ───────────
 * PT is the source of truth and reproduces exactly what each page previously
 * hard-coded. EN is the My Cover Vault translation. */

const PT = {
  nav: {
    dashboard: 'Dashboard',
    policies: 'Apólices',
    claims: 'Sinistros',
    documents: 'Documentos',
    profile: 'Perfil',
    signOut: 'Sair',
    menu: 'Menu',
  },
  mustChange: {
    text: '⚠ A sua password foi definida pelo seu mediador. Por segurança, altere-a.',
    cta: 'Alterar password agora →',
  },
  login: {
    welcome: 'Os Meus Seguros',
    signInTab: 'Entrar',
    registerTab: 'Criar Conta',
    email: 'Email',
    emailPlaceholder: 'o.seu@email.com',
    password: 'Password',
    passwordPlaceholderLogin: '••••••••',
    passwordPlaceholderRegister: 'Mínimo 6 caracteres',
    signIn: 'Entrar',
    register: 'Criar Conta',
    forgot: 'Esqueceu-se da password?',
    noAccount: 'Não tem conta?',
    invalidCredentials: 'Email ou password incorretos.',
    registerSuccess: 'Conta criada! Verifique o seu email para confirmar o registo antes de entrar.',
    resetSent: 'Se existir uma conta com este email, enviámos um link para redefinir a password.',
    resetError: 'Não foi possível enviar o link. Tente novamente.',
    emailRequired: 'Introduza o seu email.',
    termsPrefix: 'Li e aceito os ',
    termsLink: 'Termos de Serviço',
    termsSuffix:
      ' do Adler One. Autorizo a Adler & Rochefort, marca comercial da Ownizo Unipessoal LDA (registada na ASF com o n.º 425591790/3), a aceder e tratar os dados das minhas apólices, documentos, contactos, moradas, idades, prémios e datas de renovação, no âmbito da actividade de mediação de seguros. Aceito receber propostas de renovação e cotações relativas às apólices registadas na plataforma.',
    footerPrivate: 'Portal Privado',
  },
  reset: {
    title: 'Definir nova password',
    subtitle: 'Escolha uma nova password para a sua conta.',
    newPassword: 'Nova password',
    confirmPassword: 'Confirmar password',
    submit: 'Guardar password',
    saving: 'A guardar…',
    success: 'Password alterada. Já pode entrar.',
    mismatch: 'As passwords não coincidem.',
    tooShort: 'A password deve ter pelo menos 6 caracteres.',
    invalidLink: 'Link inválido ou expirado. Peça um novo link de recuperação.',
    backToLogin: 'Voltar ao início de sessão',
  },
  dashboard: {
    greeting: 'Olá',
    summary: 'Aqui está um resumo das suas apólices de seguro.',
    kpiActive: 'Apólices Ativas',
    kpiPremium: 'Prémio Anual Total',
    kpiRenewal: 'Próxima Renovação',
    yourPolicies: 'As Suas Apólices',
    noneRegistered: 'Sem apólices registadas.',
    noClientTitle: 'Conta sem apólices associadas.',
    noClientBody:
      ' Se já tem apólices geridas pela Adler Rochefort, contacte-nos para ligar a sua conta ao seu perfil.',
    loadError: 'Erro ao carregar dados. Tente novamente.',
    perYear: '/ano',
    renewsIn: (d: number) => `Renova em ${d}d`,
    renewsToday: 'Renova hoje',
    expired: 'Expirada',
  },
  policies: {
    title: 'As Suas Apólices',
    count: (n: number) => `${n} apólice${n !== 1 ? 's' : ''} registada${n !== 1 ? 's' : ''}`,
    none: 'Sem apólices registadas.',
    loadError: 'Erro ao carregar apólices.',
    addPolicy: '+ Adicionar apólice',
    extracting: 'A ler documento…',
    addTitle: 'Confirmar dados da apólice',
    fieldName: 'Nome / descrição',
    fieldType: 'Tipo de seguro',
    fieldInsurer: 'Seguradora',
    fieldNumber: 'Número da apólice',
    fieldStart: 'Data de início',
    fieldEnd: 'Data de fim',
    cancel: 'Cancelar',
    savePolicy: 'Guardar apólice',
    saving: 'A guardar…',
    addAuthError: 'A sessão expirou. Entre novamente.',
    addReadError: 'Não foi possível ler este documento.',
    addSaveError: 'Não foi possível guardar a apólice e o documento.',
    coverages: 'Coberturas',
    exclusions: 'Exclusões',
    documents: 'Documentos',
    addDocument: '+ Adicionar',
    uploading: 'A carregar…',
    uploaded: 'Carregado!',
    noDocs: 'Sem documentos para esta apólice.',
    view: 'Ver',
    open: 'Abrir',
    deleteDocument: 'Eliminar documento',
    deletePolicy: 'Eliminar apólice',
    deleting: 'A eliminar…',
    confirmDeleteDocument: 'Eliminar o documento "{name}"? Esta ação também o remove da área administrativa.',
    confirmDeletePolicy: 'Eliminar esta apólice e todos os documentos associados? Esta ação também a remove da área administrativa e não pode ser revertida.',
    deleteFailed: 'Não foi possível eliminar. Tente novamente.',
    perYear: '/ano',
    renewsIn: (d: number) => `Renova em ${d}d`,
    renewsToday: 'Renova hoje',
    expired: 'Expirada',
  },
  claims: {
    title: 'Sinistros',
    count: (n: number) => `${n} sinistro${n !== 1 ? 's' : ''} registado${n !== 1 ? 's' : ''}`,
    none: 'Sem sinistros registados.',
    loadError: 'Erro ao carregar sinistros.',
    newClaim: 'Novo Sinistro',
    cancel: 'Cancelar',
    formTitle: 'Novo Sinistro',
    fieldPolicy: 'Apólice Associada *',
    selectPolicy: 'Selecionar apólice',
    fieldTitle: 'Título *',
    titlePlaceholder: 'Resumo do sinistro',
    fieldDescription: 'Descrição *',
    descriptionPlaceholder: 'Descrição detalhada do ocorrido',
    fieldIncidentDate: 'Data do Incidente *',
    fieldEstimated: 'Valor Estimado (EUR)',
    submit: 'Submeter Sinistro',
    submitting: 'A submeter...',
    selectPolicyError: 'Selecione uma apólice associada.',
    submitError: 'Erro ao submeter sinistro. Tente novamente.',
    incident: 'Incidente',
    submitted: 'Submetido',
    description: 'Descrição',
    documents: 'Documentos',
    addFile: 'Adicionar ficheiro',
    uploadingFile: 'A carregar...',
    noDocs: 'Sem documentos neste sinistro.',
    download: 'Download',
    messages: 'Mensagens',
    noMessages: 'Ainda sem mensagens.',
    replyPlaceholder: 'Escreva a sua resposta...',
    send: 'Enviar',
    loading: 'A carregar...',
  },
  documents: {
    title: 'Documentos',
    count: (n: number) => `${n} documento${n !== 1 ? 's' : ''}`,
    add: 'Adicionar Documento',
    takePhoto: 'Tirar Foto',
    chooseFile: 'Escolher Ficheiro',
    uploadingName: (name: string) => `A carregar ${name}…`,
    uploadOk: 'Carregado com sucesso!',
    unknownError: 'Erro desconhecido',
    networkError: 'Erro de rede',
    emptyTitle: 'Sem documentos disponíveis',
    emptyBody: 'Os seus documentos serão disponibilizados aqui pela Adler Rochefort.',
    loadError: 'Erro ao carregar documentos.',
    view: 'Ver',
    open: 'Abrir',
    openError: 'Erro ao abrir documento: ',
    delete: 'Eliminar',
    deleting: 'A eliminar…',
    confirmDelete: 'Eliminar o documento "{name}"? Esta ação também o remove da área administrativa.',
    deleteError: 'Não foi possível eliminar o documento. Tente novamente.',
  },
  profile: {
    title: 'Perfil',
    subtitle: 'Os seus dados pessoais',
    notFoundTitle: 'Perfil não encontrado.',
    notFoundBody: ' Contacte a Adler Rochefort para associar a sua conta ao seu perfil.',
    saveOk: 'Dados actualizados com sucesso.',
    personalData: 'Dados Pessoais',
    fullName: 'Nome Completo',
    nif: 'NIF',
    email: 'Email',
    phone: 'Telefone',
    address: 'Morada',
    changePassword: 'Alterar Password',
    newPassword: 'Nova password',
    newPasswordPlaceholder: 'Mínimo 6 caracteres',
    confirmPassword: 'Confirmar password',
    confirmPasswordPlaceholder: 'Repetir password',
    changePasswordBtn: 'Alterar password',
    changingPassword: 'A alterar...',
    pwTooShort: 'A password deve ter pelo menos 6 caracteres.',
    pwMismatch: 'As passwords não coincidem.',
    pwError: 'Erro ao alterar password.',
    updateContact: 'Actualizar Contacto',
    edit: 'Editar',
    phonePlaceholder: '+351 912 345 678',
    addressPlaceholder: 'Rua, número, código postal',
    save: 'Guardar',
    saving: 'A guardar...',
    cancel: 'Cancelar',
    loadError: 'Erro ao carregar perfil.',
    saveError: 'Erro ao guardar. Tente novamente.',
  },
  types: {
    property: 'Propriedade',
    liability: 'Responsabilidade Civil',
    workers_comp: 'Acidentes de Trabalho',
    auto: 'Automóvel',
    health: 'Saúde',
    cyber: 'Ciber-Risco',
    directors_officers: 'D&O',
    business_interruption: 'Interrupção de Negócio',
  },
  policyStatus: {
    ativa: 'Ativa',
    active: 'Ativa',
    expiring: 'A Renovar',
    expired: 'Expirada',
    cancelled: 'Cancelada',
  },
  claimStatus: {
    submitted: 'Submetido',
    under_review: 'Em Análise',
    documentation: 'Documentação',
    assessment: 'Avaliação',
    approved: 'Aprovado',
    denied: 'Recusado',
    paid: 'Pago',
  },
  categories: {
    policy: 'Apólice',
    claim: 'Sinistro',
    invoice: 'Fatura',
    report: 'Relatório',
    certificate: 'Certificado',
    other: 'Outro',
  },
  detail: {
    start: 'Início',
    end: 'Fim',
    renewal: 'Renovação',
    payment: 'Pagamento',
    deductible: 'Franquia',
    description: 'Descrição',
  },
}

export type OneStrings = typeof PT

const EN: OneStrings = {
  nav: {
    dashboard: 'Dashboard',
    policies: 'Policies',
    claims: 'Claims',
    documents: 'Documents',
    profile: 'Profile',
    signOut: 'Sign out',
    menu: 'Menu',
  },
  mustChange: {
    text: '⚠ Your password was set by your broker. For your security, please change it.',
    cta: 'Change password now →',
  },
  login: {
    welcome: 'Welcome to My Cover Vault',
    signInTab: 'Sign in',
    registerTab: 'Create account',
    email: 'Email',
    emailPlaceholder: 'you@email.com',
    password: 'Password',
    passwordPlaceholderLogin: '••••••••',
    passwordPlaceholderRegister: 'Minimum 6 characters',
    signIn: 'Sign in',
    register: 'Create account',
    forgot: 'Forgot your password?',
    noAccount: "Don't have an account?",
    invalidCredentials: 'Incorrect email or password.',
    registerSuccess: 'Account created! Check your email to confirm your registration before signing in.',
    resetSent: 'If an account exists for this email, we have sent a link to reset your password.',
    resetError: 'We could not send the link. Please try again.',
    emailRequired: 'Please enter your email.',
    termsPrefix: 'I have read and accept the ',
    termsLink: 'Terms of Service',
    termsSuffix:
      '. I authorise Adler & Rochefort, a trading name of Ownizo Unipessoal Lda. (registered with the ASF under no. 425591790/3), to access and process the data of my policies, documents, contacts, addresses, ages, premiums and renewal dates, in the course of its insurance mediation activity. I agree to receive renewal proposals and quotes relating to the policies registered on the platform.',
    footerPrivate: 'Private Portal',
  },
  reset: {
    title: 'Set a new password',
    subtitle: 'Choose a new password for your account.',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    submit: 'Save password',
    saving: 'Saving…',
    success: 'Password changed. You can now sign in.',
    mismatch: 'Passwords do not match.',
    tooShort: 'Password must be at least 6 characters.',
    invalidLink: 'Invalid or expired link. Please request a new reset link.',
    backToLogin: 'Back to sign in',
  },
  dashboard: {
    greeting: 'Hello',
    summary: "Here's an overview of your insurance policies.",
    kpiActive: 'Active Policies',
    kpiPremium: 'Total Annual Premium',
    kpiRenewal: 'Next Renewal',
    yourPolicies: 'Your Policies',
    noneRegistered: 'No policies on record.',
    noClientTitle: 'Account with no linked policies.',
    noClientBody:
      ' If you already have policies managed by Adler & Rochefort, contact us to link your account to your profile.',
    loadError: 'Could not load your data. Please try again.',
    perYear: '/yr',
    renewsIn: (d: number) => `Renews in ${d}d`,
    renewsToday: 'Renews today',
    expired: 'Expired',
  },
  policies: {
    title: 'Your Policies',
    count: (n: number) => `${n} ${n !== 1 ? 'policies' : 'policy'} on record`,
    none: 'No policies on record.',
    loadError: 'Could not load your policies.',
    addPolicy: '+ Add policy',
    extracting: 'Reading document…',
    addTitle: 'Confirm policy details',
    fieldName: 'Name / description',
    fieldType: 'Insurance type',
    fieldInsurer: 'Insurer',
    fieldNumber: 'Policy number',
    fieldStart: 'Start date',
    fieldEnd: 'End date',
    cancel: 'Cancel',
    savePolicy: 'Save policy',
    saving: 'Saving…',
    addAuthError: 'Your session expired. Please sign in again.',
    addReadError: 'This document could not be read.',
    addSaveError: 'The policy and document could not be saved.',
    coverages: 'Coverage',
    exclusions: 'Exclusions',
    documents: 'Documents',
    addDocument: '+ Add',
    uploading: 'Uploading…',
    uploaded: 'Uploaded!',
    noDocs: 'No documents for this policy.',
    view: 'View',
    open: 'Open',
    deleteDocument: 'Delete document',
    deletePolicy: 'Delete policy',
    deleting: 'Deleting…',
    confirmDeleteDocument: 'Delete the document "{name}"? This also removes it from the admin area.',
    confirmDeletePolicy: 'Delete this policy and all associated documents? This also removes it from the admin area and cannot be undone.',
    deleteFailed: 'The item could not be deleted. Please try again.',
    perYear: '/yr',
    renewsIn: (d: number) => `Renews in ${d}d`,
    renewsToday: 'Renews today',
    expired: 'Expired',
  },
  claims: {
    title: 'Claims',
    count: (n: number) => `${n} claim${n !== 1 ? 's' : ''} on record`,
    none: 'No claims on record.',
    loadError: 'Could not load your claims.',
    newClaim: 'New Claim',
    cancel: 'Cancel',
    formTitle: 'New Claim',
    fieldPolicy: 'Related Policy *',
    selectPolicy: 'Select a policy',
    fieldTitle: 'Title *',
    titlePlaceholder: 'Claim summary',
    fieldDescription: 'Description *',
    descriptionPlaceholder: 'Detailed description of what happened',
    fieldIncidentDate: 'Incident Date *',
    fieldEstimated: 'Estimated Value (EUR)',
    submit: 'Submit Claim',
    submitting: 'Submitting...',
    selectPolicyError: 'Please select a related policy.',
    submitError: 'Could not submit the claim. Please try again.',
    incident: 'Incident',
    submitted: 'Submitted',
    description: 'Description',
    documents: 'Documents',
    addFile: 'Add file',
    uploadingFile: 'Uploading...',
    noDocs: 'No documents on this claim.',
    download: 'Download',
    messages: 'Messages',
    noMessages: 'No messages yet.',
    replyPlaceholder: 'Write your reply...',
    send: 'Send',
    loading: 'Loading...',
  },
  documents: {
    title: 'Documents',
    count: (n: number) => `${n} document${n !== 1 ? 's' : ''}`,
    add: 'Add Document',
    takePhoto: 'Take Photo',
    chooseFile: 'Choose File',
    uploadingName: (name: string) => `Uploading ${name}…`,
    uploadOk: 'Uploaded successfully!',
    unknownError: 'Unknown error',
    networkError: 'Network error',
    emptyTitle: 'No documents available',
    emptyBody: 'Your documents will be made available here by Adler & Rochefort.',
    loadError: 'Could not load your documents.',
    view: 'View',
    open: 'Open',
    openError: 'Could not open document: ',
    delete: 'Delete',
    deleting: 'Deleting…',
    confirmDelete: 'Delete the document "{name}"? This also removes it from the admin area.',
    deleteError: 'The document could not be deleted. Please try again.',
  },
  profile: {
    title: 'Profile',
    subtitle: 'Your personal details',
    notFoundTitle: 'Profile not found.',
    notFoundBody: ' Contact Adler & Rochefort to link your account to your profile.',
    saveOk: 'Details updated successfully.',
    personalData: 'Personal Details',
    fullName: 'Full Name',
    nif: 'Tax No. (NIF)',
    email: 'Email',
    phone: 'Phone',
    address: 'Address',
    changePassword: 'Change Password',
    newPassword: 'New password',
    newPasswordPlaceholder: 'Minimum 6 characters',
    confirmPassword: 'Confirm password',
    confirmPasswordPlaceholder: 'Repeat password',
    changePasswordBtn: 'Change password',
    changingPassword: 'Changing...',
    pwTooShort: 'Password must be at least 6 characters.',
    pwMismatch: 'Passwords do not match.',
    pwError: 'Could not change password.',
    updateContact: 'Update Contact',
    edit: 'Edit',
    phonePlaceholder: '+44 7700 900000',
    addressPlaceholder: 'Street, number, postcode',
    save: 'Save',
    saving: 'Saving...',
    cancel: 'Cancel',
    loadError: 'Could not load your profile.',
    saveError: 'Could not save. Please try again.',
  },
  types: {
    property: 'Property',
    liability: 'Liability',
    workers_comp: 'Workers Compensation',
    auto: 'Motor',
    health: 'Health',
    cyber: 'Cyber Risk',
    directors_officers: 'D&O',
    business_interruption: 'Business Interruption',
  },
  policyStatus: {
    ativa: 'Active',
    active: 'Active',
    expiring: 'Renewing',
    expired: 'Expired',
    cancelled: 'Cancelled',
  },
  claimStatus: {
    submitted: 'Submitted',
    under_review: 'Under Review',
    documentation: 'Documentation',
    assessment: 'Assessment',
    approved: 'Approved',
    denied: 'Denied',
    paid: 'Paid',
  },
  categories: {
    policy: 'Policy',
    claim: 'Claim',
    invoice: 'Invoice',
    report: 'Report',
    certificate: 'Certificate',
    other: 'Other',
  },
  detail: {
    start: 'Start',
    end: 'End',
    renewal: 'Renewal',
    payment: 'Payment',
    deductible: 'Deductible',
    description: 'Description',
  },
}

/** The active string bundle for this deploy. */
export function oneT(): OneStrings {
  return isMyCoverVault() ? EN : PT
}

/** Portuguese type/status labels imported verbatim from the vault also need to
 *  survive the lookup; the raw value is used as fallback when absent. */
export function typeLabel(type: string): string {
  const t = oneT().types as Record<string, string>
  if (t[type]) return t[type]
  // Portuguese source names occasionally arrive as free text.
  const legacy: Record<string, string> = {
    Automovel: t.auto ?? type,
    'Multirriscos Habitacao': isMyCoverVault() ? 'Home Multi-risk' : 'Multirriscos Habitação',
    'MR Empresas': isMyCoverVault() ? 'Business Multi-risk' : 'MR Empresas',
    'Responsabilidade Civil': t.liability ?? type,
  }
  return legacy[type] ?? type
}
