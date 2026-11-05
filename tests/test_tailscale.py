"""Tailscale isolation regressions; no device, real HTTP, firewall or daemon actions."""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts/device/tailscale'
try:
    from lupa.lua51 import LuaRuntime
except ImportError:
    LuaRuntime = None


@unittest.skipUnless(LuaRuntime, 'optional lupa.lua51 is unavailable; run test.lua with Lua 5.1 instead')
class TailscaleLuaIsolation(unittest.TestCase):
    def test_configuration_and_authenticated_cgi(self):
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.globals().arg = lua.table_from([str(SOURCE / 'config.lua'), str(SOURCE / 'main.lua')])
        lua.execute((SOURCE / 'test.lua').read_text())


@unittest.skipUnless(os.name == 'posix', 'POSIX shell service checks')
class TailscaleOwnedDaemon(unittest.TestCase):
    def run_service(self, pid='123', owned=False, mode='stop', existing_socket=False):
        with tempfile.TemporaryDirectory(prefix='u60-ts-test-') as directory:
            root = Path(directory)
            base, bindir = root / 'plugin', root / 'bin'
            base.mkdir(); bindir.mkdir()
            (base / 'run-bounded.sh').write_text((SOURCE / 'run-bounded.sh').read_text())
            pidfile, sock, log = root / 'daemon.pid', root / 'daemon.sock', root / 'calls'
            pidfile.write_text(pid)
            (root / 'tun').touch()
            for tool, body in {
                'readlink': '#!/bin/sh\nprintf "%s\\n" "$FAKE_EXE"\n',
                'iptables': '#!/bin/sh\nprintf "firewall %s\\n" "$*" >> "$TEST_CALLS"\nexit 1\n',
                'ip6tables': '#!/bin/sh\nprintf "firewall6 %s\\n" "$*" >> "$TEST_CALLS"\nexit 1\n',
                'sleep': '#!/bin/sh\nexit 0\n',
            }.items():
                path = bindir / tool; path.write_text(body); path.chmod(0o755)
            cli = base / 'tailscale'
            cli.write_text('#!/bin/sh\nprintf "cli %s\\n" "$*" >> "$TEST_CALLS"\n')
            cli.chmod(0o755)
            daemon = base / 'tailscaled'; daemon.write_text('#!/bin/sh\nexit 0\n'); daemon.chmod(0o755)
            text = (SOURCE / 'service.sh').read_text()
            text = text.replace('cli() { sh "$base/run-bounded.sh" 3 "$base/tailscale" --socket="$socket" "$@"; }', 'cli() { "$base/tailscale" --socket="$socket" "$@"; }')
            text = text.replace('base=/data/plugins/tailscale', 'base=' + shlex.quote(str(base)))
            text = text.replace('socket=/var/run/u60-tailscaled.sock', 'socket=' + shlex.quote(str(sock)))
            text = text.replace('pidfile=/var/run/u60-tailscaled.pid', 'pidfile=' + shlex.quote(str(pidfile)))
            text = text.replace('[ -c /dev/net/tun ]', '[ -f ' + shlex.quote(str(root / 'tun')) + ' ]')
            # Only intercept this test process's shell builtin; never send a real signal.
            text = text.replace('set -eu', 'set -eu\nkill() { printf "kill %s\\n" "$*" >> "$TEST_CALLS"; }', 1)
            script = root / 'service.sh'; script.write_text(text)
            env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'],
                       TEST_CALLS=str(log), FAKE_EXE=str(daemon) if owned else '/unrelated/daemon')
            server = socket.socket(socket.AF_UNIX) if existing_socket else None
            try:
                if server: server.bind(str(sock))
                result = subprocess.run(['sh', str(script), mode], env=env, text=True, capture_output=True, timeout=5)
            finally:
                if server: server.close()
            return result, log.read_text() if log.exists() else ''

    def test_stop_cannot_signal_unrelated_pid(self):
        result, calls = self.run_service(owned=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('kill ', calls)
        self.assertNotIn(' down', calls)

    def test_stop_signals_only_verified_own_pid(self):
        result, calls = self.run_service(owned=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('kill -TERM 123', calls)
        self.assertIn(' down', calls)

    def test_malformed_pid_never_reaches_signal(self):
        for pid in ['-1', '123; echo injected', '123\n456']:
            with self.subTest(pid=pid):
                result, calls = self.run_service(pid=pid, owned=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn('kill ', calls)
                self.assertNotIn('injected', calls)

    def test_start_refuses_socket_from_an_unrelated_instance(self):
        result, calls = self.run_service(owned=False, mode='start', existing_socket=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('socket is already in use', result.stderr)
        self.assertNotIn('kill ', calls)


if __name__ == '__main__':
    unittest.main()
