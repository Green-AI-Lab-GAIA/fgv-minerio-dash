/* Conhecimento do Subsolo — map of where NI 43-101 reports bring ground data in Brazil.
   Data come from data/*.json (built by preparar_dados.py from geo_brasil.gpkg) and, optionally,
   data/sgb*.json (built by preparar_sgb.py from the scrapers_sgb output: SGB/CPRM public data).
   Layers: points (hexbin heatmap or markers), ANM processes (centroid in the heatmap, polygon as marker),
   municipalities (choropleth). Every colour can be traced back to the reports through tooltip and click. */
(() => {
  'use strict';
  const TIPO_COR = ['#1F6B5C', '#7A4C8C', '#B5791F', '#3D6E8C', '#B5502E', '#6B6A26', '#8C6A4C', '#8A8F86'];
  const TIPO_NOME = {furo: 'furo de sondagem', amostra: 'amostra', trincheira: 'trincheira', 'centro do projeto': 'centro do projeto',
    deposito: 'depósito', alvo: 'alvo', vertice: 'vértice de área', outro: 'outro ponto'};
  const PREC_NOME = ['coordenada informada', 'zona UTM inferida'];
  // colour ramps: light theme goes light -> dark, dark theme dark -> light, so the cells with the most data are
  // always the ones that stand out from the background (the legend gradients in the CSS follow the same stops)
  const RAMPS = {
    seq: {light: ['#F2F9F7', '#93CDC0', '#57A395', '#1F6B63', '#0E3A35'], dark: ['#21433D', '#2E6D61', '#43A08C', '#86D4C0', '#E2FAF2']},
    warm: {light: ['#FCF6EC', '#E6C68E', '#C9944A', '#9A6420', '#5E3A10'], dark: ['#3D2C15', '#7A5422', '#B8853D', '#E2B86F', '#FCEDD0']},
  };
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
  const ramp = name => d3.interpolateRgbBasis(RAMPS[name][isDark() ? 'dark' : 'light']);
  const fmt = d3.format(',d');
  const fmt1 = v => v >= 10 ? fmt(Math.round(v)) : d3.format('.1f')(v);
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  // SGB/CPRM layers: points go into the heatmap (metrics "tipos" and "registros") or are drawn on a canvas as
  // markers; areas are outlines drawn above the municipalities in both modes; the two country-wide maps
  // (geology, hydrogeology) are filled by category under everything else. Layers with `lazy` live in their own
  // file, fetched the first time the layer is turned on.
  const SGB_PT = [
    {k: 'ocorr', nome: 'Ocorrências minerais', sub: 'minas, garimpos, depósitos e indícios (GeoSGB)', cor: '#C0392B', curto: 'ocorrências'},
    {k: 'recmin', nome: 'Recursos minerais PDAC', sub: 'minas e depósitos com porte, 2024 (P3MGeo)', cor: '#7A4C8C', curto: 'recursos PDAC'},
    {k: 'geoq', nome: 'Amostras geoquímicas', sub: 'sedimento, solo, rocha, bateia (GeoSGB) · 10 MB, carrega ao ligar', cor: '#3D6E8C', curto: 'amostras geoq.', lazy: 'sgb_geoquimica'},
    {k: 'geocron', nome: 'Geocronologia', sub: 'amostras datadas: U-Pb, Sm-Nd, Pb-Pb… (GeoSGB)', cor: '#B5791F', curto: 'datações'},
    {k: 'grav', nome: 'Gravimetria', sub: 'estações gravimétricas terrestres (GeoSGB)', cor: '#6B6A26', curto: 'estações grav.'},
    {k: 'mt', nome: 'Magnetotelúrico', sub: 'estações MT (GeoSGB)', cor: '#1F6B5C', curto: 'estações MT'},
    {k: 'pocos', nome: 'Poços (SIAGAS / RIMAS)', sub: 'poços tubulares, de monitoramento, nascentes (GeoSGB)', cor: '#1A9BB0', curto: 'poços'},
    {k: 'fontes', nome: 'Fontes hidrominerais', sub: 'municípios com fontes cadastradas (GeoSGB)', cor: '#5B8C3A', curto: 'fontes hidromin.'},
    // theses have no coordinates: preparar_bdtd.py places each one at the towns/districts named in its title or subjects
    {k: 'teses', nome: 'Teses e dissertações', sub: 'geologia e mineração, no lugar citado no título · carrega ao ligar', cor: '#8C4A6B', curto: 'teses', lazy: 'bdtd', src: 'BDTD', grp: 'teses'},
  ];
  const SGB_AREA = [
    {k: 'aero', nome: 'Aerolevantamentos', sub: 'magnetometria, gamaespectrometria… (GeoSGB)', cor: '#2F6FA8'},
    {k: 'geoqproj', nome: 'Projetos geoquímicos', sub: 'área de cada projeto, com relatório no RIGeo', cor: '#7A4C8C'},
    {k: 'folhas', nome: 'Folhas geológicas', sub: 'mapeamento sistemático 1:50.000 a 1:1.000.000, PDF no RIGeo (PDAC)', cor: '#B5791F'},
    {k: 'distau', nome: 'Distritos auríferos', sub: 'distritos de ouro (P3MGeo)', cor: '#C0392B'},
    {k: 'provau', nome: 'Províncias auríferas', sub: 'províncias de ouro (P3MGeo)', cor: '#D4A017'},
  ];
  const ERA_COR = {'Cenozóico': '#F2F91D', 'Mesozóico': '#67C5CA', 'Paleozóico': '#99C08D', 'Neoproterozóico': '#FEB342',
    'Mesoproterozóico': '#F9D8A0', 'Paleoproterozóico': '#F74370', 'Neoarqueano': '#F99BC1', 'Mesoarqueano': '#F768A9',
    'Paleoarqueano': '#F4449F', 'Eoarqueano': '#DA037F'};
  const HIDRO_COR = {'Formações cenozóicas': '#E8D16A', 'Bacias sedimentares': '#5DA9D6', 'Poroso/Fissural': '#7FC2A9',
    'Carbonatos-Metacarbonatos': '#6C8FC7', 'Metassedimentos-Metavulcânicas': '#9C7FB0', 'Vulcânicas': '#C0605A', 'Cristalino': '#C9A27E'};
  const SGB_COV = [
    {k: 'geol', nome: 'Geologia do Brasil 1:2,5M', sub: 'unidades litoestratigráficas, cor pela era (GeoSGB) · 7 MB', cor: '#F74370', lazy: 'sgb_geologia', pal: ERA_COR, catNome: 'era'},
    {k: 'hidro', nome: 'Domínios hidrogeológicos', sub: 'cor pelo domínio (GeoSGB) · 9 MB', cor: '#5DA9D6', lazy: 'sgb_hidro', pal: HIDRO_COR, catNome: 'domínio'},
  ];
  SGB_COV.forEach(d => { d.cov = true; });
  const SGB_POLY = SGB_COV.concat(SGB_AREA);  // drawing order: background maps first
  const SGB_ALL = SGB_PT.concat(SGB_POLY), SGB_DEF = Object.fromEntries(SGB_ALL.map(d => [d.k, d]));

  let DOCS, PTS, PROC, MUNREF, META, TOPO, SGB = null;
  const S = {
    layers: {pontos: true, processos: true, municipios: false}, modo: 'hex', hexKm: 50, metrica: 'docs',
    tipos: new Set(), precisao: new Set([0, 1]), ufconf: false, info: new Set(), comm: new Set(),
    anoMin: 0, anoMax: 9999, soNovos: false, busca: '', sel: null,
    sgb: Object.fromEntries(SGB_ALL.map(d => [d.k, false])), geoqCl: new Set(), ocIm: new Set(), folEsc: new Set(),
    tesPr: new Set([0, 1, 3]),                               // thesis location precision: município, região, resumo (estado off)
    vmin: null, vmax: null,                                  // show only areas whose value is within [vmin, vmax]
    scale: {hex: {lo: null, hi: null}, mun: {lo: null, hi: null}},  // manual colour-scale ends (null = data extremes)
  };
  let svg, gRoot, gMun, gHex, gHexFree, gMark, projection, pxPerKm, zoomK = 1, zoom, munPaths, munFeatures;
  let hexKmShown = null, hexBox = null, rehexTimer = null;
  let F = null; // current filtered data
  let gCov, gOvl, canvas, W0, H0, zT = d3.zoomIdentity, sgbTree = null, sgbTip = false, drawPending = false;

  // ---------- load ----------
  // the SGB files are optional: without them the dashboard works as before
  const optional = url => d3.json(url).catch(() => null);
  Promise.all(['docs', 'pontos', 'processos', 'municipios', 'meta'].map(n => d3.json(`data/${n}.json`))
    .concat(d3.json('data/brasil_municipios.topojson'), optional('data/sgb.json')))
    .then(([docs, pts, proc, mun, meta, topo, sgb]) => {
      DOCS = docs; PTS = pts; PROC = proc; MUNREF = mun; META = meta; TOPO = topo;
      if (sgb) prepSgb(sgb);
      DOCS.forEach(d => { d.y = +d.d.slice(0, 4) || 0; d.h = `${d.t} ${d.e} ${d.pr}`.toLowerCase(); });
      S.tipos = new Set(META.tipos.map((_, i) => i));
      S.anoMin = META.ano_min; S.anoMax = META.ano_max;
      $('metaFonte').textContent = `fonte: SEDAR+ · ${META.n_docs} relatórios · gerado ${META.gerado}` + (SGB ? ` · SGB/CPRM ${SGB.gerado}` : '')
        + (SGB?.bdtd ? ` · BDTD ${SGB.bdtd.gerado}` : '');
      buildControls();
      buildMap();
      $('loading').remove();
      update();
    })
    .catch(err => { $('loading').textContent = 'erro ao carregar dados: ' + err; console.error(err); });

  // ---------- SGB data ----------
  function prepSgb(sgb) {
    SGB = sgb;
    SGB.cat = {};
    SGB_PT.forEach(d => SGB.camadas[d.k] && prepPoints(d.k));
    SGB_POLY.forEach(d => SGB.camadas[d.k] && prepAreas(d.k));
    const L = SGB.camadas;
    S.ocIm = new Set(L.ocorr ? L.ocorr.im_l.map((_, i) => i) : []);
    S.folEsc = new Set(L.folhas ? L.folhas.map(a => a.esc) : []);
  }
  function prepPoints(k) {
    const o = SGB.camadas[k], comm = SGB.comm, docT = di => di >= 0 ? SGB.docs[di].t : '';
    o.n = o.x.length;
    // haystack for the free-text search
    const hay = f => { o.h = []; for (let i = 0; i < o.n; i++) o.h.push(f(i).toLowerCase()); };
    if (k === 'ocorr') hay(i => `${o.nm[i]} ${o.mun[i]} ${o.uf[i]} ${o.ro[i]} ${o.c[i].map(c => comm[c]).join(' ')}`);
    if (k === 'recmin') hay(i => `${o.nm[i]} ${o.ce[i]} ${o.ot[i]} ${o.c[i].map(c => comm[c]).join(' ')}`);
    if (k === 'geocron') hay(i => `${o.am[i]} ${o.ro[i]} ${o.me[i]}`);
    if (k === 'pocos') hay(i => `${o.nm[i]} ${o.aq[i]} ${o.mun[i]} ${o.uf[i]} ${o.nat_l[o.nat[i]]} ${o.uso[i]} ${o.src_l[o.src[i]]}`);
    if (k === 'fontes') hay(i => `${o.nm[i]} ${o.uf[i]} fonte hidromineral`);
    if (k === 'teses') hay(i => `${o.T.h[o.d[i]]} ${o.lg_l[o.lg[i]]}`);
    if (k === 'geoq') o.pj_l.forEach(p => { p.h = `${p.t} ${docT(p.doc)}`.toLowerCase(); });
    if (k === 'mt') o.pj_h = o.pj_l.map(t => t.toLowerCase());
    if (o.c) o.cn = o.c.map(cs => cs.map(c => comm[c]));
    if (projection) projectPoints(k);
  }
  function projectPoints(k) {
    const o = SGB.camadas[k];
    o.px = new Float32Array(o.n); o.py = new Float32Array(o.n);
    for (let i = 0; i < o.n; i++) { const xy = projection([o.x[i], o.y[i]]); o.px[i] = xy[0]; o.py[i] = xy[1]; }
  }
  function prepAreas(k) {
    const docT = di => di >= 0 ? SGB.docs[di].t : '', cat = SGB.cat[k] || [];
    SGB.camadas[k].forEach(a => {
      a.hs = [a.t, a.cod, a.esc, a.prov, a.pg, a.ug, a.uf, a.ct, a.s, a.li, a.sd, a.am, cat[a.c], docT(a.doc ?? -1)]
        .filter(Boolean).join(' ').toLowerCase();
      a.bb = [Infinity, Infinity, -Infinity, -Infinity];
      a.g.forEach(r => r.forEach(([x, y]) => { a.bb[0] = Math.min(a.bb[0], x); a.bb[1] = Math.min(a.bb[1], y); a.bb[2] = Math.max(a.bb[2], x); a.bb[3] = Math.max(a.bb[3], y); }));
    });
    if (projection) projectAreas(k);
  }
  function projectAreas(k) {
    SGB.camadas[k].forEach(a => {
      a.d = a.g.map(r => 'M' + r.map(c => projection(c).map(v => v.toFixed(1)).join(',')).join('L') + 'Z').join('');
    });
  }
  // fetch a layer that lives in its own file (big ones), once
  const lazyLoads = {};
  function loadLazy(d) {
    if (!lazyLoads[d.k]) lazyLoads[d.k] = d3.json(`data/${d.lazy}.json`).then(data => {
      if (d.cov) { SGB.camadas[d.k] = data.items; SGB.cat[d.k] = data.cat_l; prepAreas(d.k); }
      else { SGB.camadas[d.k] = data; prepPoints(d.k); }
      if (d.k === 'geoq') buildGeoqChips();
      if (d.k === 'teses') buildTesChips();
    }).catch(err => { delete lazyLoads[d.k]; throw err; });
    return lazyLoads[d.k];
  }
  function buildGeoqChips() {
    const o = SGB.camadas.geoq, n = o.cl_l.map(() => 0);
    o.cl.forEach(c => n[c]++);
    S.geoqCl = new Set(o.cl_l.map((_, i) => i));
    $('chipsGeoq').innerHTML = '';
    o.cl_l.map((t, i) => [t, i]).sort((a, b) => n[b[1]] - n[a[1]])
      .forEach(([t, i]) => chip($('chipsGeoq'), t, true, () => toggle(S.geoqCl, i)).insertAdjacentHTML('beforeend', ` <span class="n">${fmt(n[i])}</span>`));
  }
  function buildTesChips() {
    const o = SGB.camadas.teses, n = o.p_l.map(() => new Set());
    o.p.forEach((p, i) => n[p].add(o.d[i]));
    const nome = {municipio: 'município', regiao: 'distrito/região mineral', resumo: 'citado só no resumo', estado: 'só o estado'};
    $('chipsTesPr').innerHTML = '';
    ['municipio', 'regiao', 'resumo', 'estado'].map(t => o.p_l.indexOf(t)).filter(i => i >= 0).forEach(i => chip($('chipsTesPr'), nome[o.p_l[i]], S.tesPr.has(i), () => toggle(S.tesPr, i))
      .insertAdjacentHTML('beforeend', ` <span class="n">${fmt(n[i].size)}</span>`));
  }
  const sgbOn = () => SGB_PT.some(d => S.sgb[d.k]);
  const sgbAreasOn = () => SGB_POLY.some(d => S.sgb[d.k]);
  const sgbMetric = () => S.metrica === 'tipos' || S.metrica === 'registros';

  function buildSgbControls() {
    if (!SGB) return;
    const L = SGB.camadas;
    $('sgbGroup').hidden = false; $('sgbFiltros').hidden = false; $('commNota').hidden = false;
    $('sgbGerado').textContent = `Bases SGB exportadas em ${SGB.gerado}.`;
    const nOf = d => d.k === 'teses' && SGB.bdtd ? SGB.bdtd.teses : SGB.n?.[d.k] ?? (L[d.k] ? (L[d.k].n ?? L[d.k].length) : 0);
    const item = (box, d, area) => {
      const lab = document.createElement('label');
      lab.className = 'layer-item';
      const sub = d.k === 'pocos' && L.pocos ? `${d.sub} · SIAGAS só ${L.pocos.siagas_ufs.join(', ') || '—'}; RIMAS no país`
        : d.k === 'teses' && SGB.bdtd ? `${d.sub} · ${fmt(SGB.bdtd.teses)} das ${fmt(SGB.bdtd.total)} coletadas citam um lugar` : d.sub;
      lab.innerHTML = `<input type="checkbox" data-sgb="${d.k}"><span class="sw${area ? ' area' : ''}" style="background:${d.cor};border-color:${d.cor}"></span>
        <span><b><span class="src ${d.src ? d.src.toLowerCase() : 'sgb'}">${d.src || 'SGB'}</span>${esc(d.nome)}<span class="n">${fmt(nOf(d))}</span></b><small>${esc(sub)}</small></span>`;
      const inp = lab.querySelector('input'), small = lab.querySelector('small');
      inp.onchange = async () => {
        if (inp.checked && d.lazy && !L[d.k]) {
          small.textContent = 'carregando…'; inp.disabled = true;
          try { await loadLazy(d); small.textContent = sub; }
          catch (err) { console.error(err); small.textContent = 'erro ao carregar — tente de novo'; inp.checked = false; }
          inp.disabled = false;
        }
        const wasOn = sgbOn();
        S.sgb[d.k] = inp.checked;
        // the SEDAR metrics ignore SGB points: switch the colour to "Tipos de dado" when the first SGB point layer goes on
        // (theses alone: "Registros", since one layer makes every cell 1 in "Tipos de dado")
        if (!area && !wasOn && sgbOn() && !sgbMetric()) setMetric(d.k === 'teses' ? 'registros' : 'tipos');
        $('sgbNone').hidden = !sgbOn() && !sgbAreasOn();
        update();
      };
      box.appendChild(lab);
    };
    const has = d => L[d.k] || (d.lazy && nOf(d));
    SGB_PT.forEach(d => has(d) && item(d.grp === 'teses' ? $('sgbTeses') : $('sgbPontos'), d, false));
    $('tesesGroup').hidden = !has(SGB_DEF.teses);
    SGB_AREA.forEach(d => has(d) && item($('sgbAreas'), d, true));
    SGB_COV.forEach(d => has(d) && item($('sgbFundo'), d, true));
    $('sgbNone').onclick = () => {
      document.querySelectorAll('input[data-sgb]').forEach(i => { i.checked = false; S.sgb[i.dataset.sgb] = false; });
      $('sgbNone').hidden = true; update();
    };
    if (L.folhas) {
      const n = d3.rollup(L.folhas, v => v.length, a => a.esc);
      [...n.keys()].forEach(e => chip($('chipsFolhas'), e, true, () => toggle(S.folEsc, e)).insertAdjacentHTML('beforeend', ` <span class="n">${fmt(n.get(e))}</span>`));
    }
    if (L.ocorr) {
      const n = L.ocorr.im_l.map(() => 0); L.ocorr.im.forEach(c => n[c]++);
      L.ocorr.im_l.forEach((t, i) => chip($('chipsOcorr'), t, true, () => toggle(S.ocIm, i)).insertAdjacentHTML('beforeend', ` <span class="n">${fmt(n[i])}</span>`));
    }
  }
  function setMetric(m) {
    S.metrica = m; resetScale('hex'); resetScale('mun');
    document.querySelectorAll('#metricaToggle button').forEach(b => b.classList.toggle('active', b.dataset.m === m));
  }

  // ---------- controls ----------
  function chip(container, label, on, onClick, extra = '') {
    const b = document.createElement('button');
    b.className = 'chip' + (on ? ' on' : '');
    b.innerHTML = extra + esc(label);
    b.onclick = () => { onClick(); b.classList.toggle('on'); update(); };
    container.appendChild(b);
    return b;
  }

  function buildControls() {
    const nTipo = META.tipos.map(() => 0);
    PTS.forEach(p => nTipo[p[2]]++);
    META.tipos.forEach((t, i) => chip($('chipsTipos'), TIPO_NOME[t] || t, true,
      () => toggle(S.tipos, i), `<span class="dot" style="background:${TIPO_COR[i]}"></span>`).insertAdjacentHTML('beforeend', ` <span class="n">${fmt(nTipo[i])}</span>`));
    PREC_NOME.forEach((t, i) => chip($('chipsPrecisao'), t, true, () => toggle(S.precisao, i)));
    const nInfo = {};
    DOCS.forEach(d => d.i.forEach(x => nInfo[x] = (nInfo[x] || 0) + 1));
    META.info.filter(x => nInfo[x]).forEach(x => chip($('chipsInfo'), x, false, () => toggle(S.info, x))
      .insertAdjacentHTML('beforeend', ` <span class="n">${nInfo[x]}</span>`));
    META.commodities.slice(0, 18).forEach(c => chip($('chipsComm'), c, false, () => toggle(S.comm, c))
      .insertAdjacentHTML('beforeend', ` <span class="n">${META.commodities_n[c]}</span>`));

    document.querySelectorAll('#layerList input').forEach(inp => inp.onchange = () => { S.layers[inp.dataset.layer] = inp.checked; update(); });

    segmented('modoToggle', 'modo', v => { S.modo = v; $('hexOpts').hidden = v !== 'hex'; });
    segmented('metricaToggle', 'm', v => { S.metrica = v; resetScale('hex'); resetScale('mun'); });
    const readNum = el => el.value === '' || isNaN(+el.value) ? null : +el.value;
    const syncRange = () => {
      S.vmin = readNum($('vMin')); S.vmax = readNum($('vMax'));
      $('vClear').hidden = S.vmin === null && S.vmax === null;
    };
    ['vMin', 'vMax'].forEach(id => $(id).oninput = () => { syncRange(); clearTimeout(t); t = setTimeout(update, 250); });
    $('vClear').onclick = () => { $('vMin').value = $('vMax').value = ''; syncRange(); update(); };
    document.querySelectorAll('.legend-bar[data-key]').forEach(bar => {
      const key = bar.dataset.key;
      bar.querySelectorAll('.leg-input').forEach(inp => {
        const apply = () => { S.scale[key][inp.dataset.end] = readNum(inp); key === 'hex' ? renderHex() : renderMun(); };
        inp.onchange = apply;
        inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { S.scale[key][inp.dataset.end] = null; inp.blur(); apply(); } };
        inp.onfocus = () => inp.select();
      });
      bar.querySelector('.leg-reset').onclick = () => { resetScale(key); key === 'hex' ? renderHex() : renderMun(); };
    });
    let t;
    $('hexSize').oninput = e => { S.hexKm = +e.target.value; hexTitle(); clearTimeout(t); t = setTimeout(update, 60); };
    $('busca').oninput = e => { S.busca = e.target.value.trim().toLowerCase(); clearTimeout(t); t = setTimeout(update, 200); };
    $('soUfConfere').onchange = e => { S.ufconf = e.target.checked; update(); };
    $('soNovos').onchange = e => { S.soNovos = e.target.checked; update(); };

    const [mn, mx] = [$('anoMin'), $('anoMax')];
    [mn, mx].forEach(el => { el.min = META.ano_min; el.max = META.ano_max; el.step = 1; });
    mn.value = META.ano_min; mx.value = META.ano_max;
    const syncYears = () => {
      if (+mn.value > +mx.value) [mn.value, mx.value] = [mx.value, mn.value];
      S.anoMin = +mn.value; S.anoMax = +mx.value;
      $('anoMinVal').textContent = S.anoMin; $('anoMaxVal').textContent = S.anoMax;
    };
    syncYears();
    [mn, mx].forEach(el => el.oninput = () => { syncYears(); clearTimeout(t); t = setTimeout(update, 80); });

    document.querySelectorAll('.reset-link').forEach(a => a.onclick = () => {
      const k = a.dataset.reset;
      if (k === 'tipos') { S.tipos = new Set(META.tipos.map((_, i) => i)); setChips('chipsTipos', true); }
      if (k === 'precisao') { S.precisao = new Set([0, 1]); setChips('chipsPrecisao', true); }
      if (k === 'info') { S.info.clear(); setChips('chipsInfo', false); }
      if (k === 'comm') { S.comm.clear(); setChips('chipsComm', false); }
      if (k === 'geoqcl' && SGB?.camadas.geoq) { S.geoqCl = new Set(SGB.camadas.geoq.cl_l.map((_, i) => i)); setChips('chipsGeoq', true); }
      if (k === 'folesc' && SGB?.camadas.folhas) { S.folEsc = new Set(SGB.camadas.folhas.map(a => a.esc)); setChips('chipsFolhas', true); }
      if (k === 'ocim' && SGB?.camadas.ocorr) { S.ocIm = new Set(SGB.camadas.ocorr.im_l.map((_, i) => i)); setChips('chipsOcorr', true); }
      if (k === 'tespr') { S.tesPr = new Set([0, 1, 3]); if (SGB?.camadas.teses) buildTesChips(); }
      update();
    });
    $('resetAll').onclick = () => {
      document.querySelectorAll('.reset-link').forEach(a => a.onclick());
      $('soUfConfere').checked = $('soNovos').checked = false; S.ufconf = S.soNovos = false;
      $('busca').value = ''; S.busca = '';
      $('vMin').value = $('vMax').value = ''; S.vmin = S.vmax = null; $('vClear').hidden = true;
      resetScale('hex'); resetScale('mun');
      mn.value = META.ano_min; mx.value = META.ano_max; syncYears();
      update();
    };
    $('detailClear').onclick = () => select(null);
    $('themeBtn').onclick = () => {
      const r = document.documentElement;
      const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      r.dataset.theme = dark ? 'light' : 'dark';
      recolor();
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!document.documentElement.dataset.theme) recolor(); });
    $('hexOpts').hidden = false;
    buildSgbControls();
  }

  function resetScale(key) { S.scale[key] = {lo: null, hi: null}; }
  const inRange = v => (S.vmin === null || v >= S.vmin) && (S.vmax === null || v <= S.vmax);

  // colour scale whose ends are the data extremes unless the user typed them in the legend
  function legendScale(key, interp, autoMax) {
    const bar = document.querySelector(`.legend-bar[data-key=${key}]`);
    const {lo: uLo, hi: uHi} = S.scale[key];
    const lo = uLo ?? 0, hi = Math.max(uHi ?? autoMax, lo + 1e-9);
    bar.querySelectorAll('.leg-input').forEach(inp => {
      const end = inp.dataset.end, custom = S.scale[key][end] !== null;
      if (document.activeElement !== inp) inp.value = +(end === 'lo' ? lo : hi).toFixed(2);
      inp.classList.toggle('custom', custom);
      inp.parentElement.classList.toggle('custom', custom);
    });
    bar.querySelector('.leg-reset').hidden = uLo === null && uHi === null;
    return d3.scaleSequentialSqrt(interp).domain([lo, hi]).clamp(true);
  }

  function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
  function setChips(id, on) { document.querySelectorAll(`#${id} .chip`).forEach(c => c.classList.toggle('on', on)); }
  function segmented(id, attr, fn) {
    const btns = document.querySelectorAll(`#${id} button`);
    btns.forEach(b => b.onclick = () => { btns.forEach(x => x.classList.toggle('active', x === b)); fn(b.dataset[attr]); update(); });
  }

  // ---------- map ----------
  function buildMap() {
    const wrap = $('mapWrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    svg = d3.select('#map').attr('viewBox', `0 0 ${W} ${H}`);
    W0 = W; H0 = H; canvas = $('sgbCanvas');
    const obj = TOPO.objects[Object.keys(TOPO.objects)[0]];
    munFeatures = topojson.feature(TOPO, obj).features;
    const brasil = topojson.merge(TOPO, obj.geometries);
    projection = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], brasil);
    const path = d3.geoPath(projection);
    const a = projection([-50, -15]), b = projection([-49, -15]);
    pxPerKm = Math.abs(b[0] - a[0]) / (111.32 * Math.cos(15 * Math.PI / 180));

    gRoot = svg.append('g');
    gMun = gRoot.append('g');
    munPaths = gMun.selectAll('path').data(munFeatures).join('path')
      .attr('class', 'mun').attr('d', path).attr('vector-effect', 'non-scaling-stroke');
    gRoot.append('path').datum(topojson.mesh(TOPO, obj, (x, y) => x.properties.SIGLA_UF !== y.properties.SIGLA_UF))
      .attr('class', 'uf-line').attr('d', path).attr('vector-effect', 'non-scaling-stroke');
    gRoot.append('path').datum(topojson.mesh(TOPO, obj, (x, y) => x === y))
      .attr('class', 'br-line').attr('d', path).attr('vector-effect', 'non-scaling-stroke');
    gCov = gRoot.insert('g', ':first-child');  // background maps under the municipalities (see .with-cov in the CSS)
    gOvl = gRoot.append('g');
    // heatmap cells are clipped to the country outline, except cells whose centre is outside it (offshore or
    // border data), which would otherwise disappear
    svg.append('defs').append('clipPath').attr('id', 'clipBrasil').append('path').datum(brasil).attr('d', path);
    buildBrasilMask(brasil);
    gHex = gRoot.append('g').attr('clip-path', 'url(#clipBrasil)');
    gHexFree = gRoot.append('g');
    gMark = gRoot.append('g');

    PTS.forEach(p => { const xy = projection([p[0], p[1]]); p.px = xy[0]; p.py = xy[1]; });
    PROC.forEach(p => {
      const xy = projection([p.x, p.y]); p.px = xy[0]; p.py = xy[1];
      p.d = 'M' + p.g.map(c => projection(c).map(v => v.toFixed(1)).join(',')).join('L') + 'Z';
    });
    if (SGB) {
      SGB_PT.forEach(d => SGB.camadas[d.k] && projectPoints(d.k));
      SGB_POLY.forEach(d => SGB.camadas[d.k] && projectAreas(d.k));
    }

    zoom = d3.zoom().scaleExtent([1, 80]).on('zoom', e => {
      gRoot.attr('transform', e.transform);
      zT = e.transform; scheduleCanvas();
      if (Math.abs(e.transform.k - zoomK) > 0.01) { zoomK = e.transform.k; gMark.selectAll('circle').attr('r', 2.6 / Math.sqrt(zoomK)); }
      // the heatmap keeps about the same cell size on screen and only draws cells near the view: rebuild once the
      // zoom/pan settles, if the cell size changed or the view left the drawn area
      if (S.modo === 'hex') { clearTimeout(rehexTimer); rehexTimer = setTimeout(rehexIfNeeded, 180); }
    });
    svg.call(zoom).on('dblclick.zoom', null);
    $('zoomReset').onclick = () => svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
    svg.on('click', e => {
      if (e.target !== svg.node() && !e.target.classList.contains('mun')) return;
      const hit = S.modo === 'marcadores' && nearestSgb(e);
      if (hit) { e.stopPropagation(); selectSgbPoint(hit); return; }
      if (e.target === svg.node()) select(null);
    });
    svg.on('mouseleave', () => { hideTip(); sgbTip = false; });
    svg.on('mousemove.sgb', e => {
      if (S.modo !== 'marcadores' || !sgbOn()) return;
      if (e.target.classList.contains('pt') || e.target.classList.contains('proc')) return;
      const hit = nearestSgb(e);
      if (hit) { showTip(e, sgbPtTip(hit)); sgbTip = true; }
      else if (sgbTip) { sgbTip = false; if (e.target === svg.node()) hideTip(); }
    });
    window.addEventListener('resize', scheduleCanvas);
  }

  // ---------- filtering ----------
  function filter() {
    const ok = new Uint8Array(DOCS.length);
    DOCS.forEach((d, i) => {
      if (d.y < S.anoMin || d.y > S.anoMax) return;
      if (S.soNovos && d.n !== 1) return;
      if (S.info.size && !d.i.some(x => S.info.has(x))) return;
      if (S.comm.size && !d.c.some(x => S.comm.has(x))) return;
      if (S.busca && !d.h.includes(S.busca)) return;
      ok[i] = 1;
    });
    const keep = refs => refs.filter(r => ok[r[0]]);
    const pts = [], procs = [], mun = new Map();
    if (S.layers.pontos) PTS.forEach(p => {
      if (!S.tipos.has(p[2]) || !S.precisao.has(p[3]) || (S.ufconf && !p[4])) return;
      const r = keep(p[8]); if (r.length) pts.push({p, r});
    });
    if (S.layers.processos) PROC.forEach(p => { const r = keep(p.r); if (r.length) procs.push({p, r}); });
    if (S.layers.municipios) for (const [cd, refs] of Object.entries(MUNREF)) { const r = keep(refs); if (r.length) mun.set(cd, r); }
    // diluted weight: each report spreads a total weight of 1 over the items (points + processes) it places
    const nItems = new Map(), nMun = new Map();
    const countDocs = (refs, m) => new Set(refs.map(r => r[0])).forEach(d => m.set(d, (m.get(d) || 0) + 1));
    pts.forEach(o => countDocs(o.r, nItems)); procs.forEach(o => countDocs(o.r, nItems));
    mun.forEach(r => countDocs(r, nMun));
    const weight = (refs, m) => [...new Set(refs.map(r => r[0]))].reduce((s, d) => s + 1 / m.get(d), 0);
    pts.forEach(o => o.w = weight(o.r, nItems)); procs.forEach(o => o.w = weight(o.r, nItems));
    const munW = new Map(); mun.forEach((r, cd) => munW.set(cd, weight(r, nMun)));
    return {ok, pts, procs, mun, munW, sgb: filterSgb(), areas: filterAreas()};
  }

  // SGB points: indices per layer that pass the filters. Commodity filters the layers that have commodities
  // (occurrences, PDAC resources); the free-text search applies to every layer with text (gravimetry has none).
  function filterSgb() {
    const out = {};
    if (!SGB) return out;
    const L = SGB.camadas, q = S.busca, comm = S.comm.size ? S.comm : null;
    const commOk = cn => !comm || cn.some(c => comm.has(c));
    SGB_PT.forEach(d => {
      const o = L[d.k]; if (!o || !S.sgb[d.k]) return;
      const idx = [];
      if (d.k === 'geoq') {
        const pjOk = o.pj_l.map(p => !q || p.h.includes(q));
        for (let i = 0; i < o.n; i++) if (S.geoqCl.has(o.cl[i]) && pjOk[o.pj[i]]) idx.push(i);
      } else if (d.k === 'ocorr') {
        for (let i = 0; i < o.n; i++) if (S.ocIm.has(o.im[i]) && commOk(o.cn[i]) && (!q || o.h[i].includes(q))) idx.push(i);
      } else if (d.k === 'recmin') {
        for (let i = 0; i < o.n; i++) if (commOk(o.cn[i]) && (!q || o.h[i].includes(q))) idx.push(i);
      } else if (d.k === 'geocron') {
        for (let i = 0; i < o.n; i++) if (!q || o.h[i].includes(q)) idx.push(i);
      } else if (d.k === 'mt') {
        for (let i = 0; i < o.n; i++) if (!q || o.pj_h[o.pj[i]].includes(q)) idx.push(i);
      } else if (d.k === 'teses') {
        // the commodity filter matches the commodity name in the title/subjects
        for (let i = 0; i < o.n; i++) if (S.tesPr.has(o.p[i]) && (!q || o.h[i].includes(q)) && (!comm || [...comm].some(c => o.h[i].includes(c)))) idx.push(i);
      } else if (o.h) {
        for (let i = 0; i < o.n; i++) if (!q || o.h[i].includes(q)) idx.push(i);
      } else if (!q) {
        for (let i = 0; i < o.n; i++) idx.push(i);
      }
      out[d.k] = idx;
    });
    return out;
  }
  function filterAreas() {
    const out = [];
    if (!SGB) return out;
    SGB_POLY.forEach(d => {
      if (!S.sgb[d.k] || !SGB.camadas[d.k]) return;
      if ((d.k === 'distau' || d.k === 'provau') && S.comm.size && !S.comm.has('ouro')) return;
      SGB.camadas[d.k].forEach((a, i) => {
        if (d.k === 'folhas' && !S.folEsc.has(a.esc)) return;
        if (!S.busca || a.hs.includes(S.busca)) out.push({k: d.k, i, a});
      });
    });
    return out;
  }

  function value(docSet, w, c) {
    if (S.metrica === 'tipos') return c ? (c.pts.length > 0) + (c.procs.length > 0) + Object.keys(c.sg).length : 0;
    if (S.metrica === 'registros') return c ? c.pts.length + c.procs.length + Object.values(c.sg).reduce((s, a) => s + a.length, 0) : 0;
    if (S.metrica === 'docs') return docSet.size;
    if (S.metrica === 'novos') { let n = 0; docSet.forEach(d => { if (DOCS[d].n === 1) n++; }); return n; }
    return w;
  }

  // ---------- render ----------
  // theme change: only the colours change, keep the selection
  function recolor() { if (!F) return; renderMun(); if (S.modo === 'hex') renderHex(); }

  function update() {
    clearTimeout(rehexTimer);
    F = filter();
    select(null, true);
    renderMun();
    renderAreas();
    sgbTree = null;
    if (S.modo === 'hex') { renderHex(); gMark.selectAll('*').remove(); } else { renderMarkers(); gHex.selectAll('*').remove(); gHexFree.selectAll('*').remove(); }
    drawCanvas();
    renderStats();
    hexTitle();
    $('metricaNota').textContent = {
      docs: 'Relatórios SEDAR+: quantos relatórios NI 43-101 diferentes trazem dado de campo da área. Um relatório com 300 furos na célula conta 1; três relatórios sobre o mesmo furo contam 3.',
      novos: 'SEDAR+ novos: igual a Relatórios SEDAR+, mas sem emendas/refilings e sem relatórios cujos pontos já tinham sido publicados antes. Mede estudos independentes.',
      diluido: 'SEDAR+ diluído: cada relatório SEDAR+ vale 1 no total, repartido igualmente entre todos os seus pontos e processos (municípios: entre os municípios que cita). Uma célula com 30 de 300 furos de um relatório recebe 0,1. Mostra onde o esforço de cada estudo se concentra.',
      tipos: 'Tipos de dado: quantas camadas ligadas têm algo na célula (pontos SEDAR+, processos ANM e cada camada de pontos do SGB contam 1). Mede a variedade do conhecimento: 6 = sondagem, geoquímica, gravimetria, datação… no mesmo lugar.',
      registros: 'Registros: soma de tudo o que cai na célula — pontos e processos SEDAR+ mais amostras, ocorrências e estações do SGB. Camadas grandes (365 mil amostras geoquímicas) dominam; desligue-as para comparar as demais.',
    }[S.metrica] + (sgbOn() && !sgbMetric() ? ' Atenção: as cores SEDAR+ só contam relatórios SEDAR+ — os pontos SGB entram em Tipos de dado e Registros.' : '');
  }

  // raster of the country outline in map coordinates (3 px per unit), for a constant-time "is this inside Brazil?"
  let maskData = null;
  const MASK_K = 3;
  function buildBrasilMask(brasil) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(W0 * MASK_K); c.height = Math.ceil(H0 * MASK_K);
    const ctx = c.getContext('2d', {willReadFrequently: true});
    ctx.scale(MASK_K, MASK_K);
    ctx.beginPath(); d3.geoPath(projection, ctx)(brasil); ctx.fill();
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3] > 127 ? 1 : 0;
    maskData = {w: c.width, h: c.height, a};
  }
  function insideBrasil(x, y) {
    const i = Math.floor(x * MASK_K), j = Math.floor(y * MASK_K);
    return !!maskData && i >= 0 && j >= 0 && i < maskData.w && j < maskData.h && maskData.a[j * maskData.w + i] === 1;
  }

  // visible part of the map, in map coordinates
  function viewBoxNow() {
    return [-zT.x / zT.k, -zT.y / zT.k, (W0 - zT.x) / zT.k, (H0 - zT.y) / zT.k];
  }
  function rehexIfNeeded() {
    if (S.modo !== 'hex' || !F) return;
    const v = viewBoxNow();
    if (hexKm() !== hexKmShown || !hexBox || v[0] < hexBox[0] || v[1] < hexBox[1] || v[2] > hexBox[2] || v[3] > hexBox[3]) { renderHex(); hexTitle(); }
  }

  // cell radius in km: the slider value at the whole-country view, divided by the zoom (rounded), never below
  // 5 km (smaller cells would mean tens of thousands of hexagons with the geochemistry layer on)
  const HEX_MIN_KM = 5;
  function hexKm() {
    const v = S.hexKm / zoomK;
    return Math.max(Math.min(HEX_MIN_KM, S.hexKm), v >= 20 ? Math.round(v / 5) * 5 : Math.round(v));
  }
  function hexTitle() {
    const m = {docs: 'Relatórios SEDAR+ distintos', novos: 'Relatórios SEDAR+ com dados novos', diluido: 'Relatórios SEDAR+ equivalentes (diluído)',
      tipos: 'Tipos de dado distintos', registros: 'Registros (SEDAR+ e SGB)'}[S.metrica];
    const km = hexKm();
    $('mapTitle').textContent = S.modo === 'hex' ? `${m} por célula de ${km} km` : 'Marcadores — cor pela fonte e tipo de dado';
    $('hexVal').textContent = km === S.hexKm ? `${S.hexKm} km` : `${S.hexKm} km · com o zoom: ${km} km`;
  }

  function renderMun() {
    const on = S.layers.municipios;
    const vals = new Map();
    // municipalities carry only SEDAR+ citations: the SGB metrics count distinct reports there
    if (on) F.mun.forEach((r, cd) => { const ds = new Set(r.map(x => x[0])); const v = sgbMetric() ? ds.size : value(ds, F.munW.get(cd)); if (v > 0 && inRange(v)) vals.set(cd, v); });
    const max = d3.max(vals.values()) || 1;
    const sc = legendScale('mun', ramp('warm'), max);
    munPaths.classed('on', f => vals.has(f.properties.CD_MUN))
      .style('fill', f => vals.has(f.properties.CD_MUN) && vals.get(f.properties.CD_MUN) > 0 ? sc(vals.get(f.properties.CD_MUN)) : null)
      .on('mousemove', on ? (e, f) => { if (vals.has(f.properties.CD_MUN)) showTip(e, munTip(f)); else hideTip(); } : null)
      .on('mouseleave', hideTip)
      .on('click', on ? (e, f) => { if (vals.has(f.properties.CD_MUN)) { e.stopPropagation(); selectMun(f, e.currentTarget); } } : null);
    $('legendMun').hidden = !on;
  }

  function hexbin(r) {
    const dx = r * Math.sqrt(3), dy = r * 1.5;
    return (x, y) => {
      let py = y / dy, pj = Math.round(py), px = x / dx - (pj & 1) / 2, pi = Math.round(px);
      const py1 = py - pj;
      if (Math.abs(py1) * 3 > 1) {
        const px1 = px - pi, pi2 = pi + (px < pi ? -1 : 1) / 2, pj2 = pj + (py < pj ? -1 : 1), px2 = px - pi2, py2 = py - pj2;
        if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) { pi = pi2 + (pj & 1 ? 1 : -1) / 2; pj = pj2; }
      }
      return [pi, pj, (pi + (pj & 1) / 2) * dx, pj * dy];
    };
  }

  function renderHex() {
    hexKmShown = hexKm();
    const r = hexKmShown * pxPerKm, bin = hexbin(r), cells = new Map();
    const add = (o, kind) => {
      const [i, j, cx, cy] = bin(o.p.px, o.p.py), k = i + ',' + j;
      let c = cells.get(k);
      if (!c) cells.set(k, c = {key: k, cx, cy, pts: [], procs: [], docs: new Set(), w: 0, sg: {}});
      c[kind].push(o); o.r.forEach(x => c.docs.add(x[0])); c.w += o.w;
    };
    F.pts.forEach(o => add(o, 'pts')); F.procs.forEach(o => add(o, 'procs'));
    for (const [lk, idx] of Object.entries(F.sgb)) {
      const o = SGB.camadas[lk];
      for (const i of idx) {
        const [bi, bj, cx, cy] = bin(o.px[i], o.py[i]), key = bi + ',' + bj;
        let c = cells.get(key);
        if (!c) cells.set(key, c = {key, cx, cy, pts: [], procs: [], docs: new Set(), w: 0, sg: {}});
        (c.sg[lk] || (c.sg[lk] = [])).push(i);
      }
    }
    const data = [...cells.values()];
    data.forEach(c => c.v = value(c.docs, c.w, c));
    const shown = data.filter(c => c.v > 0 && inRange(c.v));
    const max = d3.max(shown, c => c.v) || 1;
    const sc = legendScale('hex', ramp('seq'), max);
    const hexPath = 'M' + d3.range(6).map(k => { const a = k * Math.PI / 3; return [r * Math.sin(a), -r * Math.cos(a)].map(v => v.toFixed(2)).join(','); }).join('L') + 'Z';
    // the colour scale uses every cell; only the cells around the view (1.5 views each way) become SVG paths
    const v = viewBoxNow(), mx = (v[2] - v[0]) * 1.5, my = (v[3] - v[1]) * 1.5;
    hexBox = zoomK <= 1.01 ? [-Infinity, -Infinity, Infinity, Infinity] : [v[0] - mx, v[1] - my, v[2] + mx, v[3] + my];
    const near = shown.filter(c => c.cx + r >= hexBox[0] && c.cx - r <= hexBox[2] && c.cy + r >= hexBox[1] && c.cy - r <= hexBox[3]);
    near.sort((a, b) => a.v - b.v).forEach(c => { c.inBR = insideBrasil(c.cx, c.cy); });
    const selKey = S.sel && S.sel.cellKm === hexKmShown ? S.sel.cellKey : null;
    const draw = (g, data) => g.selectAll('path').data(data, c => c.key).join('path')
      .attr('class', c => c.key === selKey ? 'hex sel' : 'hex').attr('vector-effect', 'non-scaling-stroke')
      .attr('transform', c => `translate(${c.cx},${c.cy})`).attr('d', hexPath)
      .attr('fill', c => sc(c.v)).attr('fill-opacity', S.layers.municipios ? 0.88 : 1)
      .on('mousemove', (e, c) => showTip(e, cellTip(c)))
      .on('mouseleave', hideTip)
      .on('click', (e, c) => { e.stopPropagation(); selectCell(c, e.currentTarget); });
    draw(gHex, near.filter(c => c.inBR));
    draw(gHexFree, near.filter(c => !c.inBR));
    // keep the selected cell highlighted when the cells are rebuilt (theme change, pan); a new cell size drops it
    if (S.sel && S.sel.cellKey != null) selEl = gRoot.select('path.hex.sel').node();
    const any = S.layers.pontos || S.layers.processos || sgbOn();
    $('legendHex').hidden = !any; $('legendHelp').hidden = false;
    $('legendHexName').textContent = [S.layers.pontos && 'SEDAR+ pontos', S.layers.processos && 'SEDAR+ processos', sgbOn() && sgbMetric() && 'SGB'].filter(Boolean).join(' + ');
    legendTypes(false);
  }

  function renderMarkers() {
    gMark.selectAll('*').remove();
    gMark.append('g').selectAll('path').data(F.procs).join('path')
      .attr('class', 'proc').attr('d', o => o.p.d).attr('vector-effect', 'non-scaling-stroke')
      .on('mousemove', (e, o) => showTip(e, procTip(o))).on('mouseleave', hideTip)
      .on('click', (e, o) => { e.stopPropagation(); selectItems(`Processo ANM ${o.p.id}`, [], [o], e.currentTarget); });
    gMark.append('g').selectAll('circle').data(F.pts).join('circle')
      .attr('class', 'pt').attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 0.4)
      .attr('cx', o => o.p.px).attr('cy', o => o.p.py).attr('r', 2.6 / Math.sqrt(zoomK)).attr('fill', o => TIPO_COR[o.p[2]])
      .on('mousemove', (e, o) => showTip(e, ptTip(o))).on('mouseleave', hideTip)
      .on('click', (e, o) => { e.stopPropagation(); selectItems(o.p[5] || TIPO_NOME[META.tipos[o.p[2]]], [o], [], e.currentTarget); });
    $('legendHex').hidden = true; $('legendHelp').hidden = !S.layers.municipios;
    legendTypes(true);
  }

  function legendTypes(markers) {
    const lt = $('legendTipos');
    const sgbPts = markers ? SGB_PT.filter(d => S.sgb[d.k] && F.sgb[d.k]) : [];
    const areas = SGB_AREA.filter(d => S.sgb[d.k] && SGB?.camadas[d.k]);
    const covs = SGB_COV.filter(d => S.sgb[d.k] && SGB?.camadas[d.k]);
    lt.hidden = !markers && !areas.length && !covs.length;
    lt.innerHTML = (markers ? '<span class="legend-name">SEDAR+ · tipo de ponto</span>' + META.tipos.map((t, i) => `<span><i style="background:${TIPO_COR[i]}"></i>${TIPO_NOME[t]}</span>`).join('')
      + '<span><i style="background:var(--accent);opacity:.4;border-radius:2px"></i>processo ANM</span>' + (sgbPts.length ? '<span class="legend-name">SGB · pontos</span>' : '') : '')
      + sgbPts.map(d => `<span><i style="background:${d.cor};border-radius:1px"></i>${esc(d.nome)}</span>`).join('')
      + (areas.length ? '<span class="legend-name">SGB · áreas</span>' : '')
      + areas.map(d => `<span><i style="border:2px solid ${d.cor};background:transparent;border-radius:2px"></i>${esc(d.nome)}</span>`).join('')
      + covs.map(d => `<span class="legend-name">SGB · ${esc(d.nome)} (${d.catNome})</span>` + Object.entries(d.pal)
        .filter(([c]) => SGB.cat[d.k].includes(c)).map(([c, cor]) => `<span><i style="background:${cor};border-radius:2px"></i>${esc(c)}</span>`).join('')).join('');
  }

  // SGB areas: outlines above the municipalities, under the heatmap and markers
  const covColor = o => SGB_DEF[o.k].pal[SGB.cat[o.k][o.a.c]] || '#999';
  function renderAreas() {
    const cov = F.areas.filter(o => SGB_DEF[o.k].cov), ovl = F.areas.filter(o => !SGB_DEF[o.k].cov);
    // with a background map on, municipalities outside the choropleth become transparent and let events through
    svg.classed('with-cov', cov.length > 0);
    const tip = (e, o) => showTip(e, areaTip(o) + '<div class="muted">clique para ver tudo o que cobre este local</div>');
    gCov.selectAll('path').data(cov, a => a.k + a.i).join('path')
      .attr('class', 'cov').attr('d', o => o.a.d).attr('vector-effect', 'non-scaling-stroke')
      .style('fill', covColor).style('stroke', covColor)
      .on('mousemove', tip).on('mouseleave', hideTip)
      .on('click', (e, o) => {
        e.stopPropagation();
        const hit = S.modo === 'marcadores' && nearestSgb(e);
        if (hit) selectSgbPoint(hit); else selectAreasAt(e, e.currentTarget);
      });
    gOvl.selectAll('path').data(ovl, a => a.k + a.i).join('path')
      .attr('class', 'ovl').attr('d', o => o.a.d).attr('vector-effect', 'non-scaling-stroke')
      .style('fill', o => SGB_DEF[o.k].cor).style('stroke', o => SGB_DEF[o.k].cor)
      .on('mousemove', tip)
      .on('mouseleave', hideTip)
      .on('click', (e, o) => {
        e.stopPropagation();
        const hit = S.modo === 'marcadores' && nearestSgb(e);  // a canvas dot drawn over the area wins
        if (hit) selectSgbPoint(hit); else selectAreasAt(e, e.currentTarget);
      });
  }
  function inRing(x, y, ring) {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function areasAt(lon, lat) {
    // even-odd over all rings, like the drawing: a point inside a hole is outside the polygon
    return (F.areas || []).filter(({a}) => lon >= a.bb[0] && lon <= a.bb[2] && lat >= a.bb[1] && lat <= a.bb[3]
      && a.g.reduce((n, r) => n + inRing(lon, lat, r), 0) % 2 === 1);
  }
  const lonLatOf = e => projection.invert(d3.pointer(e, gRoot.node()));

  // ---------- SGB markers on canvas ----------
  function scheduleCanvas() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => { drawPending = false; drawCanvas(); });
  }
  function canvasGeom() {
    const r = canvas.getBoundingClientRect(), s = Math.min(r.width / W0, r.height / H0);
    return {w: r.width, h: r.height, s, ox: (r.width - W0 * s) / 2, oy: (r.height - H0 * s) / 2};
  }
  function drawCanvas() {
    if (!canvas) return;
    const g = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1, G = canvasGeom();
    if (canvas.width !== Math.round(G.w * dpr) || canvas.height !== Math.round(G.h * dpr)) { canvas.width = Math.round(G.w * dpr); canvas.height = Math.round(G.h * dpr); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (S.modo !== 'marcadores' || !F || !sgbOn()) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = zT.k * G.s, tx = G.ox + G.s * zT.x, ty = G.oy + G.s * zT.y;
    const rad = Math.min(3.2, 0.9 + 0.45 * Math.sqrt(zT.k)), sz = rad * 2;
    // biggest layers first so the rarer ones stay visible on top
    const order = SGB_PT.filter(d => F.sgb[d.k]).sort((a, b) => F.sgb[b.k].length - F.sgb[a.k].length);
    for (const d of order) {
      const o = SGB.camadas[d.k], idx = F.sgb[d.k], big = idx.length > 50000;
      g.fillStyle = d.cor; g.globalAlpha = big ? 0.55 : 0.85;
      for (const i of idx) {
        const x = tx + k * o.px[i], y = ty + k * o.py[i];
        if (x < -4 || y < -4 || x > G.w + 4 || y > G.h + 4) continue;
        g.fillRect(x - rad, y - rad, sz, sz);
      }
    }
    g.globalAlpha = 1;
  }
  function nearestSgb(e) {
    if (!SGB || !sgbOn()) return null;
    if (!sgbTree) {
      const keys = SGB_PT.map(d => d.k);
      const pts = [];
      keys.forEach((k, li) => (F.sgb[k] || []).forEach(i => pts.push(li * 1e6 + i)));
      const at = c => SGB.camadas[keys[Math.floor(c / 1e6)]];
      sgbTree = {keys, q: d3.quadtree(pts, c => at(c).px[c % 1e6], c => at(c).py[c % 1e6])};
    }
    const [mx, my] = d3.pointer(e, gRoot.node()), G = canvasGeom();
    const c = sgbTree.q.find(mx, my, 6 / (zT.k * G.s));
    return c === undefined ? null : {k: sgbTree.keys[Math.floor(c / 1e6)], i: c % 1e6};
  }

  function renderStats() {
    const docs = new Set();
    F.pts.forEach(o => o.r.forEach(r => docs.add(r[0])));
    F.procs.forEach(o => o.r.forEach(r => docs.add(r[0])));
    F.mun.forEach(r => r.forEach(x => docs.add(x[0])));
    let novos = 0; docs.forEach(d => { if (DOCS[d].n === 1) novos++; });
    $('kDocs').textContent = fmt(docs.size);
    $('kDocsSub').textContent = `de ${fmt(DOCS.length)} · ${fmt(novos)} com dados novos`;
    $('kPts').textContent = S.layers.pontos ? fmt(F.pts.length) : '—';
    $('kPtsSub').textContent = S.layers.pontos ? `${fmt(F.pts.filter(o => o.p[2] === 0).length)} furos de sondagem` : 'camada desligada';
    $('kProc').textContent = S.layers.processos ? fmt(F.procs.length) : '—';
    $('kMun').textContent = S.layers.municipios ? fmt(F.mun.size) : '—';
    if (SGB) {
      const nPts = Object.values(F.sgb).reduce((s, a) => s + a.length, 0), nOn = SGB_ALL.filter(d => S.sgb[d.k]).length;
      $('kSgb').textContent = nOn ? fmt(nPts + F.areas.length) : '—';
      const nTes = F.sgb.teses ? new Set(F.sgb.teses.map(i => SGB.camadas.teses.d[i])).size : 0;
      $('kSgbSub').textContent = nOn ? `${fmt(nPts)} pontos · ${fmt(F.areas.length)} áreas · ${nOn} camadas${nTes ? ` · ${fmt(nTes)} teses` : ''}` : 'camadas desligadas';
    } else { $('kSgb').textContent = '—'; $('kSgbSub').textContent = 'rode preparar_sgb.py'; }
  }

  // ---------- tooltips ----------
  function docLines(docSet, n = 6) {
    const arr = [...docSet].sort((a, b) => DOCS[b].d.localeCompare(DOCS[a].d));
    const li = arr.slice(0, n).map(d => `<li>${esc(DOCS[d].e)} <span class="muted">(${DOCS[d].d.slice(0, 4)})</span>${DOCS[d].n ? '' : ' <span class="muted">· repetição</span>'}</li>`).join('');
    return `<ul>${li}</ul>` + (arr.length > n ? `<div class="muted">+ ${arr.length - n} relatórios</div>` : '') + '<div class="muted">clique para ver todas as referências</div>';
  }
  function cellTip(c) {
    const furos = c.pts.filter(o => o.p[2] === 0).length;
    const sg = SGB_PT.filter(d => c.sg[d.k]).map(d => `<b>${fmt(c.sg[d.k].length)}</b> ${d.curto}`).join(' · ');
    const head = c.docs.size || c.pts.length || c.procs.length
      ? `SEDAR+: <b>${fmt(c.docs.size)}</b> relatórios · <b>${fmt(c.pts.length)}</b> pontos${furos ? ` (${fmt(furos)} furos)` : ''} · <b>${fmt(c.procs.length)}</b> processos` : '';
    return head + (sg ? `${head ? '<br>' : ''}<span class="sgbl">SGB: ${sg}</span>` : '')
      + (S.metrica === 'diluido' ? `<br>valor diluído: <b>${fmt1(c.w)}</b>` : '')
      + (S.metrica === 'tipos' ? `<br>tipos de dado: <b>${c.v}</b>` : '') + (S.metrica === 'registros' ? `<br>registros: <b>${fmt(c.v)}</b>` : '')
      + (c.docs.size ? docLines(c.docs) : '<div class="muted">clique para ver os dados SGB da célula</div>');
  }
  function sgbPtTip({k, i}) {
    const o = SGB.camadas[k], d = SGB_DEF[k];
    const where = `<span class="muted">SGB · ${d.nome}</span>`;
    if (k === 'ocorr') return `<b>${esc(o.nm[i] || '(sem nome)')}</b> — ${esc(o.cn[i].join(', '))}<br>${esc(o.st_l[o.st[i]])} · ${esc(o.im_l[o.im[i]])} · ${esc(o.mun[i])}/${o.uf[i]}<br>${where}`;
    if (k === 'recmin') return `<b>${esc(o.nm[i])}</b> — ${esc(o.ce[i])}<br>${esc(o.cl_l[o.cl[i]])} · porte ${esc(o.sz_l[o.sz[i]])} · ${esc(o.st[i])}<br>${where}`;
    if (k === 'geoq') { const pj = o.pj_l[o.pj[i]]; return `<b>${esc(o.cl_l[o.cl[i]])}</b>${o.yr[i] ? ` (${o.yr[i]})` : ''}<br>${esc(pj.t)}<br>${where}`; }
    if (k === 'geocron') return `<b>${esc(o.am[i])}</b> — ${esc(o.ro[i])}<br>${esc(o.me[i] || 'método não informado')}<br>${where}`;
    if (k === 'grav') return `<b>Estação gravimétrica</b>${o.b[i] != null ? `<br>anomalia Bouguer ${o.b[i]} mGal` : ''}<br>${where}`;
    if (k === 'mt') return `<b>Estação ${esc(o.s[i])}</b> — ${esc(o.pj_l[o.pj[i]])}<br>${esc(o.d[i])} · ${esc(o.ins[i])}<br>${where}`;
    if (k === 'pocos') return `<b>${esc(o.nm[i] || o.pid[i])}</b> — ${esc(o.nat_l[o.nat[i]])}<br>${o.pr[i] != null ? `${o.pr[i]} m · ` : ''}${esc(o.aq[i] || 'aquífero não informado')} · ${esc(o.mun[i])}/${o.uf[i]}<br>${where} · ${o.src_l[o.src[i]]}`;
    if (k === 'fontes') return `<b>${esc(o.nm[i])}/${o.uf[i]}</b><br>${fmt(o.q[i])} fontes hidrominerais<br>${where}`;
    if (k === 'teses') { const T = o.T, t = o.d[i]; return `<b>${esc(T.t[t])}</b><br>${o.tp_l[T.tp[t]]} · ${esc(T.a[t])} · ${esc(T.ins[t])}<br><span class="muted">BDTD · local: ${esc(o.lg_l[o.lg[i]])} (${tesPrec(o, i)})</span>`; }
    return '';
  }
  const tesPrec = (o, i) => ({municipio: 'município', regiao: 'distrito/região', resumo: 'citado só no resumo', estado: 'só o estado'})[o.p_l[o.p[i]]];
  const fmtMa = v => v >= 100 ? fmt(Math.round(v)) : d3.format('.3~r')(v);
  function geolIdade(a) {
    const era = SGB.cat.geol[a.c], eras = a.e0 && a.e0 !== era ? `${era} a ${a.e0}` : era;
    const has = a.i1 != null && !(a.i1 === 0 && !a.i0);  // 0–0 means age not informed
    const ma = has ? ` · ${a.i0 != null && a.i0 !== a.i1 ? `${fmtMa(a.i1)}–${fmtMa(a.i0)}` : fmtMa(a.i1)} Ma` : '';
    return esc(eras) + ma;
  }
  function areaTip({k, a}) {
    const d = SGB_DEF[k];
    if (k === 'aero') return `<b>${esc(a.t)}</b><br>${esc(a.m)} · ${esc(a.a)}${a.lv ? ` · linhas a ${esc(a.lv)} m` : ''}<br><span class="muted">SGB · ${d.nome} · ${esc(a.ct)} · ${esc(a.s.toLowerCase())}</span>`;
    if (k === 'geoqproj') return `<b>${esc(a.t)}</b><br>escala ${esc(a.esc)} · ${a.a0}${a.a1 && a.a1 !== a.a0 ? '–' + a.a1 : ''}<br><span class="muted">SGB · ${d.nome}</span>`;
    if (k === 'folhas') return `<b>${esc(a.cod)}</b> — ${esc(a.t)}<br>${a.esc} · ${esc(a.a)}<br><span class="muted">SGB · ${d.nome}</span>`;
    if (k === 'distau') return `<b>Distrito ${esc(a.t)}</b><br>província ${esc(a.prov)} · ${esc(a.ug)} · ${esc(a.uf)}<br><span class="muted">SGB · ${d.nome}</span>`;
    if (k === 'provau') return `<b>${esc(a.t)}</b><br>${esc(a.pg)} · ${esc(a.uf)}<br><span class="muted">SGB · ${d.nome}</span>`;
    if (k === 'geol') return `<b>${esc(a.t)}</b> <span class="muted">(${esc(a.s)})</span><br>${geolIdade(a)}${a.li ? '<br>' + esc(a.li) : ''}<br><span class="muted">SGB · ${d.nome}</span>`;
    if (k === 'hidro') return `<b>${esc(a.t)}</b> <span class="muted">(${esc(a.s)})</span><br>domínio ${esc(SGB.cat.hidro[a.c])}${a.sd && a.sd !== SGB.cat.hidro[a.c] ? ' · ' + esc(a.sd) : ''}${a.po ? ` · potencial ${esc(a.po.toLowerCase())}` : ''}<br><span class="muted">SGB · ${d.nome}</span>`;
    return '';
  }
  function ptTip(o) {
    const p = o.p;
    return `<b>${esc(p[5] || '(sem nome)')}</b> — ${TIPO_NOME[META.tipos[p[2]]]}<br>${esc(p[6])} / ${p[7]} · ${PREC_NOME[p[3]]}${p[4] ? '' : ' · <span class="muted">fora da UF do projeto</span>'}` + docLines(new Set(o.r.map(r => r[0])));
  }
  function procTip(o) {
    const p = o.p;
    return `<b>Processo ${esc(p.id)}</b><br>${esc(p.f)} · ${esc(p.s)}<br><span class="muted">${esc(p.ti)} · ${p.ha ? fmt(p.ha) + ' ha' : ''}</span>` + docLines(new Set(o.r.map(r => r[0])));
  }
  function munTip(f) {
    const r = F.mun.get(f.properties.CD_MUN);
    return `<b>${esc(f.properties.NM_MUN)} / ${f.properties.SIGLA_UF}</b><br><b>${fmt(new Set(r.map(x => x[0])).size)}</b> relatórios SEDAR+ citam o município como local de projeto` + docLines(new Set(r.map(x => x[0])));
  }
  function showTip(e, html) {
    const tip = $('tooltip'), wrap = $('mapWrap').getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - wrap.left + 14, y = e.clientY - wrap.top + 14;
    if (x + tw > wrap.width - 8) x = e.clientX - wrap.left - tw - 14;
    if (y + th > wrap.height - 8) y = Math.max(8, e.clientY - wrap.top - th - 14);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { $('tooltip').hidden = true; }

  // ---------- selection / reference list ----------
  let selEl = null;
  function select(sel, silent) {
    if (selEl) d3.select(selEl).classed('sel', false);
    selEl = null; S.sel = sel;
    if (!sel) {
      $('detailTitle').textContent = 'Referências';
      $('detailSub').textContent = 'Clique numa célula, ponto, processo ou município do mapa para listar todos os relatórios que trazem informação dali, com páginas e link para o PDF.';
      $('refList').innerHTML = ''; $('sgbDetail').innerHTML = ''; $('detailClear').hidden = true; $('refHead').hidden = true;
      return;
    }
    if (sel.el) { selEl = sel.el; d3.select(selEl).classed('sel', true); }
    renderRefs(sel);
    if (!silent) $('detail').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }
  function selectCell(c, el) {
    const items = c.pts.length + c.procs.length;
    const nsg = Object.values(c.sg).reduce((s, a) => s + a.length, 0);
    const [lon, lat] = projection.invert([c.cx, c.cy]);
    select({title: `Célula de ${hexKmShown} km`, sub: `${fmt(c.docs.size)} relatórios · ${fmt(c.pts.length)} pontos · ${fmt(c.procs.length)} processos ANM (${fmt(items)} itens)` + (nsg ? ` · ${fmt(nsg)} registros SGB` : ''),
      pts: c.pts, procs: c.procs, mun: [], el, sgb: c.sg, areas: areasAt(lon, lat), areaNote: 'áreas SGB que cobrem o centro da célula',
      cellKey: c.key, cellKm: hexKmShown});
  }
  function selectItems(title, pts, procs, el) {
    const docs = new Set(); pts.concat(procs).forEach(o => o.r.forEach(r => docs.add(r[0])));
    select({title, sub: `${fmt(docs.size)} relatórios`, pts, procs, mun: [], el});
  }
  function selectSgbPoint(hit) {
    const d = SGB_DEF[hit.k];
    const [lon, lat] = [SGB.camadas[hit.k].x[hit.i], SGB.camadas[hit.k].y[hit.i]];
    const sub = hit.k === 'teses' ? `${SGB.camadas.teses.lg_l[SGB.camadas.teses.lg[hit.i]]} · tese/dissertação da BDTD` : `${lon.toFixed(4)}, ${lat.toFixed(4)} · ponto do SGB/CPRM`;
    select({title: d.nome, sub, pts: [], procs: [], mun: [],
      sgb: {[hit.k]: [hit.i]}, areas: areasAt(lon, lat), areaNote: 'áreas SGB que cobrem o ponto'});
  }
  function selectAreasAt(e, el) {
    const [lon, lat] = lonLatOf(e), areas = areasAt(lon, lat);
    select({title: 'Áreas SGB neste local', sub: `${lon.toFixed(3)}, ${lat.toFixed(3)} · ${fmt(areas.length)} áreas ligadas cobrem o ponto clicado`,
      pts: [], procs: [], mun: [], el, sgb: {}, areas, areaNote: ''});
  }
  function selectMun(f, el) {
    const r = F.mun.get(f.properties.CD_MUN);
    select({title: `${f.properties.NM_MUN} / ${f.properties.SIGLA_UF}`, sub: `${fmt(new Set(r.map(x => x[0])).size)} relatórios citam o município como local de projeto (precisão: município)`,
      pts: [], procs: [], mun: r, el});
  }
  function renderRefs(sel) {
    const by = new Map();
    const get = d => { let g = by.get(d); if (!g) by.set(d, g = {pages: new Set(), pts: 0, furos: 0, procs: [], projetos: new Set()}); return g; };
    sel.pts.forEach(o => new Set(o.r.map(r => r[0])).forEach(d => { const g = get(d); g.pts++; if (o.p[2] === 0) g.furos++; }));
    sel.pts.forEach(o => o.r.forEach(([d, pg]) => pg && get(d).pages.add(pg)));
    sel.procs.forEach(o => o.r.forEach(([d, pg]) => { const g = get(d); if (!g.procs.includes(o.p.id)) g.procs.push(o.p.id); if (pg) g.pages.add(pg); }));
    sel.mun.forEach(([d, proj, pgs]) => { const g = get(d); g.projetos.add(proj); String(pgs).split(';').filter(Boolean).forEach(p => g.pages.add(+p)); });
    const arr = [...by.entries()].sort((a, b) => DOCS[b[0]].d.localeCompare(DOCS[a[0]].d));
    renderSgbDetail(sel);
    $('refHead').hidden = !arr.length;
    $('detailTitle').textContent = sel.title;
    $('detailSub').textContent = sel.sub;
    $('detailClear').hidden = false;
    $('refList').innerHTML = arr.map(([d, g]) => {
      const D = DOCS[d], url = '../' + encodeURI(D.p);
      const pages = [...g.pages].sort((a, b) => a - b);
      const what = [g.pts && `${g.pts} pontos${g.furos ? ` (${g.furos} furos)` : ''}`, g.procs.length && `processos ${g.procs.slice(0, 8).join(', ')}${g.procs.length > 8 ? '…' : ''}`,
        g.projetos.size && `projeto ${[...g.projetos].join(', ')}`].filter(Boolean).join(' · ');
      const rep = D.rep >= 0 ? ` <span class="tag rep" title="${esc(DOCS[D.rep].t)}">repete ${esc(DOCS[D.rep].d.slice(0, 10))}</span>` : (D.n ? '' : ' <span class="tag rep">repetição</span>');
      const coleta = D.ci || D.cf ? `coleta ${esc(D.ci)}${D.cf && D.cf !== D.ci ? '–' + esc(D.cf) : ''}` : 'coleta não informada';
      return `<li class="ref"><div class="ref-top"><span class="ref-title">${esc(D.t || '(sem título)')}</span>
        <span>${D.n ? '<span class="tag novo">dados novos</span>' : ''}${rep}</span></div>
        <div class="ref-meta">${esc(D.e)} · enviado ao SEDAR+ em ${esc(D.d)}${D.de ? ` · data efetiva ${esc(D.de)}` : ''} · ${coleta}<br>
        ${D.c.length ? esc(D.c.join(', ')) + ' · ' : ''}${D.i.length ? esc(D.i.join(', ')) : ''}${D.pr ? ' · ' + esc(D.pr) : ''}</div>
        <div class="ref-meta">${what}${D.dn ? ` — <i>${esc(D.dn)}</i>` : ''}</div>
        <div class="ref-pages"><a href="${url}" target="_blank" rel="noopener">abrir PDF (${D.pg} p.)</a>
        ${pages.length ? 'págs.: ' + pages.slice(0, 40).map(p => `<a href="${url}#page=${p}" target="_blank" rel="noopener">${p}</a>`).join('') + (pages.length > 40 ? '…' : '') : ''}</div>
        <div class="ref-meta mono">${esc(D.p)}</div></li>`;
    }).join('');
  }

  // ---------- SGB detail ----------
  const MAXL = 40;
  const rigeo = di => { if (di == null || di < 0) return ''; const D = SGB.docs[di]; return `<a href="${esc(D.u)}" target="_blank" rel="noopener">${esc(D.t || D.u)}</a>${D.y ? ` <span class="muted">(${esc(D.y)}${D.ty ? ' · ' + esc(D.ty) : ''})</span>` : ''}`; };
  const more = (n, shown) => n > shown ? `<li class="muted">+ ${fmt(n - shown)} itens</li>` : '';
  const block = (d, n, body, open) => `<details${open ? ' open' : ''}><summary><span class="sw" style="background:${d.cor}"></span>${esc(d.nome)} <span class="n">${fmt(n)}</span></summary>${body}</details>`;
  function countBy(arr, key) { const m = new Map(); arr.forEach(i => { const k = key(i); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }

  function renderSgbDetail(sel) {
    const box = $('sgbDetail');
    if (!SGB || (!sel.sgb && !sel.areas)) { box.innerHTML = ''; return; }
    const L = SGB.camadas, parts = [];
    const sg = sel.sgb || {}, nLayers = Object.keys(sg).length + (sel.areas?.length ? 1 : 0);
    const open = nLayers <= 2;
    for (const d of SGB_PT) {
      const idx = sg[d.k]; if (!idx || !idx.length) continue;
      const o = L[d.k];
      let body = '';
      if (d.k === 'ocorr') {
        const rank = i => (o.im_l[o.im[i]] === 'Depósito' ? 0 : o.st_l[o.st[i]] === 'Mina' ? 1 : 2);
        const s = [...idx].sort((a, b) => rank(a) - rank(b));
        body = '<ul>' + s.slice(0, MAXL).map(i => `<li><b>${esc(o.nm[i] || '(sem nome)')}</b> — ${esc(o.cn[i].join(', '))} · ${esc(o.st_l[o.st[i]])} · ${esc(o.im_l[o.im[i]])} <span class="muted">· ${esc(o.mun[i])}/${o.uf[i]}${o.ro[i] ? ' · ' + esc(o.ro[i]) : ''}</span></li>`).join('') + more(s.length, MAXL) + '</ul>';
      } else if (d.k === 'recmin') {
        body = '<ul>' + idx.slice(0, MAXL).map(i => `<li><b>${esc(o.nm[i])}</b> — ${esc(o.ce[i])} · ${esc(o.cl_l[o.cl[i]])} · porte ${esc(o.sz_l[o.sz[i]])} <span class="muted">· ${esc(o.st[i])} · ${esc(o.ot[i])}</span></li>`).join('') + more(idx.length, MAXL) + '</ul>';
      } else if (d.k === 'geoq') {
        const byPj = new Map();
        idx.forEach(i => { let g = byPj.get(o.pj[i]); if (!g) byPj.set(o.pj[i], g = []); g.push(i); });
        const s = [...byPj.entries()].sort((a, b) => b[1].length - a[1].length);
        body = '<ul>' + s.slice(0, MAXL).map(([pj, is]) => {
          const P = o.pj_l[pj], yrs = is.map(i => o.yr[i]).filter(Boolean);
          const cls = countBy(is, i => o.cl_l[o.cl[i]]).map(([c, n]) => `${fmt(n)} ${esc(c.toLowerCase())}`).join(', ');
          return `<li><b>${esc(P.t)}</b> — ${fmt(is.length)} amostras (${cls})${yrs.length ? ` · coleta ${d3.min(yrs)}${d3.max(yrs) !== d3.min(yrs) ? '–' + d3.max(yrs) : ''}` : ''}${P.doc >= 0 ? '<br>relatório: ' + rigeo(P.doc) : ''}</li>`;
        }).join('') + more(s.length, MAXL) + '</ul>';
      } else if (d.k === 'geocron') {
        body = '<ul>' + idx.slice(0, MAXL).map(i => `<li><b>${esc(o.am[i])}</b> — ${esc(o.ro[i])} · ${esc(o.me[i] || 'método não informado')} <span class="muted">· ${esc(o.ma[i] || '')}</span></li>`).join('') + more(idx.length, MAXL) + '</ul>';
      } else if (d.k === 'grav') {
        const b = idx.map(i => o.b[i]).filter(v => v != null);
        body = `<ul><li>${fmt(idx.length)} estações gravimétricas${b.length ? ` · anomalia Bouguer de ${d3.min(b)} a ${d3.max(b)} mGal (mediana ${d3.median(b).toFixed(1)})` : ''}</li></ul>`;
      } else if (d.k === 'pocos') {
        const pr = idx.map(i => o.pr[i]).filter(v => v != null);
        const nat = countBy(idx, i => o.nat_l[o.nat[i]]).map(([c, n]) => `${fmt(n)} ${esc(c.toLowerCase())}`).join(', ');
        const aq = countBy(idx.filter(i => o.aq[i]), i => o.aq[i]).slice(0, 5).map(([c, n]) => `${esc(c)} (${fmt(n)})`).join(', ');
        const siagas = i => o.src_l[o.src[i]] === 'SIAGAS' && o.pid[i] ? ` <a href="https://siagasweb.sgb.gov.br/layout/detalhe.php?ponto=${encodeURIComponent(o.pid[i])}" target="_blank" rel="noopener">ficha SIAGAS</a>` : '';
        body = `<p class="sub-note">${nat}${pr.length ? ` · profundidade mediana ${d3.median(pr).toFixed(0)} m (máx. ${fmt(d3.max(pr))} m)` : ''}${aq ? ` · aquíferos: ${aq}` : ''}</p><ul>`
          + [...idx].sort((a, b) => (o.pr[b] ?? -1) - (o.pr[a] ?? -1)).slice(0, MAXL).map(i => `<li><b>${esc(o.nm[i] || o.pid[i])}</b> — ${esc(o.nat_l[o.nat[i]])}${o.pr[i] != null ? ` · ${o.pr[i]} m` : ''}${o.aq[i] ? ` · ${esc(o.aq[i])}` : ''} <span class="muted">· ${esc(o.sit[i])}${o.uso[i] ? ' · ' + esc(o.uso[i]) : ''} · ${esc(o.mun[i])}/${o.uf[i]} · ${o.src_l[o.src[i]]}</span>${siagas(i)}</li>`).join('')
          + more(idx.length, MAXL) + '</ul>';
      } else if (d.k === 'fontes') {
        body = '<ul>' + idx.map(i => `<li><b>${esc(o.nm[i])}/${o.uf[i]}</b> — ${fmt(o.q[i])} fontes hidrominerais cadastradas</li>`).join('') + '</ul>';
      } else if (d.k === 'teses') {
        // one line per thesis (a thesis can have several points in the cell), newest first
        const T = o.T, lugares = new Map();
        idx.forEach(i => { const t = o.d[i]; if (!lugares.has(t)) lugares.set(t, new Set()); lugares.get(t).add(o.lg_l[o.lg[i]]); });
        const ts = [...lugares.keys()].sort((a, b) => (T.a[b] || '').localeCompare(T.a[a] || ''));
        const lnk = t => `<a href="https://bdtd.ibict.br/vufind/Record/${encodeURIComponent(T.id[t])}" target="_blank" rel="noopener">BDTD</a>${T.pdf[t] ? ` · <a href="${esc(T.pdf[t])}" target="_blank" rel="noopener">PDF</a>` : ''}`;
        body = `<p class="sub-note">${fmt(ts.length)} trabalhos · ${fmt(ts.filter(t => T.tp[t] === 1).length)} teses de doutorado · ${fmt(ts.filter(t => T.tm[t]).length)} sobre recursos minerais e mineração</p><ul>`
          + ts.slice(0, MAXL).map(t => `<li><b>${esc(T.t[t])}</b> <span class="muted">— ${o.tp_l[T.tp[t]]} · ${esc(T.a[t])} · ${esc(T.ins[t])} · ${esc([...lugares.get(t)].join(', '))}</span><br>${lnk(t)}</li>`).join('')
          + more(ts.length, MAXL) + '</ul>';
      } else if (d.k === 'mt') {
        body = '<ul>' + countBy(idx, i => o.pj[i]).map(([pj, n]) => {
          const ds = idx.filter(i => o.pj[i] === pj).map(i => o.d[i]).filter(Boolean).sort();
          return `<li><b>${esc(o.pj_l[pj])}</b> — ${fmt(n)} estações${ds.length ? ` · ${ds[0].slice(0, 4)}${ds[ds.length - 1].slice(0, 4) !== ds[0].slice(0, 4) ? '–' + ds[ds.length - 1].slice(0, 4) : ''}` : ''}</li>`;
        }).join('') + '</ul>';
      }
      parts.push(block(d, idx.length, body, open));
    }
    for (const d of SGB_COV.concat(SGB_AREA)) {
      const as = (sel.areas || []).filter(x => x.k === d.k); if (!as.length) continue;
      let li;
      if (d.k === 'aero') li = ({a}) => `<li><b>${esc(a.t)}</b> — ${esc(a.m)} · ${esc(a.a)}${a.km2 ? ` · ${fmt(+a.km2)} km²` : ''}${a.lv ? ` · linhas a ${esc(a.lv)} m` : ''}${a.h ? `, voo a ${esc(a.h)} m` : ''} <span class="muted">· ${esc(a.ct)} · ${esc(a.s.toLowerCase())} · projeto ${esc(a.id)}</span></li>`;
      if (d.k === 'geoqproj') li = ({a}) => `<li><b>${esc(a.t)}</b> — escala ${esc(a.esc)} · ${a.a0}${a.a1 && a.a1 !== a.a0 ? '–' + a.a1 : ''} <span class="muted">· ${esc(a.ue)}</span>${a.doc >= 0 ? '<br>relatório: ' + rigeo(a.doc) : ''}</li>`;
      if (d.k === 'folhas') li = ({a}) => `<li><b>${esc(a.cod)}</b> — ${esc(a.t)} · ${a.esc} · ${esc(a.a)}${a.doc >= 0 ? '<br>mapa/relatório: ' + rigeo(a.doc) : ''}`
        + `${a.pdf ? `<br><a href="${esc(a.pdf)}" target="_blank" rel="noopener">PDF do mapa</a>` : ''}${a.sig ? ` · <a href="${esc(a.sig)}" target="_blank" rel="noopener">SIG (shapefile)</a>` : ''}</li>`;
      if (d.k === 'distau') li = ({a}) => `<li><b>Distrito ${esc(a.t)}</b> — província ${esc(a.prov)} · ${esc(a.ug)} · ${esc(a.uf)}</li>`;
      if (d.k === 'provau') li = ({a}) => `<li><b>${esc(a.t)}</b> — ${esc(a.pg)} · ${esc(a.uf)}</li>`;
      if (d.k === 'geol') li = ({a}) => `<li><b>${esc(a.t)}</b> (${esc(a.s)}) — ${geolIdade(a)}${a.hi ? ` · ${esc(a.hi)}` : ''}${a.li ? `<br><span class="muted">litotipos: ${esc(a.li)}</span>` : ''}${a.am ? `<br><span class="muted">ambiente tectônico: ${esc(a.am)}</span>` : ''}</li>`;
      if (d.k === 'hidro') li = ({a}) => `<li><b>${esc(a.t)}</b> (${esc(a.s)}) — domínio ${esc(SGB.cat.hidro[a.c])}${a.sd ? ` · subdomínio ${esc(a.sd)}` : ''}${a.po ? ` · potencial ${esc(a.po.toLowerCase())}` : ''}</li>`;
      const s = [...as].sort((x, y) => String(y.a.a || y.a.a1 || '').localeCompare(String(x.a.a || x.a.a1 || '')));
      parts.push(block(d, as.length, '<ul>' + s.slice(0, MAXL).map(li).join('') + more(s.length, MAXL) + '</ul>', open || as.length <= 5));
    }
    box.innerHTML = parts.length ? `<div class="sgb-block"><h3>Dados públicos ${sg.teses?.length ? (Object.keys(sg).length > 1 || sel.areas?.length ? 'SGB/CPRM e BDTD' : 'BDTD') : 'SGB/CPRM'}</h3>`
      + (sel.areaNote && sel.areas?.length ? `<p class="sub-note">Áreas: ${esc(sel.areaNote)}.</p>` : '') + parts.join('') + '</div>' : '';
  }
})();
