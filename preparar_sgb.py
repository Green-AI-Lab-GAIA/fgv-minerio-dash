"""Export the SGB/CPRM scraper output (scrapers_sgb, `python -m scrapers_sgb ...`) into compact JSON for the dashboard.

Reads the scrapers' data directory (default: <repo>/data, override with --dados or SGB_DATA) and writes:
  data/sgb.json            RIGeo reports cited by the layers, commodity list and the smaller layers:
                           ocorrências minerais, recursos minerais PDAC 2024, geocronologia, gravimetria,
                           magnetotelúrico, poços (SIAGAS + RIMAS), fontes hidrominerais (points) and
                           aerolevantamentos, projetos geoquímicos, folhas geológicas 1:50.000 a 1:1.000.000,
                           distritos e províncias auríferas (polygons)
  data/sgb_geoquimica.json the ~365 mil geochemical samples (columnar) and their projects
  data/sgb_geologia.json   Geologia do Brasil 1:2.500.000 (litoestratigrafia), loaded by the page on demand
  data/sgb_hidro.json      domínios hidrogeológicos, loaded by the page on demand
Every layer is columnar or a short list; coordinates are SIRGAS 2000/WGS84 lon/lat rounded to 4 decimals (~11 m).
Polygons are simplified with Douglas-Peucker; the small layers keep exterior rings only, the two country-wide maps
keep holes too (the page fills with the even-odd rule). Map sheets without geometry (1:100k, 1:250k, 1:1M) get the
rectangle given by their code in the systematic mapping index (e.g. SI-22-V-A-I). RIGeo metadata
(rigeo/rigeo_all.jsonl) is joined through the handles cited by each layer (geochemistry, projects, map sheets).

Needs only the Python standard library. Run: ./run.sh --preparar-sgb   (or python3 preparar_sgb.py --dados DIR)
"""
import argparse, csv, datetime, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data')
csv.field_size_limit(sys.maxsize)

# commodity names aligned with the SEDAR+ vocabulary used by the dashboard (meta.json -> commodities)
PT = {'ferro': 'minério de ferro', 'fósforo': 'fosfato', 'alumínio': 'bauxita', 'terras-raras': 'terras raras',
      'terras raras (etr)': 'terras raras', 'platinóides': 'platina', 'sal-gema': 'sal'}
EN = {'au': 'ouro', 'cu': 'cobre', 'fe': 'minério de ferro', 'ni': 'níquel', 'li': 'lítio', 'diamond': 'diamante',
      'pt': 'platina', 'pd': 'paládio', 'zn': 'zinco', 'p2o5': 'fosfato', 'v': 'vanádio', 'ree': 'terras raras',
      'k': 'potássio', 'k salt': 'potássio', 'mn': 'manganês', 'graphite': 'grafita', 'ti': 'titânio', 'pb': 'chumbo',
      'ag': 'prata', 'co': 'cobalto', 'sn': 'estanho', 'w': 'tungstênio', 'al': 'bauxita', 'u': 'urânio',
      'cr': 'cromo', 'nb': 'nióbio', 'ta': 'tântalo', 'be': 'berílio', 'mo': 'molibdênio', 'zr': 'zircônio',
      'sc': 'escândio', 'kaolinite': 'caulim', 'magnesita': 'magnesita', 'asbestos': 'amianto', 'sal': 'sal',
      's': 'enxofre', 'ba': 'bário', 'mg': 'magnésio'}

TOL = 0.003  # polygon simplification tolerance in degrees (~300 m)


def r4(v):
    return round(float(v), 4)


def handle(url):
    m = re.search(r'handle/(doc/\d+)', str(url or ''))
    return m.group(1) if m else None


def features(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)['features']


def simplify(pts, tol):
    """Douglas-Peucker on a list of [x, y] (iterative)."""
    if len(pts) < 5:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) ** 0.5
        dmax, imax = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L if L else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > dmax:
                dmax, imax = d, i
        if dmax > tol:
            keep[imax] = True
            stack += [(a, imax), (imax, b)]
    return [p for p, k in zip(pts, keep) if k]


