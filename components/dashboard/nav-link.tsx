'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Acento visual do shell: âmbar no painel do usuário, ouro na área administrativa. */
export type NavAccent = 'amber' | 'gold';

/**
 * Traços dos ícones do shell, no mesmo estilo de linha da landing
 * (viewBox 24, stroke 1.5). Ficam aqui para que sidebar, topbar e menu do
 * usuário compartilhem o mesmo desenho sem duplicar path.
 */
export const ICONS = {
  grid: 'M4 5.5A1.5 1.5 0 015.5 4h3A1.5 1.5 0 0110 5.5v3A1.5 1.5 0 018.5 10h-3A1.5 1.5 0 014 8.5v-3zM14 5.5A1.5 1.5 0 0115.5 4h3A1.5 1.5 0 0120 5.5v3A1.5 1.5 0 0118.5 10h-3A1.5 1.5 0 0114 8.5v-3zM4 15.5A1.5 1.5 0 015.5 14h3a1.5 1.5 0 011.5 1.5v3A1.5 1.5 0 018.5 20h-3A1.5 1.5 0 014 18.5v-3zM14 15.5A1.5 1.5 0 0115.5 14h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5v-3z',
  coins:
    'M4 7c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 3-8-1.34-8-3zM4 7v5c0 1.66 3.58 3 8 3s8-1.34 8-3V7M4 12v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5',
  users:
    'M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M10 10.5a3.25 3.25 0 100-6.5 3.25 3.25 0 000 6.5zM20 19v-1.5a3.5 3.5 0 00-2.63-3.39M15.5 4.21a3.25 3.25 0 010 6.29',
  pulse: 'M3 12h3.6l2.4 6 4-13 2.5 7H21',
  globe:
    'M12 21a9 9 0 100-18 9 9 0 000 18zM3.5 9h17M3.5 15h17M12 3.2c2.3 2.5 3.4 5.4 3.4 8.8s-1.1 6.3-3.4 8.8c-2.3-2.5-3.4-5.4-3.4-8.8s1.1-6.3 3.4-8.8z',
  card: 'M3 8.5A2.5 2.5 0 015.5 6h13A2.5 2.5 0 0121 8.5v7a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 15.5v-7zM3 10.5h18M6.5 14.5h3',
  shield:
    'M12 3.5l7 2.8v4.9c0 4.24-2.98 8.17-7 9.3-4.02-1.13-7-5.06-7-9.3V6.3l7-2.8zM9.2 12.1l1.9 1.9 3.7-3.9',
  back: 'M19 12H5M11 6l-6 6 6 6',
  plus: 'M12 5.5v13M5.5 12h13',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  logout:
    'M15 12H4m0 0l3.5-3.5M4 12l3.5 3.5M13 4h4.5A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5H13',
  user: 'M12 12.5a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0',
} as const;

export function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('h-5 w-5', className)}
    >
      <path d={path} />
    </svg>
  );
}

type Props = {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Ativo só na rota idêntica — obrigatório em raízes como /dashboard e /admin. */
  exact?: boolean;
  /** Modo trilho: esconde o rótulo e centraliza o ícone. */
  collapsed?: boolean;
  accent?: NavAccent;
  /** Fecha o drawer no mobile após navegar. */
  onNavigate?: () => void;
};

const ACTIVE_LABEL: Record<NavAccent, string> = {
  amber: 'text-amber-200',
  gold: 'text-gold-300',
};

const ACTIVE_ICON: Record<NavAccent, string> = {
  amber: 'text-amber-400',
  gold: 'text-gold-500',
};

export function NavLink({
  href,
  label,
  icon,
  exact = false,
  collapsed = false,
  accent = 'amber',
  onNavigate,
}: Props) {
  const pathname = usePathname();

  // `startsWith(href)` puro marcaria /dashboard-x como filho de /dashboard.
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-nav-item
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative z-10 flex h-11 items-center rounded-xl text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-amber-500/40',
        collapsed ? 'w-11 justify-center' : 'gap-3 px-3',
        active ? ACTIVE_LABEL[accent] : 'text-dark-300 hover:text-white',
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center transition-colors duration-200',
          active ? ACTIVE_ICON[accent] : 'text-dark-500 group-hover:text-dark-200',
        )}
      >
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
