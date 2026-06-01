import { useEffect, useRef, useState } from 'react';

// Per-group viewport gate (mirrors Pokepelago's DexGrid virtualization). When a
// group scrolls far off-screen its cells are not rendered; a spacer of the same
// height keeps the scroll position stable. rootMargin overscans so cells are
// ready before they enter view.
export function useInViewport<T extends HTMLElement>(rootMargin = '800px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
