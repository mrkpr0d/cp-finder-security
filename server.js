const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 4173);
const publicDir = path.join(__dirname, "public");
const geonamesPath = path.join(__dirname, "data", "geonames-es", "ES.txt");
const historyLogPath = path.join(__dirname, "data", "search-history.json");
const officialCache = new Map();
const balanceIndexCache = new Map();
const historyResultCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value, maxLength = 160) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("/")
    .pop()
    .replace(/\([^)]*\)/g, "")
    .replace(/provincia de/gi, "")
    .replace(/comunidad de/gi, "")
    .replace(/ciudad autonoma de/gi, "")
    .replace(/\b(la|el|los|las|de|del)\b/gi, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function parseSemicolonCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ";" && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, "").trim()) || [];
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]))
  );
}

function parseNumber(value) {
  const clean = String(value || "").replace(/\./g, "").replace(",", ".");
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function getRowValue(row, candidates) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) return row[candidate];
  }
  const normalized = Object.fromEntries(Object.keys(row).map((key) => [normalizeKey(key), key]));
  for (const candidate of candidates) {
    const key = normalized[normalizeKey(candidate)];
    if (key) return row[key];
  }
  return "";
}

function makeQuarterLabel(year, quarter) {
  return `${year} T${quarter}`;
}

function periodToQuarter(period) {
  const normalized = normalizeKey(period);
  if (normalized.includes("enero marzo")) return 1;
  if (normalized.includes("enero junio")) return 2;
  if (normalized.includes("enero septiembre")) return 3;
  if (normalized.includes("enero diciembre")) return 4;
  return null;
}

function metricDefinitions() {
  return [
    { id: "total", label: "Total infracciones", needle: "TOTAL INFRACCIONES PENALES" },
    { id: "homeRobbery", label: "Robos domicilios", needle: "Robos con fuerza en domicilios" },
    {
      id: "forceRobbery",
      label: "Domicilios + locales",
      needle: "Robos con fuerza en domicilios, establecimientos"
    },
    { id: "violentRobbery", label: "Robos violencia", needle: "Robos con violencia" },
    { id: "thefts", label: "Hurtos", needle: "Hurtos" },
    { id: "vehicles", label: "Vehiculos", needle: "Sustracciones de veh" }
  ];
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "radar-seguridad-local/0.2"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.toString("utf8").replace(/^\uFEFF/, "");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "radar-seguridad-local/0.2"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichImages(articles) {
  const targets = articles.slice(0, 8);
  await Promise.all(
    targets.map(async (article) => {
      if (article.image || !article.url) return;
      try {
        const url = new URL("https://api.microlink.io/");
        url.searchParams.set("url", article.url);
        url.searchParams.set("meta", "false");
        url.searchParams.set("audio", "false");
        url.searchParams.set("video", "false");
        url.searchParams.set("iframe", "false");
        url.searchParams.set("screenshot", "false");
        const payload = await fetchJson(url, 3000);
        article.image = payload?.data?.image?.url || payload?.data?.logo?.url || "";
        if (article.image) article.imageSource = "Microlink OpenGraph";
      } catch {
        article.image = "";
      }
    })
  );
  return articles;
}

async function fetchOfficialCsv(cacheKey, url) {
  const cached = officialCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 1000 * 60 * 60 * 6) return cached.rows;
  const text = await fetchText(url);
  const rows = parseSemicolonCsv(text);
  officialCache.set(cacheKey, { createdAt: Date.now(), rows });
  return rows;
}

function readPostalRows(postalCode) {
  const clean = String(postalCode || "").replace(/\D/g, "").padStart(5, "0").slice(0, 5);
  if (!/^\d{5}$/.test(clean) || !fs.existsSync(geonamesPath)) return [];
  const content = fs.readFileSync(geonamesPath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter((cols) => cols[1] === clean)
    .map((cols) => {
      return {
        country: cols[0],
        postalCode: cols[1],
        place: cols[2],
        community: cols[3],
        communityCode: cols[4],
        province: cols[5],
        provinceCode: cols[6],
        municipality: cols[7] || cols[2],
        municipalityCode: cols[8],
        lat: Number(cols[9]),
        lng: Number(cols[10]),
        accuracy: cols[11],
        source: "GeoNames postal code dataset",
        sourceUrl: "https://download.geonames.org/export/zip/"
      };
    });
}

function handlePostal(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const postalCode = requestUrl.searchParams.get("postalCode");
  const rows = readPostalRows(postalCode);
  if (!rows.length) {
    sendJson(res, 404, {
      error: "Codigo postal no encontrado en GeoNames",
      postalCode
    });
    return;
  }

  const first = rows[0];
  sendJson(res, 200, {
    selected: first,
    alternatives: rows.slice(0, 12),
    count: rows.length,
    source: {
      name: "GeoNames postal code dataset",
      url: "https://download.geonames.org/export/zip/",
      localFile: "data/geonames-es/ES.txt"
    }
  });
}

async function geocodeSpain(query) {
  async function request(searchText) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", searchText);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "es");

    const response = await fetch(url, {
      headers: {
        "user-agent": "radar-seguridad-local/0.2 contacto-local"
      }
    });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    return response.json();
  }

  let results = await request(query);
  if ((!Array.isArray(results) || !results.length) && !/spain|españa/i.test(query)) {
    results = await request(`${query}, España`);
  }
  if (!Array.isArray(results) || !results.length) return null;
  const result = results[0];
  const address = result.address || {};
  const municipality =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    result.name ||
    query;
  const province = address.province || address.county || address.state || municipality;
  return {
    country: "ES",
    postalCode: address.postcode || "",
    place: result.name || municipality,
    community: address.state || "",
    province,
    municipality,
    lat: Number(result.lat),
    lng: Number(result.lon),
    accuracy: "geocoded",
    source: "OpenStreetMap Nominatim",
    sourceUrl: "https://nominatim.openstreetmap.org/"
  };
}

