'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { TutorialModal } from '@/components/verification/tutorial-modal';
import {
  TUTORIAL_STEPS,
  TUTORIAL_SUBTITLE,
  TUTORIAL_TITLE,
  tutorialVars,
  type TutorialStep,
  type TutorialVars,
} from '@/components/verification/tutorial-steps';

/**
 * Gatilhos de tutorial guiado.
 *
 * `TutorialLauncher` é o genérico: botão + modal para QUALQUER roteiro. Client
 * component mínimo de propósito — ele pode ser colocado tanto no
 * `<PageHeader>{children}</PageHeader>` da página quanto dentro de um card, então
 * não presume largura, coluna nem contexto: quem posiciona é quem monta, via
 * `className`.
 *
 * `TutorialTrigger` é o do Facebook, escrito sobre o genérico. A assinatura
 * (`host`, `metaTag`, `label`, `variant`, `className`) está preservada: a página de
 * verificação monta `<TutorialTrigger host={host} metaTag={site.metaTag}
 * variant="ghost" />` e essa chamada continua valendo sem nenhuma edição.
 *
 * Nunca `btn-primary`: a ação principal desta tela é "Salvar e verificar". Um
 * tutorial que compete visualmente com o botão que resolve o problema empurra o
 * cliente para o caminho mais longo.
 *
 * O modal fica SEMPRE montado (recebendo `open`), não `{open && <Modal/>}`: é o
 * modal que guarda o passo atual, e desmontá-lo ao fechar jogaria o cliente de
 * volta ao passo 1 toda vez que ele fechasse para colar a tag no painel.
 */

/** Peso visual. Sempre secundário em relação à ação principal da tela. */
type TutorialVariant = 'secondary' | 'ghost';

type TutorialLauncherProps = {
  /** Título do diálogo. */
  title: string;
  /** Linha de apoio abaixo do título. */
  subtitle: string;
  /** Roteiro a exibir. */
  steps: readonly TutorialStep[];
  /** Mapa de substituição dos marcadores dos textos. */
  vars: TutorialVars;
  /** Texto do botão. */
  label: string;
  variant?: TutorialVariant;
  className?: string;
};

export function TutorialLauncher({
  title,
  subtitle,
  steps,
  vars,
  label,
  variant = 'secondary',
  className,
}: TutorialLauncherProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Identidade estável: o modal usa `onClose` como dependência dos listeners de
  // teclado, e uma função nova a cada render remontaria os listeners à toa.
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          variant === 'ghost' ? 'btn-ghost' : 'btn-secondary',
          'inline-flex items-center gap-2 text-sm',
          className,
        )}
      >
        <HelpIcon />
        {label}
      </button>

      <TutorialModal
        open={open}
        onClose={close}
        title={title}
        subtitle={subtitle}
        steps={steps}
        vars={vars}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

type TutorialTriggerProps = {
  /** Endereço público do site. Aceita URL completa — normalizamos com bareDomain. */
  host: string;
  /** Valor de `content` já salvo; null quando ainda não há código. */
  metaTag: string | null;
  /** Texto do botão. */
  label?: string;
  /** Peso visual. Sempre secundário em relação a "Salvar e verificar". */
  variant?: TutorialVariant;
  className?: string;
};

/** Gatilho do tutorial de verificação de domínio no Business Manager. */
export function TutorialTrigger({
  host,
  metaTag,
  label = 'Como colar a tag no Facebook',
  variant = 'secondary',
  className,
}: TutorialTriggerProps) {
  // Identidade estável do mapa: sem o memo, cada render do pai entregaria um objeto
  // novo ao modal e derrubaria a memoização de tudo que depender dele.
  const vars = useMemo(() => tutorialVars(host, metaTag), [host, metaTag]);

  return (
    <TutorialLauncher
      title={TUTORIAL_TITLE}
      subtitle={TUTORIAL_SUBTITLE}
      steps={TUTORIAL_STEPS}
      vars={vars}
      label={label}
      variant={variant}
      className={className}
    />
  );
}

function HelpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.2" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}
