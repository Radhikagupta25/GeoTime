import express from "express";
import cors from "cors";
import { getSentinelHubToken } from "./services/sentinelHub.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "GeoTime API is running!",
    });
});

app.get("/api/sentinel/ndvi", async (req, res) => {
    try {
        const { bbox, from, to, width = 512, height = 512 } = req.query;

        if (!bbox || !from || !to) {
            return res.status(400).json({
                success: false,
                message: "Please provide bbox, from, and to parameters.",
            });
        }

        const coordinates = bbox.split(",").map(Number);

        if (
            coordinates.length !== 4 ||
            coordinates.some((value) => !Number.isFinite(value)) ||
            coordinates[0] >= coordinates[2] ||
            coordinates[1] >= coordinates[3]
        ) {
            return res.status(400).json({
                success: false,
                message: "bbox must be minLon,minLat,maxLon,maxLat.",
            });
        }

        const imageWidth = Number(width);
        const imageHeight = Number(height);

        if (
            !Number.isInteger(imageWidth) ||
            !Number.isInteger(imageHeight) ||
            imageWidth < 1 ||
            imageHeight < 1 ||
            imageWidth > 2500 ||
            imageHeight > 2500
        ) {
            return res.status(400).json({
                success: false,
                message: "width and height must be integers between 1 and 2500.",
            });
        }

        const startDate = new Date(from);
        const endDate = new Date(to);

        if (
            Number.isNaN(startDate.getTime()) ||
            Number.isNaN(endDate.getTime()) ||
            startDate > endDate
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid date range.",
            });
        }

        const token = await getSentinelHubToken();

        const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B04", "B08", "dataMask"]
    }],
    output: {
      bands: 4,
      sampleType: "AUTO"
    }
  };
}

