/**
 * Seções compartilhadas pelos três templates institucionais.
 *
 * Tudo aqui é SERVER COMPONENT puro: sem 'use client', sem estado, sem acesso a
 * banco. O crawler do Meta e o cron de verificação leem o HTML entregue pelo
 * servidor, então nenhuma informação pode depender de JavaScript no cliente.
 *
 * O que muda entre os templates é `SiteStyle` (tipografia, ritmo e forma) e o
 * `SiteTone` de cada faixa (cor). A marcação e o conteúdo são os mesmos — é o
 * que garante que os três sites tenham a mesma completude de informação.
 */
import type { ReactNode } from 'react';
import { siteHost } from '@/lib/subdomain';
import { cn, formatCNPJ, formatCurrency } from '@/lib/utils';
import {
  addressLines,
  buildPalette,
  formatCompanySize,
  formatPhoneHref,
  formatSiteDate,
  formatWebsiteHref,
  formatWebsiteLabel,
  humanizeRegistryText,
  locationLabel,
  resolveDescription,
  withAlpha,
  yearsInBusiness,
  type SitePalette,
  type SitePartner,
  type SiteService,
  type SiteTemplateProps,
  type SiteValue,
} from './types';

/* ============ TOKENS VISUAIS ============ */

/**
 * Conjunto de classes que cada template define uma vez e passa para todas as
 * seções. Só tipografia, ritmo e forma entram aqui — cor nunca, porque cor é do
 * tenant e vai em `style` inline.
 */
export type SiteStyle = {
  /** largura máxima + respiro lateral do conteúdo da faixa */
  container: string;
  /** ritmo vertical da faixa */
  band: string;
  /** rótulo micro acima do título */
  eyebrow: string;
  /** título do hero */
  display: string;
  /** título de seção */
  heading: string;
  /** título de card */
  cardTitle: string;
  /** parágrafo de abertura */
  lead: string;
  /** parágrafo padrão */
  body: string;
  /** rótulo de linha em listas de definição */
  term: string;
  /** forma do card: raio, borda e espaçamento interno */
  card: string;
  /** se o card recebe preenchimento de fundo ou fica só no filete */
  cardSurface: boolean;
  /** forma dos botões */
  control: string;
  /** ficha cadastral em linhas largas (true) ou em grade (false) */
  registryRows: boolean;
};

/** Faixa transparente, faixa com superfície ou faixa pintada com o acento. */
export type SiteTone = 'plain' | 'surface' | 'accent';

export type ToneSkin = {
  bg: string | undefined;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  hairline: string;
  cardBg: string | undefined;
  highlight: string;
  highlightInk: string;
};

/**
 * Numa faixa pintada com o acento, o texto não pode continuar usando a tinta da
 * página — sobre âmbar, branco some. Todas as cores da faixa são derivadas de
 * `accentInk`, que já foi escolhido por luminância em buildPalette.
 */
export function toneSkin(palette: SitePalette, tone: SiteTone): ToneSkin {
  if (tone === 'accent') {
    const ink = palette.accentInk;

    return {
      bg: palette.accent,
      ink,
      inkMuted: withAlpha(ink, 0.82),
      inkSubtle: withAlpha(ink, 0.64),
      hairline: withAlpha(ink, 0.28),
      cardBg: withAlpha(ink, 0.1),
      highlight: ink,
      highlightInk: palette.accent,
    };
  }

  return {
    bg: tone === 'surface' ? palette.surface : undefined,
    ink: palette.ink,
    inkMuted: palette.inkMuted,
    inkSubtle: palette.inkSubtle,
    hairline: palette.hairline,
    cardBg: tone === 'surface' ? palette.surfaceStrong : palette.surface,
    highlight: palette.accent,
    highlightInk: palette.accentInk,
  };
}

/* ============ MODELO DE VISÃO ============ */

export type SiteFact = { label: string; value: string };
export type SiteChannel = {
  label: string;
  value: string;
  href: string;
  external?: boolean;
};
export type SiteNavItem = { href: string; label: string };

