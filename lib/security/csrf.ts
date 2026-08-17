import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

/**
 * CSRF para rotas de app/api/**.
 *
 * Server Actions do Next 14 já comparam Origin com Host por conta própria — não há nada a
 * fazer por elas. O buraco real são os route handlers: eles são autenticados por cookie de
 * sessão e o middleware NÃO os cobre (matcher exclui `/api`), então um POST/PATCH/DELETE
 * disparado de outro site chegaria autenticado.
 *
 * A defesa primária é `assertSameOrigin` (double-submit não é necessário quando o Origin
 * é confiável). O token assinado existe para os casos em que o Origin não serve — formulário
 * HTML clássico, cliente que remove o header, ou fluxo em duas etapas.
 */

export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_COOKIE_NAME = 'bm.csrf-token';

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Verifica se a requisição partiu da própria aplicação.
 *
 * O Host não é confiável para autenticação, mas É confiável aqui: um site atacante não
 * consegue forjar o par (Host nosso, Origin nosso) — se ele aponta para o nosso host, o
 * browser envia o Origin DELE. Por isso o host serve de fallback quando NEXT_PUBLIC_APP_URL
 * não está configurado (previews, subdomínios de cliente).
 */
export function assertSameOrigin(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  const origin = request.headers.get('origin');

  if (!origin) {
    // Todo browser envia Origin em fetch/XHR mutante. Ausência em método mutante é
    // cliente não-browser ou form cross-site legado: recusamos.
    return SAFE_METHODS.has(method);
  }

  const received = normalizeOrigin(origin);
  if (!received) return false;

  return allowedOrigins(request).has(received);
}

/** Origens aceitas: a configurada, a do NextAuth e a do próprio Host da requisição. */
function allowedOrigins(request: NextRequest): Set<string> {
  const allowed = new Set<string>();

  for (const configured of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    const normalized = normalizeOrigin(configured);
    if (normalized) allowed.add(normalized);
  }

  const host = request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
    const normalized = normalizeOrigin(`${proto}://${host}`);
    if (normalized) allowed.add(normalized);
  }

  return allowed;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value || value === 'null') return null;

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Token CSRF assinado (stateless): `<nonce>.<expiraEm>.<hmac>`.
 * Guarde no cookie `CSRF_COOKIE_NAME` e reenvie no header `CSRF_HEADER_NAME`.
 */
export function issueCsrfToken(ttlMs: number = DEFAULT_TTL_MS): string {
  const key = csrfSecret();

  if (!key) {
    throw new Error('AUTH_SECRET/NEXTAUTH_SECRET ausente: impossível emitir token CSRF');
  }

  // randomBytes é criptográfico. NUNCA use generateRandomToken de lib/utils/auth-utils.ts
  // aqui: ele é baseado em Math.random().
  const payload = `${randomBytes(16).toString('hex')}.${Date.now() + ttlMs}`;

  return `${payload}.${sign(payload, key)}`;
}

/** Valida assinatura e validade. Comparação em tempo constante. */
export function verifyCsrfToken(token: string | null | undefined): boolean {
  const key = csrfSecret();
  if (!key || !token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [nonce, expiresAt, signature] = parts;

  if (!safeCompare(signature, sign(`${nonce}.${expiresAt}`, key))) return false;

  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/**
 * Comparação em tempo constante. O tamanho ainda vaza (timingSafeEqual exige buffers do
 * mesmo tamanho) — é o mesmo compromisso de services/asaas.ts e não é explorável aqui,
 * porque o tamanho do token é fixo e público.
 */
export function safeCompare(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

function csrfSecret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}
