import {
    HIST, DAY, NDVI_CLASSES, CHANGE_PAL, BG, DIM, fracAbove, classFractions, effectLabel,
    isoFromDay, toDay, addDays, seasonGap, studyArea, getImageSize, seriesPoints, analyseSeries,
    compareWindows, decodeImage, pixelChange, summariseFire, buildFindings, seriesCsv,
} from "./analysis";

const PW = 210, PH = 297, M = 14, CW = PW - 2 * M;
const C = {
    ink: [17, 24, 39], mute: [107, 114, 128], line: [229, 231, 235], accent: [16, 185, 129],
    early: [37, 99, 235], late: [234, 88, 12], warn: [180, 83, 9], bad: [185, 28, 28],
};
const TYPES = ["true-color", "ndvi", "water", "urban"];
const TITLES = {
    "true-color": "4.1 True-colour difference (all-surface change)",
    ndvi: "4.2 Vegetation change and class transitions (NDVI)",
    water: "4.3 Surface-water change (NDWI)",
    urban: "4.4 Built-up surface change (NDBI)",
};

const f = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : "-");
const sg = (v, n = 3) => (Number.isFinite(v) ? (v >= 0 ? "+" : "") + v.toFixed(n) : "-");
const pc = (v, n = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(n)}%` : "-");

/* ---------- layout helpers ---------- */
const need = (P, h) => { if (P.y + h > PH - 16) { P.doc.addPage(); P.y = 20; } };
const newPage = (P) => { P.doc.addPage(); P.y = 20; };
function h1(P, t) { need(P, 14); P.doc.setFont("helvetica", "bold"); P.doc.setFontSize(15); P.doc.setTextColor(...C.ink); P.doc.text(t, M, P.y); P.y += 8; }
function h2(P, t) { need(P, 10); P.doc.setFont("helvetica", "bold"); P.doc.setFontSize(10.5); P.doc.setTextColor(...C.ink); P.doc.text(t, M, P.y); P.y += 5.5; }
function para(P, t, size = 9, color = C.mute) {
    const d = P.doc;
    d.setFont("helvetica", "normal"); d.setFontSize(size); d.setTextColor(...color);
    const L = d.splitTextToSize(t, CW), h = L.length * size * 0.4 + 2;
    need(P, h); d.text(L, M, P.y); P.y += h;
}
function findingsList(P, list) {
    const d = P.doc;
    list.forEach(({ level, text }) => {
        d.setFont("helvetica", "normal"); d.setFontSize(9);
        const L = d.splitTextToSize(text, CW - 6), h = L.length * 3.7 + 2;
        need(P, h);
        d.setFillColor(...(level === "warn" ? C.warn : C.accent)); d.circle(M + 1.2, P.y - 1, 0.9, "F");
        d.setTextColor(...C.ink); d.text(L, M + 5, P.y); P.y += h;
    });
}
function table(P, head, rows, widths, size = 8) {
    const d = P.doc, rh = 5.2;
    const draw = (cells, bold, fill) => {
        need(P, rh + 1);
        if (fill) { d.setFillColor(...fill); d.rect(M, P.y - 3.6, CW, rh, "F"); }
        d.setFont("helvetica", bold ? "bold" : "normal"); d.setFontSize(size); d.setTextColor(...C.ink);
        let x = M + 1;
        cells.forEach((c, i) => { d.text(d.splitTextToSize(String(c ?? "-"), widths[i] - 2)[0] || "", x, P.y); x += widths[i]; });
        P.y += rh;
    };
    draw(head, true, [243, 244, 246]);
    rows.forEach((r) => draw(r, false));
    P.y += 2;
}
function legend(P, items) {
    const d = P.doc;
    items.forEach(([rgb, label]) => {
        need(P, 5);
        d.setFillColor(...rgb); d.setDrawColor(...C.mute); d.setLineWidth(0.1); d.rect(M, P.y - 2.8, 3, 3, "FD");
        d.setFont("helvetica", "normal"); d.setFontSize(8); d.setTextColor(...C.mute); d.text(label, M + 5, P.y); P.y += 4.3;
    });
    P.y += 1;
}
function imageRow(P, items) {
    const d = P.doc, gap = 3, iw0 = (CW - gap * (items.length - 1)) / items.length;
    let iw = iw0, ih = (iw0 * items[0].h) / items[0].w;
    if (ih > 95) { ih = 95; iw = (ih * items[0].w) / items[0].h; }
    need(P, ih + 10);
    items.forEach((it, i) => {
        const x = M + i * (iw0 + gap) + (iw0 - iw) / 2;
        d.setFont("helvetica", "bold"); d.setFontSize(8); d.setTextColor(...C.ink); d.text(it.label, x, P.y);
        d.addImage(it.jpeg, "JPEG", x, P.y + 2, iw, ih);
    });
    P.y += ih + 8;
}

/* ---------- charts ---------- */
function lineChart(P, { title, sub, pts, sen, color }) {
    const d = P.doc, h = 46;
    need(P, h + 12);
    d.setFont("helvetica", "bold"); d.setFontSize(9); d.setTextColor(...C.ink); d.text(title, M, P.y);
    d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(...C.mute); d.text(sub, M + CW, P.y, { align: "right" });
    const x0 = M + 11, y0 = P.y + 3, pw = CW - 13, ph = h - 10;
    if (!pts.length) { d.text("No usable observations (too much cloud or no coverage).", x0, y0 + 10); P.y += h; return; }
    let lo = Math.min(...pts.map((p) => p.mean - p.sd)), hi = Math.max(...pts.map((p) => p.mean + p.sd));
    const pad = (hi - lo || 0.2) * 0.08; lo -= pad; hi += pad;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = t1 - t0 || 1;
    const X = (t) => x0 + ((t - t0) / span) * pw, Y = (v) => y0 + ph - ((v - lo) / (hi - lo)) * ph;
    const cl = (y) => Math.min(y0 + ph, Math.max(y0, y));
    d.setDrawColor(...C.line); d.setLineWidth(0.15); d.setFontSize(6.5); d.setTextColor(...C.mute);
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; d.line(x0, Y(v), x0 + pw, Y(v)); d.text(v.toFixed(2), x0 - 1.5, Y(v) + 0.8, { align: "right" }); }
    d.setDrawColor(...color); d.setLineWidth(0.2);
    pts.forEach((p) => d.line(X(p.t), cl(Y(p.mean + p.sd)), X(p.t), cl(Y(p.mean - p.sd))));
    d.setLineWidth(0.5);
    for (let i = 1; i < pts.length; i++) d.line(X(pts[i - 1].t), Y(pts[i - 1].mean), X(pts[i].t), Y(pts[i].mean));
    d.setFillColor(...color); pts.forEach((p) => d.circle(X(p.t), Y(p.mean), 0.7, "F"));
    if (sen) {
        d.setDrawColor(...C.bad); d.setLineWidth(0.35); d.setLineDashPattern([1.5, 1.2], 0);
        d.line(X(t0), cl(Y(sen.intercept + sen.slope * t0)), X(t1), cl(Y(sen.intercept + sen.slope * t1)));
        d.setLineDashPattern([], 0);
    }
    d.setFontSize(6.5); d.setTextColor(...C.mute);
    [0, 0.5, 1].forEach((fr) => d.text(isoFromDay(Math.round(t0 + span * fr)), X(t0 + span * fr), y0 + ph + 4, { align: fr === 0 ? "left" : fr === 1 ? "right" : "center" }));
    P.y += h + 4;
}

function histChart(P, { title, b, a, thr }) {
    const d = P.doc, h = 38;
    need(P, h + 10);
    d.setFont("helvetica", "bold"); d.setFontSize(9); d.setTextColor(...C.ink); d.text(title, M, P.y);
    d.setFillColor(...C.early); d.rect(M + CW - 38, P.y - 2.6, 3, 3, "F"); d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(...C.mute); d.text("Earlier", M + CW - 34, P.y);
    d.setFillColor(...C.late); d.rect(M + CW - 18, P.y - 2.6, 3, 3, "F"); d.text("Later", M + CW - 14, P.y);
    const x0 = M + 4, y0 = P.y + 3, pw = CW - 6, ph = h - 10;
    if (!b || !a) { d.text("Histogram unavailable.", x0, y0 + 10); P.y += h; return; }
    const sum = (arr) => arr.reduce((x, y) => x + y, 0), nb = sum(b.hist) || 1, na = sum(a.hist) || 1;
    const pb = b.hist.map((v) => v / nb), pa = a.hist.map((v) => v / na);
    const mx = Math.max(...pb, ...pa) || 1, bw = pw / HIST.n;
    [[pb, C.early], [pa, C.late]].forEach(([arr, col]) => {
        d.setGState(new d.GState({ opacity: 0.45 })); d.setFillColor(...col);
        arr.forEach((v, i) => { const bh = (v / mx) * ph; if (bh > 0.05) d.rect(x0 + i * bw, y0 + ph - bh, bw, bh, "F"); });
    });
    d.setGState(new d.GState({ opacity: 1 }));
    d.setDrawColor(...C.mute); d.setLineWidth(0.2); d.line(x0, y0 + ph, x0 + pw, y0 + ph);
    d.setFontSize(6.5); d.setTextColor(...C.mute);
    [-1, -0.5, 0, 0.5, 1].forEach((v) => d.text(String(v), x0 + ((v - HIST.low) / (HIST.high - HIST.low)) * pw, y0 + ph + 4, { align: "center" }));
    if (thr !== undefined) {
        const tx = x0 + ((thr - HIST.low) / (HIST.high - HIST.low)) * pw;
        d.setDrawColor(...C.bad); d.setLineDashPattern([1, 1], 0); d.line(tx, y0, tx, y0 + ph); d.setLineDashPattern([], 0);
    }
    P.y += h + 4;
}

function barChart(P, { title, items, h = 34 }) {
    const d = P.doc;
    need(P, h + 10);
    d.setFont("helvetica", "bold"); d.setFontSize(9); d.setTextColor(...C.ink); d.text(title, M, P.y);
    const x0 = M + 11, y0 = P.y + 3, pw = CW - 13, ph = h - 10;
    const mx = Math.max(1, ...items.filter(Boolean).map((i) => i.v)), bw = pw / Math.max(1, items.length);
    items.forEach((it, i) => {
        if (!it) return;
        const bh = (it.v / mx) * ph;
        d.setFillColor(...it.color); if (bh > 0.05) d.rect(x0 + i * bw + 0.2, y0 + ph - bh, Math.max(0.5, bw - 0.4), bh, "F");
        if (it.label) { d.setFontSize(6); d.setTextColor(...C.mute); d.text(it.label, x0 + i * bw, y0 + ph + 4); }
    });
    d.setDrawColor(...C.mute); d.setLineWidth(0.2); d.line(x0, y0 + ph, x0 + pw, y0 + ph);
    d.setFontSize(6.5); d.setTextColor(...C.mute); d.text("0", x0 - 1.5, y0 + ph, { align: "right" }); d.text(String(Math.round(mx)), x0 - 1.5, y0 + 2, { align: "right" });
    P.y += h + 4;
}

function heatGrids(P, grids) {
    const d = P.doc, cell = 5, size = cell * 8;
    need(P, size + 12);
    grids.forEach(({ label, grid, color }, k) => {
        const gx = M + k * (size + 14), mx = Math.max(1, ...grids.flatMap((g) => g.grid.flat()));
        d.setFont("helvetica", "bold"); d.setFontSize(8); d.setTextColor(...C.ink); d.text(label, gx, P.y);
        grid.forEach((row, y) =>
            row.forEach((c, x) => {
                const t = c / mx;

                const mix = (ch) =>
                    Math.round(255 - (255 - ch) * t * 0.95);

                d.setFillColor(
                    mix(color[0]),
                    mix(color[1]),
                    mix(color[2])
                );

                d.setDrawColor(255, 255, 255);

                d.rect(
                    gx + x * cell,
                    P.y + 2 + y * cell,
                    cell,
                    cell,
                    "FD"
                );

                if (c) {
                    d.setFontSize(5);
                    d.setTextColor(
                        t > 0.5 ? 255 : 17,
                        t > 0.5 ? 255 : 24,
                        t > 0.5 ? 255 : 39
                    );

                    d.text(
                        String(c),
                        gx + x * cell + cell / 2,
                        P.y + 2 + y * cell + 3.3,
                        { align: "center" }
                    );
                }
            })
        );
    });
    P.y += size + 8;
}

function cover(P, R) {
    const d = P.doc, W = R.win;
    d.setFillColor(...C.accent); d.rect(0, 0, PW, 4, "F");
    d.setFont("helvetica", "bold"); d.setFontSize(24); d.setTextColor(...C.ink); d.text("GeoTime", M, 22);
    d.setFontSize(11); d.setTextColor(...C.accent); d.text("Multi-temporal satellite change analysis report", M, 29);
    P.y = 40;
    [["Location", R.locationName], ["Period", `${R.startDate} to ${R.endDate} (${R.days} days)`],
    ["Area", `${R.area.areaKm2.toFixed(1)} km2 (${R.area.wKm.toFixed(1)} x ${R.area.hKm.toFixed(1)} km)`],
    ["Generated", new Date().toLocaleString()]].forEach(([k, v]) => {
        d.setFont("helvetica", "bold"); d.setFontSize(9); d.setTextColor(...C.mute); d.text(k, M, P.y);
        d.setFont("helvetica", "normal"); d.setTextColor(...C.ink); d.text(d.splitTextToSize(v, CW - 28), M + 28, P.y); P.y += 5.5;
    });
    P.y += 4; h2(P, "Key metrics (area-wide, cloud-masked)");
    const row = (name, vb, va, asPct) => {
        const ok = Number.isFinite(vb) && Number.isFinite(va);
        return asPct ? [name, pc(vb), pc(va), ok ? `${sg((va - vb) * 100, 1)} pp` : "-"] : [name, f(vb), f(va), ok ? sg(va - vb) : "-"];
    };
    const fa = (w, t) => (w ? fracAbove(w, t) : NaN);
    table(P, ["Metric", "Earlier window", "Later window", "Change"], [
        row("Mean NDVI", W.ndvi.b?.mean ?? NaN, W.ndvi.a?.mean ?? NaN),
        row("Mean NDWI", W.ndwi.b?.mean ?? NaN, W.ndwi.a?.mean ?? NaN),
        row("Mean NDBI", W.ndbi.b?.mean ?? NaN, W.ndbi.a?.mean ?? NaN),
        row("NDVI above 0.4", fa(W.ndvi.b, 0.4), fa(W.ndvi.a, 0.4), true),
        row("Water (NDWI above 0.15)", fa(W.ndwi.b, 0.15), fa(W.ndwi.a, 0.15), true),
        row("Built-up (NDBI above 0.1)", fa(W.ndbi.b, 0.1), fa(W.ndbi.a, 0.1), true),
        row("Valid-data coverage (NDVI)", W.ndvi.b ? W.ndvi.b.n / W.ndvi.b.total : NaN, W.ndvi.a ? W.ndvi.a.n / W.ndvi.a.total : NaN, true),
        ["Fire hotspot detections", R.fire.b?.count ?? "-", R.fire.a?.count ?? "-", R.fire.b && R.fire.a ? sg(R.fire.a.count - R.fire.b.count, 0) : "-"],
    ], [62, 40, 40, 40]);
    P.y += 2; h2(P, "Key findings");
    findingsList(P, R.findings);
}

function studyAreaPage(P, R) {
    h1(P, "1. Study area, data and parameters");
    table(P, ["Parameter", "Value"], [
        ["Bounding box (W, S, E, N)", R.bbox.map((n) => n.toFixed(4)).join(", ")],
        ["Centre (lon, lat)", R.area.center.map((n) => n.toFixed(4)).join(", ")],
        ["Extent", `${R.area.wKm.toFixed(2)} x ${R.area.hKm.toFixed(2)} km = ${R.area.areaKm2.toFixed(2)} km2`],
        ["Sensor / product", "Copernicus Sentinel-2 L2A (surface reflectance)"],
        ["Statistics grid", `400 x 400 cells, about ${R.statsResM.toFixed(0)} m per cell`],
        ["Change-map grid", `${R.imgW} x ${R.imgH} px, about ${R.imgResM.toFixed(0)} m per pixel`],
        ["Earlier comparison window", `${R.winR.b[0]} to ${R.winR.b[1]}`],
        ["Later comparison window", `${R.winR.a[0]} to ${R.winR.a[1]}`],
        ["Time-series interval", `${R.stepDays} days`],
        ["Season offset between dates", `${R.seasonGap} days`],
        ["Cloud handling", "Scene Classification Layer: classes 4-7 kept; shadow, cloud, cirrus, snow removed"],
        ["Fire data", `NASA FIRMS VIIRS S-NPP (${R.fire.source || "n/a"}), ${R.fire.days}-day windows`],
    ], [58, 124]);
    para(P, "All areas are computed from pixel counts scaled to the study-area extent. Percentages refer to pixels with valid (cloud-free) data in the given window unless stated otherwise.");
}

function timeSeriesPage(P, R) {
    h1(P, "2. Time-series analysis");
    para(P, `Area statistics for each ${R.stepDays}-day interval over the selected period. Dots are the area mean, vertical bars are the spatial standard deviation within the area, and the dashed line is the Theil-Sen trend. Intervals with under 20% valid pixels are omitted.`);
    const defs = [["ndvi", "NDVI - vegetation vigour", C.accent], ["ndwi", "NDWI - surface water and moisture", C.early], ["ndbi", "NDBI - built-up and bare surfaces", C.late]];
    defs.forEach(([id, title, color]) => lineChart(P, { title, sub: "bars: spatial SD, dashed: Theil-Sen", pts: R.S[id].pts, sen: R.S[id].an?.sen, color }));
    h2(P, "Trend and variability statistics");
    table(P, ["Index", "n", "Mean", "SD", "Minimum (date)", "Maximum (date)", "MK p", "Sen/yr", "R2"],
        ["ndvi", "ndwi", "ndbi"].map((id) => {
            const a = R.S[id].an;
            return a.enough
                ? [id.toUpperCase(), a.n, f(a.mean), f(a.sd), `${f(a.min)} (${a.minDate})`, `${f(a.max)} (${a.maxDate})`, f(a.mk.p), sg(a.senPerYear), f(a.r2, 2)]
                : [id.toUpperCase(), a.n, "needs 4+ intervals", "", "", "", "", "", ""];
        }), [16, 9, 17, 15, 36, 36, 14, 20, 19]);
    para(P, "MK p is the Mann-Kendall trend-test p-value (below 0.05 suggests a monotonic trend). Sen/yr is the Theil-Sen slope in index units per year. Over periods shorter than a year the seasonal cycle dominates these values.");
    const cov = R.S.ndvi.pts;
    barChart(P, {
        title: "Valid-pixel coverage per interval (%, NDVI)",
        items: cov.map((p, i) => ({ v: p.cov * 100, color: C.accent, label: i === 0 || i === cov.length - 1 ? p.date.slice(2) : "" })),
    });
}

function windowPage(P, R) {
    h1(P, "3. Earlier vs later window comparison");
    para(P, `Distributions of each index over all valid pixels in the earlier (${R.winR.b[0]} to ${R.winR.b[1]}) and later (${R.winR.a[0]} to ${R.winR.a[1]}) windows. Red dashed lines mark the thresholds used in this report.`);
    const defs = [["ndvi", "NDVI distribution", 0.4], ["ndwi", "NDWI distribution", 0.15], ["ndbi", "NDBI distribution", 0.1]];
    defs.forEach(([id, title, thr]) => {
        histChart(P, { title, b: R.win[id].b, a: R.win[id].a, thr });
        const { b, a, cmp } = R.win[id];
        if (!b || !a || !cmp) { para(P, "Insufficient data for this index.", 9, C.bad); return; }
        table(P, ["Statistic", "Earlier", "Later", "Change"], [
            ["Mean", f(b.mean), f(a.mean), sg(a.mean - b.mean)],
            ["Standard deviation", f(b.sd), f(a.sd), sg(a.sd - b.sd)],
            ["10th percentile", f(b.p[10]), f(a.p[10]), sg(a.p[10] - b.p[10])],
            ["Median", f(b.p[50]), f(a.p[50]), sg(a.p[50] - b.p[50])],
            ["90th percentile", f(b.p[90]), f(a.p[90]), sg(a.p[90] - b.p[90])],
            [`Share above ${thr}`, pc(fracAbove(b, thr)), pc(fracAbove(a, thr)), `${sg((fracAbove(a, thr) - fracAbove(b, thr)) * 100, 1)} pp`],
            ["Valid pixels", `${b.n.toLocaleString()} (${pc(b.n / b.total, 0)})`, `${a.n.toLocaleString()} (${pc(a.n / a.total, 0)})`, ""],
        ], [60, 40, 40, 40]);
        para(P, `Effect size: Cohen's d = ${f(cmp.cohenD, 2)} (${effectLabel(cmp.cohenD)}). Total variation distance = ${f(cmp.tv, 2)} (0 = identical, 1 = no overlap). Wasserstein-1 distance = ${f(cmp.w1)} index units.`, 8.5, C.ink);
    });
    if (R.win.ndvi.b && R.win.ndvi.a) {
        h2(P, "NDVI class composition");
        const th = [0, 0.2, 0.4, 0.6], cb = classFractions(R.win.ndvi.b, th), ca = classFractions(R.win.ndvi.a, th), A = R.area.areaKm2;
        table(P, ["Class", "Earlier", "Later", "Change", "Earlier km2", "Later km2"],
            NDVI_CLASSES.map((c, i) => [c.short, pc(cb[i]), pc(ca[i]), `${sg((ca[i] - cb[i]) * 100, 1)} pp`, (cb[i] * A).toFixed(2), (ca[i] * A).toFixed(2)]),
            [26, 30, 30, 32, 32, 32]);
        para(P, "Areas extrapolate the valid-pixel share to the full study area and are approximate when coverage is low.");
    }
}