export type SiteViewModel = {
  palette: SitePalette;
  year: number;
  host: string;
  legalHref: string;
  brand: { name: string; initials: string };
  companyName: string;
  cnpj: string;
  nav: SiteNavItem[];
  hero: { eyebrow: string; headline: string; lead: string };
  contactHref: string;
  stats: SiteFact[];
  values: { heading: string; items: SiteValue[] };
  about: { heading: string; paragraphs: string[]; facts: SiteFact[] };
  services: { heading: string; items: SiteService[] };
  registry: SiteFact[];
  address: string[];
  partners: SitePartner[];
  channels: SiteChannel[];
  businessHours: string | null;
};

/** Iniciais da razão social para a marca do cabeçalho. */
const initialsOf = (companyName: string): string => {
  const words = companyName
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');

  return (words || companyName.slice(0, 2)).toUpperCase();
};

/**
 * Derivação única de tudo que as seções mostram. Fica fora dos templates porque
 * os três precisam exibir exatamente a mesma informação — o que muda é a forma.
 */
export function buildSiteViewModel({
  site,
  theme,
  content,
  host,
  legalHref,
}: SiteTemplateProps): SiteViewModel {
  const palette = buildPalette(theme);
  const cnpj = formatCNPJ(site.cnpj);
  const location = locationLabel(content);
  const founded = formatSiteDate(content.foundedAt);
  const years = yearsInBusiness(content.foundedAt);
  const size = formatCompanySize(content.companySize);
  const status = content.registryStatus
    ? humanizeRegistryText(content.registryStatus)
    : null;
  const mainActivity = content.mainActivity
    ? humanizeRegistryText(content.mainActivity)
    : null;
  const description = resolveDescription(site, content);

  /* ---- hero ---- */
  const headline = content.headline ?? site.companyName;
  const hasOwnHeadline = headline !== site.companyName;

  const hero = {
    // Com chamada própria, a razão social sobe para o rótulo: quem revisa a
    // verificação precisa achar o nome registrado logo na primeira dobra.
    eyebrow: hasOwnHeadline
      ? site.companyName
      : (location ?? 'Empresa registrada no Brasil'),
    headline,
    lead: content.tagline ?? description,
  };

  /* ---- faixa de números ---- */
  const stats: SiteFact[] = [];
  if (years) {
    stats.push({
      label: 'Tempo de mercado',
      value: `${years} ${years === 1 ? 'ano' : 'anos'}`,
    });
  } else if (founded) {
    stats.push({ label: 'Início das atividades', value: founded });
  }
  if (location) stats.push({ label: 'Sede', value: location });
  if (size) stats.push({ label: 'Porte', value: size });
  if (content.capital && content.capital > 0) {
    stats.push({ label: 'Capital social', value: formatCurrency(content.capital) });
  } else if (status) {
    stats.push({ label: 'Situação cadastral', value: status });
  }

  /* ---- valores ---- */
  const ownValues = content.values ?? [];
  const fallbackValues: SiteValue[] = [
    {
      title: 'Empresa formalizada',
      description: status
        ? `CNPJ ${cnpj}, com situação cadastral ${status.toLocaleLowerCase('pt-BR')} na Receita Federal.`
        : `CNPJ ${cnpj}, inscrito na Receita Federal.`,
    },
    {
      title: 'Transparência',
      description:
        'Os dados publicados aqui são os mesmos do cadastro público da empresa na Receita Federal.',
    },
  ];
  if (location) {
    fallbackValues.push({
      title: 'Presença local',
      description: `Sede administrativa em ${location.replace(' · ', ' — ')}.`,
    });
  }
  if (years && founded) {
    fallbackValues.push({
      title: 'Continuidade',
      description: `${years} ${years === 1 ? 'ano' : 'anos'} de atividade ininterrupta desde ${founded}.`,
    });
  }

  const values = {
    heading:
      ownValues.length > 0
        ? 'Princípios que orientam o nosso trabalho'
        : 'Compromisso com informação verificável',
    items: ownValues.length > 0 ? ownValues : fallbackValues.slice(0, 4),
  };

  /* ---- quem somos ---- */
  const paragraphs = [description, content.about]
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .filter((text) => text !== hero.lead);

  if (paragraphs.length < 2) {
    // Frase factual montada só com o que consta do cadastro — nada inventado.
    // Garante que a seção nunca fique com um parágrafo solto de duas linhas.
    const opening = founded
      ? `${site.companyName} está em atividade desde ${founded}`
      : `${site.companyName} é uma empresa registrada no Brasil`;
    const place = location ? `, com sede em ${location.replace(' · ', ' — ')}` : '';
    const activity = mainActivity
      ? ` A atividade econômica principal registrada é: ${mainActivity}.`
      : '';

    paragraphs.push(`${opening}${place}, sob o CNPJ ${cnpj}.${activity}`);
  }

  const aboutFacts: SiteFact[] = [];
  if (mainActivity) {
    aboutFacts.push({ label: 'Atividade principal', value: mainActivity });
  }
  if (content.legalNature) {
    aboutFacts.push({
      label: 'Natureza jurídica',
      value: humanizeRegistryText(content.legalNature),
    });
  }
  if (founded) aboutFacts.push({ label: 'Data de abertura', value: founded });

  /* ---- serviços ---- */
  const ownServices = content.services ?? [];
  const fallbackServices: SiteService[] = mainActivity
    ? [
        {
          title: mainActivity,
          description: content.mainActivityCode
            ? `Atividade principal registrada sob o CNAE ${content.mainActivityCode}.`
            : 'Atividade econômica principal registrada na Receita Federal.',
        },
      ]
    : [];
  const services = {
    heading:
      ownServices.length > 0
        ? 'O que a empresa faz'
        : 'Atividade econômica registrada',
    items: ownServices.length > 0 ? ownServices : fallbackServices,
  };

  /* ---- dados da empresa ---- */
  const registry: SiteFact[] = [
    { label: 'Razão social', value: site.companyName },
  ];
  if (content.tradeName && content.tradeName !== site.companyName) {
    registry.push({ label: 'Nome fantasia', value: content.tradeName });
  }
  registry.push({ label: 'CNPJ', value: cnpj });
  if (status) registry.push({ label: 'Situação cadastral', value: status });
  if (founded) registry.push({ label: 'Data de abertura', value: founded });
  if (size) registry.push({ label: 'Porte', value: size });
  if (content.legalNature) {
    registry.push({
      label: 'Natureza jurídica',
      value: humanizeRegistryText(content.legalNature),
    });
  }
  if (content.capital && content.capital > 0) {
    registry.push({
      label: 'Capital social',
      value: formatCurrency(content.capital),
    });
  }
  if (mainActivity) {
    registry.push({
      label: content.mainActivityCode
        ? `Atividade principal (CNAE ${content.mainActivityCode})`
        : 'Atividade principal',
      value: mainActivity,
    });
  }

  /* ---- contato ---- */
  const resolvedHost =
    host ?? siteHost({ subdomain: site.subdomain, customDomain: site.customDomain });

  const channels: SiteChannel[] = [];
  if (content.phone) {
    channels.push({
      label: 'Telefone',
      value: content.phone,
      href: formatPhoneHref(content.phone),
    });
  }
  if (content.email) {
    channels.push({
      label: 'E-mail',
      value: content.email,
      href: `mailto:${content.email}`,
    });
  }
  if (content.website) {
    channels.push({
      label: 'Site',
      value: formatWebsiteLabel(content.website),
      href: formatWebsiteHref(content.website),
      external: true,
    });
  }
  channels.push({
    label: 'Endereço na internet',
    value: resolvedHost,
    href: `https://${resolvedHost}`,
    external: true,
  });

  /* ---- navegação ---- */
  const nav: SiteNavItem[] = [];
  if (values.items.length > 0) nav.push({ href: '#valores', label: 'Valores' });
  nav.push({ href: '#quem-somos', label: 'Quem Somos' });
  if (services.items.length > 0) {
    nav.push({ href: '#servicos', label: 'Serviços' });
  }
  nav.push({ href: '#contato', label: 'Contato' });

  return {
    palette,
    year: new Date().getFullYear(),
    host: resolvedHost,
    legalHref: legalHref ?? '/politica-de-privacidade',
    brand: { name: site.name, initials: initialsOf(site.companyName) },
    companyName: site.companyName,
    cnpj,
    nav,
    hero,
    // O botão principal leva direto ao canal quando ele existe; sem canal,
    // rola até a seção de contato, que sempre tem ao menos o endereço.
    contactHref: content.email
      ? `mailto:${content.email}`
      : content.phone
        ? formatPhoneHref(content.phone)
        : '#contato',
    stats,
    values,
    about: { heading: 'Quem somos', paragraphs, facts: aboutFacts },
    services,
    registry,
    address: addressLines(content),
    partners: content.partners ?? [],
    channels,
    businessHours: content.businessHours ?? null,
  };
}

