import { z } from 'zod';

export const CreateSiteSchema = z.object({
  name: z.string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  companyName: z.string()
    .min(3, 'Razão social deve ter no mínimo 3 caracteres')
    .max(150, 'Razão social deve ter no máximo 150 caracteres'),
  cnpj: z.string()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{14}$/, 'CNPJ inválido'),
  description: z.string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .optional(),
  subdomain: z.string()
    .min(3, 'Subdomínio deve ter no mínimo 3 caracteres')
    .max(50, 'Subdomínio deve ter no máximo 50 caracteres')
    .regex(/^[a-z0-9-]+$/, 'Subdomínio pode conter apenas letras, números e hífen'),
  metaTag: z.string()
    .optional(),
  /*
   * Telefone de contato exibido no SITE do cliente. Opcional: sem ele, o
   * provisionamento cai no telefone registrado na Receita.
   * Aceita vazio para o usuário conseguir limpar o campo.
   */
  phone: z.string()
    .trim()
    .max(20, 'Telefone deve ter no máximo 20 caracteres')
    .refine(
      (valor) => valor === '' || /^\d{10,11}$/.test(valor.replace(/\D/g, '')),
      'Informe DDD e número, com 10 ou 11 dígitos',
    )
    .optional(),
});

export const UpdateSiteSchema = CreateSiteSchema.partial();

export type CreateSiteInput = z.infer<typeof CreateSiteSchema>;
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>;
