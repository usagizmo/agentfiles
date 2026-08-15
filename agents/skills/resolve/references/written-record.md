# 書いた commit の記録

この claim が各着地面へ書いた commit の SHA。**再 plan で消さない**。plan の base 更新でも消さない。

証明の SSOT は `report` の `written`（`session-report.md`）。ここは書く側が `report` を出すまでに持つ記録。

## 形式

````markdown
<!-- written -->

```yaml
<owner>/<repo>:
  - <SHA>
```

<!-- /written -->
````

- 書き先は `same-branch.md`（claim 後は代表の Issue）
- 同じ marker のコメントを複数作らない。SHA を足すとき、0 件なら 1 つ作る。1 件なら書き換える。2 件以上なら書かずに記録不能
- 面ごとに SHA を足す。消さない。同じ SHA は重ねない
- 空の記録は作らない

## いつ書くか

`finish` のあと、その面の HEAD を足す。commit が 0 なら書かない。

## `report` へ写す

`report` を出すとき、この記録を `written` へ写す。解決できない SHA は落とす。書き直しの可否は `session-report.md`。
