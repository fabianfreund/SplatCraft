import { ClipboardCopy, ClipboardPaste, Monitor, Moon, Palette, RefreshCw, RotateCcw, RotateCw, Settings2, SlidersHorizontal, Sparkle, Sun, Wrench } from 'lucide-react';
import type { UpdateState } from '@shared/api';
import { useApp, type SettingsSection, type UiMode } from '../../store/app';
import { pushMessage } from '../../store/messages';
import { useUpdates } from '../../store/updates';
import { ACCENTS, usePrefs, type Density, type DockMeters, type TextScale, type ThemePref } from '../../store/prefs';
import { Button, Dialog, Divider, Field, Kbd, Label, NavList, SegmentedControl, Switch, SwatchPicker, Text } from '../../ui';
import { ToolsSettings } from './ToolsSettings';

const SECTIONS = [
  { value: 'general' as const, label: 'General', icon: Settings2 },
  { value: 'appearance' as const, label: 'Appearance', icon: Palette },
  { value: 'tools' as const, label: 'Tools & Add-ons', icon: Wrench },
];

export function SettingsDialog() {
  const section = useApp((s) => s.settings);
  const setSection = useApp((s) => s.setSettings);
  return (
    <Dialog open={section !== null} onClose={() => setSection(null)} title="Settings" width={760} height={540}>
      <div className="flex h-full min-h-full">
        <div className="w-[188px] shrink-0 border-r border-line bg-surface-1 p-2">
          <NavList<SettingsSection> ariaLabel="Settings sections" value={section ?? 'general'} items={SECTIONS} onChange={setSection} />
        </div>
        <div className="min-w-0 flex-1 p-5">
          {section === 'general' && <GeneralSettings />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'tools' && <ToolsSettings />}
        </div>
      </div>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <Label className="mb-1">{title}</Label>
      {children}
    </section>
  );
}

function GeneralSettings() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const dockMeters = usePrefs((s) => s.dockMeters);
  const set = usePrefs((s) => s.set);
  return (
    <div className="flex flex-col gap-6">
      <Group title="Interface">
        <Field label="Mode" help="Simple shows the workflow and presets. Advanced adds the step inspector, per-step parameters, Monitor and Runs. Switching never changes your settings.">
          <SegmentedControl<UiMode>
            ariaLabel="Mode"
            size="sm"
            value={mode}
            options={[
              { value: 'simple', label: 'Simple', icon: Sparkle },
              { value: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
            ]}
            onChange={setMode}
          />
        </Field>
        <Field label="Status bar meters" help="Auto: GPU and VRAM in Simple mode, every meter in Advanced mode.">
          <SegmentedControl<DockMeters>
            ariaLabel="Status bar meters"
            size="sm"
            value={dockMeters}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'essential', label: 'Essential' },
              { value: 'all', label: 'All' },
            ]}
            onChange={(dockMeters) => set({ dockMeters })}
          />
        </Field>
      </Group>
      <UpdateSettings />
      <Group title="Shortcuts">
        <ShortcutRow label="Focus mode" keys={['\\']} />
        <ShortcutRow label="Settings" keys={['⌘', ',']} />
        <ShortcutRow label="New project" keys={['⌘', 'N']} />
        <ShortcutRow label="Open project" keys={['⌘', 'O']} />
      </Group>
    </div>
  );
}

const UPDATE_SLOT = 132;

function updateLabel(u: UpdateState | undefined): { text: string; tone: 'muted' | 'accent' | 'danger' } {
  if (!u) return { text: '', tone: 'muted' };
  switch (u.status) {
    case 'unsupported':
      return { text: `${u.version} · updates off in this build`, tone: 'muted' };
    case 'checking':
      return { text: 'Checking…', tone: 'muted' };
    case 'current':
      return { text: `${u.version} · up to date`, tone: 'muted' };
    case 'downloading':
      return { text: `Downloading ${u.available ?? ''} · ${Math.round((u.fraction ?? 0) * 100)}%`, tone: 'accent' };
    case 'ready':
      return { text: `${u.available} ready to install`, tone: 'accent' };
    case 'error':
      return { text: u.error ?? 'Update check failed', tone: 'danger' };
    default:
      return { text: u.version, tone: 'muted' };
  }
}

