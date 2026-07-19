#!/usr/bin/env python3
"""Fail closed unless the dedicated Hermes API-server runtime resolves zero tools."""
import contextlib
import io
import json
import os
import sys
from pathlib import Path


def main() -> int:
    hermes_home = os.environ.get("HERMES_HOME")
    agent_root = os.environ.get("HERMES_AGENT_ROOT")
    if not hermes_home or not agent_root:
        print(json.dumps({"ok": False, "error": "missing_runtime_paths"}))
        return 2
    root = Path(agent_root).resolve()
    config_path = Path(hermes_home).resolve() / "config.yaml"
    if not root.is_dir() or not config_path.is_file():
        print(json.dumps({"ok": False, "error": "runtime_paths_unavailable"}))
        return 2
    sys.path.insert(0, str(root))
    import yaml  # type: ignore
    from hermes_cli.tools_config import _get_platform_tools  # type: ignore
    from model_tools import get_tool_definitions  # type: ignore
    from tools.registry import discover_builtin_tools  # type: ignore

    config = yaml.safe_load(config_path.read_text()) or {}
    configured = (config.get("platform_toolsets") or {}).get("api_server")
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        discover_builtin_tools()
        enabled = sorted(_get_platform_tools(config, "api_server"))
        definitions = get_tool_definitions(enabled_toolsets=enabled, quiet_mode=True)
    tools = sorted(str(item.get("function", {}).get("name")) for item in definitions)
    ok = configured == [] and enabled == [] and tools == []
    print(json.dumps({"ok": ok, "configuredEmpty": configured == [], "enabledToolsets": enabled, "effectiveTools": tools}, separators=(",", ":")))
    return 0 if ok else 3


if __name__ == "__main__":
    raise SystemExit(main())