/* ============ BLOCOS INTERNOS ============ */

type BandProps = {
  id?: string;
  skin: ToneSkin;
  ui: SiteStyle;
  bordered?: boolean;
  backgroundImage?: string;
  children: ReactNode;
};

/**
 * Faixa horizontal de largura total. `scroll-mt-24` compensa o cabeçalho fixo —
 * o Lenis já desloca a âncora em -64px, e a margem cobre o resto.
 */
function Band({ id, skin, ui, bordered, backgroundImage, children }: BandProps) {
  return (
    <section
      id={id}
      style={{
        backgroundColor: skin.bg,
        backgroundImage,
        color: skin.ink,
        borderColor: skin.hairline,
      }}
      className={cn('scroll-mt-24', bordered && 'border-y')}
    >
      <div className={cn(ui.container, ui.band)}>{children}</div>
    </section>
  );
}

function SectionHead({
  ui,
  skin,
  eyebrow,
  heading,
}: {
  ui: SiteStyle;
  skin: ToneSkin;
  eyebrow: string;
  heading: string;
}) {
  return (
    <div className="max-w-3xl">
      <p style={{ color: skin.highlight }} className={ui.eyebrow}>
        {eyebrow}
      </p>
      <h2 className={cn('mt-4', ui.heading)}>{heading}</h2>
    </div>
  );
}

