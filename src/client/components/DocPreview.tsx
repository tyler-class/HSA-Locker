import { useQuery } from '@tanstack/react-query';
import type { DocumentSummary } from '@shared/types';
import { Icon } from './Icon';
import { cx } from './ui';

/** The original file, shown inline: PDFs in a frame, images as images, email bodies as text. */
export function DocPreview({ doc, className }: { doc: DocumentSummary; className?: string }) {
  const src = `/api/files/${doc.id}`;
  const isText = doc.mime.startsWith('text/');
  const text = useQuery({
    queryKey: ['doc-text', doc.id],
    enabled: isText,
    queryFn: async () => (await fetch(src, { credentials: 'same-origin' })).text(),
    staleTime: Infinity,
  });
  const box = cx('w-full overflow-hidden rounded-xl border border-line bg-surface', className);
  if (doc.status === 'discarded')
    return <div className={cx(box, 'p-6 text-sm text-soft')}>Discarded.</div>;
  if (doc.mime === 'application/pdf')
    return <iframe title={doc.filename} src={src} className={cx(box, 'h-[70vh] min-h-[420px]')} />;
  if (doc.mime.startsWith('image/') && !/hei[cf]/.test(doc.mime))
    return (
      <a href={src} target="_blank" rel="noreferrer" className={cx(box, 'block')}>
        <img src={src} alt={doc.filename} className="h-auto w-full object-contain" />
      </a>
    );
  if (isText)
    return (
      <pre
        className={cx(
          box,
          'max-h-[70vh] overflow-auto p-4 font-sans text-sm whitespace-pre-wrap text-ink',
        )}
      >
        {text.data ?? 'Loading…'}
      </pre>
    );
  return (
    <a
      href={`${src}?download=1`}
      className={cx(box, 'flex items-center gap-3 p-5 text-sm text-ink')}
    >
      <Icon name="file" className="text-accent" />
      {doc.filename}: this file type can’t be previewed. Download it.
    </a>
  );
}
