#!/usr/bin/env python3
# `cycle-mark.py` の検査。**固定入力に対する既知の期待値で判定する。**
#
#   agents/skills/conductor/scripts/cycle-mark.test.py [検査するスクリプトの path]
#
# path を渡せるのは、**故意に壊した写しへ同じ検査を当てるため**（下の変異の一覧）。
#
# **独立に 2 回実行して一致することは受入にしない** —— 同じ誤りを持つ同じ実装は常に一致する。
# 代わりに 4 つを重ねる。
#
#   1. **独立に組み立てた期待値**（下の `ref_digest`）。レコードの名前・順序・framing を
#      仕様から書き直して突き合わせる。材料はこちらが書いた中身と `git rev-parse` だけなので、
#      期待値は `cycle-mark.py` の出力を写していない
#   2. **凍結した定数**（`FROZEN_*`）。1 の参照実装ごと書き換える変更を止める
#   3. **分離**。成果に当たる成分を 1 つ変えた観測が、必ず別の指紋になること
#   4. **不変性**。locale・カレントディレクトリ・利用者の git 設定・index の鮮度・filter を
#      変えても値が動かないこと
#
# **git のバージョンに依存する期待値は無い。**材料は `status --porcelain=v1`（git が安定を
# 明示している形式）とこちらが書いた中身だけで、`git diff` のテキストは入らない。
#
# **落ちない検査は残さない。**スクリプトを故意に壊して落ちることを実測済み（28 通りのうち
# 25）—— `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_COUNT` / `GIT_CONFIG_PARAMETERS` の無効化を外す、
# `--untracked-files` / `--ignore-submodules` の固定を外す、並びを locale 依存にする、symlink を
# 辿る、長さ前置きと長さの検算を外す、`-source` / `-status` / `-index` / `head-source` /
# `schema` / `cycle-kind` を落とす、path をレコード名へ埋める、tracked と untracked の名前を
# 混ぜる、実行ビットの区別を落とす、種別を畳む、観測の失敗を空へ畳む、空文字を「無い」へ畳む、
# 禁止引数を truthiness で判定する、submodule を directory へ畳む、untracked の消失を吸う、
# HEAD の再確認を外す、`--repo` の検証を外す。
#
# **押さえていないのは「その状況を作れないもの」だけ**（黙って落とさない）。競合を検出する
# 分岐そのものは `test_fail_closed_branches` が直接呼んで押さえてある —— **「競合の再現」と
# 「競合を検出する分岐の検査」を分ける。**
#
#   - 読んでいる最中に大きさが変わる file / 列挙された untracked が消える競合 / 観測の途中で
#     HEAD が動く競合 / 予期しない rename・copy —— **実 race は検査から作れない**
#     （分岐はどれも押さえてある）
#   - `GIT_DEADLINE` の値 —— 打ち切る仕組みは押さえてある（`test_fail_closed_branches` が
#     実際に止まる `status` を 2 秒で切る）。**定数そのものは検査が上書きするので効かない**
#   - `core.fsmonitor=false` / `core.untrackedCache=false` / `GIT_ATTR_NOSYSTEM` —— pin して
#     あるが、stale な hook・cache や system の attributes file を検査から作れない
#     （後者には root が要る）
#
# **仕組みとして塞いでいないものが 3 つある。**
#
#   - `skip-worktree` / `assume-unchanged` —— **git 自身が見ない**ので `status` にも出ない。
#     塞ぐには全 tracked を毎周読むしかなく、費用が釣り合わない。実装と規約に既知の穴として
#     書いてある
#   - **untracked な nested repository の中身** —— git が `nested/` の 1 件に畳む。畳むのは
#     判断（理由は下の `test_special_kinds`）で、規約の「見えないもの」にも書いてある
#   - **観測の途中で書かれた成果** —— commit だけは前後の HEAD で閉じてあるが、index と
#     worktree の残りは開いたまま。撮り直しても窓は縮むだけで消えない（規約に明記）

import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "cycle-mark.py")

SCHEMA = "cycle-mark/2"

# 検査の既定の面名。**path とは別の値にする** —— 同じ文字列だと、名前を落とす変異が通る。
# **実在の repo 名を書かない**（この repo は public。規約は `AGENTS.md`）。
PLANE = "example/control"

# **参照実装ごと書き換える変更を止めるための凍結値。**どちらも git を見ない周なので、
# 環境が変わっても動かない。**符号化を意図して変えたときだけ更新する。**
FROZEN_NO_ENTITY = "21146d7b47d7f821671732848c8c21ffc8b9a12f06fbde71be57d83455cfe12e"
FROZEN_PLAN = "8befecefc81557f6d0ef5c69768c12eb0a229784135b832473d180d2a1665cba"

FAILURES = []
CHECKS = [0]


def check(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILURES.append("{}\n    got : {!r}\n    want: {!r}".format(label, got, want))


def check_distinct(label, values):
    CHECKS[0] += 1
    seen = {}
    for name, value in values:
        if value in seen:
            FAILURES.append("{}: {} と {} が同じ指紋 ({})".format(label, seen[value], name, value))
            return
        seen[value] = name


# ---------------------------------------------------------------- 独立の期待値


def ref_digest(records):
    """仕様から書き直した符号化。**`cycle-mark.py` を読まずに組み立てる。**

    各レコードは `<名前>\\n<バイト長>\\n<中身>\\n`。長さは生バイト数。
    """
    digest = hashlib.sha256()
    for name, content in records:
        digest.update(name.encode("ascii"))
        digest.update(b"\n")
        digest.update(str(len(content)).encode("ascii"))
        digest.update(b"\n")
        digest.update(content)
        digest.update(b"\n")
    return digest.hexdigest()


def utf8(value):
    return value.encode("utf-8")


def ref_resolve(progress, planes, plan_comment, wait_record):
    """解決の周の期待レコード列。

    `planes` は `(repo, head_source, head, tracked, untracked)` の並び。`tracked` / `untracked`
    は `None`（worktree 無し）か `(path, kind, body)` の並び。**並びはこちらで面の名前の昇順・
    生バイト昇順に揃えて渡す**（実装の並べ替えを写さない）。
    """
    records = [
        ("schema", utf8(SCHEMA)),
        ("cycle-kind", utf8("resolve")),
        ("progress", utf8(progress)),
    ]
    for repo, head_source, head, tracked, untracked in planes:
        records.append(("landing", utf8(repo)))
        records.append(("head-source", utf8(head_source)))
        records.append(("head", utf8(head)))
        records += ref_entries("tracked", tracked)
        records += ref_entries("untracked", untracked)
    records += ref_optional("plan-comment", plan_comment)
    records += ref_optional("wait-record", wait_record)
    return ref_digest(records)


def ref_one(progress, head_source, head, tracked, untracked, plan_comment, wait_record):
    """1 面だけの解決の周（既定の面名を使う）。"""
    return ref_resolve(progress, [(PLANE, head_source, head, tracked, untracked)], plan_comment, wait_record)


def ref_entries(prefix, entries):
    """`tracked` は `(path, status, index, kind, body)`、`untracked` は `(path, kind, body)`。"""
    if entries is None:
        return [(prefix + "-source", utf8("absent"))]
    records = [(prefix + "-source", utf8("worktree"))]
    for entry in entries:
        records.append((prefix + "-path", entry[0]))
        if len(entry) == 5:
            records.append((prefix + "-status", utf8(entry[1])))
            records.append((prefix + "-index", entry[2]))
        records.append((prefix + "-kind", utf8(entry[-2])))
        records.append((prefix + "-body", entry[-1]))
    return records


def index_meta(repo, path, mode=b"100644"):
    """index の `<mode> <oid> <stage>`。oid は `rev-parse :<path>` で独立に引く。"""
    oid = git(repo, "rev-parse", ":" + path).decode().strip().encode("ascii")
    return mode + b" " + oid + b" 0"


def ref_plan(ledger, issues, wait_record):
    records = [("schema", utf8(SCHEMA)), ("cycle-kind", utf8("plan")), ("ledger", utf8(ledger))]
    for number, body in sorted(issues, key=lambda pair: pair[0]):
        records.append(("issue-number", utf8(str(number))))
        records.append(("issue-body", body))
    records += ref_optional("wait-record", wait_record)
    return ref_digest(records)


def ref_optional(name, content):
    if content is None:
        return [(name + "-source", utf8("absent")), (name, b"")]
    return [(name + "-source", utf8("present")), (name, content)]


# ---------------------------------------------------------------- 実行


CLEAN_GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "cycle-mark",
    "GIT_AUTHOR_EMAIL": "cycle-mark@example.invalid",
    "GIT_AUTHOR_DATE": "@1700000000 +0000",
    "GIT_COMMITTER_NAME": "cycle-mark",
    "GIT_COMMITTER_EMAIL": "cycle-mark@example.invalid",
    "GIT_COMMITTER_DATE": "@1700000000 +0000",
}


