# 第 1 入力: board 上の Issue 番号（1 列）
# 第 2 入力: 先頭列が番号の行
#
# **board に無い行を落とす。**行の形は変えない。落としているのは遷移を駆動しない
# 部分集合（board 外の Issue）であって、観測項目ではない。
NR == FNR {
  board[$1] = 1
  next
}
$1 in board
