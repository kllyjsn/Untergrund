#!/usr/bin/env bash
# Render a generated song's stems with a note log, then measure them: test/listen.sh <style> <seed> [query] [tag]
# Needs `python3 test/server.py 8765` and the Chrome CDP endpoint on :29229. Extra query e.g. "bars=16&code=/test/out/wt".
set -e
style=${1:-neosoul}; seed=${2:-42}; extra=${3:-}; tag=${4:-$style$seed}
cd "$(dirname "$0")/.."
rm -f test/out/L_${tag}_*
url="http://localhost:8765/test/listen.html?style=$style&seed=$seed&tag=$tag${extra:+&$extra}"
id=$(curl -s -X PUT "http://localhost:29229/json/new?$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=":/?="))' "$url")" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
for i in $(seq 1 300); do
  sleep 2
  t=$(curl -s http://localhost:29229/json/list | python3 -c "import sys,json;print(next((x['title'] for x in json.load(sys.stdin) if x['id']=='$id'),''))")
  [[ $t == DONE* ]] && break
done
curl -s "http://localhost:29229/json/close/$id" >/dev/null
[[ $t == DONE* ]] || { echo "render timed out ($t)"; exit 1; }
python3 test/listen.py "test/out/L_${tag}"
