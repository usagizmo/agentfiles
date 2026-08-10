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
#   4. **不変性**。locale・カレントディレクトリ・利用者の git 設定・index の鮮度を変えても
#      値が動かないこと
#
# **git のバージョンに依存する期待値は無い。**材料は plumbing（`diff-index --raw -z`）と
# こちらが書いた中身だけで、porcelain の diff テキストは入らない。
#
# **落ちない検査は残さない。**スクリプトを故意に壊して落ちることを実測済み（20 通りのうち
# 18）—— `--exclude-standard` / `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_COUNT` / `GIT_CONFIG_PARAMETERS`
# の無効化 / blob id による候補の確認を外す、並びを locale 依存にする、symlink を辿る、
# 長さ前置きを外す、`-source` を落とす、path をレコード名へ埋める、tracked と untracked の
# 名前を混ぜる、実行ビットの区別を落とす、種別を畳む、`head-source` を潰す、`schema` /
# `cycle-kind` を落とす、観測の失敗を空へ畳む、空文字を「無い」へ畳む。
#
# **押さえていないものが 4 つある**（黙って落とさない）。
#
#   - `--no-renames` —— plumbing は `-M` を渡さない限り rename を検出しないので、検査から
#     rename entry を作れない。代わりに parser 側で R / C を観測の失敗にしてある
#   - **列挙された untracked が消える競合** —— `ls-files` と `lstat` の間で消す必要があり、
#     検査から再現できない
#   - `GIT_ATTR_NOSYSTEM` —— system の attributes file を作るには root が要る。global 側は
#     `GIT_CONFIG_GLOBAL` の検査が押さえているので、外れても同じ形の穴だけが残る
#   - `LC_ALL` / `LANG` —— **そもそも指紋に効かない**。並びは Python 側で生バイト昇順に
#     取り直し、材料は plumbing なので、揃えているのは失敗したときの stderr の言語だけ

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "cycle-mark.py")

SCHEMA = "cycle-mark/1"

# **参照実装ごと書き換える変更を止めるための凍結値。**どちらも git を見ない周なので、
# 環境が変わっても動かない。**符号化を意図して変えたときだけ更新する。**
FROZEN_NO_ENTITY = "a993d04251626a6686a94420767fa9630a227f601091d7e153ad0e9fac67e54a"
FROZEN_PLAN = "db95fd304fbda3b98ecf57090207c433c4fd0eaa30d2025f915d6ef7e79b8bbb"

FAILURES = []
CHECKS = [0]
NOTES = []


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


def ref_resolve(progress, head_source, head, tracked, untracked, plan_comment, wait_record):
    """解決の周の期待レコード列。

    `tracked` / `untracked` は `None`（worktree 無し）か `(path, kind, body)` の並び。
    **並びはこちらで生バイト昇順に揃えて渡す**（実装の並べ替えを写さない）。
    """
    records = [
        ("schema", utf8(SCHEMA)),
        ("cycle-kind", utf8("resolve")),
        ("progress", utf8(progress)),
        ("head-source", utf8(head_source)),
        ("head", utf8(head)),
    ]
    records += ref_entries("tracked", tracked)
    records += ref_entries("untracked", untracked)
    records += ref_optional("plan-comment", plan_comment)
    records += ref_optional("wait-record", wait_record)
    return ref_digest(records)


