'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

type Props = {
  children: React.ReactNode;
  /** Seletor dos filhos a animar em cascata. Sem isso, anima o bloco inteiro. */
  stagger?: string;
  delay?: number;
  className?: string;
};

export function Reveal({ children, stagger, delay = 0, className }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      const targets = stagger
        ? gsap.utils.toArray<HTMLElement>(stagger)
        : [root.current!];

      if (targets.length === 0) return;

      /*
       * `fromTo` com immediateRender: false, e não `from`.
       *
       * `from` aplica opacity: 0 na hora e só devolve o conteúdo se o gatilho
       * disparar — falha FECHADA: qualquer medição errada deixa a tela em
       * branco para sempre. Foi o que aconteceu na compra de tokens, onde a
       * sidebar do painel anima o padding e move tudo depois da medição.
       *
       * Assim o conteúdo nasce visível e a animação só o toca quando de fato
       * roda. Se o ScrollTrigger nunca disparar, o usuário vê a página.
       */
      gsap.fromTo(
        targets,
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          delay,
          stagger: stagger ? 0.09 : 0,
          ease: 'power3.out',
          immediateRender: false,
          scrollTrigger: {
            trigger: root.current,
            start: 'top 92%',
            once: true,
          },
        },
      );
    }, root);

    /*
     * A medição inicial acontece antes de o layout assentar (fontes, imagens e
     * a transição de padding da sidebar). Sem este refresh o gatilho guarda uma
     * posição que o scroll nunca cruza.
     */
    const refresh = window.requestAnimationFrame(() => ScrollTrigger.refresh());

    return () => {
      window.cancelAnimationFrame(refresh);
      ctx.revert();
    };
  }, [stagger, delay]);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
