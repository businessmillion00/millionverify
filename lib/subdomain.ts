/**
 * Regras de subdomínio compartilhadas entre o assistente de criação, a rota de
 * verificação de disponibilidade e as actions de gestão.
 *
 * Este módulo é importado por CLIENT COMPONENTS, então não pode importar prisma
 * nem next-auth — o PrismaClient vazaria para o bundle do browser. A consulta ao
 * banco vive em app/api/subdomain/check/route.ts e é injetada aqui pelo
 * predicado `isTaken` de suggestSubdomains().
 */
import { APP_CONFIG } from '@/lib/constants';
import { slugify } from '@/lib/utils';

/** Espelham CreateSiteSchema (lib/validators/site.ts). Divergir faz a UI aprovar o que createSite rejeita. */
export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 50;

/**
 * O middleware trata como tenant qualquer host fora de ROOT_HOSTS, então um site
 * chamado "api" ou "admin" sequestraria rotas da plataforma e nomes de infra.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  '_next',
  'about',
  'account',
  'admin',
  'affiliate',
  'afiliados',
  'ajuda',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'businessmillion',
  'cdn',
  'checkout',
  'cliente',
  'clientes',
  'cname',
  'conta',
  'contato',
  'dashboard',
  'demo',
  'dev',
  'developer',
  'docs',
  'download',
  'email',
  'faq',
  'ftp',
  'git',
  'help',
  'home',
  'host',
  'imap',
  'img',
  'internal',
  'localhost',
  'login',
  'logout',
  'mail',
  'media',
  'mx',
  'ns',
  'ns1',
  'ns2',
  'ns3',
  'ns4',
  'pagamento',
  'painel',
  'pop',
  'portal',
  'precos',
  'preview',
  'register',
  'root',
  'sandbox',
  'security',
  'signup',
  'site',
  'sites',
  'smtp',
  'ssl',
  'staging',
  'static',
  'status',
  'suporte',
  'support',
  'test',
  'token',
  'tokens',
  'upload',
  'vpn',
  'webdisk',
  'webmail',
  'whm',
  'www',
]);

export type SubdomainValidation = { valid: true } | { valid: false; reason: string };

export type SiteDomain = { subdomain: string; customDomain?: string | null };

/**
 * Normalização definitiva: é este valor que vai para o banco.
 * Remove hífen das pontas, o que impede digitar "minha-" progressivamente —
 * para o campo controlado do assistente use `sanitizeSubdomainInput`.
 */
export function normalizeSubdomain(raw: string): string {
  return slugify(raw)
    .replace(/^-+|-+$/g, '')
    .slice(0, SUBDOMAIN_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * Versão tolerante para uso a cada tecla: mantém o hífen que o usuário acabou de
 * digitar (ou o espaço que virou hífen) para não travar a digitação.
 */
export function sanitizeSubdomainInput(raw: string): string {
  const openEnded = /[\s-]$/.test(raw);
  const value = slugify(raw).replace(/^-+/, '');

  const withPendingHyphen =
    openEnded && value.length > 0 && !value.endsWith('-') ? `${value}-` : value;

  return withPendingHyphen.slice(0, SUBDOMAIN_MAX_LENGTH);
}

export function validateSubdomain(value: string): SubdomainValidation {
  if (!value) {
    return { valid: false, reason: 'Informe um subdomínio' };
  }

  if (value.length < SUBDOMAIN_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Subdomínio deve ter no mínimo ${SUBDOMAIN_MIN_LENGTH} caracteres`,
    };
  }

  if (value.length > SUBDOMAIN_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Subdomínio deve ter no máximo ${SUBDOMAIN_MAX_LENGTH} caracteres`,
    };
  }

  if (!/^[a-z0-9-]+$/.test(value)) {
    return {
      valid: false,
      reason: 'Subdomínio pode conter apenas letras minúsculas, números e hífen',
    };
  }

  if (value.startsWith('-') || value.endsWith('-')) {
    return { valid: false, reason: 'O subdomínio não pode começar nem terminar com hífen' };
  }

  // Hífen duplo é reservado pelo padrão de rótulos internacionalizados (xn--).
  if (value.includes('--')) {
    return { valid: false, reason: 'O subdomínio não pode ter dois hífens seguidos' };
  }

  if (RESERVED_SUBDOMAINS.has(value)) {
    return { valid: false, reason: 'Este subdomínio é reservado pela plataforma' };
  }

  return { valid: true };
}

const SUGGESTION_SUFFIXES = ['oficial', 'br', 'site', 'online', 'digital', '2', '3', '4'];

function joinSuffix(root: string, suffix: string): string {
  const maxRoot = SUBDOMAIN_MAX_LENGTH - suffix.length - 1;
  const trimmedRoot = root.slice(0, Math.max(1, maxRoot)).replace(/-+$/, '');

  return `${trimmedRoot}-${suffix}`;
}

/**
 * Alternativas livres para quando o subdomínio pedido já existe. O predicado
 * `isTaken` é injetado porque este módulo não pode falar com o banco.
 */
export async function suggestSubdomains(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  limit = 3,
): Promise<string[]> {
  const root = normalizeSubdomain(base);
  if (!root) return [];

  const suggestions: string[] = [];

  for (const suffix of SUGGESTION_SUFFIXES) {
    if (suggestions.length >= limit) break;

    const candidate = joinSuffix(root, suffix);
    if (suggestions.includes(candidate)) continue;
    if (!validateSubdomain(candidate).valid) continue;
    if (await isTaken(candidate)) continue;

    suggestions.push(candidate);
  }

  return suggestions;
}

/** Host público do site: domínio próprio quando existe, senão o subdomínio da plataforma. */
export function siteHost(site: SiteDomain): string {
  const custom = site.customDomain?.trim();

  return custom ? custom : `${site.subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}`;
}

export function siteUrl(site: SiteDomain): string {
  return `https://${siteHost(site)}`;
}
