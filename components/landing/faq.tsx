'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Reveal } from '@/components/ui/reveal';

const ITEMS = [
  {
    q: 'Por que preciso de um site para verificar minha BM?',
    a: 'O Meta exige provar a posse de um domínio antes de liberar recursos da Business Manager. A prova é uma meta tag específica no <head> de uma página do domínio. Sem site, não há onde colocar a tag.',
  },
  {
    q: 'A meta tag realmente aparece para o crawler?',
    a: 'Sim. O site é renderizado no servidor, então a tag já vem no HTML da primeira resposta — não depende de JavaScript executar. É exatamente o que o crawler do Meta lê.',
  },
  {
    q: 'O que acontece se a tag sair do ar?',
    a: 'Um job periódico busca cada site publicado e confere se a tag continua presente. Se sumir, o status muda no seu painel antes de a verificação cair do lado do Meta.',
  },
  {
    q: 'Como funcionam os tokens?',
    a: 'Cada site publicado consome 10 tokens. Você compra pacotes via PIX e o crédito entra automaticamente quando o pagamento é confirmado. No cadastro você já ganha 100 tokens.',
  },
  {
    q: 'Posso usar meu próprio domínio?',
    a: 'Sim. Todo site nasce num subdomínio nosso e pode apontar para um domínio próprio depois, mantendo a mesma meta tag.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="container-safe py-32">
      <Reveal>
        <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">
          Dúvidas
        </p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Antes de <span className="text-gradient">começar</span>
        </h2>
      </Reveal>

      <Reveal stagger="[data-faq]" className="mx-auto mt-14 max-w-3xl">
        <div className="divide-y divide-dark-800 border-y border-dark-800">
          {ITEMS.map((item, i) => (
            <div key={item.q} data-faq>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className="flex w-full items-center justify-between gap-6 py-6 text-left transition-colors hover:text-amber-400"
              >
                <span className="text-lg font-medium">{item.q}</span>
                <motion.span
                  animate={{ rotate: open === i ? 45 : 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="shrink-0 text-2xl font-light text-amber-500"
                >
                  +
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="pb-6 pr-12 leading-relaxed text-dark-400">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
