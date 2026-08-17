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

      gsap.from(targets, {
        y: 40,
        opacity: 0,
        duration: 0.9,
        delay,
        stagger: stagger ? 0.09 : 0,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: root.current,
          start: 'top 82%',
          once: true,
        },
      });
    }, root);

    return () => ctx.revert();
  }, [stagger, delay]);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
