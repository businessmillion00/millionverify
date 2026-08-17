/**
 * Monitoramento contínuo da verificação de domínio da Meta.
 *
 * Este módulo é o ORQUESTRADOR DE LOTE e nada mais: ele não sabe fazer fetch, não
 * sabe ler HTML e não resolve DNS. Toda a checagem vive em `lib/verification/diagnose.ts`
 * (a trilha dona do contrato de `Site.lastDiagnostic`) e é reaproveitada aqui. Se este
 * arquivo passasse a reimplementar a checagem, existiriam dois serializadores de
 * `lastDiagnostic` e o cartão de diagnóstico do painel renderizaria lixo metade das vezes.
 *
 * O que ele acrescenta em cima do diagnóstico unitário:
 *  1. seleção do lote (round-robin por `metaTagLastCheckedAt`, quem esperou mais vai antes);
 *  2. concorrência limitada — 50 fetches simultâneos derrubam o pool do Prisma junto;
 *  3. detecção de REGRESSÃO: site que estava verificado e deixou de estar. Esse é o evento
 *     que antecede a queda da Business Manager do cliente, então vira AuditLog;
 *  4. o resumo agregado que o operador do job lê.
 *
 * Regra que NÃO pode ser afrouxada: um erro de rede ou de DNS é `'indeterminado'`, nunca
 * `'ausente'`. Só o veredito `'ausente'` — a resposta chegou e a tag/registro não estava lá —
 * pode zerar `metaTagVerified`/`verificationTxtVerified`. Um blip de rede derrubando
 * "Tag ativa" para "Aguardando verificação" no painel é regressão de produto, não de rede.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/security/audit';
import {
  DIAGNOSE_SITE_SELECT,
  diagnoseSite,
  persistDiagnostic,
  type SiteDiagnostic,
} from '@/lib/verification/diagnose';

/** Lote padrão por execução do cron. Mantido em 50, igual à versão anterior do job. */
export const MONITOR_BATCH_SIZE = 50;

/** Teto rígido: protege contra alguém chamar `monitorSites(10_000)` e travar o processo. */
const MONITOR_MAX_BATCH = 200;

/**
 * Concorrência do lote. Baixa de propósito: cada item faz um fetch HTTP, possivelmente
 * uma consulta DNS e de duas a três escritas no Postgres. O pool padrão do Prisma é
 * pequeno e uma rajada de 50 o esgota antes de o primeiro fetch responder.
 */
const MONITOR_CONCURRENCY = 5;

/** Ação de auditoria emitida quando uma verificação já conquistada é perdida. */
export const VERIFICATION_REGRESSED_ACTION = 'SITE_VERIFICATION_REGRESSED';

export interface MonitorSummary {
  /** Sites efetivamente processados nesta rodada. */
  checked: number;
  /**
   * Sites com a meta tag válida AO FIM da rodada. Em resultado indeterminado o veredito
   * anterior é mantido — este número acompanha a coluna `metaTagVerified`, não o fetch.
   */
  verified: number;
  /** Sites que responderam, mas sem a meta tag esperada no HTML. */
  missing: number;
  /**
   * Sites cujo resultado ficou indeterminado (timeout, DNS, 5xx). Eixo independente de
   * `verified`: nada foi desverificado por causa deles.
   */
  unreachable: number;
  /** Falhas do próprio job (exceção ao diagnosticar ou ao gravar). */
  errors: number;
  /** Sites com o registro TXT válido ao fim da rodada (só quem tem domínio próprio). */
  txtVerified: number;
  /** Sites que ESTAVAM verificados e deixaram de estar — cada um gerou AuditLog. */
  regressed: number;
  /** Sites que voltaram (ou passaram) a ficar verificados nesta rodada. */
  recovered: number;
}

/**
 * Colunas do lote: as que `diagnoseSite` exige (reaproveitadas de `DIAGNOSE_SITE_SELECT`,
 * para o select acompanhar sozinho qualquer campo novo do diagnóstico) mais o que só o
 * monitor precisa — dono e nome para a auditoria, e os dois booleanos ANTERIORES de
 * verificação, sem os quais não há como saber se houve regressão.
 *
 * Nada de `content`/`registryData`/`cnpjDocumentUrl`: são colunas pesadas e carregá-las
 * 50 vezes por rodada não serve para nada aqui.
 */
const MONITOR_SELECT = {
  ...DIAGNOSE_SITE_SELECT,
  id: true,
  userId: true,
  name: true,
  metaTagVerified: true,
  verificationTxtVerified: true,
} as const satisfies Prisma.SiteSelect;

type MonitoredSite = Prisma.SiteGetPayload<{ select: typeof MONITOR_SELECT }>;

