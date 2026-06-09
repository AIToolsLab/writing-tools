#!/bin/sh
(cd backend && npm run dev) &
(cd frontend && npm run dev-server) &

trap 'kill $(jobs -p); wait' INT

wait
