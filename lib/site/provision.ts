import type { Prisma, SiteBuildStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { grantTokens } from '@/lib/tokens/ledger';
import { recordAudit } from '@/lib/security/audit';
import { APP_CONFIG, TIMEOUTS, TOKENS_PER_SITE } from '@/lib/constants';
import { siteHost, siteUrl } from '@/lib/subdomain';
import { formatCNPJ } from '@/lib/utils';
import { buildSiteContentFromRegistry, siteContentToJson } from '@/lib/company/profile';
import { brasilAPIService } from '@/services/brasil-api';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_BG_COLOR,
  SITE_TEMPLATE_LABELS,
  isSiteTemplateKey,
  parseTheme,
  type SiteTemplateKey,
} from '@/components/site-templates/types';

/**
 * Máquina de estados do provisionamento de um site.
 *
 * QUEUED ──claim──▶ BUILDING ──6 etapas──▶ READY
 *                      └────── erro ─────▶ FAILED (+ estorno dos tokens)
 *
 * Três regras governam tudo aqui:
 *
 * 1. IDEMPOTÊNCIA. Toda transição é um `updateMany` condicional no estado atual.
 *    Só a chamada que consegue mover a linha executa o efeito — reexecutar
 *    `provisionSite` sobre o mesmo site não duplica etapa, não republica e,
 *    principalmente, não estorna tokens duas vezes.
 *
 * 2. INTEGRIDADE DE SALDO. `createSite` cobra TOKENS_PER_SITE antes de o site
 *    existir de fato. Se o provisionamento falhar, os tokens voltam pelo razão
 *    (`grantTokens`), dentro da MESMA transação que marca FAILED — a trava
 *    `buildStatus: 'BUILDING'` é o que garante exatamente um estorno.
 *
 * 3. DIÁRIO PERSISTIDO. A tela "Montando." mostra etapa a etapa com tempo
 *    decorrido; isso exige estado no servidor, não animação fingida no cliente.
 *    O diário vive em `Site.content.build` porque o schema (que não podemos
 *    alterar) não tem coluna própria — `parseContent` dos templates ignora
 *    chaves desconhecidas, então a página pública não é afetada.
 */

/* ============================================================================
 * ETAPAS
 * ==========================================================================*/

export const BUILD_STEP_KEYS = [
  'receita',
  'identidade',
  'textos',
  'privacidade',
  'publicacao',
  'verificacao',
] as const;

export type BuildStepKey = (typeof BUILD_STEP_KEYS)[number];

export type BuildStepState = 'pendente' | 'executando' | 'concluida' | 'falhou';

export interface BuildStepDefinition {
  key: BuildStepKey;
  label: string;
  hint: string;
}

/** Rótulos vivem no código, não no banco: mudar o texto não exige migrar diário antigo. */
export const BUILD_STEPS: readonly BuildStepDefinition[] = [
  {
    key: 'receita',
    label: 'Consultando a Receita Federal',
    hint: 'Razão social, endereço, atividades e porte a partir do CNPJ',
  },
  {
    key: 'identidade',
    label: 'Definindo a identidade visual',
    hint: 'Template, cor de fundo e cor de destaque da página',
  },
  {
    key: 'textos',
    label: 'Escrevendo os textos institucionais',
    hint: 'Apresentação, áreas de atuação, endereço e contato',
  },
  {
    key: 'privacidade',
    label: 'Gerando a política de privacidade',
    hint: 'Aviso de LGPD com os dados do controlador',
  },
  {
    key: 'publicacao',
    label: 'Publicando o subdomínio',
    hint: 'Site no ar com a tag de verificação no <head>',
  },
  {
    key: 'verificacao',
    label: 'Conferindo a tag de verificação',
    hint: 'Leitura do HTML publicado, do jeito que a Meta lê',
  },
];

const TOTAL_STEPS = BUILD_STEPS.length;

/* ============================================================================
 * DIÁRIO DO BUILD (Site.content.build)
 * ==========================================================================*/

/** Chave reservada dentro de `Site.content`. Nenhum template a renderiza. */
const JOURNAL_KEY = 'build';
const JOURNAL_VERSION = 1;

