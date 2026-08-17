import axios, { AxiosInstance } from 'axios';
import { TIMEOUTS } from '@/lib/constants';

// Códigos de situação cadastral da Receita Federal.
const SITUACAO_CADASTRAL: Record<number, string> = {
  1: 'NULA',
  2: 'ATIVA',
  3: 'SUSPENSA',
  4: 'INAPTA',
  8: 'BAIXADA',
};

/**
 * Valor serializável em coluna Json do Prisma. `raw` é tipado assim (e não como
 * Record<string, unknown>) para que `registryData: info.raw` seja aceito pelo
 * Prisma sem cast: `unknown` não é atribuível a InputJsonValue.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** CNAE já formatado no padrão da Receita: 8211-3/00. */
export interface CNPJActivity {
  code: string;
  description: string;
}

/** Sócio do quadro societário (qsa) — dado público do cadastro. */
export interface CNPJPartner {
  name: string;
  role: string | null;
}

/**
 * Contrato consumido por app/actions/site.ts, app/api/cnpj/route.ts,
 * types/index.ts e — via POST /api/cnpj — pelo Zod de
 * components/site-builder/step-cnpj.tsx. Os campos originais não podem ser
 * renomeados nem removidos: o assistente falha em silêncio se um deles sumir.
 * Tudo abaixo de `capital` é acréscimo e pode ser ignorado por quem já existia.
 */
export interface CNPJInfo {
  cnpj: string;
  name: string;
  tradeName: string | null;
  status: string;
  isActive: boolean;
  foundedAt: string | null;
  mainActivity: string | null;
  capital: number | null;
  headquarters: {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  /** CNAE principal com código; `mainActivity` continua sendo só a descrição. */
  mainActivityCode: string | null;
  secondaryActivities: CNPJActivity[];
  legalNature: string | null;
  /** Porte legível ("Microempresa"); null quando a Receita informa "DEMAIS". */
  size: string | null;
  phone: string | null;
  email: string | null;
  partners: CNPJPartner[];
  /** Payload íntegro da BrasilAPI, pronto para gravar em Site.registryData. */
  raw: JsonObject;
}

/* ============ LEITORES TOLERANTES ============ */

/*
 * A BrasilAPI omite campos conforme a empresa (email, ddd_telefone_1 e qsa
 * faltam com frequência) e alterna número/string em capital_social e nos
 * códigos de CNAE. Nada aqui usa `any` nem assume presença: campo ausente vira
 * null e a consulta segue.
 */

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asText = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const digits = value.replace(/[^\d,.-]/g, '').trim();
  if (!digits) return null;

  /*
   * capital_social chega como "250000.00" (ponto DECIMAL) na BrasilAPI e como
   * "250.000,00" (ponto de milhar) em respostas em formato pt-BR. A vírgula é o
   * que separa os dois casos — tratar todo ponto como milhar transformava
   * R$ 250.000,00 em R$ 25.000.000,00 na ficha cadastral do site.
   */
  const normalized = digits.includes(',')
    ? digits.replace(/\./g, '').replace(',', '.')
    : digits;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const digitsOf = (value: unknown): string => (asText(value) ?? '').replace(/\D/g, '');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Converte o payload em algo garantidamente serializável para o Prisma:
 * descarta undefined/função/símbolo e normaliza NaN e Infinity para null.
 */
const toJsonValue = (value: unknown): JsonValue | undefined => {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'object':
      break;
    default:
      return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item) ?? null);
  }

  if (value instanceof Date) return value.toISOString();

  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const parsed = toJsonValue(item);
    if (parsed !== undefined) result[key] = parsed;
  }
  return result;
};

const toJsonObject = (value: unknown): JsonObject => {
  const parsed = toJsonValue(value);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed
    : {};
};

/** 8211300 → "8211-3/00". Devolve os dígitos crus se não vierem os 7 esperados. */
export function formatCnaeCode(value: unknown): string | null {
  const digits = digitsOf(value);
  if (digits.length === 0 || Number(digits) === 0) return null;

  const padded = digits.padStart(7, '0');
  if (padded.length !== 7) return digits;

  return `${padded.slice(0, 4)}-${padded.slice(4, 5)}/${padded.slice(5)}`;
}

/**
 * `ddd_telefone_1` vem como "1155551234" (DDD colado) e às vezes com dois
 * números separados por "/" — fica só o primeiro, já formatado.
 */
export function formatBrazilPhone(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;

  const digits = (text.split('/')[0] ?? '').replace(/\D/g, '');

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 8 || digits.length === 9) {
    return `${digits.slice(0, digits.length - 4)}-${digits.slice(-4)}`;
  }

  return null;
}

/** "206-2 - Sociedade Empresária Limitada" → "Sociedade Empresária Limitada". */
const cleanLegalNature = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;

  return text.replace(/^\s*[\d.-]+\s*-\s*/, '').trim() || null;
};

