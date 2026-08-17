/**
 * Contrato único dos três templates institucionais.
 *
 * `theme` e `content` chegam de colunas Json do Prisma: o banco não garante
 * formato nenhum (o default de `content` é `{}` e o seed grava só city/state).
 * Por isso nada aqui usa cast — tudo passa por parseTheme/parseContent, que
 * devolvem valores já normalizados e seguros de renderizar.
 *
 * Este módulo é importado por CLIENT COMPONENTS (assistente de criação) e por
 * lib/company/profile.ts. Não pode importar prisma, next/headers, node:dns nem
 * qualquer coisa de servidor: hoje não importa nada, e é assim que fica.
 */

export type SiteTemplateKey = 'minimal' | 'corporate' | 'bold';

export const SITE_TEMPLATE_KEYS: readonly SiteTemplateKey[] = [
  'minimal',
  'corporate',
  'bold',
] as const;

/** Rótulos em pt-BR para o seletor de template do painel. */
export const SITE_TEMPLATE_LABELS: Record<
  SiteTemplateKey,
  { name: string; description: string }
> = {
  minimal: {
    name: 'Minimalista',
    description: 'Coluna única, tipografia leve e muito respiro entre as seções.',
  },
  corporate: {
    name: 'Corporativo',
    description: 'Navegação fixa, faixas alternadas e ficha cadastral em destaque.',
  },
  bold: {
    name: 'Impacto',
    description: 'Tipografia display, gradiente do acento e contato em faixa cheia.',
  },
};

export const DEFAULT_BG_COLOR = '#121212';
export const DEFAULT_ACCENT_COLOR = '#F59E0B';

export type SiteTheme = {
  bgColor: string;
  accentColor: string;
  template?: SiteTemplateKey;
};

/** Card de serviço — na prática, um CNAE secundário já redigido. */
export type SiteService = {
  title: string;
  description?: string;
};

/** Mesma forma do serviço; nome próprio porque a seção é outra. */
export type SiteValue = SiteService;

/** Sócio do quadro societário (qsa da Receita). */
export type SitePartner = {
  name: string;
  role?: string;
};

/**
 * Tudo opcional de propósito: sites antigos têm `{}` e o seed grava apenas
 * city/state. Nenhum template pode depender de um campo estar presente — cada
 * seção some sozinha quando o dado que a justifica não existe.
 *
 * Esta lista é o contrato com a trilha que escreve o conteúdo
 * (lib/company/profile.ts → createSite). parseContent abaixo é uma WHITELIST:
 * chave que não estiver aqui é descartada em silêncio na leitura.
 */
export type SiteContent = {
  /* Texto redigido a partir dos dados públicos. */
  /** Chamada do hero. Sem ela, o hero usa a razão social. */
  headline?: string;
  /** Linha curta logo abaixo da chamada. */
  tagline?: string;
  /** Parágrafo de apresentação — o "quem somos". */
  description?: string;
  /** Segundo parágrafo do "quem somos" (contexto, atuação, tempo de mercado). */
  about?: string;
  values?: SiteValue[];
  services?: SiteService[];

  /* Cadastro na Receita Federal. */
  tradeName?: string;
  mainActivity?: string;
  mainActivityCode?: string;
  legalNature?: string;
  companySize?: string;
  registryStatus?: string;
  capital?: number;
  foundedAt?: string;
  partners?: SitePartner[];

  /* Endereço da sede. */
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;

  /* Canais de contato. */
  phone?: string;
  email?: string;
  website?: string;
  businessHours?: string;
};

export type SiteTemplateProps = {
  site: {
    name: string;
    companyName: string;
    cnpj: string;
    description: string | null;
    subdomain: string;
    /** Domínio próprio quando existe; decide o host exibido no rodapé. */
    customDomain?: string | null;
  };
  theme: SiteTheme;
  content: SiteContent;
  /**
   * Host público já resolvido pela página. Opcional para não quebrar quem ainda
   * não passa: o fallback é o subdomínio da plataforma.
   */
  host?: string;
  /**
   * Rota da política de privacidade. Em produção o site vive na raiz do
   * subdomínio, mas em desenvolvimento ele é servido em /sites/{subdomain} —
   * quem conhece o host (a página) manda o caminho pronto.
   */
  legalHref?: string;
};

/* ============ NORMALIZAÇÃO DO JSON ============ */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Números vindos de Json podem chegar como string ('1000.00' é o formato do
 * capital social em algumas respostas). NaN e negativo caem fora.
 */
const asNumber = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * Só hexadecimal entra. O valor vai direto para `style` inline do tenant;
 * aceitar qualquer string deixaria um `content: {}` mal gravado pintar a
 * página inteira de transparente (ou quebrar a regra CSS por completo).
 */
const asColor = (value: unknown, fallback: string): string => {
  const text = asText(value);
  return text && HEX_COLOR.test(text) ? text : fallback;
};

