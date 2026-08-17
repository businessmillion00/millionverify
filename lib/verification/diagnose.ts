import type { Prisma, SiteBuildStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { APP_CONFIG, TIMEOUTS } from '@/lib/constants';
import { siteUrl } from '@/lib/subdomain';
import { lookupTxt, txtRecordMatches } from '@/lib/verification/dns';
// Caminho da política dentro do site do tenant. Importado do módulo que RENDERIZA a
// página (e que monta o link do rodapé) em vez de recopiado aqui: se as duas strings
// divergirem, o diagnóstico passa a bater numa URL que não existe e acusa 404 para
// todo mundo. É só uma constante de rota — nenhum componente entra neste bundle.
import { PRIVACY_POLICY_PATH } from '@/components/site-templates/privacy-policy';

/**
 * Diagnóstico de um site publicado — DONO DO CONTRATO de `Site.lastDiagnostic`.
 *
 * Tudo que grava `lastDiagnostic`, `metaTagVerified` ou `metaTagLastCheckedAt` passa
 * por `persistDiagnostic` daqui. O monitor em lote (lib/verification/monitor.ts) IMPORTA
 * estas funções; se ele serializasse o JSON do seu jeito, o cartão de diagnóstico
 * renderizaria metade dos casos como lixo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS SEIS CHECAGENS
 *
 *   1. Site no ar          → a home responde 200.
 *   2. HTTPS válido        → a resposta veio por TLS sem erro de certificado.
 *   3. Meta tag            → <meta name="facebook-domain-verification"> no <head>.
 *   4. Registro TXT        → entrada na ZONA DNS (não no HTML).
 *   5. Política de privac. → {site}/politica-de-privacidade responde 200 com conteúdo.
 *   6. Robô da Meta        → a MESMA home, pedida com o User-Agent do rastreador,
 *                            responde 200 e continua trazendo a meta tag.
 *
 * A sexta é a mais valiosa das seis: é o caso em que tudo parece certo no navegador e
 * a Meta falha assim mesmo, porque o WAF/CDN devolve 403 (ou uma página sem a tag)
 * especificamente para o `facebookexternalhit`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OS DOIS MÉTODOS DE VERIFICAÇÃO DA META NÃO SÃO A MESMA COISA
 *
 *   META TAG      → <meta name="facebook-domain-verification" content="..."> no <head>.
 *                   Conferir = baixar o HTML. Vale na hora.
 *   REGISTRO TXT  → entrada TXT na ZONA DNS. NÃO existe no HTML.
 *                   Conferir = resolver DNS (lib/verification/dns.ts). Leva 5-15 min.
 *
 * Aqui a meta tag é procurada no HTML e o TXT é resolvido por DNS — nunca o contrário.
 */

/* ============================ CONTRATO ============================ */

/**
 * Três estados, nunca um boolean.
 *
 *   'ok'            → comprovadamente presente e igual ao esperado.
 *   'ausente'       → comprovadamente ausente (o servidor respondeu, o valor não está lá).
 *   'indeterminado' → não deu para saber (timeout, erro de rede, 5xx, DNS instável).
 *
 * A distinção é o que impede um blip de rede de derrubar "Tag ativa" para
 * "Aguardando verificação" no painel: só 'ausente' pode zerar `metaTagVerified`.
 */
export type DiagnosticOutcome = 'ok' | 'ausente' | 'indeterminado';

export interface MetaTagDiagnostic {
  /** Valor cadastrado em `Site.metaTag` (só o conteúdo de content="..."). */
  expected: string | null;
  /** Valor realmente encontrado no <head> publicado. */
  found: string | null;
  outcome: DiagnosticOutcome;
}

export interface TxtDiagnostic {
  /** Token cadastrado em `Site.verificationTxt`. */
  expected: string | null;
  /** Registros TXT lidos da zona (já remontados a partir dos pedaços de 255 chars). */
  records: string[];
  outcome: DiagnosticOutcome;
  /**
   * Falso para subdomínio da plataforma: a zona `businessmillion.app` é NOSSA e o
   * cliente não consegue criar TXT nela. Só faz sentido com domínio próprio.
   */
  applicable: boolean;
}

/**
 * Política de privacidade acessível.
 *
 * Não é exigência técnica da verificação de domínio, é sinal de legitimidade: o link
 * no rodapé apontando para uma página real é uma das coisas que a Meta (e o humano que
 * revisa o domínio) olha. Por isso mora no diagnóstico, mas nunca zera `metaTagVerified`.
 */
export interface PrivacyPolicyDiagnostic {
  /**
   * URL exata que foi buscada. `null` só em diagnóstico gravado por uma versão
   * anterior do formato, que ainda não tinha esta checagem.
   */
  url: string | null;
  /** `null` quando não houve resposta HTTP. */
  httpStatus: number | null;
  /** Tamanho do HTML recebido, já sem espaços nas pontas. Zero quando o corpo veio vazio. */
  htmlLength: number;
  outcome: DiagnosticOutcome;
}

/**
 * A home pedida de novo, com o User-Agent do rastreador da Meta.
 *
 * A checagem existe porque "abre no navegador" e "abre para a Meta" são coisas
 * diferentes: WAF, Cloudflare e limitadores por User-Agent devolvem 403/429/503 só para
 * o `facebookexternalhit`. Quando isso acontece, tudo no painel parece certo e a
 * verificação falha do lado da Meta sem nenhuma pista.
 */
export interface CrawlerDiagnostic {
  /** User-Agent usado na requisição — o do rastreador da Meta. */
  userAgent: string;
  /** `null` quando não houve resposta HTTP. */
  httpStatus: number | null;
  latencyMs: number | null;
  /**
   * Verdadeiro quando a meta tag esperada veio TAMBÉM nesta resposta. `false` sem
   * código cadastrado não é falha: não havia o que procurar.
   */
  metaTagFound: boolean;
  /**
   * Verdadeiro quando o nosso User-Agent recebeu 200 e o do robô recebeu outra coisa.
   * É a prova de bloqueio por User-Agent — e é o único caso em que uma resposta 429/503
   * conta como conclusiva em vez de passageira, porque a comparação lado a lado mostra
   * que o servidor está de pé e escolhendo barrar o rastreador.
   */
  blocked: boolean;
  outcome: DiagnosticOutcome;
}

export interface SiteDiagnostic {
  /** ISO 8601 — instante em que a checagem começou. */
  checkedAt: string;
  /** URL exata que foi buscada, já com o marcador de health check. */
  url: string;
  /** `null` quando não houve resposta HTTP (rede caiu, timeout, checagem bloqueada). */
  httpStatus: number | null;
  /** Tempo total até o HTML ficar disponível. `null` quando nenhum fetch foi feito. */
  latencyMs: number | null;
  /** Verdadeiro quando o servidor devolveu uma resposta HTTP, qualquer que seja o status. */
  reachable: boolean;
  /** Verdadeiro quando a resposta veio por HTTPS sem erro de certificado. */
  sslOk: boolean;
  metaTag: MetaTagDiagnostic;
  txt: TxtDiagnostic;
  privacyPolicy: PrivacyPolicyDiagnostic;
  crawler: CrawlerDiagnostic;
  /**
   * Mensagem em pt-BR quando a checagem PRINCIPAL (home ou TXT) ficou indeterminada.
   * `null` quando o resultado é conclusivo. As checagens 5 e 6 nunca escrevem aqui —
   * elas falam por `problems` — para não mudar o status de auditoria de quem já lê
   * este campo (app/actions/verification.ts e a rota de diagnóstico).
   */
  error: string | null;
  /**
   * Lista humana do que está errado, na ordem infraestrutura → meta tag → robô da
   * Meta → TXT → política de privacidade. É ordem de bloqueio, não de importância.
   */
  problems: string[];
}

/**
 * Versionamento do JSON gravado: permite evoluir o formato sem quebrar leituras antigas.
 * 2 = acrescentou `privacyPolicy` e `crawler`; `parseDiagnostic` lê um JSON versão 1 sem
 * eles e devolve as duas checagens como 'indeterminado' (nunca 'ausente' — nada foi medido).
 */
export const DIAGNOSTIC_VERSION = 2;

/** Identifica nossas requisições de saúde para que elas não contem como visita real. */
export const HEALTH_CHECK_USER_AGENT = 'BusinessMillion-HealthCheck/1.0';

/**
 * User-Agent literal do rastreador da Meta. Copiado com precisão de propósito: a regra
 * de WAF que barra o robô costuma casar a string inteira, então abreviar aqui faria a
 * checagem passar enquanto a Meta continua tomando 403.
 */
export const META_CRAWLER_USER_AGENT =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

/** Marcador redundante na querystring, para quem preferir olhar a URL em vez do UA. */
export const HEALTH_CHECK_PARAM = 'bm-check';

/* ============================ ENTRADA ============================ */

export interface DiagnoseSiteInput {
  subdomain: string;
  customDomain: string | null;
  metaTag: string | null;
  verificationTxt: string | null;
  isPublished: boolean;
  buildStatus: SiteBuildStatus;
}

/** Campos que a rota/o cron precisam selecionar para montar o `DiagnoseSiteInput`. */
export const DIAGNOSE_SITE_SELECT = {
  subdomain: true,
  customDomain: true,
  metaTag: true,
  verificationTxt: true,
  isPublished: true,
  buildStatus: true,
} as const satisfies Record<keyof DiagnoseSiteInput, true>;

/* ============================ URL ============================ */

/**
 * URL pública a diagnosticar.
 *
 * Em produção é o host real do tenant (`siteUrl`). Fora de produção esse host não
 * existe e o diagnóstico falharia sempre, então batemos direto em `/sites/{subdomain}`
 * no host da aplicação — `localhost:3000` está em ROOT_HOSTS, logo o middleware não
 * reescreve por host e a rota precisa ser explícita.
 */
function publicBase(site: { subdomain: string; customDomain: string | null }): string {
  const base =
    process.env.NODE_ENV === 'production'
      ? siteUrl(site)
      : `${APP_CONFIG.DOMAIN.replace(/\/+$/, '')}/sites/${site.subdomain}`;

  return base.replace(/\/+$/, '');
}

function withHealthCheckParam(base: string): string {
  try {
    const url = new URL(base);
    url.searchParams.set(HEALTH_CHECK_PARAM, '1');
    return url.toString();
  } catch {
    // NEXT_PUBLIC_APP_URL malformado não pode derrubar o diagnóstico inteiro.
    return `${base}?${HEALTH_CHECK_PARAM}=1`;
  }
}

export function diagnosticUrl(site: { subdomain: string; customDomain: string | null }): string {
  return withHealthCheckParam(publicBase(site));
}

/**
 * URL da política de privacidade do tenant.
 *
 * Sai da MESMA base da home, então em produção vira `https://host/politica-de-privacidade`
 * e em desenvolvimento `http://localhost:3000/sites/{subdomain}/politica-de-privacidade`,
 * que é onde a página realmente responde quando o middleware não reescreve por host.
 */
export function privacyPolicyUrl(site: {
  subdomain: string;
  customDomain: string | null;
}): string {
  return withHealthCheckParam(`${publicBase(site)}${PRIVACY_POLICY_PATH}`);
}

/* ============================ META TAG NO HTML ============================ */

const FACEBOOK_META_NAME = 'facebook-domain-verification';

/**
 * Teto de leitura do corpo. O <head> sempre está no começo do documento, e um domínio
 * próprio ainda não apontado para nós pode devolver uma página gigante de terceiro.
 */
const MAX_HTML_BYTES = 512 * 1024;

/**
 * Lê um atributo de uma tag isolada, tolerando aspas duplas, simples, sem aspas,
 * espaço em volta do `=` e caixa alta. Exige espaço antes do nome para não confundir
 * `name` com o sufixo de `data-name`.
 */
function readAttribute(tag: string, attribute: string): string | null {
  const pattern = new RegExp(
    `\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'\`=<>]+))`,
    'i',
  );

  const match = pattern.exec(tag);
  if (!match) return null;

  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Extrai o valor da meta tag de verificação do Facebook do HTML.
 *
 * Regex tolerante de propósito — NÃO é um parser de DOM. Aceita qualquer ordem de
 * atributos (`content` antes de `name`), qualquer tipo de aspas e espaçamento livre.
 *
 * Também é por isso que não se procura a string crua com `html.includes(valor)`:
 * um token curto daria falso positivo ao aparecer em qualquer outro lugar da página.
 */
export function extractFacebookMetaTag(html: string): string | null {
  // Regex local (e não de módulo) porque o flag `g` guarda `lastIndex` entre chamadas.
  const metaElements = /<meta\b[^>]*>/gi;

  for (let match = metaElements.exec(html); match !== null; match = metaElements.exec(html)) {
    const name = readAttribute(match[0], 'name');
    if (name === null || name.trim().toLowerCase() !== FACEBOOK_META_NAME) continue;

    const content = readAttribute(match[0], 'content');
    if (content === null) continue;

    const value = content.trim();
    if (value.length > 0) return value;
  }

  return null;
}

/* ============================ SONDAGEM HTTP ============================ */

interface Probe {
  httpStatus: number | null;
  latencyMs: number | null;
  reachable: boolean;
  sslOk: boolean;
  html: string | null;
  error: string | null;
  /**
   * Verdadeiro quando a falha é passageira (rede, timeout, 5xx, 429). Nesse caso o
   * resultado é 'indeterminado' e `metaTagVerified` NÃO pode ser zerado.
   */
  transient: boolean;
}

/** Status que o servidor devolve quando está sobrecarregado ou lento, não quando falta conteúdo. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

/** Códigos que o Node/undici usa para falha de TLS. */
const TLS_ERROR_CODES: ReadonlySet<string> = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'EPROTO',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

/**
 * Map e não objeto literal: `objeto[code]` consulta a cadeia de protótipos, então um
 * código exótico como 'constructor' devolveria uma função no lugar da mensagem.
 */
const NETWORK_ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['ENOTFOUND', 'O domínio não resolve para nenhum servidor. Confira o apontamento DNS.'],
  ['EAI_AGAIN', 'Falha temporária ao resolver o domínio. Tente novamente em alguns minutos.'],
  ['ECONNREFUSED', 'O servidor recusou a conexão.'],
  ['ECONNRESET', 'A conexão foi encerrada pelo servidor antes da resposta.'],
  ['ETIMEDOUT', 'O servidor não respondeu dentro do tempo limite.'],
  ['EHOSTUNREACH', 'Não foi possível alcançar o servidor do domínio.'],
]);

