import Link from 'next/link';
import { eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';
import { getRevenueOverview } from '@/app/actions/admin';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE } from '@/lib/constants';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatTile } from '@/components/admin/stat-tile';
import { RevenueChart, type PontoFaturamento } from '@/components/admin/revenue-chart';
import { AuditTable } from '@/components/admin/audit-table';

export const dynamic = 'force-dynamic';

const JANELA_DIAS = 30;

export default async function AdminDashboard() {
  const hoje = startOfDay(new Date());
  const desde = subDays(hoje, JANELA_DIAS - 1);

  const [stats, logs, pagamentos] = await Promise.all([
    getRevenueOverview(),
    prisma.auditLog.findMany({
      take: 40,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        resource: true,
        resourceId: true,
        status: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    }),
    // groupBy por createdAt agruparia por timestamp exato; a série diária é montada aqui.
    prisma.payment.findMany({
      where: {
        status: 'CONFIRMED',
        OR: [{ paidAt: { gte: desde } }, { paidAt: null, createdAt: { gte: desde } }],
      },
      select: { amount: true, tokensGranted: true, paidAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const baldes = new Map<string, { valor: number; tokens: number }>();
  for (const dia of eachDayOfInterval({ start: desde, end: hoje })) {
    baldes.set(format(dia, 'yyyy-MM-dd'), { valor: 0, tokens: 0 });
  }

  let pagamentosNoPeriodo = 0;
  for (const pagamento of pagamentos) {
    const balde = baldes.get(format(pagamento.paidAt ?? pagamento.createdAt, 'yyyy-MM-dd'));
    if (!balde) continue;
    balde.valor += pagamento.amount;
    balde.tokens += pagamento.tokensGranted;
    pagamentosNoPeriodo += 1;
  }

  const serie: PontoFaturamento[] = Array.from(baldes, ([dia, valores]) => ({
    dia,
    valor: valores.valor,
    tokens: valores.tokens,
  }));

  const faturamentoNoPeriodo = serie.reduce((soma, ponto) => soma + ponto.valor, 0);
  const ticketMedio =
    stats.confirmedPayments > 0 ? stats.revenue / stats.confirmedPayments : 0;
  const sitesEquivalentes = Math.floor(stats.tokensSold / TOKENS_PER_SITE);

  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Master Control"
        description="Faturamento, consumo de tokens e o rastro de auditoria do produto inteiro."
      >
        <Link href="/admin/users" className="btn-secondary">
          Gerenciar usuários
        </Link>
      </PageHeader>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Faturamento"
          value={stats.revenue}
          format="currency"
          hint={`${stats.confirmedPayments.toLocaleString('pt-BR')} pagamentos confirmados`}
        />
        <StatTile
          label="Em aberto"
          value={stats.pendingRevenue}
          format="currency"
          hint={`${stats.pendingPayments.toLocaleString('pt-BR')} aguardando PIX`}
          delay={0.06}
        />
        <StatTile
          label="Ticket médio"
          value={ticketMedio}
          format="currency"
          hint="Por pagamento confirmado"
          delay={0.12}
        />
        <StatTile
          label={`Últimos ${JANELA_DIAS} dias`}
          value={faturamentoNoPeriodo}
          format="currency"
          hint={`${pagamentosNoPeriodo.toLocaleString('pt-BR')} pagamentos no período`}
          delay={0.18}
        />
        <StatTile
          label="Tokens vendidos"
          value={stats.tokensSold}
          hint={`≈ ${sitesEquivalentes.toLocaleString('pt-BR')} sites de ${TOKENS_PER_SITE} tokens`}
          delay={0.24}
        />
        <StatTile
          label="Usuários"
          value={stats.totalUsers}
          hint={`${stats.totalSites.toLocaleString('pt-BR')} sites ativos`}
          delay={0.3}
        />
      </div>

      <div className="mt-8">
        <RevenueChart pontos={serie} />
      </div>

      <div className="mt-8">
        <AuditTable registros={logs} />
      </div>
    </>
  );
}