export function isSiteTemplateKey(value: unknown): value is SiteTemplateKey {
  return (
    typeof value === 'string' &&
    (SITE_TEMPLATE_KEYS as readonly string[]).includes(value)
  );
}

export function parseTheme(value: unknown): SiteTheme {
  const raw = asRecord(value);
  const template = raw.template;

  return {
    bgColor: asColor(raw.bgColor, DEFAULT_BG_COLOR),
    accentColor: asColor(raw.accentColor, DEFAULT_ACCENT_COLOR),
    ...(isSiteTemplateKey(template) ? { template } : {}),
  };
}

/** Lista de {title, description} — serve para serviços e valores. */
const parseBlurbs = (value: unknown, limit: number): SiteService[] =>
  Array.isArray(value)
    ? value
        .map((item): SiteService | null => {
          const blurb = asRecord(item);
          const title = asText(blurb.title);
          return title ? { title, description: asText(blurb.description) } : null;
        })
        .filter((blurb): blurb is SiteService => blurb !== null)
        .slice(0, limit)
    : [];

const parsePartners = (value: unknown): SitePartner[] =>
  Array.isArray(value)
    ? value
        .map((item): SitePartner | null => {
          const partner = asRecord(item);
          const name = asText(partner.name);
          return name ? { name, role: asText(partner.role) } : null;
        })
        .filter((partner): partner is SitePartner => partner !== null)
        .slice(0, 8)
    : [];

export function parseContent(value: unknown): SiteContent {
  const raw = asRecord(value);

  return {
    headline: asText(raw.headline),
    tagline: asText(raw.tagline),
    description: asText(raw.description),
    about: asText(raw.about),
    values: parseBlurbs(raw.values, 4),
    services: parseBlurbs(raw.services, 6),

    tradeName: asText(raw.tradeName),
    mainActivity: asText(raw.mainActivity),
    mainActivityCode: asText(raw.mainActivityCode),
    legalNature: asText(raw.legalNature),
    companySize: asText(raw.companySize),
    registryStatus: asText(raw.registryStatus),
    capital: asNumber(raw.capital),
    foundedAt: asText(raw.foundedAt),
    partners: parsePartners(raw.partners),

    street: asText(raw.street),
    number: asText(raw.number),
    complement: asText(raw.complement),
    neighborhood: asText(raw.neighborhood),
    city: asText(raw.city),
    state: asText(raw.state),
    zipCode: asText(raw.zipCode),

    phone: asText(raw.phone),
    email: asText(raw.email),
    website: asText(raw.website),
    businessHours: asText(raw.businessHours),
  };
}

/* ============ CORES DERIVADAS ============ */

const hexToRgb = (color: string): { r: number; g: number; b: number } | null => {
  if (!HEX_COLOR.test(color)) return null;

  const hex = color.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};

/** Aplica opacidade a um hex; devolve a cor original se não for hex. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;

  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

/**
 * Luminância relativa (WCAG). O corte em 0.179 é o ponto onde o contraste
 * contra preto empata com o contraste contra branco — é ele que decide se o
 * texto sobre a cor do tenant sai claro ou escuro.
 */
export function isLightColor(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;

  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const luminance =
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);

  return luminance > 0.179;
}

export type SitePalette = {
  bg: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  hairline: string;
  surface: string;
  surfaceStrong: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentVeil: string;
};

/**
 * O tenant escolhe fundo e destaque; todo o resto (texto, filetes, superfícies)
 * é derivado daí para o template continuar legível com qualquer cor — inclusive
 * fundo claro, onde texto branco sumiria.
 */
export function buildPalette(theme: SiteTheme): SitePalette {
  const ink = isLightColor(theme.bgColor) ? '#111111' : '#ffffff';

  return {
    bg: theme.bgColor,
    ink,
    inkMuted: withAlpha(ink, 0.7),
    inkSubtle: withAlpha(ink, 0.45),
    hairline: withAlpha(ink, 0.14),
    surface: withAlpha(ink, 0.04),
    surfaceStrong: withAlpha(ink, 0.08),
    accent: theme.accentColor,
    accentInk: isLightColor(theme.accentColor) ? '#111111' : '#ffffff',
    accentSoft: withAlpha(theme.accentColor, 0.18),
    accentVeil: withAlpha(theme.accentColor, 0.08),
  };
}

/* ============ FORMATAÇÃO ============ */

/**
 * Datas da BrasilAPI chegam como 'YYYY-MM-DD' e são interpretadas em UTC;
 * sem fixar o fuso na saída, um servidor em UTC-3 mostraria o dia anterior.
 */
