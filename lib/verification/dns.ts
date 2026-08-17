import { resolveTxt } from 'node:dns/promises';

/**
 * Resolução de registros TXT — MÓDULO EXCLUSIVO DE SERVIDOR.
 *
 * Nunca importe daqui em client component: `node:dns/promises` não existe no browser
 * e o bundle quebra em tempo de build.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A Meta oferece DOIS caminhos para verificar um domínio e eles NÃO são a mesma coisa:
 *
 *   1. META TAG      → <meta name="facebook-domain-verification" content="..."> no <head>.
 *                      Vive no HTML. Conferir = baixar a página. Vale na hora.
 *   2. REGISTRO TXT  → uma entrada TXT na ZONA DNS do domínio.
 *                      NÃO aparece no HTML — procurar a string na página é o erro clássico
 *                      que produz um verificador que nunca funciona. Conferir = RESOLVER DNS.
 *                      Propaga em 5-15 minutos (às vezes mais, conforme o TTL do provedor).
 *
 * Este módulo cobre exclusivamente o caso 2.
 */

/**
 * `resolveTxt` não aceita AbortSignal, então o teto de tempo é feito por corrida
 * (`Promise.race`). A consulta perdedora continua rodando em segundo plano até o
 * resolver do sistema desistir — não há como cancelá-la, e o custo é um socket UDP
 * ocioso. Por isso o valor é curto: DNS que passa disso não vai responder mesmo.
 *
 * `lib/constants.ts` é compartilhado e está fora do escopo desta trilha; a constante
 * mora aqui de propósito.
 */
export const TXT_LOOKUP_TIMEOUT_MS = 8_000;

/** Prefixo que a Meta espera no valor do registro TXT. O banco guarda só o token. */
export const FACEBOOK_TXT_PREFIX = 'facebook-domain-verification=';

export interface TxtLookupResult {
  /** Registros TXT encontrados, cada um já remontado a partir dos seus pedaços. */
  records: string[];
  /**
   * Mensagem em pt-BR quando o resultado é INDETERMINADO (timeout, SERVFAIL, host inválido).
   * `null` significa "resposta confiável" — inclusive a resposta confiável "não há TXT algum",
   * que vem como `records: []` com `error: null`.
   */
  error: string | null;
  /** Código devolvido pelo resolver (ENOTFOUND, ENODATA, ETIMEDOUT…), quando houve falha. */
  code: string | null;
}

/**
 * Códigos que são uma resposta NEGATIVA CONFIÁVEL, não uma falha de infraestrutura:
 *  - ENODATA   → o nome existe, mas não tem nenhum registro TXT.
 *  - ENOTFOUND → o nome não existe na zona (NXDOMAIN).
 * Nos dois casos a conclusão correta é "o TXT não está lá", e não "não deu para checar".
 */
const AUTHORITATIVE_NEGATIVES: ReadonlySet<string> = new Set(['ENODATA', 'ENOTFOUND']);

/**
 * Mensagens em pt-BR para os códigos de falha que o resolver costuma devolver.
 * Map e não objeto literal: `objeto[code]` consulta a cadeia de protótipos, então um
 * código exótico como 'constructor' devolveria uma função no lugar da mensagem.
 */
const ERROR_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['ETIMEDOUT', 'A consulta DNS excedeu o tempo limite. Tente novamente em alguns minutos.'],
  ['ETIMEOUT', 'A consulta DNS excedeu o tempo limite. Tente novamente em alguns minutos.'],
  ['ESERVFAIL', 'O servidor DNS do domínio respondeu com falha (SERVFAIL).'],
  ['EREFUSED', 'O servidor DNS recusou a consulta (REFUSED).'],
  ['ECONNREFUSED', 'Não foi possível falar com o servidor DNS.'],
  ['EAI_AGAIN', 'Falha temporária de resolução de nomes. Tente novamente em alguns minutos.'],
  ['ENOTIMP', 'O servidor DNS não implementa esse tipo de consulta.'],
  ['EBADRESP', 'O servidor DNS devolveu uma resposta malformada.'],
]);

/**
 * Rótulo de host válido. Barrar aqui evita mandar lixo (ou uma string com espaço,
 * vinda de um customDomain mal colado) para o resolver do sistema.
 */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Lê `error.code` sem cast: `in` estreita o tipo e o typeof confirma a string. */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('code' in error)) return null;

  const { code } = error;
  return typeof code === 'string' ? code : null;
}

/**
 * Normaliza o host antes de resolver: minúsculas, sem espaços, sem protocolo,
 * sem caminho, sem porta e sem o ponto final da forma absoluta.
 */
export function normalizeHostname(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const withoutPath = withoutScheme.split('/')[0];
  const withoutPort = withoutPath.split(':')[0];
  const withoutTrailingDot = withoutPort.replace(/\.$/, '');

  return HOSTNAME_PATTERN.test(withoutTrailingDot) ? withoutTrailingDot : null;
}

/**
 * Resolve os TXT de um host. NUNCA lança: toda falha vira `{ records, error, code }`.
 *
 * Detalhe que quebra implementações ingênuas: `resolveTxt` devolve `string[][]`.
 * Cada registro chega FATIADO em pedaços de até 255 caracteres (limite de uma
 * character-string de DNS), então comparar `chunks[0]` com o token dá falso negativo
 * em qualquer token longo. Os pedaços precisam ser concatenados SEM separador.
 */
export async function lookupTxt(hostname: string): Promise<TxtLookupResult> {
  const host = normalizeHostname(hostname);

  if (!host) {
    return {
      records: [],
      error: 'Domínio inválido para consulta DNS.',
      code: 'EINVALIDHOST',
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const chunked = await Promise.race([
      resolveTxt(host),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const timeout: NodeJS.ErrnoException = new Error('Tempo limite da consulta DNS');
          timeout.code = 'ETIMEDOUT';
          reject(timeout);
        }, TXT_LOOKUP_TIMEOUT_MS);
      }),
    ]);

    return {
      records: chunked.map((chunks) => chunks.join('').trim()).filter((record) => record.length > 0),
      error: null,
      code: null,
    };
  } catch (error) {
    const code = readErrorCode(error);

    // NXDOMAIN/ENODATA são resposta, não erro: o TXT comprovadamente não está lá.
    if (code !== null && AUTHORITATIVE_NEGATIVES.has(code)) {
      return { records: [], error: null, code };
    }

    return {
      records: [],
      error:
        (code !== null ? ERROR_MESSAGES.get(code) : undefined) ??
        'Não foi possível consultar o DNS deste domínio agora.',
      code,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * O registro que a Meta pede é `facebook-domain-verification=<token>`, mas o painel
 * guarda apenas `<token>` (Site.verificationTxt). Alguns provedores de DNS ainda
 * devolvem o valor entre aspas. Aceitamos as duas formas, com e sem prefixo.
 */
export function txtRecordMatches(record: string, token: string): boolean {
  const expected = token.trim();
  if (!expected) return false;

  const value = record.trim().replace(/^"(.*)"$/s, '$1').trim();
  if (value === expected) return true;

  if (value.toLowerCase().startsWith(FACEBOOK_TXT_PREFIX)) {
    return value.slice(FACEBOOK_TXT_PREFIX.length).trim() === expected;
  }

  return false;
}

/** Valor exato que o usuário deve colar no painel de DNS do provedor dele. */
export function expectedTxtValue(token: string): string {
  return `${FACEBOOK_TXT_PREFIX}${token.trim()}`;
}
