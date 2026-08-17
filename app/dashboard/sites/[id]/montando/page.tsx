import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE } from '@/lib/constants';
import { PageHeader } from '@/components/dashboard/page-header';
import { BuildProgress } from '@/components/site-builder/build-progress';
import { describeBuild, isBuildPending } from '@/lib/site/provision';

export const dynamic = 'force-dynamic';

/**
 * Destino ao terminar o build. Uma constante só, usada pelo redirect do
 * servidor e pelo do cliente — os dois não podem divergir.
 */
const verificationHref = (siteId: string): string => `/dashboard/sites/${siteId}/verificacao`;

type Props = { params: Promise<{ id: string }> };

export default async function MontandoPage({ params }: Props) {
  const session = await auth();

  // O layout já protege /dashboard; aqui a checagem também estreita o tipo.
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;

  // Busca amarrada ao dono: id de outro usuário responde 404, indistinguível
  // de "não existe", para não permitir enumeração.
  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
    select: {
      id: true,
      name: true,
      subdomain: true,
      customDomain: true,
      buildStatus: true,
      buildStartedAt: true,
      buildCompletedAt: true,
      buildError: true,
      content: true,
    },
  });

  if (!site) notFound();

  // Site já montado não pisca a tela de progresso: vai direto para a verificação.
  if (!isBuildPending(site) && site.buildStatus !== 'FAILED') {
    redirect(verificationHref(site.id));
  }

  const view = describeBuild(site);

  // Só disparamos o provisionamento quando ninguém o assumiu ainda. Um site em
  // BUILDING seria no-op no servidor e só gastaria cota do rate limit.
  const autoStart =
    site.buildStatus === 'QUEUED' ||
    (site.buildStatus === 'READY' && site.buildStartedAt === null);

  return (
    <>
      <PageHeader
        eyebrow="Provisionamento"
        title="Montando."
        description={`${site.name} está sendo gerado a partir do CNPJ e publicado em ${view.host}. Assim que terminar, você vai para a verificação da Meta.`}
      >
        <Link href="/dashboard/sites" className="btn-ghost">
          Voltar para os sites
        </Link>
      </PageHeader>

      <BuildProgress
        siteId={site.id}
        siteName={site.name}
        readyHref={verificationHref(site.id)}
        tokensPerSite={TOKENS_PER_SITE}
        initial={view}
        autoStart={autoStart}
      />
    </>
  );
}
