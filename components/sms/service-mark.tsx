import type { SmsService } from '@prisma/client';
import { SMS_SERVICES } from '@/lib/sms/catalog';
import { cn } from '@/lib/utils';

/** Traços simplificados das marcas, no estilo de linha do resto do painel. */
const GLYPHS: Record<SmsService, string> = {
  WHATSAPP:
    'M12 3.5a8.5 8.5 0 00-7.3 12.85L3.5 20.5l4.3-1.15A8.5 8.5 0 1012 3.5zM9.3 8.6c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.5l-.5.6c-.1.1-.2.3 0 .5a6 6 0 003 2.6c.2.1.4.1.5-.1l.7-.8c.1-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.4 0 .3-.1 1-.6 1.4-.5.4-1.2.6-2 .4a9.3 9.3 0 01-5.3-4.5c-.5-1-.4-2 .1-2.7l.4-.5z',
  TELEGRAM: 'M20.5 4.5L3.5 11l5.2 1.9L18 6.5l-7.5 7.8-.3 4.2 2.6-2.6 3.7 2.8 4-14.2z',
  GOOGLE:
    'M20 12.2c0-.6-.1-1.1-.2-1.6H12v3.1h4.5a3.9 3.9 0 01-1.7 2.6v2.1h2.7c1.6-1.5 2.5-3.6 2.5-6.2zM12 20c2.2 0 4-.7 5.4-2l-2.7-2.1a5 5 0 01-7.4-2.6H4.6v2.2A8 8 0 0012 20zM7.3 13.3a4.8 4.8 0 010-3.1V8H4.6a8 8 0 000 7.4l2.7-2.1zM12 7.2c1.2 0 2.3.4 3.1 1.2l2.4-2.4A8 8 0 004.6 8l2.7 2.2A4.8 4.8 0 0112 7.2z',
  FACEBOOK: 'M13.5 20.5v-7h2.4l.4-2.9h-2.8V8.8c0-.8.3-1.4 1.4-1.4h1.5V4.8a20 20 0 00-2.2-.1c-2.2 0-3.7 1.3-3.7 3.8v2.1H8v2.9h2.5v7h3z',
  INSTAGRAM:
    'M7.5 3.5h9a4 4 0 014 4v9a4 4 0 01-4 4h-9a4 4 0 01-4-4v-9a4 4 0 014-4zM12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM17 7h.01',
};

type Props = {
  service: SmsService;
  className?: string;
};

/** Marca do serviço em um chip colorido — só decoração, o nome vem ao lado. */
export function ServiceMark({ service, className }: Props) {
  const accent = SMS_SERVICES[service].accent;

  return (
    <span
      aria-hidden
      style={{ color: accent, backgroundColor: `${accent}1f`, boxShadow: `inset 0 0 0 1px ${accent}40` }}
      className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', className)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d={GLYPHS[service]} />
      </svg>
    </span>
  );
}