async function handleResolve(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const query = clampText(requestUrl.searchParams.get("q"), 180);
  if (!query) {
    sendJson(res, 400, { error: "Introduce direccion, municipio, ciudad o codigo postal" });
    return;
  }

  const postalMatch = query.match(/^\s*(\d{5})\s*$/);
  if (postalMatch) {
    const rows = readPostalRows(postalMatch[1]);
    if (!rows.length) {
      sendJson(res, 404, { error: "Codigo postal no encontrado en GeoNames", query });
      return;
    }
    sendJson(res, 200, {
      selected: rows[0],
      alternatives: rows.slice(0, 12),
      count: rows.length,
      source: {
        name: "GeoNames postal code dataset",
        url: "https://download.geonames.org/export/zip/",
        localFile: "data/geonames-es/ES.txt"
      }
    });
    return;
  }

  try {
    const selected = await geocodeSpain(query);
    if (!selected) {
      sendJson(res, 404, { error: "No se pudo geocodificar la busqueda en Espana", query });
      return;
    }
    sendJson(res, 200, {
      selected,
      alternatives: [selected],
      count: 1,
      source: {
        name: "OpenStreetMap Nominatim",
        url: "https://nominatim.openstreetmap.org/",
        query
      }
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "No se pudo resolver la direccion o municipio",
      detail: error.message
    });
  }
}

function postalSuggestions(query) {
  if (!fs.existsSync(geonamesPath)) return [];
  const clean = normalizeKey(query);
  const digits = String(query || "").replace(/\D/g, "");
  const content = fs.readFileSync(geonamesPath, "utf8");
  const seen = new Set();
  const results = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split("\t");
    const postalCode = cols[1] || "";
    const place = cols[2] || "";
    const province = cols[5] || "";
    const municipality = cols[7] || place;
    const haystack = normalizeKey(`${postalCode} ${place} ${municipality} ${province}`);
    const matches = digits.length >= 2 ? postalCode.startsWith(digits) : haystack.includes(clean);
    if (!matches) continue;
    const key = `${postalCode}|${municipality}|${province}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      label: postalCode ? `${postalCode} · ${municipality}` : municipality,
      subtitle: `${province}${place && place !== municipality ? ` · ${place}` : ""}`,
      type: postalCode ? "CP" : "Municipio",
      query: postalCode || municipality,
      postalCode,
      municipality,
      province,
      lat: Number(cols[9]),
      lng: Number(cols[10]),
      source: "GeoNames"
    });
    if (results.length >= 7) break;
  }

  return results;
}

async function handleSuggest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const query = clampText(requestUrl.searchParams.get("q"), 120);
  if (query.length < 2) {
    sendJson(res, 200, { suggestions: [] });
    return;
  }

  const suggestions = postalSuggestions(query);
  if (query.length >= 3 && suggestions.length < 8) {
    try {
      const geo = await geocodeSpain(query);
      if (geo) {
        const key = normalizeKey(`${geo.postalCode} ${geo.municipality} ${geo.province}`);
        const exists = suggestions.some((item) => normalizeKey(`${item.postalCode} ${item.municipality} ${item.province}`) === key);
        if (!exists) {
          suggestions.unshift({
            label: geo.postalCode ? `${geo.postalCode} · ${geo.municipality}` : geo.municipality,
            subtitle: `${geo.province || "España"} · ${geo.place}`,
            type: geo.postalCode ? "Direccion" : "Zona",
            query,
            postalCode: geo.postalCode,
            municipality: geo.municipality,
            province: geo.province,
            lat: geo.lat,
            lng: geo.lng,
            source: "OpenStreetMap"
          });
        }
      }
    } catch {
      // Suggestions must remain fast and non-blocking.
    }
  }

  sendJson(res, 200, { suggestions: suggestions.slice(0, 8) });
}

function pickRows(rows, dimensionName, areaName, types, periods) {
  const areaKey = normalizeKey(areaName);
  return rows.filter((row) => {
    const geo = row[dimensionName] || "";
    const geoKey = normalizeKey(geo);
    const geoWithoutCode = normalizeKey(geo.replace(/^\d{5}\s+/, ""));
    const isMunicipalDimension = dimensionName === "Geografía";
    const areaMatches = isMunicipalDimension
      ? /^\d{5}\s+/.test(geo) && geoWithoutCode === areaKey
      : geoKey === areaKey || geoKey.includes(areaKey) || areaKey.includes(geoKey);
    const type = row["Tipología penal"] || "";
    const period = row["Periodos:"] || row.periodo || "";
    return (
      areaMatches &&
      types.some((needle) => normalizeKey(type).includes(normalizeKey(needle))) &&
      (!periods || periods.some((needle) => normalizeKey(period).includes(normalizeKey(needle))))
    );
  });
}

async function discoverHistoricalBalance(year, quarter) {
  const cacheKey = `balance-index-${year}-${quarter}`;
  const cached = balanceIndexCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://estadisticasdecriminalidad.ses.mir.es/sec/dynPx/inebase/index.htm?file=pcaxis&path=%2FDatosBalanceAnt%2F${year}${quarter}%2F&type=pcaxis`;
  try {
    const html = await fetchText(url);
    const files = [...new Set([...html.matchAll(/file=([0-9]+\.px)/g)].map((match) => match[1]))];
    if (files.length < 3) return null;
    const updated = html.match(/<dd class="FechCambio">([^<]+)<\/dd>/)?.[1] || "";
    const descriptor = {
      year,
      quarter,
      label: makeQuarterLabel(year, quarter),
      kind: "historical",
      updated,
      provinceFile: files[1],
      municipalityFile: files[2],
      provinceCsv: `https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAnt/l0/${files[1].replace(".px", ".csv_bdsc")}`,
      municipalityCsv: `https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAnt/l0/${files[2].replace(".px", ".csv_bdsc")}`,
      sourceUrl: `https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatosBalanceAnt%2F${year}${quarter}%2F&title=Trimestre&type=jaxi`
    };
    balanceIndexCache.set(cacheKey, descriptor);
    return descriptor;
  } catch {
    balanceIndexCache.set(cacheKey, null);
    return null;
  }
}