function Card({
  ui,
  skin,
  children,
}: {
  ui: SiteStyle;
  skin: ToneSkin;
  children: ReactNode;
}) {
  return (
    <article
      style={{
        borderColor: skin.hairline,
        backgroundColor: ui.cardSurface ? skin.cardBg : undefined,
      }}
      className={ui.card}
    >
      {children}
    </article>
  );
}

function DefinitionList({
  ui,
  skin,
  items,
  rows,
}: {
  ui: SiteStyle;
  skin: ToneSkin;
  items: SiteFact[];
  rows: boolean;
}) {
  if (rows) {
    return (
      <dl>
        {items.map((item) => (
          <div
            key={item.label}
            style={{ borderColor: skin.hairline }}
            className="grid gap-2 border-b py-5 sm:grid-cols-3 sm:items-baseline sm:gap-6"
          >
            <dt style={{ color: skin.inkSubtle }} className={ui.term}>
              {item.label}
            </dt>
            <dd className="break-words text-base sm:col-span-2">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt style={{ color: skin.inkSubtle }} className={ui.term}>
            {item.label}
          </dt>
          <dd className="mt-2 break-words text-base">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AddressBlock({
  ui,
  skin,
  lines,
  emptyLabel = 'Endereço disponível mediante contato.',
}: {
  ui: SiteStyle;
  skin: ToneSkin;
  lines: string[];
  emptyLabel?: string;
}) {
  if (lines.length === 0) {
    return (
      <p style={{ color: skin.inkMuted }} className={cn('mt-3', ui.body)}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <address className="mt-3 space-y-1 text-base not-italic leading-relaxed">
      {lines.map((line, index) => (
        <span key={`${line}-${index}`} className="block">
          {line}
        </span>
      ))}
    </address>
  );
}

/* ============ SEÇÕES ============ */

type SectionProps = {
  vm: SiteViewModel;
  ui: SiteStyle;
  tone?: SiteTone;
  bordered?: boolean;
};

/**
 * Cabeçalho fixo com as âncoras das seções e o botão "Fale Conosco".
 * Sem JavaScript: no mobile as âncoras descem para uma segunda linha.
 */
export function SiteNav({ vm, ui, tone = 'plain', bordered = true }: SectionProps) {
  const skin = toneSkin(vm.palette, tone);

  return (
    <header
      style={{
        // O cabeçalho é fixo e passa por cima das faixas: `surface` é
        // translúcido e deixaria o conteúdo aparecer por baixo do texto.
        // Só cor opaca entra aqui.
        backgroundColor: tone === 'accent' ? vm.palette.accent : vm.palette.bg,
        color: skin.ink,
        borderColor: skin.hairline,
      }}
      className={cn('sticky top-0 z-30', bordered && 'border-b')}
    >
      {/*
        Uma lista de âncoras só, sem menu sanfona: no mobile o `order-last` +
        `w-full` joga a navegação para a segunda linha, e ela quebra em duas
        linhas em vez de rolar — barra de rolagem horizontal aqui herdaria o
        polegar âmbar da plataforma que globals.css pinta em todo o documento.
      */}
      <div className={cn(ui.container, 'flex flex-wrap items-center gap-x-6 gap-y-3 py-4')}>
        <a href="#topo" className="mr-auto flex min-w-0 items-center gap-3">
          <span
            style={{
              backgroundColor: vm.palette.accent,
              color: vm.palette.accentInk,
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-xs font-semibold tracking-tight"
          >
            {vm.brand.initials}
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">
            {vm.brand.name}
          </span>
        </a>

        <nav
          aria-label="Seções do site"
          style={{ color: skin.inkMuted }}
          className="order-last flex w-full flex-wrap items-center gap-x-6 gap-y-2 text-sm md:order-none md:w-auto md:gap-x-7"
        >
          {vm.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="transition-opacity hover:opacity-70"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href="#contato"
          style={{
            backgroundColor: vm.palette.accent,
            color: vm.palette.accentInk,
          }}
          className={cn('shrink-0 transition-opacity hover:opacity-90', ui.control)}
        >
          Fale Conosco
        </a>
      </div>
    </header>
  );
}

export function SiteHero({
  vm,
  ui,
  tone = 'plain',
  bordered,
  backgroundImage,
  aside,
}: SectionProps & { backgroundImage?: string; aside?: ReactNode }) {
  const skin = toneSkin(vm.palette, tone);

  return (
    <Band
      id="topo"
      skin={skin}
      ui={ui}
      bordered={bordered}
      backgroundImage={backgroundImage}
    >
      <div
        className={cn(
          'gap-12',
          aside ? 'grid lg:grid-cols-12 lg:gap-16' : 'flex flex-col'
        )}
      >
        <div className={aside ? 'lg:col-span-7' : undefined}>
          <p style={{ color: skin.highlight }} className={ui.eyebrow}>
            {vm.hero.eyebrow}
          </p>

          <h1 className={cn('mt-6 break-words', ui.display)}>{vm.hero.headline}</h1>

          <p
            style={{ color: skin.inkMuted }}
            className={cn('mt-6 max-w-2xl', ui.lead)}
          >
            {vm.hero.lead}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a
              href={vm.contactHref}
              style={{
                backgroundColor: skin.highlight,
                color: skin.highlightInk,
              }}
              className={cn('transition-opacity hover:opacity-90', ui.control)}
            >
              Fale com a empresa
            </a>
            <a
              href="#dados"
              style={{ borderColor: skin.hairline, color: skin.ink }}
              className={cn('border transition-opacity hover:opacity-70', ui.control)}
            >
              Ver dados da empresa
            </a>
          </div>
        </div>

        {aside && <div className="lg:col-span-5">{aside}</div>}
      </div>
    </Band>
  );
}

export function SiteStats({ vm, ui, tone = 'surface', bordered = true }: SectionProps) {
  if (vm.stats.length === 0) return null;

  const skin = toneSkin(vm.palette, tone);

  return (
    <section
      id="numeros"
      style={{
        backgroundColor: skin.bg,
        color: skin.ink,
        borderColor: skin.hairline,
      }}
      className={cn('scroll-mt-24', bordered && 'border-y')}
    >
      <div className={cn(ui.container, 'py-10 sm:py-12')}>
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {vm.stats.map((stat) => (
            <div key={stat.label}>
              <dt style={{ color: skin.inkSubtle }} className={ui.term}>
                {stat.label}
              </dt>
              <dd className={cn('mt-2 break-words', ui.cardTitle)}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function SiteValues({ vm, ui, tone = 'plain', bordered }: SectionProps) {
  if (vm.values.items.length === 0) return null;

  const skin = toneSkin(vm.palette, tone);

  return (
    <Band id="valores" skin={skin} ui={ui} bordered={bordered}>
      <SectionHead ui={ui} skin={skin} eyebrow="Valores" heading={vm.values.heading} />

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {vm.values.items.map((value) => (
          <Card key={value.title} ui={ui} skin={skin}>
            <div
              style={{ backgroundColor: skin.highlight }}
              className="h-1 w-8 rounded-full"
            />
            <h3 className={cn('mt-5', ui.cardTitle)}>{value.title}</h3>
            {value.description && (
              <p
                style={{ color: skin.inkMuted }}
                className={cn('mt-3', ui.body)}
              >
                {value.description}
              </p>
            )}
          </Card>
        ))}
      </div>
    </Band>
  );
}

export function SiteAbout({ vm, ui, tone = 'surface', bordered = true }: SectionProps) {
  const skin = toneSkin(vm.palette, tone);

  return (
    <Band id="quem-somos" skin={skin} ui={ui} bordered={bordered}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionHead
            ui={ui}
            skin={skin}
            eyebrow="Quem Somos"
            heading={vm.about.heading}
          />
        </div>

        <div className="lg:col-span-8">
          <div className="space-y-5">
            {vm.about.paragraphs.map((paragraph, index) => (
              <p
                key={`${index}-${paragraph.slice(0, 24)}`}
                style={{ color: index === 0 ? skin.ink : skin.inkMuted }}
                className={index === 0 ? ui.lead : ui.body}
              >
                {paragraph}
              </p>
            ))}
          </div>

          {vm.about.facts.length > 0 && (
            <dl
              style={{ borderColor: skin.hairline }}
              className="mt-10 grid gap-6 border-t pt-8 sm:grid-cols-3"
            >
              {vm.about.facts.map((fact) => (
                <div key={fact.label}>
                  <dt style={{ color: skin.inkSubtle }} className={ui.term}>
                    {fact.label}
                  </dt>
                  <dd className="mt-2 break-words text-sm leading-relaxed">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </Band>
  );
}

export function SiteServices({ vm, ui, tone = 'plain', bordered }: SectionProps) {
  if (vm.services.items.length === 0) return null;

  const skin = toneSkin(vm.palette, tone);

  return (
    <Band id="servicos" skin={skin} ui={ui} bordered={bordered}>
      <SectionHead
        ui={ui}
        skin={skin}
        eyebrow="Serviços"
        heading={vm.services.heading}
      />

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {vm.services.items.map((service, index) => (
          <Card key={service.title} ui={ui} skin={skin}>
            <p style={{ color: skin.highlight }} className={ui.eyebrow}>
              {String(index + 1).padStart(2, '0')}
            </p>
            <h3 className={cn('mt-4', ui.cardTitle)}>{service.title}</h3>
            {service.description && (
              <p style={{ color: skin.inkMuted }} className={cn('mt-3', ui.body)}>
                {service.description}
              </p>
            )}
          </Card>
        ))}
      </div>
    </Band>
  );
}

/**
 * Bloco "Dados da empresa": é o que dá lastro à página para quem confere a
 * verificação. Tudo aqui vem do cadastro público — nenhuma informação é
 * apresentada como documento emitido por órgão público.
 */
export function SiteRegistry({ vm, ui, tone = 'surface', bordered = true }: SectionProps) {
  const skin = toneSkin(vm.palette, tone);

  return (
    <Band id="dados" skin={skin} ui={ui} bordered={bordered}>
      <SectionHead
        ui={ui}
        skin={skin}
        eyebrow="Dados da empresa"
        heading="Informações cadastrais"
      />

      <div className="mt-10">
        <DefinitionList
          ui={ui}
          skin={skin}
          items={vm.registry}
          rows={ui.registryRows}
        />
      </div>

      <div
        style={{ borderColor: skin.hairline }}
        className="mt-12 grid gap-10 border-t pt-10 sm:grid-cols-2"
      >
        <div>
          <p style={{ color: skin.inkSubtle }} className={ui.term}>
            Endereço da sede
          </p>
          <AddressBlock ui={ui} skin={skin} lines={vm.address} />
        </div>

        {vm.partners.length > 0 && (
          <div>
            <p style={{ color: skin.inkSubtle }} className={ui.term}>
              Quadro societário
            </p>
            <ul className="mt-3 space-y-2 text-base">
              {vm.partners.map((partner) => (
                <li key={`${partner.name}-${partner.role ?? ''}`}>
                  <span className="block">{humanizeRegistryText(partner.name)}</span>
                  {partner.role && (
                    <span
                      style={{ color: skin.inkSubtle }}
                      className="block text-sm"
                    >
                      {humanizeRegistryText(partner.role)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p style={{ color: skin.inkSubtle }} className="mt-10 text-xs leading-relaxed">
        Informações obtidas do cadastro público de pessoas jurídicas da Receita
        Federal. Esta página é institucional e não substitui documento oficial.
      </p>
    </Band>
  );
}

export function SiteContact({ vm, ui, tone = 'plain', bordered }: SectionProps) {
  const skin = toneSkin(vm.palette, tone);

  return (
    <Band id="contato" skin={skin} ui={ui} bordered={bordered}>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          {/* Sem artigo antes do nome: "Fale com a Banco X" sairia errado para
              metade das razões sociais. */}
          <SectionHead
            ui={ui}
            skin={skin}
            eyebrow="Contato"
            heading={`Fale com ${vm.brand.name}`}
          />
          {/* Sem canal cadastrado, contactHref é a própria âncora #contato e o
              botão não levaria a lugar nenhum. */}
          {vm.contactHref !== '#contato' && (
            <a
              href={vm.contactHref}
              style={{
                backgroundColor: skin.highlight,
                color: skin.highlightInk,
              }}
              className={cn(
                'mt-8 inline-block transition-opacity hover:opacity-90',
                ui.control
              )}
            >
              Fale Conosco
            </a>
          )}
        </div>

        <div className="grid gap-10 sm:grid-cols-2 lg:col-span-8">
          <div>
            <p style={{ color: skin.inkSubtle }} className={ui.term}>
              Endereço
            </p>
            <AddressBlock ui={ui} skin={skin} lines={vm.address} />

            {vm.businessHours && (
              <>
                <p style={{ color: skin.inkSubtle }} className={cn('mt-8', ui.term)}>
                  Atendimento
                </p>
                <p className="mt-3 text-base leading-relaxed">{vm.businessHours}</p>
              </>
            )}
          </div>

          <div>
            <p style={{ color: skin.inkSubtle }} className={ui.term}>
              Canais
            </p>
            <ul className="mt-3 space-y-3 text-base">
              {vm.channels.map((channel) => (
                <li key={channel.href} className="break-words">
                  <span
                    style={{ color: skin.inkSubtle }}
                    className="block text-xs uppercase tracking-[0.18em]"
                  >
                    {channel.label}
                  </span>
                  <a
                    href={channel.href}
                    style={{ color: skin.highlight }}
                    className="underline-offset-4 hover:underline"
                    {...(channel.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                  >
                    {channel.value}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Band>
  );
}

/**
 * Rodapé único dos três templates. `legalHref` chega pronto da página porque só
 * ela sabe se o site está sendo servido na raiz do subdomínio (produção) ou em
 * /sites/{subdomain} (desenvolvimento e host raiz).
 */
export function SiteFooter({ vm, ui, tone = 'surface', bordered = true }: SectionProps) {
  const skin = toneSkin(vm.palette, tone);

  return (
    <footer
      style={{
        backgroundColor: skin.bg,
        color: skin.inkSubtle,
        borderColor: skin.hairline,
      }}
      className={bordered ? 'border-t' : undefined}
    >
      <div
        className={cn(
          ui.container,
          'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-8 text-xs'
        )}
      >
        <span>
          © {vm.year} {vm.companyName} — Todos os direitos reservados
        </span>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="tabular-nums">CNPJ {vm.cnpj}</span>
          <a
            href={vm.legalHref}
            style={{ color: skin.inkMuted }}
            className="underline-offset-4 hover:underline"
          >
            Política de privacidade
          </a>
        </div>
      </div>
    </footer>
  );
}
