import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { checkSourceAllowed, resolveSpiderEpisode } from '@/lib/spider-bridge';
import { isSpiderSource } from '@/lib/spider-source';
import type { SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;
  let source: SourceConfig;
  let episode: string;
  try {
    const body = await req.json();
    source = body.source;
    episode = body.episode;
    if (!source || !isSpiderSource(source) || typeof source.url !== 'string' || typeof episode !== 'string' || episode.length > 18000) throw new Error();
  } catch { return NextResponse.json({ error: '无效的 Spider 播放请求' }, { status: 400 }); }
  const verdict = await checkSourceAllowed(source);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 });
  try {
    return NextResponse.json({ url: await resolveSpiderEpisode(source, episode) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '播放解析失败' }, { status: 502 });
  }
}