async function getBalanceDescriptors() {
  const descriptors = [
    {
      year: 2026,
      quarter: 1,
      label: "2026 T1",
      kind: "current",
      updated: "04/06/2026",
      provinceFile: "09002.px",
      municipalityFile: "09003.px",
      provinceCsv:
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAct/l0/09002.csv_bdsc",
      municipalityCsv:
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAct/l0/09003.csv_bdsc",
      sourceUrl:
        "https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatosBalanceAct%2F&title=Primer+trimestre&type=jaxi"
    }
  ];

  const tasks = [];
  for (let year = 2016; year <= 2025; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      tasks.push([year, quarter]);
    }
  }

  const historical = [];
  for (let index = 0; index < tasks.length; index += 6) {
    const chunk = tasks.slice(index, index + 6);
    const found = await Promise.all(chunk.map(([year, quarter]) => discoverHistoricalBalance(year, quarter)));
    historical.push(...found.filter(Boolean));
  }

  return [...historical, ...descriptors].sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

function quarterCurrentPeriod(year, quarter) {
  const names = {
    1: "enero marzo",
    2: "enero junio",
    3: "enero septiembre",
    4: "enero diciembre"
  };
  return `${names[quarter]} ${year}`;
}

function metricMatches(type, metricId) {
  const normalized = normalizeKey(type);
  const matchers = {
    total: normalized.includes("total infracciones penales") || normalized.includes("criminalidad convencional"),
    homeRobbery: normalized.includes("7 1 robos con fuerza en domicilios"),
    forceRobbery:
      normalized.includes("7 robos con fuerza en domicilios establecimientos") &&
      !normalized.includes("7 1 robos con fuerza en domicilios"),
    violentRobbery: normalized.includes("6 robos con violencia"),
    thefts: normalized.includes("8 hurtos"),
    vehicles: normalized.includes("9 sustracciones")
  };
  return Boolean(matchers[metricId]);
}

function pickAreaRows(rows, areaName, scope) {
  const areaKey = normalizeKey(areaName);
  const geoFields = scope === "municipio" ? ["Geografía", "GeografÃ­a"] : ["Provincias"];
  return rows.filter((row) => {
    const geo = getRowValue(row, geoFields);
    const geoKey = normalizeKey(geo);
    const geoWithoutCode = normalizeKey(
      geo
        .replace(/^\d{5}\s+/, "")
        .replace(/^-?\s*municipio de\s+/i, "")
        .replace(/^-?\s*/, "")
    );
    return scope === "municipio"
      ? (/^\d{5}\s+/.test(geo) || /^-?\s*municipio de\s+/i.test(geo)) && geoWithoutCode === areaKey
      : geoKey === areaKey || geoKey.includes(areaKey) || areaKey.includes(geoKey);
  });
}

function extractMetricPoints(rows, descriptor, scope, metric) {
  const wantedPeriod = quarterCurrentPeriod(descriptor.year, descriptor.quarter);
  return rows
    .filter((row) => {
      const type = getRowValue(row, ["Tipología penal", "TipologÃ­a penal"]);
      const period = getRowValue(row, ["Periodos:"]);
      return metricMatches(type, metric.id) && normalizeKey(period).includes(wantedPeriod);
    })
    .map((row) => {
      const value = parseNumber(getRowValue(row, ["Total"]));
      return {
        metric: metric.id,
        label: metric.label,
        scope,
        area: getRowValue(row, scope === "municipio" ? ["Geografía", "GeografÃ­a"] : ["Provincias"]),
        year: descriptor.year,
        quarter: descriptor.quarter,
        quarterLabel: descriptor.label,
        officialPeriod: getRowValue(row, ["Periodos:"]),
        cumulative: value,
        quarterly: value,
        sourceFile: scope === "municipio" ? descriptor.municipalityFile : descriptor.provinceFile,
        sourceUrl: descriptor.sourceUrl,
        updated: descriptor.updated
      };
    });
}

