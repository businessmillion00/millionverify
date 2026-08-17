'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import gsap from 'gsap';
import { cn } from '@/lib/utils';
import { SplitChars } from '@/lib/split-text';

type Props = {
  /** Rótulo curto acima do título — ex.: 'Painel', 'Administração'. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Ações à direita (links/botões). */
  children?: React.ReactNode;
};

export function PageHeader({ eyebrow, title, description, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // O acento acompanha a área: ouro na administração, âmbar no painel.
  const isAdminArea = pathname.startsWith('/admin');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = gsap.context(() => {
      const select = gsap.utils.selector(root);
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });

      // Sem ScrollTrigger: o cabeçalho está sempre acima da dobra.
      // Cada trecho só entra na timeline se existir, para não disparar o aviso
      // de alvo inexistente do GSAP quando a página omite eyebrow/descrição.
      const step = (selector: string, vars: gsap.TweenVars, at?: string) => {
        const targets = select(selector);
        if (targets.length > 0) timeline.from(targets, vars, at);
      };

      step('[data-ph-eyebrow]', { y: 10, opacity: 0, duration: 0.5 });
      step(
        '[data-ph-char]',
        { yPercent: 110, duration: 0.8, stagger: 0.018 },
        '-=0.3',
      );
      step('[data-ph-desc]', { y: 16, opacity: 0, duration: 0.6 }, '-=0.45');
      step('[data-ph-actions]', { y: 16, opacity: 0, duration: 0.6 }, '<');
      step('[data-ph-rule]', { scaleX: 0, duration: 0.9 }, '-=0.5');
    }, root);

    return () => ctx.revert();
  }, [title, eyebrow, description]);

  return (
    <div ref={root} className="relative">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p
              data-ph-eyebrow
              className={cn(
                'text-xs uppercase tracking-[0.35em]',
                isAdminArea ? 'text-gold-500/80' : 'text-amber-500/70',
              )}
            >
              {eyebrow}
            </p>
          )}

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            <SplitChars text={title} charAttr="data-ph-char" />
          </h1>

          {description && (
            <p
              data-ph-desc
              className="mt-3 max-w-2xl text-sm leading-relaxed text-dark-400"
            >
              {description}
            </p>
          )}
        </div>

        {children && (
          <div data-ph-actions className="flex flex-wrap items-center gap-3">
            {children}
          </div>
        )}
      </div>

      <div
        data-ph-rule
        aria-hidden
        className={cn(
          'mt-8 h-px w-full origin-left bg-gradient-to-r via-white/5 to-transparent',
          isAdminArea ? 'from-gold-500/50' : 'from-amber-500/50',
        )}
      />
    </div>
  );
}