def git(cwd, *args):
    # **周りの git 環境を持ち込まない。**commit hook の下では `GIT_DIR` / `GIT_INDEX_FILE` が
    # 立っているので、そのまま渡すと `-C` を無視して**実 repo が fixture として使われる**
    # （`init` が再初期化に、`add` と `commit` が実 repo の index への書き込みになる）。
    # **allowlist にしない** —— git が変数を増やすたびに漏れる。
    env = dict((k, v) for k, v in os.environ.items() if not k.startswith("GIT_"))
    env.update(CLEAN_GIT_ENV)
    proc = subprocess.run(
        ["git", "-C", cwd, "-c", "commit.gpgsign=false", "-c", "gc.auto=0"] + list(args),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    if proc.returncode != 0:
        raise SystemExit("fixture の git が落ちた: git {}\n{}".format(" ".join(args), proc.stderr.decode()))
    return proc.stdout


def mark(argv, env_extra=None, cwd=None, expect_ok=True):
    """スクリプトを回して stdout を返す。"""
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    # **止まったら落とす。**FIFO を掴んで無期限に待つ壊れ方は、指紋が違うことより重い
    # （tick ごと固まる）ので、検査が待ち続けてはいけない。
    proc = subprocess.run(
        [sys.executable, SCRIPT] + argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd or os.sep,
        env=env,
        timeout=60,
    )
    out = proc.stdout.decode()
    if expect_ok:
        if proc.returncode != 0:
            raise SystemExit(
                "指紋が取れない (exit {}): {}\n{}".format(proc.returncode, " ".join(argv), proc.stderr.decode())
            )
        return out.strip()
    return proc.returncode, out


# ---------------------------------------------------------------- fixture


def make_repo(root, name=None):
    """決定的な fixture repo。identity と日付を固定するので commit SHA が動かない。

    `origin` を張るのは、スクリプトが**面の名前と checkout の実体**を突き合わせるため
    （取り違えた呼び出しが正常な指紋を返さないように）。
    """
    os.makedirs(root)
    git(root, "init", "--quiet")
    git(root, "remote", "add", "origin", "https://github.com/{}.git".format(name or PLANE))
    git(root, "symbolic-ref", "HEAD", "refs/heads/main")
    write(os.path.join(root, "tracked.txt"), b"base\n")
    git(root, "add", "tracked.txt")
    git(root, "commit", "--quiet", "-m", "base")
    return git(root, "rev-parse", "HEAD").decode().strip()


def write(path, content, mode=None):
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    with open(path, "wb") as handle:
        handle.write(content)
    if mode is not None:
        os.chmod(path, mode)


def resolve_argv(repo, worktree=None, branch=None, progress="実装中", plan_comment=None, wait_record=None):
    """1 面だけの呼び出し（既定の面名を使う）。

    **worktree を渡すなら branch も要る**（スクリプトが「その worktree にこの課題の branch が
    出ているか」を検査するため）。`make_repo` の fixture は `main` を出しているので、指定が
    無ければそれを補う —— 検査したいのは branch の同一性そのものではない回で、毎回書かせない。
    """
    if worktree and branch is None:
        branch = "main"
    return multi_argv([(PLANE, repo, worktree)], branch, progress, plan_comment, wait_record)


def multi_argv(planes, branch=None, progress="実装中", plan_comment=None, wait_record=None):
    """`planes` は `(面の名前, checkout, worktree | None)` の並び。"""
    argv = ["--ledger", "進行中", "--host", "github.com", "--progress", progress]
    for name, checkout, _ in planes:
        argv += ["--landing", "{}:{}".format(name, checkout)]
    for name, _, wt in planes:
        argv += ["--worktree", "{}:{}".format(name, wt)] if wt else ["--no-worktree", name]
    for name, _, _wt in planes:
        argv += ["--branch", "{}:{}".format(name, branch)] if branch else ["--no-branch", name]
    argv += ["--plan-comment", plan_comment] if plan_comment else ["--no-plan-comment"]
    argv += ["--wait-record", wait_record] if wait_record else ["--no-wait-record"]
    return argv


# ---------------------------------------------------------------- 検査


def test_no_entity(tmp):
    """受入条件 6 —— branch も worktree も無い段階でも一意に作れる。

    git を一切見ないので、期待値は完全に独立に組み立てられる。
    """
    repo = os.path.join(tmp, "no-entity")
    make_repo(repo)
    got = mark(resolve_argv(repo))
    check("branch も worktree も無い周", got, ref_one("実装中", "absent", "", None, None, None, None))
    check("branch も worktree も無い周（凍結値）", got, FROZEN_NO_ENTITY)


def test_untracked_matrix(tmp):
    """untracked の中身が分離されること。"""
    bodies = [
        ("空文字", b""),
        ("末尾改行なし", b"a"),
        ("末尾改行あり", b"a\n"),
        ("CRLF", b"a\r\n"),
        ("日本語", "日本語\n".encode("utf-8")),
        ("NUL を含むバイナリ", b"\x00\x01\x00\xff"),
    ]
    digests = []
    for label, body in bodies:
        repo = os.path.join(tmp, "untracked-" + str(len(digests)))
        head = make_repo(repo)
        write(os.path.join(repo, "u.bin"), body)
        got = mark(resolve_argv(repo, worktree=repo))
        want = ref_one("実装中", "worktree", head, [], [(b"u.bin", "file", body)], None, None)
        check("untracked の中身: " + label, got, want)
        digests.append((label, got))
    check_distinct("untracked の中身が分離されない", digests)


def test_untracked_paths(tmp):
    """改行と非 ASCII を含む path。**path を名前に埋めない**ことがここで効く。"""
    paths = [
        ("素の名前", b"a.txt"),
        ("改行を含む", b"a\nb.txt"),
        ("非 ASCII", "日本語.txt".encode("utf-8")),
        ("紛らわしい並び", b"a\n5\n1"),
    ]
    digests = []
    for label, path in paths:
        repo = os.path.join(tmp, "path-" + str(len(digests)))
        head = make_repo(repo)
        write(os.path.join(os.fsencode(repo), path), b"same\n")
        got = mark(resolve_argv(repo, worktree=repo))
        want = ref_one("実装中", "worktree", head, [], [(path, "file", b"same\n")], None, None)
        check("untracked の path: " + label, got, want)
        digests.append((label, got))
    check_distinct("untracked の path が分離されない", digests)


def test_untracked_kinds(tmp):
    """同じ内容の通常ファイル / symlink / 実行ビット付きが分離されること。"""
    variants = []
    for label, kind, setup in (
        ("通常ファイル", "file", lambda p: write(p, b"target\n")),
        ("実行ビット付き", "executable-file", lambda p: write(p, b"target\n", mode=0o755)),
        ("symlink", "symlink", lambda p: os.symlink("target\n", p)),
    ):
        repo = os.path.join(tmp, "kind-" + kind)
        head = make_repo(repo)
        setup(os.path.join(repo, "u"))
        got = mark(resolve_argv(repo, worktree=repo))
        want = ref_one("実装中", "worktree", head, [], [(b"u", kind, b"target\n")], None, None)
        check("untracked の種別: " + label, got, want)
        variants.append((label, got))
    check_distinct("untracked の種別が分離されない", variants)


def test_untracked_nested_dir(tmp):
    """untracked なディレクトリの中身が畳まれないこと。

    `status` の既定（`normal`）は中を `dir/` の 1 行に畳むので、**中で何を書いても指紋が
    動かない**。`--untracked-files=all` で 1 file ずつ出させる。
    """
    repo = os.path.join(tmp, "untracked-dir")
    head = make_repo(repo)
    write(os.path.join(repo, "dir", "a.txt"), b"one\n")
    first = mark(resolve_argv(repo, worktree=repo))
    check(
        "untracked なディレクトリの中身",
        first,
        ref_one("実装中", "worktree", head, [], [(b"dir/a.txt", "file", b"one\n")], None, None),
    )
    write(os.path.join(repo, "dir", "b.txt"), b"two\n")
    check_distinct(
        "untracked なディレクトリの中で増やしても動かない",
        [("1 file", first), ("2 file", mark(resolve_argv(repo, worktree=repo)))],
    )


def test_untracked_order(tmp):
    """列挙順が作成順に依らないこと。並びは生バイトの昇順で固定。

    `A.txt` < `_x.txt` < `b.txt` はバイト順（0x41 / 0x5f / 0x62）で、多くの locale の
    照合順とは違う。**case だけが違う名前は使わない** —— case-insensitive な filesystem で
    同じ実体に落ち、検査したい並びが作れない。
    """
    for index, order in enumerate([[b"b.txt", b"_x.txt", b"A.txt"], [b"A.txt", b"b.txt", b"_x.txt"]]):
        repo = os.path.join(tmp, "order-" + str(index))
        head = make_repo(repo)
        for name in order:
            write(os.path.join(os.fsencode(repo), name), b"x\n")
        want = ref_one(
            "実装中",
            "worktree",
            head,
            [],
            [(b"A.txt", "file", b"x\n"), (b"_x.txt", "file", b"x\n"), (b"b.txt", "file", b"x\n")],
            None,
            None,
        )
        check("untracked の列挙順（作成順 {}）".format(index + 1), mark(resolve_argv(repo, worktree=repo)), want)


def test_tracked_matrix(tmp):
    """tracked の書き換えが中身ごと指紋に出ること。"""
    bodies = [
        ("空にした", b""),
        ("末尾改行なし", b"base"),
        ("CRLF", b"base\r\n"),
        ("日本語", "日本語\n".encode("utf-8")),
        ("NUL を含むバイナリ", b"\x00\x01\x00\xff"),
    ]
    digests = []
    for label, body in bodies:
        repo = os.path.join(tmp, "tracked-" + str(len(digests)))
        head = make_repo(repo)
        write(os.path.join(repo, "tracked.txt"), body)
        got = mark(resolve_argv(repo, worktree=repo))
        want = ref_one("実装中", "worktree", head, [(b"tracked.txt", " M", index_meta(repo, "tracked.txt"), "file", body)], [], None, None)
        check("tracked の中身: " + label, got, want)
        digests.append((label, got))
    check_distinct("tracked の中身が分離されない", digests)


def test_tracked_states(tmp):
    """削除・mode 変更・型変更・staged が、それぞれ別の状態として出ること。"""
    variants = []

    repo = os.path.join(tmp, "state-clean")
    head = make_repo(repo)
    variants.append(("変更なし", mark(resolve_argv(repo, worktree=repo))))
    check(
        "変更のない tracked は出ない",
        variants[0][1],
        ref_one("実装中", "worktree", head, [], [], None, None),
    )

    repo = os.path.join(tmp, "state-deleted")
    head = make_repo(repo)
    os.unlink(os.path.join(repo, "tracked.txt"))
    got = mark(resolve_argv(repo, worktree=repo))
    check(
        "tracked の削除",
        got,
        ref_one("実装中", "worktree", head, [(b"tracked.txt", " D", index_meta(repo, "tracked.txt"), "absent", b"")], [], None, None),
    )
    variants.append(("削除", got))

    repo = os.path.join(tmp, "state-mode")
    head = make_repo(repo)
    os.chmod(os.path.join(repo, "tracked.txt"), 0o755)
    got = mark(resolve_argv(repo, worktree=repo))
    check(
        "tracked の mode 変更（中身は同じ）",
        got,
        ref_one("実装中", "worktree", head, [(b"tracked.txt", " M", index_meta(repo, "tracked.txt"), "executable-file", b"base\n")], [], None, None),
    )
    variants.append(("mode 変更", got))

    repo = os.path.join(tmp, "state-type")
    head = make_repo(repo)
    os.unlink(os.path.join(repo, "tracked.txt"))
    os.symlink("base\n", os.path.join(repo, "tracked.txt"))
    got = mark(resolve_argv(repo, worktree=repo))
    check(
        "tracked が symlink に変わった",
        got,
        ref_one("実装中", "worktree", head, [(b"tracked.txt", " T", index_meta(repo, "tracked.txt"), "symlink", b"base\n")], [], None, None),
    )
    variants.append(("型変更", got))

    repo = os.path.join(tmp, "state-staged")
    head = make_repo(repo)
    write(os.path.join(repo, "added.txt"), b"new\n")
    git(repo, "add", "added.txt")
    got = mark(resolve_argv(repo, worktree=repo))
    check(
        "staged な追加",
        got,
        ref_one("実装中", "worktree", head, [(b"added.txt", "A ", index_meta(repo, "added.txt"), "file", b"new\n")], [], None, None),
    )
    variants.append(("staged な追加", got))

    check_distinct("tracked の状態が分離されない", variants)


def test_special_kinds(tmp):
    """通常ファイルでも symlink でもない entry が、種別として残ること。

    **読みにいかないことも確かめている** —— FIFO は開いた時点で止まるので、混ぜて読むと
    tick ごと固まる。
    """
    # ネストした git repo は `nested/` という path で untracked に出る（中身は展開されない）。
    #
    # **中は畳む**（tracked の submodule は落とすのと非対称）。あちらは記録された状態の一部で
    # tip が成果そのものだが、こちらは課題の成果物ではない外部の物体で、落とすと迷い込んだ
    # clone 1 つで健全な課題の照合が毎周止まる。
    repo = os.path.join(tmp, "nested-repo")
    head = make_repo(repo)
    inner = os.path.join(repo, "nested")
    make_repo(inner)
    check(
        "untracked のネストした repo",
        mark(resolve_argv(repo, worktree=repo)),
        ref_one("実装中", "worktree", head, [], [(b"nested/", "directory", b"")], None, None),
    )

    # tracked が FIFO に化けると diff-index は M で返す。
    repo = os.path.join(tmp, "tracked-fifo")
    head = make_repo(repo)
    path = os.path.join(repo, "tracked.txt")
    os.unlink(path)
    os.mkfifo(path)
    as_fifo = mark(resolve_argv(repo, worktree=repo))
    check(
        "tracked が FIFO に化けた",
        as_fifo,
        ref_one("実装中", "worktree", head, [(b"tracked.txt", " M", index_meta(repo, "tracked.txt"), "fifo", b"")], [], None, None),
    )

    repo = os.path.join(tmp, "tracked-empty")
    head = make_repo(repo)
    write(os.path.join(repo, "tracked.txt"), b"")
    check_distinct(
        "FIFO と空ファイルが分離されない",
        [("FIFO", as_fifo), ("空ファイル", mark(resolve_argv(repo, worktree=repo)))],
    )


def test_stale_index(tmp):
    """index の鮮度で値が動かないこと。

    **これは characterization test。**`status` は中身で比べるので、この性質は材料の選び方から
    自動的に従い、1 行の書き換えでは壊せない（`diff-index --raw` のような stat 依存の材料へ
    戻すしかない）。それでも残すのは、**材料を選び直すときに最初に落ちる場所**だから ——
    stat 依存へ戻すと、誰かが index を refresh しただけの周に成果があったことになる。
    """
    repo = os.path.join(tmp, "stale")
    make_repo(repo)
    baseline = mark(resolve_argv(repo, worktree=repo))

    # 中身を変えずに stat だけ動かす。
    path = os.path.join(repo, "tracked.txt")
    write(path, b"base\n")
    os.utime(path, (1700000042, 1700000042))
    check("index が古くても値が動かない", mark(resolve_argv(repo, worktree=repo)), baseline)


def test_optional_files(tmp):
    """在ると無いが分離されること —— **空の file と `--no-*` を同じ値にしない。**"""
    repo = os.path.join(tmp, "optional")
    head = make_repo(repo)
    empty = os.path.join(tmp, "empty")
    filled = os.path.join(tmp, "filled")
    write(empty, b"")
    body = "<!-- plan -->\n本文\n".encode("utf-8")
    write(filled, body)

    cases = [
        ("計画コメント無し", resolve_argv(repo, worktree=repo), None, None),
        ("計画コメントが空", resolve_argv(repo, worktree=repo, plan_comment=empty), b"", None),
        ("計画コメントあり", resolve_argv(repo, worktree=repo, plan_comment=filled), body, None),
        ("人待ちの記録が空", resolve_argv(repo, worktree=repo, wait_record=empty), None, b""),
        ("人待ちの記録あり", resolve_argv(repo, worktree=repo, wait_record=filled), None, body),
    ]
    digests = []
    for label, argv, plan_comment, wait_record in cases:
        got = mark(argv)
        want = ref_one("実装中", "worktree", head, [], [], plan_comment, wait_record)
        check(label, got, want)
        digests.append((label, got))
    check_distinct("在ると無いが分離されない", digests)


def test_head_sources(tmp):
    """head をどこで撮ったかが分離されること。"""
    repo = os.path.join(tmp, "head")
    head = make_repo(repo)
    branch = "fix/1-x"
    git(repo, "update-ref", "refs/remotes/origin/" + branch, head)
    # **worktree にはその課題の branch を出す。**実運用では claim が `-b <名>` で作るので常にそう
    # なる。別の branch が出ている worktree は、別の課題の成果を符号化しうるので観測失敗にしてある。
    git(repo, "checkout", "--quiet", "-b", branch)

    from_worktree = mark(resolve_argv(repo, worktree=repo, branch=branch))
    check(
        "head を worktree で撮る",
        from_worktree,
        ref_one("実装中", "worktree", head, [], [], None, None),
    )

    # remote にしか無い branch は remote から撮る（ローカルがあればそちらが勝つのは
    # `test_local_branch_head` が押さえている）。
    remote_only = "fix/1-r"
    git(repo, "update-ref", "refs/remotes/origin/" + remote_only, head)
    from_branch = mark(resolve_argv(repo, branch=remote_only))
    check(
        "head を remote branch で撮る",
        from_branch,
        ref_one("実装中", "remote-branch", head, None, None, None, None),
    )

    absent = mark(resolve_argv(repo))
    check_distinct(
        "head の出どころが分離されない",
        [("worktree", from_worktree), ("remote-branch", from_branch), ("absent", absent)],
    )

    # **別の branch が出ている worktree を通さない。**同じ repo の別 worktree は common dir が
    # 一致するので、通すと**別の課題の HEAD と dirty をこの課題の成果として符号化**できる。
    git(repo, "checkout", "--quiet", "main")
    wrong = mark(resolve_argv(repo, worktree=repo, branch=branch), expect_ok=False)
    check("課題の branch でない worktree が通る", wrong[0], 1)
    # detached HEAD も同じ（何の branch を見ているか決まらない）。
    git(repo, "checkout", "--quiet", "--detach")
    detached = mark(resolve_argv(repo, worktree=repo, branch=branch), expect_ok=False)
    check("detached HEAD の worktree が通る", detached[0], 1)
    git(repo, "checkout", "--quiet", branch)


def test_local_branch_head(tmp):
    """**ローカルにしか無い branch の head が撮れること。**

    着地面の branch は push を要求しない（`landing-surface.md`）。remote だけを見ていた実装は
    ここで観測の失敗になり、その面の周は毎回照合へ到達できなかった。**修正前に落ちることを
    実測済み**（`rev-parse --verify refs/remotes/origin/<branch>` が 128 で終わる）。
    """
    repo = os.path.join(tmp, "local-branch")
    head = make_repo(repo)
    branch = "fix/1-local-only"
    git(repo, "branch", branch)

    local = mark(multi_argv([(PLANE, repo, None)], branch=branch))
    check(
        "ローカル branch から head を撮る",
        local,
        ref_one("実装中", "local-branch", head, None, None, None, None),
    )

    # remote にも同じ名前があるとき、**ローカルを採る**（成果は手元で生まれるので）。
    git(repo, "commit", "--quiet", "--allow-empty", "-m", "local ahead")
    ahead = git(repo, "rev-parse", "HEAD").decode().strip()
    git(repo, "update-ref", "refs/heads/" + branch, ahead)
    git(repo, "update-ref", "refs/remotes/origin/" + branch, head)
    both = mark(multi_argv([(PLANE, repo, None)], branch=branch))
    check(
        "ローカルと remote が食い違えばローカルを採る",
        both,
        ref_one("実装中", "local-branch", ahead, None, None, None, None),
    )
    check_distinct("ローカル branch の commit が指紋に出ない", [("before", local), ("after", both)])

    # ローカルを消せば remote へ落ちる（出どころも指紋に出る）。
    git(repo, "update-ref", "-d", "refs/heads/" + branch)
    remote_only = mark(multi_argv([(PLANE, repo, None)], branch=branch))
    check(
        "ローカルが無ければ remote から撮る",
        remote_only,
        ref_one("実装中", "remote-branch", head, None, None, None, None),
    )


def test_multiple_landing(tmp):
    """**着地面が複数あるとき、どの面の成果も指紋に出ること。**

    1 面しか見ないと、別の面で書き進んでいる周と何も書けずに止まっている周が同じ値になる。
    """
    control = os.path.join(tmp, "multi-control")
    other = os.path.join(tmp, "multi-other")
    control_head = make_repo(control, "a/control")
    other_head = make_repo(other, "b/other")
    # **worktree があるなら branch も渡す**（渡さないと branch の同一性検査を飛ばせてしまうので、
    # スクリプトが引数エラーにする）。実運用では claim が全面に同じ名前で作る。
    branch = "fix/1-multi"
    for path in (control, other):
        git(path, "checkout", "--quiet", "-b", branch)
    planes = [("a/control", control, control), ("b/other", other, other)]

    base = mark(multi_argv(planes, branch=branch))
    check(
        "2 面ぶんが面の名前の昇順で並ぶ",
        base,
        ref_resolve(
            "実装中",
            [
                ("a/control", "worktree", control_head, [], []),
                ("b/other", "worktree", other_head, [], []),
            ],
            None,
            None,
        ),
    )

    # **渡す順序で値が動かない**（並べ替えは実装が持つ）。
    check("面の順序で指紋が動く", mark(multi_argv(list(reversed(planes)), branch=branch)), base)

    # **2 面目だけを動かしても指紋が変わる。**ここが落ちると、別 repo で書き進んでいる課題が
    # 成果ゼロとして退避する。
    write(os.path.join(other, "new.txt"), b"work\n")
    moved = mark(multi_argv(planes, branch=branch))
    check_distinct("2 面目の成果が指紋に出ない", [("base", base), ("moved", moved)])

    # **面を取り違えた worktree を弾く。**面の名前だけを突き合わせると、別 repo の成果を
    # この面として符号化し、本来の面の成果は落ちる（正常な指紋を返すので気づけない）。
    swapped = mark(
        multi_argv([("a/control", control, other), ("b/other", other, control)], branch=branch),
        expect_ok=False,
    )
    check("面を取り違えた worktree が通る", swapped[0], 1)

    # **面ごとに branch の有無を分けて宣言できる。**claim の途中で失敗した課題や、片付けの途中で
    # 止まった課題は「branch のある面と無い面」が混ざる —— そこで観測の失敗に倒すと、照合が
    # 通らないまま起こし直しにも片付けにも到達しない。
    partial = mark(
        ["--ledger", "進行中", "--host", "github.com",
         "--landing", "a/control:" + control, "--landing", "b/other:" + other,
         "--progress", "実装中",
         "--branch", "a/control:" + branch, "--no-branch", "b/other",
         "--no-worktree", "a/control", "--no-worktree", "b/other",
         "--no-plan-comment", "--no-wait-record"]
    )
    check_distinct("面ごとの branch の有無が指紋に出ない", [("both", base), ("partial", partial)])

    # **面を落とすと指紋が変わる**（渡し漏れが黙って通らない）。
    dropped = mark(multi_argv(planes[:1], branch=branch))
    check_distinct("面を落としても指紋が同じ", [("both", base), ("dropped", dropped)])

    # **面の名前だけを変えても指紋が変わる**（名前を落とす実装が通らない）。名前は実体と
    # 突き合わせられるので、別名の repo を用意して比べる。
    renamed_repo = os.path.join(tmp, "multi-renamed")
    make_repo(renamed_repo, "z/renamed")
    git(renamed_repo, "checkout", "--quiet", "-b", branch)
    renamed = mark(multi_argv([("z/renamed", renamed_repo, renamed_repo)], branch=branch))
    check_distinct("面の名前が指紋に出ない", [("named", dropped), ("renamed", renamed)])

    # **名前と checkout が食い違う呼び出しを通さない。**common dir の検査は通ってしまうので、
    # 名前だけで信用すると本来の面の成果が観測から落ちる。
    mismatched = mark(
        multi_argv([("z/renamed", control, control)], branch=branch), expect_ok=False
    )
    check("面の名前と checkout の食い違いが通る", mismatched[0], 1)

    # **`insteadOf` で偽装できない。**`remote get-url` は書き換え後の URL を返すので、
    # repo-local の設定だけで別 repo を正規の面として通せてしまう（生値で照合する）。
    git(control, "config", "--local", "url.https://github.com/z/renamed.insteadOf",
        "https://github.com/a/control")
    spoofed = mark(
        multi_argv([("z/renamed", control, control)], branch=branch), expect_ok=False
    )
    check("insteadOf による面の偽装が通る", spoofed[0], 1)
    git(control, "config", "--local", "--unset",
        "url.https://github.com/z/renamed.insteadOf")

    # **origin が複数 URL なら落とす。**`--get` は最後の 1 本しか返さないので、先頭に別 repo を
    # 足して末尾に期待値を置くと検査を通ってしまう（fetch が向く先とは食い違いうる）。
    git(control, "config", "--local", "--add", "remote.origin.url",
        "https://github.com/evil/other.git")
    multi_url = mark(multi_argv([("a/control", control, control)], branch=branch), expect_ok=False)
    check("origin が複数 URL でも通る", multi_url[0], 1)
    git(control, "config", "--local", "--unset", "remote.origin.url",
        "https://github.com/evil/other.git")

    # **別 host の同名 path を通さない。**path だけを見ると `git@evil.example:a/control` が
    # 正しい面として通り、別 repo の branch と dirty をその面の成果として符号化する。
    # **面名に合う path を使う。**path が違うと path 検査が先に落ちて、host の比較まで到達しない
    # （検査が名乗った guard を実際には通らなくなる）。
    for spoof in ("git@evil.example:b/other.git", "https://evil.example/b/other.git"):
        git(other, "config", "--local", "remote.origin.url", spoof)
        wrong_host = mark(multi_argv(planes, branch=branch), expect_ok=False)
        check("別 host の同名 path が通る ({})".format(spoof), wrong_host[0], 1)
    git(other, "config", "--local", "remote.origin.url", "https://github.com/b/other.git")

    # **末尾に空の値を足しても「1 件」に見えない。**行で数えると末尾の空が落ちる。
    git(control, "config", "--local", "--add", "remote.origin.url", "")
    empty_extra = mark(multi_argv([("a/control", control, control)], branch=branch), expect_ok=False)
    check("origin に空の値を足すと通る", empty_extra[0], 1)
    git(control, "config", "--local", "--unset", "remote.origin.url", "^$")

    # **末尾一致では通さない。**`.../evil/a/control` のような URL が面 `a/control` に見える。
    git(control, "config", "--local", "remote.origin.url", "https://github.com/evil/a/control.git")
    suffix = mark(multi_argv([("a/control", control, control)], branch=branch), expect_ok=False)
    check("末尾一致の別 remote が通る", suffix[0], 1)
    git(control, "config", "--local", "remote.origin.url", "https://github.com/a/control.git")


def test_plan_cycle(tmp):
    """計画の周。git を見ないので期待値は完全に独立。"""
    body_a = os.path.join(tmp, "body_a")
    body_b = os.path.join(tmp, "body_b")
    write(body_a, "本文 A\n".encode("utf-8"))
    write(body_b, "本文 B".encode("utf-8"))

    one = mark(["--ledger", "未計画", "--issue-body", "1:" + body_a, "--no-wait-record"])
    check("計画の周（単独）", one, ref_plan("未計画", [(1, "本文 A\n".encode("utf-8"))], None))
    check("計画の周（単独・凍結値）", one, FROZEN_PLAN)

    group = ["--ledger", "未計画", "--issue-body", "2:" + body_b, "--issue-body", "1:" + body_a,
             "--no-wait-record"]
    group_reversed = ["--ledger", "未計画", "--issue-body", "1:" + body_a, "--issue-body", "2:" + body_b,
                      "--no-wait-record"]
    check(
        "計画の周（group）",
        mark(group),
        ref_plan("未計画", [(1, "本文 A\n".encode("utf-8")), (2, "本文 B".encode("utf-8"))], None),
    )
    check("計画の周は引数の順に依らない", mark(group), mark(group_reversed))

    renumbered = mark(["--ledger", "未計画", "--issue-body", "3:" + body_a, "--no-wait-record"])
    repo = os.path.join(tmp, "kind-split")
    make_repo(repo)
    check_distinct(
        "計画の周の成分が分離されない",
        [("単独", one), ("group", mark(group)), ("番号違い", renumbered), ("解決", mark(resolve_argv(repo)))],
    )


def test_component_sensitivity(tmp):
    """受入条件 3 —— 成果に当たる成分を 1 つ変えたら必ず別の指紋になる。"""
    repo = os.path.join(tmp, "sensitivity")
    make_repo(repo)
    plan_a = os.path.join(tmp, "plan-a")
    plan_b = os.path.join(tmp, "plan-b")
    write(plan_a, b"a\n")
    write(plan_b, b"b\n")

    def run(**kwargs):
        base = dict(worktree=repo, plan_comment=plan_a, wait_record=plan_a)
        base.update(kwargs)
        return mark(resolve_argv(repo, **base))

    variants = [("baseline", run())]
    variants.append(("progress", run(progress="提出中")))
    variants.append(("計画コメント", run(plan_comment=plan_b)))
    variants.append(("人待ちの記録", run(wait_record=plan_b)))

    write(os.path.join(repo, "u.txt"), b"new\n")
    variants.append(("untracked が増えた", run()))

    write(os.path.join(repo, "tracked.txt"), b"base\nmore\n")
    variants.append(("tracked を書き換えた", run()))

    git(repo, "add", "-A")
    git(repo, "commit", "--quiet", "-m", "next")
    variants.append(("commit した", run()))

    check_distinct("成分の変化が指紋に出ない", variants)


def test_binary_tracked(tmp):
    """tracked な binary の 1 バイト違いが分離されること。"""
    repo = os.path.join(tmp, "binary")
    make_repo(repo)
    write(os.path.join(repo, "b.bin"), b"\x00\x01\x02\x03")
    git(repo, "add", "b.bin")
    git(repo, "commit", "--quiet", "-m", "binary")

    digests = []
    for label, body in (("変更前", None), ("1 バイト違い", b"\x00\x01\x02\x04"), ("別の 1 バイト違い", b"\x00\x01\x02\x05")):
        if body is not None:
            write(os.path.join(repo, "b.bin"), body)
        digests.append((label, mark(resolve_argv(repo, worktree=repo))))
    check_distinct("binary の書き換えが指紋に出ない", digests)


def test_ignored_not_counted(tmp):
    """ignore 対象を untracked に混ぜないこと。"""
    repo = os.path.join(tmp, "ignored")
    make_repo(repo)
    write(os.path.join(repo, ".gitignore"), b"build/\n")
    git(repo, "add", ".gitignore")
    git(repo, "commit", "--quiet", "-m", "ignore")

    before = mark(resolve_argv(repo, worktree=repo))
    write(os.path.join(repo, "build", "out.bin"), b"noise\n")
    check("ignore 対象が指紋を動かす", mark(resolve_argv(repo, worktree=repo)), before)


def test_fixture_env_isolation(tmp):
    """**fixture 自身が周りの git 環境から隔離されていること。**

    commit hook の下では `GIT_DIR` などが立っている。持ち込むと `-C` が無視され、
    **実 repo が fixture として使われる** —— 落ちれば運が良く、通れば実 repo の index が
    書き換わる。ここが守っているのは指紋ではなく、検査を回すこと自体の安全。
    """
    baseline = make_repo(os.path.join(tmp, "iso-baseline"))
    leaked = {
        "GIT_DIR": os.path.join(tmp, "iso-baseline", ".git"),
        "GIT_WORK_TREE": os.path.join(tmp, "iso-baseline"),
        "GIT_INDEX_FILE": os.path.join(tmp, "iso-baseline", ".git", "index"),
    }
    saved = dict((k, os.environ.get(k)) for k in leaked)
    os.environ.update(leaked)
    try:
        check("fixture の隔離: 別 repo が作れる", make_repo(os.path.join(tmp, "iso-leaked")), baseline)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_env_invariance(tmp):
    """受入条件 2 —— 実行環境で値が動かないこと。"""
    repo = os.path.join(tmp, "env")
    make_repo(repo)
    write(os.path.join(repo, "日本語.txt"), b"orig\n")
    git(repo, "add", "日本語.txt")
    git(repo, "commit", "--quiet", "-m", "non-ascii")
    write(os.path.join(repo, "tracked.txt"), b"base\nchanged\n")
    write(os.path.join(repo, "日本語.txt"), b"orig\nchanged\n")
    write(os.path.join(repo, "ä.txt"), b"untracked\n")
    write(os.path.join(repo, "z.txt"), b"untracked\n")

    argv = resolve_argv(repo, worktree=repo)
    baseline = mark(argv)

    # **untracked を握りつぶす設定を注入する。**効いてしまえば `ä.txt` と `z.txt` が消えて
    # 値が動くので、無効化できていることがそのまま観測できる。
    excludes = os.path.join(tmp, "hostile.excludes")
    write(excludes, b"*.txt\n")
    hostile = os.path.join(tmp, "hostile.gitconfig")
    write(hostile, b"[core]\n\texcludesFile = " + excludes.encode("utf-8") + b"\n")

    cases = [
        ("locale", {"LC_ALL": "tr_TR.UTF-8", "LANG": "tr_TR.UTF-8"}, None),
        ("global / system の config", {"GIT_CONFIG_GLOBAL": hostile, "GIT_CONFIG_SYSTEM": hostile}, None),
        (
            "GIT_CONFIG_COUNT による注入",
            {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.excludesFile", "GIT_CONFIG_VALUE_0": excludes},
            None,
        ),
        ("GIT_CONFIG_PARAMETERS による注入", {"GIT_CONFIG_PARAMETERS": "'core.excludesFile'='" + excludes + "'"}, None),
        ("カレントディレクトリ", None, repo),
        ("GIT_DIR の漏れ", {"GIT_DIR": os.path.join(repo, ".git"), "GIT_WORK_TREE": repo}, None),
        ("pager の設定", {"GIT_PAGER": "less -R", "PAGER": "less -R"}, None),
    ]
    for label, env_extra, cwd in cases:
        check("不変性: " + label, mark(argv, env_extra=env_extra, cwd=cwd), baseline)


def test_local_config_invariance(tmp):
    """repo-local な git 設定で値が動かないこと。

    **global / system と違って repo-local は消せない**（checkout そのものの性質）。材料を
    plumbing と worktree の中身だけにしてあるので、表示系の設定も textconv も届かない ——
    porcelain の diff テキストを材料に戻すと、ここが全部効いてくる。
    """
    repo = os.path.join(tmp, "local-config")
    make_repo(repo)
    write(os.path.join(repo, "日本語.txt"), b"orig\n")
    write(os.path.join(repo, "lossy.bin"), b"K\x00\x01\x02\x03")
    write(os.path.join(repo, ".gitattributes"), b"lossy.bin diff=lossy\n")
    git(repo, "add", "日本語.txt", "lossy.bin", ".gitattributes")
    git(repo, "commit", "--quiet", "-m", "local")
    write(os.path.join(repo, "tracked.txt"), b"base\nchanged\n")
    write(os.path.join(repo, "日本語.txt"), b"orig\nchanged\n")

    argv = resolve_argv(repo, worktree=repo)
    baseline = mark(argv)

    for key, value in (
        ("core.quotePath", "false"),
        ("diff.noprefix", "true"),
        ("diff.renames", "copies"),
        ("diff.context", "9"),
        ("diff.algorithm", "histogram"),
        ("core.abbrev", "7"),
        ("color.ui", "always"),
        ("diff.lossy.textconv", "/usr/bin/head -c 1"),
    ):
        git(repo, "config", key, value)
        check("不変性: repo-local の {}".format(key), mark(argv), baseline)

    # **textconv が効いていればここで畳まれる。**先頭 1 バイトを据え置き、後ろだけを書き換える。
    write(os.path.join(repo, "lossy.bin"), b"K\x09\x08\x07\x06")
    check_distinct(
        "textconv の下で中身の変化が畳まれる",
        [("変更前", baseline), ("先頭以外を書き換えた", mark(argv))],
    )


def test_clean_filter(tmp):
    """filter 越しに clean な path が指紋に出ないこと。

    `core.autocrlf` があると worktree の生バイト（CRLF）と HEAD の blob（LF）は一致しない
    （実測）。**「変わったか」を自分で計算すると、この path が毎周 dirty に見える** ——
    誰かが index を refresh するたびに指紋が動き、成果ゼロの上限が育たない。判定は git に任せる。
    """
    repo = os.path.join(tmp, "clean-filter")
    head = make_repo(repo)
    git(repo, "config", "core.autocrlf", "true")
    write(os.path.join(repo, "crlf.txt"), b"k\n")
    git(repo, "add", "crlf.txt")
    git(repo, "commit", "--quiet", "-m", "crlf")
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    os.unlink(os.path.join(repo, "crlf.txt"))
    git(repo, "checkout", "--quiet", "--", "crlf.txt")

    with open(os.path.join(repo, "crlf.txt"), "rb") as handle:
        check("fixture: worktree は CRLF になっている", handle.read(), b"k\r\n")
    os.utime(os.path.join(repo, "crlf.txt"), (1700000042, 1700000042))
    check(
        "filter 越しに clean な path は出ない",
        mark(resolve_argv(repo, worktree=repo)),
        ref_one("実装中", "worktree", head, [], [], None, None),
    )


def test_index_only(tmp):
    """index だけが HEAD と違う周が、clean と分かれること。"""
    repo = os.path.join(tmp, "index-only")
    make_repo(repo)
    clean = mark(resolve_argv(repo, worktree=repo))

    path = os.path.join(repo, "tracked.txt")
    write(path, b"base\nstaged\n")
    git(repo, "add", "tracked.txt")
    write(path, b"base\n")  # worktree は HEAD と同じに戻す
    staged_a = mark(resolve_argv(repo, worktree=repo))

    # **index の中身まで見ていないと、ここが同じ値になる。**worktree はどちらも HEAD と
    # 同じなので、XY だけでは A と B が分かれない。
    write(path, b"base\nstaged 2\n")
    git(repo, "add", "tracked.txt")
    write(path, b"base\n")
    staged_b = mark(resolve_argv(repo, worktree=repo))

    check_distinct(
        "index だけの変更が指紋に出ない",
        [("clean", clean), ("index が A", staged_a), ("index が B", staged_b)],
    )


def test_gitlink(tmp):
    """submodule は畳まずに落ちること。

    worktree の側からはディレクトリにしか見えないので、種別だけ書くと tip が動いた周と
    動いていない周が同じ値になる。**符号化を決めていないものを黙って同値にしない。**
    """
    repo = os.path.join(tmp, "gitlink")
    make_repo(repo)
    sub = os.path.join(repo, "sub")
    sub_head = make_repo(sub)
    git(repo, "update-index", "--add", "--cacheinfo", "160000,{},sub".format(sub_head))
    git(repo, "commit", "--quiet", "-m", "gitlink")
    write(os.path.join(sub, "tracked.txt"), b"moved\n")
    git(sub, "commit", "--quiet", "-am", "move")

    code, out = mark(resolve_argv(repo, worktree=repo), expect_ok=False)
    check("失敗: submodule の終了コード", code, 1)
    check("失敗: submodule では指紋を出さない", out, "")

    # **repo-local の設定で隠させない。**`--ignore-submodules=none` を渡していないと、
    # status に出ないまま clean と同じ指紋を返す（実測）。
    for key, value in (("diff.ignoreSubmodules", "all"), ("submodule.sub.ignore", "all")):
        git(repo, "config", key, value)
        code, out = mark(resolve_argv(repo, worktree=repo), expect_ok=False)
        check("失敗: {} でも落ちる".format(key), code, 1)
        check("失敗: {} でも指紋を出さない".format(key), out, "")


def load_script():
    """検査対象を module として読み込む。**分岐を直接呼ぶため。**

    競合そのもの（読んでいる最中に大きさが変わる・列挙された untracked が消える）は検査から
    決定的に作れないが、**それを検出する分岐は作れる**。2 つを分けて、後者は押さえる。
    """
    spec = importlib.util.spec_from_file_location("cycle_mark_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fail_closed_branches(tmp):
    """競合を検出する分岐が、実際に観測の失敗を投げること。"""
    module = load_script()

    def raises(label, call):
        CHECKS[0] += 1
        try:
            call()
        except module.ObservationError:
            return
        except Exception as exc:  # noqa: BLE001 - 想定外の例外も失敗として出す
            FAILURES.append("{}: ObservationError ではなく {!r}".format(label, exc))
            return
        FAILURES.append("{}: 何も投げなかった".format(label))

    raises("流した量が宣言より少ない", lambda: module.Encoder().record_stream("body", 5, (b"ab",)))
    raises("流した量が宣言より多い", lambda: module.Encoder().record_stream("body", 1, (b"ab",)))

    repo = os.path.join(tmp, "branches")
    make_repo(repo)
    raises(
        "列挙された untracked が消えている",
        lambda: module.emit_entity(module.Encoder(), "untracked", repo, b"gone.txt", allow_absent=False),
    )

    # **止まった git を観測の失敗にする。**repo-local の clean filter で `status` は実際に
    # 止まる（実測）。止まったまま待つと exit 1 の fail-closed ではなく conductor 全体の停止に
    # なるので、ここは最も重い壊れ方。
    slow = os.path.join(tmp, "slow-filter")
    make_repo(slow)
    write(os.path.join(slow, ".gitattributes"), b"tracked.txt filter=slow\n")
    git(slow, "add", ".gitattributes")
    git(slow, "commit", "--quiet", "-m", "filter")
    git(slow, "config", "filter.slow.clean", "sleep 120; cat")
    # **大きさは変えない。**size が違うと git は filter を通さずに「変更あり」と決められる。
    write(os.path.join(slow, "tracked.txt"), b"Base\n")
    deadline = module.GIT_DEADLINE
    module.GIT_DEADLINE = 2
    try:
        started = time.time()
        raises("git が戻らない", lambda: module.status_entries(slow))
        CHECKS[0] += 1
        if time.time() - started > 30:
            FAILURES.append("git が戻らない: deadline で打ち切れていない")
    finally:
        module.GIT_DEADLINE = deadline

    # **観測の途中で HEAD が動く分岐。**実 race は作れないが、2 回目の `rev-parse HEAD` だけを
    # 差し替えれば分岐は決定的に通せる —— **いちばん効く分岐を「作れない」側へ分類しない。**
    moving = os.path.join(tmp, "moving-head")
    make_repo(moving)
    real_git = module.git
    seen = [0]

    def moving_head(cwd, *args, **kwargs):
        if args[:2] == ("rev-parse", "HEAD"):
            seen[0] += 1
            if seen[0] > 1:
                return b"0000000000000000000000000000000000000000\n"
        return real_git(cwd, *args, **kwargs)

    module.git = moving_head
    try:
        raises(
            "観測の最中に HEAD が動いた",
            lambda: module.encode_resolve(module.Encoder(), module.parse_args(resolve_argv(moving, worktree=moving))),
        )
    finally:
        module.git = real_git

    # rename / copy は `--no-renames` を渡している限り出ないので、git の出力を差し替えて
    # 分岐だけを通す。
    original = module.git
    module.git = lambda cwd, *args: b"R  old.txt\0new.txt\0"
    try:
        raises("rename / copy が出た", lambda: module.status_entries(repo))
        module.git = lambda cwd, *args: b"XX\0"
        raises("status の行が読めない", lambda: module.status_entries(repo))
        module.git = lambda cwd, *args: b"100644 abc 0 no-tab\0"
        raises("ls-files の行が読めない", lambda: module.index_entries(repo))
    finally:
        module.git = original


def test_failures(tmp):
    """受入条件 4 —— 失敗は指紋を返さない。**空へ畳まない。**"""
    repo = os.path.join(tmp, "failures")
    make_repo(repo)
    os.makedirs(os.path.join(repo, "sub"))
    plan = os.path.join(tmp, "plan")
    write(plan, b"x\n")
    not_a_repo = os.path.join(tmp, "not-a-repo")
    os.makedirs(not_a_repo)
    fifo = os.path.join(tmp, "plan.fifo")
    land = "{}:{}".format(PLANE, repo)
    os.mkfifo(fifo)

    cases = [
        # **実体を渡さない周でも着地面の checkout を確かめる。**確かめないと、存在しない
        # path を渡した周が「実体なし」の正常な指紋になる。
        ("実体なしの周で着地面が repo でない",
         multi_argv([(PLANE, not_a_repo, None)]), 1),
        # **渡された file も worktree と同じ経路で読む。**FIFO を掴んで止まると tick ごと固まる。
        ("計画コメントが FIFO", resolve_argv(repo, worktree=repo, plan_comment=fifo), 1),
        ("worktree が無い", resolve_argv(repo, worktree=os.path.join(tmp, "gone")), 1),
        ("worktree root ではない", resolve_argv(repo, worktree=os.path.join(repo, "sub")), 1),
        ("着地面の checkout が無い", multi_argv([(PLANE, os.path.join(tmp, "gone"), None)], branch="x"), 1),
        # **branch がどの面にも無ければ観測の失敗。**空へ畳むと、branch を消した周と
        # 持っていない周が同じ指紋になる。
        ("branch がどこにも無い", multi_argv([(PLANE, repo, None)], branch="fix/9-missing"), 1),
        ("計画コメントの file が無い",
         resolve_argv(repo, worktree=repo, plan_comment=os.path.join(tmp, "gone")), 1),
        # **旧 `--repo` を残さない。**argparse が unknown option で先に exit 2 するので、
        # 同じ終了コードのまま**意図した guard を 1 つも通らない**（緑のまま検査が空洞になる）。
        ("worktree の有無が宣言されていない",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch",
          "--no-plan-comment", "--no-wait-record"], 2),
        ("同じ面で worktree の有無を 2 回宣言",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--worktree", land, "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        # **1 面でも宣言を省けない。**省いた面の dirty は指紋に入らず、書き進んでいる周と
        # 成果ゼロの周が同値になる。
        ("2 面のうち 1 面だけ宣言",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--landing", "other/plane:" + repo,
          "--progress", "実装中", "--no-branch", PLANE, "--no-worktree", PLANE,
          "--no-plan-comment", "--no-wait-record"], 2),
        ("--worktree の path が空文字",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--worktree", PLANE + ":", "--no-plan-comment", "--no-wait-record"], 2),
        # **面の名前を欠いた spec を弾く。**通すと、path の先頭が面の名前として観測される。
        ("--landing に面の名前が無い",
         ["--ledger", "進行中", "--host", "github.com", "--landing", repo, "--progress", "実装中", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        # **worktree があるなら --branch が要る。**許すと branch の同一性検査を飛ばせる。
        ("worktree があるのに --no-branch",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--worktree", land, "--no-plan-comment", "--no-wait-record"], 2),
        # **branch の有無も面ごとにちょうど 1 回。**省いた面の branch は指紋に出ない。
        ("branch の有無が宣言されていない",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中",
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        # **2 回宣言を弾く guard に届かせる。**`--no-branch` を値なしで渡すと argparse が先に
        # exit 2 するので、同じ終了コードのまま guard を 1 度も通らない。
        ("同じ面で branch の有無を 2 回宣言",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中",
          "--branch", PLANE + ":main", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        ("--host が無い",
         ["--ledger", "進行中", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        ("--landing が 1 つも無い",
         ["--ledger", "進行中", "--host", "github.com", "--progress", "実装中", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        # **面の重複を弾く。**同じ面を 2 回符号化した指紋と 2 面ぶんの指紋が区別できない。
        ("--landing の面が重複", multi_argv([(PLANE, repo, None), (PLANE, repo, None)]), 2),
        # **知らない面の worktree を弾く。**通すとその面は符号化されないまま黙って落ちる。
        ("--landing に無い面の worktree を宣言",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--worktree", "other/plane:" + repo, "--no-worktree", PLANE,
          "--no-plan-comment", "--no-wait-record"], 2),
        ("--branch が空文字",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--branch", PLANE + ":",
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        ("--plan-comment が空文字",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--plan-comment", "", "--no-wait-record"], 2),
        ("--progress が空文字",
         ["--ledger", "進行中", "--host", "github.com", "--landing", land, "--progress", "", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        ("--ledger が空文字",
         ["--ledger", "", "--host", "github.com", "--landing", land, "--progress", "実装中", "--no-branch", PLANE,
          "--no-worktree", PLANE, "--no-plan-comment", "--no-wait-record"], 2),
        ("解決の周に --issue-body", resolve_argv(repo, worktree=repo) + ["--issue-body", "1:" + plan], 2),
        ("計画の周に --landing", ["--ledger", "未計画", "--landing", land, "--issue-body", "1:" + plan,
                                 "--no-wait-record"], 2),
        # **空文字の禁止引数も弾く。**truthiness で判定すると「渡していない」に化ける。
        # ここは形の整った値を渡す —— 壊れた値だと型変換が先に落ち、`forbid` を 1 度も通らない。
        ("計画の周に --worktree", ["--ledger", "未計画", "--worktree", land, "--issue-body", "1:" + plan,
                                  "--no-wait-record"], 2),
        ("計画の周に --no-worktree", ["--ledger", "未計画", "--no-worktree", PLANE, "--issue-body", "1:" + plan,
                                     "--no-wait-record"], 2),
        ("計画の周に空の --progress", ["--ledger", "未計画", "--progress", "", "--issue-body", "1:" + plan,
                                     "--no-wait-record"], 2),
        ("計画の周に --issue-body が無い", ["--ledger", "未計画", "--no-wait-record"], 2),
        ("--issue-body の番号が重複",
         ["--ledger", "未計画", "--issue-body", "1:" + plan, "--issue-body", "1:" + plan,
          "--no-wait-record"], 2),
        ("--issue-body の file が空", ["--ledger", "未計画", "--issue-body", "1:", "--no-wait-record"], 2),
        ("--wait-record の指定が無い", ["--ledger", "未計画", "--issue-body", "1:" + plan], 2),
    ]
    for label, argv, want_code in cases:
        code, out = mark(argv, expect_ok=False)
        check("失敗: {} の終了コード".format(label), code, want_code)
        check("失敗: {} は指紋を出さない".format(label), out, "")

    if os.geteuid() != 0:
        unreadable = os.path.join(repo, "locked.txt")
        write(unreadable, b"secret\n", mode=0o000)
        code, out = mark(resolve_argv(repo, worktree=repo), expect_ok=False)
        check("失敗: 読めない untracked の終了コード", code, 1)
        check("失敗: 読めない untracked は指紋を出さない", out, "")
        os.chmod(unreadable, 0o644)


def main():
    if not os.path.exists(SCRIPT):
        raise SystemExit("検査するスクリプトが無い: {}".format(SCRIPT))
    tmp = tempfile.mkdtemp(prefix="cycle-mark-test-")
    try:
        for test in (
            test_no_entity,
            test_untracked_matrix,
            test_untracked_paths,
            test_untracked_kinds,
            test_untracked_nested_dir,
            test_untracked_order,
            test_tracked_matrix,
            test_tracked_states,
            test_special_kinds,
            test_stale_index,
            test_optional_files,
            test_head_sources,
            test_local_branch_head,
            test_multiple_landing,
            test_plan_cycle,
            test_component_sensitivity,
            test_binary_tracked,
            test_ignored_not_counted,
            test_clean_filter,
            test_index_only,
            test_gitlink,
            test_fixture_env_isolation,
            test_env_invariance,
            test_local_config_invariance,
            test_fail_closed_branches,
            test_failures,
        ):
            test(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if FAILURES:
        sys.stderr.write("\n".join(FAILURES) + "\n")
        sys.stderr.write("\n{} 件の検査のうち {} 件が落ちた\n".format(CHECKS[0], len(FAILURES)))
        return 1
    sys.stdout.write("{} 件すべて pass\n".format(CHECKS[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
