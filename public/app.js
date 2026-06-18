let map;
let markerGroup;
let mainChart;
let suggestTimer;
let systemThemeQuery;

const appScript = document.querySelector('script[src*="app.js"]');
const appBasePath = appScript
  ? new URL(appScript.src, window.location.href).pathname.replace(/\/[^/]*$/, "")
  : "";

const state = {
  query: "28013",
  area: null,
  official: null,
  history: null,
  market: null,
  occupation: null,
  news: [],
  selectedArticleIndex: null,
  metric: "homeRobbery",
  view: "line",
  mode: "quarterly",
  quarter: "all",
  themePreference: localStorage.getItem("cpfinder-theme") || "system",
  resolvedTheme: "dark",
  expandedSources: false,
  expandedMarket: false,
  steps: {
    resolve: "idle",
    official: "idle",
    occupation: "idle",
    history: "idle",
    news: "idle"
  },
  historyEntries: []
};

const metricFallbacks = [
  { id: "homeRobbery", label: "Robos domicilios" },
  { id: "forceRobbery", label: "Domicilios + locales" },
  { id: "total", label: "Total infracciones" },
  { id: "violentRobbery", label: "Robos violencia" },
  { id: "thefts", label: "Hurtos" },
  { id: "vehicles", label: "Vehiculos" }
];

const elements = {
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#searchInput"),
  suggestions: document.querySelector("#suggestions"),
  loadSteps: document.querySelector("#loadSteps"),
  historyList: document.querySelector("#historyList"),
  areaTitle: document.querySelector("#areaTitle"),
  areaSubtitle: document.querySelector("#areaSubtitle"),
  scopeBadge: document.querySelector("#scopeBadge"),
  printReport: document.querySelector("#printReport"),
  themeSwitcher: document.querySelector("#themeSwitcher"),
  geoSummary: document.querySelector("#geoSummary"),
  chartTitle: document.querySelector("#chartTitle"),
  historyStatus: document.querySelector("#historyStatus"),
  metricControls: document.querySelector("#metricControls"),
  viewControls: document.querySelector("#viewControls"),
  modeControls: document.querySelector("#modeControls"),
  comparisonStrip: document.querySelector("#comparisonStrip"),
  quarterControls: document.querySelector("#quarterControls"),
  quickArea: document.querySelector("#quickArea"),
  quickScope: document.querySelector("#quickScope"),
  quickSeries: document.querySelector("#quickSeries"),
  quickNews: document.querySelector("#quickNews"),
  scoreValue: document.querySelector("#scoreValue"),
  scoreText: document.querySelector("#scoreText"),
  officialStatus: document.querySelector("#officialStatus"),
  officialGrid: document.querySelector("#officialGrid"),
  occupationStatus: document.querySelector("#occupationStatus"),
  occupationGrid: document.querySelector("#occupationGrid"),
  sellerStatus: document.querySelector("#sellerStatus"),
  sellerGrid: document.querySelector("#sellerGrid"),
  toggleMarket: document.querySelector("#toggleMarket"),
  marketGrid: document.querySelector("#marketGrid"),
  selectedStatus: document.querySelector("#selectedStatus"),
  selectedNews: document.querySelector("#selectedNews"),
  newsStatus: document.querySelector("#newsStatus"),
  newsList: document.querySelector("#newsList"),
  sourceList: document.querySelector("#sourceList"),
  toggleSources: document.querySelector("#toggleSources")
};

function init() {
  setupTheme();
  syncResponsiveMode();
  initMap();
  mainChart = echarts.init(document.querySelector("#mainChart"), null, { renderer: "canvas" });
  bindEvents();
  renderLoadSteps();
  renderMetricControls(metricFallbacks);
  renderSelectedNews(null);
  renderSeller();
  loadMarket();
  loadHistoryLog();
  runSearch(state.query);
}

function initMap() {
  map = L.map("map", { zoomControl: false }).setView([40.4168, -3.7038], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  markerGroup = L.layerGroup().addTo(map);
}

function bindEvents() {
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch(elements.input.value.trim());
  });

  elements.input.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => loadSuggestions(elements.input.value), 160);
  });

  elements.viewControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    setActive(elements.viewControls, "view", state.view);
    renderHistoryCharts();
  });

  elements.modeControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    state.mode = button.dataset.mode;
    setActive(elements.modeControls, "mode", state.mode);
    renderHistoryCharts();
  });

  elements.quarterControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quarter]");
    if (!button) return;
    state.quarter = button.dataset.quarter;
    setActive(elements.quarterControls, "quarter", state.quarter);
    renderHistoryCharts();
  });

  elements.metricControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-metric]");
    if (!button) return;
    state.metric = button.dataset.metric;
    setActive(elements.metricControls, "metric", state.metric);
    renderHistoryCharts();
  });

  elements.printReport.addEventListener("click", () => window.print());
  elements.themeSwitcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-choice]");
    if (!button) return;
    applyTheme(button.dataset.themeChoice);
  });
  elements.toggleSources.addEventListener("click", () => {
    state.expandedSources = !state.expandedSources;
    renderSources();
  });
  elements.toggleMarket.addEventListener("click", () => {
    state.expandedMarket = !state.expandedMarket;
    renderMarket();
  });
  window.addEventListener("resize", () => {
    syncResponsiveMode();
    mainChart?.resize();
    map?.invalidateSize();
  });
}

function syncResponsiveMode() {
  document.body.classList.add("force-desktop");
}

