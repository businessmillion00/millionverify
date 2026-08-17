export const TOKENS_PER_SITE = 10;

export const TOKEN_PACKAGES = {
  '100': { tokens: 100, price: 29.9 },
  '500': { tokens: 500, price: 119.9 },
  '2000': { tokens: 2000, price: 399.9, popular: true },
  '5000': { tokens: 5000, price: 799.9 },
} as const;

export type TokenPackageKey = keyof typeof TOKEN_PACKAGES;

/** Preço por token do menor pacote — a régua contra a qual o desconto existe. */
const BASE_UNIT_PRICE = TOKEN_PACKAGES['100'].price / TOKEN_PACKAGES['100'].tokens;

/**
 * Deriva o desconto do preço real em vez de guardá-lo à parte.
 * Guardado à parte, os dois divergem silenciosamente — era o caso aqui:
 * os valores fixos diziam 8/17/27% quando os preços entregavam 20/33/47%.
 */
export function packageEconomics(key: TokenPackageKey) {
  const { tokens, price } = TOKEN_PACKAGES[key];
  const unitPrice = price / tokens;
  const listPrice = tokens * BASE_UNIT_PRICE;

  return {
    tokens,
    price,
    unitPrice,
    listPrice,
    savings: listPrice - price,
    discount: 1 - unitPrice / BASE_UNIT_PRICE,
    sites: Math.floor(tokens / TOKENS_PER_SITE),
    popular: 'popular' in TOKEN_PACKAGES[key],
  };
}

export const SITE_RATE_LIMITS = {
  CREATE: 5, // máximo de sites por dia
  CHECK_CNPJ: 50, // máximo de verificações de CNPJ por dia
  CHECK_META_TAG: 100, // máximo de checks de meta tag por dia
} as const;

export const TIMEOUTS = {
  CNPJ_LOOKUP: 10000, // 10s para consulta de CNPJ
  META_TAG_CHECK: 15000, // 15s para verificar meta tag
  ASAAS_PAYMENT: 30000, // 30s para criar pagamento
} as const;

export const ASAAS_CONFIG = {
  WEBHOOK_TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

export const APP_CONFIG = {
  NAME: 'Business Million',
  DESCRIPTION: 'Verificador de Business Managers e Gerador de Sites',
  DOMAIN: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  SUBDOMAIN_SUFFIX: '.businessmillion.app',
} as const;
