import { useState } from 'react';
import { Icon, type IconName } from './Icon';
import { cx, Sheet } from './ui';

const LINKS: [string, string, IconName][] = [
  ['https://github.com/tyler-class/hsa-locker', 'HSA Locker on GitHub', 'github'],
  ['https://ko-fi.com/tylerclass', 'HSA Locker is free. Coffee is my love language ☕', 'coffee'],
  ['https://tylerclass.net', 'tylerclass.net', 'link'],
];

/** About HSA Locker: version, what it is, who built it, and links. */
export function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="About HSA Locker"
      sub={`Version ${__APP_VERSION__}`}
      closeButton
    >
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-base text-ink">
          HSA Locker keeps every medical receipt and EOB in one place and shows what you can still
          reimburse from your HSA. It runs on your own Cloudflare account, so your records stay
          yours.
        </p>
        <p className="text-sm text-soft">Built by Tyler Class. Not tax or medical advice.</p>
      </div>
      <div className="pt-3 pb-2">
        {LINKS.map(([href, label, icon]) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-3 border-t border-line py-3.5 text-base text-ink"
          >
            <Icon name={icon} size={18} className="flex-none text-accent" />
            <span className="flex-1">{label}</span>
            <Icon name="chevRight" size={16} className="flex-none text-faint" />
          </a>
        ))}
      </div>
    </Sheet>
  );
}

export function AboutButton({
  variant,
  className,
}: {
  variant: 'nav' | 'header';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          variant === 'nav'
            ? 'flex items-center gap-3 rounded-full px-3.5 py-2.5 text-left text-[15px] text-soft hover:bg-line/60'
            : 'inline-flex flex-none items-center gap-1.5 rounded-full bg-chip px-3.5 py-2 text-sm text-soft',
          className,
        )}
      >
        <Icon name="info" size={variant === 'nav' ? 20 : 16} />
        About HSA Locker
      </button>
      <AboutSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
