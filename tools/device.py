#!/usr/bin/env python3
"""Package or install ChatGPT over SSH. Does not restart Xochitl or alter other mods."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "compatibility.json").read_text())
PAYLOAD = ["ChatGPT.qml", "Conversation.qml", "MarkdownView.qml", "PageReader.qml", "NativePageRenderer.qml", "NativeRefresh.qml",
           "ContentRenderer.qml", "ContentStore.qml", "ContentPreview.qml", "lib/Content.js", "lib/GraphMath.js",
           "lib/vendor/MathWorker.js", "lib/vendor/MathJax-LICENSE.txt", "lib/vendor/README.md",
           "ApiClient.qml", "ApiSettings.qml", "lib/PageImage.js", "lib/ChatProtocol.js", "lib/Markdown.js",
           "chatGPT.qmd", "compatibility.json"]


def archive():
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as bundle:
        for name in PAYLOAD:
            bundle.add(ROOT / name, arcname=name, recursive=False)
    return stream.getvalue()


def ssh_args(args):
    command = ["ssh", "-F", "/dev/null", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes"]
    if args.identity:
        command += ["-i", str(Path(args.identity).expanduser())]
    return command + [args.host]


def remote(args, script, data=None, capture=False):
    return subprocess.run(ssh_args(args) + [script], input=data, check=True,
                          stdout=subprocess.PIPE if capture else None)


def check(args):
    result = remote(args, '''set -eu
        . /etc/os-release
        printf 'firmware=%s\n' "$IMG_VERSION"
        printf 'sha256='
        sha256sum /usr/bin/xochitl | cut -d ' ' -f 1
        test -f /home/root/xovi/xovi.so
        test -f /home/root/xovi/extensions.d/qt-resource-rebuilder.so
        test -f /usr/lib/qml/QtCore/qmldir
        test -f /usr/lib/qml/QtQml/WorkerScript/qmldir
        test -f /usr/lib/plugins/imageformats/libqsvg.so
        printf 'loader=ready\n'
    ''', capture=True).stdout.decode()
    values = dict(line.split("=", 1) for line in result.splitlines() if "=" in line)
    if values.get("firmware") != MANIFEST["firmware"] or values.get("sha256") != MANIFEST["xochitl_sha256"]:
        raise RuntimeError("Unsupported firmware or Xochitl binary. No files changed.")
    if values.get("loader") != "ready":
        raise RuntimeError("xovi, qt-resource-rebuilder, QtCore, WorkerScript or SVG support is unavailable.")
    print(f"Compatible firmware: {values['firmware']}", flush=True)


def install(args):
    check(args)
    stage = remote(args, "umask 077; mktemp -d /home/root/xovi/.ChatGPT-stage.XXXXXX", capture=True).stdout.decode().strip()
    if not re.fullmatch(r"/home/root/xovi/\.ChatGPT-stage\.[A-Za-z0-9]+", stage):
        raise RuntimeError("Unexpected staging directory. Stopped.")
    remote(args, f"tar -xzf - -C {shlex.quote(stage)}", archive())
    checks = "\n".join(
        f"printf '%s  %s\\n' {shlex.quote(hashlib.sha256((ROOT / name).read_bytes()).hexdigest())} {shlex.quote(stage + '/' + name)} | sha256sum -c -"
        for name in PAYLOAD)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    # Verify all payload files first. Move the QMD last, so a first install cannot
    # activate a partially uploaded application. Preserve private configuration.
    files = " ".join(shlex.quote(name) for name in PAYLOAD if name != "chatGPT.qmd")
    remote(args, f'''set -eu
        umask 077
        {checks}
        base=/home/root/xovi/ChatGPT
        qmd=/home/root/xovi/exthome/qt-resource-rebuilder/chatGPT.qmd
        backup="$base/backups/{stamp}"
        mkdir -p "$base/lib/vendor" "$base/images" "$backup/lib/vendor"
        for name in {files}; do
            if test -f "$base/$name"; then cp -p "$base/$name" "$backup/$name"; fi
            mv {shlex.quote(stage)}/"$name" "$base/$name"
        done
        if test -f "$qmd"; then cp -p "$qmd" "$backup/chatGPT.qmd"; fi
        if ! test -f "$base/config.ini"; then
            printf '[General]\\napiKey=\\nmodel=\\nbaseUrl=https://api.openai.com/v1\\n' > "$base/config.ini"
        fi
        chmod 600 "$base/config.ini"
        mv {shlex.quote(stage)}/chatGPT.qmd "$qmd"
        rmdir {shlex.quote(stage)}/lib/vendor {shlex.quote(stage)}/lib {shlex.quote(stage)}
        printf 'Installed ChatGPT. Backup: %s\\n' "$backup"
    ''')
    print("Save your notebook before activation:")
    print(shlex.join(ssh_args(args) + ["/home/root/xovi/start"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["bundle", "check", "install", "disable", "logs"])
    parser.add_argument("--host", default="root@10.11.99.1")
    parser.add_argument("--identity")
    args = parser.parse_args()
    if args.host.startswith("-") or not re.fullmatch(r"[A-Za-z0-9_.@:\[\]-]+", args.host):
        parser.error("Invalid SSH host")
    if args.action == "bundle":
        destination = ROOT / "dist" / f"ChatGPT-{MANIFEST['version']}.tar.gz"
        destination.parent.mkdir(exist_ok=True)
        destination.write_bytes(archive())
        print(destination)
    elif args.action == "check":
        check(args)
    elif args.action == "install":
        install(args)
    elif args.action == "disable":
        remote(args, '''set -eu
            qmd=/home/root/xovi/exthome/qt-resource-rebuilder/chatGPT.qmd
            if test -f "$qmd"; then
                mkdir -p /home/root/xovi/ChatGPT/disabled
                mv "$qmd" "/home/root/xovi/ChatGPT/disabled/chatGPT-$(date +%s).qmd"
            fi
        ''')
        print("ChatGPT disabled. Save your work, then reload xovi to apply.")
    else:
        remote(args, "journalctl -u xochitl -n 300 --no-pager | grep -Ei 'ChatGPT|PageReader|NativePageRenderer|resource-rebuilder' || true")


if __name__ == "__main__":
    main()
