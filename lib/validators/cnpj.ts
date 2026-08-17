import { z } from 'zod';

// Valida CNPJ com máscara ou sem
const isCNPJ = (value: string): boolean => {
  const cnpj = value.replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.substring(12);

  const checkDigit = (size: number): number => {
    let sum = 0;
    let pos = size - 7;
    for (let i = 0; i < size; i++) {
      sum += parseInt(cnpj.charAt(i), 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  if (checkDigit(12) !== parseInt(digits.charAt(0), 10)) return false;
  if (checkDigit(13) !== parseInt(digits.charAt(1), 10)) return false;

  return true;
};

export const CheckCNPJSchema = z.object({
  cnpj: z.string()
    .min(11, 'CNPJ inválido')
    .refine(isCNPJ, 'CNPJ inválido'),
});

export type CheckCNPJInput = z.infer<typeof CheckCNPJSchema>;
