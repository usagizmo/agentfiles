#!/bin/sh
# skill 群の機械検査。品質パスがレビュアーへ渡す材料を作る。
#
#   sh audit-skills.sh [SKILLS_ROOT] [--anchor DIR]... [--peer DIR]... [--layers FILE]
#
#   SKILLS_ROOT  既定はスクリプト自身の skills root
#   --anchor     参照解決の基準点を足す（repo root 相対か絶対）。skills root と
#                repo root（.git を持つ祖先）は既定で入るので、それ以外の置き場を
#                指す規約がある project だけ渡す
#   --peer       層検査の既知名に足す skills root。所有名だけを取る。本文・
#                derived / shared は見ない。既定値は無い
#   --layers     project 側の層定義を足す（形式は layers.tsv と同じ）
#
# 出力は TSV 1 行 1 件: <LEVEL> <check> <location> <detail>
#   VIOLATION  規約違反。レビューへ出す前に直す
#   REVIEW     候補。機械では意味を判定できないので、棄却可否はレビュアーが判定する
#   SKIP       検査を飛ばした。緑と区別がつくよう必ず出す（黙ると検査済みに見える）
# location は `<path>:<行>`。行を持たない検査（shared / sibling / queue / derived）は
# パスだけ、複数箇所を 1 行へ畳む検査（numeric / marker）は集約キーが入り、位置は
# detail の at= に並ぶ（at= は同じ行を畳むので count とは一致しない）。
# fence と引用の中は参照として読まない（layer / ref / ref-heading / sibling）。
# exit 0=違反なし / 1=VIOLATION あり / 2=検査自体が実行できない

set -u

# 日本語の見出し・単位はバイト列として扱う。awk の index/substr が
# ロケールによって文字単位になると、多バイト境界の計算がずれる。
LC_ALL=C
export LC_ALL

# 層の定義は layers.tsv（このスクリプトの隣）。leaf は書かないので既定 4。
# 未知の skill が leaf に落ちるのは fail-closed。
# **読めなければ落とす。**awk が開けないと rank が空を返し、比較がエラーになって
# layer 検査だけが消え、SUMMARY は出るので「違反なし」に見える。
LAYERS=$(dirname "$0")/layers.tsv

# **queue package の構成員。**キュー機構専用の共有実体（`shared/queue/`）を張ってよい skill。
# **rank ではなくドメインで決める** —— rank 2 の subflow が queue adapter になることがあり、
# rank 境界だと正当な参照まで落ちる。
QUEUE_MEMBERS="conductor
refine
resolve"
is_queue_member() {
	printf '%s\n' "$QUEUE_MEMBERS" | grep -qx "$1"
}

# `--layers` で project 側の定義を足せる。**global の定義だけで判定すると、
# project 固有の skill が全部 leaf に落ちて互いを名指しできなくなる**
# （leaf どうしの名指しは常に違反なので、正しい参照まで赤くなる）。
rank() {
	awk -F "	" -v s="$1" '
		/^#/ || NF < 2 { next }
		$2 == s { print $1; found = 1; exit }
		END { if (!found) print 4 }
	' $RANK_FILES
}

# skill 自体を対象にする skill。名指しは正当なので check layer から除く。
# `<skill>-project` は本体の免除を引き継ぐ。
is_layer_exempt() {
	case "$1" in
	docs | skill-creator) return 0 ;;
	*-project) is_layer_exempt "${1%-project}" ;;
	*) return 1 ;;
	esac
}

# 層比較の source identity。`<skill>-project` は本体の rank で比べる。
source_id() {
	case "$1" in
	*-project) printf '%s\n' "${1%-project}" ;;
	*) printf '%s\n' "$1" ;;
	esac
}

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