function setupTheme() {
  systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  systemThemeQuery.addEventListener?.("change", () => {
    if (state.themePreference === "system") applyTheme("system");
  });
  applyTheme(state.themePreference);
}

function applyTheme(preference) {
  state.themePreference = preference || "system";
  localStorage.setItem("cpfinder-theme", state.themePreference);
  state.resolvedTheme =
    state.themePreference === "system"
      ? (systemThemeQuery?.matches ? "dark" : "light")
      : state.themePreference;
  document.documentElement.dataset.theme = state.resolvedTheme;
  document.documentElement.dataset.themePreference = state.themePreference;
  renderThemeControls();
  if (mainChart) renderHistoryCharts();
}

function renderThemeControls() {
  elements.themeSwitcher?.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === state.themePreference);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "s/d";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(number);
}

function formatDate(value) {
  if (!value) return "fecha no indicada";
  const compact = String(value).slice(0, 8);
  if (/^\d{8}$/.test(compact)) return `${compact.slice(6, 8)}/${compact.slice(4, 6)}/${compact.slice(0, 4)}`;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }
  return String(value);
}

function setStep(step, status) {
  state.steps[step] = status;
  renderLoadSteps();
}

function renderLoadSteps() {
  const labels = {
    resolve: "Territorio",
    official: "KPIs oficiales",
    occupation: "Ocupacion / vivienda",
    history: "Historico trimestral",
    news: "Noticias"
  };
  elements.loadSteps.innerHTML = Object.entries(labels)
    .map(([key, label]) => {
      const status = state.steps[key] || "idle";
      return `<div class="step" data-status="${status}"><span></span><div><strong>${label}</strong><small>${stepLabel(status)}</small></div></div>`;
    })
    .join("");
}

function stepLabel(status) {
  return {
    idle: "pendiente",
    loading: "cargando",
    done: "listo",
    error: "error"
  }[status] || status;
}

function setActive(container, key, value) {
  container.querySelectorAll(`[data-${key}]`).forEach((button) => {
    button.classList.toggle("active", button.dataset[key] === value);
  });
}

async function fetchJson(url, options) {
  const requestUrl = url.startsWith("/api/") ? `${appBasePath}${url}` : url;
  const response = await fetch(requestUrl, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
  return payload;
}

async function loadSuggestions(query) {
  const clean = query.trim();
  if (clean.length < 2) {
    elements.suggestions.innerHTML = "";
    return;
  }
  try {
    const payload = await fetchJson(`/api/suggest?q=${encodeURIComponent(clean)}`);
    renderSuggestions(payload.suggestions || []);
  } catch {
    elements.suggestions.innerHTML = "";
  }
}

function renderSuggestions(suggestions) {
  elements.suggestions.innerHTML = suggestions
    .map(
      (item) => `
      <button type="button" class="suggestion-btn" data-query="${escapeHtml(item.query || item.label)}">
        <span>${escapeHtml(item.type || "Zona")}</span>
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.subtitle || item.source || "")}</small>
      </button>`
    )
    .join("");
  elements.suggestions.querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.input.value = button.dataset.query;
      elements.suggestions.innerHTML = "";
      runSearch(button.dataset.query);
    });
  });
}

async function runSearch(query) {
  const clean = String(query || "").trim();
  if (!clean) return;
  state.query = clean;
  state.area = null;
  state.official = null;
  state.history = null;
  state.occupation = null;
  state.news = [];
  state.selectedArticleIndex = null;
  state.steps = { resolve: "loading", official: "idle", occupation: "idle", history: "idle", news: "idle" };
  elements.input.value = clean;
  elements.suggestions.innerHTML = "";
  renderLoadSteps();
  renderSkeletons(clean);

  try {
    const resolved = await fetchJson(`/api/resolve?q=${encodeURIComponent(clean)}`);
    state.area = normalizeArea(resolved.selected, resolved.source);
    setStep("resolve", "done");
    renderArea();
    updateMap();

    const loads = [
      loadOfficial(state.area).catch((error) => renderOfficialError(error)),
      loadOccupation(state.area).catch((error) => renderOccupationError(error)),
      loadNews(state.area).catch((error) => renderNewsError(error)),
      loadHistory(state.area).catch((error) => renderHistoryError(error))
    ];
    Promise.allSettled(loads).then(() => saveSession());
  } catch (error) {
    setStep("resolve", "error");
    elements.areaTitle.textContent = "No encontrado";
    elements.areaSubtitle.textContent = error.message;
    elements.scopeBadge.textContent = "Error";
  }
}

function normalizeArea(selected, source) {
  return {
    postalCode: selected?.postalCode || "",
    municipality: selected?.municipality || selected?.place || "",
    place: selected?.place || selected?.municipality || "",
    province: selected?.province || "",
    community: selected?.community || "",
    lat: Number(selected?.lat),
    lng: Number(selected?.lng),
    source
  };
}

