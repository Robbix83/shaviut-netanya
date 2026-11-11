#!/bin/bash
# off-plan apartments only (year built after sale year): oexp.sh label=set ...
cd /c/leads
LOG=/c/Users/robi_/AppData/Local/Temp/claude/05fd16988d4ac0c9/af8fd0a7-c47b-4c83-9605-88458d68bfba/scratchpad
for v in "$@"; do lab=${v%%=*}; set=${v#*=}; npx tsx scripts/backtest/run.ts --track pipeline --asof sale --years 5 --size all --split all --type apartment --offplan --label "$lab" ${set:+--set $set} > $LOG/$lab.log 2>&1 & done; wait
for v in "$@"; do tail -n 1 $LOG/${v%%=*}.log; done