interface JournalStep {
  key: BuildStepKey;
  state: BuildStepState;
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

interface BuildJournal {
  version: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** Quantos tokens voltaram para o usuário quando o build falhou. */
  refundedTokens: number;
  steps: JournalStep[];
}

/** Etapa como a API e a tela enxergam: diário + rótulo. */
export interface BuildStepView extends BuildStepDefinition, Omit<JournalStep, 'key'> {}

export interface BuildStatusView {
  siteId: string;
  status: SiteBuildStatus;
  steps: BuildStepView[];
  /** Índice da etapa em execução; `null` quando nada está rodando. */
  currentStep: number | null;
  completedSteps: number;
  totalSteps: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  refundedTokens: number;
  host: string;
  url: string;
}

/* ============================================================================
 * JSON: normalização sem `as`
 * ==========================================================================*/

/**
 * JSON estrito. Existe para que o payload bruto da Receita entre em
 * `registryData` sem cast e sem risco de `undefined`/função vazando para o
 * Prisma. `BuildJson` é estruturalmente compatível com `Prisma.InputJsonValue`.
 */
export type BuildJson = string | number | boolean | BuildJson[] | { [key: string]: BuildJson };

type JsonRecord = { [key: string]: BuildJson };

const MAX_JSON_DEPTH = 8;
const MAX_JSON_ITEMS = 200;
const MAX_JSON_KEYS = 200;
const MAX_JSON_STRING = 4_000;

/**
 * Copia o valor mantendo só o que é JSON válido. Descarta `null`/`undefined`,
 * funções, Symbol e ciclos (pelo teto de profundidade), e corta strings e
 * coleções gigantes — `registryData` não pode virar um blob que a página do
 * painel carrega a cada render.
 */
function sanitizeJson(value: unknown, depth = 0): BuildJson | null {
  if (typeof value === 'string') return value.slice(0, MAX_JSON_STRING);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  if (depth >= MAX_JSON_DEPTH) return null;

  if (Array.isArray(value)) {
    const items: BuildJson[] = [];

    for (const item of value.slice(0, MAX_JSON_ITEMS)) {
      const clean = sanitizeJson(item, depth + 1);
      if (clean !== null) items.push(clean);
    }

    return items;
  }

  if (typeof value === 'object') {
    const output: JsonRecord = {};
    let kept = 0;

    for (const [key, item] of Object.entries(value)) {
      if (kept >= MAX_JSON_KEYS) break;

      const clean = sanitizeJson(item, depth + 1);
      if (clean === null) continue;

      output[key] = clean;
      kept += 1;
    }

    return output;
  }

  return null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const asIso = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const asStepState = (value: unknown): BuildStepState => {
  if (
    value === 'pendente' ||
    value === 'executando' ||
    value === 'concluida' ||
    value === 'falhou'
  ) {
    return value;
  }
  return 'pendente';
};

function toJsonRecord(value: unknown): JsonRecord {
  const clean = sanitizeJson(value);

  if (clean === null || typeof clean !== 'object' || Array.isArray(clean)) {
    return {};
  }

  return clean;
}

/* ============================================================================
 * LEITURA DO DIÁRIO
 * ==========================================================================*/

function emptyJournal(): BuildJournal {
  return {
    version: JOURNAL_VERSION,
    startedAt: null,
    finishedAt: null,
    refundedTokens: 0,
    steps: BUILD_STEPS.map((step) => ({
      key: step.key,
      state: 'pendente',
      detail: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      error: null,
    })),
  };
}

/**
 * Reconstrói o diário sempre na ordem canônica das etapas. Diário gravado por
 * uma versão anterior (com etapas a menos, a mais ou fora de ordem) continua
 * legível: o que não bate com `BUILD_STEPS` é descartado.
 */
function parseJournal(value: unknown): BuildJournal | null {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return null;

  const storedSteps = Array.isArray(raw.steps) ? raw.steps.map(asRecord) : [];
  const byKey = new Map<string, Record<string, unknown>>();

  for (const step of storedSteps) {
    const key = asText(step.key);
    if (key !== null && !byKey.has(key)) byKey.set(key, step);
  }

  return {
    version: asNumber(raw.version) ?? JOURNAL_VERSION,
    startedAt: asIso(raw.startedAt),
    finishedAt: asIso(raw.finishedAt),
    refundedTokens: Math.max(0, Math.trunc(asNumber(raw.refundedTokens) ?? 0)),
    steps: BUILD_STEPS.map((definition) => {
      const stored = byKey.get(definition.key);

      if (!stored) {
        return {
          key: definition.key,
          state: 'pendente',
          detail: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          error: null,
        };
      }

      const duration = asNumber(stored.durationMs);

      return {
        key: definition.key,
        state: asStepState(stored.state),
        detail: asText(stored.detail),
        startedAt: asIso(stored.startedAt),
        finishedAt: asIso(stored.finishedAt),
        durationMs: duration === null ? null : Math.max(0, Math.round(duration)),
        error: asText(stored.error),
      };
    }),
  };
}

/** Extrai o diário de dentro de `Site.content`. */
export function readBuildJournal(content: unknown): BuildJournal | null {
  return parseJournal(asRecord(content)[JOURNAL_KEY]);
}

function journalToJson(journal: BuildJournal): JsonRecord {
  return {
    version: journal.version,
    ...(journal.startedAt !== null ? { startedAt: journal.startedAt } : {}),
    ...(journal.finishedAt !== null ? { finishedAt: journal.finishedAt } : {}),
    refundedTokens: journal.refundedTokens,
    steps: journal.steps.map((step) => ({
      key: step.key,
      state: step.state,
      ...(step.detail !== null ? { detail: step.detail } : {}),
      ...(step.startedAt !== null ? { startedAt: step.startedAt } : {}),
      ...(step.finishedAt !== null ? { finishedAt: step.finishedAt } : {}),
      ...(step.durationMs !== null ? { durationMs: step.durationMs } : {}),
      ...(step.error !== null ? { error: step.error } : {}),
    })),
  };
}

/* ============================================================================
 * VISÃO PÚBLICA (rota de status e tela "Montando.")
 * ==========================================================================*/

export interface BuildStatusSource {
  id: string;
  buildStatus: SiteBuildStatus;
  buildStartedAt: Date | null;
  buildCompletedAt: Date | null;
  buildError: string | null;
  subdomain: string;
  customDomain: string | null;
  content: Prisma.JsonValue;
}

/**
 * Diário sintético para sites que nunca passaram por `provisionSite` — o
 * default de `buildStatus` no schema é READY e `createSite` não grava etapa
 * nenhuma. Melhor mostrar um estado coerente do que uma lista vazia.
 */
function synthesizeSteps(status: SiteBuildStatus): JournalStep[] {
  return BUILD_STEPS.map((definition, index) => ({
    key: definition.key,
    state:
      status === 'READY'
        ? 'concluida'
        : status === 'BUILDING' && index === 0
          ? 'executando'
          : 'pendente',
    detail: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    error: null,
  }));
}

export function describeBuild(site: BuildStatusSource): BuildStatusView {
  const journal = readBuildJournal(site.content);
  const steps = journal ? journal.steps : synthesizeSteps(site.buildStatus);

  const currentStep = steps.findIndex((step) => step.state === 'executando');
  const completedSteps = steps.filter((step) => step.state === 'concluida').length;

  return {
    siteId: site.id,
    status: site.buildStatus,
    steps: steps.map((step, index) => ({
      ...BUILD_STEPS[index],
      state: step.state,
      detail: step.detail,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      error: step.error,
    })),
    currentStep: currentStep === -1 ? null : currentStep,
    completedSteps,
    totalSteps: TOTAL_STEPS,
    startedAt: site.buildStartedAt?.toISOString() ?? journal?.startedAt ?? null,
    completedAt: site.buildCompletedAt?.toISOString() ?? journal?.finishedAt ?? null,
    error: site.buildError,
    refundedTokens: journal?.refundedTokens ?? 0,
    host: siteHost(site),
    url: siteUrl(site),
  };
}

/**
 * Um site pode entrar na fila quando ainda não foi provisionado.
 * READY sem `buildStartedAt` é exatamente o site recém-criado por `createSite`
 * (o default do schema é READY) — esse ainda precisa ser montado.
 */
export function isBuildPending(site: {
  buildStatus: SiteBuildStatus;
  buildStartedAt: Date | null;
  buildCompletedAt: Date | null;
}): boolean {
  if (site.buildStatus === 'QUEUED' || site.buildStatus === 'BUILDING') return true;

  return (
    site.buildStatus === 'READY' &&
    site.buildStartedAt === null &&
    site.buildCompletedAt === null
  );
}

/* ============================================================================
 * TRANSIÇÕES
 * ==========================================================================*/

export type ProvisionSkipReason =
  | 'NAO_ENCONTRADO'
  | 'JA_EM_ANDAMENTO'
  | 'JA_CONCLUIDO'
  | 'FALHOU_ANTES';

export interface ProvisionResult {
  /** `true` quando ESTA chamada assumiu o build. */
  started: boolean;
  status: SiteBuildStatus;
  reason?: ProvisionSkipReason;
  error?: string;
  refundedTokens?: number;
}

/** Build abortado por outra transação (estorno de build travado, exclusão do site). */
class BuildAbortedError extends Error {
  constructor() {
    super('Provisionamento assumido por outro processo');
    this.name = 'BuildAbortedError';
  }
}

interface BuildContext {
  siteId: string;
  journal: BuildJournal;
  /** Conteúdo acumulado do site; o diário é anexado a cada gravação. */
  content: JsonRecord;
}

function contentWithJournal(context: BuildContext): JsonRecord {
  return { ...context.content, [JOURNAL_KEY]: journalToJson(context.journal) };
}

/**
 * Gravação parcial durante o build. A trava `buildStatus: 'BUILDING'` impede
 * que uma etapa atrasada sobrescreva o conteúdo de um build já encerrado.
 */
async function persistProgress(context: BuildContext): Promise<void> {
  const { count } = await prisma.site.updateMany({
    where: { id: context.siteId, buildStatus: 'BUILDING' },
    data: { content: contentWithJournal(context) },
  });

  if (count === 0) throw new BuildAbortedError();
}

function stepIndex(key: BuildStepKey): number {
  return BUILD_STEPS.findIndex((step) => step.key === key);
}

/**
 * Executa uma etapa marcando início e fim no diário. O `detail` devolvido é a
 * linha que aparece no log da tela — por isso é obrigatório e em pt-BR.
 */
async function runStep<T>(
  context: BuildContext,
  key: BuildStepKey,
  run: () => Promise<{ value: T; detail: string }>,
): Promise<T> {
  const index = stepIndex(key);
  const step = context.journal.steps[index];
  const startedAt = Date.now();

  step.state = 'executando';
  step.startedAt = new Date(startedAt).toISOString();
  step.finishedAt = null;
  step.durationMs = null;
  step.error = null;
  await persistProgress(context);

  try {
    const { value, detail } = await run();

    step.state = 'concluida';
    step.detail = detail;
    step.finishedAt = new Date().toISOString();
    step.durationMs = Date.now() - startedAt;
    await persistProgress(context);

    return value;
  } catch (error) {
    if (error instanceof BuildAbortedError) throw error;

    step.state = 'falhou';
    step.finishedAt = new Date().toISOString();
    step.durationMs = Date.now() - startedAt;
    step.error = describeError(error);

    throw error;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 500);
  }
  return 'Erro inesperado durante o provisionamento';
}

/* ============================================================================
 * ENTRADA NA FILA
 * ==========================================================================*/

export type EnqueueResult =
  | { queued: true }
  | { queued: false; status: SiteBuildStatus; reason: ProvisionSkipReason };

/**
 * Coloca um site recém-criado na fila (QUEUED).
 *
 * Chamada esperada dentro de `createSite`. Como o default do schema é READY,
 * o filtro exige `buildStartedAt: null`: um site já montado nunca volta para a
 * fila e um retry não vira um segundo site de graça.
 */
export async function enqueueSiteBuild(siteId: string): Promise<EnqueueResult> {
  const { count } = await prisma.site.updateMany({
    where: {
      id: siteId,
      isDeleted: false,
      buildStatus: 'READY',
      buildStartedAt: null,
      buildCompletedAt: null,
    },
    data: { buildStatus: 'QUEUED', buildError: null },
  });

  if (count === 1) return { queued: true };

  const current = await prisma.site.findUnique({
    where: { id: siteId },
    select: { buildStatus: true },
  });

  if (!current) return { queued: false, status: 'FAILED', reason: 'NAO_ENCONTRADO' };

  return {
    queued: false,
    status: current.buildStatus,
    reason:
      current.buildStatus === 'QUEUED' || current.buildStatus === 'BUILDING'
        ? 'JA_EM_ANDAMENTO'
        : current.buildStatus === 'FAILED'
          ? 'FALHOU_ANTES'
          : 'JA_CONCLUIDO',
  };
}

/* ============================================================================
 * CONSULTA À RECEITA (payload BRUTO para registryData)
 * ==========================================================================*/

/**
 * A consulta passa por `services/brasil-api.ts::checkCNPJ`, que já devolve o
 * payload íntegro em `raw` — é dele que sai `registryData`.
 *
 * Não use `fetch` nativo aqui: o undici do Node não envia User-Agent e a
 * BrasilAPI responde 403 a requisição sem UA. O sintoma é traiçoeiro — o build
 * conclui como READY, mas cai no ramo "cadastro indisponível" e o site nasce
 * sem CNAEs, sem porte e sem endereço. O axios do serviço manda `axios/1.x` e
 * passa.
 */
interface RegistrySnapshot {
  raw: BuildJson | null;
  tradeName: string | null;
  mainActivity: string | null;
  services: { title: string; description: string }[];
  foundedAt: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  email: string | null;
  /** Situação cadastral por extenso ("ATIVA", "BAIXADA"...). Vai para o log. */
  statusLabel: string | null;
}

const EMPTY_REGISTRY: RegistrySnapshot = {
  raw: null,
  tradeName: null,
  mainActivity: null,
  services: [],
  foundedAt: null,
  street: null,
  number: null,
  complement: null,
  neighborhood: null,
  city: null,
  state: null,
  zipCode: null,
  phone: null,
  email: null,
  statusLabel: null,
};

function formatRegistryPhone(value: unknown): string | null {
  const digits = (asText(value) ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) return null;

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const half = rest.length === 9 ? 5 : 4;

  return `(${ddd}) ${rest.slice(0, half)}-${rest.slice(half)}`;
}

function parseRegistry(payload: unknown): RegistrySnapshot {
  const data = asRecord(payload);

  const services: { title: string; description: string }[] = [];
  const mainActivity = asText(data.cnae_fiscal_descricao);

  if (mainActivity) {
    const code = asText(data.cnae_fiscal) ?? asNumber(data.cnae_fiscal)?.toString() ?? null;
    services.push({
      title: mainActivity,
      description: code ? `Atividade principal · CNAE ${code}` : 'Atividade principal',
    });
  }

  if (Array.isArray(data.cnaes_secundarios)) {
    for (const item of data.cnaes_secundarios) {
      if (services.length >= 6) break;

      const secondary = asRecord(item);
      const title = asText(secondary.descricao);
      if (!title || services.some((service) => service.title === title)) continue;

      const code = asText(secondary.codigo) ?? asNumber(secondary.codigo)?.toString() ?? null;
      services.push({
        title,
        description: code ? `Atividade secundária · CNAE ${code}` : 'Atividade secundária',
      });
    }
  }

  return {
    raw: sanitizeJson(payload),
    tradeName: asText(data.nome_fantasia),
    mainActivity,
    services,
    foundedAt: asText(data.data_inicio_atividade),
    street: asText(data.logradouro),
    number: asText(data.numero),
    complement: asText(data.complemento),
    neighborhood: asText(data.bairro),
    city: asText(data.municipio),
    state: asText(data.uf),
    zipCode: asText(data.cep),
    phone: formatRegistryPhone(data.ddd_telefone_1),
    email: asText(data.email),
    statusLabel: asText(data.descricao_situacao_cadastral),
  };
}

async function fetchRegistry(cnpj: string): Promise<RegistrySnapshot> {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return EMPTY_REGISTRY;

  try {
    const info = await brasilAPIService.checkCNPJ(digits);
    return parseRegistry(info.raw);
  } catch (error) {
    // Indisponibilidade da BrasilAPI não derruba o build: o site é montado com
    // os dados que o usuário já confirmou no assistente. Mas registramos —
    // silêncio aqui foi o que escondeu o 403 por User-Agent ausente.
    console.warn(`Consulta à Receita falhou para o CNPJ ${digits}:`, error);
    return EMPTY_REGISTRY;
  }
}

/* ============================================================================
 * CONTEÚDO INSTITUCIONAL
 * ==========================================================================*/

interface SiteSeed {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  cnpj: string;
  companyName: string;
  subdomain: string;
  customDomain: string | null;
  phone: string | null;
  email: string | null;
  metaTag: string | null;
  theme: Prisma.JsonValue;
  content: Prisma.JsonValue;
}

interface ResolvedTheme {
  json: JsonRecord;
  template: SiteTemplateKey;
  bgColor: string;
  accentColor: string;
}

/**
 * A identidade visual escolhida no assistente já está em `Site.theme`; aqui ela
 * é normalizada (cor inválida cai no padrão) e o template ganha valor explícito,
 * para a página pública não depender de fallback em tempo de render.
 */
function buildTheme(site: SiteSeed): ResolvedTheme {
  const theme = parseTheme(site.theme);
  const template: SiteTemplateKey = isSiteTemplateKey(theme.template)
    ? theme.template
    : 'minimal';
  const bgColor = theme.bgColor || DEFAULT_BG_COLOR;
  const accentColor = theme.accentColor || DEFAULT_ACCENT_COLOR;

  return {
    json: { bgColor, accentColor, template },
    template,
    bgColor,
    accentColor,
  };
}

/** Apresentação factual. Nada de promessa comercial que a empresa não fez. */
function buildDescription(site: SiteSeed, registry: RegistrySnapshot): string {
  const own = site.description?.trim();
  if (own) return own;

  const subject = registry.tradeName ?? site.companyName;
  const place = registry.city
    ? `${registry.city}${registry.state ? `/${registry.state}` : ''}`
    : null;

  // Duas orações no máximo: cadastro (sempre) e atuação (quando a Receita responde).
  const registration = `${subject} está inscrita no CNPJ ${formatCNPJ(site.cnpj)}${
    place ? `, com sede em ${place}` : ''
  }`;

  return registry.mainActivity
    ? `${registration} e atua em ${registry.mainActivity.toLowerCase()}.`
    : `${registration}.`;
}

const put = (target: JsonRecord, key: string, value: string | null): void => {
  if (value !== null && value.length > 0) target[key] = value;
};

/** Etapa "textos": o que a home apresenta — quem é a empresa e o que ela faz. */
function buildNarrativeContent(site: SiteSeed, registry: RegistrySnapshot): JsonRecord {
  const content: JsonRecord = {
    description: buildDescription(site, registry),
  };

  put(content, 'mainActivity', registry.mainActivity);
  put(content, 'foundedAt', registry.foundedAt);
  put(content, 'website', siteUrl(site));

  if (registry.services.length > 0) {
    content.services = registry.services.map((service) => ({
      title: service.title,
      description: service.description,
    }));
  }

  return content;
}

/**
 * Etapa "privacidade": os dados do CONTROLADOR.
 *
 * A política de privacidade do tenant já existe como página real
 * (app/sites/[subdomain]/politica-de-privacidade) e é montada a partir de
 * `content` — endereço da sede e canal de atendimento. Sem estes campos o
 * documento sai genérico e o titular fica sem canal para exercer os direitos
 * do art. 18 da LGPD; é isto que esta etapa garante.
 *
 * Nada de gravar o texto pronto aqui: teríamos duas fontes de verdade para o
 * mesmo documento.
 */
function buildControllerContent(
  registry: RegistrySnapshot,
  contact: { phone: string | null; email: string | null },
): JsonRecord {
  const content: JsonRecord = {};

  put(content, 'street', registry.street);
  put(content, 'number', registry.number);
  put(content, 'complement', registry.complement);
  put(content, 'neighborhood', registry.neighborhood);
  put(content, 'city', registry.city);
  put(content, 'state', registry.state);
  put(content, 'zipCode', registry.zipCode);
  put(content, 'phone', contact.phone);
  put(content, 'email', contact.email);

  return content;
}

/* ============================================================================
 * CONFERÊNCIA DA META TAG
 * ==========================================================================*/

const HEALTH_CHECK_UA = 'BusinessMillion-HealthCheck/1.0';
/**
 * O build inteiro precisa caber numa invocação serverless, então a leitura do
 * HTML tem teto menor que TIMEOUTS.META_TAG_CHECK — o monitor periódico é quem
 * pode se dar ao luxo de esperar os 15s.
 */
const TAG_CHECK_TIMEOUT_MS = Math.min(TIMEOUTS.META_TAG_CHECK, 8_000);

/** Três estados: encontrada, ausente e indeterminada (falha de rede). */
type TagOutcome = 'ok' | 'ausente' | 'indeterminado';

/**
 * Lê a tag do HTML sem `includes` cru: valor curto daria falso positivo em
 * qualquer trecho da página. Também aceita os atributos em qualquer ordem.
 */
export function extractFacebookVerification(html: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];

