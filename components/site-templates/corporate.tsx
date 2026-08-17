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
  toneSkin,
  type SiteStyle,
  type SiteViewModel,
} from './sections';
import type { SiteTemplateProps } from './types';

/**
 * Corporativo: grade larga, tipografia semibold e faixas alternando superfície.
 * É o template que mais se parece com o site de uma empresa tradicional.
 */
const UI: SiteStyle = {
  container: 'mx-auto w-full max-w-6xl px-6 sm:px-8',
  band: 'py-16 sm:py-20',
  eyebrow: 'text-[0.7rem] font-semibold uppercase tracking-[0.3em]',
  display: 'text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl',
  heading: 'text-2xl font-semibold tracking-tight sm:text-3xl',
  cardTitle: 'text-base font-semibold tracking-tight',
  lead: 'text-lg leading-relaxed',
  body: 'text-sm leading-relaxed sm:text-base',
  term: 'text-xs uppercase tracking-[0.2em]',
  card: 'rounded-xl border p-6',
  cardSurface: true,
  control: 'rounded-lg px-5 py-2.5 text-sm font-medium',
  registryRows: false,
};

/**
 * Resumo cadastral ao lado do hero. Repete de propósito as primeiras linhas da
 * ficha completa: quem abre a página para conferir a empresa vê o CNPJ sem
 * precisar rolar, e quem quer o resto tem a seção "Dados da empresa" inteira.
 */
function HeroSummary({ vm }: { vm: SiteViewModel }) {
  const skin = toneSkin(vm.palette, 'plain');
  const items = vm.registry.slice(0, 4);

  return (
    <div
      style={{
        backgroundColor: vm.palette.surface,
        borderColor: vm.palette.hairline,
      }}
      className="rounded-xl border p-6 sm:p-8"
    >
      <p style={{ color: skin.inkSubtle }} className={UI.eyebrow}>
        Ficha cadastral
      </p>

      <dl className="mt-6 space-y-5">
        {items.map((item) => (
          <div
            key={item.label}
            style={{ borderColor: vm.palette.hairline }}
            className="border-b pb-5 last:border-b-0 last:pb-0"
          >
            <dt style={{ color: skin.inkSubtle }} className={UI.term}>
              {item.label}
            </dt>
            <dd className="mt-2 break-words text-sm">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CorporateTemplate(props: SiteTemplateProps) {
  const vm = buildSiteViewModel(props);

  return (
    <div
      style={{ backgroundColor: vm.palette.bg, color: vm.palette.ink }}
      className="flex min-h-screen flex-col"
    >
      <SiteNav vm={vm} ui={UI} tone="plain" />

      <main className="flex-1">
        <SiteHero vm={vm} ui={UI} tone="plain" aside={<HeroSummary vm={vm} />} />
        <SiteStats vm={vm} ui={UI} tone="surface" bordered />
        <SiteValues vm={vm} ui={UI} tone="plain" />
        <SiteAbout vm={vm} ui={UI} tone="surface" bordered />
        <SiteServices vm={vm} ui={UI} tone="plain" />
        <SiteRegistry vm={vm} ui={UI} tone="surface" bordered />
        <SiteContact vm={vm} ui={UI} tone="plain" />
      </main>

      <SiteFooter vm={vm} ui={UI} tone="surface" bordered />
    </div>
  );
}
