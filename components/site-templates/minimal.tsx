import {
  SiteAbout,
  SiteContact,
  SiteFooter,
  SiteHero,
  SiteNav,
  SiteRegistry,
  SiteServices,
  SiteStats,
  SiteValues,
  buildSiteViewModel,
  type SiteStyle,
} from './sections';
import type { SiteTemplateProps } from './types';

/**
 * Minimalista: coluna estreita, tipografia leve e separação só por filete.
 * Nenhuma faixa recebe preenchimento — o ritmo vem do respiro vertical.
 */
const UI: SiteStyle = {
  container: 'mx-auto w-full max-w-4xl px-6 sm:px-8',
  band: 'py-20 sm:py-28',
  eyebrow: 'text-[0.7rem] font-medium uppercase tracking-[0.35em]',
  display: 'text-4xl font-light leading-[1.08] tracking-tight sm:text-6xl',
  heading: 'text-2xl font-light tracking-tight sm:text-3xl',
  cardTitle: 'text-base font-medium tracking-tight',
  lead: 'text-lg font-light leading-relaxed sm:text-xl',
  body: 'text-sm font-light leading-relaxed sm:text-base',
  term: 'text-[0.7rem] uppercase tracking-[0.25em]',
  // Card sem moldura: só o filete superior, como uma nota de rodapé larga.
  card: 'border-t pt-5',
  cardSurface: false,
  control: 'rounded-full px-5 py-2.5 text-sm font-medium',
  registryRows: false,
};

export function MinimalTemplate(props: SiteTemplateProps) {
  const vm = buildSiteViewModel(props);

  return (
    <div
      style={{ backgroundColor: vm.palette.bg, color: vm.palette.ink }}
      className="flex min-h-screen flex-col"
    >
      <SiteNav vm={vm} ui={UI} tone="plain" />

      <main className="flex-1">
        <SiteHero vm={vm} ui={UI} tone="plain" />
        <SiteStats vm={vm} ui={UI} tone="plain" bordered />
        <SiteValues vm={vm} ui={UI} tone="plain" />
        <SiteAbout vm={vm} ui={UI} tone="plain" bordered />
        <SiteServices vm={vm} ui={UI} tone="plain" />
        <SiteRegistry vm={vm} ui={UI} tone="plain" bordered />
        <SiteContact vm={vm} ui={UI} tone="plain" />
      </main>

      <SiteFooter vm={vm} ui={UI} tone="plain" bordered />
    </div>
  );
}
