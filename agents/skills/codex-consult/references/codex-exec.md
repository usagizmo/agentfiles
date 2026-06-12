# Codex が使えないとき

codex-consult / codex-review-loop 共通のエラー対応。

- `codex: command not found` → Codex 未インストール。ユーザーに伝え、Codex の確認なしで進めてよいか確認する
- 認証エラー → `codex login` が必要。ユーザーに案内する
- それ以外のエラー → エラー内容を伝え、実行中のエージェント自身の判断で進める（Codex が落ちても判断は止めない）

いずれの場合も、Codex の確認を取れなかった事実は隠さずユーザーに伝える。