function renderSkeletons(query) {
  elements.areaTitle.textContent = query;
  elements.areaSubtitle.textContent = "Resolviendo zona...";
  elements.scopeBadge.textContent = "Cargando";
  elements.officialStatus.textContent = "Pendiente";
  elements.occupationStatus.textContent = "Pendiente";
  elements.historyStatus.textContent = "Pendiente";
  elements.newsStatus.textContent = "Pendiente";
  elements.officialGrid.innerHTML = `<div class="loading-card">Preparando KPIs oficiales...</div>`;
  elements.occupationGrid.innerHTML = `<div class="loading-card">Preparando contexto oficial...</div>`;
  renderSeller();
  elements.newsList.innerHTML = `<div class="loading-card">Esperando zona validada...</div>`;
  elements.comparisonStrip.innerHTML = "";
  elements.quickArea.textContent = "--";
  elements.quickScope.textContent = "Resolviendo";
  elements.quickSeries.textContent = "--";
  elements.quickNews.textContent = "--";
  elements.sourceList.innerHTML = `<div class="empty-state">Las fuentes apareceran cuando termine la carga.</div>`;
  mainChart.clear();
}

async function loadOfficial(area) {
  setStep("official", "loading");
  elements.officialStatus.textContent = "Cargando";
  const params = new URLSearchParams({ municipality: area.municipality, province: area.province });
  state.official = await fetchJson(`/api/official?${params.toString()}`);
  setStep("official", "done");
  renderOfficial();
  renderScore();
  renderSeller();
  renderSources();
}

async function loadOccupation(area) {
  setStep("occupation", "loading");
  elements.occupationStatus.textContent = "Cargando";
  const params = new URLSearchParams({ municipality: area.municipality, province: area.province });
  state.occupation = await fetchJson(`/api/occupation-context?${params.toString()}`);
  setStep("occupation", "done");
  renderOccupation();
  renderSeller();
  renderSources();
}

async function loadHistory(area) {
  setStep("history", "loading");
  elements.historyStatus.textContent = "Cargando historico";
  const params = new URLSearchParams({ municipality: area.municipality, province: area.province });
  state.history = await fetchJson(`/api/history?${params.toString()}`);
  setStep("history", "done");
  elements.historyStatus.textContent = `${state.history.series?.length || 0} puntos`;
  const metrics = state.history.metrics?.length ? state.history.metrics : metricFallbacks;
  if (!metrics.some((metric) => metric.id === state.metric)) state.metric = metrics[0]?.id || "total";
  renderMetricControls(metrics);
  renderHistoryCharts();
  renderSeller();
  renderSources();
}

async function loadNews(area) {
  setStep("news", "loading");
  elements.newsStatus.textContent = "Rastreando";
  elements.newsList.innerHTML = `<div class="loading-card">Buscando noticias recientes de robos en viviendas, comercios y locales...</div>`;
  const params = new URLSearchParams({ place: area.municipality, province: area.province });
  const payload = await fetchJson(`/api/news?${params.toString()}`);
  state.news = payload.articles || [];
  setStep("news", "done");
  renderNews(payload);
  updateMap();
  renderScore();
  renderSeller();
  renderSources(payload);
}

async function loadMarket() {
  if (!elements.marketGrid) return;
  elements.toggleMarket.textContent = "Cargando";
  elements.marketGrid.innerHTML = `<div class="loading-card">Cargando mercado nacional verificable...</div>`;
  try {
    state.market = await fetchJson("/api/market");
    renderMarket();
    renderSources();
  } catch (error) {
    elements.toggleMarket.textContent = "Error";
    elements.marketGrid.innerHTML = `<div class="empty-state">No se pudo cargar mercado de alarmas: ${escapeHtml(error.message)}</div>`;
  }
}

function renderArea() {
  const area = state.area;
  if (!area) return;
  elements.areaTitle.textContent = area.municipality || area.place || "Zona";
  elements.areaSubtitle.textContent = [
    area.postalCode ? `CP ${area.postalCode}` : "",
    area.province,
    area.community
  ].filter(Boolean).join(" · ");
  elements.scopeBadge.textContent = area.postalCode ? "Codigo postal" : "Municipio";
  elements.geoSummary.textContent = `Centro aproximado: ${area.place || area.municipality}. Marcadores de noticias sin direccion exacta.`;
  elements.quickArea.textContent = area.postalCode || area.municipality || "--";
  elements.quickScope.textContent = area.postalCode ? `${area.municipality}, ${area.province}` : area.province || "Municipio";
}

function renderOfficial() {
  elements.officialStatus.textContent = state.official?.scope === "provincia" ? "Provincia" : "Municipio";
  const metrics = currentOfficialMetrics();
  if (!metrics.length) {
    elements.officialGrid.innerHTML = `<div class="empty-state">Sin filas oficiales para esta zona. Se intentara usar provincia cuando el municipio no exista en el balance.</div>`;
    return;
  }
  elements.officialGrid.innerHTML = metrics
    .map((metric) => {
      const variation = findVariation(metric.type);
      return `
        <article class="kpi-card">
          <span>${escapeHtml(cleanMetricName(metric.type))}</span>
          <strong>${formatNumber(metric.value)}</strong>
          <small>${escapeHtml(metric.period || "periodo oficial")}${variation ? ` · var. ${formatNumber(variation.value, 1)}%` : ""}</small>
        </article>`;
    })
    .join("");
}

function renderOfficialError(error) {
  setStep("official", "error");
  elements.officialStatus.textContent = "Error";
  elements.officialGrid.innerHTML = `<div class="empty-state">No se pudo cargar el balance oficial: ${escapeHtml(error.message)}</div>`;
}

