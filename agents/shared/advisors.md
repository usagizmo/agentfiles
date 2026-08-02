# アドバイザー起動表

候補は Claude / Codex / Grok。**実行中の自分自身を除いた 2 つ**を起動する（再入防止）。自分が候補に無い harness や自分がどれか不確かな場合は Claude と Codex の 2 つ。

一言伝えてから、下の 3 ブロックから **選んだ 2 つだけ** を起動する（モデル / effort 上書きなし）。自分自身のブロックは実行しない。

**不変条件: アドバイザーにコードを変更させない。** Codex は `-s read-only`、Claude / Grok は `--permission-mode plan` で担保する（`--tools` は調査に使うツールの絞り込みであって担保ではない）。ブロックを追加・変更するときは同等の read-only 手段を必ず付ける。

## 原則: 起動と回収を分ける

アドバイザーは 10 分以上かかることがある。**1 回のコマンド実行の中で完了を待たない**。待つと harness 側のタイムアウトで実行ごと打ち切られ、片方しか回収できない。起動は呼び出し元 shell から切り離し、終了コードを `.rc` に残して、別コマンドで回収する。

- **shell 変数はコマンド間で保持されない**。`PROMPT` のパスを控え、以降の各コマンドの先頭で `PROMPT=<控えたパス>` を再設定する
- **やり直すときは `PROMPT` から作り直し、回収も新しいパスで行う**。`.rc` は起動時点で存在しない前提。古いパスを貼ると前回の `.rc` が即座に揃い、前回の出力を今回の結果として提示してしまう
- harness にバックグラウンド実行 / 監視機構があればそれを使ってよい（意味は同じ: 待ち受けでコマンドをブロックしない）

## 起動

各ブロックは単体で実行できる。`<控えたパス>` を必ず置換する（空・不正なら起動せずメッセージを返す）。

### Codex

```bash
PROMPT=<控えたパス>
[ -s "$PROMPT" ] && ( nohup sh -c 'codex exec -s read-only -o "$1.codex.out" - < "$1" >"$1.codex.log" 2>&1; echo $? >"$1.codex.rc"' _ "$PROMPT" >/dev/null 2>&1 & ) || echo "PROMPT が空 / 不正: 起動しない"
```

### Claude

```bash
PROMPT=<控えたパス>
[ -s "$PROMPT" ] && ( nohup sh -c 'claude -p --permission-mode plan --tools "Bash,Read,Grep,Glob" --output-format text < "$1" >"$1.claude.out" 2>"$1.claude.log"; echo $? >"$1.claude.rc"' _ "$PROMPT" >/dev/null 2>&1 & ) || echo "PROMPT が空 / 不正: 起動しない"
```

### Grok

```bash
PROMPT=<控えたパス>
[ -s "$PROMPT" ] && ( nohup sh -c 'grok --prompt-file "$1" --permission-mode plan --tools "Bash,Read,Grep,Glob" >"$1.grok.out" 2>"$1.grok.log"; echo $? >"$1.grok.rc"' _ "$PROMPT" >/dev/null 2>&1 & ) || echo "PROMPT が空 / 不正: 起動しない"
```

## 完了待ちと回収

`codex grok` を起動した 2 つの名前に置き換え、`.rc` が 2 つ揃うまで下を繰り返す（1 周 90 秒でブロックしないので打ち切られない。**変数に入れて展開しない**: シェルによっては 1 語のまま回る）。`running` の側は次の周回で回収する:

```bash
PROMPT=<控えたパス>
if [ ! -s "$PROMPT" ]; then echo "PROMPT が空 / 不正: 回収しない"; else
for _ in $(seq 18); do
  n=0; for a in codex grok; do [ -f "$PROMPT.$a.rc" ] && n=$((n + 1)); done
  [ "$n" -eq 2 ] && break
  sleep 5
done
for a in codex grok; do
  printf '=== %s (rc=%s) ===\n' "$a" "$(cat "$PROMPT.$a.rc" 2>/dev/null || echo running)"
  cat "$PROMPT.$a.out" 2>/dev/null
done
fi
```

先に終わった側は、もう一方を待つ間に読み進めてよい。

## 失敗時

- `rc` が 0 以外・`.out` が空 → `.log` を読んで原因を示す。片方失敗でも成功側で可。両方失敗なら確認
- 13 周（≒20 分）待っても `.rc` が出ない側は打ち切ってよい。その場合は **未完了であることと打ち切った理由を明示**し、成功側だけで統合する。1 つも揃わないなら確認
- 失敗・未完了は隠さない

## 出典表記

1 本に統合するとき、各論点に使ったアドバイザーの出典タグを付す（例: `[Codex+Grok]` / `[Codex]` / `[Grok]`）
