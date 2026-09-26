#!/usr/bin/env bash
# Starts the flowkit agent (REST :8100, Chrome-extension WebSocket :9222) for video-kit: `bun run flowkit`.
# Needs the "Flow Kit" extension loaded in Chrome and https://flow.google.com open (signed in) in a tab.
cd "$(dirname "$0")/.." || exit 1
if [ ! -x tools/flowkit/venv/bin/python ]; then
	echo "flowkit is not installed yet: run  bun run setup"
	exit 1
fi
if [ -z "${FLOW_PROJECT_ID:-}" ] && [ -f .env ]; then
	FLOW_PROJECT_ID=$(grep -E '^FLOW_PROJECT_ID=' .env | tail -1 | cut -d= -f2- | tr -d "\"' \r")
fi
if [ -z "${FLOW_PROJECT_ID:-}" ]; then
	echo "Missing FLOW_PROJECT_ID in .env: create a project at https://flow.google.com and copy the uuid from its URL."
	exit 1
fi
export FLOW_PROJECT_ID
cd tools/flowkit || exit 1
echo "flowkit: API http://127.0.0.1:8100 · extension ws://127.0.0.1:9222 · Flow project $FLOW_PROJECT_ID (Ctrl+C to stop)"
exec venv/bin/python -m agent.main
