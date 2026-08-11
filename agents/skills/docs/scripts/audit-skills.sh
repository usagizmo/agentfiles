#!/bin/sh
# skill 群の機械検査。品質パスがレビュアーへ渡す材料を作る。
#
#   sh audit-skills.sh [SKILLS_ROOT] [--anchor DIR]... [--layers FILE]
#
#   SKILLS_ROOT  既定 ~/.agents/skills
#   --anchor     参照解決の基準点を足す（repo root 相対か絶対）。skills root と
#                repo root（.git を持つ祖先）は既定で入るので、それ以外の置き場を
#                指す規約がある project だけ渡す
#   --layers     project 側の層定義を足す（形式は layers.tsv と同じ）
#
# 出力は TSV 1 行 1 件: <LEVEL> <check> <location> <detail>
#   VIOLATION  規約違反。レビューへ出す前に直す
#   REVIEW     候補。機械では意味を判定できないので、棄却可否はレビュアーが判定する
#   SKIP       検査を飛ばした。緑と区別がつくよう必ず出す（黙ると検査済みに見える）
# location は `<path>:<行>`。行を持たない検査（shared）はパスだけ、複数箇所を
# 1 行へ畳む検査（numeric / marker）は集約キーが入り、位置は detail の at= に
# 並ぶ（at= は同じ行を畳むので count とは一致しない）。
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
# rank 境界だと正当な参照まで落ちる。project 差分の adapter は `--queue-member` で足す。
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
is_layer_exempt() {
	case "$1" in
	docs | skill-creator) return 0 ;;
	*) return 1 ;;
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

# --- 引数 ---------------------------------------------------------------
# **参照の基準点を 1 つに固定しない。**skills root からの相対しか解けないと、
# repo 直下の `docs/**` や、project 固有の置き場を指す参照が全部 missing になる。
# 実測で 38 件中 37 件が誤検知になり、**gate が常時赤で新しい違反を検出できなくなった。**
ROOT_ARG=
ANCHORS=
EXTRA_LAYERS=
while [ $# -gt 0 ]; do
	case "$1" in
	--anchor)
		[ $# -ge 2 ] || fatal "--anchor に値が無い"
		ANCHORS="$ANCHORS
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
[ -n "$ROOT_ARG" ] || ROOT_ARG=$HOME/.agents/skills

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

WORK=$(mktemp -d "${TMPDIR:-/tmp}/audit-skills.XXXXXX") || fatal "作業 dir を作れない"
# signal ハンドラは自分で終了する。戻ると $WORK が消えたまま走り続け、
# 集計が空になって exit 0（ゲートの素通り）になる。
trap 'rm -rf "$WORK"' EXIT
trap 'rm -rf "$WORK"; exit 130' HUP INT TERM

FINDINGS=$WORK/findings
: >"$FINDINGS"

# --- 対象ファイルの棚卸し ------------------------------------------------
# files: <display>\t<physical>  display は root 相対（両 root で同じ形になる）
INVENTORY=$WORK/files
: >"$INVENTORY"
SKILLS=$WORK/skills
: >"$SKILLS"

for d in "$ROOT"/*/; do
	[ -d "$d" ] || continue
	name=${d%/}
	name=${name##*/}
	[ -f "$d/SKILL.md" ] || continue
	echo "$name" >>"$SKILLS"
	if p=$(canon "$d/SKILL.md"); then
		printf '%s\t%s\n' "$name/SKILL.md" "$p" >>"$INVENTORY"
	fi
	[ -d "$d/references" ] || continue
	for f in "$d"references/*; do
		[ -e "$f" ] || [ -L "$f" ] || continue
		b=${f##*/}
		case "$b" in *.md) ;; *) continue ;; esac
		if p=$(canon "$f"); then
			[ -f "$p" ] && printf '%s\t%s\n' "$name/references/$b" "$p" >>"$INVENTORY"
		fi
	done
done

[ -s "$SKILLS" ] || fatal "SKILL.md を持つ skill が root 直下に無い: $ROOT"

# 物理パスごとに代表 1 件へ畳む。以降の内容検査はこれを回す。
sort -t "	" -k2,2 -k1,1 "$INVENTORY" | awk -F "	" '!seen[$2]++' >"$WORK/unique"

# --- check layer: 同じ層・上位層の名指し ---------------------------------
while read -r skill; do
	is_layer_exempt "$skill" && continue
	sr=$(rank "$skill")
	awk '{
		while (match($0, /`[a-z][a-z0-9-]*`/)) {
			print NR "\t" substr($0, RSTART + 1, RLENGTH - 2)
			$0 = substr($0, RSTART + RLENGTH)
		}
	}' "$ROOT/$skill/SKILL.md" | sort -u | while IFS="	" read -r ln word; do
		[ "$word" = "$skill" ] && continue
		grep -qx "$word" "$SKILLS" || continue
		tr_=$(rank "$word")
		[ "$tr_" -le "$sr" ] &&
			emit VIOLATION layer "$skill/SKILL.md:$ln" "rank=$sr names=$word rank=$tr_"
	done