    if (!/name\s*=\s*["']facebook-domain-verification["']/i.test(tag)) continue;

    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    const value = content ? content[1].trim() : '';

    if (value.length > 0) return value;
  }

  return null;
}

/**
 * Em produção o site responde no host público. Em desenvolvimento esse host não
 * existe: o middleware reescreve por host e `localhost` é ROOT_HOST, então
 * batemos direto em /sites/{subdomain}.
 * `bm-check=1` marca a visita como health check para o contador de visitas
 * poder ignorá-la (ver needsIntegration).
 */
export function buildCheckUrl(site: { subdomain: string; customDomain: string | null }): string {
  if (process.env.NODE_ENV === 'production') {
    return `${siteUrl(site)}/?bm-check=1`;
  }

  const base = APP_CONFIG.DOMAIN.replace(/\/+$/, '');
  return `${base}/sites/${site.subdomain}?bm-check=1`;
}

async function checkMetaTag(
  site: SiteSeed,
): Promise<{ outcome: TagOutcome; found: string | null; detail: string }> {
  if (!site.metaTag) {
    return {
      outcome: 'ausente',
      found: null,
      detail: 'Nenhum código de verificação informado — cole o código da Meta no painel.',
    };
  }

  const url = buildCheckUrl(site);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TAG_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'user-agent': HEALTH_CHECK_UA, accept: 'text/html' },
    });

    if (!response.ok) {
      return {
        outcome: 'indeterminado',
        found: null,
        detail: `O site respondeu HTTP ${response.status}; a conferência será refeita pelo monitor.`,
      };
    }

    const found = extractFacebookVerification(await response.text());

    if (found === site.metaTag) {
      return {
        outcome: 'ok',
        found,
        detail: 'Tag facebook-domain-verification encontrada no <head> do site.',
      };
    }

    return {
      outcome: 'ausente',
      found,
      detail:
        found === null
          ? 'A tag ainda não aparece no HTML publicado; confira na tela de verificação.'
          : 'O HTML publicado traz outro código de verificação — confira o valor colado.',
    };
  } catch {
    return {
      outcome: 'indeterminado',
      found: null,
      detail: 'Não foi possível ler o site agora; o monitor refaz a conferência em minutos.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ============================================================================
 * PROVISIONAMENTO
 * ==========================================================================*/

const BUILD_SELECT = {
  id: true,
  userId: true,
  name: true,
  description: true,
  cnpj: true,
  companyName: true,
  subdomain: true,
  customDomain: true,
  phone: true,
  email: true,
  metaTag: true,
  theme: true,
  content: true,
} as const;

async function currentStatus(siteId: string): Promise<SiteBuildStatus | null> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { buildStatus: true },
  });

  return site?.buildStatus ?? null;
}

