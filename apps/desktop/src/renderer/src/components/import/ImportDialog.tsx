import { File, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { usePipeline } from '../../store/pipeline';
import { Button, Dialog, EmptyState } from '../../ui';
import { ImportList } from './ImportList';
import { ImportSettings } from './ImportSettings';
import { sourceStep } from './settings';
import { TrimEditor } from './TrimEditor';
import { useImport } from './useImport';

const W = 1000;
const H = 580;

/** Review files before they are imported: remove, trim videos, choose settings. */
export function ImportDialog() {
  const s = useImport();
  const stages = usePipeline((p) => p.stages);
  const spec = usePipeline((p) => p.spec);
  if (!s.open) return null;

  const descriptor = sourceStep(stages, spec)?.descriptor;
  const item = s.items.find((i) => i.path === s.selected);
  const edit = s.kind === 'edit';
  const count = s.items.length;

  return (
    <Dialog
      open
      onClose={s.cancel}
      title={edit ? 'Trim video' : 'Import media'}
      help={edit ? 'Changing the range re-extracts frames from this video on the next run.' : 'Nothing is processed until you run the pipeline.'}
      width={Math.min(W, window.innerWidth - 48)}
      height={H}
      footer={
        <>
          <Button variant="ghost" onClick={s.cancel}>
            Cancel
          </Button>
          <Button variant="primary" minWidth={96} loading={s.busy} onClick={() => void s.confirm()} disabled={!count}>
            {edit ? 'Save' : `Add ${count}`}
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        <div className="scroll-stable w-[248px] shrink-0 border-r border-line bg-surface-1">
          <ImportList items={s.items} selected={s.selected} removable={!edit} onSelect={s.select} onRemove={s.remove} onPatch={s.patchItem} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {item?.kind === 'video' ? (
            <TrimEditor key={item.path} item={item} url={window.splatcraft.app.fileUrl(item.path)} onPatch={(p) => s.patchItem(item.path, p)} />
          ) : item?.kind === 'image' ? (
            <PhotoPreview key={item.path} url={window.splatcraft.app.fileUrl(item.path)} />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-viewport">
              <EmptyState icon={File} title="Not a photo or video" />
            </div>
          )}
        </div>
        <div className="scroll-stable w-[320px] shrink-0 border-l border-line bg-surface-1">
          <ImportSettings descriptor={descriptor} draft={s.draft} items={s.items} showMode={!edit} onDraft={s.setDraft} />
        </div>
      </div>
    </Dialog>
  );
}

/** Photo preview; formats Chromium can't decode (HEIC, DNG …) show a placeholder. */
function PhotoPreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-viewport">
      {failed ? <EmptyState icon={ImageIcon} title="No preview" /> : <img src={url} alt="" draggable={false} className="size-full object-contain" onError={() => setFailed(true)} />}
    </div>
  );
}