function changePage(P, R, type) {
    const c = R.changes[type];
    h1(P, TITLES[type]);
    if (!c || c.error) { para(P, `Unavailable: ${c?.error || "no data returned"}`, 10, C.bad); return; }
    imageRow(P, [
        { label: `Earlier (${c.beforeDate})`, jpeg: c.beforeJpeg, w: c.w, h: c.h },
        { label: `Later (${c.afterDate})`, jpeg: c.afterJpeg, w: c.w, h: c.h },
        { label: "Change map", jpeg: c.jpeg, w: c.w, h: c.h },
    ]);
    const V = c.valid || 1, km = (n) => (n * c.pxKm2).toFixed(2), sh = (n) => pc(n / V);
    para(P, `Pixels with valid data on both dates: ${c.valid.toLocaleString()} of ${c.total.toLocaleString()} (${pc(c.valid / c.total, 0)}). Pixels masked as cloud, shadow or no data on either date are excluded.`, 8.5, C.ink);

    if (type === "ndvi") {
        legend(P, [[[22, 163, 74], "Improved by 2 or more classes"], [[134, 239, 172], "Improved by 1 class"], [DIM, "Same class"],
        [[252, 165, 165], "Declined by 1 class"], [[220, 38, 38], "Declined by 2 or more classes"], [BG, "No valid data on one or both dates"]]);
        table(P, ["Change category", "Share of valid pixels", "Area km2"], [
            ["Improved (any)", sh(c.improved), km(c.improved)], ["  of which 2+ classes", sh(c.strongUp), km(c.strongUp)],
            ["Unchanged", sh(c.stable), km(c.stable)],
            ["Declined (any)", sh(c.degraded), km(c.degraded)], ["  of which 2+ classes", sh(c.strongDown), km(c.strongDown)],
            ["Net balance", `${sg(((c.improved - c.degraded) / V) * 100, 1)} pp`, sg((c.improved - c.degraded) * c.pxKm2, 2)],
        ], [70, 60, 52]);
        h2(P, "Class transition matrix (% of valid pixels; rows = earlier, columns = later)");
        const S = NDVI_CLASSES.map((k) => k.short);
        table(P, ["Earlier / Later", ...S], c.matrix.map((row, i) => [S[i], ...row.map((n) => pc(n / V))]), [32, 30, 30, 30, 30, 30]);
    } else if (type === "true-color") {
        legend(P, [[[30, 40, 150], "Little or no change"], [[145, 190, 75], "Moderate change"], [[255, 40, 30], "Strong change (RGB difference of 30% or more)"]]);
        table(P, ["Measure", "Value"], [
            ["Mean RGB difference", pc(c.meanDiff)], ["Pixels changed above 10%", pc(c.share10)], ["Pixels changed above 20%", pc(c.share20)],
            ["Brightness correlation between dates", f(c.corr, 3)],
            ["Mean R, G, B earlier", c.meanB.map((v) => v.toFixed(0)).join(", ")], ["Mean R, G, B later", c.meanA.map((v) => v.toFixed(0)).join(", ")],
        ], [90, 92]);
        para(P, "This layer is not cloud-masked, so clouds and haze appear as change. Use the NDVI, water and built-up pages to separate surface change from atmosphere.");
    } else {
        const p = CHANGE_PAL[type], what = type === "water" ? "water" : "built-up surface";
        legend(P, [[p.stable, `${what} on both dates`], [p.gain, `${what} gained (later only)`], [p.loss, `${what} lost (earlier only)`], [DIM, "Other valid pixels"], [BG, "No valid data on one or both dates"]]);
        table(P, ["Category", "Share of valid pixels", "Area km2"], [
            ["Gained", sh(c.gained), km(c.gained)], ["Lost", sh(c.lost), km(c.lost)], ["Stable", sh(c.stable), km(c.stable)],
            ["Net change", `${sg(((c.gained - c.lost) / V) * 100, 2)} pp`, sg((c.gained - c.lost) * c.pxKm2, 2)],
        ], [70, 60, 52]);
        if (type === "urban") para(P, "NDBI flags built-up surfaces but also dry bare soil and harvested fields. Treat gains as candidates for verification, especially when the dates are in different seasons.");
    }
}

