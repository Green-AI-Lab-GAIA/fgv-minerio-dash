"""Export the BDTD theses (scrapers_sgb, `python -m scrapers_sgb bdtd harvest`) into compact JSON for the dashboard.

Theses carry no coordinates, so each one is placed by the place names in its title, subjects and coverage field:
  municipio  an IBGE municipality name (from data/brasil_municipios.topojson, point = polygon centroid). Accepted when
             the text also names its state, or when the name exists in one state only. Names right after a
             stratigraphic/structural word (Formação, Grupo, Bacia, Faixa, Granito...) are skipped: "Grupo Macaúbas"
             is a rock unit in MG, not the town of Macaúbas/BA. Common words that are also town names (Granito,
             Turmalina, Barreiras...) need the state too, and each word of the name must be capitalised in the text.
  regiao     a mining/geological district from REGIOES below (Quadrilátero Ferrífero, Carajás, Tapajós...), with an
             approximate centre. Only districts up to ~200 km across: cratons, big basins and fold belts are left out
             because one point would misplace them.
  resumo     nothing in title/subjects/coverage: towns and districts named in the abstract (same rules, up to 3),
             after removing the thesis note, advisor and university names so a thesis does not land on its campus.
  estado     only when nothing finer was found: the state named in the text (centre of its municipalities).
A thesis gets up to 4 points (municipalities and districts); state points are a fallback, never mixed with the others.
  pdf        coordinates written in the thesis itself (study area, samples, drill holes), pulled from its full text by
             `python -m scrapers_sgb bdtd coords` into bdtd/bdtd_coords.jsonl. When they agree (median point, half of
             them within 50 km of it) the thesis gets that single point instead of the name-based ones, and theses
             with no place name get onto the map this way. UTM needs its zone: from the text when it says it, otherwise
             from the place found by name, and then only if the result lands within 150 km of that place.
The same work deposited twice (same title and first author) is kept once.

Reads <repo>/data/bdtd/bdtd_minerio.jsonl (override with --dados or SGB_DATA) and writes data/bdtd.json, loaded by
the page when the layer is turned on; the layer size goes into data/sgb.json (n.teses) so the layer list can show it.
Needs only the Python standard library. Run: ./run.sh --preparar-bdtd   (or python3 preparar_bdtd.py --dados DIR)
"""
import argparse, collections, datetime, json, math, os, re, statistics, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data')

UF_NOME = {'AC': 'Acre', 'AL': 'Alagoas', 'AP': 'Amapá', 'AM': 'Amazonas', 'BA': 'Bahia', 'CE': 'Ceará',
           'DF': 'Distrito Federal', 'ES': 'Espírito Santo', 'GO': 'Goiás', 'MA': 'Maranhão', 'MT': 'Mato Grosso',
           'MS': 'Mato Grosso do Sul', 'MG': 'Minas Gerais', 'PA': 'Pará', 'PB': 'Paraíba', 'PR': 'Paraná',
           'PE': 'Pernambuco', 'PI': 'Piauí', 'RJ': 'Rio de Janeiro', 'RN': 'Rio Grande do Norte',
           'RS': 'Rio Grande do Sul', 'RO': 'Rondônia', 'RR': 'Roraima', 'SC': 'Santa Catarina', 'SP': 'São Paulo',
           'SE': 'Sergipe', 'TO': 'Tocantins'}