function renderOccupation() {
  const payload = state.occupation;
  const context = payload?.context;
  const housing = payload?.housingContext;
  if (!context) {
    elements.occupationStatus.textContent = "Sin datos";
    elements.occupationGrid.innerHTML = `<div class="empty-state">No hay contexto oficial suficiente para esta zona.</div>`;
    return;
  }
  elements.occupationStatus.textContent = context.label;
  const latest = context.latestKnown;
  const detention = context.latestDetentions;
  elements.occupationGrid.innerHTML = `
    <article class="occupation-score">
      <span>Indice contextual</span>
      <strong>${formatNumber(context.score)}</strong>
      <small>${escapeHtml(context.precision)}</small>
    </article>
    <div class="mini-kpi-grid">
      <article><span>Hechos provincia</span><strong>${formatNumber(latest?.value)}</strong><small>${latest?.year || "s/d"}</small></article>
      <article><span>Variacion anual</span><strong>${context.knownTrendPct === null ? "s/d" : `${context.knownTrendPct > 0 ? "+" : ""}${formatNumber(context.knownTrendPct, 1)}%`}</strong><small>vs año anterior</small></article>
      <article><span>Detenciones/invest.</span><strong>${formatNumber(detention?.value)}</strong><small>${detention?.year || "s/d"}</small></article>
      <article><span>Vivienda vacia</span><strong>${housing?.emptyRate === null || housing?.emptyRate === undefined ? "s/d" : `${formatNumber(housing.emptyRate, 1)}%`}</strong><small>INE ${housing?.year || ""}</small></article>
    </div>
    <p class="panel-note">Dato provincial anual de Interior combinado con parque residencial municipal INE. No predice una direccion concreta.</p>`;
}

function renderOccupationError(error) {
  setStep("occupation", "error");
  elements.occupationStatus.textContent = "Error";
  elements.occupationGrid.innerHTML = `<div class="empty-state">No se pudo cargar ocupacion/vivienda: ${escapeHtml(error.message)}</div>`;
  renderSeller();
}

function renderMarket() {
  const market = state.market;
  if (!market) return;
  elements.toggleMarket.textContent = state.expandedMarket ? "Reducir" : (market.localDominanceAvailable ? "Local" : "Nacional");
  const indicators = (market.indicators || []).slice(0, 4);
  const competitors = market.competitors || [];
  elements.marketGrid.innerHTML = `
    <div class="market-warning">${escapeHtml(market.disclaimer || "")}</div>
    <div class="market-kpis">
      ${indicators
        .map(
          (item) => `
          <article>
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.source)}</small>
          </article>`
        )
        .join("")}
    </div>
    <div class="competitor-list ${state.expandedMarket ? "expanded" : "collapsed"}">
      ${competitors
        .map(
          (item) => `
          <article>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.position)}</span>
            <p>${escapeHtml(item.evidence)}</p>
            <small>${escapeHtml(item.confidence)}</small>
          </article>`
        )
        .join("")}
    </div>`;
}

function renderSeller() {
  if (!elements.sellerGrid) return;
  const areaName = state.area?.municipality || state.area?.place || "la zona";
  const official = currentOfficialMetrics();
  const home = official.find((metric) => normalize(metric.type).includes("domicilios"));
  const force = official.find((metric) => normalize(metric.type).includes("establecimientos"));
  const occ = state.occupation?.context;
  const housing = state.occupation?.housingContext;
  const newsCount = state.news.length;
  const homeTrend = latestTrendFor("homeRobbery");
  const cards = [
    {
      kind: "Dato verificable",
      title: home ? `${formatNumber(home.value)} robos en domicilios` : "Robos en domicilio pendientes",
      text: home
        ? `Balance oficial del Ministerio para ${areaName}. Util para abrir conversacion con propietarios sin depender de titulares.`
        : "Esperando balance oficial para completar el dato principal.",
      tone: "blue"
    },
    {
      kind: "Oportunidad",
      title: force ? `${formatNumber(force.value)} robos en domicilios + locales` : "Hogar y negocio",
      text: force
        ? "Permite adaptar el discurso a vivienda, comercio o local si el cliente no encaja en residencial puro."
        : "Cuando cargue el balance se mostrara la señal mixta de vivienda y negocio.",
      tone: "green"
    },
    {
      kind: "Contexto ocupacion",
      title: occ ? `${occ.label} (${formatNumber(occ.score)})` : "Contexto pendiente",
      text: occ
        ? `Interior publica datos provinciales; INE aporta vivienda municipal. Enfoque correcto: prevencion y control temprano, no alarma social.`
        : "Se cargara el indice contextual con Interior e INE.",
      tone: "amber"
    },
    {
      kind: "Pregunta util",
      title: housing?.emptyRate ? `Vivienda vacia: ${formatNumber(housing.emptyRate, 1)}%` : "Validar uso del inmueble",
      text: housing?.emptyRate
        ? "Pregunta: cuando la vivienda queda vacia o sin uso, ¿quien recibe avisos y cuanto tarda en enterarse?"
        : "Pregunta: ¿la vivienda o local queda solo durante vacaciones, turnos o fines de semana?",
      tone: "violet"
    },
    {
      kind: "Señal reciente",
      title: `${newsCount} noticias filtradas`,
      text: newsCount
        ? "Usalas como contexto, no como prueba estadistica. Selecciona una para ver fuente, fecha y tipo detectado."
        : "Sin noticias recientes filtradas; apoya la conversacion en estadistica oficial.",
      tone: "blue"
    },
    {
      kind: "Tendencia",
      title: homeTrend ? `${homeTrend.label}` : "Tendencia historica",
      text: homeTrend
        ? `Ultimo trimestre vs anterior: ${homeTrend.delta > 0 ? "+" : ""}${formatNumber(homeTrend.delta)}.`
        : "Se calcula cuando el historico trimestral termina de cargar.",
      tone: homeTrend?.delta > 0 ? "amber" : "green"
    }
  ];
  elements.sellerStatus.textContent = state.area ? "Consultivo" : "Esperando";
  elements.sellerGrid.innerHTML = cards
    .map(
      (card) => `
      <article class="seller-card" data-tone="${card.tone}">
        <span>${escapeHtml(card.kind)}</span>
        <strong>${escapeHtml(card.title)}</strong>
        <p>${escapeHtml(card.text)}</p>
      </article>`
    )
    .join("");
}

