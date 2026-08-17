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
import { withAlpha, type SiteTemplateProps } from './types';

/**
 * Impacto: tipografia display em caixa alta, faixas largas e o contato pintado
 * inteiro com a cor de destaque. É o oposto visual do minimalista.
 */
const UI: SiteStyle = {
  container: 'mx-auto w-full max-w-7xl px-6 sm:px-10',
  band: 'py-20 sm:py-28',
  eyebrow: 'text-[0.7rem] font-bold uppercase tracking-[0.4em]',
  display:
    'text-5xl font-black uppercase leading-[0.92] tracking-tighter sm:text-7xl lg:text-8xl',
  heading:
    'text-3xl font-black uppercase leading-[0.95] tracking-tighter sm:text-5xl',
  cardTitle: 'text-lg font-bold uppercase tracking-tight',
  lead: 'text-xl font-light leading-relaxed sm:text-2xl',
  body: 'text-sm leading-relaxed sm:text-base',
  term: 'text-[0.7rem] uppercase tracking-[0.25em]',
  // Sem raio: a moldura reta é o que dá o peso editorial deste template.
  card: 'border p-8',
  cardSurface: true,
  control: 'px-6 py-3 text-xs font-bold uppercase tracking-[0.2em]',
  // Linhas largas em vez de grade: a ficha vira uma tabela de leitura contínua.
  registryRows: true,
};

export function BoldTemplate(props: SiteTemplateProps) {
  const vm = buildSiteViewModel(props);

  // Gradiente derivado do acento do tenant — nunca de uma cor fixa, senão o
  // site sai com a paleta da plataforma em vez da paleta do cliente.
  const heroGlow = `radial-gradient(110% 70% at 8% 0%, ${withAlpha(
    vm.palette.accent,
    0.3
  )} 0%, transparent 62%), linear-gradient(200deg, ${withAlpha(
    vm.palette.accent,
    0.14
  )} 0%, transparent 55%)`;

  return (
    <div
      style={{ backgroundColor: vm.palette.bg, color: vm.palette.ink }}
      className="flex min-h-screen flex-col"
    >
      <SiteNav vm={vm} ui={UI} tone="plain" />

      <main className="flex-1">
        <SiteHero vm={vm} ui={UI} tone="plain" backgroundImage={heroGlow} />
        <SiteStats vm={vm} ui={UI} tone="plain" bordered />
        <SiteValues vm={vm} ui={UI} tone="plain" />
        <SiteAbout vm={vm} ui={UI} tone="surface" bordered />
        <SiteServices vm={vm} ui={UI} tone="plain" />
        <SiteRegistry vm={vm} ui={UI} tone="surface" bordered />
        <SiteContact vm={vm} ui={UI} tone="accent" />
      </main>

      <SiteFooter vm={vm} ui={UI} tone="plain" bordered />
    </div>
  );
}
