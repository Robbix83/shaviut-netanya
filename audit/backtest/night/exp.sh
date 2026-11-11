#!/bin/bash
# usage: exp.sh <split> <label>=<set> ...   runs variants 6 at a time, prints the overall rows
cd /c/leads
split=$1; shift
LOG=/c/Users/robi_/AppData/Local/Temp/claude/05fd16988d4ac0c9/af8fd0a7-c47b-4c83-9605-88458d68bfba/scratchpad
run() { local lab=${1%%=*} set=${1#*=}; npx tsx scripts/backtest/run.ts --track pipeline --asof sale --years 5 --size all --perturb --split $split --label "$lab" ${set:+--set $set} $EXTRA > $LOG/$lab.log 2>&1; }
n=0
for v in "$@"; do run "$v" & n=$((n+1)); if [ $n -ge 6 ]; then wait -n; n=$((n-1)); fi; done
wait
for v in "$@"; do tail -n 1 $LOG/${v%%=*}.log; done
