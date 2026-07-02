# Claude Code グローバルルール

ユーザー全体の共通ルールは下記 import で読み込む。本ファイルには Claude Code 固有のルールのみを記載する。

@~/.agents/AGENTS.md

## モデルと subagent の使い分け

プランニングと全体の調整はメインの agent が担う。きれいな subtask として切り出せる作業は、Sonnet の subagent（Agent tool の `model: "sonnet"`）に任せる。

各 subagent には、明確なゴール・関連コンテキスト・持ち帰ってほしい成果物を渡す。プランを subagent に考えさせない。独立した作業は並列で走らせる。

subagent が戻ってきたら、結果をレビューしてから取り込む。問題があれば、brief を書き直して別の subagent を立て直す。自分で黙って継ぎ接ぎ修正しない（自明な修正のみ例外）。
