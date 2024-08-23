#!/bin/sh
source .venv/bin/activate
(cd backend && python server.py) &
(cd add-in && yarn run dev-server) &

trap 'kill $(jobs -p); wait' INT

wait
