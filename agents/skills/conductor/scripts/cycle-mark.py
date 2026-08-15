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
#   - **`git diff` のテキストを材料にしない** —— 出力の形が git のバージョンで動く。変わった
#     path の集合は `status --porcelain=v1 -z` から取る。**`--porcelain=v1` は「バージョンと
#     利用者の設定を越えて安定」と git が明示している契約**で、表示系の設定にも `core.abbrev`
#     にも影響されない
#   - **index の鮮度に依存しない** —— `diff-index --raw` は stat が古いと中身が同じ path も
#     返す。`status` は中身で比べるので、`update-index --refresh`（index を書く＝観測が副作用を
#     持つ）を通さずに済む
#   - **filter を自分で再現しない** —— `core.autocrlf` や `text=auto` があると worktree の生
#     バイトと HEAD の blob は一致しない（実測）。「変わったか」の判定は git に任せ、こちらは
#     worktree の中身をそのまま指紋へ入れる
#   - **git の設定を環境から注入させない** —— global / system に加えて `GIT_CONFIG_COUNT` と
#     `GIT_CONFIG_PARAMETERS` も閉じる。`core.excludesFile` を注入すると untracked の集合が
#     変わる（実測）
#
# **観測を atomic にはしない。**status・index・worktree の中身は別々の時点で撮るので、
# 並行して書かれていれば実在しなかった混成の状態が出る。lock を取らないのは意図で、
# **ずれた周は次の周と値が違う ＝ 成果ありの側へ倒れる**（成果ゼロを数え損なうだけで、
# 進んでいない課題を退避させることはない）。撮り直して突き合わせても窓が縮むだけで消えず、
# 費用は倍になる。
#
# **いちばん広い窓だけは閉じる。**観測の途中で commit が入ると「古い HEAD ＋ commit 後の
# clean な worktree」が出る。これは前の周の指紋と**一致しうる**（前の周も同じ HEAD で clean
# だったなら）ので、commit した周が成果ゼロとして数えられる —— 進んだ課題を退避させる向きに
# 倒れる数少ない経路で、commit は 1 回で全成分を動かすぶん窓が最も広い。HEAD を前後で撮って、
# 動いていたら観測の失敗にする。
#
# **残りは閉じない。**index や worktree を読んだ後にそこだけ書き換えられると、同じ向きの
# 取りこぼしが残る。全成分を前後で撮り直せば窓は縮むが消えず、費用は倍になる。**残余は規約の
# 「見えないもの」に書いてある。**
#
# **git が見ないものはこちらも見えない。**`skip-worktree` / `assume-unchanged` が立った path は
# 中身を書き換えても `status` に出ないので、成果ゼロに見える。全 tracked を毎周読めば塞げるが、
# 費用が釣り合わない —— **規約側にも書いてある既知の穴**（`../references/protocols.md`）。
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
import signal
import stat
import subprocess
import sys

# **符号化を変えたらここを上げる。**指紋の先頭に入るので、新旧が静かに同じ値へ化けない。
# 互換は持たない（旧 `mark` の変換も新旧併用もしない）。上げた周は全件が不一致になり、
# `count` が 1 度だけ 0 に戻る（退避が最大 1 周遅れる安全側）。
SCHEMA = "cycle-mark/2"

# **レコード名は固定の ASCII 定数だけ。**可変長のものはすべて中身側へ置いて長さ前置きにする。
# path を名前に埋めると（`untracked:<path>`）、改行を含む path で framing が曖昧になり、
# 別の観測が同じバイト列に化ける。
RECORD_NAME = re.compile(r"\A[a-z][a-z-]*\Z")

# remote は `origin` 固定。**同じ skill の `watch.sh` が remote branch を `origin/*` で観測する**
# ので、そちらと違う remote を見ると「観測した branch」と「指紋の head」がずれる。
REMOTE = "origin"

