import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { SITE_RATE_LIMITS } from '@/lib/constants';

/**
 * Rate limit em memória, por PROCESSO.
 *
 * Em serverless cada instância tem o seu próprio store, então o limite efetivo é
 * N × instâncias. Isto serve para conter abuso barato (força bruta, polling, scraping),
 * NUNCA como controle antifraude no fluxo de dinheiro — ali a garantia é a trava
 * condicional no banco (updateMany dentro de $transaction).
 *
 * Janela DESLIZANTE: guardamos o timestamp de cada acerto e descartamos os que saíram
 * da janela. A janela fixa anterior permitia 2× o limite na virada do período
 * (limit no fim de um bucket + limit no início do seguinte).
 */

export interface RateLimitResult {
  success: boolean;
  limit: number;
  current: number;
  reset: number;
}

export interface RateLimitRule {
  readonly limit: number;
  /** Tamanho da janela em milissegundos. */
  readonly window: number;
}

interface Bucket {
  /** Timestamps dos acertos aceitos, em ordem crescente. Nunca passa de `limit` itens. */
  hits: number[];
  /** Momento em que o bucket inteiro fica obsoleto (último acerto + janela). */
  expiresAt: number;
}

interface RateLimitState {
  buckets: Map<string, Bucket>;
  lastSweep: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_WINDOW = 900_000; // 15 minutos
const FALLBACK_IP = '127.0.0.1';
const MAX_KEY_LENGTH = 256;
const SWEEP_INTERVAL = 60_000;
/** Teto de chaves vivas: impede que um atacante rodando IPs infle a memória do processo. */
const MAX_KEYS = 20_000;

/**
 * O store vive no globalThis pelo mesmo motivo do PrismaClient em lib/prisma.ts: em dev o
 * módulo é reavaliado a cada hot reload e um store novo zeraria o limite a cada save.
 * Também não usamos setInterval — em serverless o processo é congelado entre requisições
 * (o timer não roda de forma confiável) e em dev cada reload deixaria um intervalo órfão.
 * A limpeza é amortizada: acontece dentro da própria chamada, no máximo uma vez por minuto.
 */
const globalForRateLimit = globalThis as unknown as {
  __bmRateLimitState?: RateLimitState;
};

const state: RateLimitState =
  globalForRateLimit.__bmRateLimitState ??
  (globalForRateLimit.__bmRateLimitState = { buckets: new Map(), lastSweep: Date.now() });

/**
 * Limites nomeados por rota. Manter os números aqui evita que o mesmo endpoint seja
 * limitado com valores diferentes em lugares diferentes.
 * As chamadas legadas continuam passando limit/window na mão — a assinatura não mudou.
 */
export const RATE_LIMITS = {
  /** app/actions/auth.ts — registro de conta. */
  'auth:register': { limit: 5, window: 3_600_000 },
  /** Tentativas de login por identificador. */
  'auth:login': { limit: 10, window: 900_000 },
  /** app/api/cnpj/route.ts — consulta à BrasilAPI. */
  'cnpj:lookup': { limit: 20, window: 300_000 },
  /** Criação de cobrança: cada clique gera uma cobrança real no Asaas. */
  'payment:create': { limit: 10, window: 3_600_000 },
  /** Polling do checkout PIX (a cada 5s ⇒ 12/min por aba). */
  'payment:status': { limit: 120, window: 60_000 },
  /** app/api/account/route.ts — leitura de perfil. */
  'account:read': { limit: 60, window: 60_000 },
  /** app/api/account/route.ts — PATCH/DELETE. */
  'account:write': { limit: 10, window: 3_600_000 },
  /** Webhook do Asaas: um punhado de IPs de origem, precisa de folga. */
  'webhook:asaas': { limit: 1000, window: 3_600_000 },
  /** Criação de sites por dia, alinhada ao teto de negócio. */
  'site:create': { limit: SITE_RATE_LIMITS.CREATE, window: 86_400_000 },
  /** Envio do comprovante que o usuário baixou da Receita. */
  'document_upload': { limit: 20, window: 3_600_000 },
  /** Remoção do comprovante anexado. */
  'document_delete': { limit: 20, window: 3_600_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Assinatura preservada: app/actions/auth.ts, app/api/cnpj/route.ts e
 * app/api/webhooks/asaas/route.ts dependem exatamente desta forma.
 */
export const rateLimit = async (
  identifier: string,
  limit: number = DEFAULT_LIMIT,
  window: number = DEFAULT_WINDOW,
): Promise<RateLimitResult> => {
  const now = Date.now();
  const key = normalizeKey(identifier);
  const windowStart = now - window;

  const existing = state.buckets.get(key);
  // Descarta os acertos que já saíram da janela — é isto que faz a janela "deslizar".
  const hits = existing ? existing.hits.filter((hit) => hit > windowStart) : [];

  const success = hits.length < limit;
  if (success) {
    hits.push(now);
  }

  // Quando o balde está cheio, o próximo slot só abre quando o acerto mais antigo expira.
  const oldest = hits.length > 0 ? hits[0] : now;
  const newest = hits.length > 0 ? hits[hits.length - 1] : now;

  state.buckets.set(key, { hits, expiresAt: newest + window });
  sweepIfDue(now);

  return {
    success,
    limit,
    // Em caso de bloqueio o acerto não é registrado (o array fica limitado a `limit`),
    // mas `current` reporta a tentativa para o chamador enxergar o excesso.
    current: success ? hits.length : hits.length + 1,
    reset: oldest + window,
  };
};

/** Açúcar sobre `rateLimit` usando o catálogo de limites nomeados. */
export const rateLimitByName = async (
  name: RateLimitName,
  key: string,
): Promise<RateLimitResult> => {
  const rule = RATE_LIMITS[name];
  return rateLimit(`${name}:${key}`, rule.limit, rule.window);
};

/**
 * Resposta 429 padronizada, com os cabeçalhos que um cliente bem-comportado respeita.
 * Aceita o resultado inteiro (preenche X-RateLimit-Limit/Remaining) ou apenas o `reset`,
 * para o chamador que só guardou esse valor.
 */
export const rateLimitResponse = (
  result: RateLimitResult | number,
  message: string = 'Muitas requisições. Aguarde alguns instantes.',
): NextResponse => {
  const reset = typeof result === 'number' ? result : result.reset;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));

  const rateHeaders: Record<string, string> =
    typeof result === 'number'
      ? {}
      : {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(Math.max(0, result.limit - result.current)),
        };

  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        ...rateHeaders,
        'Retry-After': String(retryAfter),
        'X-RateLimit-Reset': String(Math.ceil(reset / 1000)),
        'Cache-Control': 'no-store',
      },
    },
  );
};

