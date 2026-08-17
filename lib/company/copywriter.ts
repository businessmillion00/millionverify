/**
 * Redação do site a partir do cadastro público — sem IA, sem rede, sem sorteio.
 *
 * REGRAS QUE NÃO SE NEGOCIAM AQUI:
 *  1. Determinismo. Mesma empresa, mesmo texto, hoje e daqui a um ano. Nada de
 *     `Date.now()`, `Math.random()` ou contagem de anos corridos — por isso o
 *     texto fala em "desde 2014" e nunca em "11 anos de mercado" (o tempo de
 *     mercado é calculado na renderização, em yearsInBusiness).
 *  2. Só se afirma o que está no cadastro. Nada de "líder de mercado", prêmio,
 *     número de clientes ou promessa de resultado: quem lê este texto do outro
 *     lado é o revisor da Meta, e uma frase inventada derruba a credibilidade
 *     da verificação inteira.
 *  3. Português correto. Frase montada por partes, com variante para cada dado
 *     que faltar — nunca "sediada em , desde ".
 *
 * O texto é sempre derivado de: CNAE principal (headline e serviços), CNAEs
 * secundários (serviços), cidade/UF, ano de início de atividade, porte,
 * natureza jurídica e situação cadastral.
 */

import type { SiteService } from '@/components/site-templates/types';
import type { CompanyActivity, CompanyProfile } from '@/lib/company/profile';

/** Máximo de cards de serviço. Três é o que os templates comportam sem sobra. */
const MAX_SERVICES = 3;

/** Comprimento alvo de um título de serviço/headline antes do corte. */
const TITLE_MAX = 78;

/* ============ TEXTO ============ */

/** Palavra sem acento e em minúsculas, para comparação. */
const plain = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase('pt-BR');

const upperFirst = (value: string): string =>
  value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1);

/**
 * Minúscula inicial para encaixar a frase depois de "Excelência em". Siglas e
 * nomes próprios em caixa alta ficam intactos — "Excelência em tI" seria pior
 * que o problema que isto resolve.
 */
const lowerFirst = (value: string): string => {
  const first = value.split(' ')[0] ?? '';
  if (first.length > 1 && first === first.toLocaleUpperCase('pt-BR')) return value;

  return value.charAt(0).toLocaleLowerCase('pt-BR') + value.slice(1);
};

/** Conectivos que não podem terminar uma frase depois de um corte. */
const CONNECTORS = new Set([
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
  'ou',
  'para',
  'por',
  'sem',
  'sob',
  'sobre',
]);

const TRAILING_PUNCTUATION = /[\s,;:.\-–—/]+$/u;

/**
 * Remove pontuação solta e conectivos pendurados no fim do texto. Sem isto,
 * cortar uma descrição de CNAE produz título terminando em "de" ou "e".
 */
const trimTail = (value: string): string => {
  let result = value.replace(TRAILING_PUNCTUATION, '');

  for (;;) {
    const match = /\s(\S+)$/u.exec(result);
    if (!match || !CONNECTORS.has(plain(match[1]))) break;

    result = result.slice(0, match.index).replace(TRAILING_PUNCTUATION, '');
  }

  return result.trim();
};

/** Corta no limite sem partir palavra e sem deixar conectivo no fim. */
const capLength = (value: string, max: number): string => {
  if (value.length <= max) return value;

  const window = value.slice(0, max + 1);
  const space = window.lastIndexOf(' ');

  return trimTail(space > 0 ? value.slice(0, space) : value.slice(0, max));
};

/*
 * As descrições de CNAE trazem ressalvas que servem ao fiscal e atrapalham o
 * leitor: "…, exceto imobiliários", "… não especificados anteriormente",
 * "… - hipermercados". A frase que vai para o site fica sem essa cauda.
 */
const NOISE: readonly RegExp[] = [
  /\([^)]*\)/gu, // parênteses inteiros
  /,?\s*exceto\b.*$/iu,
  /,?\s*n[aã]o especificad[oa]s?\s+anteriormente\b.*$/iu,
  /,?\s*n[aã]o classificad[oa]s?\s+anteriormente\b.*$/iu,
  /\s[-–—]\s.*$/u, // cauda qualificadora depois do travessão
  /;.*$/u,
];

/**
 * Descrição de CNAE pronta para entrar numa frase, ainda com a primeira letra
 * maiúscula. Se a limpeza esvaziar o texto (CNAE atípico), devolve o original.
 */