# symlink を辿って物理パスにする。shared の実体が skill ごとの別名で
# 複数回数えられるのを防ぐ（数値・marker の重複判定が常に誤検知になる）。
canon() {
	c_d=$(dirname "$1")
	c_b=$(basename "$1")
	c_d=$(CDPATH= cd -P -- "$c_d" 2>/dev/null && pwd -P) || return 1
	c_n=0
	while [ -L "$c_d/$c_b" ]; do
		c_n=$((c_n + 1))
		[ "$c_n" -gt 32 ] && return 1
		c_t=$(readlink "$c_d/$c_b") || return 1
		case "$c_t" in
		/*) c_nd=$(dirname "$c_t") ;;
		*) c_nd=$c_d/$(dirname "$c_t") ;;
		esac
		c_b=$(basename "$c_t")
		c_d=$(CDPATH= cd -P -- "$c_nd" 2>/dev/null && pwd -P) || return 1
	done
	printf '%s/%s\n' "$c_d" "$c_b"
}

emit() {
	printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$FINDINGS"
}

# fence と引用の中は参照ではない。書式の実例や他所からの引用が入る。
# **消さずに空行へ潰す** —— 行を詰めると location が別の行を指す。
# **開閉は文字種と本数で判定する。**単純なトグルだと、記録形式が使う fence の
# 入れ子（```` の中の ```）で反転し、以降の本物の参照が全部消える。
strip_noncode() {
	awk '
		{
			line = $0
			sub(/^[ \t]+/, "", line)
			ch = substr(line, 1, 1)
			if (ch == "`" || ch == "~") {
				n = 0
				while (substr(line, n + 1, 1) == ch) n++
				if (n >= 3) {
					rest = substr(line, n + 1)
					if (!fence) { fence = 1; fch = ch; fn = n }
					else if (ch == fch && n >= fn && rest ~ /^[ \t]*$/) fence = 0
					print ""
					next
				}
			}
			if (fence) { print ""; next }
			if (line ~ /^>/) { print ""; next }
			print
		}
	' "$1"
}

# --- 引数 ---------------------------------------------------------------
# **参照の基準点を 1 つに固定しない。**skills root からの相対しか解けないと、
# repo 直下の `docs/**` や、project 固有の置き場を指す参照が全部 missing になる。
# `--anchor` を必須にすると渡し忘れが常時赤になる。
ROOT_ARG=
ANCHORS=
PEERS=
EXTRA_LAYERS=
while [ $# -gt 0 ]; do
	case "$1" in
	--anchor)
		[ $# -ge 2 ] || fatal "--anchor に値が無い"
		ANCHORS="$ANCHORS
$2"
		shift 2
		;;
	--peer)
		[ $# -ge 2 ] || fatal "--peer に値が無い"
		PEERS="$PEERS
$2"
		shift 2
		;;
	--layers)
		[ $# -ge 2 ] || fatal "--layers に値が無い"
		EXTRA_LAYERS=$2
		shift 2
		;;
	-*) fatal "不明なオプション: $1" ;;
	*)
		[ -z "$ROOT_ARG" ] || fatal "skills root は 1 つだけ: $ROOT_ARG と $1"
		ROOT_ARG=$1
		shift
		;;
	esac
done
# スクリプト自身の skills root。引数を省略したときの検査対象であり、
# 検査 root と異なるときに peer が要るかの判定にも使う。
SCRIPT_DIR=$(CDPATH= cd -P -- "$(dirname "$0")" 2>/dev/null && pwd -P) || fatal "スクリプトの dir を解決できない"
SCRIPT_SKILLS=$(CDPATH= cd -P -- "$SCRIPT_DIR/../.." 2>/dev/null && pwd -P) ||
	fatal "スクリプトの skills root を解決できない"
[ -n "$ROOT_ARG" ] || ROOT_ARG=$SCRIPT_SKILLS

# --- root ---------------------------------------------------------------
# root 自体が dir symlink（`~/.agents/skills` が repo を指す）でも、canon が返す
# 物理パスと突き合わせられるように正規化する。投影前後で出力を同じにするため。
[ -f "$LAYERS" ] || fatal "層定義が無い: $LAYERS"
RANK_FILES=$LAYERS
if [ -n "$EXTRA_LAYERS" ]; then
	[ -f "$EXTRA_LAYERS" ] || fatal "--layers が実在しない: $EXTRA_LAYERS"
	RANK_FILES="$LAYERS $EXTRA_LAYERS"
fi
[ -d "$ROOT_ARG" ] || fatal "skills root が無い: $ROOT_ARG"
ROOT=$(CDPATH= cd -P -- "$ROOT_ARG" 2>/dev/null && pwd -P) || fatal "root を解決できない: $ROOT_ARG"

# **repo root は自動で足す。**`docs/**` を指す参照は project の規約で repo 相対と
# 決まっており、毎回 `--anchor` を渡させると渡し忘れが誤検知として残る。
REPO_ROOT=
rr_probe=$ROOT
while [ "$rr_probe" != "/" ]; do
	if [ -e "$rr_probe/.git" ]; then
		REPO_ROOT=$rr_probe
		break
	fi
	rr_probe=$(dirname "$rr_probe")
done

# 参照解決の基準点。順に試して 1 つでも当たれば実在とみなす。
# skills root 相対を入れるのは、`<skill>/references/<file>.md` 形式の参照が
# 参照元 dir からは解けないため（規約はこの形を要求している）。
RESOLVE_BASES=$ROOT
[ -n "$REPO_ROOT" ] && RESOLVE_BASES="$RESOLVE_BASES
$REPO_ROOT"
for a in $ANCHORS; do
	[ -n "$a" ] || continue
	case "$a" in
	# `~/...` は展開する。project skill が global skill の reference を指すのは正当で、
	# その置き場は `~/.agents/skills` という規約上の名前でしか指せない（実体の絶対パスは
	# checkout の場所に依存するので、渡す側に書かせるとマシンごとに違う値になる）。
	"~/"*) ap=$HOME/${a#"~/"} ;;
	/*) ap=$a ;;
	*) ap=${REPO_ROOT:-$ROOT}/$a ;;
	esac
	[ -d "$ap" ] || fatal "--anchor が実在しない: $a"
	RESOLVE_BASES="$RESOLVE_BASES
$ap"
done

PEER_ROOTS=
PEER_COUNT=0
for p in $PEERS; do
	[ -n "$p" ] || continue
	case "$p" in
	"~/"*) pp=$HOME/${p#"~/"} ;;
	/*) pp=$p ;;
	*) pp=${REPO_ROOT:-$ROOT}/$p ;;
	esac
	[ -d "$pp" ] || fatal "--peer が実在しない: $p"
	pp=$(CDPATH= cd -P -- "$pp" 2>/dev/null && pwd -P) || fatal "peer を解決できない: $p"
	PEER_ROOTS="$PEER_ROOTS
$pp"
	PEER_COUNT=$((PEER_COUNT + 1))
done

WORK=$(mktemp -d "${TMPDIR:-/tmp}/audit-skills.XXXXXX") || fatal "作業 dir を作れない"
# signal ハンドラは自分で終了する。戻ると $WORK が消えたまま走り続け、
# 集計が空になって exit 0（ゲートの素通り）になる。
trap 'rm -rf "$WORK"' EXIT
trap 'rm -rf "$WORK"; exit 130' HUP INT TERM

FINDINGS=$WORK/findings
: >"$FINDINGS"

# --- 所有判定 ------------------------------------------------------------
# 棚卸しの入力。3 値は所有 / 所有しない / 判定不能。
# 追跡済みは所有。未追跡かつ追跡中 `.gitignore` の除外対象外も所有。
# 追跡中の `.gitignore` が除外する skill は所有しない。
# `.git/info/exclude` と `core.excludesFile` は見ない（端末ごとに出力が変わる）。
# 判定不能は repo が無いときと git が無いときだけ。空の所有集合へ畳まない。
# 親の GIT_DIR を無視する。pre-commit 配下では GIT_DIR が検査対象を上書きする。
# 所有集合と層の既知名は別の入力。畳まない。
repo_of() {
	r_probe=$1
	while [ "$r_probe" != "/" ]; do
		if [ -e "$r_probe/.git" ]; then
			printf '%s\n' "$r_probe"
			return 0
		fi
		r_probe=$(dirname "$r_probe")
	done
	return 1
}

git_in() {
	g_repo=$1
	shift
	env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
		-u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
		-u GIT_PREFIX \
		git -C "$g_repo" "$@"
}

# $1 = repo / $2 = repo 相対の skill dir / $3 = 追跡中 gitignore
# 追跡済みなら所有。SKILL.md が追跡中 gitignore に除外されていれば所有しない。
# git の失敗は無視されていないに畳まない。
is_owned_in() {
	o_repo=$1
	o_rel=$2
	o_gi=$3
	o_tracked=$(git_in "$o_repo" ls-files -- "$o_rel") ||
		fatal "git ls-files が失敗した: $o_rel"
	[ -n "$o_tracked" ] && return 0
	o_ignored=$(git_in "$o_repo" ls-files --others --ignored --exclude-from="$o_gi" -- "$o_rel/SKILL.md") ||
		fatal "git ls-files --ignored が失敗した: $o_rel"
	[ -n "$o_ignored" ] && return 1
	return 0
}

# $1 = skills root / $2 = 所有名の出力 / $3 = 状態の出力（ok|unknown-norepo|unknown-nogit）
collect_owned() {
	co_root=$1
	co_names=$2
	co_st=$3
	: >"$co_names"
	co_repo=$(repo_of "$co_root") || {
		echo unknown-norepo >"$co_st"
		return 0
	}
	if ! command -v git >/dev/null 2>&1; then
		echo unknown-nogit >"$co_st"
		return 0
	fi
	co_gi=$WORK/gi_$(printf '%s' "$co_root" | tr '/ ' '__')
	: >"$co_gi"
	if git_in "$co_repo" cat-file -e HEAD:.gitignore 2>/dev/null; then
		git_in "$co_repo" show HEAD:.gitignore >"$co_gi" ||
			fatal "追跡中の .gitignore を読めない"
	fi
	for co_d in "$co_root"/*/; do
		[ -d "$co_d" ] || continue
		co_name=${co_d%/}
		co_name=${co_name##*/}
		[ -f "$co_d/SKILL.md" ] || continue
		co_abs=$(CDPATH= cd -P -- "$co_d" && pwd -P) || fatal "skill dir を解決できない: $co_d"
		case "$co_abs" in
		"$co_repo"/*) co_rel=${co_abs#"$co_repo"/} ;;
		*) fatal "skill が repo の外にある: $co_abs" ;;
		esac
		is_owned_in "$co_repo" "$co_rel" "$co_gi" || continue
		echo "$co_name" >>"$co_names"
	done
	echo ok >"$co_st"
}

OWNED=$WORK/owned
KNOWN=$WORK/known
collect_owned "$ROOT" "$OWNED" "$WORK/own_st"
OWN_ST=$(cat "$WORK/own_st")
OWNERSHIP=ok
case "$OWN_ST" in
unknown-norepo)
	OWNERSHIP=unknown
	emit SKIP owned "-" "note=repo が無いので所有判定をしていない"
	;;
unknown-nogit)
	OWNERSHIP=unknown
	emit SKIP owned "-" "note=git が無いので所有判定をしていない"
	;;
esac

cp "$OWNED" "$KNOWN"
for pp in $PEER_ROOTS; do
	[ -n "$pp" ] || continue
	collect_owned "$pp" "$WORK/peer_owned" "$WORK/peer_st"
	[ "$(cat "$WORK/peer_st")" = ok ] ||
		fatal "peer の所有判定ができない: $pp"
	while read -r pname; do
		[ -n "$pname" ] || continue
		grep -qx "$pname" "$OWNED" &&
			fatal "検査 root と peer で同じ skill 名がある: $pname"
		grep -qx "$pname" "$KNOWN" &&
			fatal "peer どうしで同じ skill 名がある: $pname"
		echo "$pname" >>"$KNOWN"
	done <"$WORK/peer_owned"
done

# --- 対象ファイルの棚卸し ------------------------------------------------
# files: <display>\t<physical>  display は root 相対（両 root で同じ形になる）
# 所有集合は 1 度だけ作る。ディスク直下を再列挙して所有外を足さない。
INVENTORY=$WORK/files
: >"$INVENTORY"
SKILLS=$WORK/skills
: >"$SKILLS"

if [ "$OWNERSHIP" = ok ]; then
	while read -r name; do
		[ -n "$name" ] || continue
		echo "$name" >>"$SKILLS"
		d=$ROOT/$name
		if p=$(canon "$d/SKILL.md"); then
			printf '%s\t%s\n' "$name/SKILL.md" "$p" >>"$INVENTORY"
		fi
		[ -d "$d/references" ] || continue
		for f in "$d"/references/*; do
			[ -e "$f" ] || [ -L "$f" ] || continue
			b=${f##*/}
			case "$b" in *.md) ;; *) continue ;; esac
			if p=$(canon "$f"); then
				[ -f "$p" ] && printf '%s\t%s\n' "$name/references/$b" "$p" >>"$INVENTORY"
			fi
		done
	done <"$OWNED"
	[ -s "$SKILLS" ] || fatal "SKILL.md を持つ skill が root 直下に無い: $ROOT"
