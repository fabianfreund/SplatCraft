import { useRef, useState } from 'react';
import { formatRelative } from '../../lib/format';
import { worstLevel } from '../../store/messages';
import type { NoticeItem } from '../../store/pipeline';
import { LevelDot, MessageList, Popover, Tooltip } from '../../ui';

/** Level dot on a stepper row → popover with that step's notices. */
export function StepNotices({ title, items }: { title: string; items: NoticeItem[] | undefined }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const level = worstLevel(items);
  if (!level || !items) return null;
  const sorted = [...items].sort((a, b) => ({ error: 0, warning: 1, info: 2 })[a.notice.level] - ({ error: 0, warning: 1, info: 2 })[b.notice.level]);
  return (
    <>
      <Tooltip content={sorted[0].notice.title} side="right">
        <LevelDot buttonRef={anchor} level={level} count={items.length} label={`${title}: ${items.length} messages`} onClick={() => setOpen(!open)} />
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={360}>
        <div className="p-2.5">
          <MessageList
            groups={[
              {
                id: 'step',
                label: title,
                items: sorted.map((n) => ({ id: n.id, level: n.notice.level, title: n.notice.title, detail: n.notice.detail, hint: n.notice.hint, meta: n.at ? formatRelative(n.at) : undefined })),
              },
            ]}
          />
        </div>
      </Popover>
    </>
  );
}
