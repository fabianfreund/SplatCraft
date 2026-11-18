/**
 * App-wide scroll polish for every `.scroll-stable` element, with no wrapper needed:
 * - `--sc-fade-top/bottom` → edge fades only where content is hidden
 * - `data-scrolling` while scrolling → the overlay-style scrollbar shows
 */
const FADE = '18px';
const timers = new WeakMap<Element, number>();
const observed = new WeakSet<Element>();
/** Scroller → the first child currently observed for content growth. */
const child = new WeakMap<Element, Element>();
const scrollerOf = (el: Element) => (el.classList.contains('scroll-stable') ? el : el.parentElement);

function update(el: HTMLElement) {
  const top = el.scrollTop > 1;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  el.style.setProperty('--sc-fade-top', top ? FADE : '0px');
  el.style.setProperty('--sc-fade-bottom', bottom ? FADE : '0px');
}

export function bindScrollPolish() {
  const ro = new ResizeObserver((entries) =>
    entries.forEach((e) => {
      const s = scrollerOf(e.target);
      if (s) update(s as HTMLElement);
    }),
  );
  const watch = (root: ParentNode) =>
    root.querySelectorAll?.('.scroll-stable').forEach((el) => {
      if (!observed.has(el)) {
        observed.add(el);
        ro.observe(el);
      }
      // Content growth doesn't resize the scroller itself → watch its first child too
      // (re-attached when React swaps it, e.g. empty state → grid).
      const first = el.firstElementChild;
      const prev = child.get(el);
      if (first !== prev) {
        if (prev) ro.unobserve(prev);
        if (first) {
          ro.observe(first);
          child.set(el, first);
        } else child.delete(el);
      }
      update(el as HTMLElement);
    });

  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('scroll-stable')) return;
      update(el);
      el.dataset.scrolling = '';
      clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => delete el.dataset.scrolling, 900));
    },
    { capture: true, passive: true },
  );
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      watch(document.body);
    });
  }).observe(document.body, { childList: true, subtree: true });
  watch(document.body);
}