function addQuarterlyDeltas(series) {
  const byMetric = new Map();
  for (const point of series) {
    if (!byMetric.has(point.metric)) byMetric.set(point.metric, []);
    byMetric.get(point.metric).push(point);
  }

  for (const points of byMetric.values()) {
    points.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
    const previousByYear = new Map();
    for (const point of points) {
      const previous = previousByYear.get(point.year);
      point.quarterly =
        point.quarter === 1 || !previous || previous.quarter !== point.quarter - 1
          ? point.cumulative
          : Math.max(0, point.cumulative - previous.cumulative);
      previousByYear.set(point.year, point);
    }
  }

  return series;
}

async function loadBalanceRows(descriptor, scope) {
  const url = scope === "municipio" ? descriptor.municipalityCsv : descriptor.provinceCsv;
  const text = await fetchText(url, 20000);
  return parseSemicolonCsv(text);
}

async function handleHistory(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const municipality = clampText(requestUrl.searchParams.get("municipality"), 80);
  const province = clampText(requestUrl.searchParams.get("province"), 80);
  const cacheKey = `${normalizeKey(municipality)}|${normalizeKey(province)}`;
  const cached = historyResultCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 1000 * 60 * 60 * 6) {
    sendJson(res, 200, cached.payload);
    return;
  }

  try {
    const descriptors = await getBalanceDescriptors();
    const metrics = metricDefinitions();
    let scope = "municipio";
    let area = municipality;
    const series = [];
    const sources = [];
    const skippedPeriods = [];

    for (const descriptor of descriptors) {
      let rows;
      try {
        rows = await loadBalanceRows(descriptor, scope);
      } catch (error) {
        skippedPeriods.push({
          label: descriptor.label,
          scope,
          reason: error.name === "AbortError" ? "timeout" : error.message
        });
        continue;
      }
      const areaRows = pickAreaRows(rows, area, scope);
      if (!areaRows.length) continue;
      for (const metric of metrics) {
        series.push(...extractMetricPoints(areaRows, descriptor, scope, metric));
      }
      sources.push({
        label: descriptor.label,
        file: descriptor.municipalityFile,
        updated: descriptor.updated,
        url: descriptor.sourceUrl
      });
    }

    if (!series.length && province) {
      scope = "provincia";
      area = province;
      sources.length = 0;
      for (const descriptor of descriptors) {
        let rows;
        try {
          rows = await loadBalanceRows(descriptor, scope);
        } catch (error) {
          skippedPeriods.push({
            label: descriptor.label,
            scope,
            reason: error.name === "AbortError" ? "timeout" : error.message
          });
          continue;
        }
        const areaRows = pickAreaRows(rows, area, scope);
        if (!areaRows.length) continue;
        for (const metric of metrics) {
          series.push(...extractMetricPoints(areaRows, descriptor, scope, metric));
        }
        sources.push({
          label: descriptor.label,
          file: descriptor.provinceFile,
          updated: descriptor.updated,
          url: descriptor.sourceUrl
        });
      }
    }

    const payload = {
      scope,
      area,
      metrics,
      series: addQuarterlyDeltas(series),
      availableYears: [...new Set(series.map((point) => point.year))],
      sources,
      skippedPeriods,
      qualityFlags: [
        scope === "municipio" ? "Municipio oficial" : "Provincia fallback",
        "Acumulado oficial disponible",
        "Trimestre real calculado por resta",
        skippedPeriods.length
          ? `${skippedPeriods.length} periodos omitidos por indisponibilidad temporal`
          : "Cobertura trimestral completa disponible"
      ]
    };
    historyResultCache.set(cacheKey, { createdAt: Date.now(), payload });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: "No se pudo construir el historico oficial",
      detail: error.message
    });
  }
}

async function handleOfficial(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const municipality = clampText(requestUrl.searchParams.get("municipality"), 80);
  const province = clampText(requestUrl.searchParams.get("province"), 80);

  try {
    const [municipalRows, provinceRows, occupationRows] = await Promise.all([
      fetchOfficialCsv(
        "balance-2026q1-municipios",
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAct/l0/09003.csv_bdsc"
      ),
      fetchOfficialCsv(
        "balance-2026q1-provincias",
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAct/l0/09002.csv_bdsc"
      ),
      fetchOfficialCsv(
        "allanamiento-usurpacion-provincias",
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/Datos11/l0/11002.csv_bdsc"
      )
    ]);

    const coreTypes = [
      "III. TOTAL INFRACCIONES PENALES",
      "7. Robos con fuerza en domicilios, establecimientos y otras instalaciones",
      "7.1.-Robos con fuerza en domicilios",
      "6. Robos con violencia e intimidación",
      "8. Hurtos",
      "9. Sustracciones de vehículos"
    ];
    const periods = ["enero-marzo 2026", "Variación % 2026/2025"];
    let scope = "municipio";
    let balance = pickRows(municipalRows, "Geografía", municipality, coreTypes, periods);

    if (!balance.length && province) {
      scope = "provincia";
      balance = pickRows(provinceRows, "Provincias", province, coreTypes, periods);
    }

    const occupation = pickRows(occupationRows, "Provincias", province, [""]).filter(
      (row) => row.periodo === "2025" || row.periodo === "2024" || row.periodo === "2023"
    );

    const metrics = balance.map((row) => ({
      scope,
      area: row.Geografía || row.Provincias,
      type: row["Tipología penal"],
      period: row["Periodos:"],
      value: parseNumber(row.Total),
      rawValue: row.Total
    }));

    sendJson(res, 200, {
      metrics,
      occupation: occupation.map((row) => ({
        scope: "provincia",
        area: row.Provincias,
        type: "Allanamiento / usurpacion de inmuebles",
        period: row.periodo,
        value: parseNumber(row.Total),
        rawValue: row.Total
      })),
      sources: [
        {
          name: "Portal Estadistico de Criminalidad - Balance 2026 T1 municipios",
          url: "https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatosBalanceAct%2F&title=Primer+trimestre&type=jaxi",
          file: "09003.csv_bdsc",
          updated: "04/06/2026",
          notes: "Datos 2026 pendientes de consolidar segun nota del portal."
        },
        {
          name: "Portal Estadistico de Criminalidad - Allanamiento / Usurpacion inmuebles",
          url: "https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatos11%2F&title=Allanamiento+%2F+Usurpaci%C3%B3n+inmuebles&type=jaxi",
          file: "11002.csv_bdsc",
          updated: "28/04/2026"
        }
      ]
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "No se pudieron cargar los datos oficiales",
      detail: error.message
    });
  }
}