fi

# 物理パスごとに代表 1 件へ畳む。以降の内容検査はこれを回す。
sort -t "	" -k2,2 -k1,1 "$INVENTORY" | awk -F "	" '!seen[$2]++' >"$WORK/unique"

# --- check layer: 同じ層・上位層の名指し ---------------------------------
# 既知は検査 root の所有名 ∪ 各 peer の所有名。所有集合とは畳まない。
LAYER_INCOMPLETE=0
if [ "$OWNERSHIP" != ok ]; then
	:
elif [ "$ROOT" != "$SCRIPT_SKILLS" ] && [ "$PEER_COUNT" -eq 0 ]; then
	emit SKIP layer "-" "note=検査 root がスクリプトの skills root と異なり peer が無い"
	LAYER_INCOMPLETE=1
else
	while read -r skill; do
		[ -n "$skill" ] || continue
		is_layer_exempt "$skill" && continue
		src=$(source_id "$skill")
		sr=$(rank "$src")
		strip_noncode "$ROOT/$skill/SKILL.md" | awk '{
			while (match($0, /`\/?[a-z][a-z0-9-]*`/)) {
				w = substr($0, RSTART + 1, RLENGTH - 2)
				sub(/^\//, "", w)
				print NR "\t" w
				$0 = substr($0, RSTART + RLENGTH)
			}
		}' | sort -u | while IFS="	" read -r ln word; do
			[ "$word" = "$skill" ] && continue
			[ "$word" = "$src" ] && continue
			grep -qx "$word" "$KNOWN" || continue
			tr_=$(rank "$word")
			[ "$tr_" -le "$sr" ] &&
				emit VIOLATION layer "$skill/SKILL.md:$ln" "rank=$sr names=$word rank=$tr_"
		done
	done <"$SKILLS"