/**
 * Monta o site do zero e deixa `buildStatus` em READY.
 *
 * Reentrante por construção: a primeira coisa que faz é tentar mover o site
 * para BUILDING com `updateMany` condicional. Quem perde a corrida devolve
 * `started: false` sem executar nada.
 */
export async function provisionSite(siteId: string): Promise<ProvisionResult> {
  const startedAt = new Date();

  // Aceita QUEUED (fluxo integrado) e READY-nunca-montado, porque o default do
  // schema é READY e `createSite` ainda não enfileira.
  const { count } = await prisma.site.updateMany({
    where: {
      id: siteId,
      isDeleted: false,
      OR: [
        { buildStatus: 'QUEUED' },
        { buildStatus: 'READY', buildStartedAt: null, buildCompletedAt: null },
      ],
    },
    data: {
      buildStatus: 'BUILDING',
      buildStartedAt: startedAt,
      buildCompletedAt: null,
      buildError: null,
    },
  });

  if (count === 0) {
    const status = await currentStatus(siteId);

    if (status === null) {
      return { started: false, status: 'FAILED', reason: 'NAO_ENCONTRADO' };
    }

    return {
      started: false,
      status,
      reason:
        status === 'BUILDING' || status === 'QUEUED'
          ? 'JA_EM_ANDAMENTO'
          : status === 'FAILED'
            ? 'FALHOU_ANTES'
            : 'JA_CONCLUIDO',
    };
  }

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: BUILD_SELECT });

  if (!site) {
    // Excluído entre o claim e a leitura: nada a estornar aqui, o build nem começou.
    return { started: false, status: 'FAILED', reason: 'NAO_ENCONTRADO' };
  }

  const journal = emptyJournal();
  journal.startedAt = startedAt.toISOString();

  const context: BuildContext = {
    siteId,
    journal,
    // Preserva o que `createSite` já havia gravado em content.
    content: toJsonRecord(site.content),
  };

  await recordAudit({
    userId: site.userId,
    action: 'SITE_BUILD_STARTED',
    resource: 'site',
    resourceId: siteId,
    changes: { subdomain: site.subdomain, steps: TOTAL_STEPS },
  });

  try {
    const registry = await runStep(context, 'receita', async () => {
      const snapshot = await fetchRegistry(site.cnpj);

      const summary = [
        snapshot.statusLabel ? `situação ${snapshot.statusLabel.toLowerCase()}` : null,
        snapshot.services.length > 0
          ? `${snapshot.services.length} atividade(s) econômica(s)`
          : null,
      ].filter((part): part is string => part !== null);

      return {
        value: snapshot,
        detail:
          snapshot.raw === null
            ? 'Cadastro indisponível agora — seguimos com os dados confirmados na criação.'
            : `Cadastro de ${snapshot.tradeName ?? site.companyName} importado${
                summary.length > 0 ? ` — ${summary.join(', ')}` : ''
              }.`,
      };
    });

    const contact = {
      phone: site.phone ?? registry.phone,
      email: site.email ?? registry.email,
    };

    await runStep(context, 'identidade', async () => {
      const value = buildTheme(site);

      // Gravado aqui, e não junto com o conteúdo no fim: a janela entre ler e
      // escrever `theme` fica mínima, então uma troca de template feita pelo
      // usuário no meio do build (setSiteTemplate) não é desfeita por nós.
      const { count: styled } = await prisma.site.updateMany({
        where: { id: siteId, buildStatus: 'BUILDING' },
        data: { theme: value.json },
      });

      if (styled === 0) throw new BuildAbortedError();

      return {
        value: null,
        detail: `Template ${SITE_TEMPLATE_LABELS[value.template].name.toLowerCase()}, fundo ${value.bgColor} e destaque ${value.accentColor}.`,
      };
    });

    await runStep(context, 'textos', async () => {
      // FONTE ÚNICA dos textos: lib/company/copywriter.ts, alcançado pelo
      // payload BRUTO da Receita que a etapa anterior guardou. Ele escreve
      // chamada, tagline, "quem somos" e as áreas de atuação a partir dos CNAEs
      // — `buildNarrativeContent` abaixo só devolve uma frase e existe agora
      // como plano B, para quando a Receita não respondeu (raw === null) ou o
      // payload não é reconhecível.
      const written =
        registry.raw !== null ? buildSiteContentFromRegistry(registry.raw) : null;

      const generated: JsonRecord = written
        ? toJsonRecord(siteContentToJson(written))
        : buildNarrativeContent(site, registry);

      // Duas coisas que o copywriter não tem como saber: o texto que o dono
      // digitou no assistente (que sempre manda) e o endereço público do site.
      const own = site.description?.trim();
      if (own) generated.description = own;
      generated.website = siteUrl(site);

      context.content = { ...context.content, ...generated };

      const services = Array.isArray(generated.services) ? generated.services.length : 0;

      return {
        value: null,
        detail:
          services > 0
            ? `Apresentação institucional e ${services} área(s) de atuação escritas.`
            : 'Apresentação institucional escrita a partir dos dados cadastrais.',
      };
    });

    await runStep(context, 'privacidade', async () => {
      const controllerData = buildControllerContent(registry, contact);
      context.content = { ...context.content, ...controllerData };

      const hasAddress = typeof controllerData.city === 'string';
      const hasChannel = contact.email !== null || contact.phone !== null;

      return {
        value: null,
        detail: hasChannel
          ? `Política de privacidade pronta em /politica-de-privacidade com controlador${
              hasAddress ? ', endereço da sede' : ''
            } e canal de atendimento.`
          : 'Política de privacidade publicada — cadastre e-mail ou telefone no painel para o titular ter um canal direto.',
      };
    });

    await runStep(context, 'publicacao', async () => {
      const { count: published } = await prisma.site.updateMany({
        where: { id: siteId, buildStatus: 'BUILDING' },
        data: {
          isPublished: true,
          content: contentWithJournal(context),
          ...(registry.raw !== null ? { registryData: registry.raw } : {}),
        },
      });

      if (published === 0) throw new BuildAbortedError();

      return { value: null, detail: `No ar em ${siteHost(site)}.` };
    });

    await runStep(context, 'verificacao', async () => {
      const result = await checkMetaTag(site);
      const checkedAt = new Date();

      if (result.outcome === 'ok') {
        // `metaTag` no filtro: se o usuário trocou o código durante o build,
        // não marcamos como verificado o que não foi conferido.
        await prisma.site.updateMany({
          where: { id: siteId, metaTag: site.metaTag },
          data: { metaTagVerified: true, metaTagLastCheckedAt: checkedAt },
        });
      } else {
        // NUNCA zeramos `metaTagVerified` aqui: 'indeterminado' é falha de rede,
        // e derrubar o selo por causa dela é o bug clássico deste projeto.
        await prisma.site.updateMany({
          where: { id: siteId },
          data: { metaTagLastCheckedAt: checkedAt },
        });
      }

      return { value: null, detail: result.detail };
    });

    const finishedAt = new Date();
    journal.finishedAt = finishedAt.toISOString();

    const { count: completed } = await prisma.site.updateMany({
      where: { id: siteId, buildStatus: 'BUILDING' },
      data: {
        buildStatus: 'READY',
        buildCompletedAt: finishedAt,
        buildError: null,
        content: contentWithJournal(context),
      },
    });

    if (completed === 0) {
      const status = (await currentStatus(siteId)) ?? 'FAILED';
      return { started: true, status, reason: 'JA_EM_ANDAMENTO' };
    }

    await recordAudit({
      userId: site.userId,
      action: 'SITE_BUILD_COMPLETED',
      resource: 'site',
      resourceId: siteId,
      changes: {
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        registryImported: registry.raw !== null,
      },
    });

    return { started: true, status: 'READY' };
  } catch (error) {
    if (error instanceof BuildAbortedError) {
      const status = (await currentStatus(siteId)) ?? 'FAILED';
      return { started: false, status, reason: 'JA_EM_ANDAMENTO' };
    }

    const message = describeError(error);
    const failure = await failBuild({
      siteId,
      userId: site.userId,
      siteName: site.name,
      message,
      journal,
      content: context.content,
    });

    return {
      started: true,
      status: 'FAILED',
      error: message,
      refundedTokens: failure.refundedTokens,
    };
  }
}