function evaluatePixel(sample) {
  if (sample.dataMask === 0) {
    return [0, 0, 0, 0];
  }

  const denominator = sample.B08 + sample.B04;

  const ndvi = denominator === 0
    ? 0
    : (sample.B08 - sample.B04) / denominator;

  if (ndvi < 0) return [0.45, 0.25, 0.15, 1];
  if (ndvi < 0.2) return [0.8, 0.7, 0.3, 1];
  if (ndvi < 0.4) return [0.7, 0.85, 0.3, 1];
  if (ndvi < 0.6) return [0.25, 0.7, 0.25, 1];

  return [0.05, 0.4, 0.1, 1];
}`;

        const response = await fetch(
            "https://sh.dataspace.copernicus.eu/api/v1/process",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    Accept: "image/png",
                },
                body: JSON.stringify({
                    input: {
                        bounds: {
                            bbox: coordinates,
                        },
                        data: [
                            {
                                type: "sentinel-2-l2a",
                                dataFilter: {
                                    timeRange: {
                                        from: startDate.toISOString(),
                                        to: endDate.toISOString(),
                                    },
                                    mosaickingOrder: "leastCC",
                                    maxCloudCoverage: 30,
                                },
                            },
                        ],
                    },
                    output: {
                        width: imageWidth,
                        height: imageHeight,
                        responses: [
                            {
                                identifier: "default",
                                format: {
                                    type: "image/png",
                                },
                            },
                        ],
                    },
                    evalscript,
                }),
            }
        );

        if (!response.ok) {
            const errorDetails = await response.text();

            console.error(
                "Sentinel Hub NDVI request failed:",
                response.status,
                errorDetails.slice(0, 1000)
            );

            return res.status(502).json({
                success: false,
                message: "Sentinel Hub could not generate the NDVI image.",
                upstreamStatus: response.status,
            });
        }

        const imageBuffer = Buffer.from(await response.arrayBuffer());

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Disposition", 'inline; filename="ndvi.png"');

        return res.send(imageBuffer);
    } catch (error) {
        console.error("NDVI endpoint failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to generate NDVI imagery.",
        });
    }
});


app.get("/api/sentinel/visualization", async (req, res) => {
    try {
        const {
            bbox,
            from,
            to,
            type = "true-color",
            width = 512,
            height = 512,
        } = req.query;

        if (!bbox || !from || !to) {
            return res.status(400).json({
                success: false,
                message: "Please provide bbox, from, and to.",
            });
        }

        if (!["true-color", "false-color", "water", "urban"].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "type must be true-color, false-color, water, or urban.",
            });
        }

        const coordinates = bbox.split(",").map(Number);
        const imageWidth = Number(width);
        const imageHeight = Number(height);
        const startDate = new Date(from);
        const endDate = new Date(to);

        if (
            coordinates.length !== 4 ||
            coordinates.some((n) => !Number.isFinite(n)) ||
            coordinates[0] < -180 ||
            coordinates[2] > 180 ||
            coordinates[1] < -90 ||
            coordinates[3] > 90 ||
            coordinates[0] >= coordinates[2] ||
            coordinates[1] >= coordinates[3]
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid bbox. Use minLon,minLat,maxLon,maxLat.",
            });
        }

        if (
            !Number.isInteger(imageWidth) ||
            !Number.isInteger(imageHeight) ||
            imageWidth < 1 || imageWidth > 2500 ||
            imageHeight < 1 || imageHeight > 2500
        ) {
            return res.status(400).json({
                success: false,
                message: "Image dimensions must be between 1 and 2500.",
            });
        }

        if (
            Number.isNaN(startDate.getTime()) ||
            Number.isNaN(endDate.getTime()) ||
            startDate > endDate
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid date range.",
            });
        }

        const token = await getSentinelHubToken();

        const evalscript =
            type === "true-color"
                ? `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B02", "B03", "B04", "dataMask"] }],
        output: {
            bands: 4,
            sampleType: "AUTO"
        }
    };
}
function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];
    return [s.B04 * 2.5, s.B03 * 2.5, s.B02 * 2.5, 1];
}`
                : type === "false-color"
                    ? `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B03", "B04", "B08", "dataMask"] }],
        output: {
            bands: 4,
            sampleType: "AUTO"
        }
    };
}
function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];
    return [s.B08 * 2.5, s.B04 * 2.5, s.B03 * 2.5, 1];
}`
                    : type === "water"
                        ? `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B03", "B08", "dataMask"] }],
        output: {
            bands: 4,
            sampleType: "AUTO"
        }
    };
}
function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];

    const denominator = s.B03 + s.B08;
    if (denominator === 0) return [0, 0, 0, 0];

    const ndwi = (s.B03 - s.B08) / denominator;

    if (ndwi > 0.15) {
        return [0.05, 0.35, 1, 1];
    }

    return [0, 0, 0, 0];
}`
                        : `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B11", "B08", "dataMask"] }],
        output: {
            bands: 4,
            sampleType: "AUTO"
        }
    };
}
function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];

    const denominator = s.B11 + s.B08;
    if (denominator === 0) return [0, 0, 0, 0];

    const ndbi = (s.B11 - s.B08) / denominator;

    // Highlight pixels with a positive NDBI above the screening threshold.
    if (ndbi > 0.1) {
        return [1, 0.45, 0.05, 1];
    }

    return [0, 0, 0, 0];
}`;


        const response = await fetch(
            "https://sh.dataspace.copernicus.eu/api/v1/process",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    Accept: "image/png",
                },
                body: JSON.stringify({
                    input: {
                        bounds: { bbox: coordinates },
                        data: [{
                            type: "sentinel-2-l2a",
                            dataFilter: {
                                timeRange: {
                                    from: `${from}T00:00:00Z`,
                                    to: `${to}T23:59:59Z`,
                                },
                                mosaickingOrder: "leastCC",
                                maxCloudCoverage: 30,
                            },
                        }],
                    },
                    output: {
                        width: imageWidth,
                        height: imageHeight,
                        responses: [{
                            identifier: "default",
                            format: { type: "image/png" },
                        }],
                    },
                    evalscript,
                }),
            }
        );

        if (!response.ok) {
            const details = await response.text();
            console.error(
                "Satellite visualization failed:",
                response.status,
                details.slice(0, 1000)
            );

            return res.status(502).json({
                success: false,
                message: "Could not generate satellite visualization.",
                upstreamStatus: response.status,
            });
        }

        const image = Buffer.from(await response.arrayBuffer());

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");

        return res.send(image);
    } catch (error) {
        console.error("Visualization endpoint failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to generate satellite visualization.",
        });
    }
});


app.get("/api/sentinel/compare", async (req, res) => {
    try {
        const {
            bbox,
            before,
            after,
            width = 512,
            height = 512,
            type = "true-color"
        } = req.query;

        if (!["true-color", "ndvi", "water", "urban"].includes(type)) {
            return res.status(400).json({ success: false, message: "Invalid analysis type." });
        }
        if (!bbox || !before || !after) {
            return res.status(400).json({
                success: false,
                message: "Please provide bbox, before, and after dates.",
            });
        }

        const isValidDate = (value) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

            const date = new Date(`${value}T00:00:00Z`);

            return (
                !Number.isNaN(date.getTime()) &&
                date.toISOString().slice(0, 10) === value
            );
        };

        if (
            !isValidDate(before) ||
            !isValidDate(after) ||
            before >= after
        ) {
            return res.status(400).json({
                success: false,
                message: "Choose two different valid dates, with the earlier date first.",
            });
        }

        const coordinates = bbox.split(",").map(Number);
        const imageWidth = Number(width);
        const imageHeight = Number(height);

        if (
            coordinates.length !== 4 ||
            coordinates.some((n) => !Number.isFinite(n)) ||
            coordinates[0] < -180 ||
            coordinates[2] > 180 ||
            coordinates[1] < -90 ||
            coordinates[3] > 90 ||
            coordinates[0] >= coordinates[2] ||
            coordinates[1] >= coordinates[3]
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid bounding box.",
            });
        }

        if (
            !Number.isInteger(imageWidth) ||
            !Number.isInteger(imageHeight) ||
            imageWidth < 1 || imageWidth > 2500 ||
            imageHeight < 1 || imageHeight > 2500
        ) {
            return res.status(400).json({
                success: false,
                message: "Image dimensions must be between 1 and 2500.",
            });
        }

        const token = await getSentinelHubToken();

        const bodies = {
            "true-color": `return [base[0], base[1], base[2], 1];`,
            ndvi: `
        const d = s.B08 + s.B04;
        const v = d === 0 ? 0 : (s.B08 - s.B04) / d;
        if (v < 0) return [0.45, 0.25, 0.15, 1];
        if (v < 0.2) return [0.8, 0.7, 0.3, 1];
        if (v < 0.4) return [0.7, 0.85, 0.3, 1];
        if (v < 0.6) return [0.25, 0.7, 0.25, 1];
        return [0.05, 0.4, 0.1, 1];`,
            water: `
        const d = s.B03 + s.B08;
        const v = d === 0 ? 0 : (s.B03 - s.B08) / d;
        if (v > 0.15) return [0.05, 0.35, 1, 1];
        return [base[0] * 0.6, base[1] * 0.6, base[2] * 0.6, 1];`,
            urban: `
        const d = s.B11 + s.B08;
        const v = d === 0 ? 0 : (s.B11 - s.B08) / d;
        if (v > 0.1) return [1, 0.45, 0.05, 1];
        return [base[0] * 0.6, base[1] * 0.6, base[2] * 0.6, 1];`,
        };

        const evalscript = `//VERSION=3
