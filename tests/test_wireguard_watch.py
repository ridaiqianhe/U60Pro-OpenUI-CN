import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/device/wireguard-watch.sh'


class EndpointRecovery(unittest.TestCase):
    def exercise(self, *, handshake=0, answer='203.0.113.9', current='203.0.113.8:51820', up=True, host='vpn.example.com'):
        with tempfile.TemporaryDirectory() as tmp:
            base = pathlib.Path(tmp)
            def executable(name, text):
                p = base / name
                p.write_text('#!/bin/sh\n' + text)
                p.chmod(0o700)
            (base / 'profile.conf').write_text(f'[Peer]\nPublicKey = TESTPEER\nEndpoint = {host}:51820\n')
            executable('ip', f'case "$*" in "link show wg-u60") exit {0 if up else 1} ;; *) echo "default via 1.1.1.1 dev wan src 192.0.2.1" ;; esac\n')
            executable('date', 'echo 1000\n')
            executable('dig', f'echo "{answer}"\n')
            executable('wg', f'''case "$*" in
"show wg-u60 latest-handshakes") echo "TESTPEER {handshake}" ;;
"show wg-u60 endpoints") echo "TESTPEER {current}" ;;
set*) echo "$*" >> '{base}/updates' ;;
esac
''')
            check = base / 'watch.sh'
            check.write_text(SCRIPT.read_text().replace('base=/data/plugins/wireguard', f"base='{base}'"))
            env = dict(os.environ, PATH=f'{base}:' + os.environ['PATH'])
            subprocess.run(['sh', str(check), 'check'], check=True, env=env)
            log = base / 'updates'
            return log.read_text() if log.exists() else ''

    def test_stale_handshake_refreshes_only_endpoint(self):
        self.assertEqual(self.exercise(), 'set wg-u60 peer TESTPEER endpoint 203.0.113.9:51820\n')

    def test_healthy_peer_is_untouched(self):
        self.assertEqual(self.exercise(handshake=900), '')

    def test_unchanged_endpoint_is_untouched(self):
        self.assertEqual(self.exercise(current='203.0.113.9:51820'), '')

    def test_failed_or_fake_dns_keeps_current_endpoint(self):
        for answer in ['', '198.18.0.8', 'not-an-address', '999.1.1.1']:
            with self.subTest(answer=answer):
                self.assertEqual(self.exercise(answer=answer), '')

    def test_manual_stop_is_respected(self):
        self.assertEqual(self.exercise(up=False), '')

    def test_literal_endpoint_is_not_re_resolved(self):
        self.assertEqual(self.exercise(host='203.0.113.8'), '')
