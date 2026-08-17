import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE, tokenLabel } from '@/lib/constants';
import { siteHost } from '@/lib/subdomain';

export const dynamic = 'force-dynamic';

/** Espelha o teto aplicado por createSite (app/actions/site.ts) — o servidor continua sendo a autoridade. */
const MAX_SITES = 5;

const STATUS_FILTERS = [
  { value: 'todos', label: 'Todos' },
  { value: 'publicados', label: 'Publicados' },
  { value: 'despublicados', label: 'Despublicados' },
  { value: 'verificados', label: 'Tag verificada' },
  { value: 'pendentes', label: 'Tag pendente' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

type SearchParam = string | string[] | undefined;

type Props = {
  searchParams: Promise<{ q?: SearchParam; status?: SearchParam; ok?: SearchParam; erro?: SearchParam }>;
};

/** A querystring pode repetir a mesma chave; vale a primeira ocorrência. */
const first = (value: SearchParam): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const isStatusFilter = (value: string): value is StatusFilter =>
  STATUS_FILTERS.some((filter) => filter.value === value);

const statusWhere = (status: StatusFilter): Prisma.SiteWhereInput => {
  switch (status) {
    case 'publicados':
      return { isPublished: true };
    case 'despublicados':
      return { isPublished: false };
    case 'verificados':
      return { metaTagVerified: true };
    case 'pendentes':
      return { metaTagVerified: false };
    default:
      return {};
  }
};

const searchWhere = (term: string): Prisma.SiteWhereInput =>
  term
    ? {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { companyName: { contains: term, mode: 'insensitive' } },
          { subdomain: { contains: term.toLowerCase() } },
        ],
      }
    : {};

export default async function DashboardSitesPage({ searchParams }: Props) {
  const session = await auth();
  const userId = session!.user.id;

  const params = await searchParams;
  const term = first(params.q).trim();
  const requestedStatus = first(params.status);
  const status: StatusFilter = isStatusFilter(requestedStatus) ? requestedStatus : 'todos';
  const isFiltering = term.length > 0 || status !== 'todos';

  const okMessage = first(params.ok);
  const errorMessage = first(params.erro);

  const [sites, totalSites] = await Promise.all([
    prisma.site.findMany({
      where: {
        userId,
        isDeleted: false,
        ...statusWhere(status),
        ...searchWhere(term),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        companyName: true,
        subdomain: true,
        customDomain: true,
        isPublished: true,
        metaTagVerified: true,
        viewsCount: true,
        createdAt: true,
      },
    }),
    prisma.site.count({ where: { userId, isDeleted: false } }),
  ]);

  const reachedLimit = totalSites >= MAX_SITES;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Seus sites</h1>
          <p className="mt-2 text-sm text-dark-400">
            <span className="tabular-nums text-white">
              {totalSites.toLocaleString('pt-BR')}/{MAX_SITES}
            </span>{' '}
            sites · {tokenLabel(TOKENS_PER_SITE)} por site
          </p>
        </div>

        {reachedLimit ? (
          <span className="badge badge-warning">Limite de {MAX_SITES} sites atingido</span>
        ) : (
          <Link href="/dashboard/sites/new" className="btn-primary">
            Criar site
          </Link>
        )}
      </div>

      {okMessage && <p className="badge badge-success mt-6">{okMessage}</p>}
      {errorMessage && <p className="badge badge-error mt-6">{errorMessage}</p>}

      <form method="get" className="glass mt-8 flex flex-wrap items-center gap-3 p-3">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Buscar por nome, razão social ou subdomínio"
          aria-label="Buscar sites"
          className="min-w-[16rem] flex-1"
        />

        <select
          name="status"
          defaultValue={status}
          aria-label="Filtrar por status"
          className="sm:w-52"
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>

        <button type="submit" className="btn-secondary">
          Filtrar
        </button>

        {isFiltering && (
          <Link href="/dashboard/sites" className="btn-ghost">
            Limpar
          </Link>
        )}
      </form>

      {sites.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site, index) => (
            <Link
              key={site.id}
              href={`/dashboard/sites/${site.id}`}
              /* Cascata em CSS puro: a lista remonta a cada busca/filtro e o
                 ScrollTrigger do <Reveal> deixaria cards presos em opacity 0. */
              style={{
                animationDelay: `${Math.min(index, 8) * 50}ms`,
                animationFillMode: 'backwards',
              }}
              className="card-hover block animate-slide-up"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{site.name}</h2>
                  <p className="mt-1 truncate text-xs text-dark-500">{site.companyName}</p>
                </div>

                <span
                  className={
                    site.isPublished ? 'badge badge-success' : 'badge badge-warning'
                  }
                >
                  {site.isPublished ? 'No ar' : 'Rascunho'}
                </span>
              </div>

              <p className="mt-4 truncate text-sm text-amber-400">{siteHost(site)}</p>

              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-dark-500">
                <span className="tabular-nums">
                  {site.viewsCount.toLocaleString('pt-BR')} visualizações
                </span>
                <span className={site.metaTagVerified ? 'text-green-400' : 'text-yellow-400'}>
                  {site.metaTagVerified ? 'Tag verificada' : 'Tag pendente'}
                </span>
              </div>

              <p className="mt-2 text-xs text-dark-500">
                Criado em {site.createdAt.toLocaleDateString('pt-BR')}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card mt-8 text-center">
          <p className="text-dark-400">
            {isFiltering
              ? 'Nenhum site corresponde à busca.'
              : 'Você ainda não criou nenhum site.'}
          </p>

          {isFiltering ? (
            <Link
              href="/dashboard/sites"
              className="mt-4 inline-block text-sm text-amber-400 hover:underline"
            >
              Limpar filtros
            </Link>
          ) : (
            <Link href="/dashboard/sites/new" className="btn-primary mt-6 inline-block">
              Criar meu primeiro site
            </Link>
          )}
        </div>
      )}

      {sites.length > 0 && (
        <p className="mt-8 text-xs text-dark-500">
          Abra um site para editar os dados, trocar o template, publicar ou excluir.
        </p>
      )}
    </>
  );
}
