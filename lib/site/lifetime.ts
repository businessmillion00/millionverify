/**
 * Vida útil dos sites.
 *
 * Um site não é permanente: nasce com `expiresAt` = criação + SITE_LIFETIME_DAYS
 * e, passado o prazo, sai do ar e é excluído. A verificação da Meta é feita uma
 * vez; depois de confirmada, a página não precisa continuar publicada — e um
 * teto de MAX_SITES_PER_USER sites por conta só é viável se os antigos
 * liberarem espaço sozinhos.
 *
 * A expiração acontece em DUAS camadas, de propósito:
 *  1. `activeSiteWhere()` — toda leitura que importa (página pública, contagem
 *     do limite, listagens do painel) filtra por `expiresAt > agora`. O site
 *     some no minuto exato, sem depender de rotina.
 *  2. `expireSites()` — a rotina (app/api/cron/expire-sites) faz a exclusão de
 *     fato: marca `isDeleted`, registra auditoria e devolve o subdomínio à
 *     Vercel. O GitHub não garante pontualidade do agendamento, então ela é a
 *     limpeza, não o gatilho.
 *
 * Exclusão lógica, igual a `deleteSite` (app/actions/site-manage.ts): o
 * subdomínio segue ocupado pela unique constraint e o histórico (tokens,
 * auditoria) continua apontando para o site.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { APP_CONFIG, SITE_LIFETIME_MS } from '@/lib/constants';
import {
  isDomainAutomationConfigured,
  removeProjectDomain,
} from '@/services/vercel-domains';

/** Instante em que um site criado em `from` deixa de existir. */
export function siteExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + SITE_LIFETIME_MS);
}

/**
 * Filtro de "site vivo": não excluído E dentro do prazo. Use em toda consulta
 * que decide o que o cliente — ou o crawler da Meta — enxerga.
 */
export function activeSiteWhere(now: Date = new Date()): Prisma.SiteWhereInput {
  return { isDeleted: false, expiresAt: { gt: now } };
}

/** Falta menos de um dia: o painel destaca em âmbar. */
export function isExpiringSoon(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < 86_400_000;
}

/** Lote padrão por rodada; a rota aceita `?limit=` até EXPIRE_MAX_BATCH. */
export const EXPIRE_BATCH_SIZE = 25;
export const EXPIRE_MAX_BATCH = 100;

/** Remoções de domínio simultâneas na Vercel. */
const DOMAIN_REMOVAL_CONCURRENCY = 5;

export type ExpireSummary = {
  /** Sites excluídos nesta rodada. */
  expired: number;
  /** Vencidos que sobraram ao final — acima de zero indica atraso acumulado. */
  remaining: number;
};

/**
 * Exclui os sites cujo prazo venceu. Idempotente e segura para rodar em
 * paralelo com o painel: o `isDeleted: false` no update garante que um site
 * excluído pelo dono no meio da rodada não é registrado em dobro.
 */
export async function expireSites(
  limit: number = EXPIRE_BATCH_SIZE,
  now: Date = new Date(),
): Promise<ExpireSummary> {
  const take = Math.max(1, Math.min(Math.trunc(limit) || EXPIRE_BATCH_SIZE, EXPIRE_MAX_BATCH));

  const vencidos = await prisma.site.findMany({
    where: { isDeleted: false, expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take,
    select: {
      id: true,
      userId: true,
      name: true,
      subdomain: true,
      customDomain: true,
      expiresAt: true,
    },
  });

  const excluidos: typeof vencidos = [];

  // Primeiro o banco, site a site e sem transação longa: o pool é compartilhado
  // com o painel e uma transação de dezenas de comandos seguraria conexão à toa.
  for (const site of vencidos) {
    const { count } = await prisma.site.updateMany({
      where: { id: site.id, isDeleted: false },
      data: { isDeleted: true, isPublished: false },
    });

    if (count === 0) continue;

    await prisma.auditLog.create({
      data: {
        userId: site.userId,
        action: 'SITE_EXPIRED',
        resource: 'site',
        resourceId: site.id,
        changes: {
          name: site.name,
          subdomain: site.subdomain,
          expiresAt: site.expiresAt.toISOString(),
        },
        status: 'success',
      },
    });

    excluidos.push(site);
  }

  // Depois a Vercel, com o banco já consistente: se a função estourar o tempo
  // aqui, sobra no máximo um domínio órfão no painel — irritante, inofensivo.
  // `removeProjectDomain` nunca lança. Domínio próprio não é nosso para remover.
  if (isDomainAutomationConfigured()) {
    const hosts = excluidos
      .filter((site) => !site.customDomain)
      .map((site) => `${site.subdomain}${APP_CONFIG.SUBDOMAIN_SUFFIX}`);

    for (let index = 0; index < hosts.length; index += DOMAIN_REMOVAL_CONCURRENCY) {
      await Promise.all(
        hosts.slice(index, index + DOMAIN_REMOVAL_CONCURRENCY).map(removeProjectDomain),
      );
    }
  }

  const remaining = await prisma.site.count({
    where: { isDeleted: false, expiresAt: { lte: now } },
  });

  return { expired: excluidos.length, remaining };
}