/** Resultado de um único site, agregado depois em `MonitorSummary`. */
interface SiteOutcome {
  verified: boolean;
  missing: boolean;
  unreachable: boolean;
  error: boolean;
  txtVerified: boolean;
  regressed: boolean;
  recovered: boolean;
}

const NEUTRAL_OUTCOME: SiteOutcome = {
  verified: false,
  missing: false,
  unreachable: false,
  error: false,
  txtVerified: false,
  regressed: false,
  recovered: false,
};

/**
 * Percorre o lote de sites publicados e prontos, rediagnostica cada um e atualiza o banco.
 *
 * Só entram no lote sites com `buildStatus: 'READY'` e `isPublished: true`: um site ainda
 * em provisionamento seria marcado como "tag não encontrada" sem nunca ter tido a chance
 * de responder, e um site despublicado devolve 404 por decisão de produto (a página pública
 * filtra `isPublished: true`), o que também não é ausência de tag.
 */
export async function monitorSites(limit: number = MONITOR_BATCH_SIZE): Promise<MonitorSummary> {
  const take = Math.max(1, Math.min(Math.trunc(limit) || MONITOR_BATCH_SIZE, MONITOR_MAX_BATCH));

  const sites = await prisma.site.findMany({
    where: {
      isPublished: true,
      isDeleted: false,
      buildStatus: 'READY',
      metaTag: { not: null },
    },
    // Round-robin: quem nunca foi checado vai primeiro, depois o mais antigo. Como cada
    // rodada carimba `metaTagLastCheckedAt`, o site recém-visto vai para o fim da fila.
    orderBy: { metaTagLastCheckedAt: { sort: 'asc', nulls: 'first' } },
    take,
    select: MONITOR_SELECT,
  });

  const outcomes = await mapInChunks(sites, MONITOR_CONCURRENCY, monitorSite);

  return outcomes.reduce<MonitorSummary>(
    (summary, outcome) => ({
      checked: summary.checked + 1,
      verified: summary.verified + (outcome.verified ? 1 : 0),
      missing: summary.missing + (outcome.missing ? 1 : 0),
      unreachable: summary.unreachable + (outcome.unreachable ? 1 : 0),
      errors: summary.errors + (outcome.error ? 1 : 0),
      txtVerified: summary.txtVerified + (outcome.txtVerified ? 1 : 0),
      regressed: summary.regressed + (outcome.regressed ? 1 : 0),
      recovered: summary.recovered + (outcome.recovered ? 1 : 0),
    }),
    {
      checked: 0,
      verified: 0,
      missing: 0,
      unreachable: 0,
      errors: 0,
      txtVerified: 0,
      regressed: 0,
      recovered: 0,
    },
  );
}

/**
 * Diagnostica e persiste um único site. Nunca lança: uma falha isolada não pode
 * interromper o lote inteiro, senão um site quebrado congela a fila de todos os outros.
 */
async function monitorSite(site: MonitoredSite): Promise<SiteOutcome> {
  let diagnostic: SiteDiagnostic;

  try {
    diagnostic = await diagnoseSite(site);
  } catch (error) {
    console.error(`[monitor] Falha ao diagnosticar o site ${site.id}:`, error);
    return { ...NEUTRAL_OUTCOME, error: true };
  }

  try {
    // Escritor único de lastDiagnostic/metaTagVerified/metaTagLastCheckedAt.
    await persistDiagnostic(site.id, diagnostic);
  } catch (error) {
    console.error(`[monitor] Falha ao gravar o diagnóstico do site ${site.id}:`, error);
    return { ...NEUTRAL_OUTCOME, error: true };
  }

  const txt = txtTransition(site, diagnostic);

  const metaOutcome = diagnostic.metaTag.outcome;

  // Espelha o que `persistDiagnostic` acabou de gravar: em 'indeterminado' a coluna não
  // é tocada, então o veredito que continua valendo é o anterior. Contar 'indeterminado'
  // como não verificado faria o número do job despencar a cada instabilidade de rede,
  // exatamente o alarme falso que este arquivo existe para evitar.
  const metaVerified =
    metaOutcome === 'ok' ? true : metaOutcome === 'ausente' ? false : site.metaTagVerified;

  const metaRegressed = site.metaTagVerified && metaOutcome === 'ausente';
  const metaRecovered = !site.metaTagVerified && metaOutcome === 'ok';

  const outcome: SiteOutcome = {
    verified: metaVerified,
    missing: metaOutcome === 'ausente',
    // Eixo independente de `verified`: diz quantos NÃO deram para concluir nesta rodada
    // (site fora do ar, timeout, 5xx). Um site indeterminado que já estava verificado
    // aparece nos dois contadores, e é assim mesmo.
    unreachable: metaOutcome === 'indeterminado',
    error: false,
    txtVerified: txt.verified,
    regressed: metaRegressed || txt.regressed,
    recovered: metaRecovered || txt.recovered,
  };

  if (outcome.regressed) {
    await auditRegression(site, diagnostic, { metaTag: metaRegressed, txt: txt.regressed });
  }

  return outcome;
}

