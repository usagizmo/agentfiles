#!/usr/bin/env python3
# conductor の周回の記録（`<!-- cycle -->`）が書く成果の指紋。
#
# **この実装が符号化の SSOT。**手順書（`../references/protocols.md`）は呼び出し契約と
# 成分を選ぶ理由だけを持ち、ここと同等物を prose から書き直さない。
#
# **同じ観測から必ず同じ値になることが、action が一意に決まる条件。**照合は「現在の指紋と
# `mark` が違えば `count` を 0 にする」なので、実行器が交代するたびに作り方が変わると
# 照合は毎回不一致になり、成果ゼロの周の上限が永久に発火しない。
#
# **指紋は content の関数にする。**「同じ観測」を破る経路は名前と順序だけではない。
#
#   - **porcelain の出力を材料にしない** —— `git diff` のテキストは git のバージョンで形が動く。
#     使うのは plumbing の `diff-index --raw -z` で、表示系の設定にも `core.abbrev` にも
#     影響されない（実測）
#   - **index の鮮度に依存しない** —— `diff-index` は stat が古いと中身が同じ path も変更として
#     返す。`update-index --refresh` は index を書くので観測が副作用を持つ。代わりに**候補として
#     受け取り、blob id で確かめて落とす**
#   - **git の設定を環境から注入させない** —— global / system に加えて `GIT_CONFIG_COUNT` と
#     `GIT_CONFIG_PARAMETERS` も閉じる。`core.excludesFile` を注入すると untracked の集合が
#     変わる（実測）
#
# **python3 で書くのは、指紋の入力が任意のバイト列だから。**NUL を含むバイナリ・改行を含む
# path・symlink の link target が入る。shell 変数は NUL を保持できず、`readlink` は末尾改行を
# 落とすので、bash で書くと「規定が無い」を「実装が壊れている」に置き換えるだけになる。
#
# 終了コード
#   0  指紋を stdout へ出した（小文字 64 桁の hex + 改行。これ以外は出さない）
#   1  観測に失敗した。**指紋は出さない**（呼び出し側はその周の照合を進めない）
#   2  呼び出しが誤っている（引数の欠落・矛盾・空文字）
#
# **観測の失敗を空へ畳まない。**畳むと、取得に失敗した周と本当に成分が無い周が同じ指紋になり、
# 壊れた checkout がそのまま「成果ゼロ」として数えられる。

import argparse
import hashlib
import os
import re
import stat
import subprocess
import sys

# **符号化を変えたらここを上げる。**指紋の先頭に入るので、新旧が静かに同じ値へ化けない。
# 互換は持たない（旧 `mark` の変換も新旧併用もしない）。上げた周は全件が不一致になり、
# `count` が 1 度だけ 0 に戻る（退避が最大 1 周遅れる安全側）。
SCHEMA = "cycle-mark/1"

# **レコード名は固定の ASCII 定数だけ。**可変長のものはすべて中身側へ置いて長さ前置きにする。
# path を名前に埋めると（`untracked:<path>`）、改行を含む path で framing が曖昧になり、
# 別の観測が同じバイト列に化ける。
RECORD_NAME = re.compile(r"\A[a-z][a-z-]*\Z")

# remote は `origin` 固定。**同じ skill の `watch.sh` が remote branch を `origin/*` で観測する**
# ので、そちらと違う remote を見ると「観測した branch」と「指紋の head」がずれる。
REMOTE = "origin"

# git の出力を実行環境から切り離す。**受入条件の「利用者の git 設定に依存しない」はここで閉じる。**
# 残る repo-local は checkout そのものの性質（どの実行器から見ても同じ）なので触らない。
GIT_ENV_OVERRIDES = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_ATTR_NOSYSTEM": "1",
    # **環境から config を注入する経路も閉じる。**`GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_n` は
    # global / system を潰しても素通りする別系統で、ここから `core.excludesFile` を足すと
    # untracked の集合が変わる。
    "GIT_CONFIG_COUNT": "0",
    # pager と prompt を止めるのは、待ちに落ちて tick ごと止まらないため。
    "GIT_PAGER": "cat",
    "GIT_TERMINAL_PROMPT": "0",
    # **index を書かせない。**観測は副作用を持たない —— 別の実行器が同じ worktree を同時に
    # 観測しても壊れない。stat が古いことによる誤検出は blob id で落とす（下の `changed_paths`）。
    "GIT_OPTIONAL_LOCKS": "0",
    # **これは指紋のためではない。**並びは Python 側で生バイト昇順に取り直し、材料は plumbing
    # なので locale は値に効かない。揃えるのは失敗したときの stderr で、実行環境ごとに別の
    # 言語で報告されると状況ボードに出た文言から原因を引けなくなる。
    "LC_ALL": "C",
    "LANG": "C",
}

