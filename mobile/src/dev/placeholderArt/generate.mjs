/**
 * Placeholder art generator. Writes PNGs and manifest.ts next to this file.
 * Run from mobile/: node src/dev/placeholderArt/generate.mjs
 * Dependency-free: a tiny rasteriser and a zlib PNG encoder.
 * The real art lands in mobile/assets/game/ and replaces all of this (see src/art/index.ts).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCATION_LAYOUT, MAP_HEIGHT, MAP_WIDTH, ROUTE_WAYPOINTS } from '../../../shared/mapLayout.ts';
import { LOCATIONS, LOCATION_IDS, RESOURCES, ROUTES, SPRITE_ARCHETYPES, SPRITE_VARIANTS, routeKey } from '../../../shared/colony.ts';
const OUT = dirname(fileURLToPath(import.meta.url));
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const hex = (h, a = 255) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};
const shade = (c, f) => [
    Math.max(0, Math.min(255, Math.round(c[0] * f))),
    Math.max(0, Math.min(255, Math.round(c[1] * f))),
    Math.max(0, Math.min(255, Math.round(c[2] * f))),
    c[3],
];
class Img {
    data;
    w;
    h;
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.data = new Uint8Array(w * h * 4);
    }
    set(x, y, c) {
        x |= 0;
        y |= 0;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h)
            return;
        const i = (y * this.w + x) * 4;
        const a = c[3] / 255;
        if (a >= 1) {
            this.data[i] = c[0];
            this.data[i + 1] = c[1];
            this.data[i + 2] = c[2];
            this.data[i + 3] = 255;
            return;
        }
        const da = this.data[i + 3] / 255;
        const oa = a + da * (1 - a);
        if (oa <= 0)
            return;
        this.data[i] = Math.round((c[0] * a + this.data[i] * da * (1 - a)) / oa);
        this.data[i + 1] = Math.round((c[1] * a + this.data[i + 1] * da * (1 - a)) / oa);
        this.data[i + 2] = Math.round((c[2] * a + this.data[i + 2] * da * (1 - a)) / oa);
        this.data[i + 3] = Math.round(oa * 255);
    }
    rect(x, y, w, h, c) {
        for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++)
                this.set(x + i, y + j, c);
    }
    frame(x, y, w, h, t, c) {
        this.rect(x, y, w, t, c);
        this.rect(x, y + h - t, w, t, c);
        this.rect(x, y + t, t, h - 2 * t, c);
        this.rect(x + w - t, y + t, t, h - 2 * t, c);
    }
    ellipse(cx, cy, rx, ry, c) {
        for (let j = -ry; j <= ry; j++)
            for (let i = -rx; i <= rx; i++)
                if ((i * i) / (rx * rx) + (j * j) / (ry * ry) <= 1)
                    this.set(cx + i, cy + j, c);
    }
    ring(cx, cy, rx, ry, t, c) {
        for (let j = -ry; j <= ry; j++)
            for (let i = -rx; i <= rx; i++) {
                const d = (i * i) / (rx * rx) + (j * j) / (ry * ry);
                const d2 = (i * i) / ((rx - t) * (rx - t)) + (j * j) / ((ry - t) * (ry - t));
                if (d <= 1 && d2 > 1)
                    this.set(cx + i, cy + j, c);
            }
    }
    line(x0, y0, x1, y1, t, c) {
        const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
        for (let s = 0; s <= len; s++) {
            const x = x0 + ((x1 - x0) * s) / len;
            const y = y0 + ((y1 - y0) * s) / len;
            this.rect(Math.round(x - t / 2), Math.round(y - t / 2), t, t, c);
        }
    }
    blit(src, dx, dy) {
        for (let j = 0; j < src.h; j++)
            for (let i = 0; i < src.w; i++) {
                const k = (j * src.w + i) * 4;
                if (src.data[k + 3])
                    this.set(dx + i, dy + j, [src.data[k], src.data[k + 1], src.data[k + 2], src.data[k + 3]]);
            }
    }
    /** Draws a glyph from rows of characters using a palette map. */
    glyph(x, y, rows, pal, scale = 1) {
        rows.forEach((row, j) => [...row].forEach((ch, i) => {
            const c = pal[ch];
            if (c)
                this.rect(x + i * scale, y + j * scale, scale, scale, c);
        }));
    }
}
const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function png(img) {
    const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
    for (let y = 0; y < img.h; y++) {
        raw[y * (img.w * 4 + 1)] = 0;
        Buffer.from(img.data.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(img.w, 0);
    ihdr.writeUInt32BE(img.h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
const files = {};
function save(name, img) {
    const path = join(OUT, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png(img));
    files[name] = { w: img.w, h: img.h };
}
// ---------- ground ----------
const KIND_COLOR = {
    civic: '#6c7bd1', market: '#d19a4a', social: '#c96a8a', farm: '#4fae6a', storage: '#8a8f9c', industry: '#c9783f',
    medical: '#e2e6ee', residential: '#5f8fc4', water: '#59c7e6', mine: '#9a8468', power: '#3d6fd6', science: '#9a6ad6', port: '#d6c14a',
};
function ground() {
    const g = new Img(MAP_WIDTH, MAP_HEIGHT);
    const r = rng(7);
    for (let y = 0; y < MAP_HEIGHT; y++)
        for (let x = 0; x < MAP_WIDTH; x++) {
            const n = Math.sin(x * 0.011 + y * 0.007) * 6 + Math.sin(x * 0.031 - y * 0.023) * 4 + (r() - 0.5) * 10;
            const v = 58 + n;
            g.set(x, y, [v * 0.92, v * 0.95, v * 1.12, 255]);
        }
    // speckle
    for (let i = 0; i < 9000; i++) {
        const x = (r() * MAP_WIDTH) | 0;
        const y = (r() * MAP_HEIGHT) | 0;
        g.rect(x, y, 2, 2, r() > 0.5 ? [84, 88, 104, 255] : [40, 42, 54, 255]);
    }
    // craters
    for (let i = 0; i < 70; i++) {
        const cx = (r() * MAP_WIDTH) | 0;
        const cy = (r() * MAP_HEIGHT) | 0;
        const rad = 8 + ((r() * r() * 46) | 0);
        g.ellipse(cx, cy, rad, Math.round(rad * 0.72), [36, 38, 50, 255]);
        g.ring(cx, cy - 1, rad, Math.round(rad * 0.72), 2, [92, 97, 116, 255]);
        g.ellipse(cx + 2, cy + 3, Math.max(2, rad - 5), Math.max(2, Math.round(rad * 0.72) - 5), [46, 48, 62, 255]);
    }
    // routes: pressurised tubes and surface tracks
    for (const route of ROUTES) {
        const [first, second] = route.a < route.b ? [route.a, route.b] : [route.b, route.a];
        const pts = [LOCATION_LAYOUT[first].entry, ...(ROUTE_WAYPOINTS[routeKey(route.a, route.b)] ?? []), LOCATION_LAYOUT[second].entry];
        for (let i = 0; i < pts.length - 1; i++) {
            const [p, q] = [pts[i], pts[i + 1]];
            if (route.surface) {
                const len = Math.hypot(q.x - p.x, q.y - p.y);
                for (let s = 0; s < len; s += 12) {
                    const x = p.x + ((q.x - p.x) * s) / len;
                    const y = p.y + ((q.y - p.y) * s) / len;
                    g.rect(Math.round(x) - 5, Math.round(y) - 2, 6, 4, [98, 92, 84, 255]);
                    g.rect(Math.round(x) - 5, Math.round(y) + 2, 6, 1, [38, 38, 46, 255]);
                }
            }
            else {
                g.line(p.x, p.y + 3, q.x, q.y + 3, 22, [30, 32, 42, 255]);
                g.line(p.x, p.y, q.x, q.y, 20, [92, 102, 126, 255]);
                g.line(p.x, p.y, q.x, q.y, 14, [58, 66, 88, 255]);
                g.line(p.x, p.y - 2, q.x, q.y - 2, 4, [124, 138, 168, 255]);
            }
        }
    }
    for (const id of LOCATION_IDS) {
        const e = LOCATION_LAYOUT[id].entry;
        g.ellipse(e.x, e.y, 14, 10, [44, 48, 64, 255]);
        g.ring(e.x, e.y, 14, 10, 2, [150, 160, 190, 255]);
    }
    save('ground.png', g);
}
function buildings() {
    for (const id of LOCATION_IDS) {
        const lay = LOCATION_LAYOUT[id];
        const def = LOCATIONS[id];
        const { w, h } = lay.footprint;
        const accent = hex(KIND_COLOR[def.kind]);
        const r = rng(id.length * 131 + w);
        const base = new Img(w, h);
        const m = 12;
        // shadow, wall, floor
        base.rect(m + 6, m + 10, w - 2 * m, h - 2 * m, [14, 15, 22, 150]);
        base.rect(m, m, w - 2 * m, h - 2 * m, def.exposed ? hex('#3b3d48') : hex('#262a38'));
        base.frame(m, m, w - 2 * m, h - 2 * m, 6, def.exposed ? hex('#6f6a60') : hex('#aab4cc'));
        base.frame(m + 6, m + 6, w - 2 * m - 12, h - 2 * m - 12, 3, shade(accent, 0.75));
        const fx = m + 9;
        const fy = m + 9;
        const fw = w - 2 * m - 18;
        const fh = h - 2 * m - 18;
        for (let y = 0; y < fh; y++)
            for (let x = 0; x < fw; x++) {
                const grid = x % 32 === 0 || y % 32 === 0;
                const c = def.exposed ? hex('#4a4c58') : shade(accent, 0.34);
                base.set(fx + x, fy + y, grid ? shade(c, 0.8) : (x + y) % 2 ? c : shade(c, 1.06));
            }
        // props along the top wall
        for (let i = 0; i < Math.floor(fw / 56); i++) {
            const px = fx + 10 + i * 56 + ((r() * 8) | 0);
            const ph = 16 + ((r() * 14) | 0);
            base.rect(px, fy + 6, 36, ph, shade(accent, 0.9));
            base.rect(px, fy + 6, 36, 4, shade(accent, 1.3));
            base.rect(px + 4, fy + 12, 28, ph - 10, shade(accent, 0.55));
            base.rect(px + 8, fy + 14, 6, 4, hex('#f4f1c9'));
        }
        if (def.kind === 'power')
            for (let j = 0; j < 3; j++)
                for (let i = 0; i < Math.floor(fw / 72); i++) {
                    base.rect(fx + 16 + i * 72, fy + 44 + j * 52, 52, 30, hex('#1c3f9c'));
                    base.frame(fx + 16 + i * 72, fy + 44 + j * 52, 52, 30, 2, hex('#9db8ff'));
                    base.line(fx + 42 + i * 72, fy + 44 + j * 52, fx + 42 + i * 72, fy + 74 + j * 52, 2, hex('#9db8ff'));
                }
        if (def.kind === 'farm')
            for (let j = 0; j < Math.floor(fh / 44); j++) {
                base.rect(fx + 14, fy + 44 + j * 44, fw - 28, 16, hex('#23402c'));
                for (let i = 0; i < fw - 36; i += 8)
                    base.rect(fx + 18 + i, fy + 46 + j * 44, 5, 10, r() > 0.3 ? hex('#6fe08a') : hex('#3f9c58'));
            }
        if (def.kind === 'water')
            for (let i = 0; i < 3; i++) {
                base.ellipse(fx + 50 + i * 100, fy + fh / 2 + 10, 26, 16, hex('#0e1a2a'));
                base.ring(fx + 50 + i * 100, fy + fh / 2 + 10, 26, 16, 3, hex('#59c7e6'));
                base.rect(fx + 47 + i * 100, fy + fh / 2 - 30, 6, 40, hex('#c8d2e6'));
            }
        if (def.kind === 'port') {
            base.ring(w / 2, h / 2 + 8, 70, 52, 5, hex('#d6c14a'));
            base.line(w / 2 - 30, h / 2 + 8, w / 2 + 30, h / 2 + 8, 5, hex('#d6c14a'));
            base.line(w / 2 - 30, h / 2 - 22, w / 2 - 30, h / 2 + 38, 5, hex('#d6c14a'));
            base.line(w / 2 + 30, h / 2 - 22, w / 2 + 30, h / 2 + 38, 5, hex('#d6c14a'));
        }
        save('buildings/' + id + '_base.png', base);
        const over = new Img(w, h);
        if (!def.exposed) {
            // dome glass: faint tint, highlight streaks and a top rim that occludes colonists behind it
            for (let y = m + 6; y < h - m - 6; y++)
                for (let x = m + 6; x < w - m - 6; x++)
                    if ((x + y * 2) % 37 < 3)
                        over.set(x, y, [200, 230, 255, 26]);
            over.rect(m, m - 6, w - 2 * m, 10, hex('#c4cee4'));
            over.rect(m, m + 4, w - 2 * m, 4, hex('#6f7c9c'));
            over.rect(m, m - 6, w - 2 * m, 2, hex('#eef3ff'));
        }
        for (const [cx, cy] of [[m, m], [w - m - 10, m], [m, h - m - 10], [w - m - 10, h - m - 10]]) {
            over.rect(cx - 2, cy - 8, 14, 18, hex('#8894b0'));
            over.rect(cx, cy - 8, 10, 4, accent);
        }
        save('buildings/' + id + '_overlay.png', over);
        const dmg = new Img(w, h);
        for (let i = 0; i < 6; i++) {
            let x = m + 20 + r() * (w - 2 * m - 40);
            let y = m + 20 + r() * (h - 2 * m - 40);
            dmg.ellipse(x | 0, y | 0, 14 + ((r() * 14) | 0), 9 + ((r() * 8) | 0), [12, 10, 10, 120]);
            for (let s = 0; s < 9; s++) {
                const nx = x + (r() - 0.5) * 44;
                const ny = y + (r() - 0.5) * 44;
                dmg.line(x, y, nx, ny, 2, [10, 8, 10, 235]);
                x = nx;
                y = ny;
            }
            dmg.rect((x | 0) - 4, (y | 0) - 3, 9, 6, hex('#6a5a4c'));
            dmg.rect((x | 0) - 2, (y | 0) - 5, 4, 3, hex('#ff8a3c'));
        }
        save('buildings/' + id + '_damaged.png', dmg);
    }
}
// ---------- characters ----------
const SUIT = {
    farmer: '#4fae6a', miner: '#b08a5a', engineer: '#e08a3c', medic: '#e8ecf4', scientist: '#9a6ad6',
    merchant: '#d6b14a', guard: '#c2463f', official: '#3f5fb8', worker: '#7d8798', civilian: '#4fb8b0',
};
const SKIN = ['#f1c9a5', '#d9a47a', '#b97c50', '#8d5a3a', '#f6d7bd', '#6e4630'];
const HAIR = ['#2b2330', '#6b3f22', '#c9a23f', '#8a8f9c', '#b0413a', '#1c2a4a'];
const FW = 24;
const FH = 36;
const FRAMES = 4;
function drawCharacter(img, ox, oy, archetype, variant, dir, frame) {
    const suit = hex(SUIT[archetype]);
    const skin = hex(SKIN[variant % SKIN.length]);
    const hair = hex(HAIR[(variant * 5 + archetype.length) % HAIR.length]);
    const dark = hex('#14151f');
    const bob = frame % 2 === 1 ? 1 : 0;
    const stepA = frame === 1 ? 3 : frame === 3 ? -3 : 0;
    const y0 = oy + bob;
    // shadow
    img.ellipse(ox + 12, oy + 33, 7, 2, [0, 0, 0, 90]);
    // legs
    const legY = y0 + 25;
    if (dir === 0 || dir === 3) {
        img.rect(ox + 8, legY, 3, 8 - Math.max(0, stepA), shade(suit, 0.6));
        img.rect(ox + 13, legY, 3, 8 - Math.max(0, -stepA), shade(suit, 0.6));
        img.rect(ox + 7, legY + 7 - Math.max(0, stepA), 4, 2, dark);
        img.rect(ox + 13, legY + 7 - Math.max(0, -stepA), 4, 2, dark);
    }
    else {
        const s = dir === 1 ? -1 : 1;
        img.rect(ox + 10 + stepA * s, legY, 3, 8, shade(suit, 0.6));
        img.rect(ox + 11 - stepA * s, legY, 3, 8, shade(suit, 0.5));
        img.rect(ox + 9 + stepA * s + (s > 0 ? 1 : 0), legY + 7, 4, 2, dark);
        img.rect(ox + 10 - stepA * s + (s > 0 ? 1 : 0), legY + 7, 4, 2, dark);
    }
    // torso
    img.rect(ox + 6, y0 + 14, 12, 12, dark);
    img.rect(ox + 7, y0 + 15, 10, 10, suit);
    img.rect(ox + 7, y0 + 15, 10, 2, shade(suit, 1.25));
    img.rect(ox + 7, y0 + 22, 10, 1, shade(suit, 0.7));
    if (dir === 0)
        img.rect(ox + 10, y0 + 17, 4, 3, shade(suit, 1.5));
    if (dir === 3)
        img.rect(ox + 9, y0 + 16, 6, 7, shade(suit, 0.7));
    // arms
    if (dir === 0 || dir === 3) {
        img.rect(ox + 4, y0 + 15 + Math.max(0, -stepA) / 3, 3, 9, shade(suit, 0.85));
        img.rect(ox + 17, y0 + 15 + Math.max(0, stepA) / 3, 3, 9, shade(suit, 0.85));
        img.rect(ox + 4, y0 + 23, 3, 2, skin);
        img.rect(ox + 17, y0 + 23, 3, 2, skin);
    }
    else {
        const s = dir === 1 ? -1 : 1;
        img.rect(ox + 11 - stepA * s, y0 + 16, 3, 8, shade(suit, 0.8));
        img.rect(ox + 11 - stepA * s, y0 + 23, 3, 2, skin);
    }
    // head
    img.rect(ox + 6, y0 + 3, 12, 12, dark);
    img.rect(ox + 7, y0 + 4, 10, 10, skin);
    if (dir === 3) {
        img.rect(ox + 7, y0 + 4, 10, 9, hair);
    }
    else {
        img.rect(ox + 7, y0 + 4, 10, 3, hair);
        if (dir === 0) {
            img.rect(ox + 7, y0 + 7, 1, 3, hair);
            img.rect(ox + 16, y0 + 7, 1, 3, hair);
            img.rect(ox + 9, y0 + 9, 2, 2, dark);
            img.rect(ox + 13, y0 + 9, 2, 2, dark);
            img.rect(ox + 11, y0 + 12, 2, 1, shade(skin, 0.7));
        }
        else {
            const s = dir === 1 ? 0 : 1;
            img.rect(ox + (s ? 7 : 13), y0 + 6, 4, 5, hair);
            img.rect(ox + (s ? 14 : 8), y0 + 9, 2, 2, dark);
        }
    }
    if (archetype === 'miner' || archetype === 'engineer' || archetype === 'guard') {
        img.rect(ox + 6, y0 + 2, 12, 4, shade(suit, archetype === 'guard' ? 0.6 : 1.2));
        img.rect(ox + 6, y0 + 5, 12, 1, dark);
    }
    if (archetype === 'medic' && dir === 0) {
        img.rect(ox + 11, y0 + 17, 2, 4, hex('#d0343a'));
        img.rect(ox + 10, y0 + 18, 4, 2, hex('#d0343a'));
    }
}
function characters() {
    const rows = SPRITE_ARCHETYPES.length * SPRITE_VARIANTS;
    const atlas = new Img(FW * FRAMES * 4, FH * rows);
    let row = 0;
    for (const archetype of SPRITE_ARCHETYPES)
        for (let v = 0; v < SPRITE_VARIANTS; v++) {
            for (let d = 0; d < 4; d++)
                for (let f = 0; f < FRAMES; f++)
                    drawCharacter(atlas, (d * FRAMES + f) * FW, row * FH, archetype, v, d, f);
            // portrait: the standing frame, head and shoulders, on a tinted backdrop
            const p = new Img(48, 48);
            const bg = shade(hex(SUIT[archetype]), 0.35);
            p.rect(0, 0, 48, 48, bg);
            for (let y = 0; y < 48; y += 4)
                p.rect(0, y, 48, 1, shade(bg, 1.25));
            const tmp = new Img(FW, FH);
            drawCharacter(tmp, 0, 0, archetype, v, 0, 0);
            for (let y = 0; y < 24; y++)
                for (let x = 0; x < 24; x++) {
                    const k = (y * FW + x) * 4;
                    if (tmp.data[k + 3] === 255)
                        p.rect(x * 2, y * 2, 2, 2, [tmp.data[k], tmp.data[k + 1], tmp.data[k + 2], 255]);
                }
            p.frame(0, 0, 48, 48, 2, hex('#0d0e16'));
            save('portraits/' + archetype + '_' + v + '.png', p);
            row++;
        }
    save('characters.png', atlas);
}
// ---------- icons and fx ----------
const PAL = {
    k: hex('#0d0e16'), w: hex('#f2f4ff'), y: hex('#ffd24a'), o: hex('#ff8a3c'), r: hex('#e0443e'), b: hex('#4aa8ff'), c: hex('#59e0e6'),
    g: hex('#5fd67a'), p: hex('#b07cff'), s: hex('#8a8f9c'), d: hex('#4a4e5e'), n: hex('#b08a5a'), m: hex('#ff7ab8'),
};
const POWER_GLYPHS = {
    drought: ['......yy......', '..y...yy...y..', '...y......y...', '.....oooo.....', '....oyyyyo....', 'yy.oyyyyyyo.yy', 'yy.oyyyyyyo.yy', '....oyyyyo....', '.....oooo.....', '...y......y...', '..y...nn...y..', '.....nnnn.....', '..nn.n..n.nn..', '.nnnnn..nnnnn.'],
    storm: ['....ssssss....', '..sswwwwwwss..', '.swwwwwwwwwws.', 'swwwwwwwwwwwws', 'swwwwwwwwwwwws', '.sssssssssssss', '......yyy.....', '.....yyy......', '....yyyyy.....', '......yyy.....', '.....yyy..o...', '....yy...ooo..', '...yy.....o...', '...y..........'],
    grant: ['......yy......', '.....yyyy.....', '......yy......', '.nnnnnnnnnnnn.', '.nkkkkyykkkkn.', '.nnnnnyynnnnn.', '.nwnnnyynnnnn.', '.nwnnnyynnnnn.', '.nnnnnyynnnnn.', '.nnnnnyynnnnn.', '.nnnnnyynnnnn.', '.nkkkkyykkkkn.', '.nnnnnnnnnnnn.', '..............'],
    kill: ['...wwwwwwww...', '..wwwwwwwwww..', '.wwwwwwwwwwww.', '.wwkkwwwwkkww.', '.wkkkkwwkkkkw.', '.wkkkkwwkkkkw.', '.wwkkwwwwkkww.', '.wwwwwkkwwwww.', '..wwwwkkwwww..', '...wwwwwwww...', '...wkwkkwkw...', '...wkwkkwkw...', '....wwwwww....', '..............'],
    whisper: ['.....pppp.....', '...pppppppp...', '..ppwwwwwwpp..', '.ppwwppppwwpp.', '.pwwppkkppwwp.', '.pwwppkkppwwp.', '.ppwwppppwwpp.', '..ppwwwwwwpp..', '...pppppppp...', '.....pppp.....', '......pp......', '.....p..p.....', '....p....p....', '..............'],
    rumor: ['.mmmmmmmmmmmm.', 'mwwwwwwwwwwwwm', 'mwwwwwwwwwwwwm', 'mwwkkwkkwkkwwm', 'mwwkkwkkwkkwwm', 'mwwwwwwwwwwwwm', 'mwwwwwwwwwwwwm', '.mmmmwwmmmmmm.', '....mwwm......', '...mwwm.......', '...mwm........', '...mm.........', '..............', '..............'],
    create_character: ['.....cccc.....', '....cwwwwc....', '....cwwwwc....', '....cwwwwc....', '.....cccc.....', '...cccccccc...', '..cwwwwwwwwc..', '..cwwwwwwwwc..', '..cwwwwwwwwc..', '..cwwwwwwggc..', '..cwwwwwggggc.', '..cccccggggggc', '.......gggg...', '........gg....'],
};
const RES_GLYPHS = {
    food: ['........', '..gg....', '...g....', '.rrrrr..', 'rrwrrrr.', 'rrrrrrr.', '.rrrrr..', '........'],
    water: ['...b....', '..bbb...', '..bbb...', '.bbwbb..', '.bbbbb..', '.bbbbb..', '..bbb...', '........'],
    parts: ['.s.ss.s.', 'ssssssss', '.ssddss.', 'ssd..dss', 'ssd..dss', '.ssddss.', 'ssssssss', '.s.ss.s.'],
    medicine: ['........', '.wwwwww.', '.wwrrww.', '.wrrrrw.', '.wrrrrw.', '.wwrrww.', '.wwwwww.', '........'],
    credits: ['..yyyy..', '.yyooyy.', 'yyoyyoyy', 'yyoyyyyy', 'yyoyyyyy', 'yyoyyoyy', '.yyooyy.', '..yyyy..'],
};
function icons() {
    for (const [name, rows] of Object.entries(POWER_GLYPHS)) {
        const i = new Img(32, 32);
        i.glyph(3, 4, rows.map((r) => r.replace(/[^.]/g, 'k')), PAL, 2);
        i.glyph(2, 2, rows, PAL, 2);
        save('icons/power_' + name + '.png', i);
    }
    for (const res of RESOURCES) {
        const i = new Img(16, 16);
        i.glyph(1, 1, RES_GLYPHS[res].map((r) => r.replace(/[^.]/g, 'k')), PAL, 2);
        i.glyph(0, 0, RES_GLYPHS[res], PAL, 2);
        save('icons/res_' + res + '.png', i);
    }
    const grave = new Img(24, 28);
    grave.ellipse(12, 25, 9, 2, [0, 0, 0, 100]);
    grave.rect(6, 6, 12, 19, hex('#0d0e16'));
    grave.rect(7, 7, 10, 17, hex('#8a8f9c'));
    grave.rect(7, 7, 10, 2, hex('#c4cee4'));
    grave.rect(11, 10, 2, 9, hex('#3a3d4c'));
    grave.rect(9, 12, 6, 2, hex('#3a3d4c'));
    grave.rect(4, 23, 16, 3, hex('#5a5346'));
    save('fx/grave.png', grave);
    const sel = new Img(16, 12);
    sel.glyph(0, 0, ['kkkkkkkk', 'kyyyyyyk', '.kyyyyk.', '..kyyk..', '...kk...'], PAL, 2);
    save('fx/selection.png', sel);
    const storm = new Img(128, 128);
    const r = rng(99);
    for (let i = 0; i < 46; i++) {
        const x = (r() * 128) | 0;
        const y = (r() * 128) | 0;
        const len = 6 + ((r() * 10) | 0);
        for (let s = 0; s < len; s++)
            storm.rect((x - s * 2 + 256) % 128, (y + s * 2) % 128, 2, 2, [255, 214, 170, 60 + s * 12]);
    }
    save('fx/storm_overlay.png', storm);
    const drought = new Img(128, 128);
    for (let i = 0; i < 180; i++)
        drought.rect((r() * 128) | 0, (r() * 128) | 0, 2, 1, [255, 190, 110, 40 + ((r() * 50) | 0)]);
    save('fx/drought_overlay.png', drought);
}
// ---------- client UI art (not placeholder: the art contract has no emotes) ----------
const EMOTE_GLYPHS = {
    working: RES_GLYPHS.parts,
    eating: RES_GLYPHS.food,
    drinking: RES_GLYPHS.water,
    sleeping: ['........', '.bbbb...', '...b....', '..b..bb.', '.bbbb.b.', '.....bb.', '........', '........'],
    resting: ['........', '.d.d....', '........', 'nnnnnn..', 'nnnnn.n.', 'nnnnnn..', '.nnnn...', '........'],
    talking: ['........', 'kkkkkkk.', 'k.....k.', 'k.k.k.k.', 'k.....k.', 'kkkkkkk.', '..kk....', '..k.....'],
    trading: RES_GLYPHS.credits,
    giving: ['..y..y..', '...yy...', 'mmmyymmm', 'mmmyymmm', '.mmyymm.', '.mmyymm.', '.mmyymm.', '........'],
    helping: ['........', '.rr.rr..', 'rrrrrrr.', 'rrrrrrr.', '.rrrrr..', '..rrr...', '...r....', '........'],
    stealing: ['........', '.kkkkkk.', 'kkwkkwkk', 'kkkkkkkk', '.kkkkkk.', '........', '...rr...', '........'],
    investigating: ['..ppp...', '.p...p..', '.....p..', '....p...', '...p....', '........', '...p....', '........'],
    fleeing: ['.rr..rr.', '.rr..rr.', '.rr..rr.', '.rr..rr.', '.rr..rr.', '........', '.rr..rr.', '........'],
    mourning: ['........', '.dd.dd..', 'ddddddd.', 'ddddddd.', '.ddddd..', '..ddd.b.', '...d..b.', '........'],
};
function emotes() {
    const names = Object.keys(EMOTE_GLYPHS);
    const cell = 20;
    const sheet = new Img(cell * names.length, cell + 4);
    names.forEach((name, i) => {
        const x = i * cell;
        sheet.rect(x + 2, 0, cell - 4, cell, hex('#0d0e16'));
        sheet.rect(x, 2, cell, cell - 4, hex('#0d0e16'));
        sheet.rect(x + 2, 2, cell - 4, cell - 4, hex('#f2f4ff'));
        sheet.rect(x + 8, cell, 4, 2, hex('#0d0e16'));
        sheet.rect(x + 9, cell, 2, 1, hex('#f2f4ff'));
        sheet.rect(x + 9, cell + 2, 2, 2, hex('#0d0e16'));
        sheet.glyph(x + 2, 2, EMOTE_GLYPHS[name], PAL, 2);
    });
    mkdirSync(join(OUT, '../../ui/assets'), { recursive: true });
    writeFileSync(join(OUT, '../../ui/assets/emotes.png'), png(sheet));
    console.log('emote order:', names.join(', '));
}
ground();
buildings();
characters();
icons();
emotes();
// ---------- manifest ----------
const asset = (name) => "{ source: require('./" + name + "'), width: " + files[name].w + ', height: ' + files[name].h + ' }';
const lines = [];
lines.push('// Generated by generate.mts. Do not edit by hand.');
lines.push("import type { AssetManifest } from '../../../shared/assets';");
lines.push('');
lines.push('export const PLACEHOLDER_MANIFEST: AssetManifest = {');
lines.push('  map: { width: ' + MAP_WIDTH + ', height: ' + MAP_HEIGHT + ', ground: ' + asset('ground.png') + ' },');
lines.push('  buildings: {');
for (const id of LOCATION_IDS) {
    const f = LOCATION_LAYOUT[id].footprint;
    lines.push('    ' + id + ': { x: ' + f.x + ', y: ' + f.y + ', base: ' + asset('buildings/' + id + '_base.png') + ', overlay: ' + asset('buildings/' + id + '_overlay.png') + ', damaged: ' + asset('buildings/' + id + '_damaged.png') + ' },');
}
lines.push('  },');
lines.push('  characters: {');
lines.push('    atlas: ' + asset('characters.png') + ',');
lines.push('    frameWidth: ' + FW + ',');
lines.push('    frameHeight: ' + FH + ',');
lines.push('    framesPerDirection: ' + FRAMES + ',');
lines.push('    rows: {');
let row = 0;
for (const archetype of SPRITE_ARCHETYPES)
    for (let v = 0; v < SPRITE_VARIANTS; v++)
        lines.push('      ' + archetype + '_' + v + ': ' + row++ + ',');
lines.push('    },');
lines.push('    feet: { x: 12, y: 33 },');
lines.push('  },');
lines.push('  portraits: {');
for (const archetype of SPRITE_ARCHETYPES)
    for (let v = 0; v < SPRITE_VARIANTS; v++)
        lines.push('    ' + archetype + '_' + v + ': ' + asset('portraits/' + archetype + '_' + v + '.png') + ',');
lines.push('  },');
lines.push('  icons: {');
lines.push('    powers: {');
for (const name of Object.keys(POWER_GLYPHS))
    lines.push('      ' + name + ': ' + asset('icons/power_' + name + '.png') + ',');
lines.push('    },');
lines.push('    resources: {');
for (const res of RESOURCES)
    lines.push('      ' + res + ': ' + asset('icons/res_' + res + '.png') + ',');
lines.push('    },');
lines.push('  },');
lines.push('  fx: {');
lines.push('    grave: ' + asset('fx/grave.png') + ',');
lines.push('    selection: ' + asset('fx/selection.png') + ',');
lines.push('    stormOverlay: ' + asset('fx/storm_overlay.png') + ',');
lines.push('    droughtOverlay: ' + asset('fx/drought_overlay.png') + ',');
lines.push('  },');
lines.push('};');
writeFileSync(join(OUT, 'manifest.ts'), lines.join('\n') + '\n');
console.log('wrote', Object.keys(files).length, 'images');