done <"$SKILLS"

# --- check ref: 参照先ファイルと節見出しの実在 ---------------------------
# `~/...` と絶対パスは投影前の checkout で解決できないので対象外。
while IFS="	" read -r disp phys; do
	dir=${disp%/*}

	# バッククォート内の相対 .md パス
	awk '{
		while (match($0, /`[^`]*\.md`/)) {
			print NR "\t" substr($0, RSTART + 1, RLENGTH - 2)
			$0 = substr($0, RSTART + RLENGTH)
		}
	}' "$phys" | sort -u | while IFS="	" read -r ln target; do
		case "$target" in
		"~"* | /* | *" "*) continue ;;
		# **プレースホルダは参照ではない。**`<skill>/references/<file>.md` の
		# ような書式の説明そのものが規約文に出てくる。パスとして解こうとすると
		# 必ず missing になり、直しようがない違反が永久に残る。
		*"<"* | *">"* | *"{"* | *"}"* | *"*"*) continue ;;
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
	awk -v disp="$disp" '
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
	' "$phys" | sort -u | while IFS="	" read -r ln target head; do
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
# 規約は `skills/<name>/{references,scripts}/<file>` → `../../../shared/<同名>`。
# 張り先はモデルの扱い（読む / 実行する）で決まり、拡張子では決まらない。
: >"$WORK/shared_use"
for d in "$ROOT"/*/references "$ROOT"/*/scripts; do
	[ -d "$d" ] || continue
	skill=${d%/*}
	skill=${skill##*/}
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
	for d in "$ROOT"/*/references "$ROOT"/*/scripts; do
		[ -d "$d" ] || continue
		skill=${d%/*}
		skill=${skill##*/}
		kind=${d##*/}
		for f in "$d"/*; do
			[ -f "$f" ] || continue
			[ -L "$f" ] && continue
			b=${f##*/}
			[ -f "$SHARED_DIR/$b" ] &&
				emit VIOLATION shared "$skill/$kind/$b" "note=shared/$b の実体があるのに通常ファイル"
		done
	done
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

	# 層構造の節に載る skill 名 ↔ 実ツリー。節を切り出して双方向に突き合わせる。
	if [ -f "$DOCS_DIR/README.md" ]; then
		# 表の行だけを見る。散文のバッククォート語まで skill 名と見なすと誤検知が出る。
		awk '/^## 層構造/ { on = 1; next } on && /^## / { exit } on && /^\|/' "$DOCS_DIR/README.md" >"$WORK/layers_sec"
		awk '{ while (match($0, /`[a-z][a-z0-9-]*`/)) { print substr($0, RSTART + 1, RLENGTH - 2); $0 = substr($0, RSTART + RLENGTH) } }' \
			"$WORK/layers_sec" | sort -u >"$WORK/doc_skills"
		while read -r w; do
			grep -qx "$w" "$SKILLS" ||
				emit VIOLATION derived "docs/README.md" "note=層構造の $w が skills root に無い"
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
		awk '/subgraph shared/ { on = 1; next } on && /^ *end/ { exit } on' "$DOCS_DIR/structure.md" |
			awk '{ while (match($0, /[a-z][a-z0-9-]+\.(md|sh|tsv)/)) { print substr($0, RSTART, RLENGTH); $0 = substr($0, RSTART + RLENGTH) } }' |
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
# 描画して判定する実体は隣の check-emphasis.mjs。
# **道具が無ければ飛ばす。**強調記法はこの検査の付随物で、欠いても本来の目的
# （実在・形・重複・層）は達成できる。飛ばしたことは SKIP で出す。
emphasis_self=$(canon "$0") || emphasis_self=$0
# 既定はスクリプトの隣。test が異常系の checker を差し込めるように上書きを許す
EMPHASIS_JS=${EMPHASIS_JS:-$(dirname "$emphasis_self")/check-emphasis.mjs}
if ! command -v bun >/dev/null 2>&1; then
	emit SKIP emphasis "-" "note=bun が無いので強調記法を検査していない"
elif [ ! -f "$EMPHASIS_JS" ]; then
	emit SKIP emphasis "-" "note=$EMPHASIS_JS が無いので強調記法を検査していない"
else
	{
		cat "$WORK/unique"
		if [ -n "$DOCS_DIR" ]; then
			for f in "$DOCS_DIR"/*.md; do
				[ -f "$f" ] && printf 'docs/%s\t%s\n' "${f##*/}" "$f"
			done
		fi
	} >"$WORK/md_targets"
	bun "$EMPHASIS_JS" <"$WORK/md_targets" >"$WORK/emphasis" 2>"$WORK/emphasis_err"
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
exit 0
