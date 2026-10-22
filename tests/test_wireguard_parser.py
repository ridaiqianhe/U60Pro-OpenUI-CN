"""The import parser accepts data and refuses wg-quick command execution hooks."""
import pathlib
import subprocess
import tempfile
import unittest
PARSER = pathlib.Path(__file__).resolve().parents[1] / 'scripts/device/wireguard-parse.awk'
CONFIG = '''[Interface]
PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
Address = 10.0.0.2/32, fd00::2/128
DNS = 1.1.1.1, 2606:4700:4700::1111
MTU = 1420
[Peer]
PublicKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
Endpoint = example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
'''
class WireGuardParser(unittest.TestCase):
    def parse(self, text):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            command = ['awk']
            for key in ['wg', 'addresses', 'routes', 'mtu']:
                command += ['-v', f'{key}={root / key}']
            result = subprocess.run(command + ['-f', str(PARSER)], input=text, text=True, capture_output=True)
            return result.returncode, {p.name:p.read_text() for p in root.iterdir()}
    def test_dual_stack_and_crlf(self):
        code, files = self.parse(CONFIG.replace('\n', '\r\n'))
        self.assertEqual(code, 0)
        self.assertEqual(files['addresses'], '10.0.0.2/32\nfd00::2/128\n')
        self.assertEqual(files['routes'], '0.0.0.0/0\n::/0\n')
        self.assertNotIn('DNS', files['wg'])
    def test_hooks_are_rejected(self):
        for hook in ['PreUp', 'PostUp', 'PreDown', 'PostDown', 'SaveConfig']:
            with self.subTest(hook=hook):
                self.assertNotEqual(self.parse(CONFIG.replace('MTU = 1420', f'{hook} = touch /tmp/unsafe'))[0], 0)
    def test_bad_address_and_table(self):
        for old,new in [('10.0.0.2/32', '$(id)/32'), ('MTU = 1420', 'MTU = 0'), ('MTU = 1420', 'Table = 42'), ('[Peer]', '[Interface]')]:
            self.assertNotEqual(self.parse(CONFIG.replace(old,new))[0], 0)
    def test_incomplete_configuration(self):
        self.assertNotEqual(self.parse('[Interface]\nAddress = 10.0.0.2/32')[0], 0)

class WireGuardScope(unittest.TestCase):
    def scope(self, routes):
        script = PARSER.with_name('wireguard-scope.sh')
        with tempfile.NamedTemporaryFile(mode='w') as profile:
            profile.write(CONFIG.replace('0.0.0.0/0, ::/0', routes))
            profile.flush()
            return subprocess.check_output(['sh', str(script), profile.name], text=True).strip()
    def test_private_and_host_routes_can_coexist(self):
        for routes in ['10.10.0.0/24', '172.20.0.0/16, fd00::/64', '100.64.0.1/32']:
            self.assertEqual(self.scope(routes), 'split')
    def test_default_and_split_default_require_exclusion(self):
        for routes in ['0.0.0.0/0', '::/0', '0.0.0.0/1, 128.0.0.0/1', '::/1, 8000::/1']:
            self.assertEqual(self.scope(routes), 'full')
