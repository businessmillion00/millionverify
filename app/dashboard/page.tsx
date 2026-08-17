import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSitesByUser } from '@/app/actions/site';
import { TOKENS_PER_SITE } from '@/lib/constants';
import { Reveal } from '@/components/ui/reveal';
import { PageHeader } from '@/components/dashboard/page-header';
import { TokenBalance } from '@/components/dashboard/token-balance';
import { SiteCard } from '@/components/dashboard/site-card';
import { EmptyState } from '@/components/dashboard/empty-state';
import {
  TransactionList,
  type TransactionItem,
} from '@/components/dashboard/transaction-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Visão geral · Business Million',
};

/** Fuso fixo: os rótulos nascem no servidor e não podem depender do TZ da máquina. */
const DIA = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const DIA_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

function Metric({
  label,
  value,
  hint,
  glyph,
}: {
  label: string;
  value: string;
  hint: string;
  glyph: string;
}) {
  return (
    <div className="rounded-2xl border border-dark-700 bg-white/[0.02] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-widest text-dark-500">{label}</p>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="h-5 w-5 text-amber-500/70"
        >
          <path d={glyph} />
        </svg>
      </div>

      <p className="mt-3 text-2xl font-semibold text-white tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-dark-500">{hint}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;

  const [sites, user, movimentacoes, entradas, saidas] = await Promise.all([
    getSitesByUser(),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, tokenBalance: true },
    }),
    prisma.tokenTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        type: true,
        amount: true,
        description: true,
        balanceAfter: true,
        createdAt: true,
      },
    }),
    prisma.tokenTransaction.aggregate({
      where: { userId, type: { in: ['PURCHASE', 'BONUS', 'REFUND'] } },
      _sum: { amount: true },
    }),
    prisma.tokenTransaction.aggregate({
      where: { userId, type: 'USAGE' },
      _sum: { amount: true },
    }),
  ]);

  // `success` é inferido como boolean nas actions: narrowing não acontece aqui.
  const listaSites = sites.data ?? [];

  const hoje = DIA.format(new Date());
  const ontem = DIA.format(new Date(Date.now() - 86_400_000));

  const recentes: TransactionItem[] = movimentacoes.slice(0, 6).map((mov) => {
    const dayKey = DIA.format(mov.createdAt);

    return {
      id: mov.id,
      type: mov.type,
      amount: mov.amount,
      description: mov.description,
      balanceAfter: mov.balanceAfter,
      dayKey,
      dayLabel:
        dayKey === hoje ? 'Hoje' : dayKey === ontem ? 'Ontem' : DIA_EXTENSO.format(mov.createdAt),
      timeLabel: HORA.format(mov.createdAt),
    };
  });

  const historico = movimentacoes.map((mov) => mov.balanceAfter).reverse();

  const totalVisitas = listaSites.reduce((soma, site) => soma + site.viewsCount, 0);
  const tagsAtivas = listaSites.filter((site) => site.metaTagVerified).length;
  const primeiroNome = user.name?.trim().split(' ')[0] ?? 'bem-vindo';

  return (
    <>
      <PageHeader
        eyebrow="Painel"
        title={`Olá, ${primeiroNome}`}
        description="Acompanhe seus sites, o status da verificação e o consumo de tokens em um só lugar."
      >
        <Link href="/dashboard/billing" className="btn-secondary">
          Comprar tokens
        </Link>
        <Link href="/dashboard/sites/new" className="btn-primary">
          Criar site
        </Link>
      </PageHeader>

      <Reveal className="mt-10">
        <div className="grid gap-5 lg:grid-cols-3">
          <TokenBalance
            className="lg:col-span-2"
            balance={user.tokenBalance}
            credited={entradas._sum.amount ?? 0}
            spent={saidas._sum.amount ?? 0}
            history={historico}
            statementHref="/dashboard/tokens"
          />

          <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
            <Metric
              label="Sites"
              value={listaSites.length.toLocaleString('pt-BR')}
              hint="Limite de 5 por conta"
              glyph="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5v-11zM4 9h16"
            />
            <Metric
              label="Visitas"
              value={totalVisitas.toLocaleString('pt-BR')}
              hint="Somadas em todos os sites"
              glyph="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
            />
            <Metric
              label="Tags ativas"
              value={`${tagsAtivas}/${listaSites.length}`}
              hint="Meta tags confirmadas"
              glyph="M12 3.5l7 2.8v4.9c0 4.24-2.98 8.17-7 9.3-4.02-1.13-7-5.06-7-9.3V6.3l7-2.8zM9.2 12.1l1.9 1.9 3.7-3.9"
            />
          </div>
        </div>
      </Reveal>

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Seus sites</h2>
            <p className="mt-1 text-sm text-dark-500">
              {listaSites.length === 0
                ? 'Nenhum site publicado ainda'
                : `${listaSites.length} de 5 sites usados`}
            </p>
          </div>

          {listaSites.length > 0 && (
            <Link
              href="/dashboard/sites"
              className="text-sm text-dark-400 transition-colors hover:text-white"
            >
              Ver todos →
            </Link>
          )}
        </div>

        {listaSites.length > 0 ? (
          <Reveal stagger="[data-site]" className="mt-6">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listaSites.map((site) => (
                // O wrapper é o alvo do GSAP; o cartão anima com Framer.
                // Separar os nós evita que as duas bibliotecas disputem o transform.
                <div key={site.id} data-site>
                  <SiteCard
                    name={site.name}
                    subdomain={site.subdomain}
                    companyName={site.companyName}
                    isPublished={site.isPublished}
                    viewsCount={site.viewsCount}
                    metaTagVerified={site.metaTagVerified}
                    createdAtLabel={formatDistanceToNow(site.createdAt, {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  />
                </div>
              ))}
            </div>
          </Reveal>
        ) : (
          <div className="mt-6">
            <EmptyState
              title={`Seu primeiro site está a ${TOKENS_PER_SITE} tokens de distância`}
              description="Informe o CNPJ, escolha o subdomínio e publicamos a página com a meta tag de verificação já no lugar."
              action={
                <>
                  <Link href="/dashboard/sites/new" className="btn-primary">
                    Criar site
                  </Link>
                  {user.tokenBalance < TOKENS_PER_SITE && (
                    <Link href="/dashboard/billing" className="btn-secondary">
                      Comprar tokens
                    </Link>
                  )}
                </>
              }
            />
          </div>
        )}
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Movimentações recentes</h2>
            <p className="mt-1 text-sm text-dark-500">Últimas entradas e saídas de tokens</p>
          </div>

          {recentes.length > 0 && (
            <Link
              href="/dashboard/tokens"
              className="text-sm text-dark-400 transition-colors hover:text-white"
            >
              Ver extrato completo →
            </Link>
          )}
        </div>

        <div className="mt-6">
          <TransactionList
            items={recentes}
            empty={
              <EmptyState
                title="Nenhuma movimentação por aqui"
                description="Compras, bônus e o consumo de cada site publicado aparecem nesta linha do tempo assim que a primeira operação acontecer."
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-7 w-7"
                  >
                    <path d="M3 12h4l2.5 6 4-13 2.5 7H21" />
                  </svg>
                }
                action={
                  <Link href="/dashboard/billing" className="btn-secondary">
                    Comprar tokens
                  </Link>
                }
              />
            }
          />
        </div>
      </section>
    </>
  );
}