fi

# --- check ref: 参照先ファイルと節見出しの実在 ---------------------------
# `~/...` と絶対パスは投影前の checkout で解決できないので対象外。
while IFS="	" read -r disp phys; do
	dir=${disp%/*}

	# バッククォート内の相対 .md パス
	strip_noncode "$phys" | awk '{
		while (match($0, /`[^`]*\.md`/)) {
			print NR "\t" substr($0, RSTART + 1, RLENGTH - 2)
			$0 = substr($0, RSTART + RLENGTH)
		}
	}' | sort -u | while IFS="	" read -r ln target; do
		case "$target" in
		"~"* | /* | *" "*) continue ;;
		# **プレースホルダは参照ではない。**`<skill>/references/<file>.md` の
		# ような書式の説明そのものが規約文に出てくる。パスとして解こうとすると
		# 必ず missing になり、直しようがない違反が永久に残る。
		*"<"* | *">"* | *"{"* | *"}"* | *"*"*) continue ;;
		esac
		# 所有外 skill を先頭 segment に持つ参照は、ディスク上の有無に
		# 関わらず所有集合の外。解けたことにも missing にもしない。
		case "$target" in
		*/*)
			first=${target%%/*}
			if [ "$OWNERSHIP" = ok ] && [ -f "$ROOT/$first/SKILL.md" ]; then
				grep -qx "$first" "$OWNED" || continue
			fi
			;;
		esac
		hit=
		for b in $RESOLVE_BASES; do
			if [ -e "$b/$target" ]; then
				hit=1
				break
			fi
		done
		[ -n "$hit" ] && continue
		[ -e "$ROOT/$dir/$target" ] && continue
		# 区切りを持つものはパスと断定できる。裸のファイル名は生成物の名前でも
		# ありうるので REVIEW に落とす（見逃さないが、ゲートは止めない）。
		case "$target" in
		*/*) emit VIOLATION ref "$disp:$ln" "missing=$target" ;;
		*) emit REVIEW ref "$disp:$ln" "unresolved=$target note=裸のファイル名" ;;
		esac
	done

	# `PATH` の「見出し」 / 「見出し」の節
	strip_noncode "$phys" | awk -v disp="$disp" '
		function emit_h(ln, path, head) { print ln "\t" path "\t" head }
		{
			s = $0
			while ((i = index(s, "`")) > 0) {
				s = substr(s, i + 1)
				j = index(s, "`")
				if (j == 0) break
				path = substr(s, 1, j - 1)
				rest = substr(s, j + 1)
				s = rest
				if (substr(rest, 1, 1) == " ") rest = substr(rest, 2)
				if (substr(rest, 1, 3) != "の") continue
				rest = substr(rest, 4)
				if (substr(rest, 1, 3) != "「") continue
				rest = substr(rest, 4)
				k = index(rest, "」")
				if (k == 0) continue
				emit_h(NR, path, substr(rest, 1, k - 1))
			}
			s = $0
			while ((i = index(s, "「")) > 0) {
				s = substr(s, i + 3)
				k = index(s, "」")
				if (k == 0) break
				head = substr(s, 1, k - 1)
				after = substr(s, k + 3)
				s = after
				# 同一ファイル内の節参照。空フィールドを置かない —
				# tab は IFS 空白なので、連続すると read が 1 つに畳んで列がずれる。
				if (substr(after, 1, 6) == "の節") emit_h(NR, "-", head)
			}
		}
	' | sort -u | while IFS="	" read -r ln target head; do
		[ -n "$head" ] || continue
		if [ "$target" = "-" ]; then
			hfile=$phys
		else
			case "$target" in
			"~"* | /* | *" "*) continue ;;
			*.md) ;;
			*) continue ;;
			esac
			hfile=$ROOT/$dir/$target
			[ -e "$hfile" ] || continue
		fi
		awk -v h="$head" '
			/^#/ {
				t = $0
				sub(/^#+[ \t]*/, "", t)
				sub(/[ \t]*$/, "", t)
				if (t == h) { found = 1; exit }
			}
			END { exit(found ? 0 : 1) }
		' "$hfile" ||
			emit VIOLATION ref-heading "$disp:$ln" "missing=「$head」 in=$([ "$target" = "-" ] && echo self || echo "$target")"
	done