# branch head を撮る順。**ローカルを先に見る。**着地面の branch は push を要求しないので
# （`../references/landing-surface.md`）、remote だけを見ると commit が生まれている面の head が
# 永久に解決できず、その面の周は毎回観測の失敗になる。ローカルと remote が両方あって食い違う
# 場合にローカルを採るのは、成果＝手元で生まれたもの、だから。
BRANCH_SOURCES = (
    ("local-branch", "refs/heads/{}"),
    ("remote-branch", "refs/remotes/" + REMOTE + "/{}"),
)

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
    # 観測しても壊れない。`status` は index を書かなくても中身で比べるので、これで値は変わらない。
    "GIT_OPTIONAL_LOCKS": "0",
    # **これは指紋のためではない。**並びは Python 側で生バイト昇順に取り直し、材料は plumbing
    # なので locale は値に効かない。揃えるのは失敗したときの stderr で、実行環境ごとに別の
    # 言語で報告されると応答に出た文言から原因を引けなくなる。
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

# **設定で動く欄を引数で固定する。**`--untracked-files` は `status.showUntrackedFiles` を
# 打ち消すため（既定の `normal` だと untracked なディレクトリが `dir/` に畳まれ、中の変化が
# 出ない）、`--no-renames` は R / C の 2 path 形式を作らせないため（形が 1 つに決まると、
# 読み違えようが無い）。**ignore 対象は既定で出ないので、打ち消しは要らない**
# （`--ignored` は CLI だけの指定で、config から有効にはならない）。
STATUS_FLAGS = (
    "--porcelain=v1",
    "-z",
    "--no-renames",
    "--untracked-files=all",
    # **submodule を隠させない。**`diff.ignoreSubmodules` / `submodule.<name>.ignore` が
    # repo-local にあると tip の動いた submodule が status に出ず、下の fail-closed へ届かない
    # まま clean と同じ指紋になる（実測）。
    "--ignore-submodules=none",
)

UNTRACKED_STATUS = b"??"
GITLINK_MODE = b"160000 "


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
        assert isinstance(content, bytes), name
        self.record_stream(name, len(content), (content,))

    def record_stream(self, name, length, chunks):
        """**中身をメモリに溜めずに流し込む。**大きな dirty file 1 件で tick を落とさない。

        **長さは先に宣言し、流し終えてから実際の量と突き合わせる** —— 途中で書き換えられて
        いたら framing が壊れた指紋になるので、観測の失敗にする。
        """
        assert RECORD_NAME.match(name), name
        self._digest.update(name.encode("ascii"))
        self._digest.update(b"\n")
        self._digest.update(str(length).encode("ascii"))
        self._digest.update(b"\n")
        seen = 0
        for chunk in chunks:
            seen += len(chunk)
            if seen > length:
                raise ObservationError("読んでいる最中に {} が伸びた".format(name))
            self._digest.update(chunk)
        if seen != length:
            raise ObservationError("読んでいる最中に {} が縮んだ".format(name))
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


# repo-local から観測の見え方を変えられる設定を潰す。**どちらも成功を返しながら変更を隠す** ——
# stale な fsmonitor hook は tracked の変更を、stale な untracked cache は新しい untracked を
# 落とす（directory の mtime を信用できない filesystem で起きる）。落ちる向きが「成果ゼロ」＝
# 退避が早まる側なので、既定に任せない。
GIT_CONFIG_PINS = ("core.fsmonitor=false", "core.untrackedCache=false")

# git が戻らなくなったら観測の失敗にする。**外部 filter・壊れた repository・止まった I/O で
# 待ち続けると、exit 1 の fail-closed ではなく conductor 全体の停止になる**（起床漏れと同じ
# クラスの障害）。`watch.sh` が同じ理由で deadline を持っている。
GIT_DEADLINE = 60


