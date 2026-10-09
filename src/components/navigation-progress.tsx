'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

gsap.registerPlugin(useGSAP);

export const NAVIGATION_START = 'libretv-navigation-start';

/** 不伪造百分比：请求期间循环光带，真正完成后铺满并收起。 */
export function NavigationProgress() {
  const pathname = usePathname();
  const params = useSearchParams();
  const currentUrl = `${pathname}${params.size ? `?${params.toString()}` : ''}`;
  const [target, setTarget] = useState<string | null>(null);
  const fetching = useIsFetching();
  const navigating = !!target && target !== currentUrl;
  const active = fetching > 0 || navigating;
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => { if (target === currentUrl) setTarget(null); }, [target, currentUrl]);
  useEffect(() => {
    function start(url: string) {
      const next = new URL(url, location.href);
      if (next.origin !== location.origin || `${next.pathname}${next.search}` === `${location.pathname}${location.search}`) return;
      const query = next.searchParams.toString();
      setTarget(`${next.pathname}${query ? `?${query}` : ''}`);
    }
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.download || (anchor.target && anchor.target !== '_self')) return;
      start(anchor.href);
    }
    function custom(event: Event) { start((event as CustomEvent<string>).detail); }
    function cancel() { setTarget(null); }
    document.addEventListener('click', click, true);
    window.addEventListener(NAVIGATION_START, custom);
    window.addEventListener('popstate', cancel);
    window.addEventListener('pageshow', cancel);
    return () => {
      document.removeEventListener('click', click, true);
      window.removeEventListener(NAVIGATION_START, custom);
      window.removeEventListener('popstate', cancel);
      window.removeEventListener('pageshow', cancel);
    };
  }, []);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ reduced: '(prefers-reduced-motion: reduce)', normal: '(prefers-reduced-motion: no-preference)' }, (context) => {
      const reduced = context.conditions?.reduced;
      if (active) {
        started.current = true;
        gsap.set(root.current, { opacity: 1 });
        gsap.set(bar.current, { scaleX: reduced ? 1 : 0.3, xPercent: reduced ? 0 : -35, transformOrigin: 'left center' });
        if (!reduced) gsap.to(bar.current, { xPercent: 110, duration: 1.1, repeat: -1, ease: 'power1.inOut' });
      } else if (started.current) {
        gsap.timeline().to(bar.current, { xPercent: 0, scaleX: 1, duration: reduced ? 0 : 0.16, ease: 'power2.out' })
          .to(root.current, { opacity: 0, duration: reduced ? 0 : 0.18 });
      } else gsap.set(root.current, { opacity: 0 });
    }, root);
    return () => media.revert();
  }, { scope: root, dependencies: [active], revertOnUpdate: true });

  return <div ref={root} className="navigation-progress" aria-hidden="true"><div ref={bar} /></div>;
}