def rings(geom, tol=TOL, holes=False, nd=4, min_part=0):
    """Rings of a (Multi)Polygon, simplified and rounded to nd decimals. Exterior rings only unless holes=True;
    holes smaller than 2*tol and extra parts smaller than min_part degrees are dropped (the first exterior ring
    survives as is if nothing else is left)."""
    if not geom:
        return []
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']] if geom['type'] == 'Polygon' else []
    out = []
    for poly in polys:
        for k, ring in enumerate(poly if holes else poly[:1]):
            xs, ys = [c[0] for c in ring], [c[1] for c in ring]
            size = max(max(xs) - min(xs), max(ys) - min(ys))
            if (k and size < 2 * tol) or (not k and out and size < min_part):
                if not k:
                    break  # exterior dropped: its holes must go too, or they would be filled as land
                continue  # hole too small to see
            r = simplify(ring, tol)
            if len(r) >= 4:
                out.append([[round(x, nd), round(y, nd)] for x, y, *_ in r])
            elif not k:
                break
    if not out and polys and polys[0]:  # keep at least something for very small polygons
        out.append([[r4(x), r4(y)] for x, y, *_ in polys[0][0]])
    return out


def stream_features(path):
    """Features of a GeoJSON written by scrapers_sgb (one feature per line), without loading the whole file."""
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip().rstrip(',')
            if line.startswith('{"type":"Feature"') or line.startswith('{"type": "Feature"'):
                yield json.loads(line)


def sheet_bbox(code):
    """[minx, miny, maxx, maxy] of a sheet of the international / Brazilian systematic mapping index.
    1:1M 'SI-22' (6° x 4°) > 1:500k V X / Y Z (3° x 2°) > 1:250k A B / C D (1.5° x 1°) >
    1:100k I II III / IV V VI (0.5° x 0.5°) > 1:50k 1 2 / 3 4 (0.25° x 0.25°). None if the code is not valid."""
    m = re.fullmatch(r'([NS])([A-V])-(\d{1,2})((?:-[A-Z0-9]+)*)', (code or '').strip().upper())
    if not m:
        return None
    hemi, band, zone, rest = m.group(1), ord(m.group(2)) - ord('A'), int(m.group(3)), m.group(4)
    if not 1 <= zone <= 60:
        return None
    x0, w, h = -180 + (zone - 1) * 6, 6.0, 4.0
    y0 = band * 4 if hemi == 'N' else -(band + 1) * 4
    # every level splits the parent sheet into 2 rows (counted from the north) and 2 or 3 columns
    levels = [(list('VXYZ'), 2), (list('ABCD'), 2), (['I', 'II', 'III', 'IV', 'V', 'VI'], 3), (['1', '2', '3', '4'], 2)]
    parts = [p for p in rest.split('-') if p]
    if len(parts) > len(levels):
        return None
    for part, (names, cols) in zip(parts, levels):
        if part not in names:
            return None
        row, col = divmod(names.index(part), cols)
        w, h = w / cols, h / 2
        x0, y0 = x0 + col * w, y0 + (1 - row) * h
    return [x0, y0, x0 + w, y0 + h]