interface FetchFailure {
  message: string;
  tls: boolean;
}

/**
 * Lê uma propriedade string de um erro sem cast.
 *
 * `Reflect.get` em vez de `error[key]` porque a chave é uma união: o `in` só estreita
 * o tipo para chave literal. E em vez de `Object.entries` porque `message`/`name` são
 * propriedades NÃO enumeráveis de Error — a entrada não apareceria.
 */
function readErrorString(error: unknown, key: 'code' | 'name' | 'message'): string | null {
  if (typeof error !== 'object' || error === null) return null;

  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : null;
}

/**
 * `fetch` do undici embrulha a causa real em `TypeError: fetch failed`, então a
 * mensagem útil (e o código de TLS) está na cadeia de `cause`.
 */
function describeFetchError(error: unknown): FetchFailure {
  let current: unknown = error;
  let message: string | null = null;
  let tls = false;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const code = readErrorString(current, 'code');
    const raw = readErrorString(current, 'message');

    if (code !== null && TLS_ERROR_CODES.has(code)) tls = true;
    if (raw !== null && /certificate|ssl|tls/i.test(raw)) tls = true;

    const known = code !== null ? NETWORK_ERROR_MESSAGES.get(code) : undefined;
    if (message === null && known !== undefined) {
      message = known;
    }

    if (message === null && tls) {
      message = 'O certificado HTTPS do domínio não pôde ser validado.';
    }

    if (typeof current !== 'object') break;
    current = 'cause' in current ? current.cause : null;
  }

  return {
    message: message ?? 'Não foi possível conectar ao site.',
    tls,
  };
}

