import type { PresetId } from '@shared/api';
import { Gauge, Gem, Zap, type LucideIcon } from 'lucide-react';

export const PRESETS: { id: PresetId; title: string; icon: LucideIcon; meta: string; help: string }[] = [
  { id: 'fast', title: 'Fast', icon: Zap, meta: '~5 min', help: 'Quick preview: fewer frames, lower resolution and a short training.' },
  { id: 'balanced', title: 'Balanced', icon: Gauge, meta: '~20 min', help: 'Good quality for most captures.' },
  { id: 'quality', title: 'Quality', icon: Gem, meta: '1 h+', help: 'Maximum detail: more frames, exhaustive matching and long training.' },
];
