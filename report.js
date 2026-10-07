/* Redrawing the Map — interactive edition. Chart cards ("graphers") with Chart / Map / Table views,
   indicator selectors, "Learn more about this data", download, share and full-screen. */
(function () {
  'use strict';
  var D = window.REPORT_DATA;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var fmt = function (v, d) { if (v == null || !isFinite(v)) return '–'; return Number(v).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var fmtUS = function (v, d) { if (v == null || !isFinite(v)) return '–'; return Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* ---------- theme ---------- */
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true; if (t === 'light') return false;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function T() {
    var cs = getComputedStyle(document.documentElement), g = function (n) { return cs.getPropertyValue(n).trim(); };
    return { ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'), rule: g('--rule'), surface: g('--surface'), accent: g('--accent'),
      soft: g('--accent-soft'), cool: g('--cool'), ochre: g('--ochre'), nm: g('--neutral-mark'), sunk: g('--sunk'),
      seq: isDark() ? [[0, '#3a2a2e'], [0.25, '#6a2f3d'], [0.5, '#9c3f55'], [0.75, '#cf6a80'], [1, '#f6b9c6']]
                    : [[0, '#f7e8eb'], [0.25, '#e7b4bf'], [0.5, '#cc7488'], [0.75, '#a53a52'], [1, '#6e1222']] };
  }
  var NARROW = window.innerWidth < 640;
  function layout(extra) {
    var t = T();
    var base = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: '"Source Sans 3","Segoe UI",system-ui,sans-serif', size: 13, color: t.ink2 },
      margin: { l: 56, r: 18, t: 16, b: 52 },
      hoverlabel: { bgcolor: t.surface, bordercolor: t.rule, font: { color: t.ink, size: 13 } },
      xaxis: { gridcolor: t.rule, zeroline: false, linecolor: t.rule, tickcolor: t.rule, ticks: 'outside', ticklen: 4, title: { font: { size: 13, color: t.muted } }, fixedrange: true },
      yaxis: { gridcolor: t.rule, griddash: 'dot', zeroline: false, linecolor: 'rgba(0,0,0,0)', title: { font: { size: 13, color: t.muted } }, fixedrange: true },
      showlegend: false, dragmode: false
    };
    var L = deepMerge(base, extra || {});
    if (NARROW) {
      L.font.size = 12;
      if (L.margin && L.margin.l > 100) { L.margin.l = 100; L.yaxis = L.yaxis || {}; L.yaxis.automargin = true; L.yaxis.tickfont = deepMerge(L.yaxis.tickfont || {}, { size: 11 }); }
    }
    return L;
  }
  function deepMerge(a, b) { for (var k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
  var PCONF = { displayModeBar: false, responsive: true };

  /* ---------- self-contained maps ----------
     Plotly's choropleth fetches a base-map file from cdn.plot.ly at runtime, which locked-down hosts block.
     Maps are therefore drawn as filled polygons on plain x/y axes from our own GeoJSON (no network needed). */
  function hexRgb(c) {
    if (c.indexOf('rgb') === 0) { var m = c.match(/[\d.]+/g); return [+m[0], +m[1], +m[2]]; }
    var h = c.replace('#', ''); if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function scaleColor(scale, f) {
    f = Math.max(0, Math.min(1, f));
    for (var i = 1; i < scale.length; i++) {
      if (f <= scale[i][0]) {
        var a = scale[i - 1], b = scale[i], u = b[0] === a[0] ? 0 : (f - a[0]) / (b[0] - a[0]), A = hexRgb(a[1]), B = hexRgb(b[1]);
        return 'rgb(' + [0, 1, 2].map(function (k) { return Math.round(A[k] + u * (B[k] - A[k])); }).join(',') + ')';
      }
    }
    return scale[scale.length - 1][1];
  }
  function fmtHover(tpl, ctx) {
    return tpl.replace('<extra></extra>', '').replace(/%\{([a-z]+)(?:\[(\d+)\])?(?::([^}]*))?\}/g, function (_, k, idx, f) {
      var v = ctx[k]; if (idx != null && v) v = v[+idx];
      if (v == null) return '';
      if (typeof v === 'number') {
        var dm = f && f.match(/\.(\d+)f/), dg = dm ? +dm[1] : 0;
        return f && f.indexOf(',') > -1 ? fmtUS(v, dg) : (dm ? v.toFixed(dg) : String(v));
      }
      return String(v);
    });
  }
  function ringsXY(geom) {
    var xs = [], ys = [], polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    polys.forEach(function (p) { p.forEach(function (ring) { ring.forEach(function (pt) { xs.push(pt[0]); ys.push(pt[1]); }); xs.push(null); ys.push(null); }); });
    return [xs, ys];
  }
  function convertGeo(traces, lay) {
    if (!traces.some(function (t) { return t.type === 'choropleth'; })) return [traces, lay];
    var out = [], latSum = 0, latN = 0;
    traces.forEach(function (c) {
      if (c.type === 'scattergeo') { out.push({ type: 'scatter', x: [null], y: [null], mode: c.mode, marker: c.marker, name: c.name, showlegend: c.showlegend, hoverinfo: 'skip' }); return; }
      if (c.type !== 'choropleth') { out.push(c); return; }
      var byId = {}; c.geojson.features.forEach(function (f) { byId[f.id] = f; });
      var zs = c.z.filter(function (z) { return z != null && isFinite(z); });
      var zmin = c.zmin != null ? c.zmin : Math.min.apply(null, zs), zmax = c.zmax != null ? c.zmax : Math.max.apply(null, zs);
      var line = (c.marker && c.marker.line) || {};
      c.locations.forEach(function (loc, i) {
        var f = byId[loc]; if (!f) return;
        var xy = ringsXY(f.geometry), z = c.z[i];
        xy[1].forEach(function (y) { if (y != null) { latSum += y; latN++; } });
        var txt = fmtHover(c.hovertemplate || '%{location}', { location: loc, z: z, text: c.text ? c.text[i] : null, customdata: c.customdata ? c.customdata[i] : null });
        out.push({ type: 'scatter', mode: 'lines', x: xy[0], y: xy[1], fill: 'toself', fillcolor: scaleColor(c.colorscale, (z - zmin) / ((zmax - zmin) || 1)),
          line: { color: line.color || '#fff', width: line.width != null ? line.width : 0.8 }, hoveron: 'fills', text: txt, hoverinfo: 'text', showlegend: false });
      });
      if (c.showscale !== false) {
        out.push({ type: 'scatter', x: [null, null], y: [null, null], mode: 'markers', hoverinfo: 'skip', showlegend: false,
          marker: { color: [zmin, zmax], cmin: zmin, cmax: zmax, colorscale: c.colorscale, showscale: true, size: 0.1, colorbar: c.colorbar } });
      }
    });
    var midLat = latN ? latSum / latN : 25.5;
    var L = {}; for (var k in lay) if (k !== 'geo') L[k] = lay[k];
    L.xaxis = { visible: false, fixedrange: true }; L.yaxis = { visible: false, fixedrange: true, scaleanchor: 'x', scaleratio: 1 / Math.cos(midLat * Math.PI / 180) };
    L.hovermode = 'closest';
    return [out, L];
  }
  function alpha(hex, a) {
    if (hex.indexOf('rgb') === 0) return hex;
    var h = hex.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }

  /* ---------- shared metadata ---------- */
  var M_GP = 'GP population and the outcome are each residualised on block (district × sub-district) fixed effects, distance to the nearest statutory town and SC population share, with sample means added back. Line: local-linear fit (Epanechnikov kernel, bandwidth 3,000 people); band: 95% confidence interval. Sample: GPs with 5,000–20,000 people (2011 Census). Slope: regression with block fixed effects and the same controls; standard errors clustered by block.';
  var M_WARD = 'Ward population and the outcome are residualised on block fixed effects and controls, with sample means added back. Line: local-linear fit; band: 95% confidence interval. Survey sample from 10 districts.';
  var RECOMPUTED = 'Curve recomputed for this web edition from GRAMA\'s replication data using the same specification as the report; the regression estimate is identical to the report. The confidence band approximates Stata\'s lpoly standard errors.';
  var SRC_VD = 'Census of India 2011, Village Directory (collapsed to GP); GRAMA GP crosswalk';
  var META = {
    primary_school_pc: { t: 'Primary schools', u: 'per 1,000 people', d: 'Government and private primary schools in the GP\'s villages, per 1,000 residents.', src: SRC_VD, est: '−0.0193 per 1,000 people (SE 0.0013), or −3.1% of the mean (0.61)', n: '7,570 GPs', m: M_GP, dg: 3 },
    middle_school_pc: { t: 'Middle schools', u: 'per 1,000 people', d: 'Government and private middle schools per 1,000 residents.', src: SRC_VD, est: '−0.0117 per 1,000 people (SE 0.0008), or −3.9% of the mean (0.30)', n: '7,570 GPs', m: M_GP, dg: 3 },
    secondary_school_pc: { t: 'Secondary schools', u: 'per 1,000 people', d: 'Government and private secondary schools per 1,000 residents.', src: SRC_VD, est: '−0.0020 per 1,000 people (SE 0.0006), or −2.8% of the mean (0.07)', n: '7,570 GPs', m: M_GP, dg: 3 },
    health_centre_pc: { t: 'Health centres', u: 'per 1,000 people', d: 'Community, primary and sub-health centres plus dispensaries per 1,000 residents.', src: SRC_VD, est: '−0.0087 per 1,000 people (SE 0.0018), or −3.4% of the mean (0.25)', n: '7,570 GPs', m: M_GP, dg: 3 },
    proj_pc: { t: 'Nal Jal + Nali Gali projects', u: 'projects per 1,000 people', d: 'Ward-level Nal Jal (piped water) and Nali Gali (drains and lanes) projects under the Saat Nischay programme, counted per GP, per 1,000 residents.', src: 'PRD Nischaysoft, March 2019; Census 2011', est: '−0.0464 per 1,000 people (SE 0.0046), or −4.9% of the mean', n: '7,505 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    hhd_piped_pc: { t: 'Households with piped water', u: 'per 1,000 people', d: 'Households with a piped-water connection, per 1,000 residents.', src: 'Mission Antyodaya 2019–20; Census 2011', est: '−1.865 per 1,000 people (SE 0.325), or −2.9% of the mean (66)', n: '7,404 GPs', m: M_GP, dg: 1 },
    nrega_pc_pd: { t: 'NREGA persondays', u: 'persondays per person, 2021–24', d: 'Total NREGA persondays generated in the GP over 2021–24, divided by its 2011 population.', src: 'NREGA MIS, 2021–24; Census 2011', est: '−0.397 per 1,000 people (SE 0.028), or −4.8% of the mean; block FE and controls', n: '6,477 GPs', m: 'Curve: unadjusted local-linear fit of persondays per person on GP population (bandwidth 3,000), as in the report figure. The slope comes from a regression with block fixed effects, distance to town and SC share; standard errors clustered by block.', dg: 2 },
    spent_pc: { t: 'Actual GPDP spending per person', u: '₹ per person, 2024–25', d: 'Actual expenditure on every XV Finance Commission work in the 2024–25 Gram Panchayat Development Plan, divided by the GP\'s 2011 population.', src: 'eGramSwaraj (XV Finance Commission works, GPDP 2024–25); Census 2011', est: '−₹8.62 per 1,000 people (SE 0.65), or −3.8% of the mean (₹225.6). Elasticity of total spending to population: 0.59', n: '7,238 GPs', m: M_GP + ' Dots: means of residualised spending in 750-person bins.', note: RECOMPUTED, dg: 0 },
    domestic_power_hours: { t: 'Domestic power supply', u: 'hours per day', d: 'Average hours of domestic electricity supply per day across the GP\'s villages.', src: SRC_VD, est: '+0.073 hours per 1,000 people (SE 0.023), or +1.1% of the mean (6.45 hours)', n: '7,570 GPs', m: M_GP, dg: 2 },
    major_district_road_share: { t: 'Villages on a major district road', u: 'share of villages', d: 'Share of the GP\'s villages served by a major district road.', src: SRC_VD, est: '+0.0103 per 1,000 people (SE 0.0019), or +2.4% of the mean (0.42)', n: '7,570 GPs', m: M_GP, dg: 3, pct: true },
    mobile_phone_coverage_share: { t: 'Mobile phone coverage', u: 'share of villages', d: 'Share of the GP\'s villages with mobile phone coverage.', src: SRC_VD, est: '+0.0068 per 1,000 people (SE 0.0019), or +1.3% of the mean (0.54)', n: '7,570 GPs', m: M_GP, dg: 3, pct: true },
    muk_edu: { t: 'Mukhiya education', u: 'years of schooling', d: 'Years of schooling of the 2016 Mukhiya winner, imputed from the declared qualification (illiterate 0, literate 3, primary 5, middle 8, matric 10, intermediate 12, graduate and above 15).', src: 'State Election Commission, Mukhiya winners 2016; Census 2011', est: '−0.265 years per 1,000 people (SE 0.028), or −3.3% of the mean', n: '6,494 GPs', m: 'Education is residualised on block fixed effects, SC population share and distance to town, with the mean added back, then smoothed against GP population (local-linear, bandwidth 1,500). GPs with 5,000–20,000 people. Standard errors clustered by block.', note: RECOMPUTED, dg: 2 },
    wm_eduyears: { t: 'Ward member education', u: 'years of schooling', d: 'Years of schooling of the 2016 ward member, imputed from the declared qualification.', src: 'State Election Commission, ward members 2016; ward populations, Census 2011', est: '−0.293 years per 100 people (SE 0.013), or −5.7% of the mean', n: '60,381 wards', m: M_WARD.replace('Survey sample from 10 districts.', 'All wards with candidate data.'), dg: 2, ward: true },
    muk_repr_gap: { t: 'Mukhiya representativeness gap', u: 'standardised (z)', d: 'Standardised education of the Mukhiya\'s father minus the mean standardised father\'s education of citizens in the same GP. Positive values mean the Mukhiya comes from a more educated family than the average voter.', src: 'SECC 2011–12 linked to SEC 2016 candidate data', est: '−0.054 per 1,000 people (SE 0.028)', n: '1,278 GPs (about 19% of GPs have father-education data)', m: 'Gap residualised on block fixed effects, SC share and distance to town, mean added back, smoothed against GP population (bandwidth 1,500). Standard errors clustered by block.', note: RECOMPUTED, dg: 3 },
    wm_net_bdo: { t: 'Ward members who know their BDO', u: 'share with BDO\'s phone number', d: 'Share of surveyed ward members who have their Block Development Officer\'s phone number.', src: 'GRAMA ward member survey, 10 districts, Aug–Oct 2024', est: '−0.0082 per 1,000 people (SE 0.0037), or −1.8% of the mean', n: '1,871 ward members', m: M_GP.replace('Sample: GPs with 5,000–20,000 people (2011 Census).', 'Survey sample, GPs with 5,000–20,000 people.'), dg: 3, pct: true },
    d_hlth_pc: { t: 'Change in health centres', u: 'per 1,000 people, 2001–2011', d: 'Health centres per 1,000 people in 2011 minus the same measure in 2001, on a consistent GP geography.', src: 'Census Village Directories 2001 and 2011', est: '−0.0091 per 1,000 people (SE 0.0019)', n: '7,462 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    d_prim_pc: { t: 'Change in primary schools', u: 'per 1,000 people, 2001–2011', d: 'Primary schools per 1,000 people in 2011 minus 2001.', src: 'Census Village Directories 2001 and 2011', est: '−0.0098 per 1,000 people (SE 0.0014)', n: '7,462 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    d_pg_index: { t: 'Change in public goods index', u: 'z-score, 2001–2011', d: 'Change in the mean of standardised primary, middle, secondary and senior-secondary schools and health centres per 1,000 people, and the shares of villages with paved roads and domestic power.', src: 'Census Village Directories 2001 and 2011', est: '−0.0171 per 1,000 people (SE 0.0028)', n: '7,462 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    ln_gpop: { t: 'Population growth', u: 'log points, 2001–2011', d: 'Log of 2011 population minus log of 2001 population on the same villages.', src: 'Census 2001 and 2011', est: '+0.0186 per 1,000 people (SE 0.0019)', n: '7,462 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    pg_index01: { t: 'Public goods index, 2001', u: 'z-score', d: 'Mean of standardised school and health-centre densities and road and power shares.', src: 'Census Village Directory 2001', est: '−0.0025 per 1,000 people (SE 0.0022), not significant', n: '7,460 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    pg_index11: { t: 'Public goods index, 2011', u: 'z-score', d: 'Mean of standardised school and health-centre densities and road and power shares.', src: 'Census Village Directory 2011', est: '−0.0196 per 1,000 people (SE 0.0023)', n: '7,460 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    hlth01_pc: { t: 'Health centres, 2001', u: 'per 1,000 people', d: 'Health centres per 1,000 people in 2001.', src: 'Census Village Directory 2001', est: '+0.0006 per 1,000 people (SE 0.0008), not significant', n: '7,462 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    hlth11_pc: { t: 'Health centres, 2011', u: 'per 1,000 people', d: 'Health centres per 1,000 people in 2011.', src: 'Census Village Directory 2011', est: '−0.0085 per 1,000 people (SE 0.0018)', n: '7,462 GPs', m: M_GP, note: RECOMPUTED, dg: 3 },
    ward_overlap: { t: 'Ward member–citizen priority overlap', u: 'overlap rate', d: 'Overlap between the development priorities named by the ward member and by citizens of the same ward.', src: 'GRAMA citizen and ward member surveys, 10 districts, 2024–25', est: '+0.0019 per 100 people (SE 0.0075), not significant', n: '3,462 wards', m: M_WARD, dg: 3, ward: true },
    confidence_z_cont: { t: 'Ward member confidence', u: 'index (SD units)', d: 'Standardised index of ward members\' self-reported confidence in their role.', src: 'GRAMA ward member survey, 10 districts, 2024', est: '−0.017 per 100 people (SE 0.013), not significant', n: '4,411 ward members', m: M_WARD, dg: 3, ward: true },
    combined_knowledge_index_z_cont: { t: 'Ward member knowledge', u: 'index (SD units)', d: 'Standardised index of ward members\' knowledge of governance rules and schemes.', src: 'GRAMA ward member survey, 10 districts, 2024', est: '+0.004 per 100 people (SE 0.013), not significant', n: '4,670 ward members', m: M_WARD, dg: 3, ward: true },
    wmsat_index: { t: 'Citizen satisfaction with ward member', u: 'index (SD units)', d: 'Standardised index of citizens\' satisfaction with their ward member.', src: 'GRAMA citizen survey, 10 districts, 2024–25', est: '−0.008 per 100 people (SE 0.009), not significant', n: '7,097 citizens', m: M_WARD, dg: 3, ward: true },
    w_availed: { t: 'Welfare benefits availed', u: 'index (SD units)', d: 'Mean of five standardised indicators: job card, ration card, pension, toilet scheme and Awas housing benefit received.', src: 'GRAMA citizen survey, 10 districts, 2024–25', est: '+0.003 per 100 people (SE 0.010), not significant', n: '4,251 citizens', m: M_WARD + ' Outcome double-residualised as in the report.', dg: 3, ward: true },
    w_appavail: { t: 'Welfare applied and availed', u: 'index (SD units)', d: 'As above, counting both applications and benefits received.', src: 'GRAMA citizen survey, 10 districts, 2024–25', est: '+0.002 per 100 people (SE 0.009), not significant', n: '4,276 citizens', m: M_WARD + ' Outcome double-residualised as in the report.', dg: 3, ward: true },
    gpdp_pc: { t: 'GPDP expenditure (planned)', u: '₹ per person', d: 'Total estimated cost of all works in the GP\'s 2024 Gram Panchayat Development Plan, divided by its 2011 population. These are planned allocations, not money spent (actual spending is in Figure 4).', src: 'eGramSwaraj GPDP 2024; Census 2011', est: '−₹48.81 per 1,000 people (SE 4.03). Elasticity of total GPDP budget to population: 0.43', n: '1,815 GPs with 5,000–20,000 people', m: M_GP, note: RECOMPUTED, dg: 0 },
    align19: { t: 'Spending–preference alignment, all 19 schemes', u: 'within-GP Spearman correlation', d: 'For each GP, the 19 GPDP scheme heads are ranked by estimated GPDP cost and by the share of surveyed citizens who want that scheme from local government. Alignment is the Spearman rank correlation between the two rankings; higher means the GP spends most on what citizens ask for.', src: 'eGramSwaraj GPDP 2024 (19 scheme heads); GRAMA citizen survey, 10 districts', est: '+0.0001 per 1,000 people (SE 0.0023), not significant', n: '1,794 GPs in the 10 survey districts', m: M_GP, note: RECOMPUTED, dg: 3 },
    align5: { t: 'Spending–preference alignment, 5 core schemes', u: 'within-GP Spearman correlation', d: 'As for all 19 schemes, restricted to the five core, high-salience schemes with meaningful preference and cost coverage: Nali Gali, Nal Jal, solar lights, toilets and LSBA.', src: 'eGramSwaraj GPDP 2024; GRAMA citizen survey, 10 districts', est: '+0.0080 per 1,000 people (SE 0.0039)', n: '1,758 GPs in the 10 survey districts', m: M_GP, note: RECOMPUTED, dg: 3 }
  };

  /* ---------- icons ---------- */
  var IC = {
    chart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 13.5h12"/><path d="M3 10l3.5-3.5 2.5 2 4-4.5"/></svg>',
    table: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M2 6.2h12M2 9.8h12M6.5 2.5v11"/></svg>',
    map: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.8 4l4-1.5 4.4 1.5 4-1.5v9.5l-4 1.5-4.4-1.5-4 1.5z"/><path d="M5.8 2.5v9.5M10.2 4v9.5"/></svg>',
    grid: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx=".8"/><rect x="9" y="2" width="5" height="5" rx=".8"/><rect x="2" y="9" width="5" height="5" rx=".8"/><rect x="9" y="9" width="5" height="5" rx=".8"/></svg>',
    dl: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4.8 7l3.2 3.2L11.2 7M2.5 13.5h11"/></svg>',
    share: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="3.5" r="1.8"/><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><path d="M5.6 7.1l4.8-2.7M5.6 8.9l4.8 2.7"/></svg>',
    full: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>'
  };

  /* ---------- toast & clipboard ---------- */
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2200); }
  function copyText(txt, okMsg) {
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta); toast(ok ? okMsg : 'Copying is blocked here. Select the text manually.');
    };
    try { navigator.clipboard.writeText(txt).then(function () { toast(okMsg); }, fallback); } catch (e) { fallback(); }
  }
  function toCSV(rows) { return rows.map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n'); }
  function downloadFile(name, text, type) {
    try { var b = new Blob([text], { type: type || 'text/csv' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast('Download started: ' + name); }
    catch (e) { toast('Downloads are blocked here. Use “Copy data” instead.'); }
  }

  /* ---------- table helper ---------- */
  function tableHTML(head, rows, opts) {
    opts = opts || {};
    var h = '<div class="g-table-wrap"><table class="data"><thead><tr>' + head.map(function (c, i) { return '<th data-sort="' + i + '">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) { h += '<tr' + (opts.hl && opts.hl(r) ? ' class="hl"' : '') + '>' + r.map(function (c) { return '<td>' + (c == null ? '–' : esc(c)) + '</td>'; }).join('') + '</tr>'; });
    return h + '</tbody></table></div>';
  }
  document.addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]'); if (!th) return;
    var tb = th.closest('table').tBodies[0], i = +th.dataset.sort, dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
    th.parentNode.querySelectorAll('th').forEach(function (x) { delete x.dataset.dir; }); th.dataset.dir = dir;
    var num = function (s) { var v = parseFloat(String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-')); return isNaN(v) ? null : v; };
    Array.from(tb.rows).sort(function (a, b) {
      var x = a.cells[i].textContent, y = b.cells[i].textContent, nx = num(x), ny = num(y);
      var c = (nx != null && ny != null) ? nx - ny : x.localeCompare(y); return dir === 'asc' ? c : -c;
    }).forEach(function (r) { tb.appendChild(r); });
  });

  /* ---------- the grapher card ---------- */
  var CARDS = [];
  function Card(el, cfg) {
    this.el = el; this.cfg = cfg; this.view = cfg.views[0].key; this.ind = cfg.indicators ? cfg.indicators[0].key : null; this.alt = cfg.toggle ? cfg.toggle.options[0].key : null;
    this.build(); CARDS.push(this);
  }
  Card.prototype.build = function () {
    var c = this.cfg, self = this;
    var tabs = c.views.length > 1 ? '<div class="g-tabs" role="tablist" aria-label="View">' + c.views.map(function (v) {
      return '<button class="g-tab" role="tab" type="button" data-view="' + v.key + '" aria-selected="' + (v.key === self.view) + '">' + (IC[v.icon] || '') + v.label + '</button>';
    }).join('') + '</div>' : '';
    var chips = c.indicators ? '<div class="g-chips" role="group" aria-label="Indicator">' + c.indicators.map(function (i) {
      return '<button class="chip" type="button" data-ind="' + i.key + '" aria-pressed="' + (i.key === self.ind) + '">' + esc(i.label) + '</button>';
    }).join('') + '</div>' : '';
    var tog = c.toggle ? '<div class="g-chips" role="group" aria-label="' + esc(c.toggle.label) + '">' + c.toggle.options.map(function (o) {
      return '<button class="chip" type="button" data-alt="' + o.key + '" aria-pressed="' + (o.key === self.alt) + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>' : '';
    this.el.innerHTML =
      '<div class="g-top"><div><h3 class="g-title"></h3><p class="g-sub"></p></div><span class="g-fig">' + esc(c.fig) + '</span></div>' +
      '<div class="g-controls">' + tabs + chips + tog + '</div>' +
      '<div class="g-view"></div>' +
      '<div class="learn" hidden></div>' +
      '<div class="g-foot"><div class="g-meta"><p class="src"></p><p class="note"></p></div>' +
      '<div class="g-actions">' +
      '<button class="act" type="button" data-act="dl">' + IC.dl + 'Download image</button>' +
      '<button class="act" type="button" data-act="share">' + IC.share + 'Share</button>' +
      '<button class="act" type="button" data-act="full">' + IC.full + '<span>Enter full-screen</span></button>' +
      '</div></div>';
    this.el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !self.el.contains(b)) return;
      if (b.dataset.view) { self.view = b.dataset.view; self.render(); }
      else if (b.dataset.ind) { self.ind = b.dataset.ind; self.render(); }
      else if (b.dataset.alt) { self.alt = b.dataset.alt; self.render(); }
      else if (b.dataset.act === 'learn') { var L = $('.learn', self.el); L.hidden = !L.hidden; b.setAttribute('aria-expanded', String(!L.hidden)); }
      else if (b.dataset.act === 'dl') { self.downloadImage(); }
      else if (b.dataset.act === 'share') { copyText(location.href.split('#')[0] + '#' + self.el.id, 'Link to this chart copied'); }
      else if (b.dataset.act === 'full') { self.fullscreen(); }
    });
    this.render();
  };
  Card.prototype.state = function () { return { view: this.view, ind: this.ind, alt: this.alt }; };
  Card.prototype.render = function () {
    var c = this.cfg, s = this.state(), self = this;
    this.el.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === s.view)); });
    this.el.querySelectorAll('[data-ind]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.ind === s.ind)); });
    this.el.querySelectorAll('[data-alt]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.alt === s.alt)); });
    var chipsInd = $('.g-chips[aria-label="Indicator"]', this.el);
    if (chipsInd) chipsInd.hidden = !!(c.hideIndOn && c.hideIndOn.indexOf(s.view) > -1);
    $('.g-title', this.el).textContent = typeof c.title === 'function' ? c.title(s) : c.title;
    $('.g-sub', this.el).textContent = typeof c.sub === 'function' ? c.sub(s) : c.sub;
    var src = typeof c.source === 'function' ? c.source(s) : c.source;
    $('.src', this.el).innerHTML = '<b>Data source:</b> ' + esc(src) + (c.learn ? ' – <button class="linkish" type="button" data-act="learn" aria-expanded="false">Learn more about this data</button>' : '');
    var note = typeof c.note === 'function' ? c.note(s) : c.note;
    $('.note', this.el).innerHTML = note ? '<b>Note:</b> ' + esc(note) : '';
    var L = $('.learn', this.el); if (c.learn) L.innerHTML = c.learn(s);
    var v = $('.g-view', this.el);
    if (this.plotDivs) this.plotDivs.forEach(function (d) { try { Plotly.purge(d); } catch (e) { } });
    this.plotDivs = [];
    v.innerHTML = ''; v.classList.remove('fit');
    var view = c.views.filter(function (x) { return x.key === s.view; })[0];
    view.render(v, s, this);
    var hA = c.hideAltOn, gA = this.el.querySelector('.g-chips[aria-label="Boundaries"]'); if (hA && gA) gA.hidden = hA.indexOf(s.view) > -1;
    $('[data-act="dl"]', this.el).hidden = this.plotDivs.length === 0;
  };
  Card.prototype.plot = function (container, traces, lay, cls, h) {
    var d = document.createElement('div'); d.className = 'g-plot' + (cls ? ' ' + cls : ''); container.appendChild(d);
    if (h) { d.style.height = h + 'px'; container.classList.add('fit'); }
    var conv = convertGeo(traces, lay); traces = conv[0]; lay = conv[1];
    Plotly.newPlot(d, traces, layout(lay), PCONF); this.plotDivs.push(d); return d;
  };
  Card.prototype.downloadImage = function () {
    if (!this.plotDivs[0]) return;
    var s = this.state(), name = (this.el.id + '-' + (s.ind || s.alt || s.view)).replace(/[^a-z0-9\-]/gi, '_');
    // Plotly's own PNG export breaks on quoted font names (they end up inside an SVG style attribute),
    // so export SVG, repair the quotes, and rasterise it ourselves.
    var div = this.plotDivs[0], W = Math.max(900, Math.round(div.clientWidth)), H = Math.max(500, Math.round(div.clientHeight)), tk = T(), bg = tk.surface;
    var title = $('.g-title', this.el).textContent, sub = $('.g-sub', this.el).textContent, src = $('.src', this.el).textContent.replace(/\s*–\s*Learn more about this data\s*$/, '');
    var FONT = '"Source Sans 3","Segoe UI",Arial,sans-serif';
    var wrap = function (ctx, text, maxW) { var words = text.split(' '), lines = [], cur = ''; words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur); return lines; };
    Plotly.toImage(div, { format: 'svg', width: W, height: H }).then(function (url) {
      var svg = decodeURIComponent(url.replace(/^data:image\/svg\+xml,/, ''));
      svg = svg.replace(/font-family: ([^;]*);/g, function (m, f) { return 'font-family: ' + f.replace(/"/g, "'") + ';'; });
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var P = 24, m = document.createElement('canvas').getContext('2d');
          m.font = '600 22px ' + FONT; var tl = wrap(m, title, W - 2 * P);
          m.font = '15px ' + FONT; var sl = sub ? wrap(m, sub, W - 2 * P) : [];
          m.font = '12px ' + FONT; var fl = wrap(m, src ? 'Source: ' + src : '', W - 2 * P);
          var top = P + tl.length * 28 + sl.length * 20 + 12, bot = 16 + fl.length * 16 + 22;
          var c = document.createElement('canvas'); c.width = W * 2; c.height = (top + H + bot) * 2;
          var x = c.getContext('2d'); x.scale(2, 2); x.fillStyle = bg; x.fillRect(0, 0, W, top + H + bot);
          var y = P + 20; x.textBaseline = 'alphabetic';
          x.fillStyle = tk.ink; x.font = '600 22px ' + FONT; tl.forEach(function (l) { x.fillText(l, P, y); y += 28; });
          x.fillStyle = tk.muted; x.font = '15px ' + FONT; sl.forEach(function (l) { x.fillText(l, P, y - 4); y += 20; });
          x.drawImage(img, 0, top, W, H);
          y = top + H + 20; x.fillStyle = tk.ink2; x.font = '12px ' + FONT; fl.forEach(function (l) { if (l) x.fillText(l, P, y); y += 16; });
          x.fillStyle = tk.accent; x.font = '600 12px ' + FONT; x.fillText('GRAMA · Redrawing the Map (2026)', P, y + 4);
          c.toBlob(function (b) { b ? resolve(b) : reject(new Error('empty image')); }, 'image/png');
        };
        img.onerror = function () { reject(new Error('image render failed')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    }).then(function (blob) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('Image downloaded: ' + name + '.png');
    }).catch(function () { toast('Could not create the image. Downloads may be blocked in this viewer.'); });
  };
  Card.prototype.fullscreen = function () {
    var el = this.el, self = this, lab = $('[data-act="full"] span', el);
    var done = function () { setTimeout(function () { self.plotDivs.forEach(function (d) { Plotly.Plots.resize(d); }); }, 120); };
    if (document.fullscreenElement === el) { document.exitFullscreen(); return; }
    if (el.classList.contains('is-full')) { el.classList.remove('is-full'); lab.textContent = 'Enter full-screen'; document.body.style.overflow = ''; done(); return; }
    var css = function () { el.classList.add('is-full'); lab.textContent = 'Exit full-screen'; document.body.style.overflow = 'hidden'; done(); };
    if (el.requestFullscreen) { el.requestFullscreen().then(function () { lab.textContent = 'Exit full-screen'; done(); }, css); } else css();
  };
  document.addEventListener('fullscreenchange', function () {
    CARDS.forEach(function (c) { var l = $('[data-act="full"] span', c.el); if (l && document.fullscreenElement !== c.el && !c.el.classList.contains('is-full')) l.textContent = 'Enter full-screen'; c.plotDivs && c.plotDivs.forEach(function (d) { Plotly.Plots.resize(d); }); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') CARDS.forEach(function (c) { if (c.el.classList.contains('is-full')) c.fullscreen(); }); });

  /* ---------- curve rendering ---------- */
  function curve(k) { return D.curves[k]; }
  function curveTraces(k, opt) {
    opt = opt || {}; var t = T(), c = curve(k), col = opt.color || t.accent, m = META[k] || {};
    var dg = m.dg != null ? m.dg : 3, mult = m.pct ? 100 : 1, sfx = m.pct ? '%' : '';
    var Y = function (a) { return a.map(function (v) { return v == null ? null : v * mult; }); };
    var xb = c.x.concat(c.x.slice().reverse()), yb = Y(c.hi).concat(Y(c.lo).reverse());
    var cd = c.lo.map(function (v, i) { return [v * mult, c.hi[i] * mult]; });
    var vd = m.pct ? 1 : dg;
    var tr = [
      { x: xb, y: yb, showlegend: false, fill: 'toself', fillcolor: alpha(col, isDark() ? 0.22 : 0.15), line: { width: 0 }, hoverinfo: 'skip', type: 'scatter', mode: 'lines' },
      { x: c.x, y: Y(c.y), customdata: cd, type: 'scatter', mode: 'lines', line: { color: col, width: opt.compact ? 2 : 2.6, shape: 'spline', smoothing: 0.4 }, name: opt.name || m.t,
        hovertemplate: (opt.name ? '<b>' + opt.name + '</b> ' : '') + '%{y:,.' + vd + 'f}' + sfx + '<br><span style="font-size:11px">95% CI %{customdata[0]:,.' + vd + 'f}–%{customdata[1]:,.' + vd + 'f}' + sfx + '</span><extra></extra>' }
    ];
    if (!opt.noMarkers) {
      c.markers.forEach(function (mk, i) {
        var mc = i === 0 ? t.accent : t.nm;
        tr.push({ x: [mk.x], y: [mk.y * mult], showlegend: false, type: 'scatter', mode: 'markers', marker: { symbol: 'x-thin', size: opt.compact ? 10 : 14, line: { width: 3, color: mc }, color: mc },
          text: [i === 0 ? 'Proposed (' + fmtUS(mk.x) + ')' : 'Current mean (' + fmtUS(mk.x) + ')'], textposition: i === 0 ? 'top right' : 'bottom left', textfont: { size: 12, color: t.ink2 },
          hovertemplate: '<b>' + mk.label + '</b>: ' + fmtUS(mk.x) + ' people<br>Fitted value %{y:,.' + vd + 'f}' + sfx + '<extra></extra>' });
      });
    }
    return tr;
  }
  function markerAnn(k) {
    var t = T(), c = curve(k), m = META[k] || {}, mult = m.pct ? 100 : 1;
    return c.markers.map(function (mk, i) {
      return { x: mk.x, y: mk.y * mult, text: (i === 0 ? 'Proposed (' : 'Current mean (') + fmtUS(mk.x) + ')', showarrow: true, arrowhead: 0, arrowwidth: 1, arrowcolor: t.muted,
        ax: 0, ay: i === 0 ? -34 : 34, bgcolor: alpha(t.surface.indexOf('#') === 0 ? t.surface : '#ffffff', 0.9), borderpad: 3, font: { size: 12, color: t.ink2 } };
    });
  }
  function curveLayout(k, opt) {
    opt = opt || {}; var m = META[k] || {}; var ward = m.ward;
    return {
      annotations: opt.compact ? [] : markerAnn(k),
      hovermode: 'x', hoverdistance: 40, spikedistance: -1,
      xaxis: { title: { text: opt.compact ? '' : (ward ? 'Ward population' : 'Gram Panchayat population, 2011') }, tickformat: ward ? ',d' : '~s', range: ward ? [400, 1250] : [5000, 20000], showspikes: true, spikemode: 'across', spikethickness: 1, spikedash: 'dot', spikecolor: T().muted, dtick: ward ? (NARROW ? 200 : 100) : (NARROW ? 4000 : 2000) },
      yaxis: { title: { text: opt.compact ? '' : (m.pct ? m.u.replace('share', 'percent') : m.u) }, ticksuffix: m.pct ? '%' : '' },
      margin: opt.compact ? { l: 44, r: 8, t: 6, b: 28 } : { l: 64, r: 18, t: 18, b: 54 }
    };
  }
  function curveTable(keys, names) {
    var c0 = curve(keys[0]), ward = META[keys[0]] && META[keys[0]].ward;
    var pts = ward ? [450, 500, 600, 700, c0.markers[1].x, 900, 1000, 1100, 1200] : [5000, 7000, 8000, 10000, c0.markers[1].x, 12500, 15000, 17500, 20000];
    pts = pts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var head = [ward ? 'Ward population' : 'GP population (2011)'];
    keys.forEach(function (k, i) { var n = names ? names[i] : META[k].t; head.push(n, '95% CI'); });
    var rows = pts.map(function (p) {
      var r = [fmtUS(p) + (p === 7000 || p === 500 ? ' (proposed)' : p === c0.markers[1].x ? ' (current mean)' : '')];
      keys.forEach(function (k) {
        var c = curve(k), m = META[k], mult = m.pct ? 100 : 1, dg = m.pct ? 1 : m.dg;
        if (p < c.x[0] || p > c.x[c.x.length - 1]) { r.push(null, null); return; }
        var y = interp(p, c.x, c.y) * mult, lo = interp(p, c.x, c.lo) * mult, hi = interp(p, c.x, c.hi) * mult;
        r.push(fmtUS(y, dg) + (m.pct ? '%' : ''), fmtUS(lo, dg) + ' to ' + fmtUS(hi, dg));
      });
      return r;
    });
    return { head: head, rows: rows };
  }
  function interp(x, xs, ys) {
    for (var i = 1; i < xs.length; i++) if (xs[i] >= x) { var f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]); }
    return ys[ys.length - 1];
  }
  function curveCSV(keys) {
    var rows = [['series', 'population', 'fitted', 'ci_low', 'ci_high']];
    keys.forEach(function (k) { var c = curve(k); c.x.forEach(function (x, i) { rows.push([META[k].t, x, c.y[i], c.lo[i], c.hi[i]]); }); });
    return rows;
  }
  function learnHTML(keys) {
    return keys.map(function (k) {
      var m = META[k];
      return '<h4>' + esc(m.t) + '</h4><p>' + esc(m.d) + '</p><dl>' +
        '<dt>Unit</dt><dd>' + esc(m.u) + '</dd>' +
        '<dt>Source</dt><dd>' + esc(m.src) + '</dd>' +
        '<dt>Estimate</dt><dd>' + esc(m.est) + '</dd>' +
        '<dt>Sample</dt><dd>' + esc(m.n) + '</dd>' +
        '<dt>Method</dt><dd>' + esc(m.m) + '</dd>' +
        (m.note ? '<dt>Web edition</dt><dd>' + esc(m.note) + '</dd>' : '') + '</dl>';
    }).join('');
  }
  function curveCard(el, o) {
    var views = [{ key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) { card.plot(v, curveTraces(s.ind), curveLayout(s.ind)); } }];
    if (o.grid) views.push({ key: 'grid', label: 'All indicators', icon: 'grid', render: function (v, s, card) {
      var g = document.createElement('div'); g.className = 'g-multi'; v.appendChild(g);
      o.inds.forEach(function (i) {
        var w = document.createElement('div'); w.className = 'mini'; w.innerHTML = '<h5>' + esc(META[i.key].t) + '</h5><small>' + esc(META[i.key].u) + '</small>'; g.appendChild(w);
        card.plot(w, curveTraces(i.key, { compact: true }), curveLayout(i.key, { compact: true }));
      });
    } });
    if (!o.noTable) views.push({ key: 'table', label: 'Table', icon: 'table', render: function (v, s) { var t = curveTable([s.ind]); v.innerHTML = tableHTML(t.head, t.rows, { hl: function (r) { return /proposed|current/.test(r[0]); } }); } });
    return new Card(el, {
      fig: o.fig, title: o.title, sub: function (s) { return o.sub ? o.sub(s) : META[s.ind].t + ', ' + META[s.ind].u + '. Smaller GPs to the left.'; },
      views: views, indicators: o.inds, hideIndOn: ['grid'],
      source: function (s) { return META[s.ind].src; }, note: o.note,
      learn: function (s) { return learnHTML(s.view === 'grid' ? o.inds.map(function (i) { return i.key; }) : [s.ind]); },
      csv: function (s) { return curveCSV(s.view === 'grid' ? o.inds.map(function (i) { return i.key; }) : [s.ind]); }
    });
  }

  /* ---------- figure definitions ---------- */
  var FIGS = {};

  /* ---------- interactive data stack ---------- */
  var FIGLINK = { 'fig-0': '1991–2011 chart', 'fig-1': 'Figure 1', 'fig-1b': 'District trends', 'fig-3': 'Figure 3', 'fig-4': 'Figure 4', 'fig-5': 'Figure 5', 'fig-6': 'Figure 6', 'fig-7': 'Figure 7', 'fig-8': 'Figure 8',
    'fig-9': 'Figure 9', 'fig-10': 'Figure 10', 'fig-11': 'Figure 11', 'fig-12': 'Figure 12', 'fig-13': 'Figure 13', 'fig-14': 'Figure 14', 'fig-15': 'Figure 15', 'table-1': 'Table 1', 'table-3': 'Table 3' };
  var LAYERS = [
    { n: 5, name: 'Linked Analytical Data', tag: 'Linked across GPs, wards, villages, and citizens', tone: 'rose',
      items: [{ name: 'GP-level measures', cov: 'Every GP in Bihar', yr: '', used: ['fig-3', 'fig-4', 'fig-5', 'fig-9', 'fig-10'] },
        { name: 'Ward-level measures', cov: 'Every ward in Bihar', yr: '', used: ['fig-7', 'fig-11', 'fig-12'] },
        { name: 'Village-level measures', cov: '39,359 villages', yr: '', used: ['fig-3', 'fig-5', 'fig-12', 'fig-13'] },
        { name: 'Citizen-level measures', cov: '9,699 surveyed citizens', yr: '', used: ['fig-6', 'fig-8', 'fig-11'] },
        { name: 'Boundary simulation inputs', cov: 'Village boundaries and populations for every block', yr: '', used: ['fig-13', 'fig-14'] }] },
    { n: 4, name: 'Primary Surveys', tag: 'Preferences, welfare, knowledge, satisfaction', tone: 'rose',
      items: [{ name: 'Citizen Survey', cov: '10 districts, 9,699 citizens', yr: 'Nov 2024 – Feb 2025', used: ['fig-6', 'fig-11'] },
        { name: 'Ward Member Survey', cov: '10 districts, 6,213 WMs', yr: 'Aug – Oct 2024', used: ['fig-8', 'fig-11'] }] },
    { n: 3, name: 'Administrative Systems', tag: 'Spending, workdays, infrastructure, service delivery', tone: 'sand',
      items: [{ name: 'NREGA MIS', cov: '7,658 GPs', yr: '2021–24', used: ['fig-3'] },
        { name: 'PRD / Nal Jal / Nali Gali', cov: '100,000–108,000 wards', yr: '2016–21', used: ['fig-3', 'fig-12'] },
        { name: 'GPDP expenditure', cov: '7,600+ GPs', yr: '2024', used: ['fig-3', 'fig-4', 'fig-6'] },
        { name: 'Mission Antyodaya', cov: '39,000 villages', yr: '2019–20', used: ['fig-3'] }] },
    { n: 2, name: 'Political & Electoral Data', tag: 'Leadership, reservations, representation, ward structure', tone: 'blue',
      items: [{ name: 'Ward & Mukhiya Candidates', cov: 'Statewide candidate data (∼450,000 candidates)', yr: '2016', used: ['fig-7', 'fig-8'] },
        { name: 'Mukhiya Winners', cov: 'Statewide winner data (7,148 Mukhiyas)', yr: '2016', used: ['fig-7', 'fig-8'] },
        { name: 'GP Reservation Status', cov: '8,392 GPs', yr: '2006 / 2011 / 2016 / 2021', used: ['table-3'] },
        { name: 'Ward-level Data', cov: '100,456 wards', yr: '2016', used: ['fig-1', 'fig-1b', 'fig-7', 'fig-11'] }] },
    { n: 1, name: 'Population & Socioeconomic Foundation', tag: 'Population, village boundaries, amenities, poverty, socioeconomic composition', tone: 'rose',
      items: [{ name: 'Population Census 1991', cov: '6,887 GPs', yr: '1991', used: ['fig-0', 'fig-1b'] },
        { name: 'Population Census 2001', cov: '8,392 GPs', yr: '2001', used: ['fig-1b', 'fig-9', 'fig-10'] },
        { name: 'Population Census 2011', cov: '8,392 GPs', yr: '2011', used: ['fig-1', 'fig-1b', 'fig-3', 'fig-4', 'fig-5', 'fig-13', 'fig-14'] },
        { name: 'Census Village Amenities 2011', cov: '39,359 villages', yr: '2011', used: ['fig-3', 'fig-5', 'fig-9', 'fig-10'] },
        { name: 'Socio-Economic Caste Census 2011–12', cov: '97 million citizens', yr: '2011–12', used: ['fig-8'] }],
      derived: 'Derived GP characteristics: poverty, asset wealth, socioeconomic composition' }];
  var OUTPUTS = [{ name: 'GP-size analysis', href: '#s4', layers: [1, 2, 3, 4, 5], d: 'Section 4: how GP population relates to schools, health, water, NREGA, GPDP spending and leaders.' },
    { name: 'Ward-level analysis', href: '#s5', layers: [1, 2, 3, 4, 5], d: 'Section 5: ward population against ward member and citizen outcomes, and Nal Jal implementation.' },
    { name: 'Representation', href: '#s8', layers: [1, 2, 4, 5], d: 'Sections 4 and 8: who gets elected, representativeness, and reservation rotation.' },
    { name: 'Delimitation simulation', href: '#s6', layers: [1, 5], d: 'Section 6: the strict and closest boundary algorithms run on village boundaries and populations.' }];

  function stackHTML() {
    var h = '<div class="stack"><div class="stk-out"><div class="stk-hd"><span class="stk-title">Analytical Outputs</span></div><div class="stk-items">';
    OUTPUTS.forEach(function (o, i) { h += '<button type="button" class="stk-item stk-o" data-out="' + i + '" aria-pressed="false">' + esc(o.name) + '</button>'; });
    h += '</div></div>';
    LAYERS.forEach(function (L, li) {
      h += '<div class="stk-layer tone-' + L.tone + '" data-layer="' + L.n + '"><div class="stk-hd"><span class="stk-n">' + L.n + '</span><span class="stk-title">' + esc(L.name) + '</span></div><div class="stk-items">';
      L.items.forEach(function (it, ii) {
        h += '<button type="button" class="stk-item" data-li="' + li + '" data-ii="' + ii + '" aria-pressed="false"><b>' + esc(it.name) + '</b><small>' + esc([it.yr, it.cov].filter(Boolean).join(' · ')) + '</small></button>';
      });
      h += '</div><p class="stk-tag">' + esc(L.tag) + (L.derived ? ' <span class="stk-derived">' + esc(L.derived) + '</span>' : '') + '</p></div>';
    });
    return h + '<div class="stk-detail" aria-live="polite"></div></div>';
  }
  function stackWire(root) {
    var det = root.querySelector('.stk-detail');
    var clear = function () { root.querySelectorAll('.stk-item').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); }); root.querySelectorAll('.stk-layer').forEach(function (l) { l.classList.remove('dim', 'lit'); }); };
    var showItem = function (li, ii) {
      clear(); var L = LAYERS[li], it = L.items[ii];
      root.querySelector('[data-li="' + li + '"][data-ii="' + ii + '"]').setAttribute('aria-pressed', 'true');
      root.querySelectorAll('.stk-layer').forEach(function (l) { l.classList.toggle('lit', +l.dataset.layer === L.n); });
      det.innerHTML = '<span class="eyebrow">Layer ' + L.n + ' · ' + esc(L.name) + '</span><h4>' + esc(it.name) + '</h4><dl><dt>Coverage</dt><dd>' + esc(it.cov) + '</dd>' + (it.yr ? '<dt>Vintage</dt><dd>' + esc(it.yr) + '</dd>' : '') +
        '<dt>Used in</dt><dd class="stk-links">' + it.used.map(function (f) { return '<a href="#' + f + '">' + esc(FIGLINK[f]) + '</a>'; }).join('') + '</dd></dl>';
    };
    var showOut = function (i) {
      clear(); var o = OUTPUTS[i];
      root.querySelector('[data-out="' + i + '"]').setAttribute('aria-pressed', 'true');
      root.querySelectorAll('.stk-layer').forEach(function (l) { var on = o.layers.indexOf(+l.dataset.layer) > -1; l.classList.toggle('lit', on); l.classList.toggle('dim', !on); });
      det.innerHTML = '<span class="eyebrow">Analytical output</span><h4>' + esc(o.name) + '</h4><p>' + esc(o.d) + '</p><dl><dt>Draws on</dt><dd>' + o.layers.map(function (n) { return 'Layer ' + n; }).join(', ') + '</dd><dt>Read it</dt><dd class="stk-links"><a href="' + o.href + '">Go to section</a></dd></dl>';
    };
    root.addEventListener('click', function (e) {
      var b = e.target.closest('.stk-item'); if (!b) return;
      if (b.dataset.out != null) showOut(+b.dataset.out); else showItem(+b.dataset.li, +b.dataset.ii);
    });
    showItem(4, 2);
  }
  FIGS.stack = function (el) {
    new Card(el, { fig: 'Infographic', title: 'The data stack behind Redrawing the Map', sub: 'How GRAMA builds the evidence base on panchayat delimitation in Bihar. Select a source to see its coverage and where it is used, or an output to see the layers it draws on.',
      views: [{ key: 'stack', label: 'Interactive', icon: 'grid', render: function (v) { v.classList.add('fit'); v.innerHTML = stackHTML(); stackWire(v.querySelector('.stack')); } },
        { key: 'img', label: 'Infographic', icon: 'chart', render: function (v) { v.classList.add('fit'); v.innerHTML = '<img class="g-img" src="assets/data-stack.jpg" alt="Infographic of the five stacked data layers feeding GRAMA\'s analytical outputs.">'; } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(STACKT[0], STACKT.slice(1)); } }],
      source: 'GRAMA; see Appendix A for the full data inventory', csv: function () { return STACKT; } });
  };
  var STACKT = [['Layer', 'Source', 'Coverage', 'Vintage', 'Used in']];
  LAYERS.slice().reverse().forEach(function (L) { L.items.forEach(function (it) { STACKT.push([L.n + '. ' + L.name, it.name, it.cov, it.yr || '–', it.used.map(function (f) { return FIGLINK[f]; }).join(', ')]); }); });

  /* ---------- district groups over three censuses ---------- */
  FIGS.f1b = function (el) {
    var TR = D.trend, yrs = TR.years.map(String);
    var SHORT = { 'North-West (Saran & Champaran)': 'North-West', 'North-Central (Tirhut & Mithila)': 'North-Central', 'North-East (Kosi & Seemanchal)': 'North-East',
      'Central & East (Patna, Munger, Bhagalpur)': 'Central & East', 'South-West (Shahabad)': 'South-West', 'South (Magadh)': 'South' };
    var lab = function (s, g) { return s.alt === 'region' ? SHORT[g.group] : g.group; };
    var groups = function (s) { return TR[s.alt]; };
    var MEAS = [{ k: 'gp', t: 'Average GP population', u: 'people per GP' }, { k: 'ward', t: 'Average ward population', u: 'people per ward' }];
    var CAT = function () { var t = T(); return [t.accent, t.cool, t.ochre, '#4f8a63', '#7a5ba3', t.nm]; };
    var growth = function (a) { return Math.round(100 * (a[2] / a[0] - 1)) + '%'; };
    new Card(el, { fig: 'Additional chart', title: 'GP and ward populations by district group, 1991, 2001 and 2011',
      sub: function (s) { return s.alt === 'region' ? 'Districts grouped into six regions. Every region started near 6,800 people per GP in 1991; by 2011 they had drifted apart.' : 'Districts ranked by 2011 average GP population and split into six groups of 6–7 districts.'; },
      toggle: { label: 'Group districts by', options: [{ key: 'region', label: 'Region' }, { key: 'size', label: '2011 GP size' }] },
      views: [
        { key: 'heat', label: 'Heatmap', icon: 'grid', render: function (v, s, card) {
          var t = T(), G = groups(s);
          var wrap = document.createElement('div'); wrap.className = 'g-pair'; v.appendChild(wrap);
          MEAS.forEach(function (m) {
            var box = document.createElement('div'); box.className = 'mini'; box.innerHTML = '<h5>' + m.t + '</h5><small>' + m.u + '</small>'; wrap.appendChild(box);
            var rows = G.map(function (g) { return lab(s, g); }).concat(['Bihar']);
            var z = G.map(function (g) { return g[m.k]; }).concat([TR.state[m.k]]);
            card.plot(box, [{ type: 'heatmap', x: yrs, y: rows, z: z, colorscale: t.seq, showscale: false, xgap: 3, ygap: 3,
              text: z.map(function (r) { return r.map(function (x) { return fmtUS(x); }); }), texttemplate: '%{text}', textfont: { size: 13 },
              customdata: G.map(function (g) { return yrs.map(function () { return g.districts.join(', '); }); }).concat([yrs.map(function () { return 'All districts'; })]),
              hovertemplate: '<b>%{y}</b>, %{x}<br>%{z:,} ' + m.u + '<br><span style="font-size:11px">%{customdata}</span><extra></extra>' }],
              { margin: { l: 110, r: 8, t: 28, b: 8 }, xaxis: { type: 'category', side: 'top', gridcolor: 'rgba(0,0,0,0)', ticks: '', tickfont: { size: 13, color: T().ink } }, yaxis: { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 12 } } }, null, 330);
          });
        } },
        { key: 'lines', label: 'Lines', icon: 'chart', render: function (v, s, card) {
          var t = T(), G = groups(s), cols = s.alt === 'size' ? t.seq.slice(0).map(function () { return null; }) : CAT();
          var seqc = ['#e7b4bf', '#d89aa7', '#c4778a', '#a8566b', '#8c1d2f', '#5c0f1d'];
          if (isDark()) seqc = ['#5a2b36', '#7a3445', '#9c3f55', '#bd5a71', '#d97f94', '#f5c6cf'];
          var wrap = document.createElement('div'); wrap.className = 'g-pair'; v.appendChild(wrap);
          MEAS.forEach(function (m, mi) {
            var box = document.createElement('div'); box.className = 'mini'; box.innerHTML = '<h5>' + m.t + '</h5><small>' + m.u + '</small>'; wrap.appendChild(box);
            var tr = G.map(function (g, i) { var c = s.alt === 'size' ? seqc[i] : cols[i];
              return { type: 'scatter', mode: 'lines+markers', name: lab(s, g), x: yrs, y: g[m.k], line: { color: c, width: 2.4 }, marker: { size: 8, color: c, line: { color: t.surface, width: 1.5 } }, showlegend: mi === 0, legendgroup: g.group,
                hovertemplate: '<b>' + esc(lab(s, g)) + '</b>, %{x}: %{y:,} ' + m.u + '<extra></extra>' }; });
            tr.push({ type: 'scatter', mode: 'lines', name: 'Bihar', x: yrs, y: TR.state[m.k], line: { color: t.ink, width: 1.5, dash: 'dash' }, showlegend: mi === 0, legendgroup: 'Bihar', hovertemplate: '<b>Bihar</b>, %{x}: %{y:,} ' + m.u + '<extra></extra>' });
            card.plot(box, tr, { margin: { l: 56, r: 10, t: 8, b: mi === 0 ? 30 : 96 }, xaxis: { type: 'category', gridcolor: 'rgba(0,0,0,0)' }, yaxis: { tickformat: ',d' }, hovermode: 'closest',
              showlegend: mi === 0, legend: { orientation: 'h', y: -0.14, yanchor: 'top', x: 0, font: { color: t.ink2, size: 12 } } }, null, 400);
          });
        } },
        { key: 'map', label: 'Groups map', icon: 'map', render: function (v, s, card) {
          var t = T(), G = groups(s), names = G.map(function (g) { return g.group; });
          var dist = TR.districts, cols = s.alt === 'size' ? (isDark() ? ['#5a2b36', '#7a3445', '#9c3f55', '#bd5a71', '#d97f94', '#f5c6cf'] : ['#f2d9de', '#e2adb9', '#cc7d90', '#ad4f66', '#8c1d2f', '#5c0f1d']) : CAT();
          var scale = []; cols.forEach(function (c, i) { scale.push([i / 6, c], [(i + 1) / 6, c]); });
          var gi = function (d) { return names.indexOf(s.alt === 'region' ? d.region : d.size); };
          card.plot(v, [{ type: 'choropleth', geojson: D.geo_districts, featureidkey: 'id', locations: dist.map(function (d) { return d.district; }), z: dist.map(function (d) { return gi(d) + 0.5; }), zmin: 0, zmax: 6,
            colorscale: scale, showscale: false, marker: { line: { color: t.surface, width: 0.8 } },
            customdata: dist.map(function (d) { return [lab(s, G[gi(d)]), fmtUS(d.gp[0]), fmtUS(d.gp[1]), fmtUS(d.gp[2]), fmtUS(d.ward[0]), fmtUS(d.ward[2])]; }),
            hovertemplate: '<b>%{location}</b> · %{customdata[0]}<br>People per GP: %{customdata[1]} → %{customdata[2]} → %{customdata[3]}<br>People per ward: %{customdata[4]} → %{customdata[5]}<extra></extra>' }].concat(
            G.map(function (g, i) { return { type: 'scattergeo', lon: [null], lat: [null], mode: 'markers', marker: { size: 12, symbol: 'square', color: cols[i] }, name: lab(s, g), showlegend: true, hoverinfo: 'skip' }; })),
            { geo: { fitbounds: 'locations', visible: false, bgcolor: 'rgba(0,0,0,0)', projection: { type: 'mercator' } }, margin: { l: 0, r: 0, t: 0, b: 10 }, showlegend: true, legend: { orientation: 'h', y: 0, yanchor: 'top', x: 0.5, xanchor: 'center', font: { color: t.ink2, size: 12 } } }, 'tall');
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v, s) {
          var G = groups(s);
          v.innerHTML = tableHTML(['Group', 'GPs', 'GP pop. 1991', '2001', '2011', 'Growth', 'Ward pop. 1991', '2001', '2011'],
            G.map(function (g) { return [lab(s, g), fmtUS(g.gps), fmtUS(g.gp[0]), fmtUS(g.gp[1]), fmtUS(g.gp[2]), growth(g.gp), fmtUS(g.ward[0]), fmtUS(g.ward[1]), fmtUS(g.ward[2])]; })
              .concat([['Bihar', fmtUS(TR.state.gps), fmtUS(TR.state.gp[0]), fmtUS(TR.state.gp[1]), fmtUS(TR.state.gp[2]), growth(TR.state.gp), fmtUS(TR.state.ward[0]), fmtUS(TR.state.ward[1]), fmtUS(TR.state.ward[2])]]), { hl: function (r) { return r[0] === 'Bihar'; } }) +
            '<div style="height:.8rem"></div>' + tableHTML(['District', 'Group', 'GPs in panel', 'Coverage', 'GP pop. 1991', '2001', '2011', 'Ward pop. 1991', '2001', '2011'],
            TR.districts.map(function (d) { var g = s.alt === 'region' ? SHORT[d.region] : d.size; return [d.district, g, fmtUS(d.gps), Math.round(100 * d.coverage) + '%', fmtUS(d.gp[0]), fmtUS(d.gp[1]), fmtUS(d.gp[2]), fmtUS(d.ward[0]), fmtUS(d.ward[1]), fmtUS(d.ward[2])]; }));
        } }],
      source: 'Population Census 1991, 2001, 2011; ward counts from the 1993 delimitation',
      note: 'Harmonised panel of 6,398 GPs with a population in all three censuses and a ward count. Ward population = total population ÷ number of wards.',
      learn: function () {
        return '<h4>What you should know about this data</h4><p>The chart follows the same GPs across three censuses on today\'s (1991-based) boundaries. 1991 populations and ward counts come from the 1993 delimitation records; 2001 and 2011 populations come from the reservation files used for the 2006 and 2016 elections. Only GPs with all four values are kept (6,398 of 8,392). Across this panel the state averages are 6,834, 8,835 and 11,084 people per GP, close to the report\'s 6,883, 8,832 and 10,961, which use each census\'s full set of GPs.</p>' +
          '<h4>How districts are grouped</h4><p><b>Region:</b> six regions built from Bihar\'s administrative divisions. North-West: Saran division and the two Champarans. North-Central: rest of Tirhut and Darbhanga divisions. North-East: Kosi and Purnia divisions. Central &amp; East: Patna and Nalanda, Munger division, and Bhagalpur division. South-West: Bhojpur, Buxar, Rohtas, Kaimur. South: Magadh division.</p><p><b>2011 GP size:</b> districts ranked by their 2011 average GP population (all GPs) and split into six groups of 6–7 districts, from smallest to largest.</p>' +
          '<h4>Coverage</h4><p>Most districts have 70–95% of their GPs in the panel. Coverage is lower in Madhepura (46%), Madhubani (57%), Bhagalpur (58%), Begusarai (64%), Purnia (64%) and Samastipur (65%); see the Table view.</p>' +
          '<h4>How group values are computed</h4><p>Average GP population = total population of the group\'s panel GPs ÷ number of GPs. Average ward population = total population ÷ total wards.</p>';
      },
      csv: function (s) { return [['district', 'group', 'gps', 'coverage', 'gp_1991', 'gp_2001', 'gp_2011', 'ward_1991', 'ward_2001', 'ward_2011']].concat(TR.districts.map(function (d) { return [d.district, s.alt === 'region' ? d.region : d.size, d.gps, d.coverage].concat(d.gp, d.ward); })); } });
  };

  FIGS.f0 = function (el) {
    var yrs = ['1991', '2001', '2011'], gp = [6883, 8832, 10961], ward = [500, null, 806], rep = [2.01, null, 1.25];
    new Card(el, { fig: 'Additional chart', title: 'Average GP population and ward representation, 1991–2011', sub: function (s) { return s.alt === 'gp' ? 'Average population per Gram Panchayat, against the 7,000 working standard. Boundaries unchanged since 1991.' : 'Ward members per 1,000 people. Same wards, more people.'; },
      toggle: { label: 'Measure', options: [{ key: 'gp', label: 'People per GP' }, { key: 'rep', label: 'Ward members per 1,000 people' }] },
      views: [{ key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
        var t = T(), y = s.alt === 'gp' ? gp : rep.filter(function (x) { return x != null; }), x = s.alt === 'gp' ? yrs : ['1991', '2011'];
        var tr = [{ x: x, y: y, type: 'bar', marker: { color: x.map(function (_, i) { return i === x.length - 1 ? t.accent : alpha(t.accent, .45); }), cornerradius: 4 }, width: .5,
          text: y.map(function (v) { return s.alt === 'gp' ? fmtUS(v) : v.toFixed(2); }), textposition: 'inside', insidetextanchor: 'end', textangle: 0, textfont: { color: x.map(function (_, i) { return i === x.length - 1 ? t.surface : t.ink; }), size: 14 },
          hovertemplate: '%{x}: %{y:,}' + (s.alt === 'gp' ? ' people per GP' : ' ward members per 1,000 people') + '<extra></extra>' }];
        var lay = { yaxis: { title: { text: s.alt === 'gp' ? 'people per GP' : 'ward members per 1,000 people' }, rangemode: 'tozero', range: s.alt === 'gp' ? [0, 12500] : [0, 2.4] }, xaxis: { type: 'category', title: { text: 'Census year' }, gridcolor: 'rgba(0,0,0,0)' }, margin: { t: 26 } };
        if (s.alt === 'gp') { lay.shapes = [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 7000, y1: 7000, line: { color: t.ink2, width: 1.5, dash: 'dash' } }]; lay.annotations = [{ xref: 'paper', x: 1, y: 7000, xshift: 6, xanchor: 'left', yanchor: 'middle', align: 'left', text: '7,000<br>standard', showarrow: false, font: { color: t.ink2, size: 12 } }]; lay.margin = { t: 26, r: 76 }; }
        card.plot(v, tr, lay);
      } }, { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['Census year', 'People per GP', 'People per ward', 'Ward members per 1,000 people'], yrs.map(function (y, i) { return [y, fmtUS(gp[i]), ward[i] ? '~' + fmtUS(ward[i]) : '–', rep[i] ? rep[i].toFixed(2) : '–']; })); } }],
      source: 'Population Census 1991, 2001, 2011; Bihar Panchayati Raj Department', note: '8,041 GPs and 109,310 wards throughout. Ward figures for 2001 are not reported.',
      csv: function () { return [['year', 'people_per_gp', 'people_per_ward', 'ward_members_per_1000']].concat(yrs.map(function (y, i) { return [y, gp[i], ward[i], rep[i]]; })); } });
  };

  FIGS.f1 = function (el) {
    var rows = D.districts, geo = D.geo_districts;
    var metric = function (s) { return s.alt === 'gp' ? { k: 'gp_pop', l: 'Average GP population', u: 'people per GP' } : { k: 'ward_pop', l: 'Average ward population', u: 'people per ward' }; };
    new Card(el, { fig: 'Figure 1', title: 'Populations in GPs and wards by district, 2011 levels.', sub: function (s) { return 'On average, a GP represents 8,832 citizens, and a ward has 806 citizens. Showing: ' + metric(s).l.toLowerCase() + '.'; },
      toggle: { label: 'Measure', options: [{ key: 'gp', label: 'People per GP' }, { key: 'ward', label: 'People per ward' }] },
      views: [
        { key: 'map', label: 'Map', icon: 'map', render: function (v, s, card) {
          var t = T(), m = metric(s);
          card.plot(v, [{ type: 'choropleth', geojson: geo, featureidkey: 'id', locations: rows.map(function (r) { return r.district; }), z: rows.map(function (r) { return r[m.k]; }),
            colorscale: t.seq, marker: { line: { color: t.surface, width: 0.8 } },
            colorbar: { orientation: 'h', y: -0.04, yanchor: 'top', len: 0.6, thickness: 10, outlinewidth: 0, tickfont: { color: t.ink2 }, title: { text: m.u, side: 'top', font: { color: t.muted, size: 12 } }, tickformat: ',d' },
            hovertemplate: '<b>%{location}</b><br>%{z:,} ' + m.u + '<extra></extra>' }],
            { geo: { fitbounds: 'locations', visible: false, bgcolor: 'rgba(0,0,0,0)', projection: { type: 'mercator' } }, margin: { l: 0, r: 0, t: 0, b: 50 } }, 'tall');
        } },
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), m = metric(s), r = rows.slice().sort(function (a, b) { return a[m.k] - b[m.k]; });
          var target = s.alt === 'gp' ? 7000 : 500;
          card.plot(v, [{ type: 'bar', orientation: 'h', y: r.map(function (x) { return x.district; }), x: r.map(function (x) { return x[m.k]; }), marker: { color: alpha(t.accent, .8), cornerradius: 3 },
            hovertemplate: '<b>%{y}</b>: %{x:,} ' + m.u + '<extra></extra>' }],
            { height: 860, margin: { l: 130, t: 30 }, xaxis: { title: { text: m.u }, tickformat: ',d', range: [0, s.alt === 'gp' ? 15500 : 950] }, yaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 12 } },
              shapes: [{ type: 'line', x0: target, x1: target, yref: 'paper', y0: 0, y1: 1, line: { dash: 'dash', color: t.ink2, width: 1.5 } }],
              annotations: [{ x: target, yref: 'paper', y: 1, yanchor: 'bottom', text: 'Target ' + fmtUS(target), showarrow: false, font: { size: 12, color: t.ink2 } }] }, null, 860);
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['District', 'GPs', 'People per GP', 'Wards', 'People per ward'], rows.map(function (r) { return [r.district, fmtUS(r.n_gp), fmtUS(r.gp_pop), fmtUS(r.n_ward), fmtUS(r.ward_pop)]; })); } }],
      source: 'Population Census 2011; GRAMA GP and ward population crosswalk', note: 'Population figures are 2011 Census levels on the current (1991-based) boundaries.',
      learn: function () { return '<h4>What you should know about this data</h4><p>GP populations are 2011 Census totals aggregated from villages to their current Gram Panchayat (8,392 GPs in the crosswalk). Ward populations come from ward-level population records for 100,456 wards linked to their GP. District values are simple averages across GPs or wards.</p><p>District boundaries on the map are built by dissolving GRAMA\'s GP boundary file, so small gaps and slivers can appear.</p>'; },
      csv: function () { return [['district', 'gps', 'people_per_gp', 'wards', 'people_per_ward']].concat(rows.map(function (r) { return [r.district, r.n_gp, r.gp_pop, r.n_ward, r.ward_pop]; })); } });
  };

  FIGS.t1 = function (el) {
    var st = D.states;
    new Card(el, { fig: 'Table 1', title: 'Populations in GPs by state, 2011 levels.', sub: 'National mean 3,418; Bihar has 4th highest GP population.',
      views: [
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), r = st.slice().reverse();
          card.plot(v, [{ type: 'bar', orientation: 'h', y: r.map(function (x) { return x.state; }), x: r.map(function (x) { return x.avg; }), customdata: r.map(function (x) { return [x.gps, x.rural]; }),
            marker: { color: r.map(function (x) { return x.state === 'Bihar' ? t.accent : alpha(t.nm, .45); }), cornerradius: 3 },
            hovertemplate: '<b>%{y}</b><br>%{x:,} people per GP<br>%{customdata[0]:,} GPs · %{customdata[1]:,} rural people<extra></extra>' }],
            { margin: { l: 130, t: 30 }, xaxis: { title: { text: 'average rural population per GP' }, tickformat: ',d' }, yaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 12 } },
              shapes: [{ type: 'line', x0: 3418, x1: 3418, yref: 'paper', y0: 0, y1: 1, line: { dash: 'dash', color: t.ink2, width: 1.5 } }],
              annotations: [{ x: 3418, yref: 'paper', y: 1, yanchor: 'bottom', xanchor: 'left', text: 'National mean 3,418', showarrow: false, font: { size: 12, color: t.ink2 } }] }, null, 720);
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['State', 'Rural population (2011)', 'Number of GPs', 'Average GP population (rural)'], st.map(function (r) { return [r.state, fmtUS(r.rural), fmtUS(r.gps), fmtUS(r.avg)]; }), { hl: function (r) { return r[0] === 'Bihar'; } }); } }],
      source: 'Population Census 2011 (rural population); Ministry of Panchayati Raj, state-wise entity counts', note: 'States with Gram Panchayats only. National mean = total rural population / total GPs.',
      csv: function () { return [['state', 'rural_population_2011', 'gps', 'avg_gp_population']].concat(st.map(function (r) { return [r.state, r.rural, r.gps, r.avg]; })); } });
  };

  FIGS.f2 = function (el) {
    var tiers = ['Federal', 'Local', 'State'];
    var C = [{ n: 'China', v: [20, 69, 11], c: 'ochre', yr: '1998' }, { n: 'India', v: [33, 12, 55], c: 'accent', yr: '2011–12' }, { n: 'United States', v: [12, 64, 24], c: 'cool', yr: '2012–13' }];
    new Card(el, { fig: 'Figure 2', title: 'Structure of employment across three tiers of governance.', sub: 'In India, the lowest level of governance is the least employed.',
      views: [
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T();
          card.plot(v, C.map(function (c) { return { x: tiers, y: c.v, name: c.n, type: 'scatter', mode: 'lines+markers+text', line: { color: t[c.c], width: c.n === 'India' ? 3 : 2, shape: 'spline' }, marker: { size: 9, color: t[c.c], line: { color: t.surface, width: 2 } },
            text: NARROW ? null : ['', '', c.n], textposition: 'middle right', textfont: { color: t.ink, size: 13 }, cliponaxis: false, hovertemplate: '<b>' + c.n + '</b> (' + c.yr + ')<br>%{x}: %{y}% of public employees<extra></extra>' }; }),
            { yaxis: { title: { text: 'share of public employment (%)' }, range: [0, 80], ticksuffix: '%' }, xaxis: { title: { text: 'Level of government' }, type: 'category' }, margin: { r: NARROW ? 16 : 110 }, hovermode: 'closest',
              showlegend: true, legend: { orientation: 'h', y: 1.1, x: 0, font: { color: t.ink2 } } });
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['Country', 'Year', 'Federal', 'Local', 'State'], C.map(function (c) { return [c.n, c.yr, c.v[0] + '%', c.v[1] + '%', c.v[2] + '%']; }), { hl: function (r) { return r[0] === 'India'; } }); } }],
      source: 'Kapur (2020), Figure 2. India: Ministry of Finance (2012, 2018); China: Ang (2012); United States: US Census Bureau', note: 'Data are for 2011–12 (India), 1998 (China) and 2012–13 (United States). Lines are smoothed through the three tier values.',
      csv: function () { return [['country', 'year', 'federal_pct', 'local_pct', 'state_pct']].concat(C.map(function (c) { return [c.n, c.yr].concat(c.v); })); } });
  };

  FIGS.f3 = function (el) {
    curveCard(el, { fig: 'Figure 3', title: 'GP size and per-capita provision, 2011 levels.', sub: function () { return 'Smaller GPs consistently deliver more.'; }, grid: true,
      inds: [{ key: 'primary_school_pc', label: 'Primary schools' }, { key: 'middle_school_pc', label: 'Middle schools' }, { key: 'secondary_school_pc', label: 'Secondary schools' }, { key: 'health_centre_pc', label: 'Health centres' },
        { key: 'proj_pc', label: 'Nal Jal + Nali Gali' }, { key: 'hhd_piped_pc', label: 'Piped-water households' }, { key: 'nrega_pc_pd', label: 'NREGA persondays' }, { key: 'gpdp_pc', label: 'GPDP expenditure' }],
      note: 'Crosses mark the fitted value at the proposed size of 7,000 people and at the current mean GP size. GPDP expenditure here is planned spending; actual spending is in Figure 4.' });
  };

  FIGS.f4 = function (el) {
    var k = 'spent_pc', c = curve(k);
    new Card(el, { fig: 'Figure 4', title: 'GP size and actual GPDP expenditure per person, 2024–25.', sub: 'Smaller GPs spend more on each resident.',
      views: [
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), tr = curveTraces(k);
          tr.splice(2, 0, { x: c.bins.x, y: c.bins.y, customdata: c.bins.n, type: 'scatter', mode: 'markers', marker: { size: 9, color: alpha(t.accent, .35), line: { color: t.accent, width: 1 } }, hovertemplate: 'Bin mean: ₹%{y:,.0f} per person<br>%{customdata} GPs, mean size %{x:,}<extra></extra>' });
          card.plot(v, tr, deepMerge(curveLayout(k), { yaxis: { tickprefix: '₹', title: { text: '₹ per person' } } }));
        } },
        { key: 'bins', label: 'By GP size', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['GP population (2011)', 'GPs', 'Spent per person', 'Share of planned cost spent'], D.spend_bins.map(function (b) { return [b.bin, fmtUS(b.n), '₹' + fmtUS(b.spent_pp), b.share_spent.toFixed(1) + '%']; })) + '<p class="cap" style="margin:.6rem 0 0">Pooled totals within each size band: total spending divided by total population. The share of planned cost spent is flat at 26–27% across sizes.</p>'; } },
        { key: 'table', label: 'Curve table', icon: 'table', render: function (v) { var t = curveTable([k]); v.innerHTML = tableHTML(t.head, t.rows, { hl: function (r) { return /proposed|current/.test(r[0]); } }); } }],
      source: META[k].src, note: 'Dots are means of adjusted spending in 750-person bins.', learn: function () { return learnHTML([k]); },
      csv: function (s) { return s.view === 'bins' ? [['gp_population_band', 'gps', 'spent_per_person_inr', 'share_of_planned_spent_pct']].concat(D.spend_bins.map(function (b) { return [b.bin, b.n, b.spent_pp, b.share_spent]; })) : curveCSV([k]); } });
  };

  FIGS.f5 = function (el) {
    curveCard(el, { fig: 'Figure 5', title: 'Where larger GPs do better, trunk infrastructure.', grid: true,
      inds: [{ key: 'domestic_power_hours', label: 'Domestic power hours' }, { key: 'major_district_road_share', label: 'Major district road' }, { key: 'mobile_phone_coverage_share', label: 'Mobile coverage' }],
      sub: function (s) { return META[s.ind].t + ', ' + META[s.ind].u + '.'; } });
  };

  FIGS.f6 = function (el) {
    curveCard(el, { noTable: true, fig: 'Figure 6', title: 'No relationship between GP size and alignment with citizen preferences.', grid: true,
      inds: [{ key: 'align19', label: '6a · All 19 schemes' }, { key: 'align5', label: '6b · 5 core schemes' }],
      sub: function (s) { return s.view === 'grid' ? 'Figure 6a: all 19 GPDP scheme heads. Figure 6b: five core schemes.' : (s.ind === 'align19' ? 'Figure 6a: all 19 GPDP scheme heads.' : 'Figure 6b: five core schemes (Nali Gali, Nal Jal, solar lights, toilets, LSBA).'); },
      note: 'Alignment is the within-GP rank correlation between GPDP spending by scheme and the share of citizens asking for each scheme.' });
  };

  FIGS.f7 = function (el) {
    curveCard(el, { fig: 'Figure 7', title: 'Smaller units elect more educated leaders.',
      inds: [{ key: 'muk_edu', label: 'Mukhiya education' }, { key: 'wm_eduyears', label: 'Ward member education' }],
      sub: function (s) { return s.ind === 'muk_edu' ? 'Figure 7a: Mukhiya education, years of schooling.' : 'Figure 7b: Ward member education, years of schooling.'; } });
  };
  FIGS.f8 = function (el) {
    curveCard(el, { noTable: true, fig: 'Figure 8', title: 'Smaller GPs have more elite, but better-connected leaders',
      inds: [{ key: 'muk_repr_gap', label: 'Representativeness gap' }, { key: 'wm_net_bdo', label: 'Ward members who know the BDO' }],
      sub: function (s) { return s.ind === 'muk_repr_gap' ? 'Figure 8a: Mukhiya representativeness gap, standardised (z).' : 'Figure 8b: Ward member–BDO contact, share with the BDO\'s phone number.'; } });
  };
  FIGS.f9 = function (el) {
    curveCard(el, { fig: 'Figure 9', title: 'The frozen decade, 2001–2011 changes by GP size.', grid: true,
      inds: [{ key: 'd_hlth_pc', label: 'Health centres' }, { key: 'd_prim_pc', label: 'Primary schools' }, { key: 'd_pg_index', label: 'Public goods index' }, { key: 'ln_gpop', label: 'Population growth' }],
      sub: function (s) { return META[s.ind].t + ', ' + META[s.ind].u + '.'; } });
  };

  FIGS.f10 = function (el) {
    var pairs = { pg: ['pg_index01', 'pg_index11', 'Public goods index', 'z-score'], hlth: ['hlth01_pc', 'hlth11_pc', 'Health centres per 1,000 people', 'per 1,000 people'] };
    new Card(el, { fig: 'Figure 10', title: 'GP size and per-capita provision, 2001 vs 2011.', sub: function (s) { return 'The GP-size penalty compounds over the years. Showing: ' + pairs[s.ind][2].toLowerCase() + '.'; },
      indicators: [{ key: 'pg', label: 'Public goods index' }, { key: 'hlth', label: 'Health centres' }],
      views: [
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), p = pairs[s.ind];
          var a = curveTraces(p[0], { color: t.cool, name: '2001', noMarkers: true }), b = curveTraces(p[1], { color: t.accent, name: '2011', noMarkers: true });
          var c1 = curve(p[0]), c2 = curve(p[1]); var last = function (c) { return c.y[c.y.length - 1]; };
          card.plot(v, a.concat(b), deepMerge(curveLayout(p[0]), { yaxis: { title: { text: p[3] } }, margin: { r: 50 },
            shapes: [{ type: 'line', x0: 7000, x1: 7000, yref: 'paper', y0: 0, y1: 1, line: { color: t.muted, width: 1, dash: 'dot' } }],
            annotations: [{ x: c1.x[c1.x.length - 1], y: last(c1), text: '<b>2001</b>', xanchor: 'left', showarrow: false, font: { color: t.ink, size: 13 }, xshift: 4 },
              { x: c2.x[c2.x.length - 1], y: last(c2), text: '<b>2011</b>', xanchor: 'left', showarrow: false, font: { color: t.ink, size: 13 }, xshift: 4 },
              { x: 7000, yref: 'paper', y: 1, yanchor: 'bottom', text: 'Proposed 7,000', showarrow: false, font: { size: 12, color: t.muted } }],
            showlegend: true, legend: { orientation: 'h', y: 1.12, x: 0, font: { color: t.ink2 } } }));
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v, s) { var p = pairs[s.ind], tt = curveTable([p[0], p[1]], ['2001', '2011']); v.innerHTML = tableHTML(tt.head, tt.rows, { hl: function (r) { return /proposed/.test(r[0]); } }); } }],
      source: 'Census Village Directories 2001 and 2011, on a consistent GP geography', note: 'Both years plotted against 2011 GP population for the same GPs.',
      learn: function (s) { return learnHTML(pairs[s.ind].slice(0, 2)); },
      csv: function (s) { return curveCSV(pairs[s.ind].slice(0, 2)); } });
  };

  FIGS.f11 = function (el) {
    curveCard(el, { noTable: true, fig: 'Figure 11', title: 'Ward size and outcomes, 2011 levels.', grid: true,
      inds: [{ key: 'ward_overlap', label: 'Priority overlap' }, { key: 'confidence_z_cont', label: 'WM confidence' }, { key: 'combined_knowledge_index_z_cont', label: 'WM knowledge' }, { key: 'wmsat_index', label: 'Citizen satisfaction' }, { key: 'w_availed', label: 'Welfare availed' }, { key: 'w_appavail', label: 'Welfare applied + availed' }],
      sub: function () { return 'All measures are flat against ward population.'; },
      note: 'Crosses mark the proposed ward size of 500 and the current mean ward size in the survey sample.' });
  };

  FIGS.f12 = function (el) {
    var d = [{ n: 'Ward member', v: 37.9, lo: 32, hi: 44 }, { n: 'PHED', v: 34.9, lo: 30, hi: 40 }];
    new Card(el, { fig: 'Figure 12', title: 'Percentage of households with access to piped water in village, 2020.', sub: 'Nal Jal implementation: ward member vs PHED.',
      views: [{ key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
        var t = T();
        card.plot(v, [{ type: 'bar', orientation: 'h', y: d.map(function (x) { return x.n; }).reverse(), x: d.map(function (x) { return x.v; }).reverse(), width: .5,
          marker: { color: [alpha(t.accent, .45), t.accent], cornerradius: 4 },
          error_x: { type: 'data', symmetric: false, array: d.map(function (x) { return x.hi - x.v; }).reverse(), arrayminus: d.map(function (x) { return x.v - x.lo; }).reverse(), color: t.ink2, thickness: 1.5, width: 6 },
          textposition: 'none',
          customdata: d.map(function (x) { return [x.lo, x.hi]; }).reverse(),
          hovertemplate: '<b>%{y}</b>: %{x}% of households<br>95% CI %{customdata[0]}–%{customdata[1]}%<extra></extra>' }],
          { xaxis: { range: [0, NARROW ? 58 : 50], dtick: NARROW ? 20 : 10, ticksuffix: '%', title: { text: 'households with a water connection' } }, yaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 14, color: t.ink } }, margin: { l: 110 }, annotations: d.map(function (x) { return { x: x.hi, y: x.n, text: '<b>' + x.v + '%</b>', xanchor: 'left', xshift: 8, showarrow: false, font: { size: 14, color: t.ink } }; }) }, null, 300);
      } }],
      source: 'GRAMA (2024), village-level piped-water availability data', note: 'Comparing neighbouring wards, PHED-implemented wards have 7.9% to 21.8% fewer connections than ward-member-implemented wards.',
      learn: function () { return '<h4>Background</h4><p>From 2016, Har Ghar Nal ka Jal was implemented by ward members through Ward Implementation and Management Committees (WIMC). From May 2023, responsibility for all wards passed to the Public Health Engineering Department, on the claim that ward members lacked expertise to run and maintain the schemes.</p><h4>What the chart shows</h4><p>Average share of village households with a water connection by implementing agency, with 95% confidence intervals. The full analysis compares neighbouring wards within villages; the gains run mainly through SC/ST ward members, whose wards were prioritised and who face greater local accountability.</p>'; },
      csv: function () { return [['agency', 'pct_households_connected', 'ci_low', 'ci_high']].concat(d.map(function (x) { return [x.n, x.v, x.lo, x.hi]; })); } });
  };

  FIGS.f13 = function (el) {
    var K = D.kadwa, lab = { current: 'Current boundaries', strict: 'Strict rule', closest: 'Closest rule' };
    new Card(el, { fig: 'Figure 13', title: 'Comparison of Current and Proposed GP Splits (Strict and Closest) in Kadwa Block, Katihar', sub: function (s) { return 'Showing: ' + lab[s.alt].toLowerCase() + ', ' + K[s.alt].features.length + ' GPs. Each shape is one GP, shaded by its 2011 population.'; },
      toggle: { label: 'Boundaries', options: [{ key: 'current', label: 'Current · ' + K.current.features.length }, { key: 'strict', label: 'Strict · ' + K.strict.features.length }, { key: 'closest', label: 'Closest · ' + K.closest.features.length }] },
      views: [{ key: 'map', label: 'Map', icon: 'map', render: function (v, s, card) {
        var t = T(), g = K[s.alt];
        card.plot(v, [{ type: 'choropleth', geojson: g, featureidkey: 'id', locations: g.features.map(function (f) { return f.id; }), z: g.features.map(function (f) { return f.properties.pop; }),
          text: g.features.map(function (f) { return f.properties.label; }), zmin: 2000, zmax: 18000, colorscale: t.seq, marker: { line: { color: t.surface, width: 1 } },
          colorbar: { orientation: 'h', y: -0.02, yanchor: 'top', len: 0.6, thickness: 10, outlinewidth: 0, tickfont: { color: t.ink2 }, tickformat: ',d', title: { text: 'GP population (2011)', side: 'top', font: { color: t.muted, size: 12 } } },
          hovertemplate: '<b>%{text}</b><br>%{z:,} people<extra></extra>' }],
          { geo: { fitbounds: 'locations', visible: false, bgcolor: 'rgba(0,0,0,0)', projection: { type: 'mercator' } }, margin: { l: 0, r: 0, t: 0, b: 50 } }, 'tall');
      } }, { key: 'table', label: 'Table', icon: 'table', render: function (v, s) {
        var g = K[s.alt].features.slice().sort(function (a, b) { return b.properties.pop - a.properties.pop; });
        v.innerHTML = tableHTML(['Gram Panchayat', 'Population (2011)'], g.map(function (f) { return [f.properties.label, fmtUS(f.properties.pop)]; }));
      } }],
      source: 'GRAMA boundary simulation on Census 2011 village boundaries and populations', note: 'Simulated GPs are a model of the stated rule, not official boundaries.',
      learn: function () { return '<h4>How the simulation works</h4><p>Starting from the north-west village of the block, villages are visited clockwise in inward spirals and added to the current group only if adjacent to it. A group closes when it reaches 7,000 people (strict) or at whichever total is closer to 7,000 (closest). See Appendix B.</p><h4>Why it matters</h4><p>The same rule produces 51 or 63 GPs in this block depending on a single tie-breaking choice. A published algorithm makes that choice visible and reproducible.</p>'; },
      csv: function (s) { return [['gp', 'population_2011']].concat(K[s.alt].features.map(function (f) { return [f.properties.label, f.properties.pop]; })); } });
  };

  FIGS.f14 = function (el) {
    var rows = D.districts.map(function (r) { return { d: r.district, pop: r.pop, current: r.cur_n, strict: r.strict_n, closest: r.closest_n }; });
    var per = function (r, k) { return 1000 * r[k] / r.pop; };
    var lab = { current: 'Current', strict: 'Strict', closest: 'Closest' };
    var all = []; rows.forEach(function (r) { ['current', 'strict', 'closest'].forEach(function (k) { all.push(per(r, k)); }); });
    var zmin = Math.min.apply(null, all), zmax = Math.max.apply(null, all);
    new Card(el, { fig: 'Figure 14', title: 'Current vs proposed GP count per 1,000 population.', sub: function (s) { return 'The \'closest\' algorithm has the highest density of GPs, and both proposed algorithms are an improvement over the current version.' + (s.view === 'map' ? ' Showing: ' + lab[s.alt].toLowerCase() + '.' : ''); },
      toggle: { label: 'Boundaries', options: [{ key: 'current', label: 'Current' }, { key: 'strict', label: 'Strict' }, { key: 'closest', label: 'Closest' }] },
      views: [
        { key: 'map', label: 'Map', icon: 'map', render: function (v, s, card) {
          var t = T();
          card.plot(v, [{ type: 'choropleth', geojson: D.geo_districts, featureidkey: 'id', locations: rows.map(function (r) { return r.d; }), z: rows.map(function (r) { return per(r, s.alt); }), zmin: zmin, zmax: zmax,
            customdata: rows.map(function (r) { return [r[s.alt], r.pop]; }), colorscale: t.seq, marker: { line: { color: t.surface, width: .8 } },
            colorbar: { orientation: 'h', y: -0.04, yanchor: 'top', len: 0.6, thickness: 10, outlinewidth: 0, tickfont: { color: t.ink2 }, tickformat: '.3f', title: { text: 'GPs per 1,000 people', side: 'top', font: { color: t.muted, size: 12 } } },
            hovertemplate: '<b>%{location}</b><br>%{z:.3f} GPs per 1,000 people<br>%{customdata[0]:,} GPs · %{customdata[1]:,} people<extra></extra>' }],
            { geo: { fitbounds: 'locations', visible: false, bgcolor: 'rgba(0,0,0,0)', projection: { type: 'mercator' } }, margin: { l: 0, r: 0, t: 0, b: 50 } }, 'tall');
        } },
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), r = rows.slice().sort(function (a, b) { return per(a, 'closest') - per(b, 'closest'); }), cols = { current: t.nm, strict: t.cool, closest: t.accent };
          var tr = [{ type: 'scatter', mode: 'lines', x: [].concat.apply([], r.map(function (x) { return [per(x, 'current'), per(x, 'closest'), null]; })), y: [].concat.apply([], r.map(function (x) { return [x.d, x.d, null]; })), line: { color: t.rule, width: 2 }, hoverinfo: 'skip', showlegend: false }];
          ['current', 'strict', 'closest'].forEach(function (k) { tr.push({ type: 'scatter', mode: 'markers', name: lab[k], x: r.map(function (x) { return per(x, k); }), y: r.map(function (x) { return x.d; }), customdata: r.map(function (x) { return x[k]; }), marker: { size: 9, color: cols[k], line: { color: t.surface, width: 1.5 } }, hovertemplate: '<b>%{y}</b> · ' + lab[k] + '<br>%{x:.3f} GPs per 1,000 people (%{customdata:,} GPs)<extra></extra>' }); });
          card.plot(v, tr, { margin: { l: 130, t: 40 }, xaxis: { title: { text: 'GPs per 1,000 people' }, tickformat: '.2f' }, yaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 12 } }, hovermode: 'closest', showlegend: true, legend: { orientation: 'h', y: 1.04, yanchor: 'bottom', x: 0, font: { color: t.ink2 } } }, null, 860);
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['District', 'Population (2011)', 'Current GPs', 'Strict GPs', 'Closest GPs', 'Current per 1,000', 'Closest per 1,000'], rows.map(function (r) { return [r.d, fmtUS(r.pop), fmtUS(r.current), fmtUS(r.strict), fmtUS(r.closest), per(r, 'current').toFixed(3), per(r, 'closest').toFixed(3)]; })); } }],
      hideAltOn: ['chart', 'table'],
      source: 'GRAMA boundary simulation; Census 2011', note: 'Simulated GPs are assigned to districts by location; under 1% fall on district edges and are not counted. State totals: 7,917 current, 11,075 strict, 13,507 closest.',
      csv: function () { return [['district', 'population_2011', 'current_gps', 'strict_gps', 'closest_gps']].concat(rows.map(function (r) { return [r.d, r.pop, r.current, r.strict, r.closest]; })); } });
  };

  FIGS.f15 = function (el) {
    var posts = [['Ward Member', 96.444, 'Ward rep'], ['Panch', 96.444, 'Ward rep'], ['Mukhiya', 40.959, 'GP rep'], ['Up-Mukhiya', 20.4795, 'GP rep'], ['Sarpanch', 40.959, 'GP rep'], ['Up-Sarpanch', 20.4795, 'GP rep'], ['Panchayat Samiti Member', 11.8044, 'GP rep'], ['Zila Parishad Member', 2.7135, 'GP rep'],
      ['Panchayat Secretary', 136.53, 'Officer/staff'], ['Kachahri Secretary', 49.1508, 'Officer/staff'], ['Clerk', 136.53, 'Officer/staff'], ['Executive Assistant', 92.8404, 'Officer/staff'], ['Technical Assistant', 54.624, 'Officer/staff'], ['Accountant-cum-IT Assistant', 40.968, 'Officer/staff'], ['Gram Kachahri Nyaya Mitra', 38.2284, 'Officer/staff']];
    var wf = [['Current<br>spend', 1526.81, 'total'], ['+ Officers<br>& staff', 548.87, 'add'], ['+ GP<br>reps', 137.39, 'add'], ['GPs-only<br>total', 2213.08, 'total'], ['+ Ward<br>reps', 192.89, 'add'], ['New<br>total', 2405.96, 'total']];
    new Card(el, { fig: 'Figure 15', title: 'Current vs new staffing expenditures, INR crores.',
      sub: function (s) { return s.view === 'posts' ? 'Additional annual expenditure by post, INR crore.' : 'The proposed delimitation incurs an additional cost of 57.6 percent, but this can be reduced to 44.9 percent if the ward layer is untouched.'; },
      views: [
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), base = 0, bases = [], vals = [], cols = [];
          wf.forEach(function (w) { if (w[2] === 'total') { bases.push(0); vals.push(w[1]); base = w[1]; cols.push(t.accent); } else { bases.push(base); vals.push(w[1]); base += w[1]; cols.push(alpha(t.accent, .4)); } });
          var SHORTL = ['Now', '+ Staff', '+ GP<br>reps', 'GPs<br>only', '+ Ward<br>reps', 'New<br>total'];
          var labels = wf.map(function (w, i) { return NARROW ? SHORTL[i] : w[0]; });
          card.plot(v, [{ type: 'bar', x: labels, y: bases, marker: { color: 'rgba(0,0,0,0)' }, hoverinfo: 'skip' },
            { type: 'bar', x: labels, y: vals, marker: { color: cols, cornerradius: 3 }, text: wf.map(function (w) { return (w[2] === 'add' ? '+' : '') + fmtUS(w[1], 0); }), textposition: 'outside', textfont: { color: t.ink, size: 13 }, cliponaxis: false,
              customdata: wf.map(function (w) { return w[0].replace('<br>', ' '); }), hovertemplate: '<b>%{customdata}</b>: ₹%{y:,.2f} crore<extra></extra>' }],
            { barmode: 'stack', bargap: .35, yaxis: { title: { text: '₹ crore per year' }, range: [0, 2800], tickformat: ',d' }, xaxis: { type: 'category', tickangle: 0, tickfont: { size: NARROW ? 11 : 12 }, gridcolor: 'rgba(0,0,0,0)' }, margin: { t: 30, b: 70 },
              annotations: [{ x: labels[3], y: 2213.08, yshift: 30, text: '<b>+44.9%</b>', showarrow: false, font: { color: t.accent, size: 13 } }, { x: labels[5], y: 2405.96, yshift: 30, text: '<b>+57.6%</b>', showarrow: false, font: { color: t.accent, size: 13 } }] });
        } },
        { key: 'posts', label: 'By post', icon: 'chart', render: function (v, s, card) {
          var t = T(), r = posts.slice().sort(function (a, b) { return a[1] - b[1]; }), cm = { 'Ward rep': t.cool, 'GP rep': t.ochre, 'Officer/staff': t.accent };
          var tr = ['Officer/staff', 'GP rep', 'Ward rep'].map(function (g) {
            var nm = { 'Officer/staff': 'Officers and staff (per GP)', 'GP rep': 'GP-level representatives', 'Ward rep': 'Ward-level representatives' }[g];
            var f = r.filter(function (p) { return p[2] === g; });
            return { type: 'bar', orientation: 'h', name: nm, y: f.map(function (p) { return p[0]; }), x: f.map(function (p) { return p[1]; }), marker: { color: cm[g], cornerradius: 3 }, hovertemplate: '<b>%{y}</b>: +₹%{x:,.1f} crore a year<extra>' + nm + '</extra>' };
          });
          card.plot(v, tr, { margin: { l: 190, t: 40 }, yaxis: { categoryorder: 'array', categoryarray: r.map(function (p) { return p[0]; }), gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 12 } }, xaxis: { title: { text: 'additional ₹ crore per year' } }, hovermode: 'closest', showlegend: true, legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, font: { color: t.ink2 } } }, null, 560);
        } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v) { v.innerHTML = tableHTML(['Item', '₹ crore per year'], wf.map(function (w) { return [w[0].replace('<br>', ' '), fmtUS(w[1], 2)]; })) + '<div style="height:.8rem"></div>' + tableHTML(['Post', 'Group', 'Additional ₹ crore per year'], posts.map(function (p) { return [p[0], p[2], fmtUS(p[1], 2)]; })); } }],
      source: 'Bihar Panchayati Raj Department, GP Delimitation Record, Section 7 tables (a) and (b)', note: 'Excludes the cost of new buildings and new hiring beyond existing post structures.',
      learn: function () { return '<h4>What the numbers cover</h4><p>Annual honoraria and salaries for elected representatives and for GP officers and staff, before and after delimitation (4,551 new GPs and 66,975 new wards). Officer and staff posts are assigned per GP. Honoraria that scale with GP count total ₹137.4 crore: Mukhiya, Up-Mukhiya, Sarpanch and Up-Sarpanch (₹122.9 crore) plus Panchayat Samiti and Zila Parishad members (₹14.5 crore). Ward Member and Panch honoraria (₹192.9 crore) come only from new wards.</p><h4>The saving</h4><p>Redrawing GPs while keeping current wards avoids ₹192.9 crore a year, about 22% of the ₹879 crore increase.</p>'; },
      csv: function (s) { return s.view === 'posts' ? [['post', 'group', 'additional_inr_crore']].concat(posts) : [['item', 'inr_crore']].concat(wf.map(function (w) { return [w[0].replace('<br>', ' '), w[1]]; })); } });
  };

  FIGS.t3 = function (el) {
    var P = { a: { n: 'All GPs (N = 8,262)', rows: [['Any category', 11.8, 45.6, 42.6], ['SC', 0.1, 33.0, 66.9], ['ST', 0.0, 1.8, 98.2], ['OBC', 0.0, 34.2, 65.8]] },
      b: { n: 'Middle tercile of SC share (N = 2,754)', rows: [['Any category', 9.4, 42.4, 48.1], ['SC', 0.0, 25.8, 74.2], ['ST', 0.0, 1.2, 98.8], ['OBC', 0.0, 34.2, 65.8]] } };
    var segs = ['Reserved both cycles', 'Reserved in 2006 or 2016', 'Never reserved'];
    new Card(el, { fig: 'Table 3', title: 'GPs by reservation status, 2006 and 2016', sub: function (s) { return s.alt === 'a' ? 'Panel A: GPs by reservation status, 2006 and 2016 (N = 8,262).' : 'Panel B: GPs in the middle tercile of SC population share (N = 2,754), where reservation\'s long-run effect is strongest.'; },
      toggle: { label: 'Panel', options: [{ key: 'a', label: 'Panel A · All GPs' }, { key: 'b', label: 'Panel B · Middle SC tercile' }] },
      views: [
        { key: 'chart', label: 'Chart', icon: 'chart', render: function (v, s, card) {
          var t = T(), cols = [t.accent, alpha(t.accent, .45), alpha(t.nm, .3)], rows = P[s.alt].rows.slice().reverse();
          card.plot(v, segs.map(function (sg, i) { return { type: 'bar', orientation: 'h', name: sg, y: rows.map(function (r) { return r[0]; }), x: rows.map(function (r) { return r[i + 1]; }), marker: { color: cols[i], line: { color: t.surface, width: 2 } },
            text: rows.map(function (r) { return r[i + 1] >= 6 ? r[i + 1].toFixed(1) + '%' : ''; }), textposition: 'inside', insidetextanchor: 'middle', textfont: { color: i === 0 ? t.surface : t.ink, size: 12 },
            hovertemplate: '<b>%{y}</b> · ' + sg + ': %{x:.1f}%<extra></extra>' }; }),
            { barmode: 'stack', xaxis: { range: [0, 100], ticksuffix: '%', title: { text: 'share of GPs' } }, yaxis: { gridcolor: 'rgba(0,0,0,0)', tickfont: { size: 13, color: t.ink } }, margin: { l: 110, t: 40 }, hovermode: 'closest', showlegend: true, legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0, traceorder: 'normal', font: { color: t.ink2 } } }, null, 340);
          } },
        { key: 'table', label: 'Table', icon: 'table', render: function (v, s) { v.innerHTML = tableHTML(['Reserved group'].concat(segs), P[s.alt].rows.map(function (r) { return [r[0], r[1].toFixed(1) + '%', r[2].toFixed(1) + '%', r[3].toFixed(1) + '%']; })); } }],
      source: 'State Election Commission, GP reservation status 2006 and 2016', note: 'See footnote 5.',
      learn: function () { return '<h4>Why Panel B matters</h4><p>Previously reserved GPs are 11.3 percentage points more likely to elect an SC head after reservation ends (Kumar and Sharan, 2026). The effect is strongest where SCs are a middle-sized share of the population (around 16%), too few to win office without reservation. These GPs are more likely never to have been reserved for SCs (74.2% vs 66.9%).</p>'; },
      csv: function (s) { return [['group'].concat(segs)].concat(P[s.alt].rows); } });
  };

  /* ---------- Table 4 ---------- */
  var T4 = [
    ['GP map frozen since 1991; severely out of date', 'Section 2', 'Avg. GP population: 6,883 (1991) to 8,832 (2001) to 10,961 (2011); Bihar\'s GPs are 4th-largest nationally at 11,470 vs. 3,418 national mean.', 'Proceed with delimitation on the 2011 census base without further delay.'],
    ['Boundary-drawing is currently left to district discretion', 'Section 6', 'Two internally consistent algorithms applied to the same rule produce materially different maps.', 'Adopt a transparent, fully algorithmic, rules-based boundary-drawing method to remove scope for informal favoritism.'],
    ['Large-GP penalty is real, and has been compounding', 'Section 4', 'Smaller GPs deliver more schools, health centres, water/sanitation access, NREGA workdays, and GPDP spending per capita; the composite public-goods-index slope roughly quadrupled between 2001 and 2011.', 'Further steps, like regularly updating boundaries as the population changes, are needed in addition to this delimitation to reduce the widening gap in welfare outcomes.'],
    ['Large-scale infrastructure favors bigger units', 'Section 4', 'Domestic power, paved roads, and mobile coverage all rise with GP size (economies of scale in lumpy capital investment).', 'Provision trunk infrastructure at the block/district level regardless of GP size, rather than treating it as a reason to keep GPs large.'],
    ['Whether 7,000 is small enough', 'Section 4', 'No curvature detected in the 5,000–20,000 window; comparable Uttar Pradesh evidence finds continued gains down to 1,000–2,500 people per GP.', 'Consider a materially smaller target than 7,000; nothing in the data says gains stop there.'],
    ['Ward layer shows no effect from size or headcount', 'Section 5', 'Ward population, ward-member count, and Dalit-ward-member count are statistically unrelated to WM confidence/knowledge, citizen satisfaction, priority alignment, and public-goods delivery.', 'Consolidate wards into fewer, more substantive seats; pair with peer-learning investment rather than multiplying powerless seats.'],
    ['Centralizing local implementation reduces delivery', 'Section 5', 'PHED-run Nal Jal wards have 7.9–21.8% fewer piped-water connections than ward-member-run wards.', 'Preserve or restore implementation authority to ward members for schemes suited to local execution.'],
    ['Delimitation will mechanically shrink Dalit representation', 'Section 8', 'Additional Dalit ward members raise NREGA persondays by 15% (34% with three or more); fewer, larger wards reduce their absolute number.', 'Set a floor of 2 SC ward members per GP (capped around 5), even where the proportional rule implies fewer.'],
    ['Resetting the reservation rotation strips a long-run benefit', 'Section 8', 'Never-reserved GPs won only 1.6% of Mukhiya seats vs. 15.5% SC population share (2001); formerly-reserved GPs are 11.3pp more likely to elect an SC head even after reservation lapses.', 'Carry forward existing reservation status into new GP boundaries; define a rule for which successor GP inherits status when a GP splits.'],
    ['Delimitation has a direct fiscal cost', 'Section 7', 'Representative and staff expenditure rises an estimated 58% (+₹879 crore a year) under the proposed map.', 'Budget explicitly for the increase; align with the XVI Finance Commission\'s OSR-linked Performance Grant to help offset it.'],
    ['Transition to new boundaries is the biggest execution risk', 'Section 9', 'Bihar\'s own panchayat elections lapsed for 23 years (1978–2001); Karnataka evidence shows bureaucrat-run GPs spend less on citizen priorities and deliver fewer NREGS workdays than elected ones.', 'Set a hard statutory deadline for a GIS-assisted delimitation and hold elections on schedule; delimitation should be faster and better, not paused.']];
  $('#t4').innerHTML = T4.map(function (r, i) { return '<details' + (i === 0 ? ' open' : '') + '><summary><span class="k">' + (i + 1) + '</span><span class="h">' + esc(r[0]) + '</span><span class="s">' + r[1] + '</span></summary><div class="b"><p><strong>Evidence:</strong> ' + esc(r[2]) + '</p><p><strong>Recommendation:</strong> ' + esc(r[3]) + '</p></div></details>'; }).join('');

  /* ---------- mount ---------- */
  var mounted = new Map();
  function mount(el) { if (mounted.has(el)) return; var f = FIGS[el.dataset.fig]; if (!f) return; mounted.set(el, true); f(el); }
  var figs = Array.from(document.querySelectorAll('.grapher[data-fig]'));
  if (typeof Plotly === 'undefined') {
    figs.forEach(function (el) { el.innerHTML = '<p class="g-sub">The interactive chart library did not load. Check your connection and reload the page.</p>'; });
    return;
  }
  figs.forEach(function (el) { try { mount(el); } catch (e) { console.error(el.id, e); } });
  if (location.hash) { var tgt = document.getElementById(location.hash.slice(1)); if (tgt) setTimeout(function () { tgt.scrollIntoView(); }, 50); }

  /* rerender on theme change */
  var rerender = function () { CARDS.forEach(function (c) { c.render(); }); };
  var rzT; addEventListener('resize', function () { clearTimeout(rzT); rzT = setTimeout(function () { var n = window.innerWidth < 640; if (n !== NARROW) { NARROW = n; rerender(); } }, 200); });
  if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', rerender) : mq.addListener(rerender)); }
  new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- scroll spy + progress ---------- */
  var links = Array.from(document.querySelectorAll('#toc a')), secs = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  var prog = $('#progress');
  function onScroll() {
    var y = window.scrollY + 120, cur = 0;
    secs.forEach(function (s, i) { if (s && s.offsetTop <= y) cur = i; });
    links.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
    var h = document.documentElement.scrollHeight - innerHeight; prog.style.width = (h > 0 ? 100 * scrollY / h : 0) + '%';
  }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  $('#cite-copy').addEventListener('click', function () { copyText($('#cite-text').textContent, 'Citation copied'); });
})();
