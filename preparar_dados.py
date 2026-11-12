"""Export geo_brasil.gpkg into the compact JSON files read by the dashboard (data/).

Reads ../sedar_ni43101/geo_brasil/geo_brasil.gpkg (built by sedar_ni43101/scripts/montar_gpkg.py) and
../sedar_ni43101/fichas.csv (commodity). Writes:
  data/docs.json        one entry per report: title, issuer, dates, PDF path, commodities, info types, flags
  data/pontos.json      one entry per distinct point: lon, lat, type, precision, and its citations [doc, page]
  data/processos.json   one entry per ANM process with a SIGMINE polygon: centroid, attributes, simplified ring,
                        citations [doc, page]
  data/municipios.json  per IBGE municipality code: citations [doc, project, pages]
  data/meta.json        lists used to build the filters and the build date
The municipality outlines come from data/brasil_municipios.topojson (IBGE, copied from the estoque-do-solo project).

Run: ./run.sh --preparar   (or the geopandas env python directly)
"""
import csv, datetime, json, os, re

import pyogrio

HERE = os.path.dirname(os.path.abspath(__file__))
SEDAR = os.path.join(os.path.dirname(HERE), 'sedar_ni43101')
GPKG = os.path.join(SEDAR, 'geo_brasil', 'geo_brasil.gpkg')
OUT = os.path.join(HERE, 'data')

TIPOS = ['furo', 'amostra', 'trincheira', 'centro do projeto', 'deposito', 'alvo', 'vertice', 'outro']
PRECISAO = ['coordenada', 'coordenada (zona UTM inferida)']
INFO = ['geologia', 'sondagem', 'amostragem', 'geoquimica', 'geofisica', 'recursos', 'reservas', 'lavra',
        'metalurgia', 'hidrogeologia', 'geotecnia']


def commodities(s):
    out = []
    for part in re.split(r'[;,/]|-(?=[a-zà-ú])', str(s or '')):
        p = part.strip()
        if p and p not in out:
            out.append(p)
    return out


def info_list(s):
    vals = set()
    for v in re.split(r'[;|,]', str(s or '')):
        v = v.strip().lower().replace('í', 'i').replace('é', 'e').replace('ó', 'o').replace('á', 'a')
        if v in INFO:
            vals.add(v)
    return sorted(vals, key=INFO.index)


def r6(x):
    return round(float(x), 5)


def main():
    os.makedirs(OUT, exist_ok=True)
    fichas = {d['arquivo']: d for d in csv.DictReader(open(os.path.join(SEDAR, 'fichas.csv'), encoding='utf-8'))}
    D = pyogrio.read_dataframe(GPKG, layer='documentos')
    D = D.sort_values('data_envio_sedar').reset_index(drop=True)
    idx = {a: i for i, a in enumerate(D.arquivo)}
    docs = []
    for _, r in D.iterrows():
        docs.append(dict(
            t=r.titulo or '', e=r.emissor or '', d=(r.data_envio_sedar or '')[:10], de=r.data_efetiva or '',
            ci=r.data_coleta_inicio or '', cf=r.data_coleta_fim or '',
            p='sedar_ni43101/' + r.arquivo, pg=int(r.paginas or 0),
            c=commodities(fichas.get(r.arquivo, {}).get('commodity')), i=info_list(r.tipo_info),
            pr=r.projetos or '', uf=r.ufs or '', n=int(r.conta_amostra), rep=idx.get(r.repete_de, -1),
            dn=(r.dados_novos or '')[:300]))

    # points: distinct points with their citations
    P = pyogrio.read_dataframe(GPKG, layer='pontos')
    C = pyogrio.read_dataframe(GPKG, layer='pontos_citacoes')
    cit = {}
    for _, c in C.iterrows():
        if c.arquivo in idx:
            cit.setdefault(int(c.ponto_id), []).append([idx[c.arquivo], int(c.pagina or 0)])
    pontos = []
    for _, p in P.iterrows():
        refs = cit.get(int(p.ponto_id))
        if not refs:
            continue
        pontos.append([r6(p.geometry.x), r6(p.geometry.y),
                       TIPOS.index(p.tipo) if p.tipo in TIPOS else TIPOS.index('outro'),
                       PRECISAO.index(p.precisao) if p.precisao in PRECISAO else 0,
                       int(bool(p.uf_confere)), (p.nome or '')[:40], p.municipio or '', p.uf or '', refs])

    # ANM processes
    A = pyogrio.read_dataframe(GPKG, layer='processos_anm').to_crs(4674)
    PC = pyogrio.read_dataframe(GPKG, layer='processos_citacoes')
    pcit = {}
    for _, c in PC.iterrows():
        if c.arquivo in idx and c.processo:
            pcit.setdefault(c.processo, []).append([idx[c.arquivo], int(c.pagina or 0)])
    processos = []
    for _, a in A.iterrows():
        g = a.geometry.simplify(0.0005)
        poly = max(getattr(g, 'geoms', [g]), key=lambda x: x.area)
        ring = [[r6(x), r6(y)] for x, y in poly.exterior.coords]
        cen = a.geometry.representative_point()
        processos.append(dict(x=r6(cen.x), y=r6(cen.y), id=a.processo, f=a.get('fase') or '', s=a.get('subs') or '',
                              ti=a.get('nome') or '', ha=a.get('area_ha'), uf=a.get('uf') or '', g=ring,
                              r=pcit.get(a.processo, [])))

    # municipalities
    M = pyogrio.read_dataframe(GPKG, layer='municipios_citacoes')
    mun = {}
    for _, m in M.iterrows():
        if m.arquivo in idx:
            mun.setdefault(m.cd_mun, []).append([idx[m.arquivo], m.projeto or '', m.paginas or ''])

    comm = {}
    for d in docs:
        for c in d['c']:
            comm[c] = comm.get(c, 0) + 1
    years = [int(d['d'][:4]) for d in docs if d['d'][:4].isdigit()]
    meta = dict(gerado=datetime.date.today().isoformat(), tipos=TIPOS, precisao=PRECISAO, info=INFO,
                commodities=sorted(comm, key=lambda k: -comm[k]), commodities_n=comm,
                ano_min=min(years), ano_max=max(years), n_docs=len(docs), n_pontos=len(pontos),
                n_processos=len(processos), n_municipios=len(mun))
    for name, obj in (('docs', docs), ('pontos', pontos), ('processos', processos), ('municipios', mun),
                      ('meta', meta)):
        json.dump(obj, open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False,
                  separators=(',', ':'))
    print(json.dumps({k: v for k, v in meta.items() if k.startswith('n_')}))


if __name__ == '__main__':
    main()
