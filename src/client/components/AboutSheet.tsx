import { useState } from 'react';
import { aboutLinks, BUILT_BY, type AboutLinkKind } from '../kit/about';
import { Icon, type IconName } from './Icon';
import { cx, Sheet } from './ui';

const LINKS = aboutLinks({
  title: 'HSA Locker',
  repo: 'tyler-class/HSA-Locker',
  email: 'hsalocker@tylerclass.net',
  coffee: '$0 deductible. Buy me a coffee ☕',
});
const ICONS: Record<AboutLinkKind, IconName> = {
  github: 'github',
  email: 'mail',
  coffee: 'coffee',
  site: 'link',
};

/** About HSA Locker: version, what it is, who built it, and links (Selfhost Kit layout). */
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
          yours. Not tax or medical advice.
        </p>
        <p className="text-sm text-soft">{BUILT_BY}</p>
      </div>
      <div className="pt-3 pb-2">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
            className="group flex w-full items-center gap-3 border-t border-line py-3.5 text-base text-ink"
          >
            <Icon name={ICONS[l.kind]} size={18} className="flex-none text-accent" />
            <span className="flex-1 underline-offset-4 group-hover:underline">{l.label}</span>
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
