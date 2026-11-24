#!/usr/bin/env bash
# Serve the "Conhecimento do Subsolo" dashboard locally and open it in the browser.
# The server root is 02_FGVEnergia/, so the PDF links in the reference list open the local reports.
# Usage: ./run.sh [port]          (default 8770; needs python3)
#        ./run.sh --preparar [port]  regenerate data/*.json from sedar_ni43101/geo_brasil/geo_brasil.gpkg first
#        ./run.sh --preparar-sgb [port]  regenerate data/sgb*.json from the scrapers_sgb output first
#                                        (default <repo>/data; override with SGB_DATA=/caminho/data)
#        ./run.sh --preparar-bdtd [port] regenerate data/bdtd.json (theses placed on the map) from the same directory
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$DIR")"
if [[ "${1:-}" == "--preparar" ]]; then
  shift
  PY="${GEO_PY:-$HOME/miniforge3/envs/paper_seg_class_culturas/bin/python}"
  PROJ_DATA="$("$PY" -c 'import pyproj;print(pyproj.datadir.get_data_dir())' 2>/dev/null)" "$PY" "$DIR/preparar_dados.py"
fi
if [[ "${1:-}" == "--preparar-sgb" ]]; then
  shift
  python3 "$DIR/preparar_sgb.py"
fi
if [[ "${1:-}" == "--preparar-bdtd" ]]; then
  shift
  python3 "$DIR/preparar_bdtd.py"
fi
PORT="${1:-8770}"
URL="http://localhost:${PORT}/$(basename "$DIR")/"
echo "Conhecimento do Subsolo em ${URL}  (Ctrl+C para parar)"
( sleep 1 && (xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true) ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT"
