import { ArrowDownToLine, Copy, Eraser } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../store/app';
import { usePipeline } from '../../store/pipeline';
import { cn, IconButton, Select } from '../../ui';

const MAX_RENDER = 1500;
const levelCls = { debug: 'text-fg-faint', info: 'text-fg-muted', warn: 'text-warning', error: 'text-danger' } as const;

export function LogConsole() {
  const logs = usePipeline((s) => s.logs);
  const runSteps = usePipeline((s) => s.runSteps);
  const clear = usePipeline((s) => s.clearLogs);
  const filter = useApp((s) => s.logFilter);
  const setFilter = useApp((s) => s.setLogFilter);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const keys = useMemo(() => Array.from(new Set([...runSteps.map((s) => s.key), ...logs.map((l) => l.key), ...(filter !== 'all' ? [filter] : [])])), [runSteps, logs, filter]);
  const shown = useMemo(() => (filter === 'all' ? logs : logs.filter((l) => l.key === filter)).slice(-MAX_RENDER), [logs, filter]);

  useLayoutEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);
  useEffect(() => setFollow(true), [filter]);

  const copy = () => void navigator.clipboard.writeText(shown.map((l) => `${new Date(l.t).toISOString()} [${l.key}] ${l.level.toUpperCase()} ${l.line}`).join('\n'));

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        <Select size="sm" width={140} value={filter} options={[{ value: 'all', label: 'All stages' }, ...keys.map((k) => ({ value: k, label: k }))]} onChange={setFilter} />
        <span className="tnum ml-2 text-2xs text-fg-faint">{shown.length.toLocaleString()} lines</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton icon={ArrowDownToLine} label="Follow" size="xs" active={follow} onClick={() => setFollow(!follow)} />
          <IconButton icon={Copy} label="Copy" size="xs" onClick={copy} />
          <IconButton icon={Eraser} label="Clear" size="xs" onClick={clear} />
        </div>
      </div>
      <div
        ref={box}
        className="scroll-stable min-h-0 flex-1 select-text px-3 py-1.5 font-mono text-2xs leading-[17px]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        {shown.map((l) => (
          <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="tnum shrink-0 text-fg-faint">{new Date(l.t).toLocaleTimeString(undefined, { hour12: false })}</span>
            <span className="w-14 shrink-0 ellipsis text-fg-subtle">{l.key}</span>
            <span className={cn('min-w-0', levelCls[l.level])}>{l.line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
