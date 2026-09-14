// consult / dispatch の tmux backend テストが PATH へ置く偽 tmux。
// server は socket ごとに dir を持ち、その中に session の画面と buffer を置く。
// paste された prompt の marker を応答として積む。

import { chmod } from "node:fs/promises";
import { join } from "node:path";

const FAKE_TMUX = `#!/usr/bin/env python3
import pathlib, re, shutil, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
# server の振る舞いをユーザー設定に左右させない呼び出しだけを受ける
if args[:2] != ["-f", "/dev/null"]:
    raise SystemExit("tmux: -f /dev/null が無い: " + repr(args))
args = args[2:]
if args[:1] != ["-L"]:
    raise SystemExit("tmux: -L が無い: " + repr(args))
sock = args[1]
args = args[2:]
server = root / ("srv-" + sock)

def target() -> None:
    # socket は session ごと。別の server へ向けた呼び出しを落とす
    t = args[args.index("-t") + 1]
    name = (t[1:] if t[:1] in ("=", "%") else t).split(":", 1)[0]
    if name != sock:
        raise SystemExit("tmux: socket %r is not session %r" % (sock, name))

def require_server() -> None:
    if not server.exists():
        sys.stderr.write("no server running on " + sock + "\\n")
        raise SystemExit(1)

if not args:
    raise SystemExit("tmux: no args")

if args[0] == "new-session":
    if args[args.index("-s") + 1] != sock:
        raise SystemExit("tmux: socket %r is not session" % sock)
    # die: 起動した harness が即座に終了し、server が残らない
    if (root / "die").exists():
        raise SystemExit(0)
    server.mkdir()
    # login: 起動した harness がログイン待ちの画面を出す
    login = root / "login"
    (server / "screen").write_text(login.read_text() if login.exists() else "❯ \\n")
    raise SystemExit(0)

if args[0] == "has-session":
    target()
    raise SystemExit(0 if server.exists() else 1)

if args[0] == "kill-server":
    require_server()
    shutil.rmtree(server)
    bump = root / "kills"
    bump.write_text(str(int(bump.read_text()) + 1 if bump.exists() else 1))
    raise SystemExit(0)

require_server()

if args[0] == "list-panes":
    # 本物は pane id を返す。固定 target へ戻す回帰を落とす
    target()
    sys.stdout.write("%" + sock + "\\n")
    raise SystemExit(0)

if args[0] == "send-keys":
    target()
    raise SystemExit(0)

if args[0] == "load-buffer":
    b = args[args.index("-b") + 1]
    (server / ("buf-" + b)).write_text(pathlib.Path(args[-1]).read_text())
    raise SystemExit(0)

if args[0] == "paste-buffer":
    target()
    buf = server / ("buf-" + args[args.index("-b") + 1])
    text = buf.read_text()
    if "-d" in args:
        buf.unlink()
    marker_m = re.search(r"([A-Z]+-DONE-[a-z0-9]+-\\d+)", text)
    marker = marker_m.group(1) if marker_m else "NO-MARKER"
    prompts = server / "prompts"
    n = int(prompts.read_text()) + 1 if prompts.exists() else 1
    prompts.write_text(str(n))
    verdict = (root / "verdict").read_text() if (root / "verdict").exists() else ""
    screen = server / "screen"
    screen.write_text(screen.read_text() + ("answer %d\\n%s%s\\n❯ \\n" % (n, verdict, marker)))
    raise SystemExit(0)

if args[0] == "delete-buffer":
    (server / ("buf-" + args[args.index("-b") + 1])).unlink(missing_ok=True)
    raise SystemExit(0)

if args[0] == "capture-pane":
    target()
    sys.stdout.write((server / "screen").read_text())
    raise SystemExit(0)

raise SystemExit("Unexpected tmux: " + repr(args))
`;

export const installFakeTmux = async (dir: string): Promise<void> => {
  await Bun.write(join(dir, "tmux"), FAKE_TMUX);
  await chmod(join(dir, "tmux"), 0o755);
};