function firePage(P, R) {
    h1(P, "5. Active fire hotspots (NASA FIRMS VIIRS)");
    const { b, a } = R.fire;
    if (!b || !a || b.error || a.error) { para(P, `Fire data unavailable: ${b?.error || a?.error || "no response"}.`, 10, C.bad); return; }
    para(P, `Two equal ${R.fire.days}-day windows are compared: ${R.fire.windows.b[0]} to ${R.fire.windows.b[1]} (earlier) and ${R.fire.windows.a[0]} to ${R.fire.windows.a[1]} (later). Data source: ${R.fire.source || "n/a"}. Thermal anomalies include agricultural burning and industrial heat, not only wildfires.`);
    const r = (n, x, y, d = 0) => [n, f(x, d), f(y, d), Number.isFinite(x) && Number.isFinite(y) ? sg(y - x, d) : "-"];
    table(P, ["Measure", "Earlier", "Later", "Change"], [
        r("Detections", b.count, a.count), r("High confidence", b.conf.h, a.conf.h), r("Nominal confidence", b.conf.n, a.conf.n), r("Low confidence", b.conf.l, a.conf.l),
        r("Daytime detections", b.day, a.day), r("Night-time detections", b.night, a.night),
        r("Total FRP (MW)", b.frpSum, a.frpSum, 1), r("Mean FRP (MW)", b.frpMean, a.frpMean, 1), r("Median FRP (MW)", b.frpMedian, a.frpMedian, 1), r("Maximum FRP (MW)", b.frpMax, a.frpMax, 1),
        ["Share in top-3 grid cells", pc(b.top3share, 0), pc(a.top3share, 0), "-"],
    ], [62, 40, 40, 40]);
    const days = (w) => Array.from({ length: R.fire.days }, (_, i) => addDays(w[0], i));
    const items = [
        ...days(R.fire.windows.b).map((dt, i) => ({ v: b.byDay[dt] || 0, color: C.early, label: i === 0 ? dt.slice(5) : "" })), null,
        ...days(R.fire.windows.a).map((dt, i) => ({ v: a.byDay[dt] || 0, color: C.late, label: i === 0 ? dt.slice(5) : "" })),
    ];
    if (b.count === 0 && a.count === 0) {
        h2(P, "Fire detection summary");
        para(
            P,
            "No active fire hotspots were detected in either comparison window within the selected study area. Consequently, no spatial-density distribution is available.",
            9,
            C.mute
        );
    } else {
        barChart(P, {
            title: "Detections per day (blue: earlier window, orange: later window)",
            items
        });

        h2(P, "Spatial density (8 x 8 grid, north up)");

        heatGrids(P, [
            { label: "Earlier", grid: b.grid, color: C.early },
            { label: "Later", grid: a.grid, color: C.late }
        ]);
    }
    const tc = (s) => s.topCells.map((c) => `${c.c} at ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`).join("; ") || "none";
    para(P, `Densest cells (count at lat, lon). Earlier: ${tc(b)}. Later: ${tc(a)}.`, 8.5, C.ink);
}

