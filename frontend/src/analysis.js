export const HIST = { low: -1, high: 1, n: 40 };
export const DAY = 86400000;
export const NDVI_CLASSES = [
    { rgb: [115, 64, 38], label: "Below 0 (water, bare, non-vegetated)", short: "<0" },
    { rgb: [204, 179, 77], label: "0 - 0.2 (sparse)", short: "0-0.2" },
    { rgb: [179, 217, 77], label: "0.2 - 0.4 (moderate-low)", short: "0.2-0.4" },
    { rgb: [64, 179, 64], label: "0.4 - 0.6 (moderate-high)", short: "0.4-0.6" },
    { rgb: [13, 102, 26], label: "Above 0.6 (dense)", short: ">0.6" },
];
export const CHANGE_PAL = {
    water: { stable: [30, 64, 175], gain: [56, 189, 248], loss: [245, 158, 11] },
    urban: { stable: [124, 45, 18], gain: [239, 68, 68], loss: [34, 197, 94] },
};
export const BG = [2, 4, 10];
export const DIM = [51, 65, 85];

const sum = (a) => a.reduce((x, y) => x + y, 0);
const avg = (a) => (a.length ? sum(a) / a.length : NaN);
const std = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((v) => (v - m) ** 2))); };
export const median = (a) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const toDay = (s) => Date.parse(`${s}T00:00:00Z`) / DAY;
export const isoFromDay = (t) => new Date(t * DAY).toISOString().slice(0, 10);
export const addDays = (s, n) => isoFromDay(toDay(s) + n);

export function seasonGap(a, b) {
    const doy = (s) => { const d = new Date(`${s}T00:00:00Z`); return (d - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY; };
    const x = Math.abs(doy(a) - doy(b));
    return Math.round(Math.min(x, 365 - x));
}

export function studyArea([minLon, minLat, maxLon, maxLat]) {
    const midLat = (minLat + maxLat) / 2;
    const wKm = (maxLon - minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180);
    const hKm = (maxLat - minLat) * 110.57;
    return { wKm, hKm, areaKm2: wKm * hKm, center: [(minLon + maxLon) / 2, midLat] };
}

export function getImageSize(minLon, minLat, maxLon, maxLat, maxSide = 1024) {
    const ratio = ((maxLon - minLon) * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)) / (maxLat - minLat);
    const w = ratio >= 1 ? maxSide : Math.round(maxSide * ratio);
    const h = ratio >= 1 ? Math.round(maxSide / ratio) : maxSide;
    return { width: Math.max(256, w), height: Math.max(256, h) };
}

const normCdf = (z) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const p = 0.3989423 * Math.exp((-z * z) / 2) * t *
        (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
};