# 呼び出し側の環境から漏れると、どの repo を見るか・どの設定で読むかが引数と食い違う。
# `GIT_CONFIG_PARAMETERS` は `git -c` が子プロセスへ伝える経路なので、`COUNT` とは別に落とす。
GIT_ENV_DROP = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
)

# `--raw -z` は plumbing の形式。`--no-renames` は R / C の 2 path 形式を作らせないため
# （形が 1 つに決まると、読み違えようが無い）。
CHANGED_FLAGS = ("--raw", "-z", "--no-renames", "--ignore-submodules=none")

# git の mode と、こちらが lstat から付ける種別の対応。**変更の確認にしか使わない。**
MODE_FOR_KIND = {"file": b"100644", "executable-file": b"100755", "symlink": b"120000"}

NULL_OID = re.compile(r"\A0+\Z")


class ObservationError(Exception):
    """観測に失敗した。指紋を返さずに終える（exit 1）。"""


class Encoder:
    """`<名前>\\n<バイト長>\\n<中身>\\n` を並べた連結の SHA-256。

    **長さは生バイト数。**untracked と tracked の中身は任意のバイト列なので、文字数でも
    UTF-8 の符号点数でもない。

    名前が固定なら、この形は一意に読み戻せる（名前は改行を含まず、長さで中身が確定する）。
    **改行区切りで素朴に連結しない** —— 境目が消えて `a` + `bc` と `ab` + `c` が同じ
    バイト列になり、成果が変わっても指紋が動かない。
    """

    def __init__(self):
        self._digest = hashlib.sha256()

    def record(self, name, content):
        assert RECORD_NAME.match(name), name
        assert isinstance(content, bytes), name
        self._digest.update(name.encode("ascii"))
        self._digest.update(b"\n")
        self._digest.update(str(len(content)).encode("ascii"))
        self._digest.update(b"\n")
        self._digest.update(content)
        self._digest.update(b"\n")

    def text(self, name, value):
        self.record(name, value.encode("utf-8"))

    def hexdigest(self):
        return self._digest.hexdigest()


def git_env():
    env = os.environ.copy()
    for key in GIT_ENV_DROP:
        env.pop(key, None)
    env.update(GIT_ENV_OVERRIDES)
    return env


def git(cwd, *args):
    """git を回して stdout をバイト列で返す。失敗は観測の失敗。"""
    argv = ["git", "-C", cwd, "--no-pager"] + list(args)
    try:
        proc = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=git_env())
    except OSError as exc:
        raise ObservationError("git を起動できない: {}".format(exc))
    if proc.returncode != 0:
        raise ObservationError(
            "git {} が {} で終わった: {}".format(
                " ".join(args), proc.returncode, proc.stderr.decode("utf-8", "replace").strip()
            )
        )
    return proc.stdout


def read_bytes(path, label):
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError as exc:
        raise ObservationError("{} を読めない: {}".format(label, exc))


def verify_worktree(path):
    """worktree root であることを確かめ、正規化した絶対 path を返す。

    **root であることまで見る。**部分木を渡されると untracked の path が repo 相対でなくなり、
    同じ観測から別の値が出る。実体が消えていれば git が失敗するので、**呼び出し側の観測と
    現実が食い違ったまま指紋を返すことも無い**（その周は照合を進めない）。
    """
    if not os.path.isdir(path):
        raise ObservationError("worktree が無い: {}".format(path))
    top = git(path, "rev-parse", "--show-toplevel").decode("utf-8").strip()
    if os.path.realpath(top) != os.path.realpath(path):
        raise ObservationError("worktree root ではない: {} (top={})".format(path, top))
    return os.path.realpath(path)


def classify(mode):
    if stat.S_ISLNK(mode):
        return "symlink"
    if stat.S_ISREG(mode):
        # 実行ビットは種別で分ける。`chmod +x` だけを行った周を成果ゼロにしないため。
        return "executable-file" if mode & 0o111 else "file"
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISFIFO(mode):
        return "fifo"
    if stat.S_ISSOCK(mode):
        return "socket"
    if stat.S_ISBLK(mode):
        return "block-device"
    if stat.S_ISCHR(mode):
        return "char-device"
    return "unknown"