function methodsPage(P) {
    h1(P, "6. Methods, interpretation guide and limitations");
    [
        ["Data", "Sentinel-2 L2A surface reflectance from the Copernicus Data Space Ecosystem via Sentinel Hub. Statistics use a 400 x 400 grid over the study area; change maps use the image grid listed in section 1. Mosaics prefer the scene with the lowest cloud cover."],
        ["Cloud masking", "Time-series statistics and the NDVI, water and built-up change maps keep Scene Classification Layer classes vegetation, bare soil, water and unclassified, and remove cloud shadow, medium and high cloud, cirrus and snow. The true-colour layer is not masked. The SCL is itself imperfect; thin cloud and haze can survive."],
        ["Indices", "NDVI = (B08 - B04) / (B08 + B04). NDWI = (B03 - B08) / (B03 + B08), water threshold 0.15. NDBI = (B11 - B08) / (B11 + B08), built-up threshold 0.1."],
        ["Effect size and distribution distance", "Cohen's d is the mean difference divided by the pooled standard deviation (below 0.2 negligible, 0.2-0.5 small, 0.5-0.8 medium, above 0.8 large). Total variation is half the summed absolute difference between the two histograms. Wasserstein-1 is the area between the two cumulative distributions, in index units. No p-value is given for window differences because neighbouring pixels are spatially autocorrelated, which makes naive tests overconfident."],
        ["Trend tests", "The Mann-Kendall test and Theil-Sen slope are non-parametric and robust to outliers, but they ignore autocorrelation and the seasonal cycle. Use series longer than one year, or deseasonalise before inferring long-term change."],
        ["Pixel-level change", "Change maps compare the two rendered mosaics pixel by pixel and classify each pixel from its colour class, so they are quantised (NDVI in 5 classes, water and built-up as binary). Small misregistration, sun-angle and atmospheric differences can create spurious change at field edges."],
        ["Limitations", "Comparison windows are about +/-10 days around each date, and the change-map mosaics may use up to +/-30 days when clear imagery is scarce, so they represent the window rather than one acquisition day. Fire hotspots are 375 m VIIRS thermal detections. Results are indicative and should be validated with ground data or high-resolution imagery before use in decisions or publication."],
    ].forEach(([t, body]) => { h2(P, t); para(P, body, 8.5); });
}

