const status = document.getElementById("chart-status");
const chart = document.getElementById("forecast-chart");
const smallScreen = window.matchMedia("(max-width: 600px)");
const touchScreen = window.matchMedia("(pointer: coarse)");
const touchView = () => smallScreen.matches || touchScreen.matches;
const columns = ["q10", "q50", "q90"];
const county = new URLSearchParams(location.search).get("county");
if (/^41\d{3}$/.test(county ?? "")) {
  document.querySelector(".back-link").href = `../index.html#county=${county}`;
}

async function loadForecast() {
  const [csvResponse, metadata, edCsv] = await Promise.all([
    fetch("forecast.csv", { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error("Forecast CSV could not be loaded");
      return response;
    }),
    fetch("forecast.json", { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error("Forecast metadata could not be loaded");
      return response.json();
    }),
    fetch("../ed_visits.csv", { cache: "no-store" }).then(response => response.text())
  ]);
  const csvText = await csvResponse.text();
  const [header, ...lines] = csvText.trim().split(/\r?\n/);
  const headers = header.split(",");
  if (headers[0] !== "date" || columns.some(column => !headers.includes(column))) {
    throw new Error("Forecast CSV must contain date, q10, q50, and q90 columns");
  }
  const rows = lines.map(line => {
    const values = line.split(",");
    const row = { date: values[0] };
    columns.forEach(column => { row[column] = Number(values[headers.indexOf(column)]); });
    return row;
  });
  // The chart displays proportions as percentages, including older exports.
  const displayMultiplier = 100;
  const displayUnits = "Percent of ED visits";
  const displayValue = value => (value * displayMultiplier).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  if (!rows.length || !Number.isFinite(displayMultiplier) || !displayUnits || !metadata.quantity ||
      rows.some(row => !Number.isFinite(Date.parse(row.date)) || columns.some(column => !Number.isFinite(row[column])))) {
    throw new Error("Forecast data or display metadata are invalid");
  }
  const quantity = metadata.quantity.charAt(0).toUpperCase() + metadata.quantity.slice(1);
  const plotLabel = "ED visits<br>due to flu";
  const escapeText = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  document.getElementById("chart-heading").textContent = `${quantity} forecast`;
  chart.setAttribute("aria-label", `${quantity}, shown as ${displayUnits}, with a median and an 80% envelope. The solid line marks when this page was issued.`);
  const forecastDate = document.getElementById("forecast-date");
  const issuedAt = typeof metadata.issued_at === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(metadata.issued_at)
    ? new Date(metadata.issued_at) : null;
  const hasIssuedAt = issuedAt && Number.isFinite(issuedAt.getTime());
  const issueTimeZone = "America/Los_Angeles";
  forecastDate.textContent = hasIssuedAt
    ? `ISSUED ${issuedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: issueTimeZone }).toUpperCase()} ${issuedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: issueTimeZone, timeZoneName: "short" })}`
    : "";
  const issueParts = hasIssuedAt ? new Intl.DateTimeFormat("en-US", {
    timeZone: issueTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(issuedAt) : [];
  const issuePart = type => issueParts.find(part => part.type === type)?.value;
  const issuePosition = hasIssuedAt
    ? `${issuePart("year")}-${issuePart("month")}-${issuePart("day")} ${issuePart("hour")}:${issuePart("minute")}:${issuePart("second")}`
    : null;
  document.title = `${metadata.city} · Influenza forecast`;
  document.getElementById("city-name").textContent = metadata.city;
  const seasonYear = Number(metadata.forecast_origin.slice(0, 4)) - (metadata.forecast_origin.slice(5, 7) < "09" ? 1 : 0);
  const historyStart = `${seasonYear}-09-01`;
  const visibleRows = rows.filter(row => row.date >= historyStart);
  const fullRange = [visibleRows[0].date, visibleRows[visibleRows.length - 1].date];
  const edHistory = edCsv.trim().split(/\r?\n/).slice(1).map(line => {
    const [date, , value] = line.split(",");
    return { date, value: Number(value) * displayMultiplier };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const edRows = edHistory.filter(row => row.date >= fullRange[0] && row.date <= fullRange[1]);
  const edLastYear = edHistory.map(row => ({
    date: `${Number(row.date.slice(0, 4)) + 1}${row.date.slice(4)}`,
    observedDate: row.date, value: row.value
  })).filter(row => row.date >= fullRange[0] && row.date <= fullRange[1]);
  const x = visibleRows.map(row => row.date);
  const trace = (column, extra) => ({
    type: "scatter", mode: "lines", x, y: visibleRows.map(row => row[column] * displayMultiplier),
    line: { width: 0 }, showlegend: false, hoverinfo: "skip", ...extra
  });
  const traces = [
    trace("q10"), trace("q90", { fill: "tonexty", fillcolor: "rgba(150,160,170,0.24)" }),
    trace("q50", {
      line: { color: "#cfd3d8", width: 2.2 }, name: `Median ${metadata.quantity}`, hoverinfo: "all",
      customdata: visibleRows.map(row => [displayValue(row.q50), `${displayValue(row.q10)}–${displayValue(row.q90)}`,
        row.date <= metadata.forecast_origin ? "Historical model estimate" : "Forecast"]),
      hovertemplate: `%{x|%b %d, %Y}<br>%{customdata[2]}<br>${escapeText(displayUnits)}<br>Median: %{customdata[0]}<br>80% envelope: %{customdata[1]}<extra></extra>`
    }),
    { type: "scatter", mode: "lines", x: edLastYear.map(row => row.date), y: edLastYear.map(row => row.value),
      line: { color: "#c65b5b", width: 2 }, showlegend: false,
      customdata: edLastYear.map(row => row.observedDate),
      hovertemplate: "%{customdata}<br>Statewide last year<br>ED visits due to flu: %{y:.1f}%<extra></extra>" },
    { type: "scatter", mode: "lines", x: edRows.map(row => row.date), y: edRows.map(row => row.value),
      line: { color: "#5aa7ff", width: 2 }, showlegend: false,
      hovertemplate: "%{x|%b %d, %Y}<br>Oregon ED visits due to flu: %{y:.1f}%<extra></extra>" }
  ];
  const yMax = Math.max(1, ...traces.flatMap(trace => trace.y));
  const layout = {
    autosize: true, margin: { l: 42, r: 15, t: 46, b: 35 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", color: "#aeb3b9", size: 11 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", hovermode: "closest", dragmode: false,
    hoverlabel: { bgcolor: "#171a20", bordercolor: "#58606a", font: { color: "#e8e8e6", size: 11 } },
    xaxis: { type: "date", range: fullRange, showgrid: false, zeroline: false,
      dtick: "M1", tickformat: "%b", tickangle: 0, fixedrange: true },
    yaxis: { tickformat: ",.1f", ticksuffix: "%", range: [-yMax * 0.04, yMax * 1.05], tick0: 0, nticks: 8,
      gridcolor: "rgba(255,255,255,.10)", zerolinecolor: "rgba(255,255,255,.10)", fixedrange: true },
    shapes: [
      { type: "line", xref: "x", yref: "paper", x0: issuePosition, x1: issuePosition,
        y0: 0, y1: 1, visible: Boolean(hasIssuedAt), line: { color: "rgba(255,255,255,.45)", width: 1.25 } }
    ],
    annotations: [
      { xref: "paper", yref: "paper", x: .025, y: .88, xanchor: "left", yanchor: "top",
        align: "left", text: plotLabel, showarrow: false, font: { size: 18, color: "#d8d9dc" } }
    ]
  };
  const config = () => ({
    responsive: true, displayModeBar: false, scrollZoom: false,
    staticPlot: touchView(), showTips: false
  });
  await Plotly.newPlot(chart, traces, layout, config());
  const redraw = () => Plotly.react(
    chart, chart.data, chart.layout, config()
  );
  smallScreen.addEventListener("change", redraw);
  touchScreen.addEventListener("change", redraw);
  status.textContent = "";
}

loadForecast().catch(error => {
  console.error("Unable to display forecast:", error);
  status.textContent = "The forecast chart could not be loaded. Please try reloading.";
});
