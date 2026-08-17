import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Sidebar, SidebarProvider } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Master Control · Business Million',
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) redirect('/login');
  // Defesa em profundidade: o middleware já barra, mas o layout não pode
  // depender só dele para renderizar dados administrativos.
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, email: true, role: true, tokenBalance: true },
  });

  return (
    <SidebarProvider>
      <div className="relative min-h-screen">
        {/* Assinatura da área administrativa: fio de ouro no topo e halo ouro
            no lugar do âmbar do painel do usuário. */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px bg-gradient-to-r from-transparent via-gold-500/70 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none fixed -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-gold-600/10 blur-[140px]"
        />

        <Sidebar variant="admin" role={user.role} />

        <div className="relative transition-[padding] duration-300 ease-out lg:pl-[var(--bm-sidebar,16rem)]">
          <Topbar
            user={{
              name: user.name,
              email: user.email,
              role: user.role,
              tokenBalance: user.tokenBalance,
            }}
          />

          {/* Ver comentário em app/dashboard/layout.tsx: trava de transição
              para páginas que ainda tragam o próprio <main>. */}
          <main className="container-safe py-10 [&>main]:px-0 [&>main]:py-0 lg:py-14">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