function appendix(P, R) {
    h1(P, "Appendix: time-series data");
    const rows = R.raw.slice(0, 60).map((r) => [
        `${r.from} - ${r.to.slice(5)}`,
        r.ndvi ? f(r.ndvi.mean) : "-", r.ndvi ? f(r.ndvi.sd) : "-", r.ndwi ? f(r.ndwi.mean) : "-", r.ndbi ? f(r.ndbi.mean) : "-",
        r.ndvi ? pc(r.ndvi.n / r.ndvi.total, 0) : "-",
    ]);
    table(P, ["Interval", "NDVI mean", "NDVI SD", "NDWI mean", "NDBI mean", "Valid"], rows, [46, 28, 28, 28, 28, 24], 7.5);
    para(
        P,
        "This appendix presents the available time-series observations. The accompanying CSV export contains the complete dataset, including percentiles.",
        8.5
    );
}

async function buildReport(R) {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const P = { doc, y: 20 };
    cover(P, R);
    newPage(P); studyAreaPage(P, R);
    newPage(P); timeSeriesPage(P, R);
    newPage(P); windowPage(P, R);
    newPage(P); h1(P, "4. Pixel-level change detection"); para(P, "Change maps compare the earlier and later mosaics pixel by pixel, using only pixels that are valid on both dates.");
    TYPES.forEach((t, i) => { if (i) newPage(P); changePage(P, R, t); });
    newPage(P); firePage(P, R);
    newPage(P); methodsPage(P);
    newPage(P); appendix(P, R);
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
        doc.text(`GeoTime / ${R.locationName}`.slice(0, 80), M, PH - 8); doc.text(`Page ${i} of ${n}`, PW - M, PH - 8, { align: "right" });
    }
    return doc;
}