/* ============================================================================
 * FALHA + ESTORNO
 * ==========================================================================*/

interface FailBuildParams {
  siteId: string;
  userId: string;
  siteName: string;
  message: string;
  journal: BuildJournal;
  content: JsonRecord;
}

/**
 * Marca FAILED e devolve os tokens da criação.
 *
 * A trava é o `updateMany` de BUILDING -> FAILED dentro da transação: só quem
 * conseguir mover a linha estorna. Sem ela, um retry do provisionamento viraria
 * máquina de imprimir tokens.
 *
 * O AuditLog `SITE_BUILD_REFUNDED` é conferido antes por segurança: se alguém
 * recolocar o site em BUILDING à mão, o estorno não acontece de novo.
 */
async function failBuild(
  params: FailBuildParams,
): Promise<{ failed: boolean; refundedTokens: number }> {
  const { siteId, userId, siteName, message, journal, content } = params;

  try {
    return await prisma.$transaction(async (tx) => {
      const alreadyRefunded = await tx.auditLog.findFirst({
        where: { action: 'SITE_BUILD_REFUNDED', resource: 'site', resourceId: siteId },
        select: { id: true },
      });

      journal.finishedAt = new Date().toISOString();
      journal.refundedTokens = alreadyRefunded ? 0 : TOKENS_PER_SITE;

      const { count } = await tx.site.updateMany({
        where: { id: siteId, buildStatus: 'BUILDING' },
        data: {
          buildStatus: 'FAILED',
          buildCompletedAt: new Date(),
          buildError: message,
          // `isPublished` NÃO é mexido de propósito: app/sites/[subdomain]/page.tsx
          // renderiza o site normal em FAILED justamente para não derrubar a
          // verificação de domínio junto com uma etapa que falhou.
          content: { ...content, [JOURNAL_KEY]: journalToJson(journal) },
        },
      });

      if (count === 0) {
        journal.refundedTokens = 0;
        return { failed: false, refundedTokens: 0 };
      }

      await recordAudit({
        userId,
        action: 'SITE_BUILD_FAILED',
        resource: 'site',
        resourceId: siteId,
        changes: { site: siteName },
        status: 'error',
        errorMessage: message,
        tx,
      });

      if (alreadyRefunded) return { failed: true, refundedTokens: 0 };

      await grantTokens({
        userId,
        amount: TOKENS_PER_SITE,
        description: `Estorno: falha ao provisionar o site ${siteName}`,
        metadata: { siteId, reason: message },
        audit: {
          action: 'SITE_BUILD_REFUNDED',
          resource: 'site',
          resourceId: siteId,
        },
        tx,
      });

      return { failed: true, refundedTokens: TOKENS_PER_SITE };
    });
  } catch (error) {
    // O build já falhou; falhar o registro da falha não pode mascarar o motivo
    // original. O site continua BUILDING e `resetStuckBuilds` o recicla.
    console.error('Falha ao encerrar provisionamento do site', siteId, error);
    journal.refundedTokens = 0;
    return { failed: false, refundedTokens: 0 };
  }
}

