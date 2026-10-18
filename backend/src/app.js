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

        if (!["true-color", "false-color", "water"].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "type must be true-color, false-color, or water.",
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

        // True color: red, green, blue.
        // False color: near-infrared, red, green.

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
                    : `//VERSION=3
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


export default app;
