// consult / dispatch の tmux backend テストが PATH へ置く偽 tmux。
// server は socket ごとに dir を持ち、その中に session の画面と buffer を置く。
// paste は入力欄に pending として置き、capture で画面へ反映し、Enter で marker つきの応答を積む。
// 反映前の Enter は落ちる（本物の TUI の挙動）。slow-paste があれば反映をその回数の capture だけ遅らせる。
// drop-enter は反映後の最初の Enter を 1 回だけ落とす。drop-enter-always は全部落とす。capture-fail-after-enter は Enter 後の capture を失敗させる。
// working-stall は応答の代わりに動かない作業中の状態行を出す。status-flicker は貼り付けが反映される前に
// 状態行を 1 度だけ動かす。paste-flap は反映後の 2 回目の capture で一度貼り付け前の入力欄に戻り、
// 4 回目の capture まで Enter を落とす。no-marker は応答に marker を書かない。late-marker は履歴 capture（-S）を 1 度読まれたあとの画面 capture で marker を書く。
// history-fail-after-first は 2 回目以降の履歴 capture を失敗させる。prompt-stall は応答の代わりに
// 入力欄の無い問いを出して止まる。Enter の回数は enters に積む。

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
    if "C-m" in args:
        enters = server / "enters"
        enters.write_text(enters.read_text() + "enter\\n" if enters.exists() else "enter\\n")
        pending = server / "pending"
        drop = root / "drop-enter"
        flap = root / "paste-flap"
        if (root / "drop-enter-always").exists():
            pass
        elif flap.exists() and not (server / "flap-done").exists():
            pass
        elif pending.exists() and (server / "pending-rendered").exists() and drop.exists():
            drop.unlink()
        elif pending.exists() and (server / "pending-rendered").exists():
            text = pending.read_text()
            pending.unlink()
            (server / "pending-rendered").unlink()
            marker_m = re.search(r"([A-Z]+-DONE-[a-z0-9]+-\\d+)", text)
            marker = marker_m.group(1) if marker_m else "NO-MARKER"
            if (root / "no-marker").exists():
                marker = ""
            if (root / "late-marker").exists():
                (server / "late-marker").write_text(marker)
                marker = ""
            prompts = server / "prompts"
            n = int(prompts.read_text()) + 1 if prompts.exists() else 1
            prompts.write_text(str(n))
            verdict = (root / "verdict").read_text() if (root / "verdict").exists() else ""
            screen = server / "screen"
            # 送信で入力欄の placeholder は消える（本物の TUI は入力欄を描き直す）
            shown = screen.read_text().replace("› [Pasted Content]\\n", "")
            if (root / "prompt-stall").exists():
                # 対話は入力欄を出さない
                screen.write_text("Allow this command? (y/n)\\n")
            elif (root / "working-stall").exists():
                screen.write_text(shown + "• Working (6s • esc to interrupt)\\n")
            else:
                screen.write_text(shown + ("answer %d\\n%s%s\\n❯ \\n" % (n, verdict, marker)))
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
    (server / "pending").write_text(text)
    slow = root / "slow-paste"
    (server / "pending-delay").write_text(slow.read_text().strip() if slow.exists() else ("3" if (root / "status-flicker").exists() else "0"))
    raise SystemExit(0)

if args[0] == "delete-buffer":
    (server / ("buf-" + args[args.index("-b") + 1])).unlink(missing_ok=True)
    raise SystemExit(0)

if args[0] == "capture-pane":
    target()
    if (root / "capture-fail-after-enter").exists() and (server / "enters").exists():
        raise SystemExit(1)
    history = "-S" in args
    seen = server / "history-seen"
    if history:
        if (root / "history-fail-after-first").exists() and seen.exists():
            raise SystemExit(1)
        seen.write_text("")
    late = server / "late-marker"
    if late.exists() and not history and seen.exists():
        screen = server / "screen"
        screen.write_text(screen.read_text() + late.read_text() + "\\n❯ \\n")
        late.unlink()
    pending = server / "pending"
    if pending.exists() and not (server / "pending-rendered").exists():
        delay = int((server / "pending-delay").read_text())
        flicker = server / "flickered"
        if (root / "status-flicker").exists() and not flicker.exists():
            screen = server / "screen"
            screen.write_text(screen.read_text() + "  model · thinking\\n")
            flicker.write_text("")
        if delay > 0:
            (server / "pending-delay").write_text(str(delay - 1))
        else:
            screen = server / "screen"
            screen.write_text(screen.read_text() + "› [Pasted Content]\\n")
            (server / "pending-rendered").write_text("")
    shown = (server / "screen").read_text()
    if (root / "paste-flap").exists() and (server / "pending-rendered").exists():
        n = int((server / "flap-count").read_text()) + 1 if (server / "flap-count").exists() else 1
        (server / "flap-count").write_text(str(n))
        if n == 2:
            shown = shown.replace("› [Pasted Content]\\n", "")
        if n >= 4:
            (server / "flap-done").write_text("")
    sys.stdout.write(shown)
    raise SystemExit(0)

raise SystemExit("Unexpected tmux: " + repr(args))
`;

export const installFakeTmux = async (dir: string): Promise<void> => {
  await Bun.write(join(dir, "tmux"), FAKE_TMUX);
  await chmod(join(dir, "tmux"), 0o755);
};