def read_regular(full):
    """通常ファイルを、開いてから種別を確かめて読む。

    **`lstat` の結果を信じて開かない。**並行して symlink や FIFO へ差し替えられると、
    参照先を読む（`O_NOFOLLOW` で防ぐ）か、開いたまま無期限に止まる（`O_NONBLOCK` で防ぐ）。
    どちらも観測の失敗として返す —— 止まると tick ごと固まる。
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(full, flags)
    except OSError as exc:
        raise ObservationError("untracked / tracked を開けない: {}".format(exc))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ObservationError("開いた先が通常ファイルではない: {!r}".format(full))
        chunks = []
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
    except OSError as exc:
        raise ObservationError("読めない: {}".format(exc))
    finally:
        os.close(fd)
    return b"".join(chunks)


def observe_entity(worktree, path, allow_absent):
    """worktree 上の 1 entry を（種別, 中身）で返す。

    tracked と untracked で同じ形にする —— 片方だけ別の表現にすると、同じ中身の entry が
    どちらに居たかで別の枝を通ることになる。
    """
    full = os.path.join(os.fsencode(worktree), path)
    try:
        info = os.lstat(full)
    except FileNotFoundError:
        # tracked の削除は「無い」が正しい状態。untracked で消えていたら、直前に git が
        # 列挙したものが失われているので観測の失敗。
        if allow_absent:
            return ("absent", b"")
        raise ObservationError("列挙された untracked が消えている: {!r}".format(path))
    except OSError as exc:
        raise ObservationError("stat できない: {}".format(exc))

    kind = classify(info.st_mode)
    if kind == "symlink":
        # **参照先ではなく link target を書く** —— 辿ると、指す先が外部で変わっただけの周に
        # 成果があったことになる。
        try:
            return (kind, os.readlink(full))
        except OSError as exc:
            raise ObservationError("symlink を読めない: {}".format(exc))
    if kind in ("file", "executable-file"):
        return (kind, read_regular(full))
    # FIFO / socket / device / directory。**読みにいかない**（FIFO は開いた時点で止まる）。
    # 観測の失敗ではないので種別として残す —— 空へ畳んで通常ファイルと混ぜない。
    return (kind, b"")


def blob_id(object_format, kind, body):
    """worktree の entry を git の blob id へ写す。変更の確認にしか使わない。"""
    algorithm = hashlib.sha1 if object_format == "sha1" else hashlib.sha256
    digest = algorithm()
    digest.update(b"blob " + str(len(body)).encode("ascii") + b"\0")
    digest.update(body)
    return digest.hexdigest().encode("ascii")


def changed_paths(worktree, object_format):
    """HEAD と中身が違う tracked の entry を、path のバイト昇順で返す。

    `diff-index` が返すのは**候補**。stat が古いだけの path が混ざるので（index を書かずに
    観測するにはそれを受け入れるしかない）、mode と blob id で確かめて落とす。落とさないと、
    誰かが index を refresh しただけの周に成果があったことになる。
    """
    raw = git(worktree, "diff-index", *(CHANGED_FLAGS + ("HEAD",)))
    fields = [f for f in raw.split(b"\0")]
    if fields and fields[-1] == b"":
        fields.pop()
    if len(fields) % 2 != 0:
        raise ObservationError("diff-index の出力が meta と path の対になっていない")

    entries = []
    for index in range(0, len(fields), 2):
        meta, path = fields[index], fields[index + 1]
        if not meta.startswith(b":"):
            raise ObservationError("diff-index の meta が読めない: {!r}".format(meta))
        parts = meta[1:].split(b" ")
        if len(parts) < 5:
            raise ObservationError("diff-index の meta の欄が足りない: {!r}".format(meta))
        src_mode, src_oid, status = parts[0], parts[2], parts[4]
        # **rename / copy は 1 entry が 2 path を占める。**plumbing は `-M` を渡さない限り
        # 検出しないので `--no-renames` と併せて起きないはずだが、起きたら対の読み方が
        # ずれて別の path の中身を別の path に紐づける。黙って進めずに観測の失敗にする。
        if status[:1] in (b"R", b"C"):
            raise ObservationError("rename / copy が検出された: {!r}".format(meta))
        kind, body = observe_entity(worktree, path, allow_absent=True)
        if (
            kind != "absent"
            and MODE_FOR_KIND.get(kind) == src_mode
            and not NULL_OID.match(src_oid.decode("ascii", "replace"))
            and blob_id(object_format, kind, body) == src_oid
        ):
            continue
        entries.append((path, kind, body))
    return sorted(entries, key=lambda entry: entry[0])


def untracked_entries(worktree):
    """untracked を path のバイト昇順で返す。

    **`--exclude-standard` を落とさない** —— build 成果物・OS ファイル・ログが毎周動くので、
    ignore 対象を混ぜると指紋が常に変わって成果ゼロの上限が実質発火しない。

    **並びは生バイトの昇順**（`LC_ALL=C` と同じ順序）。locale で順が変わると同じ観測から
    別の値になる。
    """
    raw = git(worktree, "ls-files", "--others", "--exclude-standard", "--full-name", "-z")
    entries = []
    for path in sorted(p for p in raw.split(b"\0") if p):
        kind, body = observe_entity(worktree, path, allow_absent=False)
        entries.append((path, kind, body))
    return entries


def encode_resolve(enc, args):
    """解決の周。成果物の側だけから作る。

    **`runtime` とセッションの状態は入れない**（回した直後に必ず変わるので、入れると常に
    成果ありになる）。**commit 数でも引かない**（amend / squash / rebase で減る）。
    """
    enc.text("progress", args.progress)

    worktree = verify_worktree(args.worktree) if args.worktree else None

    if worktree:
        enc.text("head-source", "worktree")
        enc.text("head", git(worktree, "rev-parse", "HEAD").decode("utf-8").strip())
    elif args.branch:
        # worktree を消した後でも branch が残っていれば head は撮れる。
        ref = "refs/remotes/{}/{}".format(REMOTE, args.branch)
        enc.text("head-source", "remote-branch")
        enc.text("head", git(args.repo, "rev-parse", "--verify", ref).decode("utf-8").strip())
    else:
        # **branch も worktree も無い段階（claim 前・実体を消した後）でも一意に作る。**
        # 段階で免除を分けない —— 分けると、免除の側を広く読んだ実装が照合を飛ばす。
        enc.text("head-source", "absent")
        enc.text("head", "")

    if worktree:
        object_format = git(worktree, "rev-parse", "--show-object-format").decode("utf-8").strip()
        enc.text("tracked-source", "worktree")
        emit_entries(enc, "tracked", changed_paths(worktree, object_format))
        enc.text("untracked-source", "worktree")
        emit_entries(enc, "untracked", untracked_entries(worktree))
    else:
        enc.text("tracked-source", "absent")
        enc.text("untracked-source", "absent")

    encode_optional_file(enc, "plan-comment", args.plan_comment)
    encode_optional_file(enc, "wait-record", args.wait_record)


def emit_entries(enc, prefix, entries):
    """**path・種別・中身をそれぞれ長さ前置きで置く。**

    中身まで入れるのは、path と状態だけ（`git status --porcelain` の類）にすると、既に
    dirty なファイルをさらに書いた周が成果ゼロになるから。真偽値への丸めも同じ理由で不可。
    """
    for path, kind, body in entries:
        enc.record(prefix + "-path", path)
        enc.text(prefix + "-kind", kind)
        enc.record(prefix + "-body", body)


def encode_plan(enc, args):
    """計画の周。"""
    # `ledger` はこの周では常に `未計画` なので値としては冗長だが、成分の集合は現行の表が
    # SSOT なので落とさない。
    enc.text("ledger", args.ledger)
    for number, path in sorted(args.issue_body, key=lambda pair: pair[0]):
        enc.text("issue-number", str(number))
        # **本文をそのまま入れる。**外側で SHA-256 を取るので、先に digest へ畳んでも
        # 識別力は同じ。畳まないぶん、呼び出し側が digest を撮り損なう経路が消える。
        enc.record("issue-body", read_bytes(path, "Issue 本文"))
    encode_optional_file(enc, "wait-record", args.wait_record)


def encode_optional_file(enc, name, path):
    """在ることと無いことを別の値にする。

    **`--no-*` を明示させるのが要点。**省略を空へ畳むと、取得に失敗した周と本当に無い周が
    同じ指紋になる。
    """
    if path is None:
        enc.text(name + "-source", "absent")
        enc.record(name, b"")
    else:
        enc.text(name + "-source", "present")
        enc.record(name, read_bytes(path, name))


def issue_body_arg(value):
    number, sep, path = value.partition(":")
    if not sep or not number.isdigit() or not path:
        raise argparse.ArgumentTypeError("<番号>:<file> の形で渡す: {}".format(value))
    return (int(number), path)


def build_parser():
    parser = argparse.ArgumentParser(
        allow_abbrev=False,
        description="周回の記録の成果の指紋を作る（conductor の tick が呼ぶ）",
        epilog=(
            "渡すのは conductor が既に正規化している値だけ。git の観測と符号化はこの実装が"
            "専任する —— 呼び出し側に成分の名前を並べさせると、名前を決める自由度が境界へ"
            "移るだけになる。"
        ),
    )
    parser.add_argument("--ledger", required=True, help="`未計画` なら計画の周、それ以外は解決の周")
    parser.add_argument("--repo", help="解決の周で必須。worktree が無くても branch を解決できる入口")
    parser.add_argument("--progress", help="解決の周で必須")
    parser.add_argument("--branch", help="代表の branch 名（remote は origin 固定）")
    parser.add_argument("--no-branch", action="store_true", help="branch が無いことの明示")
    parser.add_argument("--worktree", help="worktree root の path")
    parser.add_argument("--no-worktree", action="store_true", help="worktree が無いことの明示")
    parser.add_argument("--plan-comment", help="計画コメントの本文を入れた file")
    parser.add_argument("--no-plan-comment", action="store_true", help="計画コメントが無いことの明示")
    parser.add_argument(
        "--wait-record",
        help="人待ちの記録のコメント本文を入れた file。**有効なときだけ渡す**（判定は呼び出し側）",
    )
    parser.add_argument("--no-wait-record", action="store_true", help="人待ちの記録が無い / 無効であることの明示")
    parser.add_argument(
        "--issue-body",
        action="append",
        default=[],
        type=issue_body_arg,
        metavar="番号:file",
        help="計画の周で必須。対象集合の全件を渡す（並べ替えは実装が行う）",
    )
    return parser


def require_value(parser, name, value):
    """空文字を「渡した」に数えない。

    **`--worktree ""` を「無い」へ畳まない** —— 渡し方のバグが、claim 前と同じ成果ゼロの
    指紋に化ける。省略と同じく呼び出しの誤り（exit 2）として弾く。
    """
    if value is not None and not value.strip():
        parser.error("--{} が空".format(name))


def require_pair(parser, name, value, negative):
    """`--x` と `--no-x` を排他かつ必須にする。

    **省略を許さない。**「無い」を明示させないと、渡し忘れが「無い」として通り、その差が
    指紋に出ない。
    """
    require_value(parser, name, value)
    if value is not None and negative:
        parser.error("--{0} と --no-{0} は排他".format(name))
    if value is None and not negative:
        parser.error("--{0} か --no-{0} のどちらかが要る".format(name))


def forbid(parser, kind, **values):
    for name, value in sorted(values.items()):
        if value:
            parser.error("--{} は{}の周では渡さない".format(name.replace("_", "-"), kind))


def parse_args(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    require_value(parser, "ledger", args.ledger)
    args.kind = "plan" if args.ledger == "未計画" else "resolve"

    if args.kind == "resolve":
        forbid(parser, "解決", issue_body=args.issue_body)
        require_value(parser, "repo", args.repo)
        require_value(parser, "progress", args.progress)
        if not args.repo:
            parser.error("--repo が要る")
        if args.progress is None:
            parser.error("--progress が要る")
        require_pair(parser, "branch", args.branch, args.no_branch)
        require_pair(parser, "worktree", args.worktree, args.no_worktree)
        require_pair(parser, "plan-comment", args.plan_comment, args.no_plan_comment)
    else:
        forbid(
            parser,
            "計画",
            repo=args.repo,
            progress=args.progress,
            branch=args.branch,
            no_branch=args.no_branch,
            worktree=args.worktree,
            no_worktree=args.no_worktree,
            plan_comment=args.plan_comment,
            no_plan_comment=args.no_plan_comment,
        )
        if not args.issue_body:
            parser.error("--issue-body が 1 つ以上要る")
        numbers = [number for number, _ in args.issue_body]
        if len(set(numbers)) != len(numbers):
            parser.error("--issue-body の番号が重複している")

    require_pair(parser, "wait-record", args.wait_record, args.no_wait_record)
    return args


def main(argv):
    args = parse_args(argv)
    enc = Encoder()
    enc.text("schema", SCHEMA)
    enc.text("cycle-kind", args.kind)
    try:
        if args.kind == "resolve":
            encode_resolve(enc, args)
        else:
            encode_plan(enc, args)
    except ObservationError as exc:
        sys.stderr.write("[cycle-mark] {}\n".format(exc))
        return 1
    sys.stdout.write(enc.hexdigest() + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