/* ============================================================================
 * RECICLAGEM DE BUILDS TRAVADOS
 * ==========================================================================*/

const STUCK_BUILD_MINUTES = 15;

/**
 * Builds que ficaram em BUILDING além do razoável (processo morto no meio de
 * uma invocação serverless, deploy durante o build). Cada um é marcado FAILED
 * e estornado pela mesma trava condicional — reexecutar o job não paga duas vezes.
 *
 * Devolve quantos sites foram reciclados.
 */
export async function resetStuckBuilds(
  olderThanMinutes: number = STUCK_BUILD_MINUTES,
  limit = 50,
): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(1, olderThanMinutes) * 60_000);

  const stuck = await prisma.site.findMany({
    where: {
      buildStatus: 'BUILDING',
      OR: [{ buildStartedAt: { lt: cutoff } }, { buildStartedAt: null }],
    },
    orderBy: { buildStartedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { id: true, userId: true, name: true, content: true },
  });

  let recovered = 0;

  for (const site of stuck) {
    const journal = readBuildJournal(site.content) ?? emptyJournal();

    // A etapa que estava rodando vira a etapa que falhou — o log da tela
    // continua contando a história certa depois da reciclagem.
    for (const step of journal.steps) {
      if (step.state === 'executando') {
        step.state = 'falhou';
        step.finishedAt = new Date().toISOString();
        step.error = 'Provisionamento interrompido';
      }
    }

    const content = toJsonRecord(site.content);
    delete content[JOURNAL_KEY];

    const { failed } = await failBuild({
      siteId: site.id,
      userId: site.userId,
      siteName: site.name,
      message:
        'O provisionamento foi interrompido antes de terminar. Nenhuma cobrança foi mantida.',
      journal,
      content,
    });

    if (failed) recovered += 1;
  }

  return recovered;
}
