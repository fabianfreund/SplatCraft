import { Inbox } from 'lucide-react';
import { Callout, type CalloutProps } from './Callout';
import { EmptyState } from './EmptyState';
import { Label } from './Text';

export interface MessageGroup {
  id: string;
  label?: string;
  items: (CalloutProps & { id: string })[];
}

/** Callouts grouped under small labels (e.g. per pipeline step). */
export function MessageList({ groups, compact = true, emptyTitle = 'No Messages' }: { groups: MessageGroup[]; compact?: boolean; emptyTitle?: string }) {
  const nonEmpty = groups.filter((g) => g.items.length);
  if (!nonEmpty.length) return <EmptyState icon={Inbox} title={emptyTitle} size="sm" className="py-8" />;
  return (
    <div className="flex flex-col gap-3">
      {nonEmpty.map((g) => (
        <section key={g.id} className="flex flex-col gap-1.5">
          {g.label && <Label className="px-0.5">{g.label}</Label>}
          {g.items.map(({ id, ...c }) => (
            <Callout key={id} compact={compact} {...c} />
          ))}
        </section>
      ))}
    </div>
  );
}
