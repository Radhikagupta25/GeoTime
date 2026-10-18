import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  Globe2,
  Search,
  Clock3,
  GitCompareArrows,
  Layers3,
  ChartNoAxesCombined,
  FileDown,
  X,
  RotateCcw,
  Crosshair,
  Satellite,
  ChevronDown,
  MapPin,
  CalendarDays,
  PanelRight,
} from "lucide-react";
const INITIAL_CENTER = [77.4538, 28.6692];
function getNasaTileUrl(date) {
  return (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
    "MODIS_Terra_CorrectedReflectance_TrueColor/default/" +
    `${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
  );
}

const TOOL_ITEMS = [
  { id: "dates", label: "Timeline", icon: Clock3 },
  { id: "compare", label: "Compare", icon: GitCompareArrows },
  { id: "layers", label: "Layers", icon: Layers3 },
  { id: "analyze", label: "Analyze", icon: ChartNoAxesCombined },
];

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const [query, setQuery] = useState("");
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const defaultStartDate = thirtyDaysAgo.toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(today);
  const [activePanel, setActivePanel] = useState("");
  const [notice, setNotice] = useState("");
  const [searching, setSearching] = useState(false);
  const [locationName, setLocationName] = useState("Earth");
  const [globeMode, setGlobeMode] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ndviLoading, setNdviLoading] = useState(false);
  const [ndviActive, setNdviActive] = useState(false);
  const ndviObjectUrlRef = useRef(null);
  const ndviRefreshRef = useRef(null);
  const ndviRequestIdRef = useRef(0);
  const [visualizationType, setVisualizationType] = useState("");
  const [visualizationLoading, setVisualizationLoading] = useState(false);
  const visualizationObjectUrlRef = useRef(null);
  const visualizationRequestIdRef = useRef(0);

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

    if (!token || !mapContainerRef.current) {
      console.error(
        "Mapbox token or container is missing. Check frontend/.env.local."
      );
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: INITIAL_CENTER,
      zoom: 1.5,
      projection: "globe",
      pitch: 0,
      attributionControl: false,
    });

    mapRef.current = map;

    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      "bottom-right"
    );

    map.addControl(
      new mapboxgl.ScaleControl({ maxWidth: 100, unit: "metric" }),
      "bottom-left"
    );

    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    map.on("style.load", () => {
      map.setFog({
        color: "rgb(8, 13, 25)",
        "high-color": "rgb(15, 35, 70)",
        "space-color": "rgb(2, 4, 12)",
        "star-intensity": 0.7,
      });

      if (!map.getSource("nasa-gibs")) {
        map.addSource("nasa-gibs", {
          type: "raster",
          tiles: [getNasaTileUrl("2024-01-01")],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 9,
          attribution:
            'Imagery: NASA Global Imagery Browse Services (GIBS)',
        });

        map.addLayer({
          id: "nasa-gibs-layer",
          type: "raster",
          source: "nasa-gibs",
          paint: {
            "raster-opacity": 0,
          },
        });
      }
    });

    map.on("error", (event) => {
      console.error("Mapbox error:", event.error);
    });



    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  async function searchLocation(event) {
    event.preventDefault();

    const searchTerm = query.trim();
    const map = mapRef.current;
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

    if (!searchTerm || !map || !token) return;

    setSearching(true);
    setNotice("");

    try {
      const url = new URL(
        "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
        encodeURIComponent(searchTerm) +
        ".json"
      );

      url.searchParams.set("access_token", token);
      url.searchParams.set("limit", "1");

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Location search failed (${response.status})`);
      }

      const data = await response.json();
      const result = data.features?.[0];

      if (!result) {
        setNotice("Location not found. Try another place name.");
        return;
      }

      const [longitude, latitude] = result.center;

      map.flyTo({
        center: [longitude, latitude],
        zoom: 12,
        pitch: 0,
        duration: 2200,
        essential: true,
      });

      setLocationName(result.place_name);
      setNotice(`Exploring ${result.place_name}`);
      setQuery("");
    } catch (error) {
      console.error(error);
      setNotice("Location search failed. Check your connection and token.");
    } finally {
      setSearching(false);
    }
  }

  function goHome() {
    mapRef.current?.flyTo({
      center: INITIAL_CENTER,
      zoom: 1.5,
      pitch: 0,
      bearing: 0,
      duration: 1800,
    });

    setLocationName("Earth");
    setNotice("Returned to the global view.");
  }

  function toggleGlobe() {
    const nextMode = !globeMode;

    mapRef.current?.setProjection(nextMode ? "globe" : "mercator");
    setGlobeMode(nextMode);
    setNotice(nextMode ? "Globe projection enabled." : "Flat map enabled.");
  }

  function applyDates() {
    if (!startDate || !endDate || startDate > endDate) {
      setNotice("Please select a valid observation date range.");
      return;
    }

    const nasaSource = mapRef.current?.getSource("nasa-gibs");

    if (!nasaSource) {
      setNotice("NASA imagery layer is not ready yet.");
      return;
    }
    nasaSource.setTiles([getNasaTileUrl(endDate)]);

    setActivePanel("");
    setNotice(
      `Selected period: ${startDate} to ${endDate}. Historical imagery integration is next.`
    );
  }

  function openTool(tool) {
    setActivePanel((current) => (current === tool ? "" : tool));
    setMobileMenuOpen(false);
    setNotice("");
  }

  function generateReport() {
    setActivePanel("");
    setNotice(
      "PDF export will be enabled after satellite analysis and report generation are implemented."
    );
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setNotice("Geolocation is not supported by this browser.");
      return;
    }

    setNotice("Requesting your location...");

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        mapRef.current?.flyTo({
          center: [coords.longitude, coords.latitude],
          zoom: 13,
          duration: 1800,
        });

        setLocationName("Your location");
        setNotice("Moved to your current location.");
      },
      (error) => {
        setNotice(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Unable to determine your location."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function runNdviAnalysis(silent = false) {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      if (!silent) {
        setNotice("Map is still loading. Please try again shortly.");
      }
      return;
    }

    if (map.getZoom() < 7) {
      if (!silent) {
        setNotice("Search for a location and zoom in before running NDVI.");
      }
      return;
    }

    if (!startDate || !endDate || startDate > endDate) {
      if (!silent) {
        setNotice("Please select a valid observation date range.");
      }
      return;
    }

    const bounds = map.getBounds();

    const minLon = Math.max(-180, bounds.getWest());
    const minLat = Math.max(-80, bounds.getSouth());
    const maxLon = Math.min(180, bounds.getEast());
    const maxLat = Math.min(84, bounds.getNorth());

    if (minLon >= maxLon || minLat >= maxLat) {
      if (!silent) {
        setNotice("The current map view has invalid analysis bounds.");
      }
      return;
    }
    const requestId = ++ndviRequestIdRef.current;

    setNdviLoading(true);

    if (!silent) {
      setNotice("Requesting Sentinel-2 vegetation imagery...");
    }

    let imageUrl = null;

    try {
      const params = new URLSearchParams({
        bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
        from: startDate,
        to: endDate,
        width: "512",
        height: "512",
      });

      const response = await fetch(
        `/api/sentinel/ndvi?${params}`
      );

      const contentType = response.headers.get("content-type") || "";

      if (!response.ok || !contentType.includes("image/png")) {
        const body = await response.text();

        console.error("NDVI response diagnostics:", {
          status: response.status,
          contentType,
          body: body.slice(0, 1000),
        });

        throw new Error(
          `NDVI request failed: HTTP ${response.status}, ${contentType || "unknown content type"
          }.`
        );
      }

      const imageBlob = await response.blob();

      if (requestId !== ndviRequestIdRef.current) {
        return;
      }

      imageUrl = URL.createObjectURL(imageBlob);

      const imageCoordinates = [
        [minLon, maxLat],
        [maxLon, maxLat],
        [maxLon, minLat],
        [minLon, minLat],
      ];

      const existingSource = map.getSource("ndvi-source");

      if (existingSource) {
        // Keep the current layer visible and update its image only
        // after the new request has returned successfully.
        existingSource.updateImage({
          url: imageUrl,
          coordinates: imageCoordinates,
        });
      } else {
        map.addSource("ndvi-source", {
          type: "image",
          url: imageUrl,
          coordinates: imageCoordinates,
        });

        map.addLayer({
          id: "ndvi-layer",
          type: "raster",
          source: "ndvi-source",
          paint: {
            "raster-opacity": 1,
            "raster-fade-duration": 0,
          },
        });
      }

      const previousImageUrl = ndviObjectUrlRef.current;
      ndviObjectUrlRef.current = imageUrl;
      imageUrl = null;
      if (previousImageUrl) {
        URL.revokeObjectURL(previousImageUrl);
      }
      map.addSource("ndvi-source", {
        type: "image",
        url: imageUrl,
        coordinates: [
          [minLon, maxLat], // top-left
          [maxLon, maxLat], // top-right
          [maxLon, minLat], // bottom-right
          [minLon, minLat], // bottom-left
        ],
      });

      map.addLayer({
        id: "ndvi-layer",
        type: "raster",
        source: "ndvi-source",
        paint: {
          "raster-opacity": 1,
          "raster-fade-duration": 0,
        },
      });

      ndviObjectUrlRef.current = imageUrl;
      imageUrl = null;

      setNdviActive(true);

      if (!silent) {
        setNotice("NDVI vegetation visualization is displayed.");
      }
    } catch (error) {
      if (requestId !== ndviRequestIdRef.current) {
        return;
      }

      console.error("NDVI analysis failed:", error);

      if (!silent) {
        setNotice(error.message || "Could not load NDVI imagery.");
      }
    } finally {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }

      if (requestId === ndviRequestIdRef.current) {
        setNdviLoading(false);
      }
    }
  }


  useEffect(() => {
    const map = mapRef.current;

    if (!map || !ndviActive) return;

    let timeoutId;

    const handleMoveEnd = () => {
      clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        ndviRefreshRef.current?.(true);
      }, 800);
    };

    map.on("moveend", handleMoveEnd);

    return () => {
      clearTimeout(timeoutId);
      map.off("moveend", handleMoveEnd);
    };
  }, [ndviActive]);


  function clearNdviLayer() {
    ndviRequestIdRef.current += 1;
    setNdviLoading(false);
    const map = mapRef.current;

    if (map?.getLayer("ndvi-layer")) {
      map.removeLayer("ndvi-layer");
    }

    if (map?.getSource("ndvi-source")) {
      map.removeSource("ndvi-source");
    }

    if (ndviObjectUrlRef.current) {
      URL.revokeObjectURL(ndviObjectUrlRef.current);
      ndviObjectUrlRef.current = null;
    }

    setNdviActive(false);
    setNotice("NDVI overlay turned off.");
  }
  ndviRefreshRef.current = runNdviAnalysis;

  async function runSatelliteVisualization(type) {
    const map = mapRef.current;

    if (!map || !map.isStyleLoaded()) {
      setNotice("Map is still loading. Please try again.");
      return;
    }

    if (map.getZoom() < 7) {
      setNotice("Search for a location and zoom in before loading imagery.");
      return;
    }

    if (!startDate || !endDate || startDate > endDate) {
      setNotice("Please select a valid observation date range.");
      return;
    }

    const bounds = map.getBounds();
    const minLon = Math.max(-180, bounds.getWest());
    const minLat = Math.max(-80, bounds.getSouth());
    const maxLon = Math.min(180, bounds.getEast());
    const maxLat = Math.min(84, bounds.getNorth());

    if (minLon >= maxLon || minLat >= maxLat) {
      setNotice("The current map bounds are invalid.");
      return;
    }

    const requestId = ++visualizationRequestIdRef.current;
    const visualizationName =
      type === "true-color"
        ? "True Color"
        : type === "false-color"
          ? "False Color"
          : "Water Detection";
    setVisualizationLoading(true);
    setNotice(`${visualizationName} imagery loaded.`);

    let imageUrl = null;

    try {
      const params = new URLSearchParams({
        bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
        from: startDate,
        to: endDate,
        type,
        width: "512",
        height: "512",
      });

      const response = await fetch(
        `/api/sentinel/visualization?${params}`
      );

      const contentType = response.headers.get("content-type") || "";

      if (!response.ok || !contentType.includes("image/png")) {
        const body = await response.text();
        console.error("Satellite visualization error:", response.status, body.slice(0, 1000));
        throw new Error(`Satellite imagery request failed (${response.status}).`);
      }

      const blob = await response.blob();

      if (requestId !== visualizationRequestIdRef.current) {
        return;
      }

      imageUrl = URL.createObjectURL(blob);

      // Replace the old visualization only after the new image arrives.
      if (map.getLayer("satellite-visualization-layer")) {
        map.removeLayer("satellite-visualization-layer");
      }

      if (map.getSource("satellite-visualization-source")) {
        map.removeSource("satellite-visualization-source");
      }

      // Switching visualization also turns off the NDVI overlay.
      if (map.getLayer("ndvi-layer")) {
        map.removeLayer("ndvi-layer");
      }

      if (map.getSource("ndvi-source")) {
        map.removeSource("ndvi-source");
      }

      if (ndviObjectUrlRef.current) {
        URL.revokeObjectURL(ndviObjectUrlRef.current);
        ndviObjectUrlRef.current = null;
      }

      setNdviActive(false);

      map.addSource("satellite-visualization-source", {
        type: "image",
        url: imageUrl,
        coordinates: [
          [minLon, maxLat],
          [maxLon, maxLat],
          [maxLon, minLat],
          [minLon, minLat],
        ],
      });

      map.addLayer({
        id: "satellite-visualization-layer",
        type: "raster",
        source: "satellite-visualization-source",
        paint: {
          "raster-opacity": 1,
          "raster-fade-duration": 0,
        },
      });

      const previousUrl = visualizationObjectUrlRef.current;
      visualizationObjectUrlRef.current = imageUrl;
      imageUrl = null;

      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }

      setVisualizationType(type);
      setNotice(
        `${type === "true-color" ? "True Color" : "False Color"} imagery loaded.`
      );
    } catch (error) {
      if (requestId === visualizationRequestIdRef.current) {
        console.error(error);
        setNotice(error.message || "Could not load satellite imagery.");
      }
    } finally {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }

      if (requestId === visualizationRequestIdRef.current) {
        setVisualizationLoading(false);
      }
    }
  }

  function clearSatelliteVisualization() {
    visualizationRequestIdRef.current += 1;
    setVisualizationLoading(false);

    const map = mapRef.current;

    if (map?.getLayer("satellite-visualization-layer")) {
      map.removeLayer("satellite-visualization-layer");
    }

    if (map?.getSource("satellite-visualization-source")) {
      map.removeSource("satellite-visualization-source");
    }

    if (visualizationObjectUrlRef.current) {
      URL.revokeObjectURL(visualizationObjectUrlRef.current);
      visualizationObjectUrlRef.current = null;
    }

    setVisualizationType("");
    setNotice("Satellite visualization turned off.");
  }

  const activeTool = TOOL_ITEMS.find((tool) => tool.id === activePanel);
  const ActiveIcon = activeTool?.icon;

  return (
    <main className="fixed inset-0 isolate overflow-hidden bg-[#02040a] text-white">
      <div
        ref={mapContainerRef}
        className="absolute inset-0 h-full w-full"
        aria-label="Interactive three-dimensional Earth map"
      />
      <header className="absolute left-2 right-2 top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0b1018]/90 p-2.5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:left-4 sm:right-4 sm:top-3 sm:gap-3 sm:p-3 lg:left-5 lg:right-5 lg:flex-nowrap lg:gap-4">
        <button
          type="button"
          onClick={goHome}
          title="Return to Earth"
          className="flex shrink-0 items-center gap-2 rounded-xl p-1 transition hover:bg-white/5"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-linear-to-br from-sky-300 via-blue-500 to-indigo-800 shadow-lg shadow-blue-500/20 sm:h-10 sm:w-10">
            <Globe2 size={23} strokeWidth={1.6} />
          </span>

          <span className="block text-left">
            <span className="block text-base font-semibold tracking-tight">
              Geo<span className="text-emerald-400">Time</span>
            </span>
            <span className="hidden text-[9px] uppercase tracking-[0.18em] text-slate-500 sm:block">
              Travel In Time
            </span>
          </span>
        </button>
        <form
          onSubmit={searchLocation}
          className="order-3 flex min-w-0 basis-full items-center gap-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2.5 transition focus-within:border-emerald-400/50 sm:order-0 sm:min-w-42.5 sm:flex-1 sm:basis-auto sm:rounded-full sm:px-4"
        >
          <Search size={18} className="shrink-0 text-slate-400" />

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search any place on Earth"
            aria-label="Search locations"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />

          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="shrink-0 text-xs font-semibold text-emerald-300 transition hover:text-emerald-200 disabled:opacity-40"
          >
            {searching ? "..." : "Go"}
          </button>
        </form>
        <nav className="hidden shrink-0 items-center gap-1 xl:flex">
          {TOOL_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTool(id)}
              title={label}
              aria-pressed={activePanel === id}
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition ${activePanel === id
                ? "bg-emerald-400/15 text-emerald-300"
                : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 xl:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle map tools"
            aria-expanded={mobileMenuOpen}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-200 hover:bg-white/10"
          >
            <PanelRight size={19} />
          </button>
        </div>

        <button
          type="button"
          onClick={generateReport}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-2.5 text-sm font-semibold text-[#06110c] transition hover:bg-emerald-300 sm:px-4"
          title="Generate report"
        >
          <FileDown size={17} />
          <span className="hidden sm:inline">Report</span>
        </button>
      </header>
      {mobileMenuOpen && (
        <nav className="absolute right-3 top-31.25 z-30 grid w-56 gap-1 rounded-2xl border border-white/10 bg-[#10151e]/95 p-2 shadow-2xl backdrop-blur-xl sm:top-19.5 sm:right-4 xl:hidden">
          {TOOL_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTool(id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${activePanel === id
                ? "bg-emerald-400/10 text-emerald-300"
                : "text-slate-200 hover:bg-white/5"
                }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      )}
      {activePanel && (
        <section className="absolute right-3 top-34.5 z-10 max-h-[calc(100dvh-180px)] w-[min(350px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-white/10 bg-[#10151e]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:right-4 sm:top-24 sm:p-5 lg:right-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {ActiveIcon && (
                <ActiveIcon size={18} className="text-emerald-300" />
              )}
              <h2 className="text-sm font-semibold">
                {{
                  dates: "Observation timeline",
                  compare: "Compare Earth over time",
                  layers: "Map layers",
                  analyze: "Change analysis",
                }[activePanel]}
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setActivePanel("")}
              aria-label="Close panel"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X size={17} />
            </button>
          </div>

          {activePanel === "dates" && (
            <div className="space-y-4">
              <p className="text-xs leading-5 text-slate-400">
                Select the period to investigate. Real historical imagery will
                be connected in the next development step.
              </p>

              <label className="block space-y-2">
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  <CalendarDays size={14} />
                  Start date
                </span>
                <input
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#090e16] p-3 text-sm text-white outline-none focus:border-emerald-400/50"
                />
              </label>

              <label className="block space-y-2">
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  <CalendarDays size={14} />
                  End date
                </span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#090e16] p-3 text-sm text-white outline-none focus:border-emerald-400/50"
                />
              </label>

              <button
                type="button"
                onClick={applyDates}
                className="w-full rounded-xl bg-emerald-400 py-3 text-sm font-semibold text-[#06110c] hover:bg-emerald-300"
              >
                Apply observation period
              </button>
            </div>
          )}

          {activePanel === "compare" && (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-slate-400">
                Compare observations of the same area using side-by-side maps
                or a swipe slider.
              </p>

              <div className="rounded-xl border border-white/10 bg-white/3 p-3">
                <p className="text-xs text-slate-400">Earlier observation</p>
                <p className="mt-1 text-sm">{startDate}</p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/3 p-3">
                <p className="text-xs text-slate-400">Later observation</p>
                <p className="mt-1 text-sm">{endDate}</p>
              </div>

              <p className="text-xs leading-5 text-amber-200/80">
                Comparison is a planned feature. It requires historical imagery
                layers to be integrated first.
              </p>
            </div>
          )}

          {activePanel === "layers" && (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-slate-400">
                Change the map projection and explore additional imagery
                layers as they become available.
              </p>

              <button
                type="button"
                onClick={toggleGlobe}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/4 p-3 text-sm hover:bg-white/8"
              >
                <span className="flex items-center gap-2">
                  <Globe2 size={17} />
                  {globeMode ? "3D globe" : "Flat map"}
                </span>
                <span className="text-emerald-300">
                  {globeMode ? "Globe" : "Flat"}
                </span>
              </button>

              <div className="rounded-xl border border-white/10 bg-white/3 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Satellite size={17} className="text-emerald-300" />
                  Satellite basemap
                </div>

                <div className="rounded-xl border border-white/10 bg-white/3 p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <Satellite size={17} className="text-emerald-300" />
                    <p className="text-sm font-medium">Satellite visualizations</p>
                  </div>

                  <p className="mb-3 text-xs leading-5 text-slate-400">
                    Generate imagery for the current map area and selected dates.
                  </p>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => runSatelliteVisualization("true-color")}
                      disabled={visualizationLoading}
                      className={`w-full rounded-xl border p-3 text-left text-sm transition disabled:opacity-60 ${visualizationType === "true-color"
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                        : "border-white/10 bg-white/3 text-slate-200 hover:bg-white/8"
                        }`}
                    >
                      <span className="block font-medium">True Color</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        Natural-looking satellite imagery
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => runSatelliteVisualization("false-color")}
                      disabled={visualizationLoading}
                      className={`w-full rounded-xl border p-3 text-left text-sm transition disabled:opacity-60 ${visualizationType === "false-color"
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                        : "border-white/10 bg-white/3 text-slate-200 hover:bg-white/8"
                        }`}
                    >
                      <span className="block font-medium">False Color Infrared</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        Highlights vegetation in red tones
                      </span>
                    </button>

                    {visualizationLoading && (
                      <p className="text-xs text-emerald-300">
                        Processing satellite imagery...
                      </p>
                    )}

                    {visualizationType && !visualizationLoading && (
                      <button
                        type="button"
                        onClick={clearSatelliteVisualization}
                        className="w-full rounded-xl border border-white/10 py-2.5 text-xs text-slate-300 hover:bg-white/5"
                      >
                        Turn off satellite visualization
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Current Mapbox map style.
                </p>
              </div>

              <p className="text-xs text-slate-500">
                NASA imagery and fire overlays will be added as separate data
                layers.
              </p>
            </div>
          )}

          {activePanel === "analyze" && (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-slate-400">
                Analyze satellite imagery for vegetation health using
                Sentinel-2 red and near-infrared bands.
              </p>

              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
                <div className="flex items-center gap-2">
                  <Satellite size={18} className="text-emerald-300" />
                  <p className="text-sm font-medium">Forest cover</p>
                </div>

                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Generate an NDVI visualization for the current map area
                  and selected observation dates.
                </p>

                <div className="mt-3 rounded-lg bg-black/20 p-3">
                  <p className="text-xs text-slate-300">NDVI color guide</p>

                  <div className="mt-2 space-y-2 text-xs text-slate-400">
                    {[
                      ["#73402B", "Below 0 — water, bare surfaces, or other non-vegetated pixels"],
                      ["#CCB34D", "0–0.2 — low vegetation index"],
                      ["#B3D94D", "0.2–0.4 — moderate-low index"],
                      ["#40B340", "0.4–0.6 — moderate-high index"],
                      ["#0D6626", "Above 0.6 — high vegetation index"],
                    ].map(([color, label]) => (
                      <div key={label} className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={ndviActive ? clearNdviLayer : runNdviAnalysis}
                  disabled={ndviLoading}
                  className={`mt-4 w-full rounded-xl py-3 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${ndviActive
                    ? "border border-white/15 bg-white/10 text-white hover:bg-white/15"
                    : "bg-emerald-400 text-[#06110c] hover:bg-emerald-300"
                    }`}
                >
                  {ndviLoading
                    ? "Processing satellite imagery..."
                    : ndviActive
                      ? "Turn off NDVI overlay"
                      : "Run vegetation analysis"}
                </button>

                {ndviActive && (
                  <p className="mt-3 text-xs text-emerald-300">
                    NDVI overlay active on the map.
                  </p>
                )}
              </div>


              <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-3">
                <div className="flex items-center gap-2">
                  <Satellite size={18} className="text-sky-300" />
                  <p className="text-sm font-medium">Water Detection</p>
                </div>

                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Identify likely surface water in the current map area using
                  Sentinel-2 imagery.
                </p>

                <button
                  type="button"
                  onClick={() => runSatelliteVisualization("water")}
                  disabled={visualizationLoading}
                  className={`mt-3 w-full rounded-xl py-3 text-sm font-semibold transition disabled:opacity-60 ${visualizationType === "water"
                    ? "border border-sky-400/40 bg-sky-400/10 text-sky-300"
                    : "bg-sky-400 text-slate-950 hover:bg-sky-300"
                    }`}
                >
                  {visualizationLoading && visualizationType !== "water"
                    ? "Processing imagery..."
                    : visualizationType === "water"
                      ? "Water detection active"
                      : "Run water detection"}
                </button>
              </div>


              <div className="rounded-xl border border-white/10 bg-white/3 p-3">
                <p className="text-sm font-medium">More analysis categories</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Urban growth, water-body changes, and fire activity
                  can be integrated in later steps.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
      <aside className="pointer-events-none absolute bottom-12 left-3 z-1 max-w-[calc(100vw-24px)] rounded-xl border border-white/10 bg-[#0b1018]/85 px-3 py-3 shadow-xl backdrop-blur-lg sm:bottom-14 sm:left-5 sm:px-4">
        <p className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Current view
        </p>
        <p className="mt-1 max-w-64 truncate text-sm font-medium text-white">
          {locationName}
        </p>
        <p className="mt-1 text-[10px] text-slate-400">
          Mapbox satellite basemap
        </p>
      </aside>
      <button
        type="button"
        onClick={locateMe}
        title="Go to my location"
        aria-label="Go to my location"
        className="absolute bottom-20 right-3 z-2 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#10151e]/90 text-slate-200 shadow-xl backdrop-blur-lg transition hover:border-emerald-400/50 hover:text-emerald-300 sm:bottom-24 sm:right-5 sm:h-11 sm:w-11"
      >
        <Crosshair size={19} />
      </button>
      <footer className="absolute bottom-0 left-0 right-0 z-10 flex min-h-8 items-center justify-between gap-2 border-t border-white/10 bg-[#090d14]/90 px-3 py-2 text-[9px] text-slate-400 backdrop-blur-lg sm:px-5 sm:text-[10px]">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <MapPin size={12} className="shrink-0 text-emerald-400" />
          <span className="truncate">GEOTIME / {locationName}</span>
        </span>

        <span className="hidden shrink-0 md:inline">
          {startDate} — {endDate}
        </span>

        <button
          type="button"
          onClick={goHome}
          className="flex shrink-0 items-center gap-1.5 text-emerald-300 hover:text-emerald-200"
        >
          <RotateCcw size={12} />
          <span className="hidden xs:inline">Reset globe</span>
          <span className="xs:hidden">Reset</span>
        </button>
      </footer>
      {notice && (
        <div
          role="status"
          className="absolute bottom-14 left-1/2 z-40 w-max max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#111923]/95 px-3 py-3 text-xs text-slate-200 shadow-2xl backdrop-blur-xl sm:bottom-16 sm:px-4"
        >
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">
              <Globe2 size={15} />
            </span>
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
              className="ml-1 shrink-0 text-slate-500 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