interface TxtTransition {
  verified: boolean;
  regressed: boolean;
  recovered: boolean;
}

/**
 * Lê a transição do registro TXT. Função PURA: quem grava
 * `verificationTxtVerified`/`verificationTxtLastCheckedAt` é `persistDiagnostic`, já
 * chamado logo acima — repetir a escrita aqui só criaria um segundo dono das mesmas
 * colunas. O espelhamento das regras é intencional e tem que continuar idêntico:
 * 'ok' verifica, 'ausente' desverifica, 'indeterminado' preserva o veredito anterior.
 *
 * Lembrete que já custou retrabalho neste projeto: o TXT NÃO fica no HTML do site, ele é
 * uma entrada na ZONA DNS — quem resolve isso é `lookupTxt` (lib/verification/dns.ts),
 * chamado lá dentro de `diagnoseSite`. E o método só existe para quem tem domínio próprio:
 * na zona de `*.businessmillion.app` o cliente não consegue criar registro nenhum, então o
 * diagnóstico devolve `applicable: false` e não há transição alguma a contabilizar.
 */
function txtTransition(site: MonitoredSite, diagnostic: SiteDiagnostic): TxtTransition {
  const { txt } = diagnostic;

  if (!txt.applicable) {
    return { verified: false, regressed: false, recovered: false };
  }

  if (txt.outcome === 'indeterminado') {
    // DNS instável não derruba verificação: o veredito anterior continua valendo.
    return { verified: site.verificationTxtVerified, regressed: false, recovered: false };
  }

  const verified = txt.outcome === 'ok';

  return {
    verified,
    regressed: site.verificationTxtVerified && !verified,
    recovered: !site.verificationTxtVerified && verified,
  };
}

/**
 * Registra a perda de uma verificação já conquistada.
 *
 * É o único evento deste job que o dono do site precisa ver: enquanto a verificação está
 * de pé nada acontece, mas quando ela cai a Meta pode revogar o acesso da Business Manager.
 * O log entra com `status: 'error'` para destacar na tabela de auditoria do painel.
 */
async function auditRegression(
  site: MonitoredSite,
  diagnostic: SiteDiagnostic,
  lost: { metaTag: boolean; txt: boolean },
): Promise<void> {
  const perdidos = [lost.metaTag ? 'meta tag' : null, lost.txt ? 'registro TXT' : null]
    .filter((item): item is string => item !== null)
    .join(' e ');

  const changes: Prisma.InputJsonObject = {
    site: site.name,
    url: diagnostic.url,
    checkedAt: diagnostic.checkedAt,
    httpStatus: diagnostic.httpStatus,
    latencyMs: diagnostic.latencyMs,
    reachable: diagnostic.reachable,
    sslOk: diagnostic.sslOk,
    problems: diagnostic.problems,
    metaTag: {
      lost: lost.metaTag,
      outcome: diagnostic.metaTag.outcome,
      expected: diagnostic.metaTag.expected,
      found: diagnostic.metaTag.found,
    },
    txt: {
      lost: lost.txt,
      outcome: diagnostic.txt.outcome,
      applicable: diagnostic.txt.applicable,
      expected: diagnostic.txt.expected,
      records: diagnostic.txt.records,
    },
  };

  // Fora de transação `recordAudit` engole o próprio erro e apenas loga: uma falha de
  // auditoria não pode desfazer o monitoramento que já foi gravado.
  await recordAudit({
    userId: site.userId,
    action: VERIFICATION_REGRESSED_ACTION,
    resource: 'site',
    resourceId: site.id,
    status: 'error',
    errorMessage: `Verificação perdida (${perdidos}) em ${diagnostic.url}`,
    changes,
  });
}

/**
 * Executa `fn` sobre os itens em blocos de no máximo `size` em paralelo.
 *
 * Existe uma versão equivalente em lib/tokens/reconcile.ts, mas ela é privada daquele
 * módulo — copiar aqui é mais barato que exportar utilitário de um arquivo de outro time.
 */
async function mapInChunks<TIn, TOut>(
  items: readonly TIn[],
  size: number,
  fn: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> {
  const chunkSize = Math.max(1, size);
  const results: TOut[] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    results.push(...(await Promise.all(chunk.map((item) => fn(item)))));
  }

  return results;
}
