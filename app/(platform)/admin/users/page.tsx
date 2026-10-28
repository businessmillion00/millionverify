import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TOKENS_PER_SITE } from '@/lib/constants';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatTile } from '@/components/admin/stat-tile';
import { UsersTable } from '@/components/admin/user-row';

export const dynamic = 'force-dynamic';

const LIMITE = 100;

export default async function AdminUsersPage() {
  const [session, users] = await Promise.all([
    auth(),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: LIMITE,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tokenBalance: true,
        createdAt: true,
        _count: { select: { sites: true, payments: true } },
      },
    }),
  ]);

  const administradores = users.filter((user) => user.role === 'ADMIN').length;
  const tokensEmCirculacao = users.reduce((soma, user) => soma + user.tokenBalance, 0);

  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Usuários"
        description="Busque, ordene, promova e ajuste o saldo de qualquer conta."
      >
        <Link href="/admin" className="btn-secondary">
          Voltar ao Master Control
        </Link>
      </PageHeader>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Contas"
          value={users.length}
          hint={`As ${LIMITE} mais recentes`}
        />
        <StatTile
          label="Administradores"
          value={administradores}
          hint="Com acesso ao Master Control"
          delay={0.06}
        />
        <StatTile
          label="Tokens em circulação"
          value={tokensEmCirculacao}
          hint={`≈ ${Math.floor(tokensEmCirculacao / TOKENS_PER_SITE).toLocaleString(
            'pt-BR'
          )} sites a publicar`}
          delay={0.12}
        />
      </div>

      <div className="mt-10">
        <UsersTable users={users} currentAdminId={session?.user?.id ?? null} />
      </div>
    </>
  );
}
