const fs = require("node:fs");
const path = require("node:path");

const outputPath = path.join(__dirname, "..", "data", "official-history-index.json");

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

function parseNumber(value) {
  const clean = String(value || "").replace(/\./g, "").replace(",", ".");
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

async function fetchText(url, timeoutMs = 30000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "cp-finder-history-builder/1.0" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function metricDefinitions() {
  return [
    { id: "total", label: "Total infracciones" },
    { id: "homeRobbery", label: "Robos domicilios" },
    { id: "forceRobbery", label: "Domicilios + locales" },
    { id: "violentRobbery", label: "Robos violencia" },
    { id: "thefts", label: "Hurtos" },
    { id: "vehicles", label: "Vehiculos" }
  ];
}

function metricIndex(type) {
  const normalized = normalizeKey(type);
  if (normalized.includes("total infracciones penales") || normalized.includes("criminalidad convencional")) return 0;
  if (normalized.includes("7 1 robos con fuerza en domicilios")) return 1;
  if (
    normalized.includes("7 robos con fuerza en domicilios establecimientos") &&
    !normalized.includes("7 1 robos con fuerza en domicilios")
  ) return 2;
  if (normalized.includes("6 robos con violencia")) return 3;
  if (normalized.includes("8 hurtos")) return 4;
  if (normalized.includes("9 sustracciones")) return 5;
  return -1;
}

function quarterPeriod(year, quarter) {
  return normalizeKey({
    1: `enero marzo ${year}`,
    2: `enero junio ${year}`,
    3: `enero septiembre ${year}`,
    4: `enero diciembre ${year}`
  }[quarter]);
}

async function discoverDescriptor(year, quarter) {
  const url = `https://estadisticasdecriminalidad.ses.mir.es/sec/dynPx/inebase/index.htm?file=pcaxis&path=%2FDatosBalanceAnt%2F${year}${quarter}%2F&type=pcaxis`;
  try {
    const html = await fetchText(url);
    const files = [...new Set([...html.matchAll(/file=([0-9]+\.px)/g)].map((match) => match[1]))];
    if (files.length < 3) return null;
    const updated = html.match(/<dd class="FechCambio">([^<]+)<\/dd>/)?.[1] || "";
    return {
      year,
      quarter,
      label: `${year} T${quarter}`,
      updated,
      provinceFile: files[1],
      municipalityFile: files[2],
      provinceCsv: `https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAnt/l0/${files[1].replace(".px", ".csv_bdsc")}`,
      municipalityCsv: `https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAnt/l0/${files[2].replace(".px", ".csv_bdsc")}`,
      sourceUrl: `https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatosBalanceAnt%2F${year}${quarter}%2F&title=Trimestre&type=jaxi`
    };
  } catch (error) {
    console.warn(`Descriptor ${year} T${quarter} omitido: ${error.message}`);
    return null;
  }
}

async function getDescriptors() {
  const tasks = [];
  for (let year = 2016; year <= 2025; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) tasks.push([year, quarter]);
  }
  const historical = [];
  for (let index = 0; index < tasks.length; index += 8) {
    const found = await Promise.all(
      tasks.slice(index, index + 8).map(([year, quarter]) => discoverDescriptor(year, quarter))
    );
    historical.push(...found.filter(Boolean));
  }
  historical.push({
    year: 2026,
    quarter: 1,
    label: "2026 T1",
    updated: "04/06/2026",
    provinceFile: "09002.px",
    municipalityFile: "09003.px",
    provinceCsv:
      "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAct/l0/09002.csv_bdsc",
    municipalityCsv:
      "https://estadisticasdecriminalidad.ses.mir.es/sec/jaxiPx/files/_px/es/csv_bdsc/DatosBalanceAct/l0/09003.csv_bdsc",
    sourceUrl:
      "https://estadisticasdecriminalidad.ses.mir.es/publico/portalestadistico/datos.html?path=%2FDatosBalanceAct%2F&title=Primer+trimestre&type=jaxi"
  });
  return historical.sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

function addPoint(areas, key, name, descriptorIndex, metric, value) {
  if (!key || value === null || metric < 0) return;
  if (!areas[key]) areas[key] = { name, points: [] };
  areas[key].points.push([descriptorIndex, metric, value]);
}

function extractRows(rows, scope, descriptorIndex, descriptor, areas) {
  const wantedPeriod = quarterPeriod(descriptor.year, descriptor.quarter);
  for (const row of rows) {
    const period = normalizeKey(getRowValue(row, ["Periodos:"]));
    if (!period.includes(wantedPeriod)) continue;
    const metric = metricIndex(getRowValue(row, ["Tipología penal", "TipologÃ­a penal"]));
    if (metric < 0) continue;
    const geo = getRowValue(row, scope === "municipio" ? ["Geografía", "GeografÃ­a"] : ["Provincias"]);
    if (!geo) continue;
    if (scope === "municipio" && !/^\d{5}\s+/.test(geo) && !/^-?\s*municipio de\s+/i.test(geo)) continue;
    const name =
      scope === "municipio"
        ? geo.replace(/^\d{5}\s+/, "").replace(/^-?\s*municipio de\s+/i, "").replace(/^-?\s*/, "").trim()
        : geo.trim();
    addPoint(areas, normalizeKey(name), name, descriptorIndex, metric, parseNumber(getRowValue(row, ["Total"])));
  }
}

async function processDescriptor(dataset, descriptor, descriptorIndex) {
  for (const scope of ["municipio", "provincia"]) {
    const url = scope === "municipio" ? descriptor.municipalityCsv : descriptor.provinceCsv;
    try {
      const rows = parseSemicolonCsv(await fetchText(url, 45000));
      extractRows(rows, scope, descriptorIndex, descriptor, dataset.areas[scope]);
    } catch (error) {
      dataset.skipped.push({ label: descriptor.label, scope, reason: error.message });
      console.warn(`${descriptor.label} ${scope} omitido: ${error.message}`);
    }
  }
  console.log(`${descriptor.label} procesado`);
}

async function main() {
  const descriptors = await getDescriptors();
  const dataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "Portal Estadistico de Criminalidad - Ministerio del Interior",
    metrics: metricDefinitions(),
    descriptors: descriptors.map(({ provinceCsv, municipalityCsv, ...descriptor }) => descriptor),
    areas: { municipio: {}, provincia: {} },
    skipped: []
  };

  for (let index = 0; index < descriptors.length; index += 1) {
    await processDescriptor(dataset, descriptors[index], index);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(dataset), "utf8");
  const sizeMb = fs.statSync(outputPath).size / 1024 / 1024;
  console.log(`Indice escrito en ${outputPath} (${sizeMb.toFixed(2)} MB)`);
  console.log(`${Object.keys(dataset.areas.municipio).length} municipios, ${Object.keys(dataset.areas.provincia).length} provincias`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
