"""Run-scoped zero-tool enforcement for the dedicated Whitebox Hermes API server."""
from __future__ import annotations

import hashlib
import hmac
import inspect
import json
import os
import secrets
import sys
import time
import yaml
from pathlib import Path
from typing import Any

BOOT_NONCE = secrets.token_hex(32)
ATTESTED_MODULES = (
    "gateway.platforms.api_server",
    "gateway.run",
    "agent.agent_init",
    "model_tools",
    "run_agent",
    "tools.registry",
)


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _digest_file(path: Path) -> str:
    return _digest_bytes(path.read_bytes())


def _config_security_digest(path: Path) -> str:
    sensitive = ("key", "token", "secret", "password", "credential")
    def redact(value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): "<redacted>" if any(part in str(key).lower() for part in sensitive) else redact(item) for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return value
    return _digest_bytes(_canonical(redact(yaml.safe_load(path.read_text()) or {})))


def _tool_names(agent: Any) -> list[str]:
    tools = getattr(agent, "tools", None)
    if not isinstance(tools, list):
        raise RuntimeError("Whitebox requires an explicit Hermes tool list")
    names = []
    for tool in tools:
        if not isinstance(tool, dict):
            raise RuntimeError("Whitebox rejected an unrecognized Hermes tool schema")
        name = tool.get("function", {}).get("name")
        if not isinstance(name, str) or not name:
            raise RuntimeError("Whitebox rejected a nameless Hermes tool schema")
        names.append(name)
    return sorted(names)


def attest_zero_tool_agent(agent: Any, run_id: str, session_id: str, nonce: str) -> dict[str, Any]:
    key = os.environ.get("WHITEBOX_HERMES_RUNTIME_KEY", "")
    home_value = os.environ.get("HERMES_HOME", "")
    root_value = os.environ.get("HERMES_AGENT_ROOT", "")
    if len(key) < 32 or not home_value or not root_value:
        raise RuntimeError("Whitebox Hermes runtime authority is unavailable")
    if not run_id.startswith("run_") or not session_id or len(nonce) != 64 or any(ch not in "0123456789abcdef" for ch in nonce):
        raise RuntimeError("Whitebox Hermes run identity is invalid")
    if os.environ.get("HERMES_KANBAN_TASK"):
        raise RuntimeError("Whitebox Hermes rejects Kanban runtime augmentation")

    home, root = Path(home_value).resolve(), Path(root_value).resolve()
    if home.name != "whitebox" or not root.is_dir():
        raise RuntimeError("Whitebox Hermes profile or source root mismatch")
    tools = _tool_names(agent)
    enabled_toolsets = sorted(getattr(agent, "enabled_toolsets", None) or [])
    valid_tool_names = sorted(getattr(agent, "valid_tool_names", set()) or [])
    context_tools = sorted(getattr(agent, "_context_engine_tool_names", set()) or [])
    memory_tools = sorted(getattr(agent, "_memory_tool_names", set()) or [])
    if tools or enabled_toolsets or valid_tool_names or context_tools or memory_tools:
        raise RuntimeError("Whitebox Hermes actual agent exposes tools")

    runtime_files: dict[str, str] = {}
    for module_name in ATTESTED_MODULES:
        module = sys.modules.get(module_name) or __import__(module_name, fromlist=["*"])
        path = Path(inspect.getfile(module)).resolve()
        if root not in path.parents:
            raise RuntimeError("Whitebox Hermes loaded code outside the pinned source root")
        runtime_files[str(path.relative_to(root))] = _digest_file(path)
    runtime_path = root / "gateway/whitebox_runtime.py"
    if not runtime_path.is_file():
        raise RuntimeError("Whitebox Hermes runtime module is missing")
    runtime_files[str(runtime_path.relative_to(root))] = _digest_file(runtime_path)
    config_path = home / "config.yaml"
    if not config_path.is_file():
        raise RuntimeError("Whitebox Hermes profile config is missing")

    agent_nonce = secrets.token_hex(32)
    setattr(agent, "_whitebox_agent_nonce", agent_nonce)
    attestation = {
        "version": "hermes.runtime-attestation.v1",
        "runId": run_id,
        "sessionId": session_id,
        "requestNonce": nonce,
        "bootNonce": BOOT_NONCE,
        "agentNonce": agent_nonce,
        "pid": os.getpid(),
        "profile": "whitebox",
        "pythonExecutable": str(Path(sys.executable).resolve()),
        "pythonDigest": _digest_file(Path(sys.executable).resolve()),
        "hermesCommit": os.environ.get("WHITEBOX_HERMES_COMMIT", ""),
        "configSecurityDigest": _config_security_digest(config_path),
        "runtimeFiles": runtime_files,
        "runtimeFilesDigest": _digest_bytes(_canonical(runtime_files)),
        "registryGeneration": int(getattr(agent, "_tool_snapshot_generation", 0)),
        "enabledToolsets": enabled_toolsets,
        "effectiveTools": tools,
        "effectiveToolsDigest": _digest_bytes(_canonical(tools)),
        "effectiveToolCount": len(tools),
        "model": str(getattr(agent, "model", "")),
        "provider": str(getattr(agent, "provider", "")),
        "issuedAt": int(time.time() * 1000),
    }
    signature = hmac.new(key.encode(), _canonical(attestation), hashlib.sha256).hexdigest()
    return {"attestation": attestation, "signature": signature}