function UpdateSettings() {
  const u = useUpdates((s) => s.state);
  const check = useUpdates((s) => s.check);
  const setAuto = useUpdates((s) => s.setAuto);
  const install = useUpdates((s) => s.install);
  const off = !u || u.status === 'unsupported';
  const busy = u?.status === 'checking' || u?.status === 'downloading';
  const label = updateLabel(u);
  return (
    <Group title="Updates">
      <Field label="Version" help="New releases come from GitHub, download in the background and install when you quit or restart.">
        <Text size="xs" tone={label.tone} num truncate className="min-w-0 flex-1" title={label.text}>
          {label.text}
        </Text>
        {u?.status === 'ready' ? (
          <Button size="sm" variant="primary" icon={RotateCw} minWidth={UPDATE_SLOT} onClick={() => void install()}>
            Restart to update
          </Button>
        ) : (
          <Button size="sm" variant="subtle" icon={RefreshCw} minWidth={UPDATE_SLOT} disabled={off} loading={busy} onClick={() => void check()}>
            Check now
          </Button>
        )}
      </Field>
      <Field label="Check automatically" help="On launch and every few hours.">
        <Switch size="sm" label="Check automatically" checked={u?.auto ?? true} disabled={off} onChange={(auto) => void setAuto(auto)} />
      </Field>
    </Group>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <Field label={label}>
      <span className="flex gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </Field>
  );
}

function AppearanceSettings() {
  const p = usePrefs();
  const copy = async () => {
    await navigator.clipboard.writeText(p.exportTheme());
    pushMessage({ level: 'info', title: 'Theme copied to clipboard' });
  };
  const paste = async () => {
    try {
      const n = p.importTheme(await navigator.clipboard.readText());
      pushMessage({ level: 'info', title: `Theme imported (${n} tokens)` });
    } catch (e) {
      pushMessage({ level: 'error', title: 'Clipboard does not contain a theme', detail: String((e as Error).message ?? e) });
    }
  };
  const customTokens = Object.keys(p.tokens).length;
  return (
    <div className="flex flex-col gap-6">
      <Group title="Theme">
        <Field label="Appearance">
          <SegmentedControl<ThemePref>
            ariaLabel="Appearance"
            size="sm"
            value={p.theme}
            options={[
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'system', label: 'System', icon: Monitor },
            ]}
            onChange={(theme) => p.set({ theme })}
          />
        </Field>
        <Field label="Accent">
          <SwatchPicker ariaLabel="Accent" value={p.accent} options={ACCENTS} onChange={(accent) => p.set({ accent })} />
        </Field>
      </Group>
      <Group title="Layout">
        <Field label="Density" help="Control heights and panel sizes.">
          <SegmentedControl<Density>
            ariaLabel="Density"
            size="sm"
            value={p.density}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'default', label: 'Default' },
              { value: 'comfortable', label: 'Comfortable' },
            ]}
            onChange={(density) => p.set({ density, railW: undefined, drawerW: undefined })}
          />
        </Field>
        <Field label="Text size">
          <SegmentedControl<TextScale>
            ariaLabel="Text size"
            size="sm"
            value={p.textScale}
            options={[
              { value: 'sm', label: 'S' },
              { value: 'md', label: 'M' },
              { value: 'lg', label: 'L' },
            ]}
            onChange={(textScale) => p.set({ textScale })}
          />
        </Field>
        <Field label="Reduce motion">
          <Switch size="sm" label="Reduce motion" checked={p.reduceMotion} onChange={(reduceMotion) => p.set({ reduceMotion })} />
        </Field>
        <Field label="Reduce transparency" help="Solid surfaces instead of frosted glass for toolbars, menus and tooltips.">
          <Switch size="sm" label="Reduce transparency" checked={p.reduceTransparency} onChange={(reduceTransparency) => p.set({ reduceTransparency })} />
        </Field>
      </Group>
      <Divider />
      <Group title="Custom theme">
        <Field
          label={customTokens ? `${customTokens} custom tokens` : 'Tokens'}
          help='JSON with "accent", "theme" and a "tokens" map of --sc-* variables (see styles/tokens.css). Export, edit, paste back.'
        >
          <Button size="sm" variant="subtle" icon={ClipboardCopy} onClick={() => void copy()}>
            Copy
          </Button>
          <Button size="sm" variant="subtle" icon={ClipboardPaste} onClick={() => void paste()}>
            Paste
          </Button>
        </Field>
        <Field label="Defaults">
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={p.reset}>
            Reset appearance
          </Button>
        </Field>
      </Group>
    </div>
  );
}
