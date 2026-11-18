import { FolderOpen, Import, Plus } from 'lucide-react';
import { useApp } from '../../store/app';
import { ActionButton, Kbd, Skeleton, Text } from '../../ui';
import { AppMark } from '../AppMark';
import { RecentList } from './RecentList';

export function WelcomeWindow() {
  const info = useApp((s) => s.info);
  const isMac = (info?.platform ?? 'darwin') === 'darwin';
  const mod = isMac ? '⌘' : 'Ctrl';
  const open = useApp((s) => s.openProject);
  const setNew = useApp((s) => s.setNewProjectOpen);

  return (
    <div className="drag relative flex h-full w-full items-center justify-center overflow-hidden bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: 'radial-gradient(900px 500px at 30% 20%, var(--sc-accent-softer), transparent 60%), radial-gradient(700px 400px at 90% 100%, var(--sc-info-soft), transparent 60%)',
        }}
      />
      <div
        className="relative flex h-full max-h-[520px] w-full max-w-[860px] overflow-hidden border-line-strong bg-surface-1 shadow-lg min-[880px]:rounded-xl min-[880px]:border"
        style={{ animation: 'sc-rise var(--sc-duration-slow) var(--sc-ease-out)' }}
      >
        {/* Left: identity + actions */}
        <section className="flex w-1/2 flex-col items-center bg-surface-2 px-12 pb-10 pt-14">
          <AppMark size={112} />
          <Text as="h1" size="3xl" weight="semibold" className="mt-5 tracking-[-0.02em]">
            SplatCraft
          </Text>
          <div className="mt-1 flex h-[18px] items-center">
            {info ? (
              <Text size="sm" tone="subtle" num>
                Version {info.version}
              </Text>
            ) : (
              <Skeleton width={80} height={12} />
            )}
          </div>
          <div className="mt-auto flex w-full flex-col gap-2">
            <ActionButton icon={Plus} title="New Project…" onClick={() => setNew(true)} shortcut={<Kbd>{mod}N</Kbd>} />
            <ActionButton icon={FolderOpen} title="Open Existing Project…" onClick={() => void open()} shortcut={<Kbd>{mod}O</Kbd>} />
            <ActionButton icon={Import} title="Import Dataset…" disabled tooltip="COLMAP / transforms.json import — coming in v0.2" />
          </div>
        </section>
        {/* Right: recents */}
        <section className="flex w-1/2 min-w-0 flex-col pt-10">
          <RecentList />
        </section>
      </div>
    </div>
  );
}