function setup() {
    return {
        input: [{ bands: ["B02", "B03", "B04", "B08", "B11", "SCL", "dataMask"] }],
        output: { bands: 4, sampleType: "AUTO" }
    };
}
function evaluatePixel(s) {
    if (s.dataMask === 0) return [0, 0, 0, 0];
    ${type === "true-color" ? "" : "if (s.SCL === 3 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10 || s.SCL === 11) return [0, 0, 0, 0];"}
    const base = [s.B04 * 2.5, s.B03 * 2.5, s.B02 * 2.5];
    ${bodies[type]}
}`;

        console.log("COMPARE ROUTE v2 loaded");

        const MIN_REAL_PNG_BYTES = 5000;

        function windowFor(date, days) {
            const center = new Date(`${date}T00:00:00Z`).getTime();
            const start = new Date(center - days * 86400000);
            let end = new Date(center + days * 86400000);
            const now = new Date();
            if (end > now) end = now;
            return { from: start.toISOString(), to: end.toISOString() };
        }

        async function requestImage(from, to, maxCloud) {
            const response = await fetch(
                "https://sh.dataspace.copernicus.eu/api/v1/process",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        Accept: "image/png",
                    },
                    body: JSON.stringify({
                        input: {
                            bounds: { bbox: coordinates },
                            data: [{
                                type: "sentinel-2-l2a",
                                dataFilter: {
                                    timeRange: { from, to },
                                    mosaickingOrder: "leastCC",
                                    maxCloudCoverage: maxCloud,
                                },
                            }],
                        },
                        output: {
                            width: imageWidth,
                            height: imageHeight,
                            responses: [{ identifier: "default", format: { type: "image/png" } }],
                        },
                        evalscript,
                    }),
                }
            );

            if (!response.ok) {
                const details = await response.text();
                console.error("Comparison request failed:", response.status, details.slice(0, 1000));
                throw new Error(`Sentinel Hub request failed (HTTP ${response.status}).`);
            }

            return Buffer.from(await response.arrayBuffer());
        }

        async function fetchImage(date) {
            const attempts = [
                { days: 10, cloud: 40 },
                { days: 20, cloud: 70 },
                { days: 30, cloud: 100 },
            ];

            for (const { days, cloud } of attempts) {
                const { from, to } = windowFor(date, days);
                const buffer = await requestImage(from, to, cloud);

                console.log(`Compare ${date}: ±${days}d, cloud<=${cloud} -> ${buffer.length} bytes`);

                if (buffer.length >= MIN_REAL_PNG_BYTES) {
                    return buffer.toString("base64");
                }
            }

            throw new Error(
                `No Sentinel-2 imagery found near ${date} for this area. Try another area or date.`
            );
        }

        const [beforeImage, afterImage] = await Promise.all([
            fetchImage(before),
            fetchImage(after),
        ]);

        return res.json({
            success: true,
            before,
            after,
            beforeImage,
            afterImage,
            type
        });

    } catch (error) {
        console.error("Satellite comparison failed:", error.message);

        return res.status(502).json({
            success: false,
            message: error.message || "Could not generate satellite comparison.",
        });
    }
});

app.get("/api/sentinel/stats", async (req, res) => {
    try {
        const { bbox, from, to, interval = 10 } = req.query;
        const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
        const c = (bbox || "").split(",").map(Number);

        if (c.length !== 4 || c.some((n) => !Number.isFinite(n)) || c[0] >= c[2] || c[1] >= c[3] ||
            c[0] < -180 || c[2] > 180 || c[1] < -90 || c[3] > 90 || !ok(from) || !ok(to) || from > to) {
            return res.status(400).json({ success: false, message: "Provide a valid bbox, from and to." });
        }
        const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
        if (days > 1100) {
            return res.status(400).json({ success: false, message: "Maximum period is about 3 years." });
        }
        const step = Math.max(1, Math.min(60, Math.round(Number(interval)) || 10));
        const token = await getSentinelHubToken();


        const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"]
    }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndbi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: ["ndvi", "ndwi", "ndbi"] }
    ]
  };
}

function nd(a, b) {
  var denominator = a + b;
  return denominator === 0 ? 0 : (a - b) / denominator;
}

function evaluatePixel(s) {
  var clear =
    s.dataMask === 1 &&
    (s.SCL === 4 || s.SCL === 5 || s.SCL === 6 || s.SCL === 7);

  var mask = clear ? 1 : 0;

  return {
    ndvi: [nd(s.B08, s.B04)],
    ndwi: [nd(s.B03, s.B08)],
    ndbi: [nd(s.B11, s.B08)],
    dataMask: [mask, mask, mask]
  };
}`;

        const response = await fetch("https://sh.dataspace.copernicus.eu/api/v1/statistics", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                input: {
                    bounds: { bbox: c, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } },
                    data: [{ type: "sentinel-2-l2a", dataFilter: { mosaickingOrder: "leastCC", maxCloudCoverage: 80 } }],
                },
                aggregation: {
                    timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
                    aggregationInterval: { of: `P${step}D` },
                    lastIntervalBehavior: "SHORTEN",
                    evalscript,
                    resx: (c[2] - c[0]) / 400,
                    resy: (c[3] - c[1]) / 400,
                },

                calculations: {
                    ndvi: {
                        histograms: {
                            default: {
                                nBins: 40,
                                lowEdge: -1.0,
                                highEdge: 1.0
                            }
                        },
                        statistics: {
                            default: {
                                percentiles: {
                                    k: [10, 25, 50, 75, 90]
                                }
                            }
                        }
                    },
                    ndwi: {
                        histograms: {
                            default: {
                                nBins: 40,
                                lowEdge: -1.0,
                                highEdge: 1.0
                            }
                        },
                        statistics: {
                            default: {
                                percentiles: {
                                    k: [10, 25, 50, 75, 90]
                                }
                            }
                        }
                    },
                    ndbi: {
                        histograms: {
                            default: {
                                nBins: 40,
                                lowEdge: -1.0,
                                highEdge: 1.0
                            }
                        },
                        statistics: {
                            default: {
                                percentiles: {
                                    k: [10, 25, 50, 75, 90]
                                }
                            }
                        }
                    }
                },

            }),
        });

        if (!response.ok) {
            const details = await response.text();
            console.error("Statistics request failed:", response.status, details.slice(0, 1500));
            return res.status(502).json({ success: false, message: `Sentinel Hub statistics failed (HTTP ${response.status}).` });
        }

        const json = await response.json();
        const num = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null);

        const series = (json.data || []).map((row) => {
            const out = { from: row.interval.from.slice(0, 10), to: row.interval.to.slice(0, 10) };
            for (const id of ["ndvi", "ndwi", "ndbi"]) {
                const b = row.outputs?.[id]?.bands?.B0;
                const st = b?.stats;
                if (!st || !(st.sampleCount > st.noDataCount) || num(st.mean) === null) { out[id] = null; continue; }
                const p = {};
                for (const k of [10, 25, 50, 75, 90]) {
                    p[k] = num(st.percentiles?.[`${k}.0`] ?? st.percentiles?.[String(k)]);
                }
                out[id] = {
                    n: st.sampleCount - st.noDataCount,
                    total: st.sampleCount,
                    mean: num(st.mean), sd: num(st.stDev), min: num(st.min), max: num(st.max), p,
                    hist: (b.histogram?.bins || []).map((x) => x.count),
                    under: b.histogram?.underflowCount ?? 0,
                    over: b.histogram?.overflowCount ?? 0,
                };
            }
            return out;
        });

        return res.json({ success: true, intervalDays: step, series });
    } catch (error) {
        console.error("Statistics endpoint failed:", error.message);
        return res.status(500).json({ success: false, message: "Failed to compute statistics." });
    }
});