def git(cwd, *args, **kwargs):
    """git を回して stdout をバイト列で返す。失敗は観測の失敗。

    `allow_fail=True` のときだけ、非 0 で `None` を返す（**stderr は捨てる**）。使うのは
    「その ref が在るか」を引くところだけで、**在ることを前提にした取得には使わない** ——
    観測の失敗を `None` へ畳むと、壊れた checkout が「実体なし」の正常な指紋になる。
    """
    allow_fail = kwargs.pop("allow_fail", False)
    assert not kwargs, kwargs
    argv = ["git", "-C", cwd, "--no-pager"]
    for pin in GIT_CONFIG_PINS:
        argv += ["-c", pin]
    argv += list(args)
    try:
        # **process group ごと落とせるようにする。**`terminate()` は直下の子しか殺さないので、
        # clean filter のような孫が握ったまま残る。
        proc = subprocess.Popen(
            argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=git_env(), start_new_session=True
        )
    except OSError as exc:
        raise ObservationError("git を起動できない: {}".format(exc))
    try:
        out, err = proc.communicate(timeout=GIT_DEADLINE)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.communicate()
        raise ObservationError("git {} が {} 秒で戻らない".format(" ".join(args), GIT_DEADLINE))
    if proc.returncode != 0:
        if allow_fail:
            return None
        raise ObservationError(
            "git {} が {} で終わった: {}".format(
                " ".join(args), proc.returncode, err.decode("utf-8", "replace").strip()
            )
        )
    return out


def common_dir(path):
    """その checkout / worktree が属する repository の共有 git ディレクトリ（絶対 path）。

    linked worktree でも同じ値になるので、**「この worktree はこの面のものか」を引く鍵**になる。
    """
    out = git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return os.path.realpath(out.decode("utf-8").strip())


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


