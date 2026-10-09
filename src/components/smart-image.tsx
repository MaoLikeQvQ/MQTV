'use client';

import { useEffect, useRef, useState } from 'react';
import { buildImageCandidates } from '@/lib/utils';

interface SmartImageProps {
  /** 原始图片地址（未经代理加工，降级链由本组件按加载方式生成） */
  url?: string;
  mode: 'direct' | 'proxy' | 'custom';
  customProxy?: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** 候选链耗尽后回调，调用方切换占位图等兜底 UI */
  onExhausted?: () => void;
  fadeIn?: boolean;
}

/**
 * 带降级链的封面图组件：direct 模式按 buildImageCandidates 的顺序加载，
 * onError 逐级回退（豆瓣图：直连 → 公共镜像 → 内置代理）；
 * 全部失败后触发 onExhausted 并停止渲染，由调用方展示占位图。
 * referrerPolicy=no-referrer：不向图床暴露来源页，规避部分站点的 Referer 校验。
 */
export function SmartImage({
  url,
  mode,
  customProxy = '',
  alt,
  className,
  loading = 'lazy',
  onExhausted,
  fadeIn = false,
}: SmartImageProps) {
  const candidates = buildImageCandidates(url, mode, customProxy);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // 地址或加载方式变化时重置降级进度
  useEffect(() => {
    setIdx(0);
    if (fadeIn) setLoaded(!!imageRef.current?.complete && imageRef.current.naturalWidth > 0);
  }, [url, mode, customProxy, fadeIn]);
  useEffect(() => {
    if (idx >= candidates.length) onExhausted?.();
    // 候选数组随 url/mode 变化，length 是充分的稳定信号
  }, [idx, candidates.length, onExhausted]);

  const src = candidates[idx];
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      key={src}
      src={src}
      alt={alt}
      className={`${className ?? ''}${fadeIn ? ' cinema-image-fade' : ''}`}
      data-loaded={loaded}
      style={fadeIn ? { opacity: loaded ? 1 : 0 } : undefined}
      onLoad={() => { if (fadeIn) setLoaded(true); }}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => { setLoaded(false); setIdx((i) => i + 1); }}
    />
  );
}
