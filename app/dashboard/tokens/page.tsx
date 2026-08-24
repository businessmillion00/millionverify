import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE, tokenLabel } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { Reveal } from '@/components/ui/reveal';
import { PageHeader } from '@/components/dashboard/page-header';
import { TokenBalance } from '@/components/dashboard/token-balance';
import { EmptyState } from '@/components/dashboard/empty-state';
import {
  PaymentStatusBadge,
  TransactionList,
  type TransactionItem,
} from '@/components/dashboard/transaction-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tokens · Million Verify',
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

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

/** Quantas movimentações o extrato carrega de uma vez. */
const LIMITE_EXTRATO = 60;

function Resumo({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-dark-700 bg-white/[0.02] p-5">
      <p className="text-xs uppercase tracking-widest text-dark-500">{label}</p>
      <p className={`mt-3 text-2xl font-semibold tabular-nums ${tone ?? 'text-white'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-dark-500">{hint}</p>
    </div>
  );
}

export default async function TokensPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;

  const [user, movimentacoes, pagamentos, entradas, saidas, investido] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenBalance: true },
    }),
    prisma.tokenTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: LIMITE_EXTRATO,
      select: {
        id: true,
        type: true,
        amount: true,
        description: true,
        balanceAfter: true,
        createdAt: true,
      },
    }),
    prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        amount: true,
        tokensGranted: true,
        status: true,
        description: true,
        createdAt: true,
        paidAt: true,
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
    prisma.payment.aggregate({
      where: { userId, status: 'CONFIRMED' },
      _sum: { amount: true },
    }),
  ]);

  const hoje = DIA.format(new Date());
  const ontem = DIA.format(new Date(Date.now() - 86_400_000));

  const extrato: TransactionItem[] = movimentacoes.map((mov) => {
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

  const historico = movimentacoes.slice(0, 20).map((mov) => mov.balanceAfter).reverse();
  const creditados = entradas._sum.amount ?? 0;
  const consumidos = saidas._sum.amount ?? 0;
  const emAberto = pagamentos.find((pagamento) => pagamento.status === 'PENDING');

  return (
    <>
      <PageHeader
        eyebrow="Tokens"
        title="Extrato de tokens"
        description={`Cada site publicado consome ${tokenLabel(TOKENS_PER_SITE)}. Sem mensalidade — os tokens não expiram.`}
      >
        <Link href="/dashboard/billing" className="btn-primary">
          Comprar tokens
        </Link>
      </PageHeader>

      <Reveal className="mt-10">
        <div className="grid gap-5 lg:grid-cols-3">
          <TokenBalance
            className="lg:col-span-2"
            balance={user.tokenBalance}
            history={historico}
          />

          <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
            <Resumo
              label="Creditados"
              value={`+${creditados.toLocaleString('pt-BR')}`}
              hint="Compras, bônus e estornos"
              tone="text-emerald-400"
            />
            <Resumo
              label="Consumidos"
              value={`−${consumidos.toLocaleString('pt-BR')}`}
              hint={`${Math.floor(consumidos / TOKENS_PER_SITE).toLocaleString('pt-BR')} sites publicados`}
              tone="text-red-400"
            />
            <Resumo
              label="Investido"
              value={formatCurrency(investido._sum.amount ?? 0)}
              hint="Somente cobranças confirmadas"
            />
          </div>
        </div>
      </Reveal>

      {emAberto && (
        <div className="card mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="badge badge-warning">Cobrança em aberto</span>
            <p className="mt-3 text-sm text-dark-300">
              Um PIX de{' '}
              <span className="tabular-nums">{formatCurrency(emAberto.amount)}</span> por{' '}
              <span className="tabular-nums">
                {emAberto.tokensGranted.toLocaleString('pt-BR')}
              </span>{' '}
              tokens ainda aguarda pagamento.
            </p>
          </div>

          <Link href={`/dashboard/billing/${emAberto.id}`} className="btn-primary">
            Ver PIX
          </Link>
        </div>
      )}

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Movimentações</h2>
            <p className="mt-1 text-sm text-dark-500">
              {extrato.length === 0
                ? 'Nada movimentado até agora'
                : `Últimas ${extrato.length.toLocaleString('pt-BR')} operações do saldo`}
            </p>
          </div>

          {extrato.length >= LIMITE_EXTRATO && (
            <p className="text-xs text-dark-500">
              Mostrando as {LIMITE_EXTRATO} mais recentes
            </p>
          )}
        </div>

        <div className="mt-6">
          <TransactionList
            items={extrato}
            grouped
            empty={
              <EmptyState
                title="Seu extrato começa na primeira compra"
                description="Aqui entram os tokens comprados, os bônus recebidos e o consumo de cada site publicado — com o saldo resultante de cada operação."
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
                    <path d="M4 7c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3zM4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7" />
                    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
                  </svg>
                }
                action={
                  <Link href="/dashboard/billing" className="btn-primary">
                    Comprar tokens
                  </Link>
                }
              />
            }
          />
        </div>
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Cobranças</h2>
            <p className="mt-1 text-sm text-dark-500">Recargas geradas por PIX</p>
          </div>

          {pagamentos.length > 0 && (
            <Link
              href="/dashboard/billing"
              className="text-sm text-dark-400 transition-colors hover:text-white"
            >
              Ver todas as compras →
            </Link>
          )}
        </div>

        {pagamentos.length > 0 ? (
          <Reveal stagger="[data-cobranca]" className="mt-6">
            <ul className="rounded-2xl border border-dark-700 bg-white/[0.02] px-5 sm:px-6">
              {pagamentos.map((pagamento) => (
                <li
                  key={pagamento.id}
                  data-cobranca
                  className="flex flex-wrap items-center gap-4 border-b border-white/5 py-4 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {pagamento.description}
                    </p>
                    <p className="mt-1 text-xs text-dark-500 tabular-nums">
                      {DATA_HORA.format(pagamento.createdAt)}
                      {pagamento.paidAt && ` · pago em ${DATA_HORA.format(pagamento.paidAt)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-white tabular-nums">
                        {formatCurrency(pagamento.amount)}
                      </p>
                      <p className="mt-1 text-xs text-dark-500 tabular-nums">
                        {pagamento.tokensGranted.toLocaleString('pt-BR')} tokens
                      </p>
                    </div>

                    <PaymentStatusBadge status={pagamento.status} />

                    {pagamento.status === 'PENDING' && (
                      <Link
                        href={`/dashboard/billing/${pagamento.id}`}
                        className="text-xs text-amber-400 transition-colors hover:text-amber-300"
                      >
                        Ver PIX
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        ) : (
          <div className="mt-6">
            <EmptyState
              title="Nenhuma cobrança gerada"
              description="As recargas por PIX aparecem aqui com o status em tempo real — os tokens entram na conta assim que a cobrança é confirmada."
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
                  <path d="M12 3.2l8.8 8.8-8.8 8.8L3.2 12 12 3.2z" />
                  <path d="M9.4 12l2.6 2.6L14.6 12 12 9.4 9.4 12z" />
                </svg>
              }
              action={
                <Link href="/dashboard/billing" className="btn-primary">
                  Gerar cobrança PIX
                </Link>
              }
            />
          </div>
        )}
      </section>
    </>
  );
}