/**
 * "DEMAIS" e "NAO INFORMADO" são categorias residuais da Receita: exibi-las no
 * site do cliente só produz ruído, então viram null e a copy simplesmente não
 * fala de porte.
 */
const cleanSize = (porte: unknown, codigo: unknown): string | null => {
  const code = digitsOf(codigo);
  const text = (asText(porte) ?? '').toUpperCase();

  if (code === '1' || code === '01' || text.startsWith('MICRO')) return 'Microempresa';
  if (code === '3' || code === '03' || text.includes('PEQUENO PORTE')) {
    return 'Empresa de pequeno porte';
  }
  return null;
};

/** "49-Sócio-Administrador" → "Sócio-Administrador". */
const cleanPartnerRole = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;

  return text.replace(/^\s*\d+\s*[-–]\s*/, '').trim() || null;
};

const readActivities = (value: unknown): CNPJActivity[] => {
  const activities: CNPJActivity[] = [];

  for (const item of asArray(value)) {
    const raw = asRecord(item);
    const description = asText(raw.descricao);
    const code = formatCnaeCode(raw.codigo);

    // Empresas sem CNAE secundário recebem um item vazio (codigo 0) na resposta.
    if (!description || !code) continue;
    activities.push({ code, description });
  }

  return activities;
};

const readPartners = (value: unknown): CNPJPartner[] => {
  const partners: CNPJPartner[] = [];

  for (const item of asArray(value)) {
    const raw = asRecord(item);
    const name = asText(raw.nome_socio) ?? asText(raw.nome);
    if (!name) continue;

    partners.push({
      name,
      role: cleanPartnerRole(raw.qualificacao_socio ?? raw.qualificacao),
    });
  }

  return partners;
};

/**
 * Payload cru da BrasilAPI → CNPJInfo. Fica exportada porque é a única
 * tradução de nomes snake_case do repo: lib/company/profile.ts a reaproveita
 * para reler Site.registryData sem duplicar o dicionário de campos.
 */
export function normalizeCNPJPayload(payload: unknown): CNPJInfo | null {
  const raw = asRecord(payload);

  const cnpj = digitsOf(raw.cnpj);
  const name = asText(raw.razao_social);

  // Sem razão social ou sem CNPJ não é uma resposta de empresa (é erro da API).
  if (cnpj.length !== 14 || !name) return null;

  const situacao = Number(digitsOf(raw.situacao_cadastral));
  const descricaoSituacao = asText(raw.descricao_situacao_cadastral);
  const email = asText(raw.email)?.toLowerCase() ?? null;

  return {
    cnpj,
    name,
    tradeName: asText(raw.nome_fantasia),
    status:
      SITUACAO_CADASTRAL[situacao] ?? descricaoSituacao?.toUpperCase() ?? 'DESCONHECIDA',
    isActive: situacao === 2,
    foundedAt: asText(raw.data_inicio_atividade),
    mainActivity: asText(raw.cnae_fiscal_descricao),
    capital: asNumber(raw.capital_social),
    headquarters: {
      street: asText(raw.logradouro) ?? '',
      number: asText(raw.numero) ?? '',
      complement: asText(raw.complemento) ?? '',
      neighborhood: asText(raw.bairro) ?? '',
      city: asText(raw.municipio) ?? '',
      state: asText(raw.uf) ?? '',
      zipCode: asText(raw.cep) ?? '',
    },
    mainActivityCode: formatCnaeCode(raw.cnae_fiscal),
    secondaryActivities: readActivities(raw.cnaes_secundarios),
    legalNature: cleanLegalNature(raw.natureza_juridica),
    size: cleanSize(raw.porte, raw.codigo_porte),
    phone: formatBrazilPhone(raw.ddd_telefone_1),
    email: email && EMAIL.test(email) ? email : null,
    partners: readPartners(raw.qsa),
    raw: toJsonObject(raw),
  };
}

class BrasilAPIService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.BRASIL_API_URL || 'https://brasilapi.com.br/api',
      timeout: TIMEOUTS.CNPJ_LOOKUP,
    });
  }

  async checkCNPJ(cnpj: string): Promise<CNPJInfo> {
    const cleanCNPJ = cnpj.replace(/\D/g, '');
    const { data } = await this.client.get<unknown>(`/cnpj/v1/${cleanCNPJ}`);

    const info = normalizeCNPJPayload(data);

    // Um 200 com corpo fora do formato é tão inútil quanto um 404: quem chama
    // já trata a exceção como "CNPJ não encontrado".
    if (!info) {
      throw new Error('Resposta inesperada da BrasilAPI para o CNPJ consultado');
    }

    return info;
  }
}

export const brasilAPIService = new BrasilAPIService();
