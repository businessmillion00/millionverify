import Link from 'next/link';
import type { SmsActivationStatus, SmsService } from '@prisma/client';
import { SMS_SERVICES, formatSmsTokens } from '@/lib/sms/catalog';
import { ACTIVATION_STATUS, ActivationStatusBadge } from '@/components/sms/status';
import { ServiceMark } from '@/components/sms/service-mark';

export type ActivationListItem = {
  id: string;
  service: SmsService;
  status: SmsActivationStatus;
  phoneDisplay: string | null;
  priceCents: number;
  refundedCents: number;
  hasCode: boolean;
  /** Pronto do servidor: formatar no cliente divergiria na hidratação. */
  createdAtLabel: string;
};

type Props = { items: ActivationListItem[] };

export function ActivationList({ items }: Props) {
  return (
    <ul className="rounded-2xl border border-dark-700 bg-white/[0.02] px-5 sm:px-6">
      {items.map((item) => {
        const open = ACTIVATION_STATUS[item.status].open;

        return (
          <li
            key={item.id}
            data-ativacao
            className="flex flex-wrap items-center gap-4 border-b border-white/5 py-4 last:border-0"
          >
            <ServiceMark service={item.service} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {SMS_SERVICES[item.service].label}
                {item.phoneDisplay && (
                  <span className="ml-2 font-mono text-dark-300 tabular-nums">
                    {item.phoneDisplay}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-dark-500 tabular-nums">
                {item.createdAtLabel}
                {item.hasCode && ' · código recebido'}
                {item.refundedCents > 0 &&
                  ` · ${formatSmsTokens(item.refundedCents)} tokens devolvidos`}
              </p>
            </div>

            {/* Em tela estreita o bloco desce para a linha de baixo, alinhado ao
                texto (padding = largura da marca + gap), em vez de espremer o nome. */}
            <div className="flex w-full items-center justify-between gap-4 pl-[3.5rem] sm:w-auto sm:justify-end sm:pl-0">
              <p className="text-sm font-semibold text-white tabular-nums">
                {formatSmsTokens(item.priceCents)}{' '}
                <span className="text-xs font-normal text-dark-500">tokens</span>
              </p>
              <ActivationStatusBadge status={item.status} />
              <Link
                href={`/dashboard/sms/${item.id}`}
                className="text-xs text-amber-400 transition-colors hover:text-amber-300"
              >
                {open ? 'Acompanhar' : 'Detalhes'}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
