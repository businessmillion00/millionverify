import { z } from 'zod';
import { TOKEN_MAX_PURCHASE, TOKEN_MIN_PURCHASE } from '@/lib/constants';

/**
 * O cliente informa só a QUANTIDADE. O preço sai de `tokenOrder` no servidor —
 * aceitar valor vindo do formulário permitiria pagar o que se quisesse.
 */
export const CreatePaymentSchema = z.object({
  tokens: z.coerce
    .number()
    .int('Informe um número inteiro de tokens.')
    .min(TOKEN_MIN_PURCHASE, `Mínimo de ${TOKEN_MIN_PURCHASE} token.`)
    .max(TOKEN_MAX_PURCHASE, `Máximo de ${TOKEN_MAX_PURCHASE} tokens por compra.`),
});

export const AsaasWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.string(),
    customer: z.string().optional(),
    subscription: z.string().optional(),
    dateCreated: z.string(),
    value: z.number(),
    netValue: z.number().optional(),
    status: z.enum(['PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'DELETED']),
    dueDate: z.string(),
    originalDueDate: z.string(),
    paymentDate: z.string().optional(),
    clientPaymentDate: z.string().optional(),
    installmentNumber: z.number().optional(),
    transactionReceiptUrl: z.string().optional(),
    nossoNumero: z.string().optional(),
    description: z.string().optional(),
    externalReference: z.string().optional(),
    objectId: z.string().optional(),
  }),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
export type AsaasWebhookInput = z.infer<typeof AsaasWebhookSchema>;
