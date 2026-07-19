#!/usr/bin/env python3
"""Install and verify the pinned Whitebox run-scoped Hermes gate."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

PROJECT = Path(__file__).resolve().parents[1]
LOCK_PATH = PROJECT / "hermes/runtime/runtime-lock.json"
PATCH_PATH = PROJECT / "hermes/runtime/api-server-zero-tools.patch"
MODULE_PATH = PROJECT / "hermes/runtime/whitebox_runtime.py"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def config_security_digest(path: Path) -> str:
    sensitive = ("key", "token", "secret", "password", "credential")
    def redact(value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): "<redacted>" if any(part in str(key).lower() for part in sensitive) else redact(item) for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return value
    canonical = json.dumps(redact(yaml.safe_load(path.read_text()) or {}), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(canonical).hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: install-hermes-runtime-gate.py HERMES_AGENT_ROOT")
    root = Path(sys.argv[1]).resolve()
    lock = json.loads(LOCK_PATH.read_text())
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if commit != lock["hermesCommit"]:
        raise SystemExit("Hermes commit does not match the Whitebox runtime lock")
    api_server = root / "gateway/platforms/api_server.py"
    current = digest(api_server)
    if current == lock["baseApiServerDigest"]:
        subprocess.run(["git", "apply", "--whitespace=error", str(PATCH_PATH)], cwd=root, check=True)
    elif current != lock["patchedApiServerDigest"]:
        raise SystemExit("Hermes API server bytes do not match the locked base or patched runtime")
    if digest(api_server) != lock["patchedApiServerDigest"] or digest(MODULE_PATH) != lock["runtimeModuleDigest"]:
        raise SystemExit("Whitebox Hermes runtime patch verification failed")
    destination = root / "gateway/whitebox_runtime.py"
    shutil.copyfile(MODULE_PATH, destination)
    destination.chmod(0o644)
    if digest(destination) != lock["runtimeModuleDigest"]:
        raise SystemExit("Installed Whitebox Hermes runtime module does not match the lock")
    for relative, expected in lock["runtimeFiles"].items():
        path = (root / relative).resolve()
        if root not in path.parents or not path.is_file() or digest(path) != expected:
            raise SystemExit("Measured Hermes runtime bytes do not match the release lock")
    home = Path(os.environ.get("HERMES_HOME", "")).resolve()
    config = home / "config.yaml"
    python = Path(os.environ.get("HERMES_PYTHON", sys.executable)).resolve()
    if home.name != lock["profile"] or not config.is_file() or config_security_digest(config) != lock["configSecurityDigest"]:
        raise SystemExit("Hermes profile security configuration does not match the release lock")
    if not python.is_file() or digest(python) != lock["pythonDigest"]:
        raise SystemExit("Hermes Python runtime does not match the release lock")
    print("whitebox_hermes_runtime_gate_verified")


if __name__ == "__main__":
    main()