/**
 * Lê o corpo com teto de bytes. `res.text()` traria a página inteira para a memória,
 * e o alvo pode ser um domínio próprio ainda apontado para outro servidor.
 */
async function readCappedText(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let total = 0;

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;

      total += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });

      if (total >= MAX_HTML_BYTES) break;
    }

    text += decoder.decode();
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Fluxo já encerrado: nada a liberar.
    }
  }

  return text;
}

/**
 * Teto de tempo das sondagens secundárias (política de privacidade e robô da Meta).
 * Menor que o da home de propósito: elas correm em paralelo com a principal e não podem
 * esticar o diagnóstico inteiro. `lib/constants.ts` é compartilhado e está fora do escopo
 * desta trilha, então a constante mora aqui — mesmo critério de `TXT_LOOKUP_TIMEOUT_MS`.
 */
const SECONDARY_PROBE_TIMEOUT_MS = 10_000;

interface ProbeOptions {
  /**
   * User-Agent enviado. É ele que define o que o servidor "vê" chegando — e a única
   * diferença entre a sondagem 1 (nós) e a sondagem 6 (o robô da Meta).
   */
  userAgent: string;
  /** Teto de tempo desta sondagem. */
  timeoutMs: number;
}

/**
 * `User-Agent` SEMPRE explícito: o undici não manda nenhum por padrão e servidor sem UA
 * leva 403 de WAF com frequência — um falso negativo que já custou depuração aqui.
 */