export function activityPhrase(description: string): string {
  const original = description.replace(/\s+/gu, ' ').trim();

  const cleaned = trimTail(
    NOISE.reduce((text, pattern) => text.replace(pattern, ' '), original)
      .replace(/\s+/gu, ' ')
      .trim()
  );

  return cleaned.length > 0 ? cleaned : original;
}

/**
 * Versão curta da mesma descrição, para título de card e chamada: fica só a
 * primeira oração, sem o "com predominância de…" que quase todo CNAE de
 * comércio carrega.
 */
export function activityTitle(description: string): string {
  // "com predominância de…" é ressalva estatística do IBGE, não descrição do
  // negócio: sai sempre, mesmo quando o título caberia inteiro.
  const phrase = trimTail(
    activityPhrase(description).replace(/\s+com predomin[aâ]ncia\b.*$/iu, '')
  );

  if (phrase.length <= TITLE_MAX) return upperFirst(phrase);

  // Só a partir daqui vale sacrificar informação: fica a primeira oração, e a
  // frase inteira volta se a oração sozinha não disser nada ("Lanchonetes").
  const clause = trimTail(phrase.replace(/,\s.*$/u, ''));
  const base = clause.length >= 20 ? clause : phrase;

  return upperFirst(capLength(base, TITLE_MAX));
}

/* ============ SETOR (CNAE) ============ */

/*
 * Divisões da CNAE 2.0 agrupadas em seções. É tradução direta da tabela
 * oficial do IBGE: não há juízo de valor aqui, só o nome do setor a que o
 * código pertence.
 */
const CNAE_SECTORS: readonly { readonly from: number; readonly to: number; readonly label: string }[] = [
  { from: 1, to: 3, label: 'agropecuária, produção florestal e pesca' },
  { from: 5, to: 9, label: 'indústrias extrativas' },
  { from: 10, to: 33, label: 'indústria de transformação' },
  { from: 35, to: 35, label: 'eletricidade e gás' },
  { from: 36, to: 39, label: 'água, esgoto e gestão de resíduos' },
  { from: 41, to: 43, label: 'construção' },
  { from: 45, to: 45, label: 'comércio e reparação de veículos automotores' },
  { from: 46, to: 46, label: 'comércio atacadista' },
  { from: 47, to: 47, label: 'comércio varejista' },
  { from: 49, to: 53, label: 'transporte, armazenagem e correio' },
  { from: 55, to: 56, label: 'alojamento e alimentação' },
  { from: 58, to: 63, label: 'informação e comunicação' },
  { from: 64, to: 66, label: 'atividades financeiras e de seguros' },
  { from: 68, to: 68, label: 'atividades imobiliárias' },
  { from: 69, to: 75, label: 'atividades profissionais, científicas e técnicas' },
  { from: 77, to: 82, label: 'atividades administrativas e serviços complementares' },
  { from: 84, to: 84, label: 'administração pública' },
  { from: 85, to: 85, label: 'educação' },
  { from: 86, to: 88, label: 'saúde humana e serviços sociais' },
  { from: 90, to: 93, label: 'artes, cultura, esporte e recreação' },
  { from: 94, to: 96, label: 'outras atividades de serviços' },
  { from: 97, to: 97, label: 'serviços domésticos' },
  { from: 99, to: 99, label: 'organismos internacionais' },
];

/** Setor da CNAE a partir do código formatado (8211-3/00 → divisão 82). */
export function activitySector(code: string | null): string | null {
  const digits = (code ?? '').replace(/\D/gu, '');
  if (digits.length < 2) return null;

  const division = Number(digits.slice(0, 2));
  if (!Number.isFinite(division)) return null;

  return (
    CNAE_SECTORS.find((sector) => division >= sector.from && division <= sector.to)
      ?.label ?? null
  );
}

/* ============ CHAMADA ============ */

/*
 * Descrições de CNAE começam ou por um substantivo de ação ("Serviços de…",
 * "Fabricação de…") ou pelo próprio estabelecimento ("Restaurantes…",
 * "Cabeleireiros…"). Só o primeiro caso aceita o prefixo "Excelência em"; no
 * segundo, a própria descrição já é uma chamada natural e ganhar prefixo só
 * produziria português torto.
 */
const ACTION_NOUNS = new Set([
  'abate',
  'acabamento',
  'administracao',
  'agenciamento',
  'alimentacao',
  'aluguel',
  'armazenagem',
  'armazenamento',
  'arquitetura',
  'assessoria',
  'assistencia',
  'atendimento',
  'atividade',
  'atividades',
  'auditoria',
  'avaliacao',
  'beneficiamento',
  'captacao',
  'coleta',
  'comercializacao',
  'comercio',
  'comunicacao',
  'confeccao',
  'conservacao',
  'construcao',
  'consultoria',
  'contabilidade',
  'criacao',
  'cultivo',
  'desenvolvimento',
  'distribuicao',
  'edicao',
  'educacao',
  'engenharia',
  'ensino',
  'exploracao',
  'extracao',
  'fabricacao',
  'financiamento',
  'fornecimento',
  'geracao',
  'gerenciamento',
  'gestao',
  'impressao',
  'incorporacao',
  'instalacao',
  'instalacoes',
  'intermediacao',
  'jardinagem',
  'limpeza',
  'locacao',
  'manutencao',
  'montagem',
  'obras',
  'organizacao',
  'planejamento',
  'preparacao',
  'processamento',
  'producao',
  'promocao',
  'pesquisa',
  'publicidade',
  'reciclagem',
  'recuperacao',
  'reparacao',
  'representacao',
  'representantes',
  'restauracao',
  'seguranca',
  'servico',
  'servicos',
  'suporte',
  'telecomunicacoes',
  'testes',
  'transformacao',
  'transporte',
  'transportes',
  'tratamento',
  'treinamento',
  'vigilancia',
]);

/** Chamada do hero. `null` quando não há CNAE — aí o hero usa a razão social. */
export function writeHeadline(profile: CompanyProfile): string | null {
  if (!profile.mainActivity) return null;

  const title = activityTitle(profile.mainActivity.description);
  if (!title) return null;

  const head = plain(title.split(' ')[0] ?? '');

  return ACTION_NOUNS.has(head) ? `Excelência em ${lowerFirst(title)}` : title;
}

/* ============ PARÁGRAFOS ============ */

/** "São Paulo (SP)" — como a cidade aparece dentro de uma frase. */
export function placeLabel(profile: CompanyProfile): string | null {
  const { city, state } = profile.address;
  if (city && state) return `${city} (${state})`;

  return city ?? null;
}

/**
 * Linha de apoio do hero. Fica de fora da atividade de propósito: a chamada
 * logo acima já diz o que a empresa faz, e repetir soaria a texto automático.
 */
export function writeTagline(profile: CompanyProfile): string | null {
  const place = placeLabel(profile);
  const year = profile.foundedYear;

  if (place && year) {
    return `Empresa com sede em ${place}, em atividade desde ${year}.`;
  }
  if (place) return `Empresa com sede em ${place}.`;
  if (year) return `Empresa em atividade desde ${year}.`;

  return null;
}

/** Parágrafo de apresentação: o que faz, onde fica, desde quando e sob qual CNPJ. */
export function writeDescription(profile: CompanyProfile): string {
  const name = profile.displayName;
  const place = placeLabel(profile);
  const year = profile.foundedYear;
  const activity = profile.mainActivity
    ? lowerFirst(activityPhrase(profile.mainActivity.description))
    : null;

  /*
   * Descrição de CNAE longa ou com oração subordinada ("…, com predominância de
   * produtos alimentícios") não aceita mais um complemento pendurado no fim:
   * "atua em X, com predominância de Y desde 1998" gruda o ano na oração
   * errada. Nesse caso a frase se parte em duas.
   */
  const splitSentence = activity !== null && (activity.includes(',') || activity.length > 60);

  let opening: string;

  if (activity && splitSentence) {
    const location = place ? `A empresa tem sede em ${place}` : 'A empresa';
    const since = year
      ? place
        ? ` e está em atividade desde ${year}`
        : ` está em atividade desde ${year}`
      : '';

    opening =
      place || year
        ? `${name} atua em ${activity}. ${location}${since}.`
        : `${name} atua em ${activity}.`;
  } else if (activity && place && year) {
    opening = `${name} atua em ${activity} desde ${year}, com sede em ${place}.`;
  } else if (activity && place) {
    opening = `${name} atua em ${activity}, com sede em ${place}.`;
  } else if (activity && year) {
    opening = `${name} atua em ${activity} desde ${year}.`;
  } else if (activity) {
    opening = `${name} atua em ${activity}.`;
  } else if (place && year) {
    opening = `${name} é uma empresa com sede em ${place}, em atividade desde ${year}.`;
  } else if (place) {
    opening = `${name} é uma empresa com sede em ${place}.`;
  } else if (year) {
    opening = `${name} é uma empresa em atividade desde ${year}.`;
  } else {
    opening = `${name} é uma empresa registrada no Brasil.`;
  }

  // Concorda com "a empresa", implícita na frase anterior.
  const size = profile.size ? ` e está enquadrada como ${lowerFirst(profile.size)}` : '';

  // Situação cadastral só entra quando é a favor: anunciar "situação suspensa"
  // no parágrafo de abertura seria trabalhar contra o próprio cliente.
  const registry = profile.isActive
    ? `Inscrita no CNPJ ${profile.formattedCnpj}, mantém situação cadastral ativa na Receita Federal${size}.`
    : `Está inscrita no CNPJ ${profile.formattedCnpj}${size}.`;

  return `${opening} ${registry}`;
}

