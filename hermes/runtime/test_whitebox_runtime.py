import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

MODULE_PATH = pathlib.Path(__file__).with_name("whitebox_runtime.py")
SPEC = importlib.util.spec_from_file_location("whitebox_runtime", MODULE_PATH)
assert SPEC and SPEC.loader
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


class FakeAgent:
    tools = []
    enabled_toolsets = []
    valid_tool_names = set()
    _context_engine_tool_names = set()
    _memory_tool_names = set()
    _tool_snapshot_generation = 7
    model = "gpt-5.4-mini"
    provider = "openai-codex"


class WhiteboxRuntimeGateTests(unittest.TestCase):
    def _environment(self, directory: str):
        root = pathlib.Path(directory) / "agent"
        home = pathlib.Path(directory) / "profiles" / "whitebox"
        root.mkdir(parents=True)
        home.mkdir(parents=True)
        (home / "config.yaml").write_text("platform_toolsets:\n  api_server: []\n")
        runtime_path = root / "gateway" / "whitebox_runtime.py"
        runtime_path.parent.mkdir(parents=True)
        runtime_path.write_bytes(MODULE_PATH.read_bytes())
        modules = {}
        for name in runtime.ATTESTED_MODULES:
            path = root / f"{name.replace('.', '_')}.py"
            path.write_text(f"# {name}\n")
            module = types.ModuleType(name)
            module.__file__ = str(path)
            modules[name] = module
        env = {
            "HERMES_HOME": str(home),
            "HERMES_AGENT_ROOT": str(root),
            "WHITEBOX_HERMES_RUNTIME_KEY": "r" * 40,
            "WHITEBOX_HERMES_COMMIT": "a" * 40,
        }
        return modules, env

    def test_attests_the_exact_zero_tool_agent_and_run(self):
        with tempfile.TemporaryDirectory() as directory:
            modules, env = self._environment(directory)
            with patch.dict(sys.modules, modules), patch.dict(os.environ, env, clear=False):
                envelope = runtime.attest_zero_tool_agent(FakeAgent(), "run_123", "session-1", "b" * 64)
            attestation = envelope["attestation"]
            canonical = json.dumps(attestation, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            expected = hmac.new(env["WHITEBOX_HERMES_RUNTIME_KEY"].encode(), canonical, hashlib.sha256).hexdigest()
            self.assertEqual(attestation["runId"], "run_123")
            self.assertEqual(attestation["sessionId"], "session-1")
            self.assertEqual(attestation["requestNonce"], "b" * 64)
            self.assertEqual(attestation["effectiveToolCount"], 0)
            self.assertEqual(envelope["signature"], expected)

    def test_rejects_the_actual_agent_when_any_tool_is_present(self):
        with tempfile.TemporaryDirectory() as directory:
            modules, env = self._environment(directory)
            agent = FakeAgent()
            agent.tools = [{"type": "function", "function": {"name": "terminal"}}]
            agent.valid_tool_names = {"terminal"}
            with patch.dict(sys.modules, modules), patch.dict(os.environ, env, clear=False):
                with self.assertRaisesRegex(RuntimeError, "actual agent exposes tools"):
                    runtime.attest_zero_tool_agent(agent, "run_123", "session-1", "b" * 64)


if __name__ == "__main__":
    unittest.main()