/**
 * Extrai o IP de qualquer fonte com `get(name)` (Headers, ReadonlyHeaders).
 * ATENÇÃO: x-forwarded-for é forjável quando a app não está atrás de um proxy confiável.
 * Para limitar usuário autenticado prefira chavear por session.user.id.
 */
export const extractClientIp = (source: { get(name: string): string | null }): string | null => {
  const forwarded = source.get('x-forwarded-for');
  const candidates = [
    forwarded ? forwarded.split(',')[0] : null,
    source.get('x-real-ip'),
    source.get('cf-connecting-ip'),
  ];

  for (const candidate of candidates) {
    const ip = sanitizeIp(candidate);
    if (ip) return ip;
  }

  return null;
};

/** Assinatura preservada. Nunca lança: fora de escopo de request devolve o fallback. */
export const getClientIp = async (): Promise<string> => {
  try {
    const headersList = await headers();
    return extractClientIp(headersList) ?? FALLBACK_IP;
  } catch {
    // headers() explode fora do escopo de request (cron, seed, scripts).
    return FALLBACK_IP;
  }
};

const IP_SHAPE = /^[0-9a-fA-F.:]{3,45}$/;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const IPV6_BRACKETED = /^\[([0-9a-fA-F:.]+)\](?::\d{1,5})?$/;

const sanitizeIp = (raw: string | null | undefined): string | null => {
  if (!raw) return null;

  let value = raw.trim();

  const bracketed = IPV6_BRACKETED.exec(value);
  if (bracketed) value = bracketed[1];

  const withPort = IPV4_WITH_PORT.exec(value);
  if (withPort) value = withPort[1];

  if (value.startsWith('::ffff:')) value = value.slice(7);

  // Cabeçalho forjado com lixo viraria chave de store: só aceitamos algo com cara de IP.
  return IP_SHAPE.test(value) ? value : null;
};

const normalizeKey = (identifier: string): string => {
  const trimmed = identifier.slice(0, MAX_KEY_LENGTH);
  return `rate-limit:${trimmed}`;
};

const sweepIfDue = (now: number): void => {
  if (now - state.lastSweep < SWEEP_INTERVAL) return;
  state.lastSweep = now;

  for (const [key, bucket] of state.buckets) {
    if (bucket.expiresAt <= now) {
      state.buckets.delete(key);
    }
  }

  if (state.buckets.size <= MAX_KEYS) return;

  // Último recurso contra inundação de chaves: descarta as mais próximas de expirar.
  const byExpiry = [...state.buckets.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = state.buckets.size - MAX_KEYS;
  for (let i = 0; i < excess; i++) {
    state.buckets.delete(byExpiry[i][0]);
  }
};
