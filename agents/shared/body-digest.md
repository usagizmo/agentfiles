# Issue 本文の digest

**本文が変わったことを別セッションが検知するための指紋。**`resolve` の `plan`（`issueDigests`）と
`refine` の `ready`（`issueDigest`）が書き、上位のキュー管理が現在の本文と突き合わせる。

**書く側と読む側が別セッションなので、取り方が揃っていないと一致判定が一意にならない。**
だから 1 箇所に置く。

## 取り方

**API が返す本文の文字列をそのまま UTF-8 で SHA-256。正規化しない。**

**`gh api --jq .body | shasum` を使わない。**`--jq` は出力に改行を足すので、本文が改行で
終わっていると本物の本文と別の値になり、**書いた瞬間から永久に不一致**になる。
JSON の `body` をそのまま渡す。

```bash
gh api "repos/$REPO/issues/$N" --jq . > issue.json
python3 -c "
import json,hashlib
b=json.load(open('issue.json'))['body']
print(hashlib.sha256(b.encode('utf-8')).hexdigest())
"
```

## 扱い

- **キーが無いものは不一致として扱う**（fail-closed）
- **`updatedAt` で代用しない。**コメントを付けただけでも動くので、記録を書いた瞬間に
  不一致になって収束しない
- **本文を更新したら、更新後の本文を取り直してから計算する。**自分の更新で即座に不一致になる
