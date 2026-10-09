// 本地维护的 drpyS 规则，只请求央视公开内容；通过实际引擎执行搜索/二级/lazy。
function officialPage(raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'tv.cctv.com' || url.port || url.username || url.password
        || url.search || url.hash || !/^\/\d{4}\/\d{2}\/\d{2}\/VIDE[A-Za-z0-9]+\.shtml$/.test(url.pathname)) {
        throw new Error('无效的央视视频页');
    }
    return url.href;
}

async function publicRequest(url) {
    const response = await _fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`央视接口 HTTP ${response.status}`);
    return response;
}

// drpyS 从规则脚本的作用域读取 rule，不使用模块导出。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
var rule = {
    title: '央视公开点播（drpy）',
    host: 'https://search.cctv.com',
    homeUrl: 'https://search.cctv.com',
    url: '',
    searchUrl: 'https://search.cctv.com/ifsearch.php?qtext=**&page=fypage',
    detailUrl: 'https://tv.cctv.com/fyid',
    searchable: 2,
    quickSearch: 0,
    filterable: 0,
    play_parse: true,
    搜索: async function (wd, quick, page) {
        const params = new URLSearchParams({ page: String(page), qtext: wd, sort: 'relevance', pageSize: '20',
            type: 'video', vtime: '-1', datepid: '1', channel: '', pageflag: '0' });
        const data = await (await publicRequest(`https://search.cctv.com/ifsearch.php?${params}`)).json();
        if (!Array.isArray(data.list)) throw new Error('央视搜索响应格式无效');
        return data.list.flatMap((item) => {
            let url;
            try { url = officialPage(item.urllink); } catch { return []; }
            const name = (item.all_title || item.title || '').replace(/<[^>]*>/g, '').trim();
            if (!name) return [];
            return [{ vod_id: Buffer.from(url).toString('base64url'), vod_name: name, vod_pic: item.imglink,
                type_name: item.channel, vod_year: String(item.uploadtime || '').match(/\d{4}/)?.[0] }];
        });
    },
    二级: async function (ids) {
        const id = ids[0];
        if (!/^[\w-]{1,512}$/.test(id)) throw new Error('无效的央视视频ID');
        const decoded = Buffer.from(id, 'base64url').toString('utf8');
        if (Buffer.from(decoded).toString('base64url') !== id) throw new Error('无效的央视视频ID');
        const html = await (await publicRequest(officialPage(decoded))).text();
        const guid = /(?:guid|videoCenterId)\s*[:=]\s*["']([a-f0-9]{32})["']/i.exec(html)?.[1];
        if (!guid) throw new Error('央视视频页未提供播放标识');
        const data = await (await publicRequest(`https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`)).json();
        if (String(data.is_protected) === '1' || String(data.is_invalid_copyright) === '1' || !data.hls_url) {
            throw new Error('该视频未提供公开播放资源');
        }
        return { vod_id: id, vod_name: data.title || '央视视频', vod_pic: data.image,
            vod_play_from: '央视公开HLS', vod_play_url: `正片$${guid}` };
    },
    lazy: async function (flag, token) {
        if (!/^[a-f0-9]{32}$/i.test(token)) throw new Error('无效的央视播放标识');
        const data = await (await publicRequest(`https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${token}`)).json();
        if (String(data.is_protected) === '1' || String(data.is_invalid_copyright) === '1' || !data.hls_url) {
            throw new Error('该视频未提供公开 HLS');
        }
        return { parse: 0, url: data.hls_url };
    },
};
