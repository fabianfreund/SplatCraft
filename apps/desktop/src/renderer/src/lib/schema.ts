/**
 * Minimal JSON-Schema → form-field mapping for stage params
 * (`z.toJSONSchema(schema, { io: 'input' })` output).
 */
import { humanize } from './format';

export type FieldKind = 'number' | 'integer' | 'boolean' | 'enum' | 'string' | 'tags' | 'unknown';

export interface FieldSpec {
  key: string;
  title: string;
  description?: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default?: unknown;
}

type JS = Record<string, any>;

const BIG = 1e12;

function unwrap(s: JS): JS {
  if (!s || typeof s !== 'object') return {};
  const alt = (s.anyOf ?? s.oneOf) as JS[] | undefined;
  if (Array.isArray(alt)) {
    const consts = alt.filter((a) => a && 'const' in a).map((a) => String(a.const));
    if (consts.length === alt.length && consts.length) return { ...s, type: 'string', enum: consts };
    const first = alt.find((a) => a && a.type !== 'null') ?? {};
    return { ...first, description: s.description ?? first.description, default: s.default ?? first.default, title: s.title ?? first.title };
  }
  if (Array.isArray(s.type)) return { ...s, type: s.type.find((t: string) => t !== 'null') };
  return s;
}

function bound(v: unknown): number | undefined {
  return typeof v === 'number' && Math.abs(v) < BIG ? v : undefined;
}

/** Keys rendered elsewhere (e.g. frame include/exclude in the media grid). */
export const HIDDEN_PARAM_KEYS = new Set(['excluded', 'included']);

export function fieldsFromSchema(schema: unknown): FieldSpec[] {
  const root = unwrap(schema as JS);
  const props = (root.properties ?? {}) as Record<string, JS>;
  return Object.entries(props)
    .filter(([key]) => !HIDDEN_PARAM_KEYS.has(key))
    .map(([key, raw]) => {
      const s = unwrap(raw);
      const base = { key, title: s.title ?? humanize(key), description: s.description, default: s.default };
      if (Array.isArray(s.enum)) return { ...base, kind: 'enum' as const, options: s.enum.map(String) };
      switch (s.type) {
        case 'boolean':
          return { ...base, kind: 'boolean' as const };
        case 'integer':
        case 'number': {
          const min = bound(s.minimum) ?? (bound(s.exclusiveMinimum) !== undefined ? s.exclusiveMinimum : undefined);
          const max = bound(s.maximum) ?? (bound(s.exclusiveMaximum) !== undefined ? s.exclusiveMaximum : undefined);
          const integer = s.type === 'integer';
          const step = bound(s.multipleOf) ?? (integer ? 1 : min !== undefined && max !== undefined ? niceStep(max - min) : undefined);
          return { ...base, kind: integer ? ('integer' as const) : ('number' as const), min, max, step };
        }
        case 'string':
          return { ...base, kind: 'string' as const };
        case 'array':
          return { ...base, kind: unwrap(s.items ?? {}).type === 'string' ? ('tags' as const) : ('unknown' as const) };
        default:
          return { ...base, kind: 'unknown' as const };
      }
    });
}

function niceStep(range: number): number {
  const raw = range / 200;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}