async function probeSite(url: string, options: ProbeOptions): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();

  const secure = url.startsWith('https://');

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'User-Agent': options.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
      },
    });

    const transient = response.status >= 500 || TRANSIENT_STATUSES.has(response.status);

    if (!response.ok) {
      // Corpo descartado, mas precisa ser drenado para o socket voltar ao pool.
      await response.body?.cancel().catch(() => undefined);

      return {
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
        reachable: true,
        sslOk: secure,
        html: null,
        error: transient
          ? `O site respondeu HTTP ${response.status}. É uma falha passageira do servidor.`
          : null,
        transient,
      };
    }

    const html = await readCappedText(response);

    return {
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      reachable: true,
      sslOk: secure,
      html,
      error: null,
      transient: false,
    };
  } catch (error) {
    const aborted = readErrorString(error, 'name') === 'AbortError';
    const failure = describeFetchError(error);

    return {
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      reachable: false,
      sslOk: false,
      html: null,
      error: aborted
        ? `O site não respondeu em ${Math.round(options.timeoutMs / 1000)} segundos.`
        : failure.message,
      // Rede é sempre indeterminada: um blip não pode invalidar uma tag já verificada.
      transient: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ============================ BLOQUEIOS ANTES DA SONDAGEM ============================ */

interface Blocker {
  message: string;
  /** `true` quando a conclusão "a Meta não vai achar a tag" é definitiva, não passageira. */
  definitive: boolean;
}

function blockingReason(site: DiagnoseSiteInput): Blocker | null {
  if (site.buildStatus === 'QUEUED' || site.buildStatus === 'BUILDING') {
    return {
      message:
        'O site ainda está sendo provisionado. Rode o diagnóstico quando o provisionamento terminar.',
      definitive: false,
    };
  }

  if (!site.isPublished) {
    return {
      message:
        'O site está despublicado: a página pública responde 404 e a Meta não consegue ler a meta tag.',
      definitive: true,
    };
  }

  return null;
}

function blockedProbe(blocker: Blocker): Probe {
  return {
    httpStatus: null,
    latencyMs: null,
    reachable: false,
    sslOk: false,
    html: null,
    error: blocker.message,
    transient: !blocker.definitive,
  };
}

/* ============================ TXT (DNS) ============================ */

/** Teto de registros guardados: uma zona real tem SPF, DKIM, DMARC e mais. */
const MAX_STORED_TXT_RECORDS = 12;
const MAX_TXT_RECORD_LENGTH = 255;

interface TxtCheck extends TxtDiagnostic {
  error: string | null;
  problems: string[];
}

function normalizeToken(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function checkTxt(site: DiagnoseSiteInput): Promise<TxtCheck> {
  const expected = normalizeToken(site.verificationTxt);
  const host = normalizeToken(site.customDomain);

  // Sem domínio próprio o método TXT simplesmente não existe para este cliente:
  // a zona é nossa. Devolver 'ausente' aqui faria a UI pedir um registro que o
  // usuário nunca vai conseguir criar.
  if (host === null) {
    return {
      expected,
      records: [],
      outcome: 'indeterminado',
      applicable: false,
      error: null,
      problems: [],
    };
  }

  if (expected === null) {
    return {
      expected: null,
      records: [],
      outcome: 'ausente',
      applicable: true,
      error: null,
      problems: [
        'Nenhum token de verificação por TXT foi cadastrado para este domínio próprio.',
      ],
    };
  }

  const lookup = await lookupTxt(host);

  const records = lookup.records
    .slice(0, MAX_STORED_TXT_RECORDS)
    .map((record) => record.slice(0, MAX_TXT_RECORD_LENGTH));

  if (lookup.error !== null) {
    return {
      expected,
      records,
      outcome: 'indeterminado',
      applicable: true,
      error: lookup.error,
      problems: [`Não foi possível confirmar o registro TXT de ${host}: ${lookup.error}`],
    };
  }

  const matched = lookup.records.some((record) => txtRecordMatches(record, expected));

  return {
    expected,
    records,
    outcome: matched ? 'ok' : 'ausente',
    applicable: true,
    error: null,
    problems: matched
      ? []
      : [
          `O registro TXT de verificação não está na zona DNS de ${host}. ` +
            'A propagação leva de 5 a 15 minutos depois de salvar no provedor.',
        ],
  };
}

/* ============================ POLÍTICA DE PRIVACIDADE ============================ */

/**
 * Piso de conteúdo para a página valer como "existe de verdade".
 *
 * Um 200 com corpo vazio (ou com uma casca de `<html></html>` devolvida por proxy mal
 * configurado) é, para quem revisa o domínio, o mesmo que 404. A página que nós geramos
 * tem vários kB, então o piso só pega casca — nunca a página real.
 */
const MIN_PRIVACY_HTML_LENGTH = 200;

interface PrivacyCheck extends PrivacyPolicyDiagnostic {
  /** Já em pt-BR. O chamador decide se entram em `problems` ou se ficam abafados. */
  problems: string[];
}

function evaluatePrivacyPolicy(url: string, probe: Probe): PrivacyCheck {
  const htmlLength = probe.html === null ? 0 : probe.html.trim().length;
  const base = { url, httpStatus: probe.httpStatus, htmlLength };

  // Rede, timeout, 5xx e 429: não dá para concluir. Nunca 'ausente' — a página pode
  // estar lá e o caminho até ela é que falhou.
  if (probe.transient) {
    return {
      ...base,
      outcome: 'indeterminado',
      problems: [
        `Não foi possível confirmar a política de privacidade agora: ${
          probe.error ?? 'a página não respondeu.'
        }`,
      ],
    };
  }

  if (probe.httpStatus === null || probe.httpStatus < 200 || probe.httpStatus >= 300) {
    return {
      ...base,
      outcome: 'ausente',
      problems: [
        `A página de política de privacidade não abriu (HTTP ${
          probe.httpStatus ?? 'sem resposta'
        } em ${url}). O link para ela no rodapé é um dos sinais de legitimidade que a Meta avalia ao revisar o domínio.`,
      ],
    };
  }

  if (htmlLength < MIN_PRIVACY_HTML_LENGTH) {
    return {
      ...base,
      outcome: 'ausente',
      problems: [
        'A política de privacidade respondeu 200, mas praticamente sem conteúdo. Para quem revisa o domínio, uma página em branco vale o mesmo que uma página inexistente.',
      ],
    };
  }

  return { ...base, outcome: 'ok', problems: [] };
}

/* ============================ ROBÔ DA META ============================ */

interface CrawlerCheck extends CrawlerDiagnostic {
  problems: string[];
}

/**
 * Compara a resposta dada a NÓS com a resposta dada AO ROBÔ da Meta.
 *
 * A comparação é o ponto inteiro da checagem: 403 isolado poderia ser um site fora do ar,
 * mas 200 para o nosso User-Agent e 403 para o `facebookexternalhit` no mesmo instante é
 * prova de bloqueio por User-Agent. Sem a resposta boa do outro lado não há comparação, e o
 * resultado volta a seguir a regra conservadora.
 *
 * O que NÃO é prova: 429/408/425/5xx do lado do robô. Esses códigos são sobrecarga
 * passageira pela definição deste módulo (`TRANSIENT_STATUSES`), e as três sondagens saem
 * juntas do mesmo IP — um limitador de rajada barrando a segunda requisição é rotina.
 * Nesses casos o desfecho é 'indeterminado'.
 *
 * Sobre a meta tag nesta resposta: só conta como falha quando ela EXISTE para nós e SOME
 * para o robô (cache/CDN servindo variante por User-Agent). Se a tag não está em lugar
 * nenhum, quem reporta é a checagem 3 — repetir aqui só pintaria duas linhas de vermelho
 * pelo mesmo motivo e faria o usuário procurar um bloqueio que não existe.
 */
function evaluateCrawler(
  browser: Probe,
  crawler: Probe,
  expectedMeta: string | null,
  browserMetaFound: string | null,
): CrawlerCheck {
  const crawlerMeta = crawler.html === null ? null : extractFacebookMetaTag(crawler.html);

  const base = {
    userAgent: META_CRAWLER_USER_AGENT,
    httpStatus: crawler.httpStatus,
    latencyMs: crawler.latencyMs,
    metaTagFound: expectedMeta !== null && crawlerMeta === expectedMeta,
  };

  const browserOk =
    browser.httpStatus !== null && browser.httpStatus >= 200 && browser.httpStatus < 300;

  const crawlerOk =
    crawler.httpStatus !== null && crawler.httpStatus >= 200 && crawler.httpStatus < 300;

  // O robô abriu a página: para a Meta é só isso que importa, e não há bloqueio ao
  // rastreador a reportar. Vale MESMO quando a nossa própria sondagem falhou — nesse
  // caso quem foi filtrado fomos nós, e dizer "o robô está bloqueado" seria o oposto
  // do que a medição mostra.
  if (crawlerOk) {
    if (expectedMeta !== null && crawlerMeta !== expectedMeta && browserMetaFound === expectedMeta) {
      return {
        ...base,
        blocked: false,
        outcome: 'ausente',
        problems: [
          'A meta tag aparece quando nós baixamos a página, mas não veio na resposta entregue ao robô da Meta. ' +
            'Alguma camada de cache ou CDN está servindo uma versão diferente conforme o User-Agent: limpe o cache do domínio e rode o diagnóstico de novo.',
        ],
      };
    }

    return { ...base, blocked: false, outcome: 'ok', problems: [] };
  }

  // Sem uma resposta boa para o nosso User-Agent não há o que comparar: o problema já
  // foi reportado na infraestrutura e repetir aqui seria eco.
  if (!browserOk) {
    return {
      ...base,
      blocked: false,
      outcome: browser.transient ? 'indeterminado' : 'ausente',
      problems: [],
    };
  }

  if (crawler.httpStatus === null) {
    return {
      ...base,
      blocked: false,
      outcome: 'indeterminado',
      problems: [
        `Não foi possível repetir a visita com o User-Agent do robô da Meta: ${
          crawler.error ?? 'a requisição não teve resposta.'
        } O resultado desta checagem ficou inconclusivo.`,
      ],
    };
  }

  // 429/408/425/5xx: pela definição deste módulo é sobrecarga passageira, não decisão de
  // filtrar o rastreador. Concluir 'ausente' aqui manda o cliente caçar uma regra de WAF
  // que não existe e pinta de vermelho um site cuja tag está publicada e correta — e as
  // três sondagens saem juntas, do mesmo IP, então um limitador de rajada devolvendo 429
  // para a segunda delas é rotina, não evidência. Só 403/404/451 e afins, que são escolha
  // deliberada do servidor, seguem valendo como prova de bloqueio.
  if (crawler.transient) {
    return {
      ...base,
      blocked: false,
      outcome: 'indeterminado',
      problems: [
        `A visita repetida com o User-Agent do robô da Meta recebeu HTTP ${crawler.httpStatus}, que é código de sobrecarga passageira. Não dá para separar bloqueio ao rastreador de instabilidade do servidor: rode o diagnóstico de novo em alguns minutos.`,
      ],
    };
  }

  return {
    ...base,
    blocked: true,
    outcome: 'ausente',
    problems: [
      `O site respondeu HTTP ${browser.httpStatus} para um visitante comum, mas HTTP ${crawler.httpStatus} para o robô da Meta no mesmo instante. ` +
        'Alguma proteção que filtra por User-Agent — WAF, Cloudflare ou limite de requisições — está barrando o facebookexternalhit, e é por isso que a verificação falha mesmo com a página e o código corretos. ' +
        'Libere o User-Agent facebookexternalhit nas regras de segurança do seu servidor ou da sua CDN.',
    ],
  };
}

/* ============================ DIAGNÓSTICO ============================ */

export async function diagnoseSite(site: DiagnoseSiteInput): Promise<SiteDiagnostic> {
  const checkedAt = new Date().toISOString();
  const url = diagnosticUrl(site);
  const policyUrl = privacyPolicyUrl(site);
  const blocker = blockingReason(site);

  // As três sondagens HTTP e a consulta DNS são independentes entre si e cada uma tem o
  // próprio teto de tempo, então correm juntas: em série o diagnóstico levaria os 15s da
  // home somados aos 10s de cada secundária. A comparação navegador × robô também exige
  // que as duas requisições aconteçam praticamente ao mesmo tempo — com minutos de
  // diferença, um 503 no meio do caminho viraria "bloqueio por User-Agent" falso.
  const [probe, crawlerProbe, policyProbe, txt] = await Promise.all([
    blocker === null
      ? probeSite(url, {
          // Nós nos identificamos para que a página pública possa deixar de contar esta
          // requisição como visualização.
          userAgent: HEALTH_CHECK_USER_AGENT,
          timeoutMs: TIMEOUTS.META_TAG_CHECK,
        })
      : Promise.resolve(blockedProbe(blocker)),
    blocker === null
      ? probeSite(url, {
          userAgent: META_CRAWLER_USER_AGENT,
          timeoutMs: SECONDARY_PROBE_TIMEOUT_MS,
        })
      : Promise.resolve(blockedProbe(blocker)),
    blocker === null
      ? probeSite(policyUrl, {
          userAgent: HEALTH_CHECK_USER_AGENT,
          timeoutMs: SECONDARY_PROBE_TIMEOUT_MS,
        })
      : Promise.resolve(blockedProbe(blocker)),
    checkTxt(site),
  ]);

  const expectedMeta = normalizeToken(site.metaTag);
  const problems: string[] = [];

  /* — infraestrutura — */
  if (!probe.reachable && probe.error !== null) {
    problems.push(probe.error);
  } else if (probe.httpStatus !== null && (probe.httpStatus < 200 || probe.httpStatus >= 300)) {
    problems.push(
      `O site respondeu HTTP ${probe.httpStatus}. A Meta precisa de uma resposta 200 para ler a página.`,
    );
  }

  if (probe.reachable && !probe.sslOk) {
    problems.push('A página não está sendo servida por HTTPS válido.');
  }

  if (site.buildStatus === 'FAILED') {
    problems.push(
      'O último provisionamento deste site falhou. Refaça o provisionamento antes de submeter à Meta.',
    );
  }

  /* — meta tag — */
  let metaFound: string | null = null;
  let metaOutcome: DiagnosticOutcome;

  // A tag lida na resposta entregue AO ROBÔ. É esta a que a Meta enxerga: quando a NOSSA
  // sondagem volta sem HTML porque o servidor filtrou o nosso User-Agent (403 de WAF é o
  // caso comum num domínio próprio atrás de CDN), concluir 'ausente' zeraria
  // `metaTagVerified` e faria o monitor em lote contabilizar REGRESSÃO a cada rodada —
  // por uma tag que está publicada e que o rastreador acabou de ler.
  const crawlerMetaFound =
    crawlerProbe.html === null ? null : extractFacebookMetaTag(crawlerProbe.html);

  if (expectedMeta === null) {
    metaOutcome = 'ausente';
    problems.push(
      'Nenhum código de verificação da Meta foi cadastrado. Copie o valor de content="..." no Business Manager e salve aqui.',
    );
  } else if (probe.html === null) {
    if (crawlerMetaFound === expectedMeta) {
      metaFound = crawlerMetaFound;
      metaOutcome = 'ok';
    } else {
      metaOutcome = probe.transient ? 'indeterminado' : 'ausente';
    }
  } else {
    metaFound = extractFacebookMetaTag(probe.html);

    if (metaFound === expectedMeta) {
      metaOutcome = 'ok';
    } else {
      metaOutcome = 'ausente';
      problems.push(
        metaFound === null
          ? 'A meta tag facebook-domain-verification não está no <head> da página publicada.'
          : `O <head> publicado traz outro código (${metaFound}). Atualize o código cadastrado ou copie o valor correto no Business Manager.`,
      );
    }
  }

  /* — robô da Meta — */
  const crawler = evaluateCrawler(probe, crawlerProbe, expectedMeta, metaFound);
  problems.push(...crawler.problems);

  /* — TXT — */
  problems.push(...txt.problems);

  /* — política de privacidade — */
  const privacyPolicy = evaluatePrivacyPolicy(policyUrl, policyProbe);

  // Com a home fora do ar a política também estaria: relatar as duas coisas empilharia
  // a mesma falha duas vezes. O desfecho continua gravado, só a frase é abafada.
  if (probe.html !== null) {
    problems.push(...privacyPolicy.problems);
  }

  return {
    checkedAt,
    url,
    httpStatus: probe.httpStatus,
    latencyMs: probe.latencyMs,
    reachable: probe.reachable,
    sslOk: probe.sslOk,
    metaTag: { expected: expectedMeta, found: metaFound, outcome: metaOutcome },
    txt: {
      expected: txt.expected,
      records: txt.records,
      outcome: txt.outcome,
      applicable: txt.applicable,
    },
    privacyPolicy: {
      url: privacyPolicy.url,
      httpStatus: privacyPolicy.httpStatus,
      htmlLength: privacyPolicy.htmlLength,
      outcome: privacyPolicy.outcome,
    },
    crawler: {
      userAgent: crawler.userAgent,
      httpStatus: crawler.httpStatus,
      latencyMs: crawler.latencyMs,
      metaTagFound: crawler.metaTagFound,
      blocked: crawler.blocked,
      outcome: crawler.outcome,
    },
    error: probe.error ?? txt.error,
    problems,
  };
}

/* ============================ SERIALIZAÇÃO ============================ */

export function toDiagnosticJson(diagnostic: SiteDiagnostic): Prisma.InputJsonObject {
  return {
    version: DIAGNOSTIC_VERSION,
    checkedAt: diagnostic.checkedAt,
    url: diagnostic.url,
    httpStatus: diagnostic.httpStatus,
    latencyMs: diagnostic.latencyMs,
    reachable: diagnostic.reachable,
    sslOk: diagnostic.sslOk,
    metaTag: {
      expected: diagnostic.metaTag.expected,
      found: diagnostic.metaTag.found,
      outcome: diagnostic.metaTag.outcome,
    },
    txt: {
      expected: diagnostic.txt.expected,
      records: [...diagnostic.txt.records],
      outcome: diagnostic.txt.outcome,
      applicable: diagnostic.txt.applicable,
    },
    privacyPolicy: {
      url: diagnostic.privacyPolicy.url,
      httpStatus: diagnostic.privacyPolicy.httpStatus,
      htmlLength: diagnostic.privacyPolicy.htmlLength,
      outcome: diagnostic.privacyPolicy.outcome,
    },
    crawler: {
      userAgent: diagnostic.crawler.userAgent,
      httpStatus: diagnostic.crawler.httpStatus,
      latencyMs: diagnostic.crawler.latencyMs,
      metaTagFound: diagnostic.crawler.metaTagFound,
      blocked: diagnostic.crawler.blocked,
      outcome: diagnostic.crawler.outcome,
    },
    error: diagnostic.error,
    problems: [...diagnostic.problems],
  };
}

/* ============================ NARROWING DE LEITURA ============================ */
/* Mesmo estilo de components/site-templates/types.ts: nada de `as`. A coluna é Json
   e pode conter qualquer coisa gravada por uma versão anterior do formato.          */

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asBoolean = (value: unknown): boolean => value === true;

/** Qualquer coisa fora dos dois desfechos conclusivos vira 'indeterminado' — o estado seguro. */
const asOutcome = (value: unknown): DiagnosticOutcome => {
  if (value === 'ok') return 'ok';
  if (value === 'ausente') return 'ausente';
  return 'indeterminado';
};

const asTextList = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .map(asText)
        .filter((item): item is string => item !== null)
        .slice(0, max)
    : [];

/**
 * Lê `Site.lastDiagnostic` de volta para o tipo. Devolve `null` quando o valor não
 * tem cara de diagnóstico (coluna nula, `{}` de uma versão anterior, lixo).
 */
export function parseDiagnostic(value: unknown): SiteDiagnostic | null {
  const raw = asRecord(value);

  const checkedAt = asText(raw.checkedAt);
  const url = asText(raw.url);

  // Sem estes dois não há o que mostrar — e é assim que `{}` é rejeitado.
  if (checkedAt === null || url === null) return null;
  if (Number.isNaN(new Date(checkedAt).getTime())) return null;

  const metaTag = asRecord(raw.metaTag);
  const txt = asRecord(raw.txt);
  // Ausentes num JSON versão 1: `asRecord` devolve `{}` e cada campo cai no default,
  // com `asOutcome` levando o desfecho para 'indeterminado' — nada foi medido.
  const privacyPolicy = asRecord(raw.privacyPolicy);
  const crawler = asRecord(raw.crawler);

  return {
    checkedAt,
    url,
    httpStatus: asFiniteNumber(raw.httpStatus),
    latencyMs: asFiniteNumber(raw.latencyMs),
    reachable: asBoolean(raw.reachable),
    sslOk: asBoolean(raw.sslOk),
    metaTag: {
      expected: asText(metaTag.expected),
      found: asText(metaTag.found),
      outcome: asOutcome(metaTag.outcome),
    },
    txt: {
      expected: asText(txt.expected),
      records: asTextList(txt.records, MAX_STORED_TXT_RECORDS),
      outcome: asOutcome(txt.outcome),
      applicable: asBoolean(txt.applicable),
    },
    privacyPolicy: {
      url: asText(privacyPolicy.url),
      httpStatus: asFiniteNumber(privacyPolicy.httpStatus),
      htmlLength: asFiniteNumber(privacyPolicy.htmlLength) ?? 0,
      outcome: asOutcome(privacyPolicy.outcome),
    },
    crawler: {
      // O UA é constante nossa: um registro antigo não o trazia, e mostrar o valor
      // que a checagem usa hoje é mais útil (e mais honesto) do que uma string vazia.
      userAgent: asText(crawler.userAgent) ?? META_CRAWLER_USER_AGENT,
      httpStatus: asFiniteNumber(crawler.httpStatus),
      latencyMs: asFiniteNumber(crawler.latencyMs),
      metaTagFound: asBoolean(crawler.metaTagFound),
      blocked: asBoolean(crawler.blocked),
      outcome: asOutcome(crawler.outcome),
    },
    error: asText(raw.error),
    problems: asTextList(raw.problems, 20),
  };
}

/* ============================ PERSISTÊNCIA ============================ */

/**
 * ÚNICA escritora de `lastDiagnostic`, `metaTagVerified` e `metaTagLastCheckedAt`.
 * O monitor em lote importa esta função — não reimplemente a gravação em outro lugar.
 *
 * Regra que não pode regredir: `metaTagVerified` só é zerado quando o resultado é
 * 'ausente' (o servidor respondeu e o código não estava lá). Em 'indeterminado'
 * apenas o carimbo de tempo e o JSON são atualizados, para que uma queda de rede não
 * apague uma verificação legítima.
 *
 * As checagens 5 (política de privacidade) e 6 (robô da Meta) são gravadas dentro de
 * `lastDiagnostic` e NÃO mexem em `metaTagVerified`/`verificationTxtVerified` de
 * propósito: essas colunas significam "a tag/o registro está publicado", que é
 * exatamente o que as checagens 3 e 4 mediram. Deixar um 403 no robô zerar
 * `metaTagVerified` faria o monitor em lote contabilizar REGRESSÃO de verificação
 * (lib/verification/monitor.ts) por um motivo que não é ausência de tag. Quem traduz
 * "o robô está bloqueado" para o usuário é o veredito do cartão de diagnóstico.
 */
export async function persistDiagnostic(
  siteId: string,
  diagnostic: SiteDiagnostic,
): Promise<void> {
  const parsedAt = new Date(diagnostic.checkedAt);
  const checkedAt = Number.isNaN(parsedAt.getTime()) ? new Date() : parsedAt;

  const data: Prisma.SiteUpdateManyMutationInput = {
    lastDiagnostic: toDiagnosticJson(diagnostic),
    // Atualizado nos três desfechos: é ele que faz o round-robin do cron avançar.
    metaTagLastCheckedAt: checkedAt,
  };

  if (diagnostic.metaTag.outcome === 'ok') {
    data.metaTagVerified = true;
  } else if (diagnostic.metaTag.outcome === 'ausente') {
    data.metaTagVerified = false;
  }

  // TXT inaplicável (subdomínio da plataforma) não mexe em nada do TXT.
  if (diagnostic.txt.applicable) {
    data.verificationTxtLastCheckedAt = checkedAt;

    if (diagnostic.txt.outcome === 'ok') {
      data.verificationTxtVerified = true;
    } else if (diagnostic.txt.outcome === 'ausente') {
      data.verificationTxtVerified = false;
    }
  }

  // updateMany e não update: o site pode ter sido excluído entre a leitura e a
  // gravação, e `update` lançaria P2025 no meio de um lote do cron.
  await prisma.site.updateMany({ where: { id: siteId, isDeleted: false }, data });
}
