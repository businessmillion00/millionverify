import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PixCheckout } from '@/components/billing/pix-checkout';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ paymentId: string }> };

/** Fuso fixo: o rótulo é gerado no servidor e não pode depender do TZ da máquina. */
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export default async function PaymentCheckoutPage({ params }: Props) {
  const { paymentId } = await params;
  const session = await auth();

  if (!session?.user?.id) redirect('/login');

  // userId dentro do where: cobrança de outro dono cai no mesmo 404 de
  // cobrança inexistente, sem revelar que o id existe.
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId: session.user.id },
    select: {
      id: true,
      amount: true,
      tokensGranted: true,
      status: true,
      description: true,
      pixQrCode: true,
      pixKey: true,
      pixExpiresAt: true,
    },
  });

  if (!payment) notFound();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Pagamento via PIX
          </h1>
          <p className="mt-1 text-sm text-dark-400">
            Cobrança #{payment.id.slice(0, 8)} ·{' '}
            <span className="tabular-nums">
              {payment.tokensGranted.toLocaleString('pt-BR')} tokens
            </span>
          </p>
        </div>

        <Link href="/dashboard/billing" className="btn-secondary">
          Voltar para compras
        </Link>
      </div>

      <PixCheckout
        paymentId={payment.id}
        pixQrCode={payment.pixQrCode}
        pixCopyPaste={payment.pixKey}
        amount={payment.amount}
        tokens={payment.tokensGranted}
        description={payment.description}
        initialStatus={payment.status}
        expiresAt={payment.pixExpiresAt ? payment.pixExpiresAt.toISOString() : null}
        expiresAtLabel={
          payment.pixExpiresAt ? dateTimeFormatter.format(payment.pixExpiresAt) : null
        }
      />
    </>
  );
}