function mannKendall(y) {
    const n = y.length;
    let s = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
    const v = (n * (n - 1) * (2 * n + 5)) / 18;
    const z = s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(v);
    return { s, z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

function senSlope(t, y) {
    const sl = [];
    for (let i = 0; i < t.length - 1; i++)
        for (let j = i + 1; j < t.length; j++) if (t[j] !== t[i]) sl.push((y[j] - y[i]) / (t[j] - t[i]));
    const slope = median(sl);
    return { slope, intercept: median(y.map((v, i) => v - slope * t[i])) };
}

function linreg(t, y) {
    const mt = avg(t), my = avg(y);
    let sxy = 0, sxx = 0, syy = 0;
    t.forEach((x, i) => { sxy += (x - mt) * (y[i] - my); sxx += (x - mt) ** 2; syy += (y[i] - my) ** 2; });
    const slope = sxx ? sxy / sxx : 0;
    return { slope, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

export function seriesPoints(series, id, minCov = 0.2) {
    return series
        .filter((r) => r[id] && r[id].total > 0 && r[id].n / r[id].total >= minCov && r[id].mean !== null)
        .map((r) => ({
            t: (Date.parse(r.from) + Date.parse(r.to)) / 2 / DAY,
            date: r.from, mean: r[id].mean, sd: r[id].sd ?? 0, cov: r[id].n / r[id].total,
        }));
}

export function analyseSeries(pts) {
    if (pts.length < 4) return { enough: false, n: pts.length };
    const t = pts.map((p) => p.t), y = pts.map((p) => p.mean);
    const sen = senSlope(t, y), reg = linreg(t, y), m = avg(y), sd = std(y);
    const imax = y.indexOf(Math.max(...y)), imin = y.indexOf(Math.min(...y));
    return {
        enough: true, n: pts.length, mean: m, sd, cv: Math.abs(m) > 1e-6 ? sd / Math.abs(m) : NaN,
        min: y[imin], minDate: pts[imin].date, max: y[imax], maxDate: pts[imax].date,
        amplitude: y[imax] - y[imin], mk: mannKendall(y), sen,
        senPerYear: sen.slope * 365.25, r2: reg.r2,
    };
}

const binW = (HIST.high - HIST.low) / HIST.n;
function cdfAt(w, thr) {
    const total = sum(w.hist) + w.under + w.over;
    const k = Math.max(0, Math.min(HIST.n, Math.round((thr - HIST.low) / binW)));
    return total ? (w.under + sum(w.hist.slice(0, k))) / total : NaN;
}
export const fracAbove = (w, thr) => 1 - cdfAt(w, thr);
export function classFractions(w, thr) {
    const F = [...thr.map((t) => cdfAt(w, t)), 1];
    return F.map((v, i) => v - (i ? F[i - 1] : 0));
}
export const effectLabel = (d) => {
    const x = Math.abs(d);
    return x < 0.2 ? "negligible" : x < 0.5 ? "small" : x < 0.8 ? "medium" : "large";
};

export function compareWindows(b, a) {
    const good = (w) => w && w.hist?.length === HIST.n && w.n > 1 && w.sd !== null;
    if (!good(b) || !good(a)) return null;
    const nb = sum(b.hist) || 1, na = sum(a.hist) || 1;
    let cb = 0, ca = 0, tv = 0, w1 = 0;
    for (let i = 0; i < HIST.n; i++) {
        const pb = b.hist[i] / nb, pa = a.hist[i] / na;
        tv += Math.abs(pb - pa) / 2;
        cb += pb; ca += pa;
        w1 += Math.abs(cb - ca) * binW;
    }
    const pooled = Math.sqrt(((b.n - 1) * b.sd ** 2 + (a.n - 1) * a.sd ** 2) / (b.n + a.n - 2));
    return {
        dMean: a.mean - b.mean,
        cohenD: pooled > 0 ? (a.mean - b.mean) / pooled : 0,
        tv, w1,
    };
}

export async function decodeImage(base64) {
    const img = await new Promise((res, rej) => {
        const e = new Image();
        e.onload = () => res(e);
        e.onerror = () => rej(new Error("Could not decode satellite image."));
        e.src = `data:image/png;base64,${base64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#02040a";
    ctx.fillRect(0, 0, c.width, c.height);
    return { data, jpeg: c.toDataURL("image/jpeg", 0.88), w: c.width, h: c.height };
}

function jpegFrom(imageData) {
    const c = document.createElement("canvas");
    c.width = imageData.width; c.height = imageData.height;
    c.getContext("2d").putImageData(imageData, 0, 0);
    return c.toDataURL("image/jpeg", 0.88);
}

const isWater = (r, g, b) => b >= 240 && r <= 30 && g >= 70 && g <= 110;
const isUrban = (r, g, b) => r >= 245 && g >= 105 && g <= 125 && b <= 25;
function ndviClass(r, g, b) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < 5; k++) {
        const p = NDVI_CLASSES[k].rgb, d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2;
        if (d < bd) { bd = d; best = k; }
    }
    return best;
}

export function pixelChange(type, B, A, pxKm2) {
    const w = B.width, h = B.height, b = B.data, a = A.data;
    const out = new ImageData(w, h), o = out.data;
    const put = (i, c) => { o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255; };
    const m = Array.from({ length: 5 }, () => Array(5).fill(0));
    const test = type === "water" ? isWater : isUrban, pal = CHANGE_PAL[type];
    let valid = 0, stable = 0, gained = 0, lost = 0;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, d1 = 0, d2 = 0, dsum = 0;
    const mb = [0, 0, 0], ma = [0, 0, 0];

    for (let i = 0; i < b.length; i += 4) {
        if (b[i + 3] < 128 || a[i + 3] < 128) { put(i, BG); continue; }
        valid++;
        if (type === "ndvi") {
            const cb = ndviClass(b[i], b[i + 1], b[i + 2]), ca = ndviClass(a[i], a[i + 1], a[i + 2]);
            m[cb][ca]++;
            const d = ca - cb;
            put(i, d === 0 ? DIM : d > 0 ? (d > 1 ? [22, 163, 74] : [134, 239, 172]) : d < -1 ? [220, 38, 38] : [252, 165, 165]);
        } else if (type === "true-color") {
            const dr = a[i] - b[i], dg = a[i + 1] - b[i + 1], db = a[i + 2] - b[i + 2];
            const d = Math.sqrt((dr * dr + dg * dg + db * db) / 3) / 255;
            dsum += d; if (d > 0.1) d1++; if (d > 0.2) d2++;
            const lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
            const la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
            sx += lb; sy += la; sxx += lb * lb; syy += la * la; sxy += lb * la;
            for (let k = 0; k < 3; k++) { mb[k] += b[i + k]; ma[k] += a[i + k]; }
            const v = Math.min(1, d / 0.3);
            put(i, [Math.round(30 + 225 * v), Math.round(40 + 150 * Math.sin(Math.PI * v)), Math.round(150 * (1 - v) + 30)]);
        } else {
            const wb = test(b[i], b[i + 1], b[i + 2]), wa = test(a[i], a[i + 1], a[i + 2]);
            if (wb && wa) { stable++; put(i, pal.stable); }
            else if (wa) { gained++; put(i, pal.gain); }
            else if (wb) { lost++; put(i, pal.loss); }
            else put(i, DIM);
        }
    }

    const n = valid || 1;
    const r = { type, pxKm2, w, h, valid, total: w * h, stable, gained, lost, matrix: m, jpeg: jpegFrom(out) };
    if (type === "ndvi") {
        r.improved = 0; r.degraded = 0; r.stable = 0; r.strongUp = 0; r.strongDown = 0;
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
            const c = m[i][j];
            if (j === i) r.stable += c;
            else if (j > i) { r.improved += c; if (j - i > 1) r.strongUp += c; }
            else { r.degraded += c; if (i - j > 1) r.strongDown += c; }
        }
    }
    if (type === "true-color") {
        const cov = sxy / n - (sx / n) * (sy / n), vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
        r.corr = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN;
        r.meanDiff = dsum / n; r.share10 = d1 / n; r.share20 = d2 / n;
        r.meanB = mb.map((v) => v / n); r.meanA = ma.map((v) => v / n);
    }
    return r;
}

export function summariseFire(features, bbox, days, source) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const conf = { h: 0, n: 0, l: 0 }, byDay = {}, frps = [];
    let day = 0, night = 0;
    const G = 8, grid = Array.from({ length: G }, () => Array(G).fill(0));
    features.forEach(({ geometry, properties: p }) => {
        if (p.confidence in conf) conf[p.confidence]++;
        if (Number.isFinite(p.fireRadiativePower)) frps.push(p.fireRadiativePower);
        if (p.dayNight === "D") day++; else if (p.dayNight === "N") night++;
        byDay[p.acquisitionDate] = (byDay[p.acquisitionDate] || 0) + 1;
        const [lon, lat] = geometry.coordinates;
        const gx = Math.min(G - 1, Math.max(0, Math.floor(((lon - minLon) / (maxLon - minLon)) * G)));
        const gy = Math.min(G - 1, Math.max(0, Math.floor(((maxLat - lat) / (maxLat - minLat)) * G)));
        grid[gy][gx]++;
    });
    const cells = grid.flatMap((row, gy) => row.map((c, gx) => ({
        c, lon: minLon + ((gx + 0.5) / G) * (maxLon - minLon), lat: maxLat - ((gy + 0.5) / G) * (maxLat - minLat),
    }))).sort((x, y) => y.c - x.c).slice(0, 3).filter((x) => x.c > 0);
    const count = features.length;
    return {
        count, days, source, conf, day, night, byDay, grid, topCells: cells,
        top3share: count ? sum(cells.map((c) => c.c)) / count : 0,
        frpSum: sum(frps), frpMean: avg(frps), frpMedian: median(frps), frpMax: frps.length ? Math.max(...frps) : NaN,
    };
}

export function buildFindings(R) {
    const F = [];
    const add = (level, text) => F.push({ level, text });
    const fx = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : "n/a");
    const sg = (v, n = 3) => (v >= 0 ? "+" : "") + fx(v, n);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const km = R.area.areaKm2;

    if (R.gapDays < 30) add("warn", `The two dates are only ${R.gapDays} days apart. Differences are likely dominated by noise, weather and masking rather than real change.`);
    if (R.seasonGap > 45) add("warn", `The two dates are ${R.seasonGap} days apart in the seasonal cycle, so vegetation differences probably reflect phenology (crop and leaf cycles) rather than land-cover change. Compare the same time of year for reliable change detection.`);
    if (R.days < 365) add("warn", "The period is shorter than one year, so the trend statistics are confounded by seasonality and should not be read as long-term change.");

    const W = R.win, nd = W.ndvi;
    if (nd.b && nd.a) {
        const cb = nd.b.n / nd.b.total, ca = nd.a.n / nd.a.total;
        if (Math.min(cb, ca) < 0.5) add("warn", `Valid-data coverage in the comparison windows is low (${pct(cb)} earlier, ${pct(ca)} later) because of cloud, shadow or gaps. Results may not represent the whole area.`);
    } else add("warn", "No usable NDVI data was found in one or both comparison windows.");

    if (nd.cmp) {
        const c = nd.cmp, fb = fracAbove(nd.b, 0.4), fa = fracAbove(nd.a, 0.4);
        add("info", `Mean NDVI changed from ${fx(nd.b.mean)} to ${fx(nd.a.mean)} (${sg(c.dMean)}), a ${effectLabel(c.cohenD)} effect (Cohen's d = ${fx(c.cohenD, 2)}). The distribution shifted by a total variation of ${fx(c.tv, 2)} and a Wasserstein-1 distance of ${fx(c.w1)} NDVI units.`);
        add("info", `The share of valid pixels with NDVI above 0.4 (moderate-high to dense vegetation) went from ${pct(fb)} to ${pct(fa)} (${sg((fa - fb) * 100, 1)} pp, about ${sg((fa - fb) * km, 2)} km2 of the study area).`);
    }
    const tr = R.S.ndvi.an;
    if (tr?.enough) {
        const sig = tr.mk.p < 0.05;
        add("info", `Across ${tr.n} observation intervals the NDVI trend is ${sig ? "statistically significant" : "not statistically significant"} (Mann-Kendall p = ${fx(tr.mk.p)}; Theil-Sen slope ${sg(tr.senPerYear)} per year). NDVI peaked around ${tr.maxDate} (${fx(tr.max)}) and was lowest around ${tr.minDate} (${fx(tr.min)}); the swing of ${fx(tr.amplitude)} indicates the strength of the seasonal cycle.`);
    }
    if (W.ndwi.cmp) {
        const fb = fracAbove(W.ndwi.b, 0.15), fa = fracAbove(W.ndwi.a, 0.15);
        add("info", `Surface-water indicator (NDWI above 0.15): ${pct(fb)} of valid pixels earlier, ${pct(fa)} later (${sg((fa - fb) * 100, 1)} pp). Mean NDWI changed by ${sg(W.ndwi.cmp.dMean)}.`);
    }
    if (W.ndbi.cmp) {
        const fb = fracAbove(W.ndbi.b, 0.1), fa = fracAbove(W.ndbi.a, 0.1);
        add("info", `Built-up/bare-surface indicator (NDBI above 0.1): ${pct(fb)} earlier, ${pct(fa)} later (${sg((fa - fb) * 100, 1)} pp). This is a screening index; bare soil also scores high.`);
    }

    const cn = R.changes.ndvi;
    if (cn && !cn.error && cn.valid) {
        const up = cn.improved / cn.valid, dn = cn.degraded / cn.valid;
        add("info", `Pixel-level NDVI change (${cn.valid.toLocaleString()} pixels cloud-free on both dates): ${pct(up)} moved to a higher vegetation class and ${pct(dn)} to a lower class (net ${sg((up - dn) * 100, 1)} pp). Strong shifts of two or more classes: ${pct(cn.strongUp / cn.valid)} up, ${pct(cn.strongDown / cn.valid)} down.`);
    }
    for (const [t, label] of [["water", "surface water"], ["urban", "built-up surface"]]) {
        const c = R.changes[t];
        if (c && !c.error && c.valid) {
            add("info", `Pixel-level ${label}: ${(c.gained * c.pxKm2).toFixed(2)} km2 gained and ${(c.lost * c.pxKm2).toFixed(2)} km2 lost (net ${sg((c.gained - c.lost) * c.pxKm2, 2)} km2); ${(c.stable * c.pxKm2).toFixed(2)} km2 unchanged.`);
        }
    }
    const tc = R.changes["true-color"];
    if (tc && !tc.error && Number.isFinite(tc.corr)) {
        add("info", `True-colour comparison: ${pct(tc.share10)} of pixels changed noticeably (RGB difference above 10%) and ${pct(tc.share20)} strongly (above 20%). Spatial correlation of brightness between dates is ${fx(tc.corr, 2)}; low values mean the scene layout changed. This layer includes clouds, so cross-check with the index layers.`);
    }

    if (nd.cmp && W.ndbi.cmp && W.ndwi.cmp) {
        const dv = nd.cmp.dMean, dn = W.ndbi.cmp.dMean, dw = W.ndwi.cmp.dMean;
        if (Math.abs(dv) < 0.02 && Math.abs(dn) < 0.02 && Math.abs(dw) < 0.02)
            add("info", "Interpretation: all three spectral indices are essentially unchanged, so the area looks spectrally stable between the two windows.");
        else if (dv < -0.05 && dn > 0.03)
            add("info", "Interpretation (hypothesis): falling NDVI together with rising NDBI is the typical signature of vegetation being replaced by bare or built-up surfaces. Verify with high-resolution imagery or ground data.");
        else if (dv < -0.05 && dw > 0.03)
            add("info", "Interpretation (hypothesis): falling NDVI with rising NDWI suggests higher surface moisture or inundation.");
        else if (dv > 0.05 && R.seasonGap > 45)
            add("info", "Interpretation (hypothesis): rising NDVI across mismatched seasons is most likely a growing-season effect.");
    }

    const fb = R.fire.b, fa = R.fire.a;
    if (fb && fa && !fb.error && !fa.error) {
        add("info", `Fire hotspots (${R.fire.days}-day windows): ${fb.count} detections earlier versus ${fa.count} later (${fa.count - fb.count >= 0 ? "+" : ""}${fa.count - fb.count}); total fire radiative power ${fx(fb.frpSum, 1)} MW versus ${fx(fa.frpSum, 1)} MW. Hotspots include agricultural burning and industrial heat sources, not only wildfires.`);
    }
    return F;
}

export function seriesCsv(raw) {
    const cols = ["ndvi", "ndwi", "ndbi"];
    const head = ["interval_from", "interval_to", ...cols.flatMap((c) => ["mean", "sd", "p10", "p50", "p90", "valid_fraction"].map((k) => `${c}_${k}`))];
    const rows = raw.map((r) => [r.from, r.to, ...cols.flatMap((c) => {
        const s = r[c];
        return s ? [s.mean, s.sd, s.p?.[10], s.p?.[50], s.p?.[90], s.total ? s.n / s.total : ""] : ["", "", "", "", "", ""];
    })]);
    return [head, ...rows].map((r) => r.map((v) => v ?? "").join(",")).join("\n");
}