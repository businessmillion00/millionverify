import type { SmsActivationStatus } from '@prisma/client';

/** Rótulo e badge de cada estado — compartilhado por lista, painel e cartão. */
export const ACTIVATION_STATUS: Record<
  SmsActivationStatus,
  { label: string; badge: string; open: boolean }
> = {
  REQUESTING: { label: 'Pedindo número', badge: 'badge badge-warning', open: true },
  WAITING_CODE: { label: 'Aguardando SMS', badge: 'badge badge-warning', open: true },
  CODE_RECEIVED: { label: 'Código recebido', badge: 'badge badge-success', open: true },
  COMPLETED: { label: 'Concluída', badge: 'badge badge-success', open: false },
  CANCELLED: { label: 'Cancelada', badge: 'badge badge-info', open: false },
  EXPIRED: { label: 'Expirada', badge: 'badge badge-error', open: false },
  FAILED: { label: 'Falhou', badge: 'badge badge-error', open: false },
};

export function ActivationStatusBadge({ status }: { status: SmsActivationStatus }) {
  const meta = ACTIVATION_STATUS[status];
  return <span className={`${meta.badge} text-xs`}>{meta.label}</span>;
}
