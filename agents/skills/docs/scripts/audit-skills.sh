#!/bin/sh
# skill 群の機械検査。品質パスがレビュアーへ渡す材料を作る。
#
#   sh audit-skills.sh [SKILLS_ROOT]     既定 ~/.agents/skills
#
# 出力は TSV 1 行 1 件: <LEVEL> <check> <location> <detail>
#   VIOLATION  規約違反。レビューへ出す前に直す
#   REVIEW     候補。機械では意味を判定できないので、棄却可否はレビュアーが判定する
# location は `<path>:<行>`。行を持たない検査（shared）はパスだけ、複数箇所を
# 1 行へ畳む検査（numeric / marker）は集約キーが入り、位置は detail の at= に
# 並ぶ（at= は同じ行を畳むので count とは一致しない）。
# exit 0=違反なし / 1=VIOLATION あり / 2=検査自体が実行できない

set -u

# 日本語の見出し・単位はバイト列として扱う。awk の index/substr が
# ロケールによって文字単位になると、多バイト境界の計算がずれる。
LC_ALL=C
export LC_ALL

# 層。参照は上位層 → 下位層の一方通行なので、rank が自分以下の skill を
# 名指ししたら違反。未知の skill は leaf 扱いになる。
# **leaf 以外に skill を足したらここへ書く。**書き忘れると leaf 扱いになり、
# 正しい下位層参照が VIOLATION に見えて、文書の方を壊す圧力になる。
# 層の機械可読な定義はここが唯一（agents/docs/ の図はここからの導出）。
rank() {
	case "$1" in
	conductor) echo 1 ;;
	refine | resolve) echo 2 ;;
	finish) echo 3 ;;
	*) echo 4 ;;
	esac
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

# --- root ---------------------------------------------------------------
# root 自体が dir symlink（`~/.agents/skills` が repo を指す）でも、canon が返す
# 物理パスと突き合わせられるように正規化する。投影前後で出力を同じにするため。
ROOT_ARG=${1:-$HOME/.agents/skills}
[ -d "$ROOT_ARG" ] || fatal "skills root が無い: $ROOT_ARG"
ROOT=$(CDPATH= cd -P -- "$ROOT_ARG" 2>/dev/null && pwd -P) || fatal "root を解決できない: $ROOT_ARG"

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
		esac
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
# 単位付きの値だけを拾い、正規化キーごとに 1 行へ集約する。
# 大小での足切りはしない（`2 巡` `300 行` のような実際の既定値が落ちる）。
# 落とすのは「1 + 助数詞」だけ。これは既定値ではなく散文の数え方で
# （`1 件を扱う skill` `理由を 1 行残す` `1 本で直す`）、恒久的に同じ行が
# レビュアーへ流れると索引ごと読まれなくなる。
: >"$WORK/nums"
while IFS="	" read -r disp phys; do
	awk -v disp="$disp" '{
		while (match($0, /[0-9]+k?[ ]?(分|秒|時間|日|件|行|本|回|巡|個|箇所|文字|tokens)/)) {
			key = substr($0, RSTART, RLENGTH)
			gsub(/ /, "", key)
			$0 = substr($0, RSTART + RLENGTH)
			if (key ~ /^1(件|行|本|回|巡|個|箇所|文字)$/) continue
			print key "\t" disp ":" NR
		}
	}' "$phys" >>"$WORK/nums"
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
# 規約は `skills/<name>/references/<file>` → `../../../shared/<同名>`。
: >"$WORK/shared_use"
for d in "$ROOT"/*/references; do
	[ -d "$d" ] || continue
	skill=${d%/references}
	skill=${skill##*/}
	for f in "$d"/*; do
		[ -L "$f" ] || continue
		b=${f##*/}
		disp="$skill/references/$b"
		t=$(readlink "$f")
		case "$t" in
		*shared/*) ;;
		*)
			emit REVIEW shared "$disp" "target=$t note=shared 以外を指す symlink"
			continue
			;;
		esac
		[ "$t" = "../../../shared/$b" ] ||
			emit VIOLATION shared "$disp" "target=$t want=../../../shared/$b"
		if p=$(canon "$f") && [ -f "$p" ]; then
			echo "${p##*/}	$skill" >>"$WORK/shared_use"
		else
			emit VIOLATION shared "$disp" "target=$t note=解決先が無い"
		fi
	done
done

# shared dir は規約（`references/<file>` → `../../../shared/<file>`）から直に組み立てる。
# 生きた symlink から逆引きすると、全部コピーへ置き換わった一番効くべき状況で
# 探索が空振りし、以降の検査ごと素通りする。
SHARED_DIR=$(CDPATH= cd -P -- "$ROOT/../shared" 2>/dev/null && pwd -P) || SHARED_DIR=""
if [ -z "$SHARED_DIR" ]; then
	# 黙って飛ばさない。検査を落としたまま「違反なし」に見えるのを防ぐ。
	emit REVIEW shared "../shared" "note=shared dir が無く copy / 孤児検査を実行していない"
else
	# 使う skill が 2 つ未満なら shared に置く条件を満たさない。実体の側から
	# 数える — symlink 側からだと、最後の利用者が消えた孤児が 0 件で素通りする。
	for s in "$SHARED_DIR"/*.md; do
		[ -f "$s" ] || continue
		printf '%s\t\n' "${s##*/}" >>"$WORK/shared_use"
	done
fi

sort -u "$WORK/shared_use" | awk -F "	" '
	{ if ($2 != "") { n[$1]++; u[$1] = u[$1] (u[$1] == "" ? "" : ",") $2 } else if (!($1 in n)) n[$1] += 0 }
	END { for (k in n) if (n[k] < 2) print k "\t" n[k] "\t" (u[k] == "" ? "-" : u[k]) }
' | sort | while IFS="	" read -r file n users; do
	emit REVIEW shared "shared/$file" "users=$n at=$users note=2 skill 未満"
done

# shared に同名の実体があるのに references 側が通常ファイル = コピーによる重複。
if [ -n "$SHARED_DIR" ]; then
	for d in "$ROOT"/*/references; do
		[ -d "$d" ] || continue
		skill=${d%/references}
		skill=${skill##*/}
		for f in "$d"/*.md; do
			[ -f "$f" ] || continue
			[ -L "$f" ] && continue
			b=${f##*/}
			[ -f "$SHARED_DIR/$b" ] &&
				emit VIOLATION shared "$skill/references/$b" "note=shared/$b の実体があるのに通常ファイル"
		done
	done
fi

# --- 出力 ---------------------------------------------------------------
LC_ALL=C sort "$FINDINGS"
v=$(grep -c '^VIOLATION	' "$FINDINGS")
r=$(grep -c '^REVIEW	' "$FINDINGS")
printf 'SUMMARY\troot=%s\tviolations=%s\treviews=%s\n' "$ROOT_ARG" "$v" "$r"

[ "$v" -gt 0 ] && exit 1
exit 0
