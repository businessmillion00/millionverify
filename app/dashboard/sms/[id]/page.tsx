import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { syncActivation } from '@/lib/sms/activation';
import { SMS_SERVICES } from '@/lib/sms/catalog';
import { PageHeader } from '@/components/dashboard/page-header';
import { ActivationPanel } from '@/components/sms/activation-panel';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ativação de SMS · Million Verify',
};

type Props = { params: Promise<{ id: string }> };

export default async function SmsActivationPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id) redirect('/login');

  // userId no where: ativação de outro dono cai no mesmo 404 de ativação
  // inexistente, sem revelar que o id existe. `syncActivation` busca por id,
  // então a posse precisa estar provada antes de chamá-lo.
  const owned = await prisma.smsActivation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });

  if (!owned) notFound();

  // Sincroniza na abertura: quem volta para a página depois de um tempo vê o
  // estado real (código chegou, prazo venceu) sem esperar a primeira volta do
  // polling.
  const view = await syncActivation(owned.id);

  if (!view) notFound();

  return (
    <>
      <Link
        href="/dashboard/sms"
        className="text-xs uppercase tracking-widest text-dark-500 transition-colors hover:text-amber-400"
      >
        ← Números para SMS
      </Link>

      <div className="mt-4">
        <PageHeader
          eyebrow="SMS"
          title={`Número para ${view.serviceLabel}`}
          description={SMS_SERVICES[view.service].hint}
        />
      </div>

      <ActivationPanel initial={view} />
    </>
  );
}