done <"$WORK/unique"

# --- check numeric: 数値・既定値の多重記載（索引。判定はしない） ---------
# 2 通りで拾う。**単位が後ろに付く形**（`300 行`）と、**既定値の語が前に付く形**（`目安 4`）。
# 後者を入れないと、単位を伴わない既定値が丸ごと網から漏れる。
# 大小での足切りはしない（`2 巡` `300 行` のような実際の既定値が落ちる）。
# 落とすのは「1 + 助数詞」だけ。これは既定値ではなく散文の数え方で
# （`1 件を扱う skill` `理由を 1 行残す` `1 本で直す`）、恒久的に同じ行が
# レビュアーへ流れると索引ごと読まれなくなる。
: >"$WORK/nums"
while IFS="	" read -r disp phys; do
	awk -v disp="$disp" '
		function emit_key(k, l) { gsub(/ /, "", k); print k "\t" disp ":" l }
		{
			s = $0
			while (match(s, /[0-9]+k?[ ]?(分|秒|時間|日|件|行|本|回|巡|個|箇所|文字|tokens)/)) {
				key = substr(s, RSTART, RLENGTH)
				s = substr(s, RSTART + RLENGTH)
				gsub(/ /, "", key)
				if (key ~ /^1(件|行|本|回|巡|個|箇所|文字)$/) continue
				emit_key(key, NR)
			}
			s = $0
			while (match(s, /(目安|既定|上限|最大|最小)[ ]?[0-9]+/)) {
				emit_key(substr(s, RSTART, RLENGTH), NR)
				s = substr(s, RSTART + RLENGTH)
			}
		}
	' "$phys" >>"$WORK/nums"
done <"$WORK/unique"

sort "$WORK/nums" | awk -F "	" '
	{ n[$1]++; if (!seen[$1 "\t" $2]++) { loc[$1] = loc[$1] (loc[$1] == "" ? "" : ",") $2 } }
	END { for (k in n) if (n[k] >= 2) print k "\t" n[k] "\t" loc[k] }
' | sort | while IFS="	" read -r key n loc; do
	emit REVIEW numeric "$key" "count=$n at=$loc"
done

# --- check marker: marker 形式の定義が 2 箇所以上に無いか ----------------
# marker 名はハードコードせず総なめする（新設 marker でもスクリプトを直さない）。
: >"$WORK/markers"
while IFS="	" read -r disp phys; do
	awk -v disp="$disp" '{
		while (match($0, /<!--[ ]*\/?[a-z][a-z0-9-]*:v[0-9]+[ ]*-->/)) {
			tag = substr($0, RSTART, RLENGTH)
			$0 = substr($0, RSTART + RLENGTH)
			if (tag ~ /\//) { kind = "close" } else { kind = "open" }
			gsub(/[^a-z0-9:]/, "", tag)
			print tag "\t" kind "\t" disp ":" NR
		}
	}' "$phys" >>"$WORK/markers"
done <"$WORK/unique"

sort "$WORK/markers" | awk -F "	" '
	$2 == "open" { o[$1]++; ol[$1] = ol[$1] (ol[$1] == "" ? "" : ",") $3 }
	$2 == "close" { c[$1]++ }
	END {
		for (k in o) {
			if (o[k] >= 2) print "dup\t" k "\t" o[k] "\t" ol[k]
			if (o[k] != c[k] + 0) print "unpaired\t" k "\t" o[k] "/" c[k] + 0 "\t" ol[k]
		}
		for (k in c) if (!(k in o)) print "unpaired\t" k "\t0/" c[k] "\t?"
	}
