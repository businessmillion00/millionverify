import Link from 'next/link';
import type { PaymentStatus } from '@prisma/client';
import { formatCurrency } from '@/lib/utils';

export type PaymentHistoryItem = {
  id: string;
  amount: number;
  tokens: number;
  status: PaymentStatus;
  description: string;
  /** Datas chegam prontas do server component: formatar no cliente causa hydration mismatch. */
  createdAtLabel: string;
  paidAtLabel: string | null;
};

const STATUS_BADGE: Record<PaymentStatus, { label: string; className: string }> = {
  CONFIRMED: { label: 'Confirmado', className: 'badge badge-success' },
  PENDING: { label: 'Aguardando PIX', className: 'badge badge-warning' },
  FAILED: { label: 'Falhou', className: 'badge badge-error' },
  REFUNDED: { label: 'Estornado', className: 'badge badge-info' },
};

type Props = { payments: PaymentHistoryItem[] };

export function PaymentHistory({ payments }: Props) {
  if (payments.length === 0) {
    return <p className="mt-6 text-dark-400">Você ainda não fez nenhuma compra.</p>;
  }

  return (
    <div className="card mt-8 overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-widest text-dark-500">
          <tr className="border-b border-dark-700">
            <th className="p-4">Cobrança</th>
            <th className="p-4">Valor</th>
            <th className="p-4">Tokens</th>
            <th className="p-4">Status</th>
            <th className="p-4">Data</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const badge = STATUS_BADGE[payment.status];

            return (
              <tr key={payment.id} className="border-b border-dark-800 last:border-0">
                <td className="p-4">
                  <p className="font-medium">{payment.description}</p>
                  <p className="text-xs text-dark-500">#{payment.id.slice(0, 8)}</p>
                </td>

                <td className="p-4 tabular-nums">{formatCurrency(payment.amount)}</td>

                <td className="p-4 tabular-nums text-dark-300">
                  {payment.tokens.toLocaleString('pt-BR')}
                </td>

                <td className="p-4">
                  <span className={badge.className}>{badge.label}</span>
                  {payment.status === 'PENDING' && (
                    <Link
                      href={`/dashboard/billing/${payment.id}`}
                      className="ml-3 text-xs text-amber-400 hover:underline"
                    >
                      Ver PIX
                    </Link>
                  )}
                </td>

                <td className="p-4 tabular-nums text-dark-400">
                  {payment.createdAtLabel}
                  {payment.paidAtLabel && (
                    <span className="block text-xs text-dark-500">
                      Pago em {payment.paidAtLabel}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
