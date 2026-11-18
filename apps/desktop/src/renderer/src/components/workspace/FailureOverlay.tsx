import { ScrollText, X } from 'lucide-react';
import { shortTitle } from '../../lib/steps';
import { useApp } from '../../store/app';
import { useMessages } from '../../store/messages';
import { descriptorFor, usePipeline } from '../../store/pipeline';
import { Button, Callout } from '../../ui';

/** Floating error over the center view when the latest run failed. */
export function FailureOverlay() {
  const failure = usePipeline((s) => s.failure);
  const running = usePipeline((s) => s.running);
  const stages = usePipeline((s) => s.stages);
  const dismissed = useMessages((s) => s.dismissed);
  const dismiss = useMessages((s) => s.dismiss);
  const showLog = useApp((s) => s.showLog);
  if (!failure || running || dismissed.has(failure.id)) return null;
  const n = failure.notice;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-6">
      <div className="pointer-events-auto w-full max-w-[560px]" style={{ animation: 'sc-sheet-in var(--sc-duration-slow) var(--sc-ease-out)' }}>
        <Callout
          floating
          level="error"
          title={n.title}
          detail={n.detail}
          hint={n.hint}
          meta={shortTitle(descriptorFor(stages, failure.stageId), failure.key)}
          actions={
            <>
              <Button size="sm" variant="subtle" icon={ScrollText} onClick={() => showLog(failure.key)}>
                Show log
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => dismiss([failure.id])}>
                Dismiss
              </Button>
            </>
          }
        />
      </div>
    </div>
  );
}
