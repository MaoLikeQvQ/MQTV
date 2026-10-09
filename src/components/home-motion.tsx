'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

/** 仅内容变化时入场；清除内联样式，让卡片的 CSS 悬停继续接管。 */
export function HomeReveal({ children, identity, className }: { children: ReactNode; identity: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const targets = root.current?.querySelectorAll('[data-reveal]');
      if (targets?.length) gsap.fromTo(Array.from(targets).slice(0, 12),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.36, stagger: 0.025, ease: 'power2.out', clearProps: 'opacity,transform' });
      else gsap.fromTo(root.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'opacity,transform' });
    }, root);
    return () => media.revert();
  }, { scope: root, dependencies: [identity], revertOnUpdate: true });
  return <div ref={root} className={className}>{children}</div>;
}