export function formatSiteDate(value: string | undefined): string | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/** Anos completos desde a abertura — a "empresa desde" de qualquer site sério. */
export function yearsInBusiness(value: string | undefined): number | null {
  if (!value) return null;

  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return null;

  const elapsed = Date.now() - start.getTime();
  if (elapsed <= 0) return null;

  // 365.2425 = ano médio do calendário gregoriano; evita o erro acumulado dos
  // bissextos que faria uma empresa de 1988 aparecer com um ano a mais.
  const years = Math.floor(elapsed / (365.2425 * 24 * 60 * 60 * 1000));
  return years > 0 ? years : null;
}

export function formatCep(value: string | undefined): string | null {
  if (!value) return null;

  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return value;

  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function formatPhoneHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, '')}`;
}

/** A Receita devolve o site sem esquema; sem `https://` o link vira relativo. */
export function formatWebsiteHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function formatWebsiteLabel(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

const REGISTRY_ACRONYMS = new Set([
  'CIA',
  'EI',
  'EIRELI',
  'EPP',
  'LTDA',
  'ME',
  'MEI',
  'S/A',
  'S.A.',
  'SA',
  'SCP',
  'SLU',
]);

const REGISTRY_MINOR_WORDS = new Set([
  'a',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'para',
  'por',
  'sem',
  'sob',
]);

/**
 * A Receita devolve porte, natureza jurídica e nomes de sócios em CAIXA ALTA.
 * Jogar isso num parágrafo faz o site parecer um dump de banco de dados.
 * A conversão só acontece quando o texto está inteiramente em maiúsculas — se
 * já vier com minúsculas, é texto de humano e não se mexe.
 */
export function humanizeRegistryText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed !== trimmed.toLocaleUpperCase('pt-BR')) return trimmed;

  return trimmed
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, index) => {
      if (!word) return word;

      const bare = word
        .replace(/[^\p{L}\p{N}./]/gu, '')
        .toLocaleUpperCase('pt-BR');

      if (REGISTRY_ACRONYMS.has(bare)) return word.toLocaleUpperCase('pt-BR');
      if (index > 0 && REGISTRY_MINOR_WORDS.has(word)) return word;

      return word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1);
    })
    .join(' ');
}

/**
 * `porte` vem ora como código ('01'), ora como rótulo em caixa alta
 * ('MICRO EMPRESA'). Normalizar aqui evita que o site exiba "Demais" sozinho,
 * que não diz nada a quem lê.
 */
export function formatCompanySize(value: string | undefined): string | null {
  if (!value) return null;

  const key = value.trim().toLocaleUpperCase('pt-BR');

  const known: Record<string, string> = {
    '01': 'Microempresa (ME)',
    ME: 'Microempresa (ME)',
    MICRO: 'Microempresa (ME)',
    'MICRO EMPRESA': 'Microempresa (ME)',
    MICROEMPRESA: 'Microempresa (ME)',
    '03': 'Empresa de Pequeno Porte (EPP)',
    EPP: 'Empresa de Pequeno Porte (EPP)',
    'EMPRESA DE PEQUENO PORTE': 'Empresa de Pequeno Porte (EPP)',
    '05': 'Demais portes',
    DEMAIS: 'Demais portes',
    'DEMAIS PORTES': 'Demais portes',
    '00': 'Não informado',
    'NAO INFORMADO': 'Não informado',
    'NÃO INFORMADO': 'Não informado',
  };

  return known[key] ?? humanizeRegistryText(value);
}

/** Linhas do endereço já montadas, sem vírgulas órfãs quando falta um campo. */
export function addressLines(content: SiteContent): string[] {
  const lines: string[] = [];

  const street = [content.street, content.number].filter(Boolean).join(', ');
  const streetLine = [street, content.complement].filter(Boolean).join(' — ');
  if (streetLine) lines.push(streetLine);

  if (content.neighborhood) lines.push(content.neighborhood);

  const cityLine = [content.city, content.state].filter(Boolean).join(' — ');
  if (cityLine) lines.push(cityLine);

  const cep = formatCep(content.zipCode);
  if (cep) lines.push(`CEP ${cep}`);

  return lines;
}

/** Cidade e UF em uma linha, o rótulo curto usado nos cabeçalhos. */
export function locationLabel(content: SiteContent): string | null {
  const label = [content.city, content.state].filter(Boolean).join(' · ');
  return label.length > 0 ? label : null;
}

/**
 * `content.description` é preenchido por createSite com a razão social vinda
 * da Receita — repetir isso como texto de apresentação seria mostrar o nome da
 * empresa duas vezes. A descrição escrita pelo usuário (coluna `description`)
 * vem primeiro, e o fallback é factual: nada de texto inventado.
 */
export function resolveDescription(
  site: SiteTemplateProps['site'],
  content: SiteContent
): string {
  const own = site.description?.trim();
  if (own) return own;

  const fromContent = content.description;
  if (
    fromContent &&
    fromContent.toLowerCase() !== site.companyName.trim().toLowerCase()
  ) {
    return fromContent;
  }

  return `Página institucional de ${site.companyName}, com dados cadastrais e canais oficiais de contato.`;
}
