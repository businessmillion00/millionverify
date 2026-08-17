import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Sidebar, SidebarProvider } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Painel · Business Million',
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // O middleware já protege /dashboard; aqui a checagem também serve para
  // estreitar o tipo e carregar os dados que o shell exibe.
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, email: true, role: true, tokenBalance: true },
  });

  return (
    <SidebarProvider>
      <div className="relative min-h-screen">
        <div
          aria-hidden
          className="pointer-events-none fixed -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[140px]"
        />

        <Sidebar variant="user" role={user.role} />

        {/* O conteúdo rola no documento (o Lenis controla a janela): nada de
            container com overflow interno, senão o ScrollTrigger dos Reveal
            passa a medir contra a viewport errada. */}
        <div className="relative transition-[padding] duration-300 ease-out lg:pl-[var(--bm-sidebar,16rem)]">
          <Topbar
            user={{
              name: user.name,
              email: user.email,
              role: user.role,
              tokenBalance: user.tokenBalance,
            }}
          />

          {/* [&>main] é uma trava de transição: enquanto alguma página ainda
              trouxer o próprio <main className="container-safe py-16">, o
              espaçamento dela é zerado para não duplicar o do shell. Assim que
              as páginas devolverem só <>…</>, a regra vira inócua. */}
          <main className="container-safe py-10 [&>main]:px-0 [&>main]:py-0 lg:py-14">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
