// snapshot の issues 節を board 上の番号へ絞る。
//
// **行の形は変えない。**落とすのは board に無い番号だけ。残った列はそのまま。

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AWK = join(import.meta.dir, "../scripts/restrict-to-board.awk");

const restrict = async (board: string, lines: string): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "restrict-to-board-"));
  const boardPath = join(dir, "board");
  const linesPath = join(dir, "lines");
  await Promise.all([Bun.write(boardPath, board), Bun.write(linesPath, lines)]);
  const run = Bun.spawn(["awk", "-f", AWK, boardPath, linesPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    run.exited,
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
  ]);
  rmSync(dir, { recursive: true, force: true });
  if (code !== 0) throw new Error(err || `awk ${code}`);
  return out;
};

describe("issues を board 番号に絞る", () => {
  test("board に無い番号を落とす。残った行の形は変えない", async () => {
    const out = await restrict(
      "12\n34\n",
      "12 open 2026-08-12T00:00:00Z alice\n34 closed 2026-08-11T00:00:00Z\n99 open 2026-08-10T00:00:00Z\n",
    );
    expect(out).toBe("12 open 2026-08-12T00:00:00Z alice\n34 closed 2026-08-11T00:00:00Z\n");
  });

  test("board が空なら 1 行も残さない", async () => {
    const out = await restrict("", "12 open 2026-08-12T00:00:00Z\n");
    expect(out).toBe("");
  });
});
