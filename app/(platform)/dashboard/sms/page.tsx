import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tokenLabel } from '@/lib/constants';
import { sms24hService } from '@/services/sms24h';
import { getSmsStock } from '@/lib/sms/stock';
import { OPEN_STATUSES, reclaimStaleRequests } from '@/lib/sms/activation';
import {
  SMS_ACTIVATION_TTL_MS,
  SMS_SERVICES,
  SMS_TOKENS_PER_SITE_TOKEN,
  affordable,
  formatSmsPhone,
  formatSmsTokens,
  smsTokenLabel,
} from '@/lib/sms/catalog';
import { isSmsCreditType } from '@/lib/sms/wallet';
import { Reveal } from '@/components/ui/reveal';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { ServicePicker } from '@/components/sms/service-picker';
import { TokenConverter } from '@/components/sms/token-converter';
import { ActivationList, type ActivationListItem } from '@/components/sms/activation-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Números para SMS · Million Verify',
};

/** Fuso fixo: os rótulos nascem no servidor e não podem depender do TZ da máquina. */
const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

const WALLET_TYPE_LABEL = {
  CONVERSION: 'Conversão',
  PURCHASE: 'Número',
  REFUND: 'Devolução',
} as const;

function Resumo({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dark-700 bg-white/[0.02] p-5">
      <p className="text-xs uppercase tracking-widest text-dark-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tabular-nums text-white">{value}</p>
      <p className="mt-1 text-xs text-dark-500">{hint}</p>
    </div>
  );
}

