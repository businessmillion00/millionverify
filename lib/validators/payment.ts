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

/**
 * Cobrança como chega no webhook do Asaas.
 *
 * Só `id`, `value` e `status` são exigidos: é o que o razão usa para achar a
 * cobrança, conferir o valor e decidir entre crédito, estorno e falha. Todo o
 * resto é `nullish` porque o Asaas manda `null` no campo vazio
 * (`externalReference: null`, `paymentDate: null`, `subscription: null`), e
 * `.optional()` rejeita `null`.
 *
 * `status` é string livre, não enum: chargeback, análise de risco e recebimento
 * em dinheiro chegam com valores fora dos seis básicos, e reprovar o payload
 * faria o Asaas reentregar até interromper a fila.
 */
export const AsaasWebhookPaymentSchema = z.object({
  id: z.string().min(1),
  customer: z.string().nullish(),
  subscription: z.string().nullish(),
  dateCreated: z.string().nullish(),
  value: z.number(),
  netValue: z.number().nullish(),
  status: z.string().min(1),
  dueDate: z.string().nullish(),
  originalDueDate: z.string().nullish(),
  paymentDate: z.string().nullish(),
  clientPaymentDate: z.string().nullish(),
  installmentNumber: z.number().nullish(),
  transactionReceiptUrl: z.string().nullish(),
  nossoNumero: z.string().nullish(),
  description: z.string().nullish(),
  externalReference: z.string().nullish(),
  objectId: z.string().nullish(),
});

/**
 * Envelope do webhook. A cobrança vem na chave `payment` — é assim que o Asaas
 * documenta e envia. Até 16/09/2026 este schema exigia `data`, então TODO
 * webhook real era recusado com 400 "Invalid payload": nenhum pagamento era
 * creditado na hora e a fila de webhooks do Asaas acabava interrompida.
 *
 * `data` continua aceito só por compatibilidade com o formato antigo (testes e
 * chamadas manuais). Use `webhookPayment()` para ler a cobrança.
 */
export const AsaasWebhookSchema = z
  .object({
    event: z.string().min(1),
    payment: AsaasWebhookPaymentSchema.optional(),
    data: AsaasWebhookPaymentSchema.optional(),
  })
  .refine((body) => body.payment !== undefined || body.data !== undefined, {
    message: 'Webhook sem a cobrança (chave "payment")',
    path: ['payment'],
  });

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
export type AsaasWebhookInput = z.infer<typeof AsaasWebhookSchema>;
export type AsaasWebhookPayment = z.infer<typeof AsaasWebhookPaymentSchema>;

/** A cobrança do webhook, venha ela em `payment` (formato do Asaas) ou em `data`. */
export function webhookPayment(body: AsaasWebhookInput): AsaasWebhookPayment {
  // O refine garante que ao menos uma das duas existe.
  return (body.payment ?? body.data) as AsaasWebhookPayment;
}
