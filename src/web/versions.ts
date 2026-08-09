import { useRef } from "react";

/**
 * 「中身が本当に変わったときだけ増える」バージョン番号を配る。
 *
 * CodeView はアイテムの `id` + `version` でしか更新を判定しないので、逆に言えば
 * version さえ据え置けば触らない。差分を取り直すたびに全アイテムの version を
 * 上げていると、1 ファイル直しただけで表示中の全ファイルが再ハイライトされる。
 */
export interface ContentVersions {
  /** `key` の内容ハッシュを渡すと、その内容に対応するバージョンが返る。 */
  versionOf(key: string, hash: number): number;
}

interface Entry {
  hash: number;
  version: number;
}

export function useContentVersions(): ContentVersions {
  const entries = useRef(new Map<string, Entry>());

  return {
    versionOf(key, hash) {
      const current = entries.current.get(key);
      // ハッシュが同じなら何もしない = StrictMode の二重呼び出しでも増えない
      if (current !== undefined && current.hash === hash) return current.version;
      const next: Entry = { hash, version: (current?.version ?? 0) + 1 };
      entries.current.set(key, next);
      return next.version;
    },
  };
}

/** FNV-1a。衝突耐性より速さ優先で、再ハイライトの要否判定にだけ使う。 */
export function hashStrings(parts: Iterable<string>): number {
  let hash = 0x81_1c_9d_c5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 0x01_00_01_93);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
}
