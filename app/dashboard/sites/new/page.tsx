import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  MAX_SITES_PER_USER,
  SITE_LIFETIME_DAYS,
  TOKENS_PER_SITE,
  tokenLabel,
} from '@/lib/constants';
import { activeSiteWhere } from '@/lib/site/lifetime';
import { Wizard } from '@/components/site-builder/wizard';

export const dynamic = 'force-dynamic';

export default async function NewSitePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login?callbackUrl=/dashboard/sites/new');
  }

  const userId = session.user.id;

  const [user, sitesCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenBalance: true },
    }),
    prisma.site.count({ where: { userId, ...activeSiteWhere() } }),
  ]);

  const reachedLimit = sitesCount >= MAX_SITES_PER_USER;
  const hasBalance = user.tokenBalance >= TOKENS_PER_SITE;

  return (
    <>
      <Link href="/dashboard/sites" className="text-sm text-dark-400 hover:text-amber-400">
        ← Meus sites
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Criar site</h1>
          <p className="mt-1 text-sm text-dark-400">
            Três passos: CNPJ, identidade e revisão. A publicação custa{' '}
            <span className="text-gradient font-medium tabular-nums">
              {tokenLabel(TOKENS_PER_SITE)}
            </span>{' '}
            e o site fica no ar por {SITE_LIFETIME_DAYS} dias.
          </p>
        </div>

        <p className="text-sm text-dark-400">
          Saldo:{' '}
          <span className="font-medium tabular-nums text-white">
            {user.tokenBalance.toLocaleString('pt-BR')} tokens
          </span>
          <span className="mx-2 text-dark-700">·</span>
          <span className="tabular-nums">
            {sitesCount}/{MAX_SITES_PER_USER} sites
          </span>
        </p>
      </div>

      {reachedLimit ? (
        <div className="card mt-10 max-w-2xl">
          <span className="badge badge-warning">Limite atingido</span>
          <h2 className="mt-4 text-xl font-semibold">
            Você já tem {MAX_SITES_PER_USER} sites no ar
          </h2>
          <p className="mt-2 text-sm text-dark-400">
            Cada conta mantém até {MAX_SITES_PER_USER} sites ao mesmo tempo, e cada
            site fica no ar por {SITE_LIFETIME_DAYS} dias. Os mais antigos liberam
            espaço sozinhos ao expirar — ou exclua um site agora para criar outro.
          </p>
          <Link href="/dashboard/sites" className="btn-primary mt-6 inline-flex">
            Gerenciar meus sites
          </Link>
        </div>
      ) : !hasBalance ? (
        <div className="card mt-10 max-w-2xl">
          <span className="badge badge-error">Saldo insuficiente</span>
          <h2 className="mt-4 text-xl font-semibold">
            Faltam tokens para publicar um site
          </h2>
          <p className="mt-2 text-sm text-dark-400">
            Cada site custa {tokenLabel(TOKENS_PER_SITE)} e o seu saldo é de{' '}
            <span className="tabular-nums">
              {user.tokenBalance.toLocaleString('pt-BR')}
            </span>
            . Compre um pacote de tokens para continuar.
          </p>
          <Link href="/dashboard" className="btn-primary mt-6 inline-flex">
            Comprar tokens
          </Link>
        </div>
      ) : (
        <Wizard
          tokenBalance={user.tokenBalance}
          sitesCount={sitesCount}
          maxSites={MAX_SITES_PER_USER}
          tokensPerSite={TOKENS_PER_SITE}
        />
      )}
    </>
  );
}
