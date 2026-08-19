#!/usr/bin/env python3
"""snapshot の issues 行。`updated_at` ではなく本文 digest。"""

from __future__ import annotations

import hashlib
import json
import sys


def digest(body: object) -> str:
    if body is None:
        body = ""
    if not isinstance(body, str):
        raise SystemExit("issue body が文字列ではない")
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def main() -> None:
    raw = sys.stdin.read()
    try:
        issues = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"issues JSON を読めない: {error}") from error
    if not isinstance(issues, list):
        raise SystemExit("issues JSON が array ではない")
    for issue in issues:
        if not isinstance(issue, dict):
            raise SystemExit("issues の要素が object ではない")
        if issue.get("pull_request") is not None:
            continue
        number = issue.get("number")
        state = issue.get("state")
        if not isinstance(number, int) or not isinstance(state, str):
            raise SystemExit("issue の number / state が無い")
        logins: list[str] = []
        for assignee in issue.get("assignees") or []:
            if isinstance(assignee, dict) and isinstance(assignee.get("login"), str):
                logins.append(assignee["login"])
        assignees = ",".join(sorted(logins))
        print(f"{number} {state} {digest(issue.get('body'))} {assignees}")


if __name__ == "__main__":
    main()
