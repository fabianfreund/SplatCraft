import { Bell, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatRelative } from '../../lib/format';
import { shortTitle } from '../../lib/steps';
import { useAllMessages, useMessages, useUnreadCount } from '../../store/messages';
import { descriptorFor, usePipeline } from '../../store/pipeline';
import { Button, IconButton, Label, MessageList, Popover } from '../../ui';

/** Top-bar bell with a fixed-size unread badge → all project messages. */
export function MessagesButton() {
  const all = useAllMessages();
  const unread = useUnreadCount();
  const markRead = useMessages((s) => s.markRead);
  const dismiss = useMessages((s) => s.dismiss);
  const stages = usePipeline((s) => s.stages);
  const spec = usePipeline((s) => s.spec);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  const stepTitle = (key?: string, stageId?: string) => {
    if (!key) return 'App';
    const st = spec?.steps.find((x) => x.key === key);
    return shortTitle(descriptorFor(stages, st?.stageId ?? stageId ?? ''), key);
  };

  const toggle = () => {
    if (!open) markRead(all.map((m) => m.id));
    setOpen(!open);
  };

  return (
    <>
      <span ref={anchor} className="relative inline-flex">
        <IconButton icon={Bell} label="Messages" size="md" active={open} onClick={toggle} tooltipSide="bottom" />
        <span
          aria-hidden
          className={`tnum pointer-events-none absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-danger px-[3px] text-[9px] font-bold leading-none text-accent-ink transition-opacity duration-150 ${unread ? 'opacity-100' : 'opacity-0'}`}
        >
          {unread > 9 ? '9+' : unread || ''}
        </span>
      </span>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={400} align="end">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
          <Label>Messages</Label>
          <span className="tnum text-2xs text-fg-faint">{all.length || ''}</span>
          <div className="ml-auto">
            <Button size="sm" variant="ghost" icon={Trash2} disabled={!all.length} onClick={() => dismiss(all.map((m) => m.id))}>
              Clear
            </Button>
          </div>
        </div>
        <div className="p-2.5">
          <MessageList
            groups={[
              {
                id: 'all',
                items: all.map((m) => ({
                  id: m.id,
                  level: m.level,
                  title: m.title,
                  detail: m.detail,
                  hint: m.hint,
                  meta: `${stepTitle(m.key, m.stageId)}${m.at ? ` · ${formatRelative(m.at)}` : ''}`,
                })),
              },
            ]}
          />
        </div>
      </Popover>
    </>
  );
}
