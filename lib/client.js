// dsh-ref-autofill · DeepSeek Harness 插件：浏览器半边
// 由油猴脚本（dsh-ref-autofill.user.js）原样搬入：UI、数据、站点适配逻辑不变，
// 只是把 GM_* 换成内置降级（localStorage + fetch），由 dsh 客户端加载。
window.__ModuleLoader__.load({
  id: 'dsh-ref-autofill',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    function start() {
      if (window.__dshRefAutofillStarted) return
      window.__dshRefAutofillStarted = true;

// ==UserScript==
// @name         DeepSeek Harness 参考图一键填充
// @namespace    https://github.com/dsh-ref-autofill
// @version      0.2.0
// @license      MIT
// @description  在 DeepSeek Harness 网页版内浏览中文 AI 脸库 / 服装库 / 姿势库（含多角度与深度图），选中后把高清参考图与提示词一键填入对话框，由你自己点击发送
// @match        http://127.0.0.1/*
// @match        http://localhost/*
// @match        https://127.0.0.1/*
// @match        https://localhost/*
// @noframes
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      ai-pose-gallery.smallyoung.cn
// @connect      ai-pose-gallery.anhao.app
// @connect      cdn.jsdelivr.net
// @connect      fastly.jsdelivr.net
// @connect      raw.githubusercontent.com
// ==/UserScript==

/*
 * 数据与图片来自开源项目 anhao/ai-pose-gallery-zh：
 *   姿势库 / 服装库 / 人像脸库原作者 ギア @giaaibusi；中国历代服饰 Shisei；二次元服装 たき AI @taki_auto · CharaDB。
 * 脚本只在运行时从公开地址读取，不打包、不再分发图片。
 * 姿势库 / 服装库图片禁止再分发，脸库与中国历代服饰为 CC0。
 *
 * 若你的 DeepSeek Harness 不在 127.0.0.1 / localhost（例如反向代理到自己的域名），
 * 在上面 @match 里追加一行该地址即可，脚本会自动识别页面是否存在 DSH 输入框。
 */
(() => {
    'use strict';
    if (window.top !== window.self) return;
    if (document.getElementById('dsh-ref-host')) return;

    /* ───────────── 配置 ───────────── */
    const CONFIG = {
        // 依次尝试，第一个能读到数据的作为图片根地址
        sources: [
            'https://ai-pose-gallery.smallyoung.cn/',
            'https://ai-pose-gallery.anhao.app/',
            'https://cdn.jsdelivr.net/gh/anhao/ai-pose-gallery-zh@main/',
            'https://fastly.jsdelivr.net/gh/anhao/ai-pose-gallery-zh@main/',
            'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/',
        ],
        // 远程清单：存在时自动接管文件列表、哈希、分类标签与字段映射，实现零代码改动的热更新
        manifest: 'data/manifest.json',
        files: {
            face: 'data/portrait-zh.json',
            costume: [
                'data/costume-zh.json',
                'data/costume-shisei-zh.json',
                'data/costume-anime-zh.json',
                'data/costume-gia-anime-zh.json',
            ],
            pose: 'data/pose-zh.json',
        },
        sourceLabels: {
            gia: '现实穿搭',
            shisei: '中国历代',
            charadb: '二次元·CharaDB',
            'gia-anime': '二次元·ギア',
        },
        // 字段名自动识别不准时在这里覆盖
        mapping: { pose: {}, costume: {}, face: {} },
        cacheHours: 24,
    };

    const LIBS = [['face', '脸'], ['costume', '服装'], ['pose', '姿势']];
    const LABELS = { face: ['发长', '发型'], costume: ['大类', '分类'], pose: ['体系', '动作分类'] };
    const NSFW = /性感|缠绵|内衣|睡衣|泳装|魅力写真|双人互动|贴身穿搭|魅力穿搭/;
    const STYLES = [
        ['不指定（跟随参考图）', ''],
        ['写实人像写真', '写实人像摄影，自然光线，真实皮肤质感'],
        ['日系二次元插画', '日系二次元插画风格，干净线条，柔和上色'],
        ['2.5D 游戏立绘', '2.5D 游戏角色立绘，精致渲染'],
        ['电影感剧照', '电影感剧照，浅景深，电影级打光'],
        ['赛博朋克霓虹', '赛博朋克风格，霓虹灯光，夜景'],
        ['角色设定图（白底）', '角色设定图，纯白背景，全身展示'],
    ];
    const DEF = {
        method: 'auto', order: 'imgFirst', maxImages: '', append: false, autoSend: false,
        safe: true, convert: 'jpeg', style: '', dockPos: 'auto',
    };
    const LS_PREFIX = 'dsh-ref:';
    const settings = Object.assign({}, DEF, GM_get('settings', {}));
    const saveSettings = () => GM_set('settings', settings);
    const getLimit = () => {
        const v = parseInt(settings.maxImages, 10);
        return String(settings.maxImages) !== '' && v >= 0 ? v : 0;
    };

    /* ───────────── 存储 / 网络（GM_* 缺失时自动降级，便于直接注入测试） ───────────── */
    function GM_get(key, def) {
        try {
            if (typeof GM_getValue === 'function') {
                const v = GM_getValue(key, undefined);
                return v === undefined ? def : v;
            }
            const raw = localStorage.getItem(LS_PREFIX + key);
            return raw == null ? def : JSON.parse(raw);
        } catch (_) { return def; }
    }
    function GM_set(key, val) {
        try {
            if (typeof GM_setValue === 'function') return GM_setValue(key, val);
            localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
        } catch (_) { /* 超出配额则忽略 */ }
    }
    function GM_del(key) {
        try {
            if (typeof GM_deleteValue === 'function') return GM_deleteValue(key);
            localStorage.removeItem(LS_PREFIX + key);
        } catch (_) { }
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const IMG_RE = /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i;
    const isAbs = (s) => /^https?:/i.test(s);

    function gm(url, type = 'text') {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((res, rej) =>
                GM_xmlhttpRequest({
                    url, method: 'GET', responseType: type === 'blob' ? 'blob' : 'text', timeout: 30000,
                    onload: (r) => (r.status >= 200 && r.status < 300 ? res(r.response) : rej(new Error('HTTP ' + r.status))),
                    onerror: () => rej(new Error('网络错误')),
                    ontimeout: () => rej(new Error('超时')),
                })
            );
        }
        return fetch(url, { credentials: 'omit' }).then((r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return type === 'blob' ? r.blob() : r.text();
        });
    }

    /* ───────────── 数据 ───────────── */
    const state = {
        tab: 'face', raw: {}, items: {}, sel: {}, q: '', f1: '', f2: '',
        list: [], shown: 0, bases: CONFIG.sources.slice(), dirty: false, busy: false,
        poseDepth: false, dragging: false, resizing: false, fabDragging: false,
        manifestLoaded: false, manifestHashes: {}, loading: false,
        sourceLabels: Object.assign({}, CONFIG.sourceLabels),
        nsfwRe: NSFW,
    };

    function toArray(j) {
        if (Array.isArray(j)) return j;
        let best = [];
        const walk = (o, d) => {
            if (!o || typeof o !== 'object' || d > 2) return;
            for (const v of Object.values(o)) {
                if (Array.isArray(v)) { if (v.length > best.length && typeof v[0] === 'object') best = v; }
                else walk(v, d + 1);
            }
        };
        walk(j, 0);
        return best;
    }

    async function ensureManifest() {
        if (state.manifestLoaded) return;
        state.manifestLoaded = true;
        if (!CONFIG.manifest) return;
        for (const base of CONFIG.sources) {
            try {
                const m = JSON.parse(await gm(base + CONFIG.manifest));
                if (!m || typeof m !== 'object' || !m.libraries) continue;
                state.bases = [base, ...CONFIG.sources.filter((b) => b !== base)];
                if (m.sourceLabels && typeof m.sourceLabels === 'object') {
                    Object.assign(state.sourceLabels, m.sourceLabels);
                }
                if (m.mapping && typeof m.mapping === 'object') {
                    for (const [k, v] of Object.entries(m.mapping)) {
                        if (v && typeof v === 'object') Object.assign((CONFIG.mapping[k] = CONFIG.mapping[k] || {}), v);
                    }
                }
                if (m.nsfwPattern && typeof m.nsfwPattern === 'string') {
                    try { state.nsfwRe = new RegExp(m.nsfwPattern); } catch (_) { }
                }
                for (const [lib, def] of Object.entries(m.libraries)) {
                    if (!def || typeof def !== 'object') continue;
                    if (Array.isArray(def.files) && def.files.length) CONFIG.files[lib] = def.files;
                    if (Array.isArray(def.filters) && def.filters.length === 2) LABELS[lib] = def.filters;
                    if (def.hash) state.manifestHashes[lib] = String(def.hash);
                }
                return;
            } catch (_) { /* 当前源无清单或网络异常则尝试下一源，最终回退内置 CONFIG */ }
        }
    }

    async function loadRaw(lib) {
        await ensureManifest();
        const key = 'cache_v5_' + lib;
        const remoteHash = state.manifestHashes[lib] || '';
        const c = GM_get(key, null);
        if (c && c.d && c.d.length) {
            if (remoteHash ? c.h === remoteHash : (Date.now() - c.t < CONFIG.cacheHours * 3600e3)) return c.d;
        }
        const rawFiles = Array.isArray(CONFIG.files[lib]) ? CONFIG.files[lib] : [CONFIG.files[lib]];
        const fileDefs = rawFiles.map((f) => (typeof f === 'string' ? { path: f } : f)).filter((f) => f && f.path);
        let err;
        for (const base of state.bases) {
            try {
                const results = await Promise.all(
                    fileDefs.map(async (f) => {
                        const list = toArray(JSON.parse(await gm(base + f.path)));
                        if (f.cat2 || f.source) {
                            list.forEach((item) => {
                                if (item && typeof item === 'object') {
                                    if (f.cat2 && !item._cat2) item._cat2 = f.cat2;
                                    if (f.source && !item.source) item.source = f.source;
                                }
                            });
                        }
                        return list;
                    })
                );
                const arr = results.flat();
                if (!arr.length) throw new Error('数据为空');
                state.bases = [base, ...CONFIG.sources.filter((b) => b !== base)];
                GM_set(key, { t: Date.now(), h: remoteHash, d: arr });
                return arr;
            } catch (e) { err = e; }
        }
        throw err || new Error('加载失败');
    }

    // 字段读取：先看手动映射，再按正则匹配键名
    function reader(lib) {
        const m = CONFIG.mapping[lib] || {};
        return (r, name, res) => {
            if (m[name] && r[m[name]] != null) return String(r[m[name]]);
            for (const re of res) {
                for (const k of Object.keys(r)) {
                    const v = r[k];
                    if (re.test(k) && v != null && v !== '' && typeof v !== 'object') return String(v);
                }
            }
            return '';
        };
    }
    function fixPath(v, kind, dir) {
        if (!v || isAbs(v) || v.includes('/')) return v;
        return (kind === 'thumb' ? 'thumbs/' : 'img/') + (dir ? dir + '/' : '') + v;
    }
    const allText = (r) => Object.values(r).filter((v) => typeof v === 'string' || typeof v === 'number').join(' ').toLowerCase();

    function normPose(recs) {
        const rd = reader('pose');
        const groups = new Map();
        recs.forEach((r, i) => {
            const sys = rd(r, 'sys', [/体系|系統/]);
            const no = rd(r, 'no', [/姿势编号|ポーズ番号/]);
            const key = sys + '|' + (no || r.id || i);
            let it = groups.get(key);
            if (!it) {
                const subCat = rd(r, 'cat', [/^分类$|分類/]);
                it = {
                    lib: 'pose', id: key, title: rd(r, 'title', [/姿势名称|ポーズ名/]) || no || key,
                    cat: sys, cat2: subCat, angles: [], cur: 0,
                    nsfw: Boolean(r.敏感) || state.nsfwRe.test(sys + ' ' + subCat), s: '',
                };
                groups.set(key, it);
            }
            if (r.敏感) it.nsfw = true;
            it.angles.push({
                angle: rd(r, 'angle', [/角度|アングル/]),
                thumb: fixPath(rd(r, 'thumb', [/缩略|サムネ|thumb/i]), 'thumb'),
                full: fixPath(rd(r, 'full', [/^原图$|原寸|full/i]), 'full'),
                id: r.id || '',
            });
            it.s += ' ' + allText(r);
        });
        const out = [...groups.values()];
        out.forEach((it) => { const f = it.angles.findIndex((a) => /正面/.test(a.angle)); it.cur = f > -1 ? f : 0; it.search = it.s; });
        return out;
    }

    function normGeneric(lib, recs) {
        const rd = reader(lib);
        const dir = lib === 'face' ? 'portrait' : 'costume';
        return recs.map((r, i) => {
            let thumb = rd(r, 'thumb', [/缩略|サムネ|thumb/i]);
            let full = rd(r, 'full', [/^原图$|原寸|原图|full|origin/i]);
            if (!thumb || !full) {
                const imgs = Object.values(r).filter((v) => typeof v === 'string' && IMG_RE.test(v));
                thumb = thumb || imgs.find((v) => /thumb/i.test(v)) || imgs[0] || '';
                full = full || imgs.find((v) => v !== thumb) || imgs[0] || '';
            }
            const id = rd(r, 'id', [/^id$/i, /图片ID|编号/i]) || lib + '-' + i;
            const isFace = lib === 'face';
            const rawTags = r['标签'] ?? r.tags;
            const hair = isFace ? rd(r, 'hair', [/细分发型|发型名称|发型/]) : '';
            const cat = isFace
                ? rd(r, 'cat', [/发长/])
                : (r['大类'] || r._cat2 || (r.source && state.sourceLabels[r.source]) || r['来源'] || (r['一级分类'] === '二次元' || isAbs(thumb) ? '二次元' : '现实穿搭'));
            const rawSubCat = isFace ? hair : rd(r, 'cat2', [/^分类$/, /^类别$/, /^子分类$/, /穿搭|季节|分类/]);
            const cat2 = (!isFace && (!rawSubCat || rawSubCat === cat) && Array.isArray(rawTags) && rawTags[0]) ? String(rawTags[0]) : rawSubCat;
            const title = rd(r, 'title', isFace ? [/^标题$|^名称$/, /细分发型|发型名称/, /发型/] : [/中文.*(名|描述)|名称|款式|单品|name|title/i]) || id;
            const desc = Array.isArray(rawTags) ? rawTags.filter(Boolean).join('、') : rd(r, 'desc', [/标签|tags/i]);
            const en = rd(r, 'en', [/英文|prompt|english|关键词/i]);
            const hasViews = Array.isArray(r.views) && r.views.length > 0;
            const angles = hasViews
                ? r.views.map((v) => ({
                    angle: v.label || v.id || '',
                    thumb: fixPath(v['缩略图'] || v.thumb || '', 'thumb', dir),
                    full: fixPath(v['原图'] || v['预览图'] || v.full || '', 'full', dir),
                    id: id + '_' + (v.id || v.label || ''),
                }))
                : null;
            const defIdx = hasViews && r.selectedView ? Math.max(0, r.views.findIndex((v) => v.id === r.selectedView)) : 0;
            const item = {
                lib, id, title, cat, cat2, hair, desc, en,
                thumb: fixPath(thumb, 'thumb', dir), full: fixPath(full, 'full', dir),
                nsfw: Boolean(r.敏感) || state.nsfwRe.test(cat + ' ' + cat2),
                search: [rd(r, 'search', [/^检索$|search/i]) || allText(r), desc, cat, cat2].filter(Boolean).join(' ').toLowerCase(),
            };
            if (angles) { item.angles = angles; item.cur = defIdx; }
            return item;
        });
    }

    async function ensureLib(lib) {
        if (state.items[lib]) return;
        state.raw[lib] = await loadRaw(lib);
        state.items[lib] = lib === 'pose' ? normPose(state.raw[lib]) : normGeneric(lib, state.raw[lib]);
    }

    /* ───────────── 图片获取 ───────────── */
    function posePath(raw, kind, isDepth) {
        if (!raw || !isDepth) return raw;
        const clean = String(raw).replace(/^\/+/, '');
        if (kind === 'thumb') {
            if (clean.startsWith('thumbs/depth/')) return raw;
            if (clean.startsWith('thumbs/')) {
                return `thumbs/depth/${clean.slice('thumbs/'.length).replace(/\.(jpe?g|png)$/i, '.webp')}`;
            }
        } else {
            if (clean.startsWith('img/depth/')) return raw;
            if (clean.startsWith('img/')) {
                return `img/depth/${clean.slice('img/'.length).replace(/\.(png|jpe?g)$/i, '.webp')}`;
            }
        }
        return raw;
    }

    const thumbOf = (it, isDepth) => {
        if (it.lib === 'pose' && it.angles && it.angles.length) {
            return posePath(it.angles[it.cur]?.thumb || '', 'thumb', isDepth ?? state.poseDepth);
        }
        return it.angles ? it.angles[it.cur]?.thumb : it.thumb;
    };

    const fullOf = (it, ai, isDepth) => {
        if (it.lib === 'pose' && it.angles && it.angles.length) {
            return posePath(it.angles[ai ?? it.cur]?.full || '', 'full', isDepth ?? (state.sel.pose?.isDepth || state.poseDepth));
        }
        return it.angles ? it.angles[ai ?? it.cur]?.full : it.full;
    };

    const mimeOf = (p) => ({
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
        gif: 'image/gif', avif: 'image/avif',
    }[(p.split('?')[0].split('.').pop() || '').toLowerCase()] || 'image/jpeg');
    const retype = (b, rel) => (b.type && b.type.startsWith('image/') ? b : new Blob([b], { type: mimeOf(rel) }));

    async function fetchBlob(rel) {
        const urls = isAbs(rel) ? [rel] : state.bases.map((b) => b + rel);
        let err;
        for (const u of urls) { try { return retype(await gm(u, 'blob'), rel); } catch (e) { err = e; } }
        throw err;
    }

    // 并发闸门：同时最多 6 个请求
    let running = 0; const waiting = [];
    const slot = () => new Promise((r) => { const go = () => { running++; r(); }; running < 6 ? go() : waiting.push(go); });
    const release = () => { running--; const n = waiting.shift(); if (n) n(); };
    const tcache = new Map(), tblob = new Map();
    function thumbURL(rel) {
        if (!tcache.has(rel)) {
            tcache.set(rel, (async () => {
                await slot();
                try { const b = await fetchBlob(rel); tblob.set(rel, b); return URL.createObjectURL(b); }
                catch (e) { tcache.delete(rel); throw e; }
                finally { release(); }
            })());
        }
        return tcache.get(rel);
    }
    const toDataURL = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    function setThumb(img, rel) {
        if (!rel) return;
        thumbURL(rel).then((u) => {
            img.onerror = () => { if (!img._d && tblob.get(rel)) { img._d = 1; toDataURL(tblob.get(rel)).then((d) => (img.src = d)); } };
            img.src = u;
        }).catch(() => { img.alt = '加载失败'; });
    }

    // DSH 使用 Lexical 编辑器，webp 直接可用；转换仅在设置为 png/jpeg 时执行
    async function convertBlob(b) {
        if (settings.convert === 'none' || !/webp|avif|gif/.test(b.type)) return b;
        try {
            const bmp = await createImageBitmap(b);
            const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
            const ctx = cv.getContext('2d');
            const type = settings.convert === 'png' ? 'image/png' : 'image/jpeg';
            if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
            ctx.drawImage(bmp, 0, 0);
            bmp.close && bmp.close();
            return await new Promise((r) => cv.toBlob((x) => r(x || b), type, 0.93));
        } catch (_) { return b; }
    }

    // 输入框里已有的附件（DSH 用文件名作为 img.alt）
    const attachedNames = () => new Set([...document.querySelectorAll(SEL.attachments + ' img')].map((i) => i.alt));

    // 返回 { files, skipped }：已在输入框里的参考图不重复下载
    async function buildFiles() {
        const files = [];
        const have = attachedNames();
        let skipped = 0;
        for (const [lib] of LIBS) {
            const s = state.sel[lib];
            if (!s) continue;
            let id;
            if (s.isCustom && s.file) {
                id = 'custom_' + Date.now();
            } else {
                id = String(s.item.angles ? (s.item.angles[s.ai]?.id || s.item.id) : s.item.id).replace(/[^\w\-]+/g, '_');
                const depthTag = (lib === 'pose' && s.isDepth) ? '_depth' : '';
                const base = lib + '-' + id + depthTag;
                if ([...have].some((n) => n.startsWith(base + '.'))) { skipped++; continue; }
            }
            let blob;
            if (s.isCustom && s.file) {
                blob = await convertBlob(s.file);
            } else {
                // 严格取高清原图，仅在原图字段缺失时降级为缩略图
                const rel = fullOf(s.item, s.ai, s.isDepth) || thumbOf(s.item, s.isDepth);
                if (!rel) throw new Error(lib + ' 缺少图片地址，请检查字段映射');
                blob = await convertBlob(await fetchBlob(rel));
            }
            const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
            const depthTag = (lib === 'pose' && s.isDepth) ? '_depth' : '';
            files.push(new File([blob], lib + '-' + id + depthTag + '.' + ext, { type: blob.type }));
        }
        return { files, skipped };
    }

    /* ───────────── 提示词 ───────────── */
    function buildPrompt() {
        const { face, costume, pose } = state.sel;
        const lines = []; let n = 0;
        if (face) {
            n++;
            if (face.isCustom) {
                lines.push('图' + n + '（人像参考）：保持该人物的脸型与五官。');
            } else {
                const h = [face.item.cat, face.item.hair && face.item.hair !== face.item.cat ? face.item.hair : ''].filter(Boolean).join('·');
                lines.push('图' + n + '（人像参考）：保持该人物的脸型与五官' + (h ? '，发型参考：' + h : '') + '。');
            }
        }
        if (costume) {
            n++;
            if (costume.isCustom) {
                lines.push('图' + n + '（服装参考）：让人物穿上图中这套服装，保留款式、颜色与细节。');
            } else {
                const c = costume.item;
                const d = [c.title, c.desc].filter(Boolean).join('，');
                const ca = c.angles && c.angles[costume.ai] ? c.angles[costume.ai].angle : '';
                const cAng = ca ? '（' + ca + '视角）' : '';
                lines.push('图' + n + '（服装参考）：让人物穿上图中这套服装' + (d ? '（' + d + '）' : '') + cAng + '，保留款式、颜色与细节。' + (c.en ? '\nKeywords: ' + c.en : ''));
            }
        }
        if (pose) {
            n++;
            if (pose.isCustom) {
                lines.push('图' + n + '（姿势参考）：人物采用该图中的姿势与构图动作。');
            } else {
                const p = pose.item;
                const a = p.angles && p.angles[pose.ai] ? p.angles[pose.ai].angle : '';
                const ang = a ? '（' + a + '视角）' : '';
                if (pose.isDepth) {
                    lines.push('图' + n + '（ControlNet 深度图参考）：严格按照该深度图（Depth Map）的空间景深结构、前后距离与四肢立体动态构图生图' + ang + '。');
                } else {
                    lines.push('图' + n + '（姿势参考）：人物采用该姿势：' + p.title + ang + '。该图是无脸灰色人台线稿，只参考动作与构图，不要保留人台外观。');
                }
            }
        }
        const extra = ui.extra.value.trim();
        // 什么都没选也没写补充描述时留空，避免填入一句无意义的默认提示词
        if (!n && !extra && !settings.style) return '';
        const head = n ? '请参考我上传的 ' + n + ' 张图片，生成一张新图片：' : '请生成一张图片：';
        const tail = [settings.style && '风格：' + settings.style, extra, n ? '画质高清，细节自然，手部结构正确。' : ''].filter(Boolean);
        return [head, ...lines, ...tail].join('\n');
    }
    function refreshPrompt() { if (!state.dirty) ui.ta.value = buildPrompt(); }

    /* ───────────── DeepSeek Harness 站点适配 ───────────── */
    const SEL = {
        editor: '[data-composer-input]',
        card: '[data-composer-card]',
        attachments: '[data-slot="conversation.input.attachments"]',
        fileInput: 'input[type="file"]',
        sendBtn: 'button[aria-label="发送消息"],button[aria-label*="发送" i],button[aria-label*="Send" i]',
    };
    // DSH 未挂载（或页面不是 DSH）时返回 null
    function findEditor() {
        const ed = document.querySelector(SEL.editor);
        if (ed && ed.isContentEditable) return ed;
        return null;
    }
    function composerCard(ed) {
        return (ed && ed.closest(SEL.card)) || document.querySelector(SEL.card);
    }

    /* ───────────── 文字写入（Lexical） ─────────────
     * Lexical 只在已有选区时接受 paste；直接派发 beforeinput 在空编辑器可用，
     * 已有内容时必须先 focus + selectAll 再等一帧，让 Lexical 同步内部选区。
     */
    const norm = (s) => String(s || '').replace(/​/g, '').replace(/ /g, ' ').trim();

    async function pasteInto(ed, text) {
        const dt = new DataTransfer(); dt.setData('text/plain', text);
        ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
        await sleep(120);
        if (norm(ed.innerText).includes(norm(text).slice(0, 6))) return true;
        ed.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt }));
        await sleep(150);
        if (norm(ed.innerText).includes(norm(text).slice(0, 6))) return true;
        document.execCommand('insertText', false, text);
        await sleep(120);
        return norm(ed.innerText).includes(norm(text).slice(0, 6));
    }

    async function setText(ed, text, append) {
        const probe = norm(text).slice(0, 6);
        if (!append) {
            ed.focus();
            await sleep(60);
            document.execCommand('selectAll');
            await sleep(150); // 等 Lexical 处理 selectionchange
            if (await pasteInto(ed, text)) return;
        } else {
            const cur = norm(ed.innerText);
            const full = cur ? cur + '\n' + text : text;
            ed.focus();
            await sleep(60);
            document.execCommand('selectAll');
            await sleep(150);
            if (await pasteInto(ed, full)) return;
        }
        throw new Error('输入框未接受文字，请复制面板里的提示词手动粘贴');
    }

    /* ───────────── 附件注入 ───────────── */
    const makeDT = (files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); return dt; };
    const attachCount = () => document.querySelectorAll(SEL.attachments + ' img').length;

    function composerFileInput(ed) {
        const card = composerCard(ed);
        const scope = card || document;
        const inputs = [...scope.querySelectorAll(SEL.fileInput)];
        return inputs.find((i) => !i.accept || /image|\*|png|jpe?g|webp/i.test(i.accept)) || inputs[0] || null;
    }

    async function fillFileInput(inp, files) {
        const batches = inp.multiple ? [files] : files.map((f) => [f]);
        for (const b of batches) {
            inp.files = makeDT(b).files;
            inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            await sleep(300);
        }
    }

    const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'; };
    const UPLOAD_LABEL = /添加图片|添加文件|上传参考|上传|附件|attach|upload|reference|添加/i;
    const isUploadBtn = (b) => UPLOAD_LABEL.test(b.getAttribute('aria-label') || '') || UPLOAD_LABEL.test(b.getAttribute('title') || '');

    function clickEl(n) {
        if (!n) return;
        try { n.focus && n.focus(); } catch (_) { }
        const opts = { bubbles: true, cancelable: true, composed: true };
        n.dispatchEvent(new PointerEvent('pointerdown', opts));
        n.dispatchEvent(new MouseEvent('mousedown', opts));
        n.dispatchEvent(new PointerEvent('pointerup', opts));
        n.dispatchEvent(new MouseEvent('mouseup', opts));
        if (typeof n.click === 'function') {
            try { n.click(); } catch (_) { n.dispatchEvent(new MouseEvent('click', opts)); }
        } else {
            n.dispatchEvent(new MouseEvent('click', opts));
        }
    }

    // 接管页面对 input[type=file].click() 的调用，取得弹出的文件选择框而不弹出系统对话框
    const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    async function captureFileInput(trigger) {
        const protos = [pageWin.HTMLInputElement?.prototype, window.HTMLInputElement?.prototype].filter(Boolean);
        const origClicks = protos.map((p) => p.click);
        let captured = null;
        const known = new Set([...document.querySelectorAll(SEL.fileInput)]);
        protos.forEach((p) => {
            p.click = function () {
                if (!this.type || this.type === 'file') { captured = this; return; }
                const orig = origClicks[protos.indexOf(p)];
                return orig ? orig.apply(this, arguments) : undefined;
            };
        });
        try {
            trigger();
            for (let i = 0; i < 20 && !captured; i++) {
                await sleep(100);
                captured = [...document.querySelectorAll(SEL.fileInput)].find((n) => !known.has(n)) || null;
            }
        } finally {
            protos.forEach((p, idx) => { if (origClicks[idx]) p.click = origClicks[idx]; });
        }
        return captured;
    }

    const METHODS = {
        async file(ed, files) {
            const inp = composerFileInput(ed);
            if (!inp) return 'skip';
            await fillFileInput(inp, files);
            return 'file';
        },
        async paste(ed, files) {
            ed.focus();
            ed.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: makeDT(files) }));
            return 'paste';
        },
        async drop(ed, files) {
            const target = composerCard(ed) || ed;
            const dt = makeDT(files);
            for (const n of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(n, { bubbles: true, cancelable: true, dataTransfer: dt }));
            return 'drop';
        },
        async chooser(ed, files) {
            const card = composerCard(ed) || document;
            let btn = [...card.querySelectorAll('button,[role="button"],label')].filter(visible).find(isUploadBtn);
            if (!btn) btn = [...document.querySelectorAll('button,[role="button"],label')].filter(visible).find(isUploadBtn);
            if (!btn) return 'skip';
            // DSH 的「+」打开的是命令菜单，先点按钮，再在弹出菜单里找「上传 / 图片」项
            let inp = await captureFileInput(() => clickEl(btn));
            if (!inp) {
                const item = [...document.querySelectorAll('[role="menuitem"],[role="option"],li,button,div,span')]
                    .filter((n) => visible(n) && n.children.length <= 3)
                    .filter((n) => /^.{0,12}$/.test((n.textContent || '').trim()) && /上传|图片|文件|image|upload|file/i.test(n.textContent))
                    .pop();
                if (item) inp = await captureFileInput(() => clickEl(item));
            }
            // 菜单走不通时，直接复用输入卡片里已有的 hidden input[type=file]；
            // 先把可能弹出的菜单关掉，免得挡住面板
            if (!inp) {
                const opened = document.querySelector('[role="menu"],[role="listbox"]');
                if (opened) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                inp = composerFileInput(ed);
            }
            if (!inp) return 'skip';
            await fillFileInput(inp, files);
            return 'chooser';
        },
    };

    async function waitAttach(before, ms) {
        for (const end = Date.now() + ms; Date.now() < end; await sleep(120)) if (attachCount() > before) return true;
        return false;
    }

    async function attachFiles(ed, files) {
        // 重复点击填充时跳过输入框里已有的同名附件，避免叠加出两套一样的参考图
        const have = attachedNames();
        const fresh = files.filter((f) => !have.has(f.name));
        if (!fresh.length) return 'existing';
        files = fresh;
        // DSH 输入卡片里自带 hidden input[type=file]，直接写入最稳定；其余方式作为兜底
        const order = settings.method === 'auto' ? ['file', 'paste', 'drop', 'chooser'] : [settings.method];
        for (const m of order) {
            const before = attachCount();
            let r;
            try { r = await METHODS[m](ed, files); } catch (e) { console.warn('[dsh-ref] 注入失败', m, e); r = null; }
            if (r === 'skip' || !r) continue;
            const grew = await waitAttach(before, 4000);
            console.info('[dsh-ref] 注入图片 ' + m + ': ' + (grew ? '已检测到 ' + files.length + ' 张附件' : '未检测到附件'));
            if (grew) { await sleep(400); return m; }
        }
        return null;
    }

    async function fillChat() {
        if (state.busy) return;
        const hasSel = Object.keys(state.sel).some((k) => state.sel[k]);
        if (!hasSel && !ui.ta.value.trim()) return msg('请先选择参考图');
        const lim = getLimit();
        if (lim && Object.keys(state.sel).length > lim) return msg('最多支持 ' + lim + ' 张参考图，请先取消多余的选择');
        const ed = findEditor();
        if (!ed) return msg('没找到 DSH 输入框：请先选择一个工作区 / 打开会话');

        state.busy = true; ui.go.disabled = true; ui.go.textContent = '填充中…';
        try {
            const doText = async () => {
                await setText(findEditor() || ed, ui.ta.value, settings.append);
                await sleep(250);
            };
            if (settings.order === 'textFirst') await doText();
            let how = null, skipped = 0;
            if (hasSel) {
                msg('正在下载参考图…');
                const built = await buildFiles();
                skipped = built.skipped;
                if (built.files.length) {
                    msg('正在添加图片…');
                    how = await attachFiles(findEditor() || ed, built.files);
                    await sleep(300);
                }
            }
            if (settings.order !== 'textFirst') await doText();
            if (settings.autoSend) {
                await sleep(800);
                const b = [...document.querySelectorAll(SEL.sendBtn)].find((x) => !x.disabled && visible(x));
                if (b) b.click();
            }
            if (hasSel && !how && !skipped) { msg('文字已填入；图片未检测到，可换一种「注入方式」或手动粘贴'); return; }
            if (hasSel && !how && skipped) { msg('参考图已在输入框里，未重复添加；提示词已更新'); return; }
            msg('已填充（图片方式：' + (how || '无') + (skipped ? '，跳过 ' + skipped + ' 张已有的' : '') + '），检查后点击发送即可');
            await sleep(300);
            toggle(false);
        } catch (e) { msg('失败：' + e.message); console.error('[dsh-ref]', e); }
        finally { state.busy = false; ui.go.textContent = '填充到对话框'; updateGo(); }
    }

    /* ───────────── 界面 ───────────── */
    const host = document.createElement('div');
    host.id = 'dsh-ref-host';
    const root = host.attachShadow({ mode: 'open' });
    const CSS = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.r{--bg:#f6f7f8;--bg2:#fff;--ink:#20252b;--mu:#6b7480;--ln:#d9dde2;--ac:#4d6bfe;--ff:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;font:13px/1.4 var(--ff);color:var(--ink)}
@media (prefers-color-scheme:dark){.r:not([data-theme="light"]){--bg:#1d2126;--bg2:#272c33;--ink:#e6e9ed;--mu:#97a0ab;--ln:#3a4048;--ac:#7c93ff}}
.r[data-theme="dark"]{--bg:#1d2126;--bg2:#272c33;--ink:#e6e9ed;--mu:#97a0ab;--ln:#3a4048;--ac:#7c93ff}
.r[data-theme="light"]{--bg:#f6f7f8;--bg2:#fff;--ink:#20252b;--mu:#6b7480;--ln:#d9dde2;--ac:#4d6bfe}
.fab{position:fixed;z-index:2147483646;height:38px;padding:0 14px;border:0;border-radius:19px;background:var(--ac);color:#fff;font:600 13px var(--ff);cursor:default;box-shadow:0 2px 10px rgba(0,0,0,.3);user-select:none;-webkit-user-select:none;touch-action:none;display:flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;width:max-content;flex-shrink:0;writing-mode:horizontal-tb}
.fab.grabbing{opacity:.9}
.fab.active{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ac),0 4px 16px rgba(0,0,0,.35)}
.btn-sub{border:1px solid var(--ln);background:var(--bg);color:var(--ink);padding:3px 10px;border-radius:4px;cursor:pointer;font:11px var(--ff);white-space:nowrap}
.btn-sub:hover{border-color:var(--ac);color:var(--ac)}
.panel{position:fixed;z-index:2147483647;width:440px;min-width:280px;max-width:calc(100vw - 16px);height:min(86vh,780px);min-height:360px;max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--ln);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.3);overflow:hidden}
.panel.dragging{user-select:none;-webkit-user-select:none}
header{display:flex;align-items:center;gap:4px;padding:8px 8px 0;border-bottom:1px solid var(--ln);cursor:default;user-select:none;-webkit-user-select:none;touch-action:none}
header button,header .tabs{cursor:default}
.rh{position:absolute;z-index:10;touch-action:none}
.rh-nw{left:0;top:0;width:12px;height:12px;cursor:nwse-resize}
.rh-n{left:12px;right:12px;top:0;height:6px;cursor:ns-resize}
.rh-w{left:0;top:12px;bottom:12px;width:6px;cursor:ew-resize}
.rh-e{right:0;top:12px;bottom:12px;width:6px;cursor:ew-resize}
.rh-s{left:12px;right:12px;bottom:0;height:6px;cursor:ns-resize}
.rh-se{right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize}
.rh-ne{right:0;top:0;width:12px;height:12px;cursor:nesw-resize}
.rh-sw{left:0;bottom:0;width:12px;height:12px;cursor:nesw-resize}
.tabs{display:flex;flex:1;gap:2px;min-width:0;overflow:hidden}
.tab{padding:7px 14px;border:0;background:none;color:var(--mu);font:600 13px var(--ff);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;flex-shrink:0}
.tab.on{color:var(--ink);border-color:var(--ac)}
.h-icon,.x{border:0;background:none;color:var(--mu);cursor:pointer;width:24px;height:24px;padding:0;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.h-icon:hover,.x:hover{color:var(--ink);background:var(--bg2)}
.h-icon svg,.x svg{display:block;pointer-events:none}
.bar{display:flex;gap:6px;padding:8px}
input,select,textarea{font:12px var(--ff);color:var(--ink);background:var(--bg2);border:1px solid var(--ln);border-radius:6px;padding:5px 7px}
.bar input{flex:1;min-width:0}.bar select{max-width:110px}
.mode-bar{display:none;align-items:center;justify-content:space-between;padding:0 8px 6px}
.mode-bar.show{display:flex}
.seg{display:flex;background:var(--ln);border-radius:6px;padding:2px;gap:2px}
.seg-btn{border:0;background:none;color:var(--mu);font:600 11px var(--ff);padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap}
.seg-btn.on{background:var(--bg2);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.15)}
.meta{padding:0 10px 4px;color:var(--mu);font-size:11px}
.grid{flex:1 1 0;min-height:110px;overflow:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:max-content;gap:8px;padding:4px 8px 8px;align-content:start}
.card{min-width:0;border:1px solid var(--ln);border-radius:6px;overflow:hidden;background:var(--bg2);cursor:pointer}
.card.on{outline:2px solid var(--ac);outline-offset:-1px}
.ph{position:relative;width:100%;padding-top:133.33%;background:var(--ln)}
.ph img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}
.cap{padding:3px 5px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ang{display:flex;flex-wrap:wrap;gap:2px;padding:2px 4px 5px}
.ang button{border:1px solid var(--ln);background:none;color:var(--mu);border-radius:4px;font-size:10px;padding:1px 5px;cursor:pointer;line-height:1.2;white-space:nowrap}
.ang button.on{background:var(--ac);border-color:var(--ac);color:#fff;font-weight:600}
.tray{display:flex;gap:6px;padding:6px 8px;border-top:1px solid var(--ln)}
.tray.warn{outline:2px solid #d9534f;outline-offset:-2px}
.slot{flex:1;display:flex;align-items:center;gap:6px;min-width:0;border:1px dashed var(--ln);border-radius:6px;padding:3px 5px;font-size:11px;color:var(--mu)}
.slot.slot-empty{cursor:pointer}
.slot.slot-empty:hover{border-color:var(--ac);color:var(--ac)}
.slot img{width:26px;height:34px;object-fit:cover;border-radius:3px;cursor:zoom-in;transition:transform .15s}
.slot img:hover{transform:scale(1.08)}
.slot span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slot button{border:0;background:none;color:var(--mu);cursor:pointer;flex-shrink:0;padding:0;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.slot button:hover{color:#d9534f}
.slot button.slot-add:hover{color:var(--ac)}
.slot button svg{display:block;pointer-events:none}
details{padding:4px 10px;border-top:1px solid var(--ln)}
summary{cursor:pointer;font-weight:600;font-size:12px}
.row{display:flex;gap:6px;margin:6px 0}.row input{flex:1;min-width:0}
textarea{width:100%;resize:vertical;margin-top:2px;min-height:64px;max-height:30vh}
.link{border:0;background:none;color:var(--ac);cursor:pointer;font-size:11px;padding:2px 0}
.set-group label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;font-size:12px}
footer{position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--ln)}
#msg{flex:1;min-width:0;max-width:calc(50% - 30px);font-size:11px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ver{position:absolute;left:50%;transform:translateX(-50%);font-size:11px;color:var(--mu);pointer-events:none;white-space:nowrap;user-select:none;-webkit-user-select:none}
.go{border:0;border-radius:6px;background:var(--ac);color:#fff;padding:7px;font:600 12px var(--ff);cursor:pointer;white-space:nowrap;flex-shrink:0;margin-left:auto}
.go:disabled{opacity:.5;cursor:wait}
@media (max-height:640px){.panel{overflow-y:auto}.grid{min-height:90px}textarea{max-height:14vh}}
.grid-empty,.grid .empty{grid-column:1/-1;padding:30px 0;text-align:center;color:var(--mu)}
.modal-mask{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:30;display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(2px)}
.modal{width:100%;max-height:92%;background:var(--bg2);border:1px solid var(--ln);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--ln);font:600 13px var(--ff);color:var(--ink)}
.modal-bd{padding:12px 14px;overflow-y:auto;font-size:12px;line-height:1.6;color:var(--ink)}
.modal-sec{margin-bottom:12px}.modal-sec:last-child{margin-bottom:0}
.modal-title{font-weight:600;font-size:12px;color:var(--ink);margin-bottom:3px}
.modal-p{color:var(--mu);margin:0 0 4px}
.modal-ul{margin:0 0 6px;padding-left:16px;color:var(--mu)}
.modal-ul li{margin:2px 0}
.modal-a{color:var(--ac);text-decoration:none}.modal-a:hover{text-decoration:underline}
.modal-ft{padding:8px 14px;border-top:1px solid var(--ln);display:flex;justify-content:flex-end}
.modal-ft.modal-ft-between{justify-content:space-between;align-items:center}
.modal-btn{border:1px solid var(--ln);background:var(--bg);color:var(--ink);padding:4px 12px;border-radius:4px;cursor:pointer;font:12px var(--ff)}
.modal-btn:hover{border-color:var(--ac);color:var(--ac)}
.modal-btn.primary{background:var(--ac);color:#fff;border-color:var(--ac)}
.modal-btn.primary:hover{opacity:.9;color:#fff}
.viewer-mask{position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);user-select:none;-webkit-user-select:none}
.viewer-hd{position:absolute;top:16px;left:20px;right:20px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.viewer-title{color:#fff;font-size:13px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,.8);max-width:calc(100vw - 100px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.viewer-close{pointer-events:auto;background:rgba(255,255,255,.2);border:0;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.viewer-close:hover{background:rgba(255,255,255,.38)}
.viewer-spin{position:absolute;display:flex;flex-direction:column;align-items:center;gap:12px;color:#fff;font-size:12px;pointer-events:none;z-index:2;text-shadow:0 1px 4px rgba(0,0,0,.8)}
.viewer-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:v-spin .8s linear infinite}
@keyframes v-spin{to{transform:rotate(360deg)}}
.viewer-img{max-width:min(90vw,1200px);max-height:85vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.7);cursor:zoom-out;transition:opacity .25s ease,filter .25s ease}
.viewer-img.loading{opacity:.65;filter:blur(5px)}
.viewer-img.loaded{opacity:1;filter:none}
`;
    // 不使用 innerHTML / <style> 字符串注入，避免 Trusted Types 与 CSP 拦截
    try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; }
    catch (_) { const st = document.createElement('style'); st.textContent = CSS; root.append(st); }

    const h = (tag, props, ...kids) => {
        const e = document.createElement(tag);
        if (props) for (const [k, v] of Object.entries(props)) {
            if (k === 'class') e.className = v;
            else if (k in e) e[k] = v;
            else e.setAttribute(k, v);
        }
        kids.flat().forEach((c) => { if (c != null) e.append(c); });
        return e;
    };
    const svgNS = 'http://www.w3.org/2000/svg';
    const ICONS = {
        settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z',
        help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01',
        about: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 16v-4 M12 8h.01',
        close: 'M19 5L5 19M5 5l14 14',
        plus: 'M12 5v14M5 12h14',
    };
    const makeIcon = (type, size) => {
        const s = document.createElementNS(svgNS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('fill', 'none');
        s.setAttribute('stroke', 'currentColor');
        s.setAttribute('stroke-width', '2');
        s.setAttribute('stroke-linecap', 'round');
        s.setAttribute('stroke-linejoin', 'round');
        s.setAttribute('width', String(size || 14));
        s.setAttribute('height', String(size || 14));
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', ICONS[type] || '');
        s.append(p);
        return s;
    };
    const selK = (k, opts) => h('select', { 'data-k': k }, opts.map(([v, t]) => h('option', { value: v, textContent: t })));
    const chkK = (k) => h('input', { type: 'checkbox', 'data-k': k });
    const verText = (typeof GM_info !== 'undefined' && GM_info.script?.version) ? 'v' + GM_info.script.version : 'v0.2.0';

    root.append(h('div', { class: 'r' },
        h('button', { class: 'fab', id: 'fab', title: 'Alt+Shift+R', textContent: '参考库' }),
        h('section', { class: 'panel', id: 'panel', hidden: true },
            h('div', { class: 'rh rh-nw', 'data-dir': 'nw' }),
            h('div', { class: 'rh rh-n', 'data-dir': 'n' }),
            h('div', { class: 'rh rh-ne', 'data-dir': 'ne' }),
            h('div', { class: 'rh rh-w', 'data-dir': 'w' }),
            h('div', { class: 'rh rh-e', 'data-dir': 'e' }),
            h('div', { class: 'rh rh-sw', 'data-dir': 'sw' }),
            h('div', { class: 'rh rh-s', 'data-dir': 's' }),
            h('div', { class: 'rh rh-se', 'data-dir': 'se' }),
            h('header', null,
                h('nav', { class: 'tabs', id: 'tabs' }),
                h('button', { class: 'h-icon', id: 'btn-settings', title: '设置' }, makeIcon('settings')),
                h('button', { class: 'h-icon', id: 'btn-about', title: '关于 / 数据来源' }, makeIcon('about')),
                h('button', { class: 'h-icon', id: 'btn-help', title: '操作说明' }, makeIcon('help')),
                h('button', { class: 'x', id: 'close', title: '关闭' }, makeIcon('close'))),
            h('div', { class: 'bar' }, h('input', { id: 'q', placeholder: '搜索 中文 / English / 编号' }), h('select', { id: 'f1' }), h('select', { id: 'f2' })),
            h('div', { class: 'mode-bar', id: 'mode-bar' },
                h('span', { style: 'font-size:11px;color:var(--mu);', textContent: '姿势图视图：' }),
                h('div', { class: 'seg' },
                    h('button', { class: 'seg-btn on', id: 'btn-norm', textContent: '3D 白模' }),
                    h('button', { class: 'seg-btn', id: 'btn-depth', textContent: '🌗 深度图' }))),
            h('div', { class: 'meta', id: 'meta' }),
            h('div', { class: 'grid', id: 'grid' }),
            h('div', { class: 'tray', id: 'tray' }),
            h('details', { open: true }, h('summary', null, '提示词'),
                h('div', { class: 'row' }, h('select', { id: 'style' }), h('input', { id: 'extra', placeholder: '补充描述（可选）' })),
                h('textarea', { id: 'ta', rows: 4 }),
                h('div', { style: 'display:flex;gap:12px' },
                    h('button', { class: 'link', id: 'reset', textContent: '重置为自动生成' }),
                    h('button', { class: 'link', id: 'copy', textContent: '复制提示词' }))),
            h('footer', null,
                h('span', { id: 'msg' }),
                h('span', { id: 'ver', textContent: verText }),
                h('button', { class: 'go', id: 'go', textContent: '填充到对话框' })),
            h('div', { class: 'modal-mask', id: 'help-modal', hidden: true },
                h('div', { class: 'modal' },
                    h('div', { class: 'modal-hd' },
                        h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, makeIcon('help', 13), '操作说明'),
                        h('button', { class: 'x', id: 'help-close', title: '关闭' }, makeIcon('close'))),
                    h('div', { class: 'modal-bd' },
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '1. 挑选参考图' }),
                            h('p', { class: 'modal-p', textContent: '顶部切换「脸 / 服装 / 姿势」三个参考库，点击卡片即选中。姿势库支持多视角切换，以及 3D 白模与深度图 (Depth) 视图。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '2. 添加本地图片' }),
                            h('p', { class: 'modal-p', textContent: '底部托盘里，点击未选槽位右侧的「+」可上传本地图片，与参考库自由混搭。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '3. 查看与移除' }),
                            h('p', { class: 'modal-p', textContent: '点击托盘缩略图可全屏查看高清原图；点击右侧 × 取消该参考图。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '4. 提示词' }),
                            h('p', { class: 'modal-p', textContent: '脚本会按所选参考图自动生成中文提示词；可选择风格预设，或直接在文本框里改写。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '5. 填充到 DeepSeek Harness' }),
                            h('p', { class: 'modal-p', textContent: '点击右下角「填充到对话框」，脚本会把高清参考图与提示词写入 DSH 输入框。发送由你决定；也可在设置里开启填充后自动发送。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '6. 快捷键与排版' }),
                            h('p', { class: 'modal-p', textContent: 'Alt + Shift + R 随时呼出/收起面板。拖动悬浮图标或面板标题栏可移动，拖边缘可调整大小。' }))),
                    h('div', { class: 'modal-ft' },
                        h('button', { class: 'modal-btn', id: 'help-ok', textContent: '我知道了' })))),
            h('div', { class: 'modal-mask', id: 'settings-modal', hidden: true },
                h('div', { class: 'modal' },
                    h('div', { class: 'modal-hd' },
                        h('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, makeIcon('settings', 14), '偏好设置'),
                        h('button', { class: 'x', id: 'settings-close', title: '关闭' }, makeIcon('close'))),
                    h('div', { class: 'modal-bd' },
                        h('div', { class: 'set-group' },
                            h('label', null, '弹框吸附方位', selK('dockPos', [['auto', '自动计算'], ['left', '固定在图标左边'], ['right', '固定在图标右边'], ['top', '固定在图标上方'], ['bottom', '固定在图标下方']])),
                            h('label', null, '注入图片方式', selK('method', [['auto', '自动'], ['file', '文件框'], ['paste', '粘贴'], ['drop', '拖放'], ['chooser', '上传按钮']])),
                            h('label', null, '填充顺序', selK('order', [['imgFirst', '先图后文'], ['textFirst', '先文后图']])),
                            h('label', null, '图片格式转换', selK('convert', [['jpeg', 'webp→JPEG'], ['png', 'webp→PNG'], ['none', '不转换（推荐）']])),
                            h('label', null, '最多参考图数（留空=不限）', h('input', { type: 'number', min: 0, placeholder: '自动', 'data-k': 'maxImages', style: 'width:64px' })),
                            h('label', null, '追加到已有输入', chkK('append')),
                            h('label', null, '安全模式（隐藏性感 / 内衣 / 泳装 / 双人）', chkK('safe')),
                            h('label', null, '填充后自动发送', chkK('autoSend')),
                            h('label', null, '窗口与图标布局', h('button', { class: 'btn-sub', id: 'reset-layout', type: 'button', textContent: '重置位置与大小' })))),
                    h('div', { class: 'modal-ft' },
                        h('button', { class: 'modal-btn', id: 'settings-ok', textContent: '完成' })))),
            h('div', { class: 'modal-mask', id: 'about-modal', hidden: true },
                h('div', { class: 'modal' },
                    h('div', { class: 'modal-hd' },
                        h('span', null, '关于 / 数据来源与免责声明'),
                        h('button', { class: 'x', id: 'modal-close', title: '关闭' }, makeIcon('close'))),
                    h('div', { class: 'modal-bd' },
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '数据与素材致谢' }),
                            h('p', { class: 'modal-p' },
                                '参考库数据来自开源项目 ',
                                h('a', { class: 'modal-a', href: 'https://github.com/anhao/ai-pose-gallery-zh', target: '_blank', rel: 'noopener noreferrer', textContent: 'anhao/ai-pose-gallery-zh' }),
                                '：'),
                            h('ul', { class: 'modal-ul' },
                                h('li', null, '姿势库、人像脸库与写实/动漫穿搭原作者：ギア ', h('a', { class: 'modal-a', href: 'https://x.com/giaaibusi', target: '_blank', rel: 'noopener noreferrer', textContent: '@giaaibusi' })),
                                h('li', null, '中国历代服饰库作者：Shisei（', h('a', { class: 'modal-a', href: 'https://www.shiseicostume.com/', target: '_blank', rel: 'noopener noreferrer', textContent: 'shiseicostume.com' }), ' · CC0）'),
                                h('li', null, '二次元服装库作者：たき AI ', h('a', { class: 'modal-a', href: 'https://x.com/taki_auto', target: '_blank', rel: 'noopener noreferrer', textContent: '@taki_auto' }), ' · CharaDB'))),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '版权与授权' }),
                            h('ul', { class: 'modal-ul' },
                                h('li', null, '人像脸库与中国历代服饰库遵循 CC0 1.0 公共领域贡献协议。'),
                                h('li', null, '姿势库、其余服装库图片严禁用于二次分发、商业打包或转售。'))),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '免责声明' }),
                            h('p', { class: 'modal-p', textContent: '1. 本脚本为前端辅助工具，只在运行时从公开 CDN 节点按需获取参考图，脚本本身不打包、不转储、不再分发任何版权图片。' }),
                            h('p', { class: 'modal-p', textContent: '2. 用户选取的参考图及在 DeepSeek Harness 中生成的一切内容，均由使用者自行负责；请遵守原素材授权协议与 DeepSeek 服务条款。' })),
                        h('div', { class: 'modal-sec' },
                            h('div', { class: 'modal-title', textContent: '开源协议' }),
                            h('p', { class: 'modal-p', textContent: '本脚本遵循 MIT License。' }))),
                    h('div', { class: 'modal-ft' },
                        h('button', { class: 'modal-btn', id: 'modal-ok', textContent: '我知道了' })))),
            h('div', { class: 'viewer-mask', id: 'viewer-mask', hidden: true },
                h('div', { class: 'viewer-hd' },
                    h('span', { class: 'viewer-title', id: 'viewer-title' }),
                    h('button', { class: 'viewer-close', id: 'viewer-close', title: '关闭 (Esc)' }, makeIcon('close'))),
                h('div', { class: 'viewer-spin', id: 'viewer-spin' },
                    h('div', { class: 'viewer-spinner' }),
                    h('span', { id: 'viewer-spin-text', textContent: '正在加载高清原图…' })),
                h('img', { class: 'viewer-img', id: 'viewer-img' })))));

    const $ = (s) => root.querySelector(s);
    const ui = {
        fab: $('#fab'), panel: $('#panel'), tabs: $('#tabs'), q: $('#q'), f1: $('#f1'), f2: $('#f2'),
        modeBar: $('#mode-bar'), btnNorm: $('#btn-norm'), btnDepth: $('#btn-depth'),
        meta: $('#meta'), grid: $('#grid'), tray: $('#tray'), style: $('#style'), extra: $('#extra'),
        ta: $('#ta'), go: $('#go'), msg: $('#msg'),
        btnHelp: $('#btn-help'), btnSettings: $('#btn-settings'), btnAbout: $('#btn-about'),
        helpModal: $('#help-modal'), helpClose: $('#help-close'), helpOk: $('#help-ok'),
        aboutModal: $('#about-modal'), modalClose: $('#modal-close'), modalOk: $('#modal-ok'),
        settingsModal: $('#settings-modal'), settingsClose: $('#settings-close'), settingsOk: $('#settings-ok'),
        viewerMask: $('#viewer-mask'), viewerTitle: $('#viewer-title'), viewerImg: $('#viewer-img'), viewerClose: $('#viewer-close'),
        viewerSpin: $('#viewer-spin'), viewerSpinText: $('#viewer-spin-text'),
        resetLayout: $('#reset-layout'),
    };
    const msg = (t) => { ui.msg.textContent = t; ui.msg.title = t; };
    const cardMap = new Map();

    // 跟随 DeepSeek Harness 自己的主题（它不一定会改系统的 prefers-color-scheme）
    function syncTheme() {
        const de = document.documentElement;
        const attr = de.getAttribute('data-ds-theme') || de.getAttribute('data-theme') || '';
        const scheme = (de.style.colorScheme || getComputedStyle(de).colorScheme || '').toLowerCase();
        const src = (de.getAttribute('data-ds-theme-source') || '').toLowerCase();
        let theme = '';
        if (/dark/.test(attr) || /dark/.test(scheme) || src === 'dark') theme = 'dark';
        else if (/light/.test(attr) || /light/.test(scheme) || src === 'light') theme = 'light';
        const r = root.querySelector('.r');
        if (r) {
            if (theme) r.dataset.theme = theme;
            else delete r.dataset.theme;
        }
    }
    syncTheme();
    new MutationObserver(syncTheme).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-ds-theme', 'data-theme', 'data-ds-theme-source', 'style', 'class'],
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncTheme);

    const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); setThumb(e.target, e.target.dataset.rel); } });
    }, { root: ui.grid, rootMargin: '200px' });

    function visibleItems() {
        const words = String(state.q).trim().toLowerCase().split(/\s+/).filter(Boolean);
        return (state.items[state.tab] || []).filter((it) =>
            (!settings.safe || !it.nsfw) && (!state.f1 || it.cat === state.f1) && (!state.f2 || it.cat2 === state.f2) && words.every((w) => it.search.includes(w)));
    }

    function updateSubFilter(keepVal) {
        const items = (state.items[state.tab] || []).filter((it) => (!settings.safe || !it.nsfw) && (!state.f1 || it.cat === state.f1));
        const [, l2] = LABELS[state.tab];
        ui.f2.hidden = !l2;
        if (!l2) { state.f2 = ''; return; }
        const vals = [...new Set(items.map((i) => i.cat2).filter(Boolean))];
        ui.f2.replaceChildren(h('option', { value: '', textContent: '全部' + l2 }), ...vals.map((v) => h('option', { value: v, textContent: v })));
        if (keepVal && state.f2 && vals.includes(state.f2)) ui.f2.value = state.f2;
        else { state.f2 = ''; ui.f2.value = ''; }
    }

    function renderFilters() {
        const items = (state.items[state.tab] || []).filter((it) => !settings.safe || !it.nsfw);
        const [l1] = LABELS[state.tab];
        ui.f1.hidden = !l1;
        if (l1) {
            const vals = [...new Set(items.map((i) => i.cat).filter(Boolean))];
            ui.f1.replaceChildren(h('option', { value: '', textContent: '全部' + l1 }), ...vals.map((v) => h('option', { value: v, textContent: v })));
        }
        state.f1 = ''; state.f2 = '';
        updateSubFilter(false);
    }

    function renderGrid() {
        ui.grid.replaceChildren(); cardMap.clear();
        state.list = visibleItems(); state.shown = 0;
        const depthNote = (state.tab === 'pose' && state.poseDepth) ? ' · 深度图视图' : '';
        const lim = getLimit();
        ui.meta.textContent = '共 ' + state.list.length + ' 项' + (settings.safe ? '（安全模式）' : '') + depthNote + (lim ? ' · 最多选 ' + lim + ' 张' : '');
        if (!state.list.length) { ui.grid.replaceChildren(h('div', { class: 'empty', textContent: '没有匹配的内容' })); return; }
        more();
    }
    function more() {
        state.list.slice(state.shown, state.shown + 48).forEach((it) => ui.grid.appendChild(card(it)));
        state.shown = Math.min(state.shown + 48, state.list.length);
    }
    ui.grid.addEventListener('scroll', () => {
        if (state.shown < state.list.length && ui.grid.scrollTop + ui.grid.clientHeight > ui.grid.scrollHeight - 500) more();
    });

    const isSel = (it) => {
        const s = state.sel[it.lib];
        if (!s || s.item !== it) return false;
        if (it.angles && s.ai !== it.cur) return false;
        if (it.lib === 'pose' && s.isDepth !== state.poseDepth) return false;
        return true;
    };

    function card(it) {
        const d = document.createElement('div');
        d.className = 'card' + (isSel(it) ? ' on' : '');
        const img = document.createElement('img'); img.dataset.rel = thumbOf(it, state.poseDepth);
        const ph = document.createElement('div'); ph.className = 'ph'; ph.appendChild(img);
        const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = it.title; cap.title = it.title;
        d.append(ph, cap);
        if (it.angles && it.angles.length > 1) {
            const a = document.createElement('div'); a.className = 'ang';
            it.angles.forEach((ag, i) => {
                const b = document.createElement('button');
                b.textContent = ag.angle || (i + 1);
                b.className = i === it.cur ? 'on' : '';
                b.title = (ag.angle || '') + '视角';
                b.onclick = (ev) => {
                    ev.stopPropagation();
                    it.cur = i;
                    a.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i));
                    const newRel = thumbOf(it, state.poseDepth);
                    img.dataset.rel = newRel;
                    setThumb(img, newRel);
                    select(it, true);
                };
                a.appendChild(b);
            });
            d.appendChild(a);
        }
        d.onclick = () => select(it);
        cardMap.set(it, d); io.observe(img);
        return d;
    }

    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
    uploadInput.style.display = 'none';
    root.append(uploadInput);
    let uploadTargetLib = null;

    uploadInput.addEventListener('change', () => {
        const file = uploadInput.files && uploadInput.files[0];
        if (!file || !uploadTargetLib) return;
        if (!file.type || !file.type.startsWith('image/')) return msg('请选择有效的图片文件');
        const lim = getLimit();
        if (!state.sel[uploadTargetLib] && lim && Object.keys(state.sel).length >= lim) {
            msg('最多支持 ' + lim + ' 张参考图，请先取消已选的一项');
            ui.tray.classList.add('warn'); setTimeout(() => ui.tray.classList.remove('warn'), 1500);
            return;
        }
        if (state.sel[uploadTargetLib]?.url) { try { URL.revokeObjectURL(state.sel[uploadTargetLib].url); } catch (_) { } }
        const url = URL.createObjectURL(file);
        state.sel[uploadTargetLib] = {
            isCustom: true, file, url,
            item: { lib: uploadTargetLib, id: 'custom-' + uploadTargetLib + '-' + Date.now(), title: file.name.replace(/\.[^.]+$/, '') || file.name, full: url, thumb: url },
            ai: 0, isDepth: false,
        };
        cardMap.forEach((el, k) => el.classList.toggle('on', isSel(k)));
        renderTray(); refreshPrompt();
        msg('已选择自定义参考图');
        autoAdvanceTab(uploadTargetLib);
    });

    function autoAdvanceTab(currentLib) {
        const idx = LIBS.findIndex(([k]) => k === currentLib);
        if (idx === -1) return;
        for (let i = idx + 1; i < LIBS.length; i++) {
            const next = LIBS[i][0];
            if (!state.sel[next]) { switchTab(next); return; }
        }
    }

    function select(it, forceOn) {
        const turningOn = !(isSel(it) && !forceOn);
        const lim = getLimit();
        if (turningOn && !state.sel[it.lib] && lim && Object.keys(state.sel).length >= lim) {
            msg('最多支持 ' + lim + ' 张参考图，请先取消已选的一项');
            ui.tray.classList.add('warn'); setTimeout(() => ui.tray.classList.remove('warn'), 1500);
            return;
        }
        if (state.sel[it.lib]?.isCustom && state.sel[it.lib]?.url) { try { URL.revokeObjectURL(state.sel[it.lib].url); } catch (_) { } }
        if (isSel(it) && !forceOn) delete state.sel[it.lib];
        else state.sel[it.lib] = { item: it, ai: it.cur, isDepth: it.lib === 'pose' ? !!state.poseDepth : false };
        cardMap.forEach((el, k) => el.classList.toggle('on', isSel(k)));
        renderTray(); refreshPrompt();
        if (turningOn) autoAdvanceTab(it.lib);
    }

    let viewerLoadId = 0;
    function openImageViewer(s, label) {
        if (!s) return;
        viewerLoadId++;
        const currentLoadId = viewerLoadId;
        const lib = s.item?.lib;
        const angName = (s.item?.angles && s.item?.angles[s.ai]) ? s.item.angles[s.ai].angle : '';
        const depthBadge = (lib === 'pose' && s.isDepth) ? ' [深度图]' : '';
        const customBadge = s.isCustom ? ' [自定义]' : '';
        ui.viewerTitle.textContent = label + '参考：' + (s.item?.title || '自定义图片') + (angName ? '·' + angName : '') + depthBadge + customBadge;
        ui.viewerMask.hidden = false;

        if (s.isCustom && s.url) {
            ui.viewerSpin.hidden = true;
            ui.viewerImg.className = 'viewer-img loaded';
            ui.viewerImg.src = s.url;
            return;
        }

        ui.viewerSpin.hidden = false;
        ui.viewerSpinText.textContent = '正在加载高清原图…';
        ui.viewerImg.className = 'viewer-img loading';
        const thumbRel = lib === 'pose' ? thumbOf(s.item, s.isDepth) : thumbOf(s.item);
        if (thumbRel && tcache.has(thumbRel)) {
            thumbURL(thumbRel).then((u) => {
                if (currentLoadId === viewerLoadId && ui.viewerImg.classList.contains('loading')) ui.viewerImg.src = u;
            }).catch(() => { });
        }
        const fullRel = (lib === 'pose' ? fullOf(s.item, s.ai, s.isDepth) : fullOf(s.item, s.ai)) || thumbRel;
        if (!fullRel) { ui.viewerSpin.hidden = true; ui.viewerImg.className = 'viewer-img loaded'; return; }
        const handleReadyUrl = (u) => {
            if (currentLoadId !== viewerLoadId) return;
            const pre = new Image();
            pre.onload = () => {
                if (currentLoadId !== viewerLoadId) return;
                ui.viewerImg.src = u;
                ui.viewerImg.className = 'viewer-img loaded';
                ui.viewerSpin.hidden = true;
            };
            pre.onerror = () => {
                if (currentLoadId !== viewerLoadId) return;
                ui.viewerImg.className = 'viewer-img loaded';
                ui.viewerSpinText.textContent = '高清原图加载失败';
                setTimeout(() => { if (currentLoadId === viewerLoadId) ui.viewerSpin.hidden = true; }, 1500);
            };
            pre.src = u;
        };
        if (isAbs(fullRel)) handleReadyUrl(fullRel);
        else thumbURL(fullRel).then(handleReadyUrl).catch(() => {
            if (currentLoadId !== viewerLoadId) return;
            ui.viewerImg.className = 'viewer-img loaded';
            ui.viewerSpinText.textContent = '原图加载失败';
            setTimeout(() => { if (currentLoadId === viewerLoadId) ui.viewerSpin.hidden = true; }, 1500);
        });
    }

    function closeImageViewer() {
        viewerLoadId++;
        ui.viewerMask.hidden = true;
        ui.viewerSpin.hidden = true;
        ui.viewerImg.src = '';
        ui.viewerImg.className = 'viewer-img';
    }

    function renderTray() {
        ui.tray.replaceChildren();
        LIBS.forEach(([lib, label]) => {
            const s = state.sel[lib];
            const d = document.createElement('div');
            if (!s) {
                d.className = 'slot slot-empty';
                d.title = label + '：未选，点击添加自定义本地图片';
                const t = document.createElement('span'); t.textContent = label + '：未选';
                const plusBtn = document.createElement('button');
                plusBtn.className = 'slot-add'; plusBtn.type = 'button'; plusBtn.title = '添加自定义图片';
                plusBtn.appendChild(makeIcon('plus', 11));
                d.append(t, plusBtn);
                d.onclick = () => { uploadTargetLib = lib; uploadInput.value = ''; uploadInput.click(); };
            } else {
                d.className = 'slot';
                const im = document.createElement('img');
                im.title = '点击放大查看原图';
                im.onclick = (ev) => { ev.stopPropagation(); openImageViewer(s, label); };
                if (s.isCustom) im.src = s.url;
                else setThumb(im, lib === 'pose' ? posePath(s.item.angles ? s.item.angles[s.ai]?.thumb : s.item.thumb, 'thumb', s.isDepth) : (s.item.angles ? s.item.angles[s.ai]?.thumb : s.item.thumb));
                const angName = (s.item.angles && s.item.angles[s.ai]) ? s.item.angles[s.ai].angle : '';
                const depthBadge = (lib === 'pose' && s.isDepth) ? ' [深度图]' : '';
                const customBadge = s.isCustom ? ' [自定义]' : '';
                const t = document.createElement('span');
                t.textContent = label + '：' + (s.item.title || '自定义') + (angName ? '·' + angName : '') + depthBadge + customBadge;
                t.title = t.textContent;
                const x = document.createElement('button');
                x.type = 'button'; x.className = 'slot-del'; x.title = '取消选择';
                x.appendChild(makeIcon('close', 10));
                x.onclick = (ev) => {
                    ev.stopPropagation();
                    if (s.isCustom && s.url) { try { URL.revokeObjectURL(s.url); } catch (_) { } }
                    delete state.sel[lib];
                    cardMap.forEach((el, k) => el.classList.toggle('on', isSel(k)));
                    renderTray(); refreshPrompt();
                };
                d.append(im, t, x);
            }
            ui.tray.appendChild(d);
        });
        updateGo();
    }
    // 只有提示词、没有参考图时也允许填充
    function updateGo() {
        ui.go.disabled = state.busy || (!Object.keys(state.sel).length && !ui.ta.value.trim());
    }

    async function switchTab(tab) {
        state.tab = tab;
        ui.tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
        ui.modeBar.classList.toggle('show', tab === 'pose');
        ui.grid.replaceChildren(h('div', { class: 'empty', textContent: '加载中…' })); ui.meta.textContent = '';
        try { await ensureLib(tab); }
        catch (e) { ui.grid.replaceChildren(h('div', { class: 'empty' }, '加载失败：' + e.message, h('br'), '可稍后重试，或检查网络')); return; }
        if (state.tab !== tab) return;
        renderFilters(); renderGrid();
    }

    /* 初始化 UI */
    LIBS.forEach(([k, n]) => {
        const b = document.createElement('button'); b.className = 'tab'; b.dataset.t = k; b.textContent = n;
        b.onclick = () => switchTab(k); ui.tabs.appendChild(b);
    });
    STYLES.forEach(([n, v]) => { const o = document.createElement('option'); o.textContent = n; o.value = v; ui.style.appendChild(o); });
    ui.style.value = settings.style;
    ui.style.onchange = () => { settings.style = ui.style.value; saveSettings(); refreshPrompt(); };
    ui.extra.oninput = () => { refreshPrompt(); updateGo(); };
    ui.ta.oninput = () => { state.dirty = true; updateGo(); };
    $('#reset').onclick = () => { state.dirty = false; refreshPrompt(); updateGo(); };
    $('#copy').onclick = async () => {
        const t = ui.ta.value;
        if (!t.trim()) return msg('提示词为空');
        try {
            if (typeof GM_setClipboard === 'function') GM_setClipboard(t);
            else await navigator.clipboard.writeText(t);
            msg('提示词已复制');
        } catch (_) {
            ui.ta.select();
            msg('已选中提示词，请按 Ctrl+C 复制');
        }
    };
    root.querySelectorAll('[data-k]').forEach((c) => {
        const k = c.dataset.k;
        if (c.type === 'checkbox') c.checked = !!settings[k]; else c.value = settings[k];
        c.onchange = () => {
            settings[k] = c.type === 'checkbox' ? c.checked : c.value;
            saveSettings();
            if (k === 'safe') { renderFilters(); renderGrid(); }
            if (k === 'maxImages') renderGrid();
            if (k === 'dockPos' && !ui.panel.hidden) anchorPanel();
        };
    });
    let tmr; ui.q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = ui.q.value; renderGrid(); }, 150); };
    ui.f1.onchange = () => { state.f1 = ui.f1.value; updateSubFilter(true); renderGrid(); };
    ui.f2.onchange = () => { state.f2 = ui.f2.value; renderGrid(); };

    const setPoseDepth = (depth) => {
        if (state.poseDepth === depth) return;
        state.poseDepth = depth;
        ui.btnNorm.classList.toggle('on', !depth);
        ui.btnDepth.classList.toggle('on', depth);
        renderGrid();
    };
    ui.btnNorm.onclick = () => setPoseDepth(false);
    ui.btnDepth.onclick = () => setPoseDepth(true);
    ui.go.onclick = fillChat;

    const closeAllModals = () => {
        ui.aboutModal.hidden = true;
        ui.settingsModal.hidden = true;
        ui.helpModal.hidden = true;
        closeImageViewer();
    };
    const openModal = (m) => { closeAllModals(); m.hidden = false; };
    ui.btnHelp.onclick = (e) => { e.stopPropagation(); openModal(ui.helpModal); };
    ui.helpClose.onclick = closeAllModals;
    ui.helpOk.onclick = closeAllModals;
    ui.helpModal.onclick = (e) => { if (e.target === ui.helpModal) closeAllModals(); };
    ui.btnAbout.onclick = (e) => { e.stopPropagation(); openModal(ui.aboutModal); };
    ui.modalClose.onclick = closeAllModals;
    ui.modalOk.onclick = closeAllModals;
    ui.aboutModal.onclick = (e) => { if (e.target === ui.aboutModal) closeAllModals(); };
    ui.btnSettings.onclick = (e) => { e.stopPropagation(); openModal(ui.settingsModal); };
    ui.settingsClose.onclick = closeAllModals;
    ui.settingsOk.onclick = closeAllModals;
    ui.settingsModal.onclick = (e) => { if (e.target === ui.settingsModal) closeAllModals(); };
    ui.viewerClose.onclick = closeImageViewer;
    ui.viewerMask.onclick = (e) => { if (e.target === ui.viewerMask || e.target === ui.viewerImg) closeImageViewer(); };

    /* ───────────── 拖拽、缩放、锚定与位置持久化 ───────────── */
    function defaultFabPos() {
        const vw = window.innerWidth, vh = window.innerHeight;
        return { x: Math.max(8, vw - 88 - 16), y: Math.max(8, vh - 38 - 96) };
    }
    const getStoredFabPos = () => GM_get('fab_pos', null);
    const saveFabPos = (pos) => GM_set('fab_pos', pos);
    function clampFabPos(pos) {
        const vw = window.innerWidth, vh = window.innerHeight;
        const fw = ui.fab.offsetWidth || 88, fh = ui.fab.offsetHeight || 38;
        return { x: Math.max(8, Math.min(pos.x, vw - fw - 8)), y: Math.max(8, Math.min(pos.y, vh - fh - 8)) };
    }
    function applyFabPos(pos) {
        const p = clampFabPos(pos);
        ui.fab.style.left = p.x + 'px';
        ui.fab.style.top = p.y + 'px';
        ui.fab.style.right = 'auto';
        ui.fab.style.bottom = 'auto';
        return p;
    }
    const getStoredRect = () => GM_get('panel_rect', null);
    function saveRect(rect) {
        // 隐藏状态（display:none）下 getBoundingClientRect 全是 0，写入会毁掉已保存的尺寸
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return;
        GM_set('panel_rect', rect);
    }

    function anchorPanel() {
        const fabRect = ui.fab.getBoundingClientRect();
        const stored = getStoredRect() || {};
        const vw = window.innerWidth, vh = window.innerHeight;
        const pw = Math.max(320, Math.min(stored.w > 0 ? stored.w : 440, vw - 16));
        const ph = Math.max(360, Math.min(stored.h > 0 ? stored.h : Math.min(Math.round(vh * 0.86), 780), vh - 16));
        const GAP = 10;
        const leftSpace = fabRect.left - GAP - 8;
        const rightSpace = vw - fabRect.right - GAP - 8;
        const topSpace = fabRect.top - GAP - 8;
        const bottomSpace = vh - fabRect.bottom - GAP - 8;
        let placement = settings.dockPos || 'auto';

        if (placement === 'auto') {
            const isRightHalf = (fabRect.left + fabRect.width / 2) > (vw / 2);
            const isBottomHalf = (fabRect.top + fabRect.height / 2) > (vh / 2);
            if (isRightHalf && leftSpace >= pw) placement = 'left';
            else if (!isRightHalf && rightSpace >= pw) placement = 'right';
            else if (isBottomHalf && topSpace >= ph) placement = 'top';
            else if (!isBottomHalf && bottomSpace >= ph) placement = 'bottom';
            else {
                const maxSpace = Math.max(leftSpace, rightSpace, topSpace, bottomSpace);
                placement = maxSpace === leftSpace ? 'left' : maxSpace === rightSpace ? 'right' : maxSpace === topSpace ? 'top' : 'bottom';
            }
        }

        let targetX = 0, targetY = 0;
        if (placement === 'left') {
            targetX = fabRect.left - GAP - pw;
            if (targetX < 8 && rightSpace > leftSpace) targetX = fabRect.right + GAP;
            targetY = fabRect.bottom - ph;
        } else if (placement === 'right') {
            targetX = fabRect.right + GAP;
            if (targetX + pw > vw - 8 && leftSpace > rightSpace) targetX = fabRect.left - GAP - pw;
            targetY = fabRect.bottom - ph;
        } else if (placement === 'top') {
            targetY = fabRect.top - GAP - ph;
            if (targetY < 8 && bottomSpace > topSpace) targetY = fabRect.bottom + GAP;
            targetX = fabRect.right - pw;
        } else {
            targetY = fabRect.bottom + GAP;
            if (targetY + ph > vh - 8 && topSpace > bottomSpace) targetY = fabRect.top - GAP - ph;
            targetX = fabRect.right - pw;
        }
        targetX = Math.max(8, Math.min(targetX, vw - pw - 8));
        targetY = Math.max(8, Math.min(targetY, vh - ph - 8));
        ui.panel.style.left = targetX + 'px';
        ui.panel.style.top = targetY + 'px';
        ui.panel.style.right = 'auto';
        ui.panel.style.bottom = 'auto';
        ui.panel.style.width = pw + 'px';
        ui.panel.style.height = ph + 'px';
        saveRect({ x: targetX, y: targetY, w: pw, h: ph });
    }

    const fabDrag = { active: false, moved: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 };
    ui.fab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        fabDrag.active = true; fabDrag.moved = false;
        fabDrag.startX = e.clientX; fabDrag.startY = e.clientY;
        const rect = ui.fab.getBoundingClientRect();
        fabDrag.initLeft = rect.left; fabDrag.initTop = rect.top;
        try { ui.fab.setPointerCapture(e.pointerId); } catch (_) { }
    });
    ui.fab.addEventListener('pointermove', (e) => {
        if (!fabDrag.active) return;
        const dx = e.clientX - fabDrag.startX, dy = e.clientY - fabDrag.startY;
        if (!fabDrag.moved && Math.hypot(dx, dy) > 4) {
            fabDrag.moved = true; state.fabDragging = true; ui.fab.classList.add('grabbing');
        }
        if (fabDrag.moved) {
            const vw = window.innerWidth, vh = window.innerHeight;
            const fw = ui.fab.offsetWidth || 88, fh = ui.fab.offsetHeight || 38;
            applyFabPos({
                x: Math.max(8, Math.min(fabDrag.initLeft + dx, vw - fw - 8)),
                y: Math.max(8, Math.min(fabDrag.initTop + dy, vh - fh - 8)),
            });
            if (!ui.panel.hidden) anchorPanel();
        }
    });
    const onFabUp = (e) => {
        if (!fabDrag.active) return;
        fabDrag.active = false;
        ui.fab.classList.remove('grabbing');
        try { ui.fab.releasePointerCapture(e.pointerId); } catch (_) { }
        if (fabDrag.moved) {
            const cur = ui.fab.getBoundingClientRect();
            saveFabPos({ x: cur.left, y: cur.top });
            setTimeout(() => { state.fabDragging = false; }, 60);
        } else {
            state.fabDragging = false;
            toggle();
        }
    };
    ui.fab.addEventListener('pointerup', onFabUp);
    ui.fab.addEventListener('pointercancel', onFabUp);

    const headerEl = ui.panel.querySelector('header');
    headerEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, nav, input, select')) return;
        e.preventDefault();
        state.dragging = true;
        headerEl.classList.add('grabbing');
        ui.panel.classList.add('dragging');
        const pRect = ui.panel.getBoundingClientRect();
        const fRect = ui.fab.getBoundingClientRect();
        const startX = e.clientX, startY = e.clientY;
        const initPLeft = pRect.left, initPTop = pRect.top;
        const initFLeft = fRect.left, initFTop = fRect.top;
        const pw = pRect.width, ph = pRect.height, fw = fRect.width, fh = fRect.height;
        const onMove = (ev) => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            const vw = window.innerWidth, vh = window.innerHeight;
            const newPX = Math.max(8, Math.min(initPLeft + dx, vw - pw - 8));
            const newPY = Math.max(8, Math.min(initPTop + dy, vh - ph - 8));
            const effectiveDX = newPX - initPLeft, effectiveDY = newPY - initPTop;
            ui.panel.style.left = newPX + 'px';
            ui.panel.style.top = newPY + 'px';
            applyFabPos({
                x: Math.max(8, Math.min(initFLeft + effectiveDX, vw - fw - 8)),
                y: Math.max(8, Math.min(initFTop + effectiveDY, vh - fh - 8)),
            });
        };
        const onUp = () => {
            state.dragging = false;
            headerEl.classList.remove('grabbing');
            ui.panel.classList.remove('dragging');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const curP = ui.panel.getBoundingClientRect();
            saveRect({ x: curP.left, y: curP.top, w: curP.width, h: curP.height });
            const curF = ui.fab.getBoundingClientRect();
            saveFabPos({ x: curF.left, y: curF.top });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });

    root.querySelectorAll('.rh').forEach((rh) => {
        rh.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            state.resizing = true;
            ui.panel.classList.add('dragging');
            const dir = rh.dataset.dir;
            const rect = ui.panel.getBoundingClientRect();
            const startX = e.clientX, startY = e.clientY;
            const initLeft = rect.left, initTop = rect.top, initW = rect.width, initH = rect.height;
            const onMove = (ev) => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                const vw = window.innerWidth, vh = window.innerHeight;
                let newLeft = initLeft, newTop = initTop, newW = initW, newH = initH;
                if (dir.includes('e')) newW = Math.max(320, Math.min(initW + dx, vw - initLeft - 8));
                if (dir.includes('s')) newH = Math.max(360, Math.min(initH + dy, vh - initTop - 8));
                if (dir.includes('w')) {
                    const proposedW = initW - dx;
                    if (proposedW >= 320) {
                        const proposedLeft = initLeft + dx;
                        if (proposedLeft >= 8) { newW = proposedW; newLeft = proposedLeft; }
                    }
                }
                if (dir.includes('n')) {
                    const proposedH = initH - dy;
                    if (proposedH >= 360) {
                        const proposedTop = initTop + dy;
                        if (proposedTop >= 8) { newH = proposedH; newTop = proposedTop; }
                    }
                }
                ui.panel.style.left = newLeft + 'px';
                ui.panel.style.top = newTop + 'px';
                ui.panel.style.right = 'auto';
                ui.panel.style.bottom = 'auto';
                ui.panel.style.width = newW + 'px';
                ui.panel.style.height = newH + 'px';
            };
            const onUp = () => {
                state.resizing = false;
                ui.panel.classList.remove('dragging');
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                const cur = ui.panel.getBoundingClientRect();
                saveRect({ x: cur.left, y: cur.top, w: cur.width, h: cur.height });
                anchorPanel();
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    });

    function resetLayout() {
        GM_del('fab_pos'); GM_del('panel_rect');
        const defFab = defaultFabPos();
        applyFabPos(defFab); saveFabPos(defFab);
        saveRect({ w: 440, h: Math.min(Math.round(window.innerHeight * 0.86), 780) });
        anchorPanel();
        msg('已重置图标位置与弹框默认大小');
    }
    ui.resetLayout.onclick = resetLayout;

    function toggle(open) {
        const show = open ?? ui.panel.hidden;
        ui.panel.hidden = !show;
        ui.fab.classList.toggle('active', show);
        if (show) {
            // 窗口很矮时先收起提示词，把空间让给参考图网格
            const det = ui.panel.querySelector('details');
            if (det) det.open = window.innerHeight > 620;
            anchorPanel();
            if (!state.items[state.tab] && !state.loading) {
                state.loading = true;
                switchTab(state.tab).finally(() => { state.loading = false; });
            }
        } else closeAllModals();
    }
    $('#close').onclick = () => toggle(false);

    addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && e.code === 'KeyR') { e.preventDefault(); toggle(); }
        if (e.key === 'Escape' && (!ui.aboutModal.hidden || !ui.settingsModal.hidden || !ui.helpModal.hidden || !ui.viewerMask.hidden)) closeAllModals();
    }, true);

    // 点击面板外自动隐藏
    addEventListener('pointerdown', (e) => {
        if (ui.panel.hidden) return;
        if (state.dragging || state.resizing || state.fabDragging) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (path.includes(host) || path.includes(ui.panel) || path.includes(ui.fab) || path.includes(ui.viewerMask)) return;
        toggle(false);
    }, true);

    addEventListener('resize', () => {
        const curFab = getStoredFabPos() || defaultFabPos();
        applyFabPos(curFab);
        if (!ui.panel.hidden) anchorPanel();
    });

    renderTray(); refreshPrompt();

    /* ───────────── 挂载 ───────────── */
    // @match 覆盖整个 127.0.0.1 / localhost，因此必须先确认页面上是 DeepSeek Harness，
    // 否则不要在无关的本地服务里显示悬浮按钮。
    const isDSH = () => !!document.querySelector(SEL.card + ',' + SEL.editor) ||
        document.documentElement.hasAttribute('data-ds-theme-source') ||
        /DeepSeek\s*Harness/i.test(document.title || '');

    function mount() {
        try {
            if (!host.isConnected) document.documentElement.appendChild(host);
        } catch (_) { }
        applyFabPos(getStoredFabPos() || defaultFabPos());
    }

    let waited = 0;
    const boot = setInterval(() => {
        waited += 1000;
        if (isDSH()) {
            clearInterval(boot);
            mount();
            console.info('[dsh-ref] 已加载 ' + verText + ' @ ' + location.origin);
            // DSH 是 SPA，可能重建 <html>/<body>；只在 DSH 页面上补挂
            setInterval(() => { if (!host.isConnected && isDSH()) mount(); }, 2000);
        } else if (waited >= 30000) {
            clearInterval(boot); // 30 秒内没识别到 DSH：静默退出，不影响其他本地页面
        }
    }, 1000);
    if (isDSH()) { clearInterval(boot); mount(); }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开 / 关闭参考库', () => toggle());
        GM_registerMenuCommand('调试：输出当前输入框信息', () => {
            const e = findEditor();
            console.log('[dsh-ref] editor', e, e && e.outerHTML.slice(0, 800));
        });
        GM_registerMenuCommand('诊断：复制输入框结构（反馈问题用）', () => {
            const e = findEditor();
            if (!e) return alert('没找到 DSH 输入框，请先打开一个会话再试');
            const d = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') +
                ' [' + [...n.attributes].filter((a) => a.name !== 'class').map((a) => a.name + '=' + a.value.slice(0, 40)).join(' ') + ']';
            const chain = [];
            for (let n = e, i = 0; n && i < 7; n = n.parentElement, i++) chain.push(d(n));
            const files = [...document.querySelectorAll('input[type="file"]')].map((i) => i.outerHTML.slice(0, 200));
            const report = ['host: ' + location.origin, '祖先链(自身→外层):', ...chain,
                '输入框 outerHTML:', e.outerHTML.slice(0, 1200),
                'input[type=file] (' + files.length + '):', ...files].join('\n');
            console.log('[dsh-ref] 诊断\n' + report);
            try { GM_setClipboard(report); alert('已复制诊断信息到剪贴板'); } catch (_) { alert('请从控制台复制 [dsh-ref] 诊断 输出'); }
        });
        GM_registerMenuCommand('清除数据缓存', () => {
            LIBS.forEach(([k]) => { GM_del('cache_v5_' + k); });
            alert('已清除数据缓存，刷新页面后重新拉取全量数据');
        });
    }
})();

    }

    exports.isPlugin = true
    exports.inject = []
    exports.apply = () => {
      try {
        start()
      } catch (err) {
        window.__dshRefError = (err && err.stack) || String(err)
        console.error('[dsh-ref-autofill] 启动失败', err)
        throw err
      }
    }
    return module.exports
  },
})