export default async function SmsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;

  // Antes de ler o saldo: uma reserva órfã (processo morto entre o débito e o
  // pedido ao provedor) é devolvida aqui, sem esperar o cron.
  await reclaimStaleRequests(userId);

  const [user, activations, movimentos, totais, comCodigo, stock] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenBalance: true, smsBalanceCents: true },
    }),
    prisma.smsActivation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        service: true,
        status: true,
        phone: true,
        priceCents: true,
        refundedCents: true,
        code: true,
        createdAt: true,
      },
    }),
    prisma.smsWalletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        type: true,
        amountCents: true,
        description: true,
        balanceAfterCents: true,
        createdAt: true,
      },
    }),
    prisma.smsActivation.aggregate({
      where: { userId },
      _count: true,
      _sum: { priceCents: true, refundedCents: true },
    }),
    prisma.smsActivation.count({ where: { userId, code: { not: null } } }),
    getSmsStock(),
  ]);

  const smsEnabled = sms24hService.isConfigured();
  const abertas = activations.filter((item) => OPEN_STATUSES.includes(item.status));
  const gastoCents = (totais._sum.priceCents ?? 0) - (totais._sum.refundedCents ?? 0);

  const historico: ActivationListItem[] = activations.map((item) => ({
    id: item.id,
    service: item.service,
    status: item.status,
    phoneDisplay: item.phone ? formatSmsPhone(item.phone).display : null,
    priceCents: item.priceCents,
    refundedCents: item.refundedCents,
    hasCode: item.code !== null,
    createdAtLabel: DATA_HORA.format(item.createdAt),
  }));

  const minutos = Math.round(SMS_ACTIVATION_TTL_MS / 60_000);

  return (
    <>
      <PageHeader
        eyebrow="SMS"
        title="Números para SMS"
        description={`Alugue um número brasileiro, receba o código de verificação aqui e libere o cadastro. Pago com tokens de SMS (1 token = R$ 1), que você obtém convertendo tokens de site. Se o SMS não chegar em ${minutos} minutos, os tokens voltam.`}
      >
        <Link href="#converter" className="btn-primary">
          Converter tokens
        </Link>
      </PageHeader>

      <Reveal className="mt-10">
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="card relative overflow-hidden lg:col-span-2">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl"
            />
            <p className="text-xs uppercase tracking-widest text-dark-500">Tokens de SMS</p>
            <p className="text-gradient mt-3 text-5xl font-semibold tabular-nums">
              {formatSmsTokens(user.smsBalanceCents)}
            </p>
            <p className="mt-3 text-sm text-dark-400 tabular-nums">
              {user.smsBalanceCents === 0
                ? `Converta tokens de site para pedir o primeiro número: cada um vira ${SMS_TOKENS_PER_SITE_TOKEN} tokens de SMS.`
                : `Paga ${affordable(user.smsBalanceCents, 'WHATSAPP').toLocaleString('pt-BR')} número(s) de WhatsApp ou ${affordable(user.smsBalanceCents, 'INSTAGRAM').toLocaleString('pt-BR')} de Instagram.`}
            </p>
            <p className="mt-1 text-xs text-dark-500 tabular-nums">
              Você tem {tokenLabel(user.tokenBalance)} de site para converter · 1 token de site ={' '}
              {SMS_TOKENS_PER_SITE_TOKEN} tokens de SMS
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="#converter" className="btn-primary">
                Converter tokens
              </Link>
              <Link href="#servicos" className="btn-secondary">
                Pedir número
              </Link>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
            <Resumo
              label="Números pedidos"
              value={totais._count.toLocaleString('pt-BR')}
              hint={`${abertas.length.toLocaleString('pt-BR')} aguardando agora`}
            />
            <Resumo
              label="Códigos recebidos"
              value={comCodigo.toLocaleString('pt-BR')}
              hint="SMS entregues com sucesso"
            />
            <Resumo
              label="Tokens SMS gastos"
              value={formatSmsTokens(gastoCents)}
              hint="Já descontadas as devoluções"
            />
          </div>
        </div>
      </Reveal>

      {!smsEnabled && (
        <div className="card mt-8">
          <span className="badge badge-warning">Números indisponíveis</span>
          <p className="mt-3 text-sm text-dark-300">
            O provedor de números não está configurado, então não é possível pedir um
            número agora. Tente novamente mais tarde ou fale com o suporte.
          </p>
        </div>
      )}

      {abertas.length > 0 && (
        <div className="card mt-8">
          <span className="badge badge-warning">
            {abertas.length === 1
              ? 'Um número aguardando SMS'
              : `${abertas.length} números aguardando SMS`}
          </span>
          <ul className="mt-4 flex flex-wrap gap-3">
            {abertas.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/dashboard/sms/${item.id}`}
                  className="btn-secondary text-sm tabular-nums"
                >
                  {SMS_SERVICES[item.service].label}
                  {item.phone && ` · ${formatSmsPhone(item.phone).display}`}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section id="servicos" className="mt-16 scroll-mt-24">
        <h2 className="text-xl font-semibold tracking-tight">Escolha o serviço</h2>
        <p className="mt-1 text-sm text-dark-500">
          Os tokens de SMS são debitados ao pedir o número e devolvidos se nenhum SMS chegar.
        </p>
        <ServicePicker
          balanceCents={user.smsBalanceCents}
          stock={stock}
          enabled={smsEnabled}
        />
      </section>

      <section id="converter" className="mt-16 scroll-mt-24">
        <h2 className="text-xl font-semibold tracking-tight">Converter tokens de site</h2>
        <p className="mt-1 text-sm text-dark-500">
          Cada token de site vira {SMS_TOKENS_PER_SITE_TOKEN} tokens de SMS. É o único jeito de
          obter tokens de SMS — eles não são vendidos à parte.
        </p>

        <TokenConverter
          tokenBalance={user.tokenBalance}
          smsBalanceCents={user.smsBalanceCents}
          enabled={smsEnabled}
        />
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Números pedidos</h2>
            <p className="mt-1 text-sm text-dark-500">
              {historico.length === 0
                ? 'Nenhum número pedido até agora'
                : `Últimos ${historico.length.toLocaleString('pt-BR')} pedidos`}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {historico.length > 0 ? (
            <Reveal stagger="[data-ativacao]">
              <ActivationList items={historico} />
            </Reveal>
          ) : (
            <EmptyState
              title="Seu primeiro número está a um clique"
              description="Escolha o serviço, peça o número e digite-o no app. O código de verificação aparece aqui em segundos."
              action={
                <Link href="#servicos" className="btn-primary">
                  Escolher serviço
                </Link>
              }
            />
          )}
        </div>
      </section>

      {movimentos.length > 0 && (
        <section className="mt-16">
          <h2 className="text-xl font-semibold tracking-tight">Movimentações dos tokens de SMS</h2>
          <p className="mt-1 text-sm text-dark-500">Conversões, números e devoluções</p>

          <ul className="mt-6 rounded-2xl border border-dark-700 bg-white/[0.02] px-5 sm:px-6">
            {movimentos.map((mov) => {
              const credit = isSmsCreditType(mov.type);

              return (
                <li
                  key={mov.id}
                  className="flex flex-wrap items-center gap-4 border-b border-white/5 py-4 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{mov.description}</p>
                    <p className="mt-1 text-xs text-dark-500 tabular-nums">
                      {WALLET_TYPE_LABEL[mov.type]} · {DATA_HORA.format(mov.createdAt)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        credit ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {credit ? '+' : '−'}
                      {formatSmsTokens(mov.amountCents)}
                    </p>
                    <p className="mt-1 text-xs text-dark-500 tabular-nums">
                      saldo {smsTokenLabel(mov.balanceAfterCents)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