function handleMarket(req, res) {
  sendJson(res, 200, {
    precision: "nacional",
    localDominanceAvailable: false,
    disclaimer:
      "No se ha localizado un dataset publico y verificable que publique cuota por codigo postal, municipio o provincia. Este modulo muestra senales nacionales trazables, no predominio local.",
    indicators: [
      {
        label: "Mercado sistemas seguridad 2024",
        value: "3.090 M EUR",
        note: "Instalacion, mantenimiento y conexion a CRA.",
        source: "DBK Observatorio Sectorial",
        url: "https://www.dbk.es/es/detalle-nota/sistemas-seguridad-2025"
      },
      {
        label: "Crecimiento mercado 2024/2023",
        value: "+6,9%",
        note: "DBK situa el crecimiento de 2024 cercano al 7%.",
        source: "DBK Observatorio Sectorial",
        url: "https://www.dbk.es/es/detalle-nota/sistemas-seguridad-2025"
      },
      {
        label: "Concentracion top 5",
        value: "69,2%",
        note: "Cuota conjunta en valor de las cinco primeras empresas, 2024.",
        source: "DBK Observatorio Sectorial",
        url: "https://www.dbk.es/es/detalle-nota/sistemas-seguridad-2025"
      },
      {
        label: "Empresas instalacion/mantenimiento",
        value: "1.265",
        note: "Empresas autorizadas a cierre de 2023.",
        source: "DBK Observatorio Sectorial",
        url: "https://www.dbk.es/es/detalle-nota/sistemas-seguridad-2025"
      }
    ],
    competitors: [
      {
        name: "Verisure / Securitas Direct",
        position: "lider del sector en Espana",
        evidence: "La prensa economica cita a Movistar Prosegur como segunda empresa tras Securitas Direct; Verisure comunica liderazgo mundial en alarmas conectadas a CRA.",
        confidence: "alta nacional, no local",
        sources: [
          {
            label: "El Pais - segunda empresa tras Securitas Direct",
            url: "https://elpais.com/economia/2025-07-26/una-incidencia-masiva-inutiliza-la-app-de-las-alarmas-de-movistar-prosegur.html"
          },
          {
            label: "Verisure - liderazgo mundial por clientes CRA",
            url: "https://www.verisure.es/primeros-en-proteger"
          }
        ]
      },
      {
        name: "Movistar Prosegur Alarmas",
        position: "principal challenger nacional",
        evidence: "La compania comunico 600.000 conexiones activas en Espana en octubre de 2025 y crecimiento del mercado residencial del 8% en T1 2025 segun estudio DYM.",
        confidence: "alta nacional, no local",
        sources: [
          {
            label: "Prosegur - 600.000 clientes Espana",
            url: "https://www.prosegur.com/media/articulo/prensa/movistar-prosegur-alarmas-alcanza-600000-clientes-espana-consolida-liderazgo-experiencia-usuario"
          },
          {
            label: "Prosegur / DYM - mercado residencial +8% T1 2025",
            url: "https://www.prosegur.com/media/articulo/prensa/el-mercado-de-alarmas-residenciales-crece-en-espana-8-impulsado-por-la-inseguridad-y-la-demanda-de-soluciones-tecnologicas"
          }
        ]
      },
      {
        name: "ADT, SICOR y operadores regionales",
        position: "competencia secundaria y local",
        evidence: "CNMC describe una oferta con operadores nacionales y otros de ambito mas limitado; DBK registra 128 centrales receptoras de alarmas en 2023.",
        confidence: "media nacional, baja local",
        sources: [
          {
            label: "CNMC - estructura de oferta",
            url: "https://www.cnmc.es/sites/default/files/791027_16.pdf"
          },
          {
            label: "DBK - 128 CRA",
            url: "https://www.dbk.es/es/detalle-nota/sistemas-seguridad-2025"
          }
        ]
      }
    ],
    recommendedLocalProxies: [
      "Densidad de viviendas unifamiliares frente a pisos",
      "Renta media y actividad comercial por seccion censal",
      "Historico trimestral de robos en domicilios/locales",
      "Noticias recientes con menciones a modus operandi",
      "Catastro/INE para tipologia residencial y antiguedad del parque",
      "Google Business/Maps para presencia de instaladores locales, si se integra una API con licencia"
    ]
  });
}

