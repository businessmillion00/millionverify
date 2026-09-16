import Link from 'next/link';
import { eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';
import { getRevenueOverview } from '@/app/actions/admin';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE, tokenLabel } from '@/lib/constants';
import { SMS_PROVIDER_LOW_BALANCE, SMS_SERVICES } from '@/lib/sms/catalog';
import { getSmsProviderBalance } from '@/lib/sms/stock';
import { formatCurrency } from '@/lib/utils';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatTile } from '@/components/admin/stat-tile';
import { RevenueChart, type PontoFaturamento } from '@/components/admin/revenue-chart';
import { AuditTable } from '@/components/admin/audit-table';

export const dynamic = 'force-dynamic';

const JANELA_DIAS = 30;

/**
 * Card estático para quando o saldo do sms24h não pôde ser lido. Sem número
 * não há count-up, e um StatTile com zero mentiria: zero é "acabou o saldo",
 * não "não sei".
 */
function ProviderUnavailableTile({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-red-500/40 bg-white/[0.02] p-6">
      <p className="text-xs uppercase tracking-widest text-dark-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-red-400">—</p>
      <p className="mt-1.5 text-xs text-red-400/80">{hint}</p>
    </div>
  );
}

export default async function AdminDashboard() {
  const hoje = startOfDay(new Date());
  const desde = subDays(hoje, JANELA_DIAS - 1);

  const [stats, logs, pagamentos, provedor] = await Promise.all([
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
    getSmsProviderBalance(),
  ]);

  // O saldo no sms24h é o estoque de números: cada venda desconta dali, e
  // zerado toda venda falha em silêncio. O custo de referência do WhatsApp dá
  // a régua mais conservadora de quantos números ainda cabem.
  const custoWhatsApp = SMS_SERVICES.WHATSAPP.referenceCostCents / 100;
  const numerosWhatsApp =
    provedor.state === 'ok' ? Math.floor(provedor.balance / custoWhatsApp) : 0;
  const saldoBaixo = provedor.state === 'ok' && provedor.balance < SMS_PROVIDER_LOW_BALANCE;

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
          hint={`≈ ${sitesEquivalentes.toLocaleString('pt-BR')} sites de ${tokenLabel(TOKENS_PER_SITE)}`}
          delay={0.24}
        />
        <StatTile
          label="Usuários"
          value={stats.totalUsers}
          hint={`${stats.totalSites.toLocaleString('pt-BR')} sites ativos`}
          delay={0.3}
        />
        {provedor.state === 'ok' ? (
          <StatTile
            label="Saldo no sms24h"
            value={provedor.balance}
            format="currency"
            hint={
              saldoBaixo
                ? `Abaixo de ${formatCurrency(SMS_PROVIDER_LOW_BALANCE)} — recarregue antes que as vendas de número parem`
                : `≈ ${numerosWhatsApp.toLocaleString('pt-BR')} números de WhatsApp a ${formatCurrency(custoWhatsApp)}`
            }
            tone={saldoBaixo ? 'warning' : 'default'}
            delay={0.36}
          />
        ) : (
          <ProviderUnavailableTile
            label="Saldo no sms24h"
            hint={
              provedor.state === 'unconfigured'
                ? 'SMS24H_API_KEY não configurada — vendas de número desligadas'
                : `Sem resposta do provedor: ${provedor.message}`
            }
          />
        )}
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
