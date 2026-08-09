import type { ChangeTypes, FileDiffMetadata } from "@pierre/diffs";
import type { StageSection } from "../shared/types.ts";

export interface FileEntry {
  id: string;
  name: string;
  prevName?: string;
  type: ChangeTypes;
  additions: number;
  deletions: number;
}

const PREFIXES = ["staged:", "unstaged:", "file:"] as const;

/** 同じパスがステージ済みと未ステージの両方に出るので、ID は section で分ける。 */
export function itemId(section: StageSection, path: string): string {
  return `${section}:${path}`;
}

export function fileItemId(path: string): string {
  return `file:${path}`;
}

/** `itemId()` / `fileItemId()` の逆。CodeView のコールバックはアイテム ID しかくれない。 */
export function pathOfItem(id: string): string {
  for (const prefix of PREFIXES) {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
}

/** ファイル 1 件分の +/- 行数を hunk から数える。 */
export function toFileEntry(section: StageSection, file: FileDiffMetadata): FileEntry {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return {
    id: itemId(section, file.name),
    name: file.name,
    prevName: file.prevName,
    type: file.type,
    additions,
    deletions,
  };
}

export const CHANGE_LABEL: Record<ChangeTypes, string> = {
  new: "A",
  deleted: "D",
  change: "M",
  "rename-pure": "R",
  "rename-changed": "R",
};
