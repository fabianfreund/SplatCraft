import { useId } from 'react';

/**
 * SplatCraft mark: four anisotropic gaussians forming a cross, with
 * soft falloff, on a dark rounded tile. Colors come from tokens.
 */
export function AppMark({ size = 96, tile = true }: { size?: number; tile?: boolean }) {
  const id = useId().replace(/:/g, '');
  const g = `g${id}`;
  const c = `c${id}`;
  const bg = `b${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden>
      <defs>
        <radialGradient id={g} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--sc-accent-strong)" stopOpacity="1" />
          <stop offset="0.45" stopColor="var(--sc-accent)" stopOpacity="0.75" />
          <stop offset="1" stopColor="var(--sc-accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={c} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--sc-fg)" stopOpacity="1" />
          <stop offset="0.5" stopColor="var(--sc-accent-strong)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--sc-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--sc-surface-4)" />
          <stop offset="1" stopColor="var(--sc-bg)" />
        </linearGradient>
      </defs>
      {tile && (
        <>
          <rect x="6" y="6" width="116" height="116" rx="28" fill={`url(#${bg})`} />
          <rect x="6.5" y="6.5" width="115" height="115" rx="27.5" fill="none" stroke="var(--sc-line-strong)" />
        </>
      )}
      <g transform="translate(64 64)" style={{ mixBlendMode: 'screen' }}>
        {[45, 135].map((rot) => (
          <g key={rot} transform={`rotate(${rot})`}>
            <ellipse cx="-22" cy="0" rx="26" ry="9.5" fill={`url(#${g})`} />
            <ellipse cx="22" cy="0" rx="26" ry="9.5" fill={`url(#${g})`} />
          </g>
        ))}
        <ellipse cx="0" cy="0" rx="13" ry="13" fill={`url(#${c})`} />
        <ellipse cx="-30" cy="-30" rx="5" ry="3" transform="rotate(45 -30 -30)" fill={`url(#${c})`} opacity="0.6" />
        <ellipse cx="31" cy="31" rx="5" ry="3" transform="rotate(45 31 31)" fill={`url(#${c})`} opacity="0.5" />
      </g>
    </svg>
  );
}
