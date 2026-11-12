"""Export the SGB/CPRM scraper output (scrapers_sgb, `python -m scrapers_sgb ...`) into compact JSON for the dashboard.

Reads the scrapers' data directory (default: <repo>/data, override with --dados or SGB_DATA) and writes:
  data/sgb.json            RIGeo reports cited by the layers, commodity list and the smaller layers:
                           ocorrências minerais, recursos minerais PDAC 2024, geocronologia, gravimetria,
                           magnetotelúrico (points) and aerolevantamentos, projetos geoquímicos,
                           folhas geológicas 1:50.000, distritos auríferos (polygons)
  data/sgb_geoquimica.json the ~365 mil geochemical samples (columnar) and their projects
Every layer is columnar or a short list; coordinates are SIRGAS 2000/WGS84 lon/lat rounded to 4 decimals (~11 m).
Polygons keep only exterior rings, simplified with Douglas-Peucker. RIGeo metadata (rigeo/rigeo_all.jsonl) is
joined through the handles cited by each layer (geochemistry, geochemical projects, 1:50k sheets).

Needs only the Python standard library. Run: ./run.sh --preparar-sgb   (or python3 preparar_sgb.py --dados DIR)
"""
import argparse, csv, datetime, json, os, re, sys

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


def rings(geom, tol=TOL):
    """Exterior rings of a (Multi)Polygon, simplified and rounded; tiny parts dropped."""
    if not geom:
        return []
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']] if geom['type'] == 'Polygon' else []
    out = []
    for poly in polys:
        if not poly:
            continue
        ring = simplify(poly[0], tol)
        if len(ring) >= 4:
            out.append([[r4(x), r4(y)] for x, y, *_ in ring])
    if not out and polys and polys[0]:  # keep at least something for very small polygons
        out.append([[r4(x), r4(y)] for x, y, *_ in polys[0][0]])
    return out


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

    path = p('pdac', 'layers', 'geology_50k.geojson')
    if os.path.exists(path):
        fl = []
        for f in features(path):
            q = f['properties']
            g = rings(f.get('geometry'), 0.0005)
            if g:
                fl.append(dict(t=q.get('PROJETO') or '', cod=q.get('COD_FOLHA') or '', a=q.get('ANO_FIM') or q.get('ANO_MAPA') or '',
                               doc=doc(q.get('GEOSGB_PDF')), g=g))
        L['folhas50'] = fl

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

    n = {k: (len(v['x']) if isinstance(v, dict) else len(v)) for k, v in L.items()}
    n['geoq'] = len(G['x'])
    sgb = dict(gerado=datetime.date.today().isoformat(), comm=comm.items, docs=docs, n=n, camadas=L)
    for name, obj in (('sgb', sgb), ('sgb_geoquimica', G)):
        with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(dict(n=n, docs_rigeo=len(docs), commodities=len(comm.items)), ensure_ascii=False))


if __name__ == '__main__':
    main()