/* ---------- orchestration ---------- */
async function getJson(url) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error(j.message || `Request failed (${r.status})`);
    return j;
}
function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function generateResearchReport({ locationName, bbox, startDate, endDate, onProgress = () => { } }) {
    const bboxParam = bbox.join(","), area = studyArea(bbox);
    const days = Math.round(toDay(endDate) - toDay(startDate)) + 1;
    if (days > 1100) throw new Error("Please choose a period shorter than about 3 years.");
    const today = new Date().toISOString().slice(0, 10);
    const stepDays = Math.max(5, Math.ceil(days / 30));
    const winR = { b: [addDays(startDate, -10), addDays(startDate, 10)], a: [addDays(endDate, -10), addDays(endDate, 10) > today ? today : addDays(endDate, 10)] };

    onProgress("Report: computing spectral statistics...");
    const q = (from, to, interval) => getJson(`/api/sentinel/stats?${new URLSearchParams({ bbox: bboxParam, from, to, interval: String(interval) })}`);
    const [ts, wb, wa] = await Promise.allSettled([q(startDate, endDate, stepDays), q(winR.b[0], winR.b[1], 22), q(winR.a[0], winR.a[1], 22)]);
    if (ts.status !== "fulfilled" && wb.status !== "fulfilled" && wa.status !== "fulfilled") throw new Error(ts.reason?.message || "Statistics request failed.");
    const raw = ts.status === "fulfilled" ? ts.value.series : [];
    const pick = (res, id) => {
        if (res.status !== "fulfilled") return null;
        return res.value.series.filter((r) => r[id]).sort((x, y) => y[id].n - x[id].n)[0]?.[id] ?? null;
    };

    const S = {}, win = {};
    for (const id of ["ndvi", "ndwi", "ndbi"]) {
        const pts = seriesPoints(raw, id);
        S[id] = { pts, an: analyseSeries(pts) };
        const b = pick(wb, id), a = pick(wa, id);
        win[id] = { b, a, cmp: compareWindows(b, a) };
    }

    const { width, height } = getImageSize(...bbox);
    const pxKm2 = area.areaKm2 / (width * height), changes = {}, images = {};
    for (const [i, type] of TYPES.entries()) {
        onProgress(`Report: pixel-level change ${i + 1}/${TYPES.length}...`);
        try {
            const j = await getJson(`/api/sentinel/compare?${new URLSearchParams({ bbox: bboxParam, before: startDate, after: endDate, type, width: String(width), height: String(height) })}`);
            const [B, A] = await Promise.all([decodeImage(j.beforeImage), decodeImage(j.afterImage)]);
            changes[type] = { ...pixelChange(type, B.data, A.data, pxKm2), beforeJpeg: B.jpeg, afterJpeg: A.jpeg, beforeDate: j.before, afterDate: j.after };
        } catch (e) { changes[type] = { error: e.message }; }
    }

    onProgress("Report: fetching fire hotspots...");
    const L = Math.max(1, Math.min(10, Math.floor(days / 2)));
    const fw = { b: [startDate, addDays(startDate, L - 1)], a: [addDays(endDate, -(L - 1)), endDate] };
    const fireCall = async (w) => {
        const j = await getJson(`/api/firms/fires?${new URLSearchParams({ bbox: bboxParam, from: w[0], to: w[1] })}`);
        return summariseFire(j.features, bbox, L, j.source);
    };
    const [fb, fa] = await Promise.allSettled([fireCall(fw.b), fireCall(fw.a)]);
    const fire = {
        days: L, windows: fw,
        b: fb.status === "fulfilled" ? fb.value : { error: fb.reason?.message },
        a: fa.status === "fulfilled" ? fa.value : { error: fa.reason?.message },
    };
    fire.source = fire.b.source || fire.a.source;

    if (!raw.length && Object.values(changes).every((c) => c.error)) throw new Error("No satellite data could be retrieved for this area and period.");

    const R = {
        locationName, bbox, startDate, endDate, days, area, stepDays, winR, raw, S, win, changes, fire, images,
        gapDays: Math.round(toDay(endDate) - toDay(startDate)), seasonGap: seasonGap(startDate, endDate),
        statsResM: (area.wKm * 1000) / 400, imgW: width, imgH: height, imgResM: (area.wKm * 1000) / width,
    };
    R.findings = buildFindings(R);

    onProgress("Report: building PDF...");
    const doc = await buildReport(R);
    const slug = locationName.replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
    const base = `GeoTime_${slug}_${startDate}_${endDate}`;
    doc.save(`${base}.pdf`);
    download(`${base}_timeseries.csv`, seriesCsv(raw), "text/csv");
    return `${base}.pdf`;
}