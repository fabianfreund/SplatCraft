/**
 * Living catalog of the ui/ primitives (open the renderer with `?kit`).
 * Use it to check a theme, accent or density change across every component.
 */
import { Aperture, Box, Camera, FastForward, Focus, Gauge, Gem, Images, Play, Plus, RotateCw, Settings2, Sparkle, Sparkles, Upload, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ACCENTS, usePrefs, type Density, type ThemePref } from '../store/prefs';
import {
  Badge,
  Button,
  Callout,
  ChipGroup,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Label,
  LoadingOverlay,
  NumberField,
  ProgressBar,
  RadioList,
  RangeSlider,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  StatusChip,
  StepperItem,
  SwatchPicker,
  Switch,
  Text,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  ToolbarToggleGroup,
} from '../ui';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4">
      <Label>{title}</Label>
      {children}
    </section>
  );
}

export function UiKit() {
  const p = usePrefs();
  const [seg, setSeg] = useState<'a' | 'b'>('a');
  const [chip, setChip] = useState<'all' | 'kept' | 'rejected'>('all');
  const [preset, setPreset] = useState<'fast' | 'balanced' | 'quality'>('balanced');
  const [on, setOn] = useState(true);
  const [num, setNum] = useState<number | undefined>(15000);
  const [slide, setSlide] = useState(0.4);
  const [range, setRange] = useState<[number, number]>([2, 7.5]);
  const [head, setHead] = useState(4);
  const [loading, setLoading] = useState(true);
  const [lay, setLay] = useState({ points: true, cameras: true, splat: false });
  const flip = (k: keyof typeof lay) => setLay((l) => ({ ...l, [k]: !l[k] }));
  return (
    <div className="scroll-stable h-full bg-bg p-6">
      <header className="mb-6 flex items-center gap-3">
        <Text size="xl" weight="semibold">
          SplatCraft UI kit
        </Text>
        <div className="ml-auto flex items-center gap-3">
          <SegmentedControl<ThemePref> size="sm" value={p.theme} onChange={(theme) => p.set({ theme })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
          <SegmentedControl<Density> size="sm" value={p.density} onChange={(density) => p.set({ density })} options={[{ value: 'compact', label: 'Compact' }, { value: 'default', label: 'Default' }, { value: 'comfortable', label: 'Comfortable' }]} />
          <SwatchPicker value={p.accent} options={ACCENTS} onChange={(accent) => p.set({ accent })} />
        </div>
      </header>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
        <Card title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Play}>Run all</Button>
            <Button icon={Plus}>Secondary</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Stop</Button>
            <Button loading>Busy</Button>
            <IconButton icon={Settings2} label="Icon button" />
            <IconButton icon={Box} label="Active" active />
          </div>
        </Card>
        <Card title="Selection">
          <SegmentedControl<'a' | 'b'> size="sm" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Gallery', icon: Images }, { value: 'b', label: 'Viewer', icon: Box }]} />
          <ChipGroup value={chip} onChange={setChip} chips={[{ value: 'all', label: 'All', count: 72 }, { value: 'kept', label: 'Kept', count: 62, tone: 'success' }, { value: 'rejected', label: 'Rejected', count: 10, tone: 'danger' }]} />
          <RadioList value={preset} onChange={setPreset} options={[{ value: 'fast', label: 'Fast', icon: Zap, meta: '~5 min' }, { value: 'balanced', label: 'Balanced', icon: Gauge, meta: '~20 min' }, { value: 'quality', label: 'Quality', icon: Gem, meta: '1 h+' }]} />
        </Card>
        <Card title="Form fields">
          <Field label="Name" help="Help lives in tooltips.">
            <Input size="sm" defaultValue="Ceramic Vase" />
          </Field>
          <Field label="Steps">
            <Slider value={slide} min={0} max={1} step={0.01} onChange={setSlide} changed />
            <NumberField value={num} onChange={setNum} integer />
          </Field>
          <Field label="Trim">
            <RangeSlider min={0} max={10} step={0.1} minGap={0.1} value={range} onChange={setRange} marker={head} onSeek={setHead} className="flex-1" />
          </Field>
          <Field label="Engine">
            <Select size="sm" className="flex-1" value="brush" onChange={() => undefined} options={[{ value: 'brush', label: 'Brush' }, { value: 'gsplat', label: 'gsplat' }]} />
          </Field>
          <Field label="Enabled">
            <Switch size="sm" checked={on} onChange={setOn} label="Enabled" />
          </Field>
        </Card>
        <Card title="Status">
          <div className="flex flex-wrap gap-1.5">
            <Badge>neutral</Badge>
            <Badge tone="accent" icon={Sparkle}>accent</Badge>
            <Badge tone="success">success</Badge>
            <Badge tone="warning">warning</Badge>
            <Badge tone="danger">danger</Badge>
            <Badge tone="info">info</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusChip status="idle" />
            <StatusChip status="running" fraction={0.42} />
            <StatusChip status="done" />
            <StatusChip status="error" />
          </div>
          <ProgressBar value={0.62} active />
          <div className="flex items-center gap-2">
            <Kbd>⌘</Kbd>
            <Kbd>,</Kbd>
            <Skeleton width={120} height={10} />
          </div>
        </Card>
        <Card title="Stepper">
          <div className="flex flex-col">
            <StepperItem index={1} title="Media" state="done" stat="72" doneBelow />
            <StepperItem index={2} title="Align" state="running" fraction={0.4} help="Camera alignment" />
            <StepperItem index={3} title="Train" state="idle" modified selected />
            <StepperItem index={4} title="Export" state="error" error="Disk full" last />
          </div>
        </Card>
        <Card title="Canvas toolbar">
          <div className="flex justify-center py-2">
            <Toolbar ariaLabel="Demo">
              <ToolbarToggleGroup
                items={[
                  { id: 'p', icon: Aperture, label: 'Points', active: lay.points, onToggle: () => flip('points') },
                  { id: 'c', icon: Camera, label: 'Cameras', active: lay.cameras, onToggle: () => flip('cameras') },
                  { id: 's', icon: Sparkles, label: 'Splat', active: lay.splat, onToggle: () => flip('splat') },
                ]}
              />
              <ToolbarDivider />
              <ToolbarButton icon={Focus} label="Reset view" />
              <ToolbarButton icon={RotateCw} label="Retrain" />
              <ToolbarButton icon={FastForward} label="Train longer" />
              <ToolbarDivider />
              <ToolbarButton icon={Play} label="Train" text="Train" tone="primary" />
            </Toolbar>
          </div>
        </Card>
        <Card title="Loading">
          <div className="relative h-40 overflow-hidden rounded-md bg-[linear-gradient(135deg,var(--sc-surface-3),var(--sc-accent-soft))]">
            <div className="grid grid-cols-4 gap-2 p-3">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-12 rounded-sm bg-surface-4" />
              ))}
            </div>
            <LoadingOverlay show={loading} label="Loading splat" progress={0.42} delay={0} />
          </div>
          <Button size="sm" onClick={() => setLoading((v) => !v)}>
            Toggle
          </Button>
        </Card>
        <Card title="Feedback">
          <Callout level="warning" title="10 frames are blurry" hint="Keep the camera steady or raise the shutter speed." />
          <Callout level="error" title="Alignment failed" detail="Only 12 of 72 images registered." compact />
          <EmptyState icon={Upload} title="Drop Photos or Videos" size="sm" />
        </Card>
      </div>
    </div>
  );
}