app.get("/api/firms/fires", async (req, res) => {
    try {
        const { bbox, from, to } = req.query;
        const mapKey = process.env.FIRMS_MAP_KEY;

        if (!mapKey) {
            return res.status(500).json({
                success: false,
                message: "NASA FIRMS API key is missing.",
            });
        }

        if (!bbox || !from || !to) {
            return res.status(400).json({
                success: false,
                message: "Please provide bbox, from, and to.",
            });
        }

        const coordinates = bbox.split(",").map(Number);

        if (
            coordinates.length !== 4 ||
            coordinates.some((n) => !Number.isFinite(n)) ||
            coordinates[0] < -180 ||
            coordinates[2] > 180 ||
            coordinates[1] < -90 ||
            coordinates[3] > 90 ||
            coordinates[0] >= coordinates[2] ||
            coordinates[1] >= coordinates[3]
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid bounding box.",
            });
        }

        const isValidDate = (value) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

            const date = new Date(`${value}T00:00:00Z`);

            return (
                !Number.isNaN(date.getTime()) &&
                date.toISOString().slice(0, 10) === value
            );
        };

        if (!isValidDate(from) || !isValidDate(to) || from > to) {
            return res.status(400).json({
                success: false,
                message: "Please provide valid dates in YYYY-MM-DD format.",
            });
        }

        const startDate = new Date(`${from}T00:00:00Z`);
        const endDate = new Date(`${to}T00:00:00Z`);

        const totalDays =
            Math.floor((endDate - startDate) / 86400000) + 1;

        if (totalDays > 90) {
            return res.status(400).json({
                success: false,
                message: "Fire detection currently supports a maximum of 90 days.",
            });
        }
        const ageDays = (Date.now() - endDate.getTime()) / 86400000;
        const source = ageDays > 60 ? "VIIRS_SNPP_SP" : "VIIRS_SNPP_NRT";
        const area = coordinates.join(",");
        const allFeatures = [];
        for (let offset = 0; offset < totalDays; offset += 5) {
            const chunkStart = new Date(
                startDate.getTime() + offset * 86400000
            );

            const chunkDays = Math.min(5, totalDays - offset);

            const chunkDate = chunkStart.toISOString().slice(0, 10);

            const url =
                `https://firms.modaps.eosdis.nasa.gov/api/area/csv/` +
                `${encodeURIComponent(mapKey)}/VIIRS_SNPP_NRT/` +
                `${area}/${chunkDays}/${chunkDate}`;

            const response = await fetch(url);

            if (!response.ok) {
                const details = await response.text();

                console.error(
                    `NASA FIRMS failed for ${chunkDate}:`,
                    response.status,
                    details.slice(0, 500)
                );

                return res.status(502).json({
                    success: false,
                    message: `NASA FIRMS failed while fetching data starting ${chunkDate}.`,
                    upstreamStatus: response.status,
                });
            }

            const csv = await response.text();
            const lines = csv.trim().split(/\r?\n/);

            if (lines.length < 2) continue;

            const headers = lines[0].split(",").map((h) => h.trim());

            for (const line of lines.slice(1)) {
                if (!line.trim()) continue;

                const values = line.split(",");

                const record = Object.fromEntries(
                    headers.map((header, index) => [
                        header,
                        values[index]?.trim() ?? "",
                    ])
                );

                const latitude = Number(record.latitude);
                const longitude = Number(record.longitude);

                if (
                    !Number.isFinite(latitude) ||
                    !Number.isFinite(longitude)
                ) {
                    continue;
                }

                allFeatures.push({
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude],
                    },
                    properties: {
                        brightness: Number(record.bright_ti4),
                        brightnessTemperature: Number(record.bright_ti4),
                        confidence: record.confidence,
                        acquisitionDate: record.acq_date,
                        acquisitionTime: record.acq_time,
                        satellite: record.satellite,
                        instrument: record.instrument,
                        fireRadiativePower: Number(record.frp),
                        dayNight: record.daynight,
                    },
                });
            }
        }

        return res.json({
            success: true,
            count: allFeatures.length,
            requestedDays: totalDays,
            chunksFetched: Math.ceil(totalDays / 5),
            features: allFeatures,
            source
        });

    } catch (error) {
        console.error("NASA FIRMS endpoint failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to retrieve fire hotspot data.",
        });
    }
});



export default app;
