/**
 * Perfil normalizado da empresa — a ponte entre o cadastro público da Receita
 * Federal e o conteúdo que os templates renderizam.
 *
 * Duas entradas levam ao mesmo `CompanyProfile`:
 *   1. `buildCompanyProfile(info)` — a consulta recém-feita (services/brasil-api).
 *   2. `parseRegistryData(site.registryData)` — o payload BRUTO já gravado, para
 *      reescrever o site sem gastar uma nova consulta à BrasilAPI.
 *
 * MÓDULO DE SERVIDOR: importa services/brasil-api, que instancia o cliente axios
 * no topo do arquivo. Não importe daqui em client component — o contrato dos
 * templates continua sendo components/site-templates/types.ts, que não importa
 * nada e é o único seguro para o navegador.
 */

import {
  normalizeCNPJPayload,
  type CNPJInfo,
  type JsonObject,
  type JsonValue,
} from '@/services/brasil-api';
import {
  humanizeRegistryText,
  type SiteContent,
  type SitePartner,
} from '@/components/site-templates/types';
import { formatCNPJ } from '@/lib/utils';
import { writeSiteCopy } from '@/lib/company/copywriter';

/* ============ ACENTUAÇÃO DO CADASTRO ============ */

/*
 * Razão social, nome fantasia, logradouro, bairro, município e nomes de sócios
 * chegam da Receita em CAIXA ALTA e SEM ACENTO ("SAO PAULO", "COMERCIO DE
 * PECAS"). `humanizeRegistryText` resolve a caixa; o acento só volta por
 * dicionário. Sem isso o site do cliente exibe "Sao Paulo" e "Comercio de
 * Pecas" — a primeira coisa que denuncia uma página gerada por máquina.
 *
 * A tabela cobre as palavras que realmente se repetem em razão social,
 * endereço e nome de município no Brasil. Só entram palavras cuja grafia
 * acentuada é única: nada aqui pode transformar uma palavra em outra.
 */
const PT_ACCENTS: Readonly<Record<string, string | undefined>> = {
  // Topônimos e nomes próprios frequentes
  ANAPOLIS: 'Anápolis',
  ANDRE: 'André',
  ANTONIA: 'Antônia',
  ANTONIO: 'Antônio',
  ARACATUBA: 'Araçatuba',
  ASSUNCAO: 'Assunção',
  BARAO: 'Barão',
  BELEM: 'Belém',
  BRASILIA: 'Brasília',
  CAMACARI: 'Camaçari',
  CAPITAO: 'Capitão',
  CEARA: 'Ceará',
  CECILIA: 'Cecília',
  CHAPECO: 'Chapecó',
  CONCEICAO: 'Conceição',
  CRICIUMA: 'Criciúma',
  CUIABA: 'Cuiabá',
  FATIMA: 'Fátima',
  FLORIANOPOLIS: 'Florianópolis',
  GOIANIA: 'Goiânia',
  GOIAS: 'Goiás',
  GONCALO: 'Gonçalo',
  GONCALVES: 'Gonçalves',
  GRAVATAI: 'Gravataí',
  GUARUJA: 'Guarujá',
  IGUACU: 'Iguaçu',
  ILHEUS: 'Ilhéus',
  INACIO: 'Inácio',
  ITAJAI: 'Itajaí',
  JABOATAO: 'Jaboatão',
  JOAO: 'João',
  JOSE: 'José',
  JULIA: 'Júlia',
  JULIO: 'Júlio',
  JUNDIAI: 'Jundiaí',
  LUCIA: 'Lúcia',
  LUIS: 'Luís',
  MACAPA: 'Macapá',
  MACEIO: 'Maceió',
  MARABA: 'Marabá',
  MARINGA: 'Maringá',
  MARIO: 'Mário',
  MAUA: 'Mauá',
  MOSSORO: 'Mossoró',
  NITEROI: 'Niterói',
  PARAIBA: 'Paraíba',
  PARAISO: 'Paraíso',
  PARANA: 'Paraná',
  PETROPOLIS: 'Petrópolis',
  PIAUI: 'Piauí',
  RIBEIRAO: 'Ribeirão',
  RONDONIA: 'Rondônia',
  RONDONOPOLIS: 'Rondonópolis',
  ROSARIO: 'Rosário',
  SANTAREM: 'Santarém',
  SAO: 'São',
  SEBASTIAO: 'Sebastião',
  SERTAO: 'Sertão',
  TAUBATE: 'Taubaté',
  TERESOPOLIS: 'Teresópolis',
  UBERLANDIA: 'Uberlândia',
  UNIAO: 'União',
  VARZEA: 'Várzea',
  VITORIA: 'Vitória',

  // Vocabulário de razão social
  ACESSORIOS: 'Acessórios',
  ADMINISTRACAO: 'Administração',
  AGRICOLA: 'Agrícola',
  AGROPECUARIA: 'Agropecuária',
  ALIMENTICIA: 'Alimentícia',
  ALIMENTICIOS: 'Alimentícios',
  ANALISES: 'Análises',
  AUTOMACAO: 'Automação',
  CALCADOS: 'Calçados',
  CLIMATIZACAO: 'Climatização',
  CLINICA: 'Clínica',
  COMERCIO: 'Comércio',
  COMUNICACAO: 'Comunicação',
  COMUNICACOES: 'Comunicações',
  CONFECCAO: 'Confecção',
  CONFECCOES: 'Confecções',
  CONSERVACAO: 'Conservação',
  CONSTRUCAO: 'Construção',
  CONSTRUCOES: 'Construções',
  CONTABIL: 'Contábil',
  COSMETICOS: 'Cosméticos',
  CREDITO: 'Crédito',
  DECORACAO: 'Decoração',
  DECORACOES: 'Decorações',
  DIAGNOSTICO: 'Diagnóstico',
  DISTRIBUICAO: 'Distribuição',
  EDUCACAO: 'Educação',
  ELETRICA: 'Elétrica',
  ELETRICOS: 'Elétricos',
  ELETRODOMESTICOS: 'Eletrodomésticos',
  ELETRONICOS: 'Eletrônicos',
  ESTETICA: 'Estética',
  EXPORTACAO: 'Exportação',
  FARMACEUTICA: 'Farmacêutica',
  FARMACIA: 'Farmácia',
  GENEROS: 'Gêneros',
  GESTAO: 'Gestão',
  GRAFICA: 'Gráfica',
  HIDRAULICA: 'Hidráulica',
  IMOBILIARIA: 'Imobiliária',
  IMOVEIS: 'Imóveis',
  IMPORTACAO: 'Importação',
  INDUSTRIA: 'Indústria',
  INDUSTRIAS: 'Indústrias',
  INFORMATICA: 'Informática',
  INSTALACAO: 'Instalação',
  INSTALACOES: 'Instalações',
  IRMAOS: 'Irmãos',
  JURIDICA: 'Jurídica',
  JURIDICOS: 'Jurídicos',
  LABORATORIO: 'Laboratório',
  LOCACAO: 'Locação',
  LOCACOES: 'Locações',
  LOGISTICA: 'Logística',
  MANUTENCAO: 'Manutenção',
  MAQUINAS: 'Máquinas',
  MECANICA: 'Mecânica',
  MEDICA: 'Médica',
  MEDICOS: 'Médicos',
  METALURGICA: 'Metalúrgica',
  MOVEIS: 'Móveis',
  NEGOCIOS: 'Negócios',
  ODONTOLOGICA: 'Odontológica',
  ORGANICOS: 'Orgânicos',
  PARTICIPACOES: 'Participações',
  PECAS: 'Peças',
  PECUARIA: 'Pecuária',
  PLASTICO: 'Plástico',
  PLASTICOS: 'Plásticos',
  PRODUCAO: 'Produção',
  QUIMICA: 'Química',
  REFRIGERACAO: 'Refrigeração',
  REPRESENTACAO: 'Representação',
  REPRESENTACOES: 'Representações',
  SAUDE: 'Saúde',
  SEGURANCA: 'Segurança',
  SERVICO: 'Serviço',
  SERVICOS: 'Serviços',
  SOLUCAO: 'Solução',
  SOLUCOES: 'Soluções',
  TECNICA: 'Técnica',
  TECNICOS: 'Técnicos',
  TELECOMUNICACOES: 'Telecomunicações',
  VEICULOS: 'Veículos',
  VESTUARIO: 'Vestuário',
  VIDRACARIA: 'Vidraçaria',
  VIGILANCIA: 'Vigilância',

  // Vocabulário de endereço
  AREA: 'Área',
  ARMAZEM: 'Armazém',
  CHACARA: 'Chácara',
  CORREGO: 'Córrego',
  EDIFICIO: 'Edifício',
  MUNICIPIO: 'Município',
  NUCLEO: 'Núcleo',
  NUMERO: 'Número',
  PRACA: 'Praça',
  PROXIMO: 'Próximo',
  SITIO: 'Sítio',
  TERREO: 'Térreo',
};

/** Chave de comparação: sem acento, sem pontuação, em caixa alta. */
export function registryKey(value: string): string {
  return value
    .normalize('NFD')
    // Marcas de combinação: o que sobra do acento depois do NFD.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toUpperCase();
}

const WORD = /^(\P{L}*)(\p{L}+)(\P{L}*)$/u;

const restoreAccents = (value: string): string =>
  value
    .split(' ')
    .map((word) => {
      const parts = WORD.exec(word);
      if (!parts) return word;

      const accented = PT_ACCENTS[registryKey(parts[2])];
      return accented ? `${parts[1]}${accented}${parts[3]}` : word;
    })
    .join(' ');

/**
 * Texto do cadastro pronto para leitura: caixa corrigida e acentos devolvidos.
 * A acentuação só é aplicada quando o original está inteiramente em maiúsculas
 * — se veio com minúsculas, é texto digitado por alguém e não se mexe nele.
 */
export function humanizeRegistry(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const fromRegistry = trimmed === trimmed.toLocaleUpperCase('pt-BR');
  const titled = humanizeRegistryText(trimmed);

  return fromRegistry ? restoreAccents(titled) : titled;
}

/* ============ PERFIL ============ */

/** CNAE já formatado no padrão da Receita (8211-3/00) + descrição oficial. */
export interface CompanyActivity {
  code: string | null;
  description: string;
}

/** Endereço da sede. `null` onde a Receita não informou nada. */
export interface CompanyAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

export interface CompanyPartner {
  name: string;
  role: string | null;
}

/**
 * Tudo o que o site precisa saber sobre a empresa, já apresentável: nenhuma
 * string aqui está em CAIXA ALTA de banco de dados, e ausência é sempre `null`
 * (nunca string vazia), para o gerador de texto conseguir decidir com `??`.
 */
export interface CompanyProfile {
  /** Somente dígitos. */
  cnpj: string;
  /** 00.000.000/0000-00 — o formato que vai para a tela. */
  formattedCnpj: string;
  legalName: string;
  tradeName: string | null;
  /** Nome fantasia quando existe; senão, a razão social. É como o texto chama a empresa. */
  displayName: string;
  /** Situação cadastral em caixa alta, como a Receita classifica ('ATIVA'). */
  status: string;
  isActive: boolean;
  /** ISO 'YYYY-MM-DD' do início das atividades. */
  foundedAt: string | null;
  foundedYear: number | null;
  mainActivity: CompanyActivity | null;
  secondaryActivities: CompanyActivity[];
  legalNature: string | null;
  size: string | null;
  capital: number | null;
  phone: string | null;
  email: string | null;
  address: CompanyAddress;
  partners: CompanyPartner[];
}

const optional = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const humanized = (value: string | null | undefined): string | null => {
  const trimmed = optional(value);
  return trimmed ? humanizeRegistry(trimmed) : null;
};

/** Ano de abertura a partir de 'YYYY-MM-DD'; ignora datas fora do intervalo plausível. */
const readFoundedYear = (value: string | null): number | null => {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(value ?? '');
  if (!match) return null;

  const year = Number(match[1]);
  return year >= 1800 && year <= 2999 ? year : null;
};

/** CNPJInfo (contrato da BrasilAPI) → CompanyProfile (contrato do site). */
export function buildCompanyProfile(info: CNPJInfo): CompanyProfile {
  const legalName = humanizeRegistry(info.name);
  const tradeName = humanized(info.tradeName);
  const foundedAt = optional(info.foundedAt);

  const mainDescription = optional(info.mainActivity);

  return {
    cnpj: info.cnpj,
    formattedCnpj: formatCNPJ(info.cnpj),
    legalName,
    tradeName,
    displayName: tradeName ?? legalName,
    status: info.status,
    isActive: info.isActive,
    foundedAt,
    foundedYear: readFoundedYear(foundedAt),
    mainActivity: mainDescription
      ? { code: info.mainActivityCode, description: mainDescription }
      : null,
    secondaryActivities: info.secondaryActivities.map((activity) => ({
      code: activity.code,
      description: activity.description,
    })),
    legalNature: optional(info.legalNature),
    size: optional(info.size),
    capital: info.capital !== null && info.capital > 0 ? info.capital : null,
    phone: optional(info.phone),
    email: optional(info.email),
    address: {
      street: humanized(info.headquarters.street),
      // Número fica como veio: "S/N" viraria "S/n" se passasse pelo title case.
      number: optional(info.headquarters.number),
      complement: humanized(info.headquarters.complement),
      neighborhood: humanized(info.headquarters.neighborhood),
      city: humanized(info.headquarters.city),
      state: optional(info.headquarters.state)?.toUpperCase() ?? null,
      zipCode: optional(info.headquarters.zipCode)?.replace(/\D/g, '') || null,
    },
    partners: info.partners.map((partner) => ({
      name: humanizeRegistry(partner.name),
      role: optional(partner.role),
    })),
  };
}

/**
 * Relê `Site.registryData` (payload cru da BrasilAPI gravado na criação) sem
 * nova chamada de rede. É o caminho para regerar o conteúdo de um site antigo:
 * o dicionário snake_case mora num lugar só, em normalizeCNPJPayload.
 */
export function parseRegistryData(value: unknown): CompanyProfile | null {
  const info = normalizeCNPJPayload(value);
  return info ? buildCompanyProfile(info) : null;
}

/* ============ CONTEÚDO DO SITE ============ */

/*
 * ATENÇÃO: parseContent (components/site-templates/types.ts) é uma WHITELIST.
 * Toda chave escrita aqui precisa existir lá, senão some na leitura. A ordem
 * abaixo é a mesma do tipo SiteContent para facilitar a conferência lado a lado.
 */

/**
 * Perfil → `Site.content`. Escreve só o que existe: chave ausente é o sinal que
 * as seções usam para sumir da página, e chave com `undefined` viraria lixo no
 * Json do banco. Por isso cada campo é atribuído sob condição, em vez de um
 * objeto literal com metade dos valores `undefined`.
 *
 * Não gera `values` (as seções já têm um conjunto factual próprio para elas),
 * nem `businessHours` ou `website`: horário de atendimento e site institucional
 * não constam do cadastro público — inventá-los seria mentir na cara do
 * revisor da Meta.
 */
export function buildSiteContentFromProfile(profile: CompanyProfile): SiteContent {
  const copy = writeSiteCopy(profile);
  const { address } = profile;
  const content: SiteContent = {};

  /* Texto redigido. */
  if (copy.headline) content.headline = copy.headline;
  if (copy.tagline) content.tagline = copy.tagline;
  content.description = copy.description;
  if (copy.about) content.about = copy.about;
  if (copy.services.length > 0) content.services = copy.services;

  /* Cadastro. */
  // Nome fantasia igual à razão social só duplicaria a linha na ficha cadastral.
  if (
    profile.tradeName &&
    registryKey(profile.tradeName) !== registryKey(profile.legalName)
  ) {
    content.tradeName = profile.tradeName;
  }
  if (profile.mainActivity) {
    content.mainActivity = profile.mainActivity.description;
    if (profile.mainActivity.code) {
      content.mainActivityCode = profile.mainActivity.code;
    }
  }
  if (profile.legalNature) content.legalNature = profile.legalNature;
  if (profile.size) content.companySize = profile.size;
  if (profile.status) content.registryStatus = profile.status;
  if (profile.capital !== null) content.capital = profile.capital;
  if (profile.foundedAt) content.foundedAt = profile.foundedAt;

  if (profile.partners.length > 0) {
    content.partners = profile.partners.slice(0, 8).map((partner): SitePartner => ({
      name: partner.name,
      ...(partner.role ? { role: partner.role } : {}),
    }));
  }

  /* Endereço da sede. */
  if (address.street) content.street = address.street;
  if (address.number) content.number = address.number;
  if (address.complement) content.complement = address.complement;
  if (address.neighborhood) content.neighborhood = address.neighborhood;
  if (address.city) content.city = address.city;
  if (address.state) content.state = address.state;
  if (address.zipCode) content.zipCode = address.zipCode;

  /* Contato. */
  if (profile.phone) content.phone = profile.phone;
  if (profile.email) content.email = profile.email;

  return content;
}

/**
 * Atalho para quem acabou de consultar o CNPJ (createSite):
 * `content: siteContentToJson(buildSiteContent(info))`.
 */
export function buildSiteContent(info: CNPJInfo): SiteContent {
  return buildSiteContentFromProfile(buildCompanyProfile(info));
}

/** Mesmo conteúdo, reconstruído a partir do payload bruto já gravado. */
export function buildSiteContentFromRegistry(value: unknown): SiteContent | null {
  const profile = parseRegistryData(value);
  return profile ? buildSiteContentFromProfile(profile) : null;
}

/**
 * SiteContent → objeto Json aceito pelo Prisma sem cast. Percorre campo a campo
 * em vez de confiar num spread: assim nenhum `undefined` chega ao banco e uma
 * lista vazia não ocupa espaço na coluna.
 */
export function siteContentToJson(content: SiteContent): JsonObject {
  const json: JsonObject = {};

  for (const [key, value] of Object.entries(content)) {
    if (value === undefined) continue;

    if (typeof value === 'string' || typeof value === 'number') {
      json[key] = value;
      continue;
    }

    const items: JsonValue[] = [];
    for (const item of value) {
      const entry: JsonObject = {};
      for (const [field, text] of Object.entries(item)) {
        if (typeof text === 'string' && text.length > 0) entry[field] = text;
      }
      if (Object.keys(entry).length > 0) items.push(entry);
    }

    if (items.length > 0) json[key] = items;
  }

  return json;
}