' | sort | while IFS="	" read -r kind key n loc; do
	case "$kind" in
	dup) emit REVIEW marker "$key" "open=$n at=$loc" ;;
	unpaired) emit VIOLATION marker "$key" "open/close=$n at=$loc" ;;
	esac
done

# --- check shared: shared/ への symlink 健全性 ---------------------------
# queue 判定に実体の在処が要るので、symlink 検査より前に解決しておく。
SHARED_ROOT=$(CDPATH= cd -P -- "$ROOT/../shared" 2>/dev/null && pwd -P) || SHARED_ROOT=""
# 張り先と名前の規約は repo の AGENTS.md。ここはその検査。
# references / scripts / assets に加え `src/` も回す（`jsonc.ts` / `standalone-line.ts`）。
: >"$WORK/shared_use"
for d in "$ROOT"/*/references "$ROOT"/*/scripts "$ROOT"/*/assets "$ROOT"/*/src; do
	[ -d "$d" ] || continue
	skill=${d%/*}
	skill=${skill##*/}
	grep -qx "$skill" "$SKILLS" || continue
	kind=${d##*/}
	for f in "$d"/*; do
		[ -L "$f" ] || continue
		b=${f##*/}
		disp="$skill/$kind/$b"
		t=$(readlink "$f")
		case "$t" in
		*shared/*) ;;
		*)
			emit REVIEW shared "$disp" "target=$t note=shared 以外を指す symlink"
			continue
			;;
		esac
		# **queue 実体は queue package の構成員だけが張れる。**普遍の shared は誰でもよい。
		# 軸は skill の rank ではなくドメイン（rank は将来ずれる代理でしかない）。
		want="../../../shared/$b"
		[ -f "$SHARED_ROOT/queue/$b" ] && want="../../../shared/queue/$b"
		[ "$t" = "$want" ] ||
			emit VIOLATION shared "$disp" "target=$t want=$want"
		case "$want" in
		*/queue/*)
			is_queue_member "$skill" ||
				emit VIOLATION queue "$disp" "note=queue 専用の実体を queue package の外から張っている"
			;;
		esac
		if p=$(canon "$f") && [ -f "$p" ]; then
			echo "${p##*/}	$skill" >>"$WORK/shared_use"
		else
			emit VIOLATION shared "$disp" "target=$t note=解決先が無い"
		fi
	done
done

# shared dir は規約（`<dir>/<file>` → `../../../shared/<file>`）から直に組み立てる。
# 生きた symlink から逆引きすると、全部コピーへ置き換わった一番効くべき状況で
# 探索が空振りし、以降の検査ごと素通りする。
SHARED_DIR=$SHARED_ROOT
if [ -z "$SHARED_DIR" ]; then
	# 黙って飛ばさない。検査を落としたまま「違反なし」に見えるのを防ぐ。
	emit REVIEW shared "../shared" "note=shared dir が無く copy / 孤児検査を実行していない"
else
	# 使う skill が 2 つ未満なら shared に置く条件を満たさない。実体の側から
	# 数える — symlink 側からだと、最後の利用者が消えた孤児が 0 件で素通りする。
	for s in "$SHARED_DIR"/*; do
		[ -f "$s" ] || continue
		printf '%s\t\n' "${s##*/}" >>"$WORK/shared_use"
		# 実行する共有物は、壊れたまま配ると使う側で初めて落ちる。
		case "$s" in
		*.sh)
			sh -n "$s" 2>/dev/null || emit VIOLATION shared "shared/${s##*/}" "note=shell 構文エラー"
			[ -x "$s" ] || emit REVIEW shared "shared/${s##*/}" "note=実行ビットが無い"
			;;
		esac
	done
fi

sort -u "$WORK/shared_use" | awk -F "	" '
	{ if ($2 != "") { n[$1]++; u[$1] = u[$1] (u[$1] == "" ? "" : ",") $2 } else if (!($1 in n)) n[$1] += 0 }
	END { for (k in n) if (n[k] < 2) print k "\t" n[k] "\t" (u[k] == "" ? "-" : u[k]) }
' | sort | while IFS="	" read -r file n users; do
	emit REVIEW shared "shared/$file" "users=$n at=$users note=2 skill 未満"
done

# shared に同名の実体があるのに skill 側が通常ファイル = コピーによる重複。
if [ -n "$SHARED_DIR" ]; then
	for d in "$ROOT"/*/references "$ROOT"/*/scripts "$ROOT"/*/assets "$ROOT"/*/src; do
		[ -d "$d" ] || continue
		skill=${d%/*}
		skill=${skill##*/}
		grep -qx "$skill" "$SKILLS" || continue
		kind=${d##*/}
		for f in "$d"/*; do
			[ -f "$f" ] || continue
			[ -L "$f" ] && continue
			b=${f##*/}
			# symlink 側と同じく queue も見る。片側だけだと queue の実体コピーが素通りする。
			if [ -f "$SHARED_DIR/$b" ]; then
				emit VIOLATION shared "$skill/$kind/$b" "note=shared/$b の実体があるのに通常ファイル"
			elif [ -f "$SHARED_DIR/queue/$b" ]; then
				emit VIOLATION shared "$skill/$kind/$b" "note=shared/queue/$b の実体があるのに通常ファイル"
			fi
		done
	done
