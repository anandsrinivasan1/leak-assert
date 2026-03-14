#!/usr/bin/env bash
# leak-assert terminal demo script
# Records a simulated terminal session for README/docs use.
# Requires: script (macOS/Linux) or asciinema

set -euo pipefail

RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
CYAN='\033[0;36m' BOLD='\033[1m' DIM='\033[2m' RESET='\033[0m'

type_cmd() {
  printf "${CYAN}\$ ${BOLD}%s${RESET}" ""
  for ((i=0; i<${#1}; i++)); do
    printf "%s" "${1:$i:1}"
    sleep 0.04
  done
  echo
  sleep 0.3
}

section() { echo; printf "${DIM}# %s${RESET}\n" "$1"; sleep 0.3; }
ok()      { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
fail()    { printf "  ${RED}✗${RESET} %s\n" "$1"; }
info()    { printf "  ${DIM}%s${RESET}\n" "$1"; }

clear
echo
printf "${BOLD}leak-assert${RESET} — memory leak regression testing\n"
echo

sleep 1

section "Install"
type_cmd "npm install --save-dev leak-assert"
sleep 0.5
info "added 1 package, 0 vulnerabilities"
sleep 0.8

section "Run your first test"
type_cmd "node --expose-gc node_modules/.bin/jest checkout.test.ts"
sleep 1

echo
printf "  ${DIM}RUNS${RESET}  checkout handler does not leak memory\n"
sleep 2

printf "\n  ${BOLD}── leak-assert: checkout-handler ──${RESET}\n"
info "samples:     50"
info "iterations:  2,000"
sleep 0.3

for i in 100 200 400 800 1200 1600 2000; do
  sleep 0.15
  printf "\r  sampling... iter=%-5d  heap=%5.1f MB" "$i" "$(echo "50 + $i * 0.001" | bc -l)"
done
echo

sleep 0.5
printf "\n  Assertions:\n"
sleep 0.3
ok "ceiling       58MB / 200MB"
sleep 0.2
ok "stable        +1.2MB after GC (tolerance: 5MB)"
sleep 0.2
fail "growthRate    ${YELLOW}2.14 kb/iter${RESET}  >  1.00 kb/iter"
sleep 0.3
echo
printf "  ${RED}FAIL${RESET} — 1 of 3 assertions failed: growthRate\n"
printf "  ${DIM}report:  leak-assert-checkout-handler.html${RESET}\n"
echo

sleep 1

section "Open the HTML report"
type_cmd "open leak-assert-checkout-handler.html"
sleep 0.5
info "→ heap growth chart + assertion table opened in browser"
sleep 1

section "Watch a live process"
type_cmd "leak-assert watch --url http://localhost:9123/__leak_assert__/heap --interval 5"
sleep 0.5
info "── leak-assert watch ──"
info "  url:       http://localhost:9123/__leak_assert__/heap"
info "  threshold: 2kb/iter   window: 20"
echo

for i in $(seq 1 6); do
  heap=$(echo "52 + $i * 0.3" | bc -l)
  slope=$(echo "$i * 0.8" | bc -l)
  sleep 0.8
  printf "\r  [  ${GREEN}OK${RESET}  ]  iter=%6d  heap=%6.2fMB  slope=%+8.1fB/iter" \
    "$((i * 5))" "$heap" "$slope"
done
sleep 1

# Leak detected
printf "\r  [ ${RED}⚠ LEAK${RESET} ]  iter=%6d  heap=%6.2fMB  slope=%+8.1fB/iter\n" \
  "50" "56.80" "2340.0"
echo
printf "\n  ${RED}ALERT${RESET}: slope 2340.0 bytes/iter exceeds threshold 2kb/iter\n"
echo

sleep 1

printf "\n${DIM}leak-assert — catch leaks before they catch you.${RESET}\n\n"