function pickProvinceSeries(rows, province) {
  const provinceKey = normalizeKey(province);
  return rows
    .filter((row) => {
      const area = getRowValue(row, ["Provincias"]);
      const areaKey = normalizeKey(area);
      return areaKey === provinceKey || areaKey.includes(provinceKey) || provinceKey.includes(areaKey);
    })
    .map((row) => ({
      area: getRowValue(row, ["Provincias"]),
      year: Number(getRowValue(row, ["periodo", "Periodo"])),
      value: parseNumber(getRowValue(row, ["Total"])),
      rawValue: getRowValue(row, ["Total"])
    }))
    .filter((row) => Number.isFinite(row.year) && row.value !== null)
    .sort((a, b) => a.year - b.year);
}

function pickHousingRows(rows, municipality) {
  const municipalityKey = normalizeKey(municipality);
  const parsed = rows.map((row) => {
    const area = getRowValue(row, ["Municipios (con mÃ¡s de 2000 habitantes)", "Municipios (con más de 2000 habitantes)"]);
    const withoutCode = normalizeKey(area.replace(/^\d{5}\s+/, ""));
    return { row, withoutCode };
  });
  const exact = parsed.filter((item) => item.withoutCode === municipalityKey);
  if (exact.length) return exact.map((item) => item.row);
  return parsed
    .filter((item) => item.withoutCode.includes(municipalityKey) || municipalityKey.includes(item.withoutCode))
    .map((item) => item.row);
}

function summarizeHousing(rows) {
  const latestYear = Math.max(
    ...rows
      .map((row) => Number(getRowValue(row, ["Periodo"])))
      .filter((year) => Number.isFinite(year))
  );
  if (!Number.isFinite(latestYear)) return null;
  const byType = new Map();
  for (const row of rows) {
    const year = Number(getRowValue(row, ["Periodo"]));
    if (year !== latestYear) continue;
    const type = normalizeKey(getRowValue(row, ["Tipo de vivienda"]));
    byType.set(type, {
      label: getRowValue(row, ["Tipo de vivienda"]),
      value: parseNumber(getRowValue(row, ["Total"])),
      rawValue: getRowValue(row, ["Total"])
    });
  }

  const findType = (needles) => {
    for (const [key, value] of byType.entries()) {
      if (needles.some((needle) => key.includes(needle))) return value;
    }
    return null;
  };

  const total = findType(["total viviendas"])?.value || null;
  const main = findType(["vivienda principal"])?.value || null;
  const secondary = findType(["vivienda secundaria"])?.value || null;
  const empty = findType(["vivienda vac"])?.value || null;
  const nonMain = findType(["vivienda no principal"])?.value || null;

  return {
    year: latestYear,
    total,
    main,
    secondary,
    empty,
    nonMain,
    emptyRate: total ? Number(((empty || 0) / total * 100).toFixed(1)) : null,
    nonMainRate: total ? Number(((nonMain || 0) / total * 100).toFixed(1)) : null,
    secondaryRate: total ? Number(((secondary || 0) / total * 100).toFixed(1)) : null
  };
}

function buildOccupationContext(knownSeries, detentionSeries, housing) {
  const latestKnown = knownSeries.at(-1);
  const previousKnown = knownSeries.at(-2);
  const latestDetentions = detentionSeries.find((item) => item.year === latestKnown?.year) || detentionSeries.at(-1);
  const knownTrend = latestKnown && previousKnown ? latestKnown.value - previousKnown.value : null;
  const knownTrendPct =
    latestKnown && previousKnown && previousKnown.value
      ? Number(((latestKnown.value - previousKnown.value) / previousKnown.value * 100).toFixed(1))
      : null;
  const detentionRatio =
    latestKnown?.value && latestDetentions?.value
      ? Number((latestDetentions.value / latestKnown.value * 100).toFixed(1))
      : null;

  const pressure = Math.min(42, Math.log10((latestKnown?.value || 0) + 1) * 14);
  const trend = knownTrendPct && knownTrendPct > 0 ? Math.min(18, knownTrendPct / 2) : 0;
  const emptyHousing = housing?.emptyRate ? Math.min(24, housing.emptyRate * 1.2) : 0;
  const nonMain = housing?.nonMainRate ? Math.min(16, housing.nonMainRate * 0.35) : 0;
  const score = Math.round(Math.max(18, Math.min(96, 18 + pressure + trend + emptyHousing + nonMain)));
  const label = score >= 74 ? "Contexto alto" : score >= 54 ? "Contexto medio" : "Contexto contenido";

  return {
    score,
    label,
    latestKnown,
    latestDetentions,
    knownTrend,
    knownTrendPct,
    detentionRatio,
    precision: "Provincia anual + vivienda municipal INE",
    notes: [
      "Interior publica allanamiento/usurpacion por provincia y año.",
      "INE aporta contexto residencial municipal, no hechos delictivos.",
      "El indice es contextual y no predice una direccion concreta."
    ]
  };
}