def ref_entries(prefix, entries):
    if entries is None:
        return [(prefix + "-source", utf8("absent"))]
    records = [(prefix + "-source", utf8("worktree"))]
    for path, kind, body in entries:
        records.append((prefix + "-path", path))
        records.append((prefix + "-kind", utf8(kind)))
        records.append((prefix + "-body", body))
    return records


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
    env = os.environ.copy()
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
    proc = subprocess.run(
        [sys.executable, SCRIPT] + argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd or os.sep,
        env=env,
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


def make_repo(root):
    """決定的な fixture repo。identity と日付を固定するので commit SHA が動かない。"""
    os.makedirs(root)
    git(root, "init", "--quiet")
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
    argv = ["--ledger", "進行中", "--repo", repo, "--progress", progress]
    argv += ["--worktree", worktree] if worktree else ["--no-worktree"]
    argv += ["--branch", branch] if branch else ["--no-branch"]
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
    check("branch も worktree も無い周", got, ref_resolve("実装中", "absent", "", None, None, None, None))
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
        want = ref_resolve("実装中", "worktree", head, [], [(b"u.bin", "file", body)], None, None)
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
        want = ref_resolve("実装中", "worktree", head, [], [(path, "file", b"same\n")], None, None)
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
        want = ref_resolve("実装中", "worktree", head, [], [(b"u", kind, b"target\n")], None, None)
        check("untracked の種別: " + label, got, want)
        variants.append((label, got))
    check_distinct("untracked の種別が分離されない", variants)


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
        want = ref_resolve(
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
        want = ref_resolve("実装中", "worktree", head, [(b"tracked.txt", "file", body)], [], None, None)
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
        ref_resolve("実装中", "worktree", head, [], [], None, None),
    )

    repo = os.path.join(tmp, "state-deleted")
    head = make_repo(repo)
    os.unlink(os.path.join(repo, "tracked.txt"))
    got = mark(resolve_argv(repo, worktree=repo))
    check(
        "tracked の削除",
        got,
        ref_resolve("実装中", "worktree", head, [(b"tracked.txt", "absent", b"")], [], None, None),
    )
    variants.append(("削除", got))

    repo = os.path.join(tmp, "state-mode")
    head = make_repo(repo)
    os.chmod(os.path.join(repo, "tracked.txt"), 0o755)
    got = mark(resolve_argv(repo, worktree=repo))
    check(
        "tracked の mode 変更（中身は同じ）",
        got,
        ref_resolve("実装中", "worktree", head, [(b"tracked.txt", "executable-file", b"base\n")], [], None, None),
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
        ref_resolve("実装中", "worktree", head, [(b"tracked.txt", "symlink", b"base\n")], [], None, None),
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
        ref_resolve("実装中", "worktree", head, [(b"added.txt", "file", b"new\n")], [], None, None),
    )
    variants.append(("staged な追加", got))

    check_distinct("tracked の状態が分離されない", variants)


def test_special_kinds(tmp):
    """通常ファイルでも symlink でもない entry が、種別として残ること。

    **読みにいかないことも確かめている** —— FIFO は開いた時点で止まるので、混ぜて読むと
    tick ごと固まる。
    """
    # ネストした git repo は `nested/` という path で untracked に出る（中身は展開されない）。
    repo = os.path.join(tmp, "nested-repo")
    head = make_repo(repo)
    inner = os.path.join(repo, "nested")
    make_repo(inner)
    check(
        "untracked のネストした repo",
        mark(resolve_argv(repo, worktree=repo)),
        ref_resolve("実装中", "worktree", head, [], [(b"nested/", "directory", b"")], None, None),
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
        ref_resolve("実装中", "worktree", head, [(b"tracked.txt", "fifo", b"")], [], None, None),
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

    `diff-index` は stat が古いと中身の同じ path も変更として返す。**`update-index --refresh`
    は index を書くので観測が副作用を持つ** —— 代わりに blob id で確かめて落とす。
    落とさないと、誰かが index を refresh しただけの周に成果があったことになる。
    """
    repo = os.path.join(tmp, "stale")
    make_repo(repo)
    baseline = mark(resolve_argv(repo, worktree=repo))

    # 中身を変えずに stat だけ動かす（書き直して mtime を進める）。
    path = os.path.join(repo, "tracked.txt")
    write(path, b"base\n")
    os.utime(path, (1700000042, 1700000042))

    candidates = git(repo, "diff-index", "--raw", "-z", "--no-renames", "HEAD")
    if b"tracked.txt" not in candidates:
        NOTES.append("stale index: git が候補に出さなかったので、この検査は素通りしている")
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
        want = ref_resolve("実装中", "worktree", head, [], [], plan_comment, wait_record)
        check(label, got, want)
        digests.append((label, got))
    check_distinct("在ると無いが分離されない", digests)


def test_head_sources(tmp):
    """head をどこで撮ったかが分離されること。"""
    repo = os.path.join(tmp, "head")
    head = make_repo(repo)
    branch = "fix/866-x"
    git(repo, "update-ref", "refs/remotes/origin/" + branch, head)

    from_worktree = mark(resolve_argv(repo, worktree=repo, branch=branch))
    check(
        "head を worktree で撮る",
        from_worktree,
        ref_resolve("実装中", "worktree", head, [], [], None, None),
    )

    from_branch = mark(resolve_argv(repo, branch=branch))
    check(
        "head を remote branch で撮る",
        from_branch,
        ref_resolve("実装中", "remote-branch", head, None, None, None, None),
    )

    absent = mark(resolve_argv(repo))
    check_distinct(
        "head の出どころが分離されない",
        [("worktree", from_worktree), ("remote-branch", from_branch), ("absent", absent)],
    )


def test_plan_cycle(tmp):
    """計画の周。git を見ないので期待値は完全に独立。"""
    body866 = os.path.join(tmp, "body866")
    body870 = os.path.join(tmp, "body870")
    write(body866, "本文 866\n".encode("utf-8"))
    write(body870, "本文 870".encode("utf-8"))

    one = mark(["--ledger", "未計画", "--issue-body", "866:" + body866, "--no-wait-record"])
    check("計画の周（単独）", one, ref_plan("未計画", [(866, "本文 866\n".encode("utf-8"))], None))
    check("計画の周（単独・凍結値）", one, FROZEN_PLAN)

    group = ["--ledger", "未計画", "--issue-body", "870:" + body870, "--issue-body", "866:" + body866,
             "--no-wait-record"]
    group_reversed = ["--ledger", "未計画", "--issue-body", "866:" + body866, "--issue-body", "870:" + body870,
                      "--no-wait-record"]
    check(
        "計画の周（group）",
        mark(group),
        ref_plan("未計画", [(866, "本文 866\n".encode("utf-8")), (870, "本文 870".encode("utf-8"))], None),
    )
    check("計画の周は引数の順に依らない", mark(group), mark(group_reversed))

    renumbered = mark(["--ledger", "未計画", "--issue-body", "867:" + body866, "--no-wait-record"])
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


def test_failures(tmp):
    """受入条件 4 —— 失敗は指紋を返さない。**空へ畳まない。**"""
    repo = os.path.join(tmp, "failures")
    make_repo(repo)
    os.makedirs(os.path.join(repo, "sub"))
    plan = os.path.join(tmp, "plan")
    write(plan, b"x\n")

    cases = [
        ("worktree が無い", resolve_argv(repo, worktree=os.path.join(tmp, "gone")), 1),
        ("worktree root ではない", resolve_argv(repo, worktree=os.path.join(repo, "sub")), 1),
        ("repo が無い", ["--ledger", "進行中", "--repo", os.path.join(tmp, "gone"), "--progress", "実装中",
                        "--no-worktree", "--branch", "x", "--no-plan-comment", "--no-wait-record"], 1),
        ("計画コメントの file が無い",
         resolve_argv(repo, worktree=repo, plan_comment=os.path.join(tmp, "gone")), 1),
        ("--worktree の指定が無い",
         ["--ledger", "進行中", "--repo", repo, "--progress", "実装中", "--no-branch",
          "--no-plan-comment", "--no-wait-record"], 2),
        ("--worktree と --no-worktree の両方",
         ["--ledger", "進行中", "--repo", repo, "--progress", "実装中", "--no-branch",
          "--worktree", repo, "--no-worktree", "--no-plan-comment", "--no-wait-record"], 2),
        ("--worktree が空文字",
         ["--ledger", "進行中", "--repo", repo, "--progress", "実装中", "--no-branch",
          "--worktree", "", "--no-plan-comment", "--no-wait-record"], 2),
        ("--branch が空文字",
         ["--ledger", "進行中", "--repo", repo, "--progress", "実装中", "--branch", "",
          "--no-worktree", "--no-plan-comment", "--no-wait-record"], 2),
        ("--plan-comment が空文字",
         ["--ledger", "進行中", "--repo", repo, "--progress", "実装中", "--no-branch",
          "--no-worktree", "--plan-comment", "", "--no-wait-record"], 2),
        ("--progress が空文字",
         ["--ledger", "進行中", "--repo", repo, "--progress", "", "--no-branch",
          "--no-worktree", "--no-plan-comment", "--no-wait-record"], 2),
        ("--ledger が空文字",
         ["--ledger", "", "--repo", repo, "--progress", "実装中", "--no-branch",
          "--no-worktree", "--no-plan-comment", "--no-wait-record"], 2),
        ("解決の周に --issue-body", resolve_argv(repo, worktree=repo) + ["--issue-body", "1:" + plan], 2),
        ("計画の周に --repo", ["--ledger", "未計画", "--repo", repo, "--issue-body", "1:" + plan,
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
            test_untracked_order,
            test_tracked_matrix,
            test_tracked_states,
            test_special_kinds,
            test_stale_index,
            test_optional_files,
            test_head_sources,
            test_plan_cycle,
            test_component_sensitivity,
            test_binary_tracked,
            test_ignored_not_counted,
            test_env_invariance,
            test_local_config_invariance,
            test_failures,
        ):
            test(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    for note in NOTES:
        sys.stderr.write("[note] {}\n".format(note))
    if FAILURES:
        sys.stderr.write("\n".join(FAILURES) + "\n")
        sys.stderr.write("\n{} 件の検査のうち {} 件が落ちた\n".format(CHECKS[0], len(FAILURES)))
        return 1
    sys.stdout.write("{} 件すべて pass\n".format(CHECKS[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
