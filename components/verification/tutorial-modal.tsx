'use client';

import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { CopyField } from '@/components/verification/copy-field';
import {
  applyTutorialVars,
  tutorialChunks,
  type TutorialCopySlot,
  type TutorialStep,
  type TutorialVars,
} from '@/components/verification/tutorial-steps';

/**
 * Modal de tutorial guiado — a tela que precisa evitar o chamado de suporte.
 *
 * É GENÉRICO de propósito: recebe título, subtítulo, roteiro (`steps`) e o mapa de
 * substituição (`vars`). Ele não sabe se está ensinando a colar a meta tag no
 * Business Manager ou a emitir o comprovante do CNPJ na Receita — e é justamente
 * isso que evita duplicar foco preso, navegação por teclado e barra de progresso a
 * cada tutorial novo.
 *
 * Decisões que não são estilo, são requisito:
 *
 * • Framer Motion, nunca <Reveal>. O conteúdo nasce desmontado e o `gsap.from`
 *   com ScrollTrigger do Reveal não dispararia: os passos ficariam em opacity 0.
 * • Portal para o <body>. O gatilho costuma ficar dentro do <PageHeader>, e o GSAP
 *   do PageHeader deixa um `transform` inline no contêiner das ações. Qualquer
 *   transform em um ancestral cria bloco de contenção e faz `position: fixed` se
 *   comportar como `absolute` — o modal sairia ancorado num botão de 3cm.
 * • Dois <AnimatePresence>, um para o fundo e outro para o painel: no Framer 10 o
 *   AnimatePresence só rastreia filhos DIRETOS com key, e Fragment não é rastreável.
 * • O estado (passo atual e concluídos) sobrevive ao fechar. O fluxo real é fechar
 *   o tutorial no passo 5 para colar a tag no painel e reabrir para terminar;
 *   voltar para o passo 1 nessa hora seria hostil.
 */

type TutorialModalProps = {
  open: boolean;
  onClose: () => void;
  /** Título do diálogo — vira também o rótulo acessível. */
  title: string;
  /** Linha de apoio abaixo do título — vira a descrição acessível. */
  subtitle: string;
  /** Roteiro a exibir. O modal não conhece nenhum em particular. */
  steps: readonly TutorialStep[];
  /** Valores que substituem os marcadores (`{host}`, `{cnpj}`…) dos textos. */
  vars: TutorialVars;
  /** Elemento que recebe o foco de volta ao fechar — normalmente o próprio gatilho. */
  returnFocusRef?: React.RefObject<HTMLElement>;
};

/** Ordem de tabulação do painel: tudo que pode receber foco fica preso aqui dentro. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Deslocamento horizontal da troca de passo. Zerado sob prefers-reduced-motion. */
const SLIDE_PX = 28;

/**
 * Setas ← → navegam o tutorial, mas dentro de um campo de texto elas movem o
 * cursor — sequestrar isso quebraria a seleção manual do valor copiável.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * O `href` do passo passa pelo mesmo motor de substituição do texto (é assim que o
 * CNPJ entra na URL do emissor da Receita). Como o valor final é montado em runtime,
 * o esquema é conferido antes de virar atributo: só http(s) chega ao DOM.
 */
function safeExternalHref(href: string): string | null {
  return /^https?:\/\//i.test(href.trim()) ? href.trim() : null;
}