async function handleOccupationContext(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const municipality = clampText(requestUrl.searchParams.get("municipality"), 80);
  const province = clampText(requestUrl.searchParams.get("province"), 80);
  if (!province) {
    sendJson(res, 400, { error: "Provincia requerida para contexto de ocupacion" });
    return;
  }

  try {
    const [knownRows, detentionRows, housingRows] = await Promise.all([
      fetchOfficialCsv(
        "allanamiento-usurpacion-hechos-provincias",
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/Datos11/l0/11002.csv_bdsc"
      ),
      fetchOfficialCsv(
        "allanamiento-usurpacion-detenciones-provincias",
        "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/Datos11/l0/11006.csv_bdsc"
      ),
      fetchOfficialCsv("ine-viviendas-municipios-3456", "https://www.ine.es/jaxiT3/files/t/csv_bdsc/3456.csv")
    ]);

    const knownSeries = pickProvinceSeries(knownRows, province);
    const detentionSeries = pickProvinceSeries(detentionRows, province);
    const housing = summarizeHousing(pickHousingRows(housingRows, municipality));
    const context = buildOccupationContext(knownSeries, detentionSeries, housing);

    sendJson(res, 200, {
      province,
      municipality,
      precision: context.precision,
      context,
      officialProvinceSeries: knownSeries,
      detentionSeries,
      housingContext: housing,
      sources: [
        {
          name: "Portal Estadistico de Criminalidad - Hechos conocidos por allanamiento/usurpacion",
          url: "https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatos11%2F&title=Allanamiento+%2F+Usurpaci%C3%B3n+inmuebles&type=jaxi",
          file: "11002.csv_bdsc"
        },
        {
          name: "Portal Estadistico de Criminalidad - Detenciones e investigados",
          url: "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/Tabla.htm?L=0&file=11006.px&path=%2FDatos11%2Fl0%2F",
          file: "11006.csv_bdsc"
        },
        {
          name: "INE - Viviendas por municipios y tipo de vivienda",
          url: "https://datos.gob.es/es/catalogo/ea0042823-viviendas-por-municipios-con-mas-de-2-000-habitantes-y-tipo-de-vivienda-identificador-api-3456",
          file: "3456.csv"
        }
      ]
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "No se pudo cargar contexto de ocupacion",
      detail: error.message
    });
  }
}

