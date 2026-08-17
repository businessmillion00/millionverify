import { z } from 'zod';

export const CreatePaymentSchema = z.object({
  tokensPackage: z.enum(['100', '500', '2000', '5000']),
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
