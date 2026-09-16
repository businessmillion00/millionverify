import { z } from 'zod';
import { SMS_CONVERT_MAX, SMS_CONVERT_MIN } from '@/lib/sms/catalog';

/** Espelha o enum `SmsService` do Prisma; o catálogo garante que cada valor tem preço. */
export const SmsServiceSchema = z.enum(['FACEBOOK', 'WHATSAPP', 'TELEGRAM', 'INSTAGRAM', 'GOOGLE']);

/** O cliente escolhe só o SERVIÇO. O preço sai do catálogo no servidor. */
export const RequestSmsNumberSchema = z.object({
  service: SmsServiceSchema,
});

export const SmsActivationIdSchema = z.object({
  activationId: z.string().cuid('Ativação inválida'),
});

/**
 * Quantos tokens de SITE converter. A taxa (1 → 25) é constante do servidor;
 * o formulário só manda a quantidade.
 */
export const ConvertTokensSchema = z.object({
  tokens: z.coerce
    .number()
    .int('Informe um número inteiro de tokens.')
    .min(SMS_CONVERT_MIN, `Converta ao menos ${SMS_CONVERT_MIN} token.`)
    .max(SMS_CONVERT_MAX, `Máximo de ${SMS_CONVERT_MAX} tokens por conversão.`),
});

export type RequestSmsNumberInput = z.infer<typeof RequestSmsNumberSchema>;
export type ConvertTokensInput = z.infer<typeof ConvertTokensSchema>;
