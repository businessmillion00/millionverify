import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE, tokenLabel } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { PackagePicker } from '@/components/billing/package-picker';
import {
  PaymentHistory,
  type PaymentHistoryItem,
} from '@/components/billing/payment-history';

export const dynamic = 'force-dynamic';

/** Fuso fixo: o rótulo é gerado no servidor e não pode depender do TZ da máquina. */
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const Stat = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="card">
    <p className="text-xs uppercase tracking-widest text-dark-500">{label}</p>
    <p className="text-gradient mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    {hint && <p className="mt-1 text-xs text-dark-500">{hint}</p>}
  </div>
);

export default async function BillingPage() {
  const session = await auth();

  // O middleware já cobre /dashboard, mas a página não pode depender disso:
  // a sessão é lida aqui de qualquer forma para montar as consultas.
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;

  const [user, payments, confirmed] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenBalance: true, asaasCustomerId: true },
    }),
    prisma.payment.findMany({
      where: { userId },
      select: {
        id: true,
        amount: true,
        tokensGranted: true,
        status: true,
        description: true,
        createdAt: true,
        paidAt: true,
        pixQrCode: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.payment.aggregate({
      where: { userId, status: 'CONFIRMED' },
      _sum: { amount: true },
    }),
  ]);

  const history: PaymentHistoryItem[] = payments.map((payment) => ({
    id: payment.id,
    amount: payment.amount,
    tokens: payment.tokensGranted,
    status: payment.status,
    description: payment.description,
    createdAtLabel: dateTimeFormatter.format(payment.createdAt),
    paidAtLabel: payment.paidAt ? dateTimeFormatter.format(payment.paidAt) : null,
  }));

  // Cobrança viva: leva o usuário de volta ao PIX já gerado em vez de deixá-lo
  // criar uma segunda cobrança para a mesma intenção de compra.
  const openCharge = payments.find(
    (payment) => payment.status === 'PENDING' && payment.pixQrCode !== null
  );

  /*
   * O cliente no Asaas é criado na primeira compra, então a existência dele não
   * gateia mais a tela. O que importa é o provedor estar configurado.
   */
  const billingEnabled = Boolean(process.env.ASAAS_API_KEY?.trim());

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Comprar tokens</h1>
          <p className="mt-1 text-sm text-dark-400">
            Cada site publicado consome {tokenLabel(TOKENS_PER_SITE)}. Sem
            mensalidade — os tokens não expiram.
          </p>
        </div>

        <Link href="/dashboard" className="btn-secondary">
          Voltar ao painel
        </Link>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Saldo"
          value={`${user.tokenBalance.toLocaleString('pt-BR')} tokens`}
        />
        <Stat
          label="Sites disponíveis"
          value={Math.floor(user.tokenBalance / TOKENS_PER_SITE).toLocaleString(
            'pt-BR'
          )}
          hint={`${tokenLabel(TOKENS_PER_SITE)} por site`}
        />
        <Stat
          label="Total investido"
          value={formatCurrency(confirmed._sum.amount ?? 0)}
          hint="Somente cobranças confirmadas"
        />
      </div>

      {!billingEnabled && (
        <div className="card mt-8">
          <span className="badge badge-warning">Compras indisponíveis</span>
          <p className="mt-3 text-sm text-dark-300">
            O provedor de pagamentos não está configurado, então não é possível
            gerar uma cobrança PIX agora. Tente novamente mais tarde ou fale com
            o suporte.
          </p>
        </div>
      )}

      {openCharge && (
        <div className="card mt-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="badge badge-warning">Cobrança em aberto</span>
            <p className="mt-3 text-sm text-dark-300">
              Você já tem um PIX de{' '}
              <span className="tabular-nums">
                {formatCurrency(openCharge.amount)}
              </span>{' '}
              aguardando pagamento. Conclua esse antes de gerar outro.
            </p>
          </div>

          <Link
            href={`/dashboard/billing/${openCharge.id}`}
            className="btn-primary"
          >
            Ver PIX
          </Link>
        </div>
      )}

      <h2 className="mt-14 text-xl font-semibold">Escolha seu pacote</h2>
      <PackagePicker billingEnabled={billingEnabled} />

      <h2 className="mt-16 text-xl font-semibold">Histórico de compras</h2>
      <PaymentHistory payments={history} />
    </>
  );
}
