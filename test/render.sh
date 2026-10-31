#!/bin/bash
# usage: test/render.sh name "query"
rm -f test/out/$1.wav
timeout 120 google-chrome --headless=new --disable-gpu --no-sandbox --autoplay-policy=no-user-gesture-required --user-data-dir=/tmp/chrome-render-$$ --virtual-time-budget=100000 "http://localhost:8765/test/render.html?name=$1&$2" --dump-dom >/dev/null 2>/tmp/chrome-$1.log
ls -la test/out/$1.wav
