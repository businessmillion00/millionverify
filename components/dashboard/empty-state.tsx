import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  description: string;
  /** Ação principal — normalmente um <Link className="btn-primary">. */
  action?: ReactNode;
  /** Sobrescreve o traço padrão. Use um <svg> de 24×24 com stroke="currentColor". */
  icon?: ReactNode;
  className?: string;
};

/** Traço padrão: uma janela vazia, no mesmo estilo de linha da landing. */
const DEFAULT_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className="h-7 w-7"
  >
    <path d="M4 7.5A2.5 2.5 0 016.5 5h11A2.5 2.5 0 0120 7.5v9a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 16.5v-9z" />
    <path d="M4 9.5h16M7 7.25h.01M9.5 7.25h.01" />
    <path d="M9 15.2l2.2-2.6 1.7 1.9 1.3-1.4 1.8 2.1" />
  </svg>
);

/**
 * Estado vazio ilustrado. É o caminho padrão de uma conta nova — sem sites,
 * sem movimentações, sem cobranças —, então carrega o convite, não só o aviso.
 */
export function EmptyState({ title, description, action, icon, className }: Props) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-dashed border-dark-700 bg-white/[0.02] px-6 py-14 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[420px] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[100px]"
      />

      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-amber-subtle text-amber-400 ring-1 ring-inset ring-amber-500/20">
          {icon ?? DEFAULT_ICON}
        </span>

        <h3 className="mt-6 text-lg font-medium text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-dark-400">{description}</p>

        {action && <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div>}
      </div>
    </div>
  );
}