fi

# --- check sibling: shared が bare 名で挙げる兄弟が、張った skill の references/ にも在るか ---
# **代表 1 件へ畳む前の一覧を回す。**畳むと辞書順で最初の skill しか検査されず、
# 張り忘れた skill の読み手だけが名前を辿れない状態が緑で通る。
# 兄弟と断定できるのは shared に実体がある名前だけ。生成物の名前を巻き込まない。
# 同じ兄弟を複数回引用する shared が在るので、行番号は持たずファイル単位へ畳む。
if [ -n "$SHARED_ROOT" ]; then
	while IFS="	" read -r disp phys; do
		case "$phys" in "$SHARED_ROOT"/*) ;; *) continue ;; esac
		case "$disp" in */references/*) ;; *) continue ;; esac
		dir=${disp%/*}
		skill=${disp%%/*}
		strip_noncode "$phys" | awk '{
			while (match($0, /`[a-z][a-z0-9-]*\.md`/)) {
				print substr($0, RSTART + 1, RLENGTH - 2)
				$0 = substr($0, RSTART + RLENGTH)
			}
		}' | sort -u | while read -r sib; do
			[ -e "$ROOT/$dir/$sib" ] && continue
			# 同名 basename は queue を先に見る（symlink 検査の want と同じ順）。
			if [ -f "$SHARED_ROOT/queue/$sib" ]; then
				case "$phys" in
				"$SHARED_ROOT"/queue/*)
					if is_queue_member "$skill"; then
						emit VIOLATION sibling "$disp" "sibling=$sib note=bare 名で挙げた兄弟が張られていない"
					else
						emit REVIEW sibling "$disp" "sibling=$sib note=queue の兄弟を非 member が読めない"
					fi
					;;
				# 張らせると queue 検査と両立しない。直す先は引用元の bare 名。
				*) emit REVIEW sibling "$disp" "sibling=$sib note=universal shared が queue の兄弟を bare 名で挙げている" ;;
				esac
			elif [ -f "$SHARED_ROOT/$sib" ]; then
				emit VIOLATION sibling "$disp" "sibling=$sib note=bare 名で挙げた兄弟が張られていない"
			fi
		done
	done <"$INVENTORY"
fi

# --- check derived: agents/docs/ が skills の実態からずれていないか --------
# docs/ は「skills から導出した図と索引」と宣言されているのに導出は人手。
# 生成はしない（POSIX shell で mermaid を吐く toolchain を増やさない）。
# **ずれを落とすことだけ**やる。導出できない散文（意図・語義）は対象外。
DOCS_DIR=$(CDPATH= cd -P -- "$ROOT/../docs" 2>/dev/null && pwd -P) || DOCS_DIR=""
if [ -z "$DOCS_DIR" ]; then
	emit REVIEW derived "../docs" "note=docs dir が無く導出物の検査を実行していない"
else
	for want in README.md structure.md glossary.md; do
		[ -f "$DOCS_DIR/$want" ] ||
			emit REVIEW derived "docs/$want" "note=無いので対応する導出物検査を実行していない"
	done

	# 層構造の節に載る skill 名 ↔ 所有している実ツリー。節を切り出して双方向に突き合わせる。
	# 判定不能のときは突き合わせない（空の所有集合として緑にしない）。
	if [ -f "$DOCS_DIR/README.md" ] && [ "$OWNERSHIP" = ok ]; then
		# 表の行だけを見る。散文のバッククォート語まで skill 名と見なすと誤検知が出る。
		awk '/^## 層構造/ { on = 1; next } on && /^## / { exit } on && /^\|/' "$DOCS_DIR/README.md" >"$WORK/layers_sec"
		awk '{ while (match($0, /`[a-z][a-z0-9-]*`/)) { print substr($0, RSTART + 1, RLENGTH - 2); $0 = substr($0, RSTART + RLENGTH) } }' \
			"$WORK/layers_sec" | sort -u >"$WORK/doc_skills"
		while read -r w; do
			grep -qx "$w" "$SKILLS" ||
				emit VIOLATION derived "docs/README.md" "note=層構造の $w を所有していない"
		done <"$WORK/doc_skills"
		while read -r s; do
			grep -qx "$s" "$WORK/doc_skills" ||
				emit VIOLATION derived "docs/README.md" "note=skill $s が層構造の節に無い"
		done <"$SKILLS"
	fi

	# structure.md が挙げる shared 実体 ↔ 実際の agents/shared/*（.md 以外も含む）
	if [ -f "$DOCS_DIR/structure.md" ] && [ -n "$SHARED_DIR" ]; then
		# **queue package の実体も棚卸しに含める。**含めないと、`shared/queue/` へ移した
		# 実体が索引から静かに落ち、図だけが古い場所を指したまま violation にならない。
		: >"$WORK/shared_real"
		for s in "$SHARED_DIR"/* "$SHARED_DIR"/queue/*; do
			[ -f "$s" ] || continue
			echo "${s##*/}" >>"$WORK/shared_real"
			grep -qF "${s##*/}" "$DOCS_DIR/structure.md" ||
				emit VIOLATION derived "docs/structure.md" "note=shared/${s##*/} が図にも一覧にも無い"
		done
		# 逆向き。shared 図に残った幽霊エントリもドリフト。
		# **拾う条件は subgraph の id ではなくラベルに `agents/shared/` が在ること**。
		# id で拾うと、図を整える改名で検査が黙って外れる。拡張子も限定しない。
		awk '/subgraph .*agents\/shared/ { on = 1; next } on && /^ *end/ { on = 0; next } on' "$DOCS_DIR/structure.md" |
			awk '{ while (match($0, /[a-z][a-z0-9-]+\.[a-z][a-z0-9]{1,4}/)) { print substr($0, RSTART, RLENGTH); $0 = substr($0, RSTART + RLENGTH) } }' |
			sort -u | while read -r n; do
			grep -qx "$n" "$WORK/shared_real" ||
				emit VIOLATION derived "docs/structure.md" "note=図の $n は shared に実体が無い"
		done
	fi

	# glossary の marker 索引 ↔ 実際の marker 定義（両方向）
	if [ -f "$DOCS_DIR/glossary.md" ]; then
		cut -f1 "$WORK/markers" 2>/dev/null | sort -u >"$WORK/marker_real"
		while read -r m; do
			grep -qF "$m" "$DOCS_DIR/glossary.md" ||
				emit VIOLATION derived "docs/glossary.md" "note=marker $m が索引に無い"
		done <"$WORK/marker_real"
		awk '{ while (match($0, /[a-z][a-z0-9-]*:v[0-9]+/)) { print substr($0, RSTART, RLENGTH); $0 = substr($0, RSTART + RLENGTH) } }' \
			"$DOCS_DIR/glossary.md" | sort -u | while read -r m; do
			grep -qx "$m" "$WORK/marker_real" ||
				emit VIOLATION derived "docs/glossary.md" "note=索引の marker $m は定義が無い"
		done
	fi