# (name variants, lon, lat, UF): districts small enough for one point
REGIOES = [
    (['Quadrilátero Ferrífero', 'Iron Quadrangle', 'Quadrilatero Ferrifero'], -43.65, -20.15, 'MG'),
    (['Província Mineral de Carajás', 'Serra dos Carajás', 'Carajás', 'Carajas'], -50.3, -6.1, 'PA'),
    (['Serra Pelada'], -49.65, -5.95, 'PA'),
    (['Salobo'], -50.55, -5.79, 'PA'),
    (['Sossego'], -50.08, -6.43, 'PA'),
    (['Igarapé Bahia'], -50.6, -6.03, 'PA'),
    (['Tapajós', 'Tapajos'], -56.3, -6.2, 'PA'),
    (['Pitinga'], -60.1, -0.75, 'AM'),
    (['Seis Lagos'], -66.7, 0.3, 'AM'),
    (['Vale do Ribeira'], -48.5, -24.6, 'SP'),
    (['Seridó', 'Serido'], -36.8, -6.6, 'RN'),
    (['Chapada Diamantina'], -41.5, -12.5, 'BA'),
    (['Espinhaço Meridional'], -43.6, -18.4, 'MG'),
    (['Rio das Velhas'], -43.8, -20.0, 'MG'),
    (['Serra do Curral'], -43.95, -19.97, 'MG'),
    (['Serra da Moeda', 'Sinclinal Moeda'], -43.95, -20.25, 'MG'),
    (['Rio Itapicuru'], -39.0, -11.3, 'BA'),
    (['Fazenda Brasileiro'], -39.0, -11.5, 'BA'),
    (['Gurupi'], -46.3, -2.0, 'MA'),
    (['Minas do Camaquã', 'Camaquã'], -53.45, -30.9, 'RS'),
    (['Escudo Sul-Rio-Grandense', 'Escudo Sul-riograndense'], -53.2, -30.8, 'RS'),
    (['Bacia do Araripe', 'Chapada do Araripe'], -39.8, -7.3, 'CE'),
    (['Bacia do Recôncavo', 'Recôncavo Baiano'], -38.5, -12.6, 'BA'),
    (['Bacia Potiguar'], -36.8, -5.2, 'RN'),
    (['Serra da Canastra'], -46.6, -20.2, 'MG'),
    (['Província Estanífera de Rondônia'], -63.0, -10.0, 'RO'),
    (['Província Estanífera de Goiás'], -48.5, -13.8, 'GO'),
    (['Planalto de Poços de Caldas', 'Maciço de Poços de Caldas'], -46.55, -21.85, 'MG'),
    (['Província Aurífera de Alta Floresta', 'Província Aurífera Juruena-Teles Pires'], -56.0, -9.9, 'MT'),
    (['Lavras do Sul'], -53.9, -30.8, 'RS'),
    (['Serra do Navio', 'ICOMI'], -52.0, 0.9, 'AP'),
    (['Província Graciosa'], -49.0, -25.8, 'PR'),
]

# words that turn the next place name into a rock unit / structure name
PREFIXOS = {'formacao', 'formacoes', 'grupo', 'supergrupo', 'subgrupo', 'suite', 'complexo', 'bacia', 'sub-bacia',
            'faixa', 'orogeno', 'cinturao', 'craton', 'macico', 'granito', 'granitoide', 'granitoides', 'pluton',
            'batolito', 'sequencia', 'membro', 'arco', 'bloco', 'dominio', 'terreno', 'provincia', 'lineamento',
            'cisalhamento', 'aquifero', 'sistema', 'rio', 'riacho', 'serra', 'lagoa', 'vale', 'sinclinal', 'anticlinal',
            'greenstone', 'belt', 'unidade', 'corpo', 'intrusao', 'enxame', 'diques', 'dique', 'kimberlito',
            'grupos', 'suites', 'granitico', 'granitica', 'microplaca', 'microplacas', 'companhia', 'fazenda',
            'barragem', 'falha', 'alto', 'campo', 'estreito', 'ilha', 'ilhas', 'pico', 'parque', 'reserva', 'floresta'}
