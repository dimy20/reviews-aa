#!/usr/bin/env bash
cd "$(dirname "$0")"
exec uv run jupyter lab --ip=0.0.0.0 --port=8888 --IdentityProvider.token=''