/**
 * Segundo parágrafo: enquadramento formal e a frase que ancora o produto — o
 * site diz, com todas as letras, que reproduz dado público consultado na
 * Receita. É essa transparência que sustenta a verificação perante a Meta.
 */
export function writeAbout(profile: CompanyProfile): string {
  const sentences: string[] = [];

  const hasLegalNature = profile.legalNature !== null;

  if (profile.legalNature) {
    sentences.push(
      `A empresa é constituída sob a natureza jurídica de ${profile.legalNature}.`
    );
  }

  const code = profile.mainActivity?.code ?? null;
  const sector = activitySector(code);

  if (sector) {
    // "Sua atividade" só se sustenta com a frase anterior no ar; sem ela, o
    // possessivo fica sem antecedente logo na abertura do parágrafo.
    const subject = hasLegalNature ? 'Sua atividade principal' : 'A atividade principal da empresa';

    sentences.push(
      code
        ? `${subject} está classificada no setor de ${sector}, conforme a Classificação Nacional de Atividades Econômicas (CNAE ${code}).`
        : `${subject} está classificada no setor de ${sector}, conforme a Classificação Nacional de Atividades Econômicas.`
    );
  }

  const extra = profile.secondaryActivities.length;
  if (extra === 1) {
    sentences.push(
      'Além da atividade principal, o cadastro registra uma atividade secundária, que completa o escopo de atuação declarado.'
    );
  } else if (extra > 1) {
    sentences.push(
      `Além da atividade principal, o cadastro registra ${extra} atividades secundárias, que completam o escopo de atuação declarado.`
    );
  }

  sentences.push(
    'As informações publicadas nesta página reproduzem os dados cadastrais públicos da empresa, consultados na base da Receita Federal.'
  );

  return sentences.join(' ');
}

/* ============ SERVIÇOS ============ */

const serviceNote = (activity: CompanyActivity, isMain: boolean): string => {
  if (isMain) {
    return activity.code
      ? `Atividade principal da empresa, registrada na Receita Federal sob o CNAE ${activity.code}.`
      : 'Atividade principal da empresa, registrada na Receita Federal.';
  }

  return activity.code
    ? `Atividade secundária registrada no cadastro da empresa sob o CNAE ${activity.code}.`
    : 'Atividade secundária registrada no cadastro da empresa.';
};

/**
 * Até três serviços, na ordem CNAE principal → secundários. Empresa com um CNAE
 * só recebe um card: preencher os outros dois exigiria inventar serviço que a
 * empresa não declarou, e é exatamente isso que não pode acontecer aqui.
 */
export function writeServices(profile: CompanyProfile): SiteService[] {
  const services: SiteService[] = [];
  const seen = new Set<string>();

  const add = (activity: CompanyActivity, isMain: boolean): void => {
    if (services.length >= MAX_SERVICES) return;

    const title = activityTitle(activity.description);
    const key = plain(title);
    // Dois CNAEs podem encurtar para o mesmo título ("Comércio varejista de
    // outros produtos"): repetir o card faria o site parecer gerado no braço.
    if (!key || seen.has(key)) return;

    seen.add(key);
    services.push({ title, description: serviceNote(activity, isMain) });
  };

  if (profile.mainActivity) add(profile.mainActivity, true);
  for (const activity of profile.secondaryActivities) add(activity, false);

  return services;
}

/* ============ SAÍDA ============ */

export interface SiteCopy {
  /** `null` quando não há CNAE principal: o hero cai na razão social. */
  headline: string | null;
  tagline: string | null;
  description: string;
  about: string;
  services: SiteService[];
}

/** Todo o texto do site, derivado do cadastro. Função pura e determinística. */
export function writeSiteCopy(profile: CompanyProfile): SiteCopy {
  return {
    headline: writeHeadline(profile),
    tagline: writeTagline(profile),
    description: writeDescription(profile),
    about: writeAbout(profile),
    services: writeServices(profile),
  };
}