export function TutorialModal({
  open,
  onClose,
  title,
  subtitle,
  steps,
  vars,
  returnFocusRef,
}: TutorialModalProps) {
  const reduced = useReducedMotion() ?? false;
  const titleId = useId();
  const descriptionId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Quem tinha o foco quando o modal abriu — plano B do returnFocusRef. */
  const openerRef = useRef<HTMLElement | null>(null);

  const [mounted, setMounted] = useState(false);
  const [rawIndex, setRawIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  /**
   * Concluídos por ID, não por posição: um roteiro trocado em tempo de execução
   * (ou com um passo a mais numa versão futura) não faz a marcação escorregar para
   * o passo errado, e o índice fora de faixa deixa de ser possível.
   */
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set<string>());

  const stepCount = steps.length;
  // Índice sempre dentro da faixa do roteiro ATUAL: o estado sobrevive ao fechar e
  // pode acordar apontando além do fim se o roteiro encolher.
  const index = stepCount === 0 ? 0 : Math.min(rawIndex, stepCount - 1);
  const step: TutorialStep | undefined = steps[index];
  const isFirst = index === 0;
  const isLast = index === stepCount - 1;

  // O portal só existe no cliente. Sem esse gate, o render de SSR do componente
  // tocaria em `document` e a hidratação divergiria.
  useEffect(() => setMounted(true), []);

  const markDone = useCallback((id: string) => {
    setDone((current) => {
      if (current.has(id)) return current;
      // Cópia nova: o updater do setState precisa ser puro (o StrictMode do React 18
      // o executa duas vezes) e mutar o Set anterior vazaria para o render passado.
      return new Set(current).add(id);
    });
  }, []);

  // Os três navegadores leem `index` do fechamento em vez de usar updater
  // funcional: a direção da animação e a marcação de concluído são efeitos
  // colaterais, e updater de setState precisa ser puro.
  const goTo = useCallback(
    (target: number) => {
      const clamped = Math.min(stepCount - 1, Math.max(0, target));
      if (clamped === index) return;
      setDirection(clamped > index ? 1 : -1);
      setRawIndex(clamped);
    },
    [index, stepCount],
  );

  const goNext = useCallback(() => {
    if (index >= stepCount - 1) return;
    setDirection(1);
    // Concluído = "você passou por aqui indo para frente". Pular pela trilha
    // lateral não marca nada: seria mentir sobre o que o cliente leu.
    if (step) markDone(step.id);
    setRawIndex(index + 1);
  }, [index, markDone, step, stepCount]);

  const goPrevious = useCallback(() => {
    if (index <= 0) return;
    setDirection(-1);
    setRawIndex(index - 1);
  }, [index]);

  const finish = useCallback(() => {
    if (step) markDone(step.id);
    onClose();
  }, [markDone, onClose, step]);

  /* ── Teclado: Esc fecha, ← → navegam, Tab fica preso no painel ─────────── */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowRight' && !isTextEntry(event.target)) {
        event.preventDefault();
        goNext();
        return;
      }

      if (event.key === 'ArrowLeft' && !isTextEntry(event.target)) {
        event.preventDefault();
        goPrevious();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      // getClientRects() em vez de offsetParent: dentro de um ancestral fixed o
      // offsetParent mente, e um item invisível na ordem de tabulação devolveria
      // o foco para o nada.
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((node) => node.getClientRects().length > 0);

      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = panel.contains(active);

      if (event.shiftKey) {
        if (!inside || active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, goNext, goPrevious]);

  /* ── Foco: entra no painel ao abrir, volta ao gatilho ao fechar ─────────── */
  useEffect(() => {
    if (!open) return;

    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;

    // O painel só existe no DOM depois do commit — este efeito já roda depois dele.
    panelRef.current?.focus();

    return () => {
      const back = returnFocusRef?.current ?? openerRef.current;
      // O gatilho pode ter sido desmontado junto (navegação): só devolve o foco
      // se o elemento ainda estiver no documento, senão o foco iria para o <body>
      // com um scroll fantasma.
      if (back && document.contains(back)) back.focus();
    };
  }, [open, returnFocusRef]);

  /* ── Trava do scroll de fundo ───────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;

    // O Lenis controla a rolagem da janela; mexer no overflow do body é o jeito
    // de parar o fundo sem precisar da instância dele.
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    // Compensa a barra que some, senão a página inteira dá um salto lateral.
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  /* ── Passo novo começa do topo, não no meio do texto anterior ──────────── */
  useEffect(() => {
    if (!open) return;
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [open, index]);

  if (!mounted) return null;
  // Roteiro vazio não tem tela para mostrar — e não pode derrubar a página que
  // montou o gatilho.
  if (!step) return null;

  const slide = reduced ? 0 : SLIDE_PX;

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="tutorial-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            aria-hidden
            className="fixed inset-0 z-[60] bg-dark-950/80 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="tutorial-shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            // Clique no vazio ao redor fecha; clique dentro do painel não sobe até aqui.
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) onClose();
            }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6"
          >
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.98 }}
              transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
              // Superfície explícita em vez de `.glass`: as classes de componente
              // do globals.css são declaradas DEPOIS de `@tailwind utilities`, então
              // o `bg-white/5` e o `rounded-lg` do .glass venceriam qualquer
              // utilitário aplicado aqui. É o mesmo tratamento do drawer da sidebar.
              //
              // max-h-full (e não um calc de vh): como item flex de um contêiner
              // `fixed inset-0` com padding, o 100% já desconta o respiro lateral
              // e o painel nunca vaza em tela baixa.
              className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-dark-900/95 shadow-luxury outline-none backdrop-blur-xl"
            >
              {/* ── Cabeçalho ───────────────────────────────────────────── */}
              <div className="flex items-start justify-between gap-4 border-b border-dark-700 p-5 sm:p-6">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.35em] text-amber-500/70">
                    Passo a passo
                  </p>
                  <h2 id={titleId} className="mt-2 text-lg font-semibold sm:text-xl">
                    {title}
                  </h2>
                  <p id={descriptionId} className="mt-1 text-sm text-dark-400">
                    {subtitle}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar tutorial"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dark-700 text-dark-400 transition-colors hover:border-amber-500/40 hover:bg-white/5 hover:text-amber-400"
                >
                  <CloseIcon />
                </button>
              </div>

              {/* ── Barra de progresso segmentada ───────────────────────── */}
              <div className="border-b border-dark-700 px-5 py-4 sm:px-6">
                <div
                  role="progressbar"
                  aria-valuemin={1}
                  aria-valuemax={stepCount}
                  aria-valuenow={index + 1}
                  aria-valuetext={`Passo ${index + 1} de ${stepCount}: ${step.short}`}
                  className="flex items-center gap-1.5"
                >
                  {steps.map((item, position) => (
                    <span
                      key={item.id}
                      aria-hidden
                      className={cn(
                        'h-1 flex-1 rounded-full transition-colors duration-300',
                        position < index
                          ? 'bg-amber-500/70'
                          : position === index
                            ? 'bg-gradient-amber'
                            : 'bg-dark-700',
                      )}
                    />
                  ))}
                </div>

                <p className="mt-2 text-xs text-dark-500">
                  Passo{' '}
                  <span className="tabular-nums text-dark-300">{index + 1}</span> de{' '}
                  <span className="tabular-nums text-dark-300">{stepCount}</span>
                </p>
              </div>

              {/* ── Corpo: trilha + passo ───────────────────────────────── */}
              {/* As linhas são declaradas: com `auto` implícito, a trilha de
                  conteúdo cresceria pelo texto e estouraria o painel em vez de
                  rolar por dentro. */}
              <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-8">
                <nav aria-label="Progresso do tutorial" className="min-w-0">
                  <ol className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
                    {steps.map((item, position) => {
                      const current = position === index;
                      const concluded = done.has(item.id);

                      return (
                        <li key={item.id} className="shrink-0 md:w-full">
                          <button
                            type="button"
                            onClick={() => goTo(position)}
                            aria-current={current ? 'step' : undefined}
                            aria-label={`Passo ${position + 1}: ${item.short}${
                              concluded ? ' (concluído)' : ''
                            }`}
                            className={cn(
                              'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors md:w-full',
                              current
                                ? 'bg-white/5 text-white'
                                : 'text-dark-400 hover:bg-white/5 hover:text-dark-200',
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums transition-colors',
                                concluded
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                                  : current
                                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                    : 'border-dark-700 text-dark-500',
                              )}
                            >
                              {concluded ? <CheckIcon /> : position + 1}
                            </span>
                            <span className="hidden truncate md:inline">
                              {item.short}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>

                <div
                  ref={contentRef}
                  aria-live="polite"
                  className="min-h-0 min-w-0 overflow-y-auto md:max-h-[22rem]"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: direction * slide }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: direction * -slide }}
                      transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
                    >
                      <h3 className="text-base font-medium text-white sm:text-lg">
                        {step.title}
                      </h3>

                      {step.body.map((paragraph, position) => (
                        <p
                          key={`${step.id}-p${position}`}
                          className="mt-3 text-sm leading-relaxed text-dark-300"
                        >
                          <TutorialText
                            text={paragraph}
                            vars={vars}
                            strongClassName="text-white"
                          />
                        </p>
                      ))}

                      {step.copy && <CopySlot slot={step.copy} vars={vars} />}

                      {step.callout && (
                        <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
                          <p className="text-xs font-medium uppercase tracking-widest text-amber-400">
                            {step.callout.title}
                          </p>
                          <p className="mt-2 text-sm leading-relaxed text-dark-300">
                            <TutorialText
                              text={step.callout.body}
                              vars={vars}
                              strongClassName="text-amber-200"
                            />
                          </p>
                        </div>
                      )}

                      {step.hint && (
                        <p className="mt-4 text-xs leading-relaxed text-dark-500">
                          <TutorialText
                            text={step.hint}
                            vars={vars}
                            strongClassName="text-dark-300"
                          />
                        </p>
                      )}

                      <ExternalButton link={step.external} vars={vars} />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* ── Rodapé ──────────────────────────────────────────────── */}
              <div className="flex items-center justify-between gap-3 border-t border-dark-700 p-5 sm:p-6">
                <p className="hidden text-xs text-dark-500 sm:block">
                  Use <kbd className="text-dark-300">←</kbd>{' '}
                  <kbd className="text-dark-300">→</kbd> para navegar ·{' '}
                  <kbd className="text-dark-300">Esc</kbd> fecha
                </p>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={goPrevious}
                    disabled={isFirst}
                    className="btn-ghost text-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    Anterior
                  </button>

                  <button
                    type="button"
                    onClick={isLast ? finish : goNext}
                    className="btn-primary text-sm"
                  >
                    {isLast ? 'Concluir' : 'Próximo'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

/* ------------------------------------------------------------------ *
 * Pedaços de conteúdo
 * ------------------------------------------------------------------ */

type TutorialTextProps = {
  text: string;
  vars: TutorialVars;
  /** Cor da ênfase — muda conforme o bloco (corpo, callout, dica). */
  strongClassName: string;
};

/** Texto do roteiro com os marcadores resolvidos e a ênfase `**` aplicada. */
function TutorialText({ text, vars, strongClassName }: TutorialTextProps) {
  return (
    <>
      {tutorialChunks(text, vars).map((chunk, position) =>
        chunk.strong ? (
          <strong
            key={`s${position}`}
            className={cn('font-medium', strongClassName)}
          >
            {chunk.text}
          </strong>
        ) : (
          <Fragment key={`t${position}`}>{chunk.text}</Fragment>
        ),
      )}
    </>
  );
}

type CopySlotProps = {
  slot: TutorialCopySlot;
  vars: TutorialVars;
};

/**
 * Campo copiável do passo. O passo diz QUAL chave de `vars` mostrar; se o valor
 * ainda não existe (o cliente não colou a meta tag, por exemplo), entra o texto de
 * `empty` — nunca uma caixa vazia sem explicação.
 */
function CopySlot({ slot, vars }: CopySlotProps) {
  const value = (vars[slot.source] ?? '').trim();

  if (value.length === 0) {
    if (!slot.empty) return null;

    return (
      <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4 text-xs leading-relaxed text-amber-200/85">
        <TutorialText text={slot.empty} vars={vars} strongClassName="text-amber-200" />
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-dark-700 bg-dark-800/40 p-4">
      <CopyField
        label={slot.label}
        value={value}
        hint={slot.hint ? applyTutorialVars(slot.hint, vars) : undefined}
        multiline={slot.multiline ?? false}
      />
    </div>
  );
}

type ExternalButtonProps = {
  link: TutorialStep['external'];
  vars: TutorialVars;
};

/** Botão externo do passo. Sempre nova aba, sempre com o `href` já resolvido. */
function ExternalButton({ link, vars }: ExternalButtonProps) {
  if (!link) return null;

  const href = safeExternalHref(applyTutorialVars(link.href, vars));
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="btn-secondary mt-5 inline-flex items-center gap-2 text-sm"
    >
      {applyTutorialVars(link.label, vars)}
      <ExternalIcon />
    </a>
  );
}

/* ------------------------------------------------------------------ *
 * Ícones
 * ------------------------------------------------------------------ */

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden
      className="h-4 w-4"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3 w-3"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3.5 w-3.5"
    >
      <path d="M14 5h5v5" />
      <path d="M19 5l-7.5 7.5" />
      <path d="M18 14v4.5A1.5 1.5 0 0116.5 20h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" />
    </svg>
  );
}