class Index:
    """Value -> position list, for categorical columns."""

    def __init__(self):
        self.items, self.pos = [], {}

    def __call__(self, v):
        if v not in self.pos:
            self.pos[v] = len(self.items)
            self.items.append(v)
        return self.pos[v]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dados', default=os.environ.get('SGB_DATA') or os.path.join(os.path.dirname(HERE), 'data'),
                    help='diretório de saída dos scrapers (com geosgb/, rigeo/, p3mgeo/, pdac/)')
    a = ap.parse_args()
    D = os.path.abspath(os.path.expanduser(a.dados))
    if not os.path.isdir(os.path.join(D, 'geosgb')):
        sys.exit(f'não achei {D}/geosgb — rode os scrapers ou passe --dados')
    p = lambda *x: os.path.join(D, *x)
    os.makedirs(OUT, exist_ok=True)

    # RIGeo metadata, keyed by handle
    rigeo = {}
    if os.path.exists(p('rigeo', 'rigeo_all.jsonl')):
        for line in open(p('rigeo', 'rigeo_all.jsonl'), encoding='utf-8'):
            if line.strip():
                r = json.loads(line)
                rigeo[r['handle']] = r
    docs, doc_pos = [], {}

    def doc(url):
        h = handle(url)
        if not h:
            return -1
        if h not in doc_pos:
            r = rigeo.get(h, {})
            doc_pos[h] = len(docs)
            docs.append(dict(t=r.get('title') or '', a=(r.get('authors') or '')[:160], y=(r.get('date_issued') or '')[:4],
                             ty=r.get('type') or '', u=f'https://rigeo.sgb.gov.br/handle/{h}'))
        return doc_pos[h]

    comm = Index()

    def comm_pt(s):
        out = []
        for part in re.split(r'[,;]', s or ''):
            v = part.strip().lower()
            if v:
                v = PT.get(v, v)
                i = comm(v)
                if i not in out:
                    out.append(i)
        return out

    def comm_en(s):
        out = []
        for part in re.split(r'[-,;/]', s or ''):
            v = part.strip().lower().replace('_', ' ')
            if v:
                i = comm(EN.get(v, v))
                if i not in out:
                    out.append(i)
        return out

    L = {}
    # ---- ocorrências minerais (GeoSGB)
    st, im = Index(), Index()
    o = dict(x=[], y=[], nm=[], mun=[], uf=[], c=[], st=[], im=[], ro=[])
    for f in features(p('geosgb', 'recursos_minerais', 'ocorrencias_minerais.geojson')):
        g, q = f.get('geometry'), f['properties']
        if not g:
            continue
        o['x'].append(r4(g['coordinates'][0])); o['y'].append(r4(g['coordinates'][1]))
        o['nm'].append((q.get('toponimia') or '')[:50]); o['mun'].append(q.get('municipio') or '')
        o['uf'].append(q.get('uf') or ''); o['c'].append(comm_pt(q.get('substancias')))
        o['st'].append(st(q.get('status_economico') or 'Indeterminado'))
        o['im'].append(im(q.get('importancia') or 'Indeterminado'))
        o['ro'].append((q.get('rochas_hospedeiras') or '')[:60])
    o.update(st_l=st.items, im_l=im.items)
    L['ocorr'] = o

    # ---- recursos minerais PDAC 2024 (P3MGeo)
    path = p('p3mgeo', 'camadas', 'vw_cprm_pdac_rec_min_2024.geojson')
    if os.path.exists(path):
        cl, sz = Index(), Index()
        o = dict(x=[], y=[], nm=[], c=[], ce=[], cl=[], sz=[], st=[], ot=[])
        for f in features(path):
            g, q = f.get('geometry'), f['properties']
            if not g:
                continue
            o['x'].append(r4(g['coordinates'][0])); o['y'].append(r4(g['coordinates'][1]))
            o['nm'].append(q.get('name') or ''); o['c'].append(comm_en(q.get('commodities')))
            o['ce'].append(q.get('commodities') or '')
            o['cl'].append(cl(q.get('class_dp') or '')); o['sz'].append(sz((q.get('size_dp') or '').replace('World Class', 'World-Class')))
            o['st'].append(q.get('status_dp') or ''); o['ot'].append(q.get('ore_type') or '')
        o.update(cl_l=cl.items, sz_l=sz.items)
        L['recmin'] = o

    # ---- geocronologia
    o = dict(x=[], y=[], am=[], ro=[], me=[], ma=[])
    for f in features(p('geosgb', 'geologia', 'geocronologia.geojson')):
        g, q = f.get('geometry'), f['properties']
        if not g:
            continue
        o['x'].append(r4(g['coordinates'][0])); o['y'].append(r4(g['coordinates'][1]))
        o['am'].append(q.get('amostra') or ''); o['ro'].append(q.get('rocha') or '')
        o['me'].append(q.get('metodos') or ''); o['ma'].append(q.get('materiais_analisados') or '')
    L['geocron'] = o

    # ---- gravimetria
    o = dict(x=[], y=[], b=[])
    for f in features(p('geosgb', 'geofisica', 'gravimetria.geojson')):
        g, q = f.get('geometry'), f['properties']
        if not g:
            continue
        o['x'].append(r4(g['coordinates'][0])); o['y'].append(r4(g['coordinates'][1]))
        b = q.get('anom_bougu')
        o['b'].append(round(b, 1) if isinstance(b, (int, float)) else None)
    L['grav'] = o

    # ---- magnetotelúrico
    pj = Index()
    o = dict(x=[], y=[], pj=[], s=[], d=[], ins=[])
    for f in features(p('geosgb', 'geofisica', 'magnetotelurico.geojson')):
        g, q = f.get('geometry'), f['properties']
        if not g:
            continue
        o['x'].append(r4(g['coordinates'][0])); o['y'].append(r4(g['coordinates'][1]))
        o['pj'].append(pj(q.get('Project') or '')); o['s'].append(str(q.get('SiteID') or ''))
        o['d'].append(q.get('StartDate') or ''); o['ins'].append(q.get('Institution') or '')
    o['pj_l'] = pj.items
    L['mt'] = o

    # ---- polygons
    aero = []
    for f in features(p('geosgb', 'geofisica', 'aerogeofisica.geojson')):
        q = f['properties']
        g = rings(f.get('geometry'))
        if g:
            aero.append(dict(t=q.get('TITULO') or '', m=q.get('METODOS') or '', a=q.get('ANO_CONCLUSAO') or q.get('ANO_PROJETO') or '',
                             km2=q.get('AREA_LEVANTADA_KM2') or '', lv=q.get('ESPACAMENTO_LV_M') or '',
                             h=q.get('ALTURA_VOO_M') or '', ct=q.get('CONTRATANTE') or '', s=q.get('SITUACAO') or '',
                             id=q.get('ID_PROJETO') or '', g=g))
    L['aero'] = aero

    gp = []
    for f in features(p('geosgb', 'geoquimica', 'geoquimica_projetos.geojson')):
        q = f['properties']
        g = rings(f.get('geometry'))
        if g:
            gp.append(dict(t=q.get('nome_do_projeto') or '', esc=q.get('escala_do_projeto') or '',
                           a0=q.get('ano_inicio') or '', a1=q.get('ano_final') or '', ue=q.get('unidade_executora') or '',
                           doc=doc(q.get('url_rigeo')), g=g))
    L['geoqproj'] = gp

    # geological map sheets (PDAC): 1:50k has geometry; the others get the rectangle of their sheet code(s)
    fl, sem_geo = [], []
    for esc, name in (('1:50.000', 'geology_50k'), ('1:100.000', 'geology_100k'), ('1:250.000', 'geology_250k'),
                      ('1:1.000.000', 'geology_1m')):
        path = p('pdac', 'layers', name + '.geojson')
        if not os.path.exists(path):
            continue
        for f in features(path):
            q = f['properties']
            code = (q.get('COD_FOLHA') or '').strip()
            g = rings(f.get('geometry'), 0.0005)
            if not g:
                for c in dict.fromkeys(re.findall(r'[NS][A-V][.-]\d{1,2}(?:-[A-Z0-9]+)*', code.upper())):  # unique, in order
                    bb = sheet_bbox(c.replace('.', '-'))
                    if bb:
                        x0, y0, x1, y1 = bb
                        g.append([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]])
            if not g:
                sem_geo.append(f'{name}: {code!r}')
                continue
            pdf, sig = (q.get('GEOSGB_PDF') or '').strip(), (q.get('GEOSGB_SIG') or '').strip()
            fl.append(dict(t=q.get('PROJETO') or '', cod=code, esc=esc, a=q.get('ANO_FIM') or q.get('ANO_MAPA') or '',
                           doc=doc(pdf), pdf=pdf if pdf.startswith('http') and not handle(pdf) else '',
                           sig=sig if sig.startswith('http') else '', g=g))
    if sem_geo:
        print(f'{len(sem_geo)} folhas sem código válido nem geometria (ignoradas):', '; '.join(sem_geo[:8]), file=sys.stderr)
    L['folhas'] = fl

    path = p('p3mgeo', 'camadas', 'vw_cprm_au_prov_br.geojson')
    if os.path.exists(path):
        L['provau'] = [dict(t=q.get('prov_aurif') or '', pg=q.get('provin_geo') or '', uf=q.get('local_') or '', g=g)
                       for f in features(path) for q, g in [(f['properties'], rings(f.get('geometry')))] if g]

    # ---- poços (SIAGAS, only the states that were downloaded, and RIMAS) and hydromineral springs
    nat, fonte = Index(), Index()
    o = dict(x=[], y=[], nm=[], nat=[], aq=[], pr=[], mun=[], uf=[], sit=[], uso=[], src=[], pid=[])
    seen = set()

    def poco(x, y, pid, nm, natureza, aq, prof, mun, uf, sit, uso, src):
        if pid and pid in seen:
            return
        seen.add(pid)
        try:
            prof = round(float(prof), 1) if prof not in (None, '') else None
        except (TypeError, ValueError):
            prof = None
        o['x'].append(r4(x)); o['y'].append(r4(y)); o['nm'].append((nm or '')[:40]); o['nat'].append(nat(natureza or 'Não informado'))
        o['aq'].append(aq or ''); o['pr'].append(prof); o['mun'].append(mun or ''); o['uf'].append(uf or '')
        o['sit'].append(sit or ''); o['uso'].append(uso or ''); o['src'].append(fonte(src)); o['pid'].append(pid)

    ufs = []
    for path in sorted(glob.glob(p('geosgb', 'hidrogeologia', 'siagas*.csv'))):
        for r in csv.DictReader(open(path, encoding='utf-8-sig')):
            try:
                x, y = float(r.get('_lon') or r.get('longitude')), float(r.get('_lat') or r.get('latitude'))
            except (TypeError, ValueError):
                continue
            poco(x, y, str(r.get('idt_ponto') or ''), r.get('nome_ponto'), r.get('natureza_ponto'), r.get('aquifero'),
                 r.get('profundidade_m'), r.get('municipio'), r.get('uf'), r.get('situacao'), r.get('uso_agua'), 'SIAGAS')
            if r.get('uf') and r['uf'] not in ufs:
                ufs.append(r['uf'])
    path = p('geosgb', 'hidrogeologia', 'rimas.geojson')
    if os.path.exists(path):
        for f in features(path):
            g, q = f.get('geometry'), f['properties']
            if g:
                # RIMAS has no aquifer field (str_bacia is the river basin)
                poco(g['coordinates'][0], g['coordinates'][1], str(q.get('idt_ponto') or ''), q.get('str_nome_ponto'),
                     q.get('str_natureza_ponto'), '', q.get('num_profundidade'), q.get('str_municipio'),
                     q.get('str_uf'), q.get('str_tipo_situacao'), q.get('str_uso_agua'), 'RIMAS')
    if o['x']:
        o.update(nat_l=nat.items, src_l=fonte.items, siagas_ufs=ufs)
        L['pocos'] = o

    path = p('geosgb', 'hidrogeologia', 'fontes_hidrominerais.geojson')
    if os.path.exists(path):
        o = dict(x=[], y=[], nm=[], uf=[], q=[])
        for f in features(path):
            g, q = f.get('geometry'), f['properties']
            if g:
                o['x'].append(r4(g['coordinates'][0])); o['y'].append(r4(g['coordinates'][1]))
                o['nm'].append(q.get('cidade') or ''); o['uf'].append(q.get('uf') or ''); o['q'].append(q.get('quantd') or 0)
        L['fontes'] = o

    path = p('p3mgeo', 'camadas', 'vw_cprm_au_dist_br.geojson')
    if os.path.exists(path):
        da = []
        for f in features(path):
            q = f['properties']
            g = rings(f.get('geometry'))
            if g:
                da.append(dict(t=q.get('distrit_au') or '', prov=q.get('prov_aurif') or '', ug=q.get('unid_geot') or '',
                               uf=q.get('estado') or '', g=g))
        L['distau'] = da

    # ---- geoquímica: amostras (big file)
    cls, prj = Index(), Index()
    pinfo = {}
    G = dict(x=[], y=[], cl=[], pj=[], yr=[])
    for r in csv.DictReader(open(p('geosgb', 'geoquimica', 'geoquimica_amostras.csv'), encoding='utf-8-sig')):
        try:
            x, y = float(r['_lon']), float(r['_lat'])
        except (TypeError, ValueError):
            continue
        key = (r['PROJETO'].strip(), handle(r['URL']))
        k = prj(key)
        if k not in pinfo:
            pinfo[k] = dict(t=key[0], doc=doc(r['URL']), n=0)
        pinfo[k]['n'] += 1
        try:
            yr = datetime.datetime.utcfromtimestamp(int(float(r['DTVISITA'])) / 1000).year
        except (TypeError, ValueError, OverflowError, OSError):
            yr = 0
        G['x'].append(r4(x)); G['y'].append(r4(y)); G['cl'].append(cls(r['CLASSE'].strip() or 'Outros'))
        G['pj'].append(k); G['yr'].append(yr if 1950 <= yr <= 2030 else 0)
    G.update(cl_l=cls.items, pj_l=[pinfo[i] for i in range(len(prj.items))])

    # ---- country-wide maps in their own files (the page loads them only when the layer is turned on)
    extra = {}
    path = p('geosgb', 'geologia', 'litoestratigrafia_2_5m.geojson')
    if os.path.exists(path):
        cat, items = Index(), []
        for f in stream_features(path):
            q = f['properties']
            g = rings(f.get('geometry'), 0.007, holes=True, nd=3, min_part=0.02)
            if g:
                items.append(dict(t=q.get('NOME') or '', s=q.get('SIGLA') or '', c=cat(q.get('ERA_MAX') or 'Indefinida'),
                                  e0=q.get('ERA_MIN') or '', i0=q.get('IDADE_MIN'), i1=q.get('IDADE_MAX'),
                                  li=(q.get('LITOTIPOS') or '')[:140], hi=q.get('HIERARQUIA') or '',
                                  am=q.get('AMBIENTE_TECTONICO') or '', g=g))
        extra['sgb_geologia'] = dict(cat_l=cat.items, items=items)
    path = p('geosgb', 'hidrogeologia', 'dominios_hidrogeologicos.geojson')
    if os.path.exists(path):
        cat, items = Index(), []
        for f in stream_features(path):
            q = f['properties']
            g = rings(f.get('geometry'), 0.012, holes=True, nd=3, min_part=0.05)
            if g:
                items.append(dict(t=q.get('nome_unida') or '', s=q.get('sigla_unid') or '', c=cat(q.get('dom') or 'Indefinido'),
                                  sd=q.get('subdom') or '', po=q.get('potenc') or '', g=g))
        extra['sgb_hidro'] = dict(cat_l=cat.items, items=items)

    n = {k: (len(v['x']) if isinstance(v, dict) else len(v)) for k, v in L.items()}
    n['geoq'] = len(G['x'])
    if 'sgb_geologia' in extra:
        n['geol'] = len(extra['sgb_geologia']['items'])
    if 'sgb_hidro' in extra:
        n['hidro'] = len(extra['sgb_hidro']['items'])
    sgb = dict(gerado=datetime.date.today().isoformat(), comm=comm.items, docs=docs, n=n, camadas=L)
    for name, obj in [('sgb', sgb), ('sgb_geoquimica', G)] + list(extra.items()):
        with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(dict(n=n, docs_rigeo=len(docs), commodities=len(comm.items)), ensure_ascii=False))


if __name__ == '__main__':
    main()
