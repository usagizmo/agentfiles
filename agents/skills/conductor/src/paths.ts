// conductor が書く状態 file の既定 path。**エージェントには渡さない。**
// checkout ごとに違うので、設定にも tracked ファイルにも置かない。

import { homedir } from "node:os";
import { join } from "node:path";

export const stateDir = (): string => {
  const xdg = process.env["XDG_STATE_HOME"];
  return xdg !== undefined && xdg !== ""
    ? join(xdg, "agents")
    : join(homedir(), ".local/state/agents");
};

export const defaultOverlayPath = (): string => join(stateDir(), "conductor-overlay.json");
export const defaultJournalPath = (): string => join(stateDir(), "conductor-journal.ndjson");
export const defaultBoardPath = (): string => join(stateDir(), "conductor-board.json");
export const defaultScorePath = (): string => join(stateDir(), "scores/conductor.html");