# town names that are also common words in this literature: accepted only with their state in the text
COMUNS = {'granito', 'turmalina', 'ferros', 'cristais', 'areia', 'prata', 'ouro', 'diamante', 'esmeraldas',
          'salinas', 'barreiras', 'serra', 'palmas', 'vitoria', 'uniao', 'esperanca', 'paraiso', 'planalto', 'pedra',
          'lagoa', 'bonito', 'mineiros', 'central', 'carmo', 'cabo', 'brasil', 'natal', 'formosa', 'feliz', 'progresso',
          'campos', 'aurora', 'bandeirantes', 'piranhas', 'caldas', 'itaobim', 'amparo', 'aguas', 'agua', 'alvorada',
          'tapira', 'cascavel', 'cuiaba', 'belem', 'manaus', 'aracaju', 'bom sucesso', 'bom jardim', 'santa rita',
          'canarana', 'sertao', 'estrela', 'triunfo', 'cachoeira', 'pocone', 'goias', 'para', 'parana', 'rio grande',
          'espirito santo', 'sao paulo', 'rio de janeiro', 'amazonas', 'tocantins', 'acre', 'sergipe', 'roraima',
          'pacaraima', 'ipiranga', 'colorado', 'guarani', 'pantanal', 'bocaiuva', 'carandai', 'ladario', 'mirante',
          'mangaratiba', 'arraial', 'lima', 'oliveira', 'moeda', 'jardim', 'cristalina', 'castelo', 'medicina',
          'estreito', 'brasileira', 'fundao', 'alegre', 'socorro', 'correntes', 'riachao', 'cajueiro', 'macacos'}
CONECT = {'de', 'do', 'da', 'dos', 'das', 'e', "d'"}