function buildNewsUrl(params) {
  const place = clampText(params.get("place"), 80);
  const province = clampText(params.get("province"), 80);
  const area = place || province || "Espana";
  const query = [
    area,
    "(robo OR robos OR ladrones OR asalto OR alunizaje OR intrusión OR intrusion) (vivienda OR domicilio OR casa OR chalet OR piso OR comercio OR local OR negocio OR tienda OR bar OR restaurante OR nave)"
  ].join(" ");

  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${query} when:90d`);
  url.searchParams.set("hl", "es");
  url.searchParams.set("gl", "ES");
  url.searchParams.set("ceid", "ES:es");
  return url;
}

function parseGoogleNewsRss(xml) {
  const crimeTerms = /(robo|robos|ladron|ladrones|asalto|alunizaje|intrusi[oó]n)/i;
  const propertyTerms = /(vivienda|domicilio|casa|chalet|piso|comercio|local|negocio|tienda|bar|restaurante|nave|establecimiento)/i;
  const stopTerms = /(mercado de trabajo|oferta de empleo|empleo público|oposiciones|formaci[oó]n|ocupaciones profesionales|ocupaciones en el mercado|banco que opera|bancos que operaban|atraco a banco|dispara|disparo|paliza|agresi[oó]n sexual|homicidio)/i;
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 24).map((match) => {
    const item = match[1];
    const read = (tag) => decodeHtml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]);
    const sourceMatch = item.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    return {
      title: read("title"),
      url: read("link"),
      source: decodeHtml(sourceMatch?.[2]) || "Google News",
      sourceUrl: sourceMatch?.[1] || "",
      date: read("pubDate"),
      snippet: read("description"),
      verified: true
    };
  }).filter((article) => {
    const haystack = `${article.title} ${article.snippet}`;
    return crimeTerms.test(haystack) && propertyTerms.test(haystack) && !stopTerms.test(haystack);
  }).slice(0, 12);
}

async function fetchGdeltArticles(params) {
  const place = clampText(params.get("place"), 80);
  const province = clampText(params.get("province"), 80);
  const area = place || province || "Espana";
  const query = [
    `"${area}"`,
    "(robo OR robos OR ladrones OR asalto OR alunizaje OR intrusion OR intrusión)",
    "(vivienda OR domicilio OR casa OR chalet OR piso OR comercio OR local OR negocio OR tienda OR bar OR restaurante OR nave OR establecimiento)",
    "sourceCountry:SP",
    "sourcelang:Spanish"
  ].join(" ");

  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "hybridrel");
  url.searchParams.set("maxrecords", "10");
  url.searchParams.set("timespan", "90d");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "radar-seguridad-local/0.2" }
    });
    if (!response.ok) return [];
    const data = await response.json();
    const crimeTerms = /(robo|robos|ladron|ladrones|asalto|alunizaje|intrusi[oó]n)/i;
    const propertyTerms = /(vivienda|domicilio|casa|chalet|piso|comercio|local|negocio|tienda|bar|restaurante|nave|establecimiento)/i;
    const stopTerms = /(mercado de trabajo|oferta de empleo|empleo público|oposiciones|formaci[oó]n|ocupaciones profesionales|ocupaciones en el mercado|atraco a banco|dispara|disparo|paliza|agresi[oó]n sexual|homicidio)/i;
    return (Array.isArray(data.articles) ? data.articles : []).map((article) => ({
      title: article.title,
      url: article.url,
      source: article.sourceCommonName || article.domain,
      date: article.seendate,
      snippet: "",
      image: article.socialimage || "",
      verified: true
    })).filter((article) => {
      const haystack = `${article.title} ${article.snippet}`;
      return crimeTerms.test(haystack) && propertyTerms.test(haystack) && !stopTerms.test(haystack);
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleNews(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const googleUrl = buildNewsUrl(requestUrl.searchParams);

  try {
    let gdeltArticles = [];
    try {
      gdeltArticles = await fetchGdeltArticles(requestUrl.searchParams);
    } catch {
      gdeltArticles = [];
    }
    const xml = await fetchText(googleUrl);
    const googleArticles = parseGoogleNewsRss(xml);
    const seen = new Set();
    let articles = [...gdeltArticles, ...googleArticles].filter((article) => {
      const key = `${article.title}|${article.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
    articles = await enrichImages(articles);
    sendJson(res, 200, {
      source: articles.length ? "GDELT + Google News RSS" : "sin resultados",
      queryUrl: googleUrl.toString(),
      articles
    });
  } catch (error) {
    try {
      let articles = [];
      try {
        articles = await fetchGdeltArticles(requestUrl.searchParams);
      } catch {
        articles = [];
      }
      sendJson(res, 200, {
        source: articles.length ? "GDELT" : "sin resultados",
        error: error.message,
        articles
      });
    } catch (fallbackError) {
      sendJson(res, 502, {
        source: "error",
        error: fallbackError.message,
        articles: []
      });
    }
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Body demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleHistoryLog(req, res) {
  if (req.method === "GET") {
    const entries = readJsonFile(historyLogPath, []);
    const seen = new Set();
    const deduped = entries.filter((entry) => {
      const key = normalizeKey(
        `${entry.query} ${entry.area?.postalCode || ""} ${entry.area?.municipality || ""} ${entry.area?.province || ""}`
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    sendJson(res, 200, { entries: deduped.slice(0, 30) });
    return;
  }

  if (req.method === "POST") {
    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || "{}");
      const entries = readJsonFile(historyLogPath, []);
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        query: clampText(payload.query, 180),
        area: payload.area || null,
        scope: clampText(payload.scope, 40),
        score: payload.score ?? null,
        kpis: payload.kpis || {},
        newsCount: Number(payload.newsCount || 0),
        sourcesCount: Number(payload.sourcesCount || 0)
      };
      const entryKey = normalizeKey(
        `${entry.query} ${entry.area?.postalCode || ""} ${entry.area?.municipality || ""} ${entry.area?.province || ""}`
      );
      const next = [
        entry,
        ...entries.filter((item) => {
          const itemKey = normalizeKey(
            `${item.query} ${item.area?.postalCode || ""} ${item.area?.municipality || ""} ${item.area?.province || ""}`
          );
          return itemKey !== entryKey;
        })
      ].slice(0, 100);
      writeJsonFile(historyLogPath, next);
      sendJson(res, 200, { entry, entries: next.slice(0, 30) });
    } catch (error) {
      sendJson(res, 400, { error: "No se pudo guardar el historial", detail: error.message });
    }
    return;
  }

  sendJson(res, 405, { error: "Metodo no permitido" });
}

/*
function buildGdeltUrl(params) {
  const place = clampText(params.get("place"), 80);
  const province = clampText(params.get("province"), 80);
  const days = Math.min(Math.max(Number(params.get("days") || 60), 7), 180);
  const area = place || province || "Espana";
  const query = [
    `"${area}"`,
    "(robo OR robos OR okupacion OR ocupacion OR allanamiento OR intrusion OR alarma OR seguridad)",
    "sourceCountry:SP",
    "sourcelang:Spanish"
  ].join(" ");

  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "hybridrel");
  url.searchParams.set("maxrecords", "12");
  url.searchParams.set("timespan", `${days}d`);
  return url;
}

async function handleNews(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const gdeltUrl = buildGdeltUrl(requestUrl.searchParams);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(gdeltUrl, {
      signal: controller.signal,
      headers: {
        "user-agent": "radar-seguridad-local/0.1"
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`GDELT ${response.status}`);
    }

    const data = await response.json();
    const articles = Array.isArray(data.articles) ? data.articles : [];
    sendJson(res, 200, {
      source: "GDELT",
      query: gdeltUrl.searchParams.get("query"),
      articles: articles.map((article) => ({
        title: article.title,
        url: article.url,
        source: article.sourceCommonName || article.domain,
        date: article.seendate,
        image: article.socialimage,
        snippet: article.seendate
      }))
    });
  } catch (error) {
    sendJson(res, 200, {
      source: "fallback",
      error: error.message,
      articles: []
    });
  }
}
*/

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = path
    .normalize(decodeURIComponent(requestedPath))
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/health" || req.url.startsWith("/api/health?")) {
    sendJson(res, 200, {
      status: "ok",
      service: "cp-finder-security",
      timestamp: new Date().toISOString()
    });
    return;
  }
  if (req.url.startsWith("/api/news")) {
    handleNews(req, res);
    return;
  }
  if (req.url.startsWith("/api/postal")) {
    handlePostal(req, res);
    return;
  }
  if (req.url.startsWith("/api/resolve")) {
    handleResolve(req, res);
    return;
  }
  if (req.url.startsWith("/api/suggest")) {
    handleSuggest(req, res);
    return;
  }
  if (req.url.startsWith("/api/official")) {
    handleOfficial(req, res);
    return;
  }
  if (req.url.startsWith("/api/market")) {
    handleMarket(req, res);
    return;
  }
  if (req.url.startsWith("/api/occupation-context")) {
    handleOccupationContext(req, res);
    return;
  }
  if (req.url.startsWith("/api/history-log")) {
    handleHistoryLog(req, res);
    return;
  }
  if (req.url.startsWith("/api/history")) {
    handleHistory(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Radar Seguridad Local: http://0.0.0.0:${port}`);
});