fi

# --- check emphasis: 描画が壊れる強調 -------------------------------------
# **正規表現では届かない。**flanking は開き / 閉じの対応まで見ないと結論が出ず、
# 右 flanking は成立するのに相手が無くてリテラルへ落ちる `**` を取り逃す。
# 描画して判定する実体は隣の check-emphasis.ts。
# **道具が無ければ飛ばす。**強調記法はこの検査の付随物で、欠いても本来の目的
# （実在・形・重複・層）は達成できる。飛ばしたことは SKIP で出す。
emphasis_self=$(canon "$0") || emphasis_self=$0
# 既定はスクリプトの隣。test が異常系の checker を差し込めるように上書きを許す
EMPHASIS_TS=${EMPHASIS_TS:-$(dirname "$emphasis_self")/check-emphasis.ts}
if ! command -v bun >/dev/null 2>&1; then
	emit SKIP emphasis "-" "note=bun が無いので強調記法を検査していない"
elif [ ! -f "$EMPHASIS_TS" ]; then
	emit SKIP emphasis "-" "note=$EMPHASIS_TS が無いので強調記法を検査していない"
else
	# **instructions 入口も入れる。**skills だけを対象にすると AGENTS.md が対象外になる。
	{
		cat "$WORK/unique"
		for f in "$ROOT/../AGENTS.md" "$ROOT/../CLAUDE.md"; do
			[ -f "$f" ] && printf '%s\t%s\n' "${f##*/}" "$f"
		done
		if [ -n "$DOCS_DIR" ]; then
			for f in "$DOCS_DIR"/*.md; do
				[ -f "$f" ] && printf 'docs/%s\t%s\n' "${f##*/}" "$f"
			done
		fi
	} >"$WORK/md_targets"
	bun "$EMPHASIS_TS" <"$WORK/md_targets" >"$WORK/emphasis" 2>"$WORK/emphasis_err"
	emphasis_rc=$?
	# 契約は 0=壊れなし / 1=壊れあり（出力あり） / 2=marked が無い。
	# **それ以外と、1 なのに出力が空の場合は落とす。**checker 自体が落ちた状態を
	# 「違反なし」と見分けられないまま通すと、緑のまま検査されなくなる
	case $emphasis_rc in
	0) ;;
	1)
		[ -s "$WORK/emphasis" ] ||
			fatal "emphasis checker が出力なしで失敗した: $(tr '\n' ' ' <"$WORK/emphasis_err" | cut -c1-200)"
		;;
	2)
		emit SKIP emphasis "-" "note=marked が入っていないので強調記法を検査していない（./init.sh）"
		;;
	*)
		fatal "emphasis checker が異常終了した (rc=$emphasis_rc): $(tr '\n' ' ' <"$WORK/emphasis_err" | cut -c1-200)"
		;;
	esac
	while IFS="	" read -r d ln snip; do
		[ -n "$d" ] && emit VIOLATION emphasis "$d:$ln" "note=強調が対応しない: $snip"
	done <"$WORK/emphasis"
fi

# --- 出力 ---------------------------------------------------------------
LC_ALL=C sort "$FINDINGS"
v=$(grep -c '^VIOLATION	' "$FINDINGS")
r=$(grep -c '^REVIEW	' "$FINDINGS")
s=$(grep -c '^SKIP	' "$FINDINGS")
printf 'SUMMARY\troot=%s\tviolations=%s\treviews=%s\tskips=%s\n' "$ROOT_ARG" "$v" "$r" "$s"

[ "$v" -gt 0 ] && exit 1
[ "$OWNERSHIP" = unknown ] && exit 2
[ "$LAYER_INCOMPLETE" = 1 ] && exit 2
exit 0
