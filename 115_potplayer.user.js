// ==UserScript==
// @name         🚀 115网盘 PotPlayer播放 & Aria2下载
// @namespace    https://github.com/115-potplayer
// @version      5.1.0
// @description  在115网盘顶部操作栏添加"🚀PotPlayer播放选中项"按钮，勾选视频后一键生成M3U并唤起PotPlayer批量播放（支持大文件）
// @author       你的名字
// @match        https://115.com/*
// @match        https://web.115.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      proapi.115.com
// @connect      192.168.50.93
// @require      https://peterolson.github.io/BigInteger.js/BigInteger.min.js
// @require      https://cdn.bootcdn.net/ajax/libs/blueimp-md5/2.18.0/js/md5.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    //  常量配置
    // ============================================================
    const VIDEO_EXTS  = new Set(['mp4','mkv','avi','mov','wmv','flv','ts','rmvb','rm','m4v','webm','mpg','mpeg','3gp','m2ts','vob']);
    const BTN_ID      = '__potplayer_btn__';
    const DL_BTN_ID   = '__aria2_dl_btn__';
    const HINT_KEY    = 'potplayer_hint_shown';
    const IFRAME_NAME = 'wangpan';
    const UA          = navigator.userAgent;

    // ============================================================
    //  Aria2 配置（按需修改）
    // ============================================================
    const ARIA2_RPC    = 'http://192.168.50.93:6800/jsonrpc';  // Aria2 RPC 地址
    const ARIA2_TOKEN  = '111111';                              // Secret Token，没有留空 ''
    const ARIA2_DIR    = '/downloads';                          // NAS 下载目录

    // ============================================================
    //  115 加解密算法（移植自 kkHAIKE/fake115）
    //
    //  115 的 proapi.115.com/app/chrome/downurl 接口要求：
    //    1. 请求体用 RSA + 自定义 XOR 算法加密
    //    2. 响应的 data 字段用同样算法解密
    //  此算法无大小限制，可取代有大小限制的 webapi 旧接口。
    // ============================================================

    // RSA 公钥（固定值，115官方内置）
    class M115Rsa {
        constructor() {
            this.n = bigInt('8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683', 16);
            this.e = bigInt('10001', 16);
        }
        a2hex(b) {
            return b.map(x => x.toString(16).padStart(2, '0')).join('');
        }
        hex2a(hex) {
            let s = '';
            for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
            return s;
        }
        pkcs1pad2(s, n) {
            const ba = new Array(n).fill(0);
            let i = s.length - 1, idx = n;
            while (i >= 0) ba[--idx] = s.charCodeAt(i--);
            ba[--idx] = 0;
            while (idx > 2) ba[--idx] = 0xff;
            ba[--idx] = 2;
            return bigInt(this.a2hex(ba), 16);
        }
        pkcs1unpad2(a) {
            let b = a.toString(16);
            if (b.length % 2) b = '0' + b;
            const c = this.hex2a(b);
            let i = 1;
            while (c.charCodeAt(i) !== 0) i++;
            return c.slice(i + 1);
        }
        encrypt(text) {
            const m = this.pkcs1pad2(text, 0x80);
            const c = m.modPow(this.e, this.n);
            return c.toString(16).padStart(0x80 * 2, '0');
        }
        decrypt(text) {
            const ba = [...text].map((_, i) => text.charCodeAt(i));
            const a = bigInt(this.a2hex(ba), 16);
            const c = a.modPow(this.e, this.n);
            return this.pkcs1unpad2(c);
        }
    }
    const rsa = new M115Rsa();

    // XOR 加密常量
    const G_KTS = [240,229,105,174,191,220,191,138,26,69,232,190,125,166,115,184,222,143,231,196,69,218,134,196,155,100,139,20,106,180,241,170,56,1,53,158,38,105,44,134,0,107,79,165,54,52,98,166,42,150,104,24,242,74,253,189,107,151,143,77,143,137,19,183,108,142,147,237,14,13,72,62,215,47,136,216,254,254,126,134,80,149,79,209,235,131,38,52,219,102,123,156,126,157,122,129,50,234,182,51,222,58,169,89,52,102,59,170,186,129,96,72,185,213,129,156,248,108,132,119,255,84,120,38,95,190,232,30,54,159,52,128,92,69,44,155,118,213,27,143,204,195,184,245];
    const G_KEY_S = [0x29, 0x23, 0x21, 0x5E];
    const G_KEY_L = [120,6,173,76,51,134,93,24,76,1,63,70];

    function m115GetKey(length, key) {
        if (key) return Array.from({length}, (_, i) => ((key[i] + G_KTS[length * i]) & 0xff) ^ G_KTS[length * (length - 1 - i)]);
        return (length === 12 ? G_KEY_L : G_KEY_S).slice();
    }

    function xor115Enc(src, key) {
        const srclen = src.length, keylen = key.length;
        const mod4 = srclen % 4;
        const ret = [];
        for (let i = 0; i < mod4; i++) ret.push(src[i] ^ key[i % keylen]);
        for (let i = mod4; i < srclen; i++) ret.push(src[i] ^ key[(i - mod4) % keylen]);
        return ret;
    }

    function m115SymEncode(src, key1, key2) {
        let ret = xor115Enc(src, m115GetKey(4, key1));
        ret.reverse();
        return xor115Enc(ret, m115GetKey(12, key2));
    }

    function m115SymDecode(src, key1, key2) {
        let ret = xor115Enc(src, m115GetKey(12, key2));
        ret.reverse();
        return xor115Enc(ret, m115GetKey(4, key1));
    }

    function strToBytes(s) { return [...s].map(c => c.charCodeAt(0)); }
    function bytesToStr(b) { return b.map(c => String.fromCharCode(c)).join(''); }

    function m115AsymEncode(src) {
        const m = 128 - 11;
        let ret = '';
        for (let i = 0; i < Math.ceil(src.length / m); i++) {
            ret += rsa.encrypt(bytesToStr(src.slice(i * m, Math.min((i + 1) * m, src.length))));
        }
        return btoa(rsa.hex2a(ret));
    }

    function m115AsymDecode(src) {
        const m = 128;
        let ret = '';
        for (let i = 0; i < Math.ceil(src.length / m); i++) {
            ret += rsa.decrypt(bytesToStr(src.slice(i * m, Math.min((i + 1) * m, src.length))));
        }
        return strToBytes(ret);
    }

    /**
     * 加密请求体：
     *   1. 用当前时间戳生成 md5 key
     *   2. 对 JSON(pickcode) 做 XOR 对称加密
     *   3. 再做 RSA 非对称加密
     *   返回 { data: base64字符串, key: md5字节数组 }
     */
    function m115Encode(src, tm) {
        const key = strToBytes(md5(`!@###@#${tm}DFDR@#@#`));
        let tmp = strToBytes(src);
        tmp = m115SymEncode(tmp, key, null);
        tmp = key.slice(0, 16).concat(tmp);
        return { data: m115AsymEncode(tmp), key };
    }

    /**
     * 解密响应体：
     *   1. base64 解码
     *   2. RSA 解密
     *   3. XOR 对称解密（用请求时的 key）
     */
    function m115Decode(src, key) {
        let tmp = strToBytes(atob(src));
        tmp = m115AsymDecode(tmp);
        return bytesToStr(m115SymDecode(tmp.slice(16), key, tmp.slice(0, 16)));
    }

    // ============================================================
    //  工具函数
    // ============================================================
    function isVideo(filename, ico) {
        if (ico && VIDEO_EXTS.has(ico.toLowerCase())) return true;
        if (!filename) return false;
        return VIDEO_EXTS.has(filename.split('.').pop().toLowerCase());
    }

    function showToast(msg, type = 'info') {
        const colors = { info:'#333', success:'#1a7f37', error:'#c0392b', warn:'#b45309' };
        const el = document.createElement('div');
        el.textContent = msg;
        Object.assign(el.style, {
            position:'fixed', top:'60px', left:'50%', transform:'translateX(-50%)',
            background: colors[type]||'#333', color:'#fff',
            padding:'10px 22px', borderRadius:'8px', fontSize:'14px',
            zIndex:2147483647, boxShadow:'0 4px 12px rgba(0,0,0,0.3)',
            pointerEvents:'none', opacity:'1', transition:'opacity 0.4s',
            whiteSpace:'pre-wrap', maxWidth:'80vw', textAlign:'center',
        });
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity='0'; setTimeout(()=>el.remove(),500); }, 3500);
    }

    function throttle(fn, delay) {
        let timer = null;
        return function(...args) {
            if (timer) return;
            timer = setTimeout(() => { timer = null; fn.apply(this, args); }, delay);
        };
    }

    function getIframeWin() {
        try {
            const f = document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
            return f ? f.contentWindow : null;
        } catch(e) { return null; }
    }

    function getIframeDoc() {
        const w = getIframeWin();
        try { return w ? w.document : null; } catch(e) { return null; }
    }

    // ============================================================
    //  核心：通过 pick_code 获取 115 真实下载直链
    // ============================================================
    /**
     * 接口：POST https://proapi.115.com/app/chrome/downurl?t=<时间戳>
     * 请求体：data=<RSA+XOR加密后的base64>（URL编码）
     * 响应：{ state:true, data:<加密后的JSON> }
     *       解密 data 得到：{ "<file_id>": { url: { url:"https://..." }, file_name:"xxx" } }
     *
     * 此接口无文件大小限制，是115官方扩展/客户端使用的标准接口。
     *
     * ⚠️ 此接口不受 CORS 限制（proapi.115.com 不在 iframe 同域），
     *    必须用 GM_xmlhttpRequest（油猴跨域请求），同时通过
     *    cookie 参数手动传入登录态。
     */
    function getCookies() {
        // 从 iframe 的 document.cookie 获取登录 Cookie
        try {
            const iWin = getIframeWin();
            return iWin ? iWin.document.cookie : document.cookie;
        } catch(e) { return document.cookie; }
    }

    function fetchDirectUrl(pickcode) {
        return new Promise((resolve, reject) => {
            const tm = Math.floor(Date.now() / 1000);
            const { data, key } = m115Encode(JSON.stringify({ pickcode }), tm);

            GM_xmlhttpRequest({
                method: 'POST',
                url: `https://proapi.115.com/app/chrome/downurl?t=${tm}`,
                data: `data=${encodeURIComponent(data)}`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': 'https://115.com/',
                    'User-Agent': UA,
                    'Cookie': getCookies(),  // 手动传入从 iframe 读取的登录 Cookie
                },
                onload(res) {
                    try {
                        const json = JSON.parse(res.responseText);
                        if (!json.state) {
                            reject(new Error(json.msg || json.error || `errno:${json.errno}`));
                            return;
                        }
                        // 解密响应
                        const decoded = JSON.parse(m115Decode(json.data, key));
                        // 响应格式：{ "file_id": { url: { url: "..." }, file_name: "..." } }
                        const fileId = Object.keys(decoded)[0];
                        const fileUrl = decoded[fileId]?.url?.url;
                        if (fileUrl) {
                            resolve(fileUrl);
                        } else {
                            reject(new Error('解密后未找到下载链接'));
                        }
                    } catch(e) {
                        reject(new Error('解析/解密响应失败: ' + e.message));
                    }
                },
                onerror() {
                    reject(new Error('请求 proapi 失败，请检查网络'));
                },
            });
        });
    }

    // ============================================================
    //  获取 iframe 内已勾选的视频文件
    // ============================================================
    function getSelectedVideos() {
        const iDoc = getIframeDoc();
        if (!iDoc) { showToast('❌ 无法访问文件列表，请刷新页面重试','error'); return []; }

        const results = [];
        iDoc.querySelectorAll('li[rel="item"]').forEach(li => {
            // iv="1" 表示"是视频文件"而非"已勾选"，不能用于判断勾选状态
            // 真正的勾选标志：class 包含 "selected"，或内部 checkbox 被 checked
            const isSelected =
                li.className.includes('selected') ||
                !!li.querySelector('input[type="checkbox"]')?.checked;
            if (!isSelected) return;

            const pickcode = li.getAttribute('pick_code');
            const title    = li.getAttribute('title') || '';
            const ico      = li.getAttribute('ico') || '';
            if (ico === 'folder' || li.getAttribute('file_type') === '0') return;
            if (!pickcode || !isVideo(title, ico)) return;
            results.push({ pickcode, name: title });
        });
        return results;
    }


    // ============================================================
    //  本地 Helper 服务地址（与 115helper.py 保持一致）
    // ============================================================
    const HELPER_URL = 'http://127.0.0.1:19190/play';

    // ============================================================
    //  方式一：通过本地 Helper 唤起 PotPlayer（无文件落盘）
    //
    //  将 URL/文件名/UA 发给本地 Python 服务，服务在 %TEMP% 生成
    //  临时 M3U 喂给 PotPlayer，播放结束后自动删除。
    // ============================================================
    async function playViaHelper(videos) {
        const params = new URLSearchParams();
        videos.forEach(v => {
            params.append('url',  v.directUrl);
            params.append('name', v.name);
        });
        params.append('ua', UA);

        const res = await fetch(`${HELPER_URL}?${params.toString()}`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Helper 返回 ${res.status}`);
        const json = await res.json();
        if (!json.ok) throw new Error('Helper 播放失败');
        return json.count;
    }

    // ============================================================
    //  方式二：降级方案 —— 生成 M3U 文件下载
    //  （Helper 未运行时自动触发，需在浏览器设置"总是打开此类文件"）
    // ============================================================
    function fallbackDownloadM3U(videos) {
        let m3u = '#EXTM3U\n';
        videos.forEach(({ name, directUrl }) => {
            m3u += `#EXTVLCOPT:http-user-agent=${UA}\n`;
            m3u += `#EXTINF:-1 ,${name}\n`;
            m3u += `${directUrl}\n`;
        });
        const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `115_playlist_${Date.now()}.m3u`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);

        if (!GM_getValue(HINT_KEY, false)) {
            GM_setValue(HINT_KEY, true);
            setTimeout(() => alert(
                '🎬 115 PotPlayer 播放提示\n\n' +
                '检测到本地 Helper 未运行，已降级为 M3U 文件方式。\n\n' +
                '▶ 推荐方案（无文件）：运行 115helper.py 后台服务\n\n' +
                '▶ 当前临时方案：在浏览器下载栏右键 .m3u 文件\n' +
                '  Chrome / Edge → 「总是打开此类文件」'
            ), 800);
        }
    }

    // ============================================================
    //  按钮点击主流程
    // ============================================================
    async function onPlayClick(btn) {
        const selected = getSelectedVideos();
        if (selected.length === 0) {
            const iDoc = getIframeDoc();
            if (iDoc) {
                const items = iDoc.querySelectorAll('li[rel="item"]');
                console.log(`[115 PotPlayer] 共 ${items.length} 个文件行：`);
                items.forEach(li => console.log(
                    ` title="${li.getAttribute('title')}"`,
                    `iv="${li.getAttribute('iv')}"`,
                    `class="${li.className}"`
                ));
            }
            showToast('⚠️ 请先勾选需要播放的视频文件\n（若已勾选仍提示，请按 F12 查看控制台）', 'warn');
            return;
        }

        const orig = btn.textContent;
        btn.textContent = `⏳ 获取中 0/${selected.length}`;
        btn.disabled = true; btn.style.opacity = '0.7'; btn.style.cursor = 'not-allowed';

        try {
            let done = 0;
            const result = await Promise.all(selected.map(async v => {
                const url = await fetchDirectUrl(v.pickcode);
                btn.textContent = `⏳ 获取中 ${++done}/${selected.length}`;
                return { ...v, directUrl: url };
            }));

            // 优先尝试本地 Helper（无文件落盘）
            try {
                const count = await playViaHelper(result);
                showToast(`✅ PotPlayer 已启动，共 ${count} 个视频`, 'success');
            } catch (helperErr) {
                // Helper 未运行，静默降级到 M3U 文件方式
                console.warn('[115 PotPlayer] Helper 不可用，降级:', helperErr.message);
                fallbackDownloadM3U(result);
                showToast(`✅ 已生成 ${result.length} 个视频的播放列表`, 'success');
            }

        } catch (err) {
            console.error('[115 PotPlayer]', err);
            showToast(`❌ ${err.message}`, 'error');
        } finally {
            btn.textContent = orig; btn.disabled = false;
            btn.style.opacity = '1'; btn.style.cursor = 'pointer';
        }
    }


    // ============================================================
    //  Aria2：发送下载任务到 NAS
    // ============================================================
    /**
     * Aria2 JSON-RPC 接口：aria2.addUri
     * 文档：https://aria2.github.io/manual/en/html/aria2c.html#aria2.addUri
     *
     * 请求格式：
     * {
     *   jsonrpc: '2.0',
     *   method:  'aria2.addUri',
     *   id:      随机字符串,
     *   params:  [
     *     'token:SECRET',          // 鉴权
     *     ['https://直链URL'],     // 下载地址数组（单文件一个元素）
     *     {
     *       dir:    '/downloads',  // 保存目录
     *       out:    '文件名.mp4',  // 保存文件名
     *       header: ['User-Agent: xxx']  // 115 CDN 要求携带 UA
     *     }
     *   ]
     * }
     */

    // ============================================================
    //  Aria2 通用 JSON-RPC 调用封装
    // ============================================================
    function aria2Call(method, params) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method:  'POST',
                url:     ARIA2_RPC,
                data:    JSON.stringify({
                    jsonrpc: '2.0',
                    method,
                    id:     Math.random().toString(36).slice(2),
                    params: [`token:${ARIA2_TOKEN}`, ...params],
                }),
                headers: { 'Content-Type': 'application/json' },
                timeout: 8000,
                onload(res) {
                    try {
                        const json = JSON.parse(res.responseText);
                        if (json.error) reject(new Error(`Aria2[${method}] ${json.error.message}`));
                        else resolve(json.result);
                    } catch(e) { reject(new Error('解析 Aria2 响应失败: ' + e.message)); }
                },
                onerror()   { reject(new Error('无法连接到 Aria2，请检查 RPC 地址和网络')); },
                ontimeout() { reject(new Error('连接 Aria2 超时')); },
            });
        });
    }

    // ============================================================
    //  检测并修正 Aria2 全局 User-Agent
    // ============================================================
    /**
     * 流程：
     *   1. aria2.getGlobalOption  → 读取当前全局配置
     *   2. 对比 user-agent 字段与当前浏览器 UA
     *   3. 不一致 → aria2.changeGlobalOption 写入正确 UA
     *
     * 为什么要修全局 UA？
     *   per-task 的 header 参数已覆盖单次请求的 UA，
     *   但部分 Aria2 版本在断点重试时会复用全局 UA 而忽略 task header，
     *   统一修正全局 UA 可确保重试场景也能正常访问 115 CDN。
     */
    async function ensureAria2UA() {
        const opts  = await aria2Call('aria2.getGlobalOption', []);
        const oldUA = opts['user-agent'] || '';
        if (oldUA === UA) return { changed: false, oldUA };
        await aria2Call('aria2.changeGlobalOption', [{ 'user-agent': UA }]);
        console.log(`[115 Aria2] UA 已修正\n  旧: ${oldUA}\n  新: ${UA}`);
        return { changed: true, oldUA };
    }

    // ============================================================
    //  提交单个下载任务
    // ============================================================
    function aria2AddUri(url, filename) {
        return aria2Call('aria2.addUri', [
            [url],
            {
                dir:    ARIA2_DIR,
                out:    filename,
                header: [`User-Agent: ${UA}`],  // per-task 双重保险
            },
        ]);
    }

    // ============================================================
    //  Aria2 下载按钮点击流程
    // ============================================================
    async function onDownloadClick(btn) {
        const iDoc = getIframeDoc();
        if (!iDoc) { showToast('❌ 无法访问文件列表，请刷新页面重试', 'error'); return; }

        const selected = [];
        iDoc.querySelectorAll('li[rel="item"]').forEach(li => {
            const isSelected =
                li.className.includes('selected') ||
                !!li.querySelector('input[type="checkbox"]')?.checked;
            if (!isSelected) return;
            const pickcode = li.getAttribute('pick_code');
            const title    = li.getAttribute('title') || '';
            const ico      = li.getAttribute('ico') || '';
            if (ico === 'folder' || li.getAttribute('file_type') === '0') return;
            if (!pickcode) return;
            selected.push({ pickcode, name: title });
        });

        if (selected.length === 0) {
            showToast('⚠️ 请先勾选需要下载的文件', 'warn');
            return;
        }

        const orig = btn.textContent;
        btn.disabled = true; btn.style.opacity = '0.7'; btn.style.cursor = 'not-allowed';

        try {
            // ── 步骤一：检测并修正 Aria2 全局 UA ──
            btn.textContent = '🔍 检测 UA...';
            let uaNote = '';
            try {
                const { changed, oldUA } = await ensureAria2UA();
                if (changed) {
                    uaNote = '\n（已自动修正 Aria2 UA）';
                    console.log('[115 Aria2] UA 修正完成');
                }
            } catch(uaErr) {
                // UA 检测失败不阻断下载，仅记录警告
                console.warn('[115 Aria2] UA 检测失败（不影响下载）:', uaErr.message);
                uaNote = '\n（UA 检测失败，已跳过）';
            }

            // ── 步骤二：串行获取直链并提交任务 ──
            let done = 0, failed = 0;
            for (const item of selected) {
                btn.textContent = `⏳ 提交中 ${done + failed}/${selected.length}`;
                try {
                    const directUrl = await fetchDirectUrl(item.pickcode);
                    const gid       = await aria2AddUri(directUrl, item.name);
                    console.log(`[115 Aria2] ✅ ${item.name} → GID: ${gid}`);
                    done++;
                } catch(e) {
                    console.error(`[115 Aria2] ❌ ${item.name}:`, e.message);
                    failed++;
                }
            }

            // ── 步骤三：结果提示 ──
            if (failed === 0) {
                showToast(`✅ 已提交 ${done} 个任务到 Aria2${uaNote}`, 'success');
            } else {
                showToast(`⚠️ ${done} 成功 / ${failed} 失败${uaNote}\n（F12 控制台查看详情）`, 'warn');
            }

        } catch(err) {
            console.error('[115 Aria2]', err);
            showToast(`❌ ${err.message}`, 'error');
        } finally {
            btn.textContent = orig; btn.disabled = false;
            btn.style.opacity = '1'; btn.style.cursor = 'pointer';
        }
    }

    // ============================================================
    //  UI 注入
    // ============================================================
    function injectButton() {
        const iDoc = getIframeDoc();
        if (!iDoc) return;
        if (iDoc.getElementById(BTN_ID)) return;

        const container =
            iDoc.getElementById('js_top_panel_box') ||
            iDoc.querySelector('.top-vflow') ||
            iDoc.querySelector('[class*="topheader"]');
        if (!container) return;

        // ---- 公共样式函数 ----
        function makeBtn(id, text, title, bgColor, borderColor) {
            const btn = document.createElement('a');
            btn.id   = id;
            btn.href = 'javascript:;';
            btn.textContent = text;
            btn.title = title;
            Object.assign(btn.style, {
                display:'inline-flex', alignItems:'center',
                padding:'0 12px', height:'28px', lineHeight:'28px', margin:'4px 4px',
                border:`1px solid ${borderColor}`, borderRadius:'4px',
                background: bgColor,
                color:'#fff', fontSize:'13px', fontWeight:'bold',
                cursor:'pointer', textDecoration:'none',
                whiteSpace:'nowrap', verticalAlign:'middle',
                userSelect:'none', flexShrink:'0', zIndex:'9999',
            });
            btn.addEventListener('mouseenter', () => { if(!btn.disabled) btn.style.opacity='0.85'; });
            btn.addEventListener('mouseleave', () => { btn.style.opacity='1'; });
            return btn;
        }

        // ---- 🚀 PotPlayer 播放按钮 ----
        const playBtn = makeBtn(
            BTN_ID,
            '🚀 PotPlayer播放',
            '播放已勾选的视频（支持大文件）',
            'linear-gradient(180deg,#ff8c42 0%,#e0601a 100%)',
            '#d0703a'
        );
        playBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onPlayClick(playBtn); });

        // ---- ⬇️ Aria2 下载按钮 ----
        const dlBtn = makeBtn(
            DL_BTN_ID,
            '⬇️ Aria2下载',
            `下载已勾选的文件到 NAS：${ARIA2_DIR}`,
            'linear-gradient(180deg,#4a9eff 0%,#1a6fd0 100%)',
            '#1a5fa8'
        );
        dlBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onDownloadClick(dlBtn); });

        container.appendChild(playBtn);
        container.appendChild(dlBtn);
        console.log('[115] ✅ 按钮注入成功');
    }

    // ============================================================
    //  SPA 适配（节流版，避免干扰页面渲染）
    // ============================================================
    let iframeObserver = null;
    const throttledInject = throttle(injectButton, 500);

    function watchIframe() {
        const iDoc = getIframeDoc();
        if (!iDoc || !iDoc.body) return;
        injectButton();
        if (iframeObserver) return;

        const container =
            iDoc.getElementById('js_top_panel_box') ||
            iDoc.querySelector('.top-vflow') ||
            iDoc.body;

        iframeObserver = new MutationObserver(throttledInject);
        iframeObserver.observe(container, { childList:true, subtree:false });
    }

    const outerObserver = new MutationObserver(throttle(() => {
        const iframe = document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
        if (!iframe) return;
        if (iframe.contentDocument?.readyState === 'complete') watchIframe();
        else iframe.addEventListener('load', watchIframe, { once:true });
    }, 500));

    function start() {
        if (!document.body) { setTimeout(start, 300); return; }
        outerObserver.observe(document.body, { childList:true, subtree:false });
        watchIframe();
        const iframe = document.querySelector(`iframe[name="${IFRAME_NAME}"]`);
        if (iframe) iframe.addEventListener('load', watchIframe, { once:true });
    }

    start();

})();
