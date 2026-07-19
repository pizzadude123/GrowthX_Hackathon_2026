import importlib.util
import os
import pathlib
import unittest
from unittest.mock import MagicMock, patch

MODULE_PATH = pathlib.Path(__file__).with_name("__init__.py")
SPEC = importlib.util.spec_from_file_location("whitebox_agency_plugin", MODULE_PATH)
assert SPEC and SPEC.loader
plugin = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(plugin)


class WhiteboxPluginTests(unittest.IsolatedAsyncioTestCase):
    @patch.object(plugin.urllib.request, 'urlopen')
    def test_control_uses_the_command_token_not_the_worker_token(self, urlopen):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok": true}'
        urlopen.return_value = response
        with patch.dict(plugin.os.environ, {
            'WHITEBOX_CONTROL_PLANE_URL': 'https://control.example',
            'WHITEBOX_COMMAND_TOKEN': 'c' * 40,
            'WHITEBOX_WORKER_TOKEN': 'w' * 40,
        }, clear=True):
            plugin._control_sync('/api/runs/status', {'publicId': 'WB-ABC'})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header('Authorization'), f"Bearer {'c' * 40}")

    @patch.object(plugin.urllib.request, 'urlopen')
    def test_control_rejects_plain_http_before_sending_credentials(self, urlopen):
        with patch.dict(plugin.os.environ, {
            'WHITEBOX_CONTROL_PLANE_URL': 'http://control.example',
            'WHITEBOX_COMMAND_TOKEN': 'c' * 40,
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'HTTPS'):
                plugin._control_sync('/api/runs/status', {'publicId': 'WB-ABC'})
        urlopen.assert_not_called()

    def test_accepts_url_or_owner_repo_with_optional_goal(self):
        self.assertEqual(
            plugin._parse_start('https://github.com/acme/demo --goal "stabilize checkout"'),
            ('https://github.com/acme/demo', 'stabilize checkout'),
        )
        self.assertEqual(
            plugin._parse_start('acme/demo --goal audit the payment flow'),
            ('https://github.com/acme/demo', 'audit the payment flow'),
        )
        self.assertEqual(
            plugin._parse_start('acme/demo'),
            ('https://github.com/acme/demo', 'stabilize critical flows'),
        )

    def test_rejects_unknown_hosts_and_flags(self):
        with self.assertRaisesRegex(ValueError, 'Usage'):
            plugin._parse_start('https://example.com/acme/demo')
        with self.assertRaisesRegex(ValueError, 'Unknown option'):
            plugin._parse_start('acme/demo --unsafe')

    def test_run_ids_are_strict(self):
        self.assertEqual(plugin._run_id('wb-abc123'), 'WB-ABC123')
        with self.assertRaises(ValueError):
            plugin._run_id('WB-ABC/123')

    @patch.object(plugin, '_control')
    async def test_memory_queries_the_control_plane(self, control):
        control.return_value = {'publicId': 'WB-ABC', 'repository': 'acme/demo', 'status': 'audit_only', 'outputSchemaSnapshotId': 'schema-1'}
        message = await plugin._memory('acme/demo')
        self.assertIn('WB-ABC', message)
        self.assertIn('schema-1', message)
        control.assert_called_once_with('/api/repositories/memory', {'repository': 'acme/demo'})

    def test_guide_explains_the_complete_audit_and_manual_remediation_flow(self):
        message = plugin._guide('')
        self.assertIn('/whitebox OWNER/REPO', message)
        self.assertIn('/whitebox-status RUN-ID', message)
        self.assertIn('/whitebox-next RUN-ID', message)
        self.assertIn('does not edit repositories', message)
        self.assertIn('Run Whitebox again', message)

    @patch.object(plugin, '_control')
    async def test_next_steps_returns_recommendations_without_claiming_write_authority(self, control):
        control.return_value = {
            'run': {'publicId': 'WB-ABC', 'repository': 'acme/demo', 'status': 'audit_only'},
            'findings': [
                {
                    'status': 'confirmed',
                    'severity': 'high',
                    'title': 'Missing timeout',
                    'recommendation': 'Add a bounded request timeout.',
                }
            ],
        }
        message = await plugin._next_steps('WB-ABC')
        self.assertIn('Whitebox does not edit repositories', message)
        self.assertIn('Add a bounded request timeout.', message)
        self.assertIn('/whitebox acme/demo --goal "verify the remediation from WB-ABC"', message)
        control.assert_called_once_with('/api/runs/status', {'publicId': 'WB-ABC'})


if __name__ == '__main__':
    unittest.main()
