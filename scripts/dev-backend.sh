#!/usr/bin/env bash
set -euo pipefail

cargo run -p oxiderelay-backend -- --config backend/config.toml.example