def plain(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()


def municipios(path):
    """[(name, UF, lon, lat, area)] from the dashboard's topojson (centroid of the biggest ring, area-weighted)."""
    t = json.load(open(path, encoding='utf-8'))
    (sx, sy), (tx, ty) = t['transform']['scale'], t['transform']['translate']
    arcs = []
    for a in t['arcs']:
        x = y = 0
        pts = []
        for dx, dy in a:
            x += dx; y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(idx):
        out = []
        for i in idx:
            seg = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(seg if not out else seg[1:])
        return out

    def centroid(pts):
        a = cx = cy = 0.0
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
            c = x0 * y1 - x1 * y0
            a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
        if abs(a) < 1e-12:
            return None
        return cx / (3 * a), cy / (3 * a), abs(a) / 2

    out = []
    for g in next(iter(t['objects'].values()))['geometries']:
        polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
        best = max((c for c in (centroid(ring(p[0])) for p in polys) if c), key=lambda c: c[2], default=None)
        if best:
            q = g['properties']
            out.append((q['NM_MUN'], q['SIGLA_UF'], round(best[0], 4), round(best[1], 4), float(q.get('AREA_KM2') or 0)))
    return out


class Locator:
    def __init__(self, muns):
        self.estado_xy = {}
        acc = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
        for _, uf, x, y, area in muns:
            w = max(area, 1.0)
            acc[uf][0] += x * w; acc[uf][1] += y * w; acc[uf][2] += w
        self.estado_xy = {uf: (round(a / w, 4), round(b / w, 4)) for uf, (a, b, w) in acc.items()}
        # state names, longest first so "Rio Grande do Sul" wins over "Rio Grande"
        self.re_estado = [(uf, re.compile(r'\b' + re.escape(plain(n)) + r'\b', re.I))
                          for uf, n in sorted(UF_NOME.items(), key=lambda kv: -len(kv[1]))]
        # "Pará" without the accent is the preposition "para": only the accented, capitalised form counts
        self.re_estado = [(uf, re.compile(r'\bPará\b')) if uf == 'PA' else (uf, r) for uf, r in self.re_estado]
        self.re_sigla = re.compile(r'(?:[(\[,/–-]|\bestado d[eoa])\s*(' + '|'.join(UF_NOME) + r')\b(?!-)')
        by_name = collections.defaultdict(list)
        for nm, uf, x, y, _ in muns:
            by_name[plain(nm).lower()].append((nm, uf, x, y))
        self.by_name = by_name
        # one regex for every municipality name, longest first; matched on the accent-free text
        names = sorted(by_name, key=len, reverse=True)
        self.re_mun = re.compile(r"\b(" + '|'.join(re.escape(n) for n in names) + r")\b", re.I)
        self.regioes = [(re.compile(r'\b(' + '|'.join(re.escape(plain(v)) for v in vs) + r')\b', re.I), vs[0], x, y, uf)
                        for vs, x, y, uf in REGIOES]

    def estados(self, text):
        """States named in the text and the accent-free text without those names (so "Rio Grande do Sul" is not
        read as the town of Rio Grande)."""
        found, rest = [], plain(text)
        for uf, r in self.re_estado:
            if uf == 'PA':
                if r.search(text):
                    found.append(uf)
                    rest = re.sub(r'\bPara\b', ' ', rest)
            elif r.search(rest):
                found.append(uf)
                rest = r.sub(' ', rest)
        for m in self.re_sigla.finditer(text):
            if m.group(1) not in found:
                found.append(m.group(1))
        return found, rest

    def _fine(self, text, ufs_extra=()):
        """Municipalities and districts named in text, plus the states it names."""
        ufs, rest = self.estados(text)
        ok_ufs = ufs + [u for u in ufs_extra if u not in ufs]
        places = []
        for r, nome, x, y, uf in self.regioes:
            if r.search(rest):
                places.append(('regiao', nome, uf, x, y))
                rest = r.sub(' ', rest)   # "Vale do Ribeira" is not the town of Ribeira
        upper = sum(c.isupper() for c in rest) > 0.6 * max(1, sum(c.isalpha() for c in rest))
        for m in self.re_mun.finditer(rest):
            raw, key = m.group(1), m.group(1).lower()
            # every word of the name capitalised (skip connectors), unless the whole text is in capitals
            if not upper and any(w[0].islower() for w in raw.split() if w.lower() not in CONECT):
                continue
            before = [w for w in re.findall(r"[\w-]+", rest[max(0, m.start() - 40):m.start()].lower()) if w not in CONECT]
            if before and before[-1] in PREFIXOS:
                continue
            cands = self.by_name[key]
            if ok_ufs:
                cands = [c for c in cands if c[1] in ok_ufs]
            elif len(cands) > 1 or key in COMUNS or upper:
                continue
            for nm, uf, x, y in cands[:1]:
                if not any(p[1] == nm and p[2] == uf for p in places):
                    places.append(('municipio', nm, uf, x, y))
        return places, ufs

    def locate(self, rec):
        text = ' ; '.join(x for x in (rec.get('titulo'), rec.get('assuntos'), rec.get('cobertura')) if x)
        places, ufs = self._fine(text)
        if places:
            return places[:4]
        # nothing in title/subjects: the abstract, with the states of the title also accepted for its towns
        res = limpa_resumo(rec.get('resumo') or '')
        rplaces, rufs = self._fine(res, ufs) if res else ([], [])
        if rplaces:
            return [('resumo',) + p[1:] for p in rplaces[:3]]
        return [('estado', UF_NOME[uf], uf) + self.estado_xy[uf] for uf in (ufs or rufs)[:2] if uf in self.estado_xy]


# boilerplate in the BDTD "description" field: thesis notes, advisors, university names and cities
RESUMO_LIXO = re.compile(
    r"(Tese|Disserta[cç][aã]o|Trabalho de conclus[aã]o|Monografia)\s*\((mestrado|doutorado|graduação)[^)]*\)[^.]*?(\b(19|20)\d\d\b\.?|$)"
    r"|Orienta(dor|dora|ção)[^:]*:[^.;\n]*"
    r"|(Universidade|Faculdade|Instituto|Centro Federal|Escola de Minas|Pontif[ií]cia)[^.,;()]*"
    r"|Programa de P[oó]s[- ]Gradua[cç][aã]o[^.,;()]*", re.I)


def limpa_resumo(s):
    s = RESUMO_LIXO.sub(' ', s)
    return s if len(s.strip()) > 80 else ''


def hav(lon1, lat1, lon2, lat2):
    r = math.radians
    h = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def utm_to_latlon(E, N, zone):
    """Inverse transverse Mercator (WGS84/SIRGAS2000), southern hemisphere (same as scrapers_sgb.bdtd_coords)."""
    k0, a, f = 0.9996, 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    x, y = E - 500000.0, N - 10000000.0
    mu = y / k0 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
         + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    sn, cs, t = math.sin(p), math.cos(p), math.tan(p)
    n1 = a / math.sqrt(1 - e2 * sn * sn); t1, c1 = t * t, ep2 * cs * cs
    r1 = a * (1 - e2) / (1 - e2 * sn * sn) ** 1.5; d = x / (n1 * k0)
    lat = p - (n1 * t / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                               + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / cs
    return math.degrees(lat), (zone - 1) * 6 - 180 + 3 + math.degrees(lon)


def no_brasil(lat, lon):
    return -34 <= lat <= 5.5 and -74 <= lon <= -28.5


def centro(pts):
    """Median point and the median distance (km) of the points to it."""
    lon = statistics.median(p[0] for p in pts); lat = statistics.median(p[1] for p in pts)
    return lon, lat, statistics.median(hav(lon, lat, x, y) for x, y in pts)


def coord_pdf(c, places):
    """(lon, lat, n points) from the coordinates found in the thesis text, or None when they are missing or scattered."""
    pts = [(lon, lat) for lat, lon, _ in c.get('ll') or []]
    utm = c.get('utm') or []
    if utm and (any(m for *_, m in utm) or len(utm) >= 3):
        zonas = c.get('zonas') or {}
        ref = next(((p[3], p[4]) for p in places if p[0] != 'estado'), None) or next(((p[3], p[4]) for p in places), None)
        zone = int(max(zonas, key=zonas.get)) if zonas else (int((ref[0] + 180) // 6) + 1 if ref else None)
        if zone:
            u = [(lon, lat) for lat, lon in (utm_to_latlon(e, n, zone) for e, n, _ in utm) if no_brasil(lat, lon)]
            if u and not zonas:
                ux, uy, _ = centro(u)
                if hav(ux, uy, *ref) > 150:
                    u = []
            pts += u
    if not pts:
        return None
    lon, lat, esp = centro(pts)
    return (round(lon, 4), round(lat, 4), len(pts)) if esp < 50 else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dados', default=os.environ.get('SGB_DATA') or os.path.join(os.path.dirname(HERE), 'data'),
                    help='diretório de saída dos scrapers (com bdtd/bdtd_minerio.jsonl)')
    ap.add_argument('--amostra', type=int, help='mostra N teses localizadas e N não localizadas e sai')
    a = ap.parse_args()
    src = os.path.join(os.path.abspath(os.path.expanduser(a.dados)), 'bdtd', 'bdtd_minerio.jsonl')
    if not os.path.exists(src):
        sys.exit(f'não achei {src} — rode python -m scrapers_sgb bdtd harvest ou passe --dados')
    muns = municipios(os.path.join(OUT, 'brasil_municipios.topojson'))
    loc = Locator(muns)
    cpath = os.path.join(os.path.dirname(src), 'bdtd_coords.jsonl')
    coords = {}
    if os.path.exists(cpath):
        for l in open(cpath, encoding='utf-8'):
            try:
                c = json.loads(l)
            except ValueError:   # last line of a run still going / interrupted
                continue
            if c.get('status') == 'ok':
                coords[c['id']] = c

    def perto(lon, lat):
        """Label for a PDF coordinate: the municipality with the nearest centroid."""
        m = min(muns, key=lambda m: (m[2] - lon) ** 2 + (m[3] - lat) ** 2)
        return f'perto de {m[0]}/{m[1]}'
    recs = [json.loads(l) for l in open(src, encoding='utf-8') if l.strip()]
    # the same work is often deposited twice (institutional repository + a later copy): keep one per title + first
    # author, preferring the copy with a PDF and then the oldest record
    key = lambda r: (re.sub(r'\W+', ' ', plain(r['titulo']).lower()).strip(), plain(r['autores'].split(';')[0]).lower().strip())
    best = {}
    for r in sorted(recs, key=lambda r: (not r.get('pdfs'), r['ano'] or '9999')):
        best.setdefault(key(r), r)
    n_dup = len(recs) - len(best)
    recs = list(best.values())

    if a.amostra:
        import random
        random.seed(3)
        for r in random.sample(recs, a.amostra * 3):
            pl = loc.locate(r)
            print(('  ' if pl else '--'), r['titulo'][:110], '\n      ', [(p[0], p[1], p[2]) for p in pl] or r['assuntos'][:110])
        return

    PREC = ['municipio', 'regiao', 'estado', 'resumo', 'pdf']
    TIPO = ['dissertacao', 'tese']
    o = dict(x=[], y=[], d=[], p=[], lg=[])              # points: lon, lat, thesis index, precision, place name
    T = dict(t=[], a=[], ins=[], tp=[], tm=[], id=[], pdf=[], pr=[], h=[])  # theses
    lugares = []
    lix = {}
    n_pdf_novas = 0
    for r in recs:
        pl = loc.locate(r)
        cp = coord_pdf(coords[r['id']], pl) if r['id'] in coords else None
        if cp:
            n_pdf_novas += not pl
            pl = [('pdf', perto(cp[0], cp[1]), '', cp[0], cp[1])]
        if not pl:
            continue
        di = len(T['t'])
        T['t'].append(r['titulo'][:300]); T['a'].append(r['ano'][:4]); T['ins'].append(r['instituicao'])
        T['tp'].append(TIPO.index(r['tipo']) if r['tipo'] in TIPO else 0)
        T['tm'].append(1 if r.get('tema') == 'nucleo' else 0); T['id'].append(r['id'])
        T['pdf'].append((r.get('pdfs') or '').split('; ')[0])
        T['pr'].append((r.get('programa') or '')[:120])
        T['h'].append(' '.join((r['titulo'], r.get('assuntos') or '', r['instituicao'])).lower()[:600])
        for prec, nome, uf, x, y in pl:
            lab = f'{nome}/{uf}' if prec not in ('estado', 'pdf') else nome
            if lab not in lix:
                lix[lab] = len(lugares); lugares.append(lab)
            o['x'].append(x); o['y'].append(y); o['d'].append(di); o['p'].append(PREC.index(prec)); o['lg'].append(lix[lab])
    o.update(T=T, p_l=PREC, tp_l=['dissertação', 'tese'], lg_l=lugares)
    with open(os.path.join(OUT, 'bdtd.json'), 'w', encoding='utf-8') as fh:
        json.dump(o, fh, ensure_ascii=False, separators=(',', ':'))
    # layer size for the layer list (the file itself only loads when the layer is turned on)
    sgb_path = os.path.join(OUT, 'sgb.json')
    if os.path.exists(sgb_path):
        sgb = json.load(open(sgb_path, encoding='utf-8'))
        sgb.setdefault('n', {})['teses'] = len(o['x'])
        sgb['bdtd'] = dict(gerado=datetime.date.today().isoformat(), teses=len(T['t']), total=len(recs),
                           pdf=sum(1 for p in o['p'] if PREC[p] == 'pdf'), textos=len(coords))
        with open(sgb_path, 'w', encoding='utf-8') as fh:
            json.dump(sgb, fh, ensure_ascii=False, separators=(',', ':'))
    c = collections.Counter(PREC[p] for p in o['p'])
    print(json.dumps(dict(teses=len(recs), duplicadas_removidas=n_dup, localizadas=len(T['t']), pontos=len(o['x']), por_precisao=c,
                          textos_lidos=len(coords), so_pela_coordenada=n_pdf_novas,
                          kb=os.path.getsize(os.path.join(OUT, 'bdtd.json')) // 1024), ensure_ascii=False))


if __name__ == '__main__':
    main()
