#!/usr/bin/env python3
"""Install pinned official Tailscale ARM64 binaries and the U60 panel extension.

--dry-run prepares/checks artifacts and performs only read-only device checks.
No authentication key is accepted or stored by this installer. Login happens in
an authenticated dashboard session after installation.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile
import urllib.request
import uuid
from device_identity import device_identity

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.104.5'
ARCHIVE = f'tailscale_{VERSION}_arm64.tgz'
SHA256 = 'e900b0e6e25023a1e504b2c237ce2a32ea0535e006f8c1a1097a490886493b6c'
BASE = '/data/plugins/tailscale'
BOOT = f'sh {BASE}/service.sh boot'


def package(cache):
    path = cache / ARCHIVE
    cache.mkdir(parents=True, exist_ok=True)
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != SHA256:
        data = urllib.request.urlopen(f'https://pkgs.tailscale.com/stable/{ARCHIVE}', timeout=60).read()
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise ValueError('Official Tailscale archive checksum mismatch')
        path.write_bytes(data)
    result = {}
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive.getmembers():
            if member.isfile() and Path(member.name).name in {'tailscale', 'tailscaled'}:
                result[Path(member.name).name] = archive.extractfile(member).read()
    if set(result) != {'tailscale', 'tailscaled'}:
        raise ValueError('Official archive has no expected executables')
    return result


def install(args):
    transport = shlex.split(args.ssh)
    if not transport or Path(transport[0]).name != 'ssh':
        raise ValueError('--ssh must be an OpenSSH command ending in your device host/alias')
    def run(command, data=None, timeout=45):
        r = subprocess.run(transport + [command], input=data, capture_output=True, timeout=timeout)
        if r.returncode:
            raise RuntimeError('Device operation failed: ' + r.stderr.decode(errors='replace')[-400:])
        return r.stdout
    binaries = package(Path(args.cache).expanduser())
    identity_raw = run("set -e; test \"$(uname -m)\" = aarch64; test \"$(id -u)\" = 0; ubus call zwrt_web device_info '{}'")
    identity = device_identity(json.loads(identity_raw))
    run('test -c /dev/net/tun; test -w /data; test -x /usr/bin/lua -o -x /usr/bin/lua5.1 -o -x /bin/lua; sh -n /etc/rc.local')
    free = int(run("df -Pk /data | awk 'NR==2 {print $4}'").strip()) * 1024
    required = sum(len(v) for v in binaries.values()) * 3 + 16 * 1024 * 1024
    if free < required:
        raise ValueError('Insufficient staging and rollback storage')
    print(f"Verified {identity['model']}, firmware {identity['firmware']}; TUN, root and storage OK", flush=True)
    if args.dry_run:
        print(f'Prepared checksum-verified Tailscale {VERSION}; no device writes')
        return
    # Refuse replacement of any live instance; the operator must disconnect first.
    marker = run(f'test ! -d {BASE} || cat {BASE}/managed.by 2>/dev/null || true').strip()
    occupied = run(f'test ! -d {BASE} || ls -A {BASE}').strip()
    if occupied and marker != b'open-u60-tailscale':
        raise ValueError('Existing Tailscale directory is not owned by this installer')
    running = run("ps w | grep '[t]ailscaled' || true").strip()
    if running:
        raise ValueError('A Tailscale daemon is running; stop it in its owning control plane before installing')
    token = uuid.uuid4().hex[:12]
    snapshot = f'/data/local/tmp/tailscale-install-{token}'
    staged = f'/data/plugins/.tailscale-install-{token}'
    old_rc = run('cat /etc/rc.local')
    old_cgi = run('test ! -f /data/www.current/cgi-bin/tailscale || cat /data/www.current/cgi-bin/tailscale')
    run(f'umask 077; mkdir -p {snapshot} {staged}; chmod 700 {snapshot} {staged}; cp /etc/rc.local {snapshot}/rc.local; if [ -d {BASE} ]; then cp -a {BASE} {snapshot}/plugin; fi')
    try:
        files = dict(binaries)
        for name in ['main.lua', 'config.lua', 'service.sh', 'run-bounded.sh']:
            files[name] = (ROOT / 'scripts/device/tailscale' / name).read_bytes()
        files['version'] = (VERSION + '\n').encode()
        files['managed.by'] = b'open-u60-tailscale\n'
        for name, data in files.items():
            target = f'{staged}/{name}'
            run(f'umask 077; cat > {target}', data, timeout=120)
            digest = hashlib.sha256(data).hexdigest()
            run(f"test \"$(sha256sum {target} | awk '{{print $1}}')\" = {digest}; chmod {'700' if name in binaries or name.endswith('.sh') else '600'} {target}")
        run(f"sh -n {staged}/service.sh; lua -e 'assert(loadfile(\"{staged}/main.lua\"));assert(loadfile(\"{staged}/config.lua\"))'; {staged}/tailscale version >/dev/null; {staged}/tailscaled --version >/dev/null")
        run(f'mkdir -p {BASE}; chmod 700 {BASE}; cp {staged}/* {BASE}/')
        # Preserve state, preferences and autostart when replacing an offline plugin.
        run(f'test -f {BASE}/config.json || printf \'{{"hostname":"u60pro","control_url":""}}\' > {BASE}/config.json')
        next_rc = old_rc.decode()
        if BOOT not in next_rc.splitlines():
            if '\nexit 0' not in next_rc:
                raise ValueError('rc.local has no supported exit marker')
            next_rc = next_rc.replace('\nexit 0', '\n' + BOOT + '\nexit 0', 1)
        run('umask 077; cat > /etc/rc.local.tailscale-new', next_rc.encode())
        run('sh -n /etc/rc.local.tailscale-new; chmod 755 /etc/rc.local.tailscale-new; mv /etc/rc.local.tailscale-new /etc/rc.local; sh -n /etc/rc.local')
        cgi = (ROOT / 'scripts/device/tailscale.cgi').read_bytes()
        run('umask 077; cat > /data/www.current/cgi-bin/tailscale.new', cgi)
        run('chmod 755 /data/www.current/cgi-bin/tailscale.new; mv /data/www.current/cgi-bin/tailscale.new /data/www.current/cgi-bin/tailscale')
        print(run(f'lua {BASE}/main.lua inspect').decode().strip())
        print('Installed without starting or joining a Tailnet; authorize using the panel. Recovery snapshot: ' + snapshot)
    except Exception:
        run('umask 077; cat > /etc/rc.local.tailscale-restore', old_rc)
        run('sh -n /etc/rc.local.tailscale-restore; chmod 755 /etc/rc.local.tailscale-restore; mv /etc/rc.local.tailscale-restore /etc/rc.local; sh -n /etc/rc.local')
        if old_cgi:
            run('umask 077; cat > /data/www.current/cgi-bin/tailscale', old_cgi)
            run('chmod 755 /data/www.current/cgi-bin/tailscale')
        else:
            run('rm -f /data/www.current/cgi-bin/tailscale')
        run(f'rm -rf {BASE}; if [ -d {snapshot}/plugin ]; then cp -a {snapshot}/plugin {BASE}; fi')
        raise
    finally:
        run(f'rm -rf {staged}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssh', required=True, help='SSH command, e.g. ssh -p 2222 root@192.168.0.1')
    parser.add_argument('--cache', default='~/.cache/open-u60-tailscale')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        install(args)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as e:
        parser.exit(1, f'Tailscale installation stopped: {e}\n')


if __name__ == '__main__':
    main()