def open_regular(full, label):
    """通常ファイルを開いて（fd, stat）を返す。

    **`lstat` の結果を信じて開かない。**並行して symlink や FIFO へ差し替えられると、
    参照先を読む（`O_NOFOLLOW` で防ぐ）か、開いたまま無期限に止まる（`O_NONBLOCK` で防ぐ）。
    どちらも観測の失敗として返す —— 止まると tick ごと固まる。
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(full, flags)
    except OSError as exc:
        raise ObservationError("{} を開けない: {}".format(label, exc))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ObservationError("{} が通常ファイルではない: {!r}".format(label, full))
    except Exception:
        os.close(fd)
        raise
    return fd, info


def read_chunks(fd, label):
    while True:
        try:
            chunk = os.read(fd, 1 << 20)
        except OSError as exc:
            raise ObservationError("{} を読めない: {}".format(label, exc))
        if not chunk:
            return
        yield chunk


def emit_file(enc, name, full, label):
    """呼び出し側が渡した file を 1 レコードとして流す。

    **worktree の中身と同じ経路で開く** —— 渡された path が FIFO なら開いた時点で止まり、
    symlink なら意図しない先を指紋へ入れることになる。種別は書かない（conductor が書いた
    file なので、通常ファイルでなければ観測の失敗が正しい）。
    """
    fd, info = open_regular(full, label)
    try:
        enc.record_stream(name, info.st_size, read_chunks(fd, label))
    finally:
        os.close(fd)


def emit_worktree_regular(enc, prefix, full, label):
    """worktree の通常ファイル。

    **種別も長さも開いた fd から取る** —— `lstat` の側から取ると、間に差し替えられたとき、
    差し替え前の実行ビットと差し替え後の中身を組み合わせた指紋を正常に返す。
    """
    fd, info = open_regular(full, label)
    try:
        enc.text(prefix + "-kind", classify(info.st_mode))
        enc.record_stream(prefix + "-body", info.st_size, read_chunks(fd, label))
    finally:
        os.close(fd)


def emit_entity(enc, prefix, worktree, path, allow_absent):
    """worktree 上の 1 entry の種別と中身をレコードへ書き出す。

    tracked と untracked で同じ形にする —— 片方だけ別の表現にすると、同じ中身の entry が
    どちらに居たかで別の枝を通ることになる。
    """
    full = os.path.join(os.fsencode(worktree), path)
    try:
        info = os.lstat(full)
    except FileNotFoundError:
        # tracked の削除は「無い」が正しい状態。untracked で消えていたら、直前に git が
        # 列挙したものが失われているので観測の失敗。
        if not allow_absent:
            raise ObservationError("列挙された untracked が消えている: {!r}".format(path))
        enc.text(prefix + "-kind", "absent")
        enc.record(prefix + "-body", b"")
        return
    except OSError as exc:
        raise ObservationError("stat できない: {}".format(exc))

    kind = classify(info.st_mode)
    if kind == "symlink":
        # **参照先ではなく link target を書く** —— 辿ると、指す先が外部で変わっただけの周に
        # 成果があったことになる。
        try:
            target = os.readlink(full)
        except OSError as exc:
            raise ObservationError("symlink を読めない: {}".format(exc))
        enc.text(prefix + "-kind", kind)
        enc.record(prefix + "-body", target)
        return
    if kind in ("file", "executable-file"):
        emit_worktree_regular(enc, prefix, full, "worktree の entry")
        return
    # FIFO / socket / device / directory。**読みにいかない**（FIFO は開いた時点で止まる）。
    # 観測の失敗ではないので種別として残す —— 空へ畳んで通常ファイルと混ぜない。
    enc.text(prefix + "-kind", kind)
    enc.record(prefix + "-body", b"")


def status_entries(worktree):
    """変わった tracked と untracked の path を、それぞれバイト昇順で返す。

    **中身はここでは読まない** —— 読むのは書き出す直前の 1 件だけにして、dirty な worktree の
    総量ぶんをメモリに載せない。

    **並びは生バイトの昇順**（`LC_ALL=C` と同じ順序）。locale で順が変わると同じ観測から
    別の値になる。

    **ignore 対象は入らない** —— build 成果物・OS ファイル・ログが毎周動くので、混ぜると
    指紋が常に変わって成果ゼロの上限が実質発火しない。
    """
    raw = git(worktree, "status", *STATUS_FLAGS)
    tracked, untracked = [], []
    for field in raw.split(b"\0"):
        if not field:
            continue
        if len(field) < 4 or field[2:3] != b" ":
            raise ObservationError("status の行が読めない: {!r}".format(field))
        status, path = field[:2], field[3:]
        # **rename / copy は 1 entry が 2 path を占める。**`--no-renames` を渡しているので
        # 起きないはずだが、起きたら対の読み方がずれて別の path の中身を別の path へ
        # 紐づける。黙って進めずに観測の失敗にする。
        if b"R" in status or b"C" in status:
            raise ObservationError("rename / copy が検出された: {!r}".format(field))
        if status == UNTRACKED_STATUS:
            untracked.append(path)
        else:
            tracked.append((path, status.decode("ascii", "replace")))
    return sorted(tracked, key=lambda entry: entry[0]), sorted(untracked)


def index_entries(worktree):
    """index の `<mode> <oid> <stage>` を path ごとにまとめる。

    **index の中身が指紋に要る** —— XY だけだと、worktree を HEAD に戻したまま staged の
    blob を差し替えた周が clean と同じ値になる。**index の oid は clean 済み**なので、
    `core.autocrlf` があっても実行環境で動かない。

    **競合中は同じ path に stage が複数ある**。全部を並べて 1 つの値にする。
    """
    table = {}
    for field in git(worktree, "ls-files", "-s", "-z").split(b"\0"):
        if not field:
            continue
        meta, tab, path = field.partition(b"\t")
        if not tab:
            raise ObservationError("ls-files の行が読めない: {!r}".format(field))
        table.setdefault(path, []).append(meta)
    return dict((path, b"\n".join(sorted(metas))) for path, metas in table.items())


def resolve_head(enc, repo, worktree, branch):
    """その面の head を撮り、出どころも指紋へ入れる。

    worktree があればそこ。無ければ branch（ローカル → remote の順）。どちらも無ければ
    「無い」を明示して符号化する。**段階で免除を分けない** —— 分けると、免除の側を広く読んだ
    実装が照合を飛ばす。
    """
    if worktree:
        head = git(worktree, "rev-parse", "HEAD").decode("utf-8").strip()
        enc.text("head-source", "worktree")
        enc.text("head", head)
        return head

    if branch:
        # worktree を消した後でも branch が残っていれば head は撮れる。
        for source, template in BRANCH_SOURCES:
            ref = template.format(branch)
            found = git(repo, "rev-parse", "--verify", "--quiet", ref, allow_fail=True)
            if found is not None:
                enc.text("head-source", source)
                enc.text("head", found.decode("utf-8").strip())
                return None
        raise ObservationError("branch {!r} が {} のどこにも無い".format(branch, repo))

    # **branch も worktree も無い段階（claim 前・実体を消した後）でも一意に作る。**
    enc.text("head-source", "absent")
    enc.text("head", "")
    return None


def split_remote_url(name):
    """remote の URL を `(host, path)` に割る。割れない形は `None`。

    `https://host/owner/repo(.git)` と `git@host:owner/repo(.git)` と `ssh://git@host/owner/repo`。
    **host より後ろを取れない形は通さない**（local path の remote 等）—— identity を確かめられない
    ものを「一致した」とは読まない。
    """
    if name.endswith(".git"):
        name = name[: -len(".git")]
    rest = name.split("://", 1)[1] if "://" in name else name
    if "://" in name or "/" in rest.split(":", 1)[0]:
        host, sep, path = rest.partition("/")
    else:
        host, sep, path = rest.partition(":")
    if not sep or not host or not path:
        return None
    return (host.rpartition("@")[2], path)


def verify_identity(checkout, repo, expected_host):
    """その checkout が `<owner>/<repo>` の実体かを `origin` の URL で確かめる。

    **面の名前と checkout の対応は呼び出し側が組み立てる。**取り違えても common dir の検査は
    通る（別の面の checkout はその面自身とは整合しているので）ので、**本来の面の成果が観測から
    落ちたまま正常な指紋が返る**。名前だけで信用しない。
    """
    # **`remote get-url` を使わない。**`url.<base>.insteadOf` が効いていると書き換え後の URL が
    # 返るので、**別の repo 名へ化けた値で照合してしまう**（同じ理由で `watch.sh` も生値を読む。
    # 2 つの観測が違う判定をすると、指紋と snapshot が食い違う）。
    # **`--get` ではなく `-z --get-all`。**`--get` は複数登録されたうち最後の 1 本しか返さないので、
    # 先頭に別 repo を足して末尾に期待値を置けば検査を通る（fetch が向く先とは食い違いうる）。
    # **NUL 終端で数える** —— 行で数えると、末尾の空値が落ちて「1 件」に見える。
    url = git(checkout, "config", "--local", "-z", "--get-all", "remote.{}.url".format(REMOTE), allow_fail=True)
    if url is None:
        raise ObservationError("面 {!r} の checkout に {} が無い: {}".format(repo, REMOTE, checkout))
    # **`-z` は各値を NUL で終端する。**最後の 1 つだけを落とし、空の値は数に残す
    # （除くと、空を足すだけで「1 件」に見えて gate をすり抜ける）。
    raw = url.split(b"\0")
    if raw and raw[-1] == b"":
        raw.pop()
    if len(raw) != 1:
        raise ObservationError(
            "面 {!r} の {} が {} 本ある: {}".format(repo, REMOTE, len(raw), checkout)
        )
    name = raw[0].decode("utf-8", "replace").strip()
    # **末尾一致で済ませない。**`.../evil/owner/repo` は末尾 2 段が一致するので通ってしまう。
    # host より後ろが `<owner>/<repo>` と**完全に**一致することを見る。
    split = split_remote_url(name)
    if split is None or split[1] != repo:
        raise ObservationError("checkout が面 {!r} のものではない: {} ({})".format(repo, checkout, name))
    # **host も照合する。**path だけだと `git@evil.example:owner/repo` が正しい面として通り、
    # **別の repo の branch と dirty をその面の成果として符号化**する。`watch.sh` は制御面の host を
    # 期待値にしているので、こちらだけ緩いと 2 つの観測が違う判定を出す。
    if split[0] != expected_host:
        raise ObservationError(
            "面 {!r} の host が期待と違う: {} ({} != {})".format(repo, checkout, split[0], expected_host)
        )


def encode_landing(enc, repo, checkout, worktree, branch, expected_host):
    """着地面 1 つぶんの成分。

    **面の名前を先に入れる。**名前を落として値だけ並べると、面が増減したときに別の面の値と
    入れ替わり、動いていない周が成果ありに見える（framing は Encoder が長さで閉じている）。
    """
    enc.text("landing", repo)

    # **checkout は使う前に確かめる。**`--no-branch --no-worktree` では参照しないので、
    # 検証しないと存在しない path を渡した周が「実体なし」の正常な指紋になる。
    git(checkout, "rev-parse", "--git-dir")
    verify_identity(checkout, repo, expected_host)

    if worktree:
        worktree = verify_worktree(worktree)
        # **その worktree がこの面のものか確かめる。**面の名前だけを突き合わせても、path を
        # 取り違えた呼び出しは通ってしまう —— **別の面の成果をこの面として符号化し、本来の面の
        # 成果は落ちる**（正常な指紋を返すので誰も気づけない）。
        if common_dir(worktree) != common_dir(checkout):
            raise ObservationError(
                "worktree {!r} は面 {!r} のものではない".format(worktree, repo)
            )
        # **その worktree にこの課題の branch が出ているかも見る。**同じ repo の別 worktree は
        # common dir が一致するので、**別の課題の HEAD と dirty をこの課題の成果として符号化**
        # できてしまう（本物の進捗は落ち、成果ゼロの `count` も誤って 0 に戻る）。detached HEAD も
        # 通さない —— 何の branch を見ているか決まらない。
        if branch:
            out = git(worktree, "symbolic-ref", "--quiet", "--short", "HEAD", allow_fail=True)
            checked_out = out.decode("utf-8").strip() if out is not None else None
            if checked_out != branch:
                raise ObservationError(
                    "worktree {!r} に出ているのは {!r} で、課題の branch {!r} ではない".format(
                        worktree, checked_out or "(detached)", branch
                    )
                )
    head_before = resolve_head(enc, checkout, worktree, branch)

    if worktree:
        tracked, untracked = status_entries(worktree)
        index = index_entries(worktree)
        enc.text("tracked-source", "worktree")
        for path, status in tracked:
            meta = index.get(path, b"")
            if meta.startswith(GITLINK_MODE) or b"\n" + GITLINK_MODE in meta:
                # **submodule は畳まずに落ちる。**指している commit が worktree の側からは
                # ディレクトリにしか見えないので、種別だけ書くと tip が動いた周と動いて
                # いない周が同じ値になる。符号化を決めていないものを黙って同値にしない。
                raise ObservationError("submodule は未対応: {!r}".format(path))
            enc.record("tracked-path", path)
            enc.text("tracked-status", status)
            enc.record("tracked-index", meta)
            emit_entity(enc, "tracked", worktree, path, allow_absent=True)
        enc.text("untracked-source", "worktree")
        for path in untracked:
            enc.record("untracked-path", path)
            emit_entity(enc, "untracked", worktree, path, allow_absent=False)
        # **HEAD が動いていないことを最後に確かめる。**成分は別々の時点で撮るので、commit が
        # 途中に入ると「古い HEAD ＋ commit 後の clean な worktree」という実在しない状態が
        # 出る。それが前の周の指紋と一致すると、**commit した周が成果ゼロとして数えられる** ——
        # 混成が成果ありの側へ倒れるという一般則の唯一の例外なので、ここだけ閉じる。
        if git(worktree, "rev-parse", "HEAD").decode("utf-8").strip() != head_before:
            raise ObservationError("観測の最中に HEAD が動いた")
    else:
        enc.text("tracked-source", "absent")
        enc.text("untracked-source", "absent")


def encode_resolve(enc, args):
    """解決の周。成果物の側だけから作る。

    **`runtime` とセッションの状態は入れない**（回した直後に必ず変わるので、入れると常に
    成果ありになる）。**commit 数でも引かない**（amend / squash / rebase で減る）。

    **着地面ごとに撮る。**成果物が生まれる repo は Issue の repo とは限らず（`landing-surface.md`）、
    1 面だけを見ると、別の面で書き進んでいる周と何も書けずに止まっている周が同じ値になる ——
    **この機構が直そうとしている欠陥そのもの。**
    """
    enc.text("progress", args.progress)
    # **期待 host は呼び出し側が渡す**（制御面の origin から取る）。**最初の面で決めない** ——
    # 制御面を着地面に含めない課題では、唯一の面が別 host でもそのまま期待値になって通ってしまう
    # （`watch.sh` は制御面を基準にしているので、判定が 2 つで割れる）。
    for repo, checkout in args.landing:
        encode_landing(
            enc, repo, checkout, args.worktree.get(repo), args.branch.get(repo), args.host
        )
    encode_optional_file(enc, "plan-comment", args.plan_comment)
    encode_optional_file(enc, "wait-record", args.wait_record)


def encode_plan(enc, args):
    """計画の周。"""
    # `ledger` はこの周では常に `未計画` なので値としては冗長だが、成分の集合は現行の表が
    # SSOT なので落とさない。
    enc.text("ledger", args.ledger)
    for number, path in sorted(args.issue_body, key=lambda pair: pair[0]):
        enc.text("issue-number", str(number))
        # **本文をそのまま入れる。**外側で SHA-256 を取るので、先に digest へ畳んでも
        # 識別力は同じ。畳まないぶん、呼び出し側が digest を撮り損なう経路が消える。
        emit_file(enc, "issue-body", os.fsencode(path), "Issue 本文")
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
        # **worktree の中身と同じ経路で読む** —— 渡された path が FIFO なら開いた時点で
        # 止まり、symlink なら意図しない先を指紋へ入れることになる。
        emit_file(enc, name, os.fsencode(path), name)


def issue_body_arg(value):
    number, sep, path = value.partition(":")
    if not sep or not number.isdigit() or not path:
        raise argparse.ArgumentTypeError("<番号>:<file> の形で渡す: {}".format(value))
    return (int(number), path)


def landing_arg(value):
    """`<面の名前>:<値>`（`--landing` の checkout path・`--branch` の名前・`--worktree` の path）。

    **面の名前を必須にする。**path だけを並べさせると、面が入れ替わったことが指紋に出ない
    （path は端末ごとに違ううえ、worktree の作り直しでも動く）。
    """
    repo, sep, path = value.partition(":")
    if not sep or not repo.strip() or not path.strip():
        raise argparse.ArgumentTypeError("<owner>/<repo>:<path> の形で渡す: {}".format(value))
    return (repo, path)


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
    parser.add_argument(
        "--landing",
        action="append",
        default=[],
        type=landing_arg,
        metavar="repo:path",
        help="解決の周で必須。着地面ごとに 1 つ（並べ替えは実装が行う）",
    )
    parser.add_argument("--progress", help="解決の周で必須")
    parser.add_argument(
        "--host",
        help="解決の周で必須。全着地面の remote が在るべき host（制御面の origin から取る）",
    )
    parser.add_argument(
        "--branch",
        action="append",
        default=[],
        type=landing_arg,
        metavar="repo:name",
        help="branch を持つ着地面ごとに 1 つ（ローカル → origin の順で解決）",
    )
    parser.add_argument(
        "--no-branch",
        action="append",
        default=[],
        metavar="repo",
        help="branch を持たない着地面ごとに 1 つ（面の名前だけ）",
    )
    parser.add_argument(
        "--worktree",
        action="append",
        default=[],
        type=landing_arg,
        metavar="repo:path",
        help="worktree を持つ着地面ごとに 1 つ（worktree root）",
    )
    parser.add_argument(
        "--no-worktree",
        action="append",
        default=[],
        metavar="repo",
        help="worktree を持たない着地面ごとに 1 つ（面の名前だけ）",
    )
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


def require_coverage(parser, name, values, negatives, args):
    """**着地面ごとに有無をちょうど 1 回宣言させる。**

    `--<name> <repo>:<値>` か `--no-<name> <repo>` のどちらかを、全着地面ぶん。

    **1 面でも省略を許さない。**省略された面の状態は指紋へ入らないので、**その面で進んだ周と
    何も無い周が同値**になる。面ごとに `absent` を正常な観測値として符号化できることが、
    claim の途中失敗や部分的な片付けからの復旧に要る —— そこで観測の失敗に倒すと、照合が
    通らないまま起こし直しにも片付けにも到達しない。
    """
    for _, value in values:
        require_value(parser, name, value)
    for repo in negatives:
        require_value(parser, "no-" + name, repo)

    landing = [repo for repo, _ in args.landing]
    declared = [repo for repo, _ in values] + list(negatives)
    if len(set(declared)) != len(declared):
        parser.error("{} の有無を 2 回宣言している面がある".format(name))

    missing = sorted(set(landing) - set(declared))
    if missing:
        parser.error("{} の有無が宣言されていない面: {}".format(name, ", ".join(missing)))
    unknown = sorted(set(declared) - set(landing))
    if unknown:
        parser.error("--landing に無い面の {} を宣言している: {}".format(name, ", ".join(unknown)))


def forbid(parser, kind, **values):
    """その周では渡してはいけない引数を弾く。

    **truthiness で判定しない** —— 空文字が「渡していない」に化け、`--repo ""` を付けた
    呼び出しが付けていない呼び出しと同じ指紋になる。渡していないことを表すのは、文字列の
    `None`・flag の `False`・繰り返し引数の `[]` の 3 つだけ。
    """
    for name, value in sorted(values.items()):
        if value is not None and value is not False and value != []:
            parser.error("--{} は{}の周では渡さない".format(name.replace("_", "-"), kind))


def parse_args(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    require_value(parser, "ledger", args.ledger)
    args.kind = "plan" if args.ledger == "未計画" else "resolve"

    if args.kind == "resolve":
        forbid(parser, "解決", issue_body=args.issue_body)
        require_value(parser, "progress", args.progress)
        require_value(parser, "host", args.host)
        if not args.host:
            parser.error("--host が要る")
        if not args.landing:
            parser.error("--landing が 1 つ以上要る")
        names = [repo for repo, _ in args.landing]
        if len(set(names)) != len(names):
            parser.error("--landing の面が重複している")
        if args.progress is None:
            parser.error("--progress が要る")
        require_coverage(parser, "branch", args.branch, args.no_branch, args)
        require_coverage(parser, "worktree", args.worktree, args.no_worktree, args)
        # **worktree があるのに branch が無い面を許さない。**その面だけ branch の同一性検査が
        # 飛び、別課題の worktree や detached HEAD をこの課題の成果として符号化できる。
        with_worktree = set(repo for repo, _ in args.worktree)
        without_branch = set(args.no_branch)
        both = sorted(with_worktree & without_branch)
        if both:
            parser.error("worktree があるのに branch が無い面: {}".format(", ".join(both)))
        require_pair(parser, "plan-comment", args.plan_comment, args.no_plan_comment)

        # 並べ替えを実装が持つ（呼び出し側の順序で指紋が動かない）。
        args.landing = sorted(args.landing)
        args.worktree = dict(args.worktree)
        args.branch = dict(args.branch)
    else:
        forbid(
            parser,
            "計画",
            landing=args.landing,
            progress=args.progress,
            host=args.host,
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