function latestTrendFor(metricId) {
  const points = getAllMetricPoints(metricId);
  const latest = points.at(-1);
  const previous = points.at(-2);
  if (!latest || !previous) return null;
  const delta = latest.quarterly - previous.quarterly;
  return {
    delta,
    label: `${latest.quarterLabel}: ${formatNumber(latest.quarterly)}`
  };
}

function currentOfficialMetrics() {
  return (state.official?.metrics || [])
    .filter((metric) => normalize(metric.period).includes("enero-marzo") || normalize(metric.period).includes("enero marzo"))
    .filter((metric) => Number.isFinite(Number(metric.value)))
    .slice(0, 6);
}

function findVariation(type) {
  return (state.official?.metrics || []).find((metric) => {
    return normalize(metric.type) === normalize(type) && normalize(metric.period).includes("variacion");
  });
}

function cleanMetricName(value) {
  return String(value || "")
    .replace(/^III\.\s*/i, "")
    .replace(/^\d+(\.\d+)?\.?-?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderMetricControls(metrics) {
  elements.metricControls.innerHTML = metrics
    .map((metric) => `<button type="button" data-metric="${escapeHtml(metric.id)}">${escapeHtml(metric.label)}</button>`)
    .join("");
  setActive(elements.metricControls, "metric", state.metric);
}

function renderHistoryCharts() {
  const points = getMetricPoints();
  const metric = getMetricDef();
  elements.chartTitle.textContent = metric?.label || "Historico";

  if (!points.length) {
    elements.historyStatus.textContent = "Sin serie";
    mainChart.clear();
    elements.comparisonStrip.innerHTML = `<div class="empty-state">No hay serie historica oficial para esta metrica en la zona seleccionada.</div>`;
    return;
  }

  elements.historyStatus.textContent = `${points.length} trimestres`;
  elements.quickSeries.textContent = `${points.length}`;
  const valueKey = state.mode === "cumulative" ? "cumulative" : "quarterly";
  if (state.view === "heatmap") renderHeatmap(points, valueKey, metric);
  else if (state.view === "radar") renderRadar();
  else if (state.view === "annual") renderAnnual(points, metric);
  else if (state.view === "yoy") renderYearComparison(points, valueKey, metric);
  else renderLineOrBar(points, valueKey, metric);
  renderComparisonStrip(points, valueKey);
}

function getMetricPoints(metricId = state.metric) {
  const quarter = state.quarter;
  return (state.history?.series || [])
    .filter((point) => point.metric === metricId)
    .filter((point) => quarter === "all" || String(point.quarter) === quarter)
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

function getAllMetricPoints(metricId = state.metric) {
  return (state.history?.series || [])
    .filter((point) => point.metric === metricId)
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
}

function getMetricDef(metricId = state.metric) {
  return [...(state.history?.metrics || []), ...metricFallbacks].find((metric) => metric.id === metricId);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartPalette() {
  return {
    text: cssVar("--chart-text") || "#dbeafe",
    muted: cssVar("--chart-muted") || "#a8b3c7",
    grid: cssVar("--chart-grid") || "rgba(148,163,184,.15)",
    border: cssVar("--chart-border") || "#27364d",
    tooltip: cssVar("--chart-tooltip") || "#07111f",
    cyan: cssVar("--cyan") || "#22d3ee",
    green: cssVar("--green") || "#34d399",
    amber: cssVar("--amber") || "#f59e0b"
  };
}

function baseChartOption(title) {
  const palette = chartPalette();
  return {
    backgroundColor: "transparent",
    textStyle: { color: palette.text, fontFamily: "Inter, system-ui, sans-serif" },
    tooltip: { trigger: "axis", backgroundColor: palette.tooltip, borderColor: palette.border, textStyle: { color: palette.text } },
    grid: { left: 44, right: 24, top: 38, bottom: 42 },
    title: { text: title, left: 8, top: 0, textStyle: { color: palette.text, fontSize: 13, fontWeight: 700 } },
    xAxis: { axisLine: { lineStyle: { color: palette.border } }, axisLabel: { color: palette.muted } },
    yAxis: { axisLine: { lineStyle: { color: palette.border } }, splitLine: { lineStyle: { color: palette.grid } }, axisLabel: { color: palette.muted } }
  };
}

function renderLineOrBar(points, valueKey, metric) {
  const option = baseChartOption(state.mode === "cumulative" ? "Acumulado oficial" : "Trimestre real estimado");
  option.tooltip.formatter = (items) => {
    const item = items[0];
    const point = points[item.dataIndex];
    return `<strong>${point.quarterLabel}</strong><br>${escapeHtml(metric.label)}: ${formatNumber(item.value)}<br>${escapeHtml(point.officialPeriod || "")}`;
  };
  option.xAxis = { ...option.xAxis, type: "category", data: points.map((point) => point.quarterLabel) };
  option.yAxis = { ...option.yAxis, type: "value" };
  option.series = [
    {
      type: state.view === "bar" ? "bar" : "line",
      data: points.map((point) => point[valueKey]),
      smooth: state.view === "line",
      symbolSize: 7,
      barMaxWidth: 24,
      itemStyle: { color: chartPalette().cyan },
      lineStyle: { width: 3, color: chartPalette().cyan },
      areaStyle: state.view === "line" ? { color: cssVar("--chart-area") || "rgba(34,211,238,.12)" } : undefined
    }
  ];
  mainChart.setOption(option, true);
}

function renderYearComparison(points, valueKey, metric) {
  const latestQuarter = state.quarter === "all" ? points.at(-1)?.quarter || 1 : Number(state.quarter);
  const comparable = getAllMetricPoints().filter((point) => point.quarter === latestQuarter);
  const option = baseChartOption(`Comparativa T${latestQuarter} por año`);
  option.tooltip.trigger = "axis";
  option.xAxis = { ...option.xAxis, type: "category", data: comparable.map((point) => String(point.year)) };
  option.yAxis = { ...option.yAxis, type: "value" };
  option.series = [
    {
      name: metric.label,
      type: "bar",
      data: comparable.map((point) => point[valueKey]),
      barMaxWidth: 34,
      itemStyle: { color: chartPalette().green, borderRadius: [4, 4, 0, 0] }
    }
  ];
  mainChart.setOption(option, true);
}

function renderAnnual(points, metric) {
  const annual = getAllMetricPoints()
    .filter((point) => point.quarter === 4)
    .map((point) => ({ ...point, annual: point.cumulative }));
  const option = baseChartOption("Cierre anual oficial usando T4");
  option.tooltip.formatter = (items) => {
    const item = items[0];
    const point = annual[item.dataIndex];
    return `<strong>${point.year}</strong><br>${escapeHtml(metric.label)}: ${formatNumber(item.value)}<br>T4 acumulado oficial`;
  };
  option.xAxis = { ...option.xAxis, type: "category", data: annual.map((point) => String(point.year)) };
  option.yAxis = { ...option.yAxis, type: "value" };
  option.series = [
    {
      name: metric.label,
      type: "bar",
      data: annual.map((point) => point.annual),
      barMaxWidth: 34,
      itemStyle: { color: chartPalette().amber, borderRadius: [5, 5, 0, 0] }
    }
  ];
  mainChart.setOption(option, true);
}

function renderHeatmap(points, valueKey) {
  const palette = chartPalette();
  const years = [...new Set(points.map((point) => point.year))];
  const quarters = ["T1", "T2", "T3", "T4"];
  const data = points.map((point) => [point.quarter - 1, years.indexOf(point.year), point[valueKey] || 0]);
  const max = Math.max(1, ...data.map((item) => item[2]));
  mainChart.setOption(
    {
      backgroundColor: "transparent",
      textStyle: { color: palette.text, fontFamily: "Inter, system-ui, sans-serif" },
      tooltip: { backgroundColor: palette.tooltip, borderColor: palette.border, textStyle: { color: palette.text } },
      grid: { left: 54, right: 28, top: 28, bottom: 44 },
      xAxis: { type: "category", data: quarters, axisLabel: { color: palette.muted }, axisLine: { lineStyle: { color: palette.border } } },
      yAxis: { type: "category", data: years, axisLabel: { color: palette.muted }, axisLine: { lineStyle: { color: palette.border } } },
      visualMap: {
        min: 0,
        max,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        calculable: true,
        textStyle: { color: palette.muted },
        inRange: { color: [cssVar("--heat-low") || "#102033", cssVar("--heat-mid") || "#0e7490", palette.cyan, palette.amber] }
      },
      series: [{ type: "heatmap", data, label: { show: true, color: palette.text, formatter: (item) => formatNumber(item.value[2]) } }]
    },
    true
  );
}

function renderRadar() {
  const palette = chartPalette();
  const metrics = state.history?.metrics || metricFallbacks;
  const indicators = [];
  const values = [];
  for (const metric of metrics) {
    const points = getMetricPoints(metric.id);
    const latest = points.at(-1);
    if (!latest) continue;
    const max = Math.max(1, ...points.map((point) => point[state.mode]));
    indicators.push({ name: metric.label, max });
    values.push(latest[state.mode] || 0);
  }
  mainChart.setOption(
    {
      backgroundColor: "transparent",
      textStyle: { color: palette.text, fontFamily: "Inter, system-ui, sans-serif" },
      tooltip: { backgroundColor: palette.tooltip, borderColor: palette.border, textStyle: { color: palette.text } },
      radar: { indicator: indicators, radius: "66%", axisName: { color: palette.muted }, splitLine: { lineStyle: { color: palette.grid } } },
      series: [{ type: "radar", data: [{ value: values, name: "Ultimo trimestre" }], areaStyle: { color: cssVar("--chart-area") || "rgba(34,211,238,.2)" }, lineStyle: { color: palette.cyan } }]
    },
    true
  );
}

function renderComparisonStrip(points, valueKey) {
  const latest = points.at(-1);
  const previous = points.at(-2);
  const sameQuarterPreviousYear = points.find((point) => point.year === latest.year - 1 && point.quarter === latest.quarter);
  const values = [
    { label: "Ultimo trimestre", value: latest?.[valueKey] },
    { label: "Vs trimestre anterior", value: previous ? latest[valueKey] - previous[valueKey] : null, signed: true },
    { label: "Vs mismo trimestre año previo", value: sameQuarterPreviousYear ? latest[valueKey] - sameQuarterPreviousYear[valueKey] : null, signed: true },
    { label: "Maximo serie", value: Math.max(...points.map((point) => point[valueKey] || 0)) }
  ];
  elements.comparisonStrip.innerHTML = values
    .map((item) => `
      <article class="comparison-card">
        <span>${item.label}</span>
        <strong>${item.signed && Number(item.value) > 0 ? "+" : ""}${formatNumber(item.value)}</strong>
      </article>`)
    .join("");
}

function renderHistoryError(error) {
  setStep("history", "error");
  elements.historyStatus.textContent = "Error";
  mainChart.clear();
  elements.comparisonStrip.innerHTML = `<div class="empty-state">No se pudo cargar el historico trimestral: ${escapeHtml(error.message)}</div>`;
}

function renderNews(payload = {}) {
  elements.newsStatus.textContent = state.news.length ? `${state.news.length} fuentes` : "Sin fuentes";
  elements.quickNews.textContent = String(state.news.length || 0);
  if (!state.news.length) {
    elements.newsList.innerHTML = `
      <div class="empty-state">
        No se encontraron noticias recientes filtradas a robos en vivienda, comercio o local.
        ${payload.queryUrl ? `<a href="${escapeHtml(payload.queryUrl)}" target="_blank" rel="noreferrer">Abrir busqueda fuente</a>` : ""}
      </div>`;
    renderSelectedNews(null);
    return;
  }

  elements.newsList.innerHTML = state.news
    .map((article, index) => {
      const tag = classifyArticle(article);
      return `
        <button type="button" class="news-item" data-news-index="${index}">
          ${article.image ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="news-thumb">${escapeHtml(tag)}</span>`}
          <div>
            <span>${escapeHtml(tag)}</span>
            <strong>${escapeHtml(article.title)}</strong>
            <small>${escapeHtml(article.source || "fuente")} · ${formatDate(article.date)}</small>
          </div>
        </button>`;
    })
    .join("");

  elements.newsList.querySelectorAll("[data-news-index]").forEach((button) => {
    button.addEventListener("click", () => selectArticle(Number(button.dataset.newsIndex)));
  });
  renderSelectedNews(null);
}

function renderNewsError(error) {
  setStep("news", "error");
  elements.newsStatus.textContent = "Error";
  elements.newsList.innerHTML = `<div class="empty-state">No se pudo rastrear noticias: ${escapeHtml(error.message)}</div>`;
}

function classifyArticle(article) {
  const text = normalize(`${article?.title} ${article?.snippet}`);
  if (text.includes("inhibidor")) return "inhibidor";
  if (text.includes("alunizaje")) return "alunizaje";
  if (text.includes("comercio") || text.includes("local") || text.includes("tienda") || text.includes("bar") || text.includes("nave")) return "negocio";
  if (text.includes("chalet") || text.includes("vivienda") || text.includes("domicilio")) return "vivienda";
  return "robo";
}

function selectArticle(index) {
  state.selectedArticleIndex = index;
  renderSelectedNews(state.news[index]);
  updateMap();
}

function renderSelectedNews(article) {
  if (!article) {
    elements.selectedStatus.textContent = "Mapa";
    elements.selectedNews.innerHTML = `<div class="empty-state">Selecciona una noticia en el mapa o en la lista para ver fuente, fecha, tipo detectado y enlace original.</div>`;
    return;
  }
  const tag = classifyArticle(article);
  const hasInhibitor = normalize(`${article.title} ${article.snippet}`).includes("inhibidor");
  elements.selectedStatus.textContent = tag;
  elements.selectedNews.innerHTML = `
    <article class="selected-card">
      ${article.image ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
      <span>${escapeHtml(tag)}</span>
      <h3>${escapeHtml(article.title)}</h3>
      <p>${escapeHtml(article.snippet || "Sin entradilla disponible en la fuente indexada.")}</p>
      <dl>
        <dt>Fuente</dt><dd>${escapeHtml(article.source || "No indicada")}</dd>
        <dt>Fecha</dt><dd>${formatDate(article.date)}</dd>
        <dt>Inhibidor</dt><dd>${hasInhibitor ? "Mencionado" : "No mencionado"}</dd>
      </dl>
      <a href="${escapeHtml(article.url || "#")}" target="_blank" rel="noreferrer">Abrir fuente original</a>
    </article>`;
}

function updateMap() {
  if (!map || !state.area) return;
  markerGroup.clearLayers();
  const lat = Number.isFinite(state.area.lat) ? state.area.lat : 40.4168;
  const lng = Number.isFinite(state.area.lng) ? state.area.lng : -3.7038;
  map.setView([lat, lng], state.area.postalCode ? 13 : 11);
  L.marker([lat, lng]).addTo(markerGroup).bindPopup(escapeHtml(state.area.municipality || state.area.place || "Zona"));

  state.news.forEach((article, index) => {
    const offset = 0.01 + index * 0.0025;
    const point = [lat + Math.sin(index + 1) * offset, lng + Math.cos(index + 1) * offset];
    const marker = L.circleMarker(point, {
      radius: state.selectedArticleIndex === index ? 9 : 6,
      color: state.selectedArticleIndex === index ? "#f59e0b" : "#22d3ee",
      fillColor: state.selectedArticleIndex === index ? "#f59e0b" : "#22d3ee",
      fillOpacity: 0.8,
      weight: 2
    }).addTo(markerGroup);
    marker.bindPopup(`<strong>${escapeHtml(article.title)}</strong><br>${escapeHtml(article.source || "")}`);
    marker.on("click", () => selectArticle(index));
  });
  setTimeout(() => map.invalidateSize(), 80);
}

function calculateScore() {
  const official = currentOfficialMetrics();
  const home = official.find((metric) => normalize(metric.type).includes("domicilios"))?.value || 0;
  const total = official.find((metric) => normalize(metric.type).includes("total infracciones"))?.value || 0;
  const historyPoints = getMetricPoints("homeRobbery");
  const latest = historyPoints.at(-1)?.quarterly || home;
  const previous = historyPoints.at(-2)?.quarterly || latest;
  const trend = latest > previous ? 8 : 0;
  const score = Math.max(20, Math.min(96, Math.round(24 + Math.log10(total + 1) * 14 + Math.log10(home + 1) * 18 + Math.min(state.news.length * 4, 16) + trend)));
  const label = score >= 76 ? "Actividad alta" : score >= 56 ? "Actividad media" : "Actividad contenida";
  return { score, label };
}

function renderScore() {
  if (!state.official && !state.news.length) return;
  const score = calculateScore();
  elements.scoreValue.textContent = score.score;
  elements.scoreText.textContent = `${score.label}. Indice interno basado en balance oficial, tendencia trimestral y noticias verificadas.`;
}

function renderSources(newsPayload = null) {
  const sources = [];
  if (state.area?.source) sources.push({ label: state.area.source.name || "Geocodificacion", url: state.area.source.url });
  if (state.official?.sources) sources.push(...state.official.sources.map((source) => ({ label: source.name || source.label, url: source.url })));
  if (state.history?.sources?.length) {
    sources.push({
      label: `Balance historico Ministerio Interior (${state.history.sources.length} trimestres)`,
      url: state.history.sources.at(-1)?.url
    });
  }
  if (state.occupation?.sources?.length) {
    sources.push(...state.occupation.sources.map((source) => ({ label: source.name || source.label, url: source.url })));
  }
  if (state.market?.indicators) {
    for (const item of state.market.indicators) sources.push({ label: item.source || item.label, url: item.url });
    for (const competitor of state.market.competitors || []) {
      for (const source of competitor.sources || []) sources.push({ label: source.label, url: source.url });
    }
  }
  if (newsPayload?.queryUrl) sources.push({ label: newsPayload.source || "Noticias", url: newsPayload.queryUrl });
  const unique = [];
  const seen = new Set();
  for (const source of sources) {
    const key = `${source.label}|${source.url}`;
    if (!source.label || seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  elements.toggleSources.textContent = state.expandedSources ? "Reducir" : `Ver ${Math.max(0, unique.length - 3)} más`;
  const visibleSources = state.expandedSources ? unique : unique.slice(0, 3);
  elements.sourceList.innerHTML = unique.length
    ? visibleSources
        .map((source) => `<a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noreferrer"><strong>${escapeHtml(source.label)}</strong><span>${escapeHtml(source.url || "fuente local")}</span></a>`)
        .join("")
    : `<div class="empty-state">Sin fuentes cargadas todavia.</div>`;
}

async function saveSession() {
  if (!state.area || (!state.official && !state.history && !state.news.length)) return;
  const score = calculateScore();
  const payload = {
    query: state.query,
    area: state.area,
    scope: state.history?.scope || state.official?.scope || "",
    score: score.score,
    kpis: Object.fromEntries(currentOfficialMetrics().slice(0, 4).map((metric) => [cleanMetricName(metric.type), metric.value])),
    occupationScore: state.occupation?.context?.score ?? null,
    newsCount: state.news.length,
    sourcesCount: document.querySelectorAll("#sourceList a").length
  };
  try {
    const response = await fetchJson("/api/history-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.historyEntries = response.entries || [];
    renderHistoryLog();
  } catch {
    // Local history should not block the working report.
  }
}

async function loadHistoryLog() {
  try {
    const payload = await fetchJson("/api/history-log");
    state.historyEntries = payload.entries || [];
    renderHistoryLog();
  } catch {
    elements.historyList.innerHTML = `<div class="empty-state">Historial local no disponible.</div>`;
  }
}

function renderHistoryLog() {
  if (!state.historyEntries.length) {
    elements.historyList.innerHTML = `<div class="empty-state">Tus busquedas quedaran guardadas en esta maquina.</div>`;
    return;
  }
  elements.historyList.innerHTML = state.historyEntries
    .slice(0, 12)
    .map((entry) => {
      const area = entry.area || {};
      const label = area.postalCode ? `${area.postalCode} · ${area.municipality}` : area.municipality || entry.query;
      const date = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(entry.createdAt));
      return `
        <button type="button" class="history-item" data-query="${escapeHtml(entry.query || label)}">
          <strong>${escapeHtml(label)}</strong>
          <small>${date} · score ${entry.score ?? "--"} · ${entry.newsCount || 0} noticias</small>
        </button>`;
    })
    .join("");
  elements.historyList.querySelectorAll("[data-query]").forEach((button) => {
    button.addEventListener("click", () => runSearch(button.dataset.query));
  });
}

document.addEventListener("DOMContentLoaded", init);
