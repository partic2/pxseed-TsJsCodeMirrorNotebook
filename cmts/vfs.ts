import type * as ts from "typescript";
import * as path from "path";

import {SimpleFileSystem} from 'partic2/CodeRunner/JsEnviron'

// ============================================================
// 工厂参数与返回类型
// ============================================================
export interface AsyncMemorySystemOptions {
  fs: SimpleFileSystem;
  /** 是否区分大小写，默认 true。不建议改为 false（见文档） */
  useCaseSensitiveFileNames?: boolean;
  /** TextDecoder 编码，默认 'utf-8' */
  encoding?: string;
  /** writeFile 是否回写底层 fs，默认 false（纯缓存模式） */
  writeThrough?: boolean;
  /** ts.System.write 的回调，默认静默 */
  onWrite?: (s: string) => void;
}

export interface AsyncMemorySystem {
  /** 直接交给 ts.createProgram / ts.createLanguageService 使用 */
  readonly system: ts.System;
  /** 当前在途的异步加载任务（快照，每次读取都反映最新状态） */
  readonly pending: readonly Promise<unknown>[];
  /**
   * 循环 drain：等待所有当前 pending，包含加载过程中新产生的 pending。
   * 因为 loadTree / preloadDirectory 自身会把后续层级的加载任务挂进 pendingSet，
   * 一次 waitPending 即可把整棵目录树准备完毕。
   */
  waitPending(): Promise<void>;
  /**
   * 递归预热：一次调用就把整棵目录树加载进缓存。
   * 之后同步调用 system.readDirectory 即可拿到完整结果。
   */
  preloadDirectory(dirName: string, maxDepth?: number): Promise<void>;
  /** 直接写入缓存，不触发底层 IO（但会更新父目录的 dirCache 条目） */
  setFile(fileName: string, content: string): void;
  /** 标记某路径不存在，跳过后续加载 */
  setMissing(fileName: string): void;
  /** 清除某路径的所有缓存，下次访问会重新加载 */
  invalidate(fileName: string): void;
  readonly fs: SimpleFileSystem;
  readonly rootDir: string;
}

// ============================================================
// 工厂实现
// ============================================================
export async function createAsyncMemorySystem(
  options: AsyncMemorySystemOptions,
): Promise<AsyncMemorySystem> {
  const {
    fs: vfs,
    useCaseSensitiveFileNames = true,
    writeThrough = false,
    onWrite = () => {},
  } = options;

  const decoder = new TextDecoder(options.encoding ?? "utf-8");
  const encoder = new TextEncoder();
  const rootDir = '/';

  // ---------- 路径规范化 ----------
  const normalize = (p: string): string => {
    const resolved = path.posix.resolve(rootDir, p);
    return useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
  };

  /** 将规范化后的绝对 key 转换为相对 rootDir、传给底层 VFS 的路径 */
  const toFsPath = (absKey: string): string => {
    if (absKey === rootDir) return "";
    if (absKey.startsWith(rootDir + "/")) return absKey.slice(rootDir.length + 1);
    return absKey;
  };

  // ---------- 缓存与状态 ----------
  const fileCache = new Map<string, string>();
  const dirCache = new Map<string, Map<string, "file" | "dir">>();
  const missing = new Set<string>();
  const loading = new Map<string, Promise<void>>();
  const pendingSet = new Set<Promise<unknown>>();
  /**
   * 每个目录曾被请求展开到的最大深度。
   * - 未记录 = 从没展开过
   * - 数值 = 上次 readDirectory / preloadDirectory 请求的最大深度
   * - Infinity = 曾请求过整棵树
   */
  const requestedDepth = new Map<string, number>();

  function track(p: Promise<unknown>): void {
    pendingSet.add(p);
    p.then(
      () => pendingSet.delete(p),
      () => pendingSet.delete(p),
    );
  }

  // ---------- 单路径加载 ----------
  async function loadDirContents(key: string): Promise<void> {
    const list = await vfs.listdir(toFsPath(key));
    const map = new Map<string, "file" | "dir">();
    for (const e of list) {
      const name = useCaseSensitiveFileNames ? e.name : e.name.toLowerCase();
      map.set(name, e.type);
    }
    dirCache.set(key, map);
  }

  async function doLoad(key: string): Promise<void> {
    try {
      const t = await vfs.filetype(toFsPath(key));
      if (t === "file") {
        const data = await vfs.readAll(toFsPath(key));
        if (data) fileCache.set(key, decoder.decode(data));
        else missing.add(key);
      } else if (t === "dir") {
        await loadDirContents(key);
      } else {
        missing.add(key);
      }
    } catch {
      missing.add(key);
    }
  }

  function scheduleLoad(key: string): void {
    if (
      fileCache.has(key) ||
      dirCache.has(key) ||
      missing.has(key) ||
      loading.has(key)
    ) {
      return;
    }
    const promise = doLoad(key).finally(() => loading.delete(key));
    loading.set(key, promise);
    track(promise);
  }

  /** 确保某个路径已加载（命中缓存 / loading / 三种状态之一），返回对应的 promise */
  function ensureLoaded(key: string): Promise<void> {
    if (fileCache.has(key) || dirCache.has(key) || missing.has(key)) {
      return Promise.resolve();
    }
    const existing = loading.get(key);
    if (existing) return existing;
    scheduleLoad(key);
    // scheduleLoad 一定会把 promise 放进 loading（前面已排除三种缓存命中）
    return loading.get(key)!;
  }

  // ---------- 递归树加载 ----------
  /**
   * 加载以 rootKey 为根、深度至多 maxDepth 的整棵目录树。
   * 每次 await 子目录加载后，会把下一层子目录加入队列继续。
   * 本函数作为单个 pending 任务存在，所以一次 waitPending 即可完成整棵树。
   */
  async function loadTree(rootKey: string, maxDepth: number): Promise<void> {
    const queue: Array<{ key: string; depth: number }> = [
      { key: rootKey, depth: maxDepth },
    ];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const batch = queue.splice(0);
      await Promise.all(batch.map((item) => ensureLoaded(item.key)));

      for (const item of batch) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        if (item.depth <= 0) continue;

        const d = dirCache.get(item.key);
        if (!d) continue;
        for (const [name, t] of d) {
          if (t === "dir") {
            queue.push({
              key: path.posix.join(item.key, name),
              depth: item.depth - 1,
            });
          }
        }
      }
    }
  }

  // ---------- drain ----------
  async function waitPending(): Promise<void> {
    while (pendingSet.size > 0) {
      await Promise.all(Array.from(pendingSet));
    }
  }

  // ---------- glob ----------
  function globToRegExp(pattern: string): RegExp {
    if (pattern.startsWith("./")) pattern = pattern.slice(2);
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "*" && pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else if (c === "*") out += "[^/]*";
      else if (c === "?") out += "[^/]";
      else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp("^" + out + "$", useCaseSensitiveFileNames ? "" : "i");
  }

  // ---------- 辅助：更新父目录条目 ----------
  /** 在 dirCache 的父目录 map 中登记这个 key 为文件（若父目录已加载） */
  function putFileEntry(key: string): void {
    const parent = path.posix.dirname(key);
    const parentMap = dirCache.get(parent);
    if (parentMap) {
      const base = path.posix.basename(key);
      parentMap.set(useCaseSensitiveFileNames ? base : base.toLowerCase(), "file");
    }
  }

  // ---------- ts.System ----------
  const system: ts.System = {
    args: [],
    newLine: "\n",
    useCaseSensitiveFileNames,

    // ===== 文件存在性 =====
    fileExists: (fileName) => {
      const key = normalize(fileName);
      if (fileCache.has(key)) return true;
      if (missing.has(key) || dirCache.has(key)) return false;
      scheduleLoad(key);
      return false;
    },

    // ===== 读取 =====
    readFile: (fileName) => {
      const key = normalize(fileName);
      const c = fileCache.get(key);
      if (c !== undefined) return c;
      if (missing.has(key) || dirCache.has(key)) return undefined;
      scheduleLoad(key);
      return undefined;
    },

    // ===== 目录存在性 =====
    directoryExists: (dirName) => {
      const key = normalize(dirName);
      if (key === rootDir) return true;
      if (dirCache.has(key)) return true;
      if (missing.has(key) || fileCache.has(key)) return false;
      scheduleLoad(key);
      return false;
    },

    // ===== 直接子目录列表 =====
    getDirectories: (dirName) => {
      const key = normalize(dirName);
      const d = dirCache.get(key);
      if (!d) {
        if (!missing.has(key) && !fileCache.has(key)) scheduleLoad(key);
        return [];
      }
      const out: string[] = [];
      for (const [name, t] of d) if (t === "dir") out.push(name);
      return out;
    },

    // ===== 递归列举 =====
    readDirectory: (dirPath, extensions, excludes, includes, depth) => {
      const base = normalize(dirPath);
      const maxDepth = depth === undefined ? Infinity : depth;
    
      const prev = requestedDepth.get(base) ?? -1;
      if (prev < maxDepth) {
        requestedDepth.set(base, maxDepth);
        track(loadTree(base, maxDepth).catch(() => {}));
      }
    
      const extSet = extensions?.map((e) => e.toLowerCase());
      const includeRes = (includes ?? []).map(globToRegExp);
      const excludeRes = (excludes ?? []).map(globToRegExp);
      const result: string[] = [];
    
      const walk = (dirKey: string, relPrefix: string, level: number) => {
        const d = dirCache.get(dirKey);
        if (!d) return;
        for (const [name, t] of d) {
          const rel = relPrefix ? relPrefix + "/" + name : name;
          if (t === "dir") {
            if (level < maxDepth) walk(path.posix.join(dirKey, name), rel, level + 1);
            continue;
          }
          if (extSet && extSet.length > 0) {
            const ext = path.posix.extname(name).toLowerCase();
            if (!extSet.includes(ext)) continue;
          }
          if (includeRes.length > 0 && !includeRes.some((r) => r.test(rel))) continue;
          if (excludeRes.some((r) => r.test(rel))) continue;
    
          // 关键：返回绝对路径，与 ts.sys 对齐
          result.push(path.posix.join(base, rel));
        }
      };
    
      walk(base, "", 0);
      return result;
    },

    // ===== 写入 =====
    writeFile: (fileName, data) => {
      const key = normalize(fileName);
      fileCache.set(key, data);
      missing.delete(key);
      dirCache.delete(key);
      putFileEntry(key);
      if (writeThrough) {
        track(vfs.writeAll(toFsPath(key), encoder.encode(data)));
      }
    },

    // ===== 路径 =====
    getCurrentDirectory: () => rootDir,
    resolvePath: (p) => path.posix.resolve(rootDir, p),
    getExecutingFilePath: () => path.posix.join(rootDir, "tsc.js"),
    realpath: (p) => path.posix.resolve(rootDir, p),

    // ===== 控制台 =====
    write: (s) => onWrite(s),
    writeOutputIsTTY: () => false,
    exit: (code) => {
      throw new Error(`System.exit(${code})`);
    },

    // ===== 监听（内存系统不做事件源，空实现安全兜底） =====
    watchFile: () => ({ close: () => {} }),
    watchDirectory: () => ({ close: () => {} }),

    // ===== 其他 =====
    createDirectory: (dirName) => {
      const key = normalize(dirName);
      if (!dirCache.has(key)) dirCache.set(key, new Map());
      missing.delete(key);
    },

    setTimeout: (cb, ms, ...args) => setTimeout(cb, ms, ...args) as any,
    clearTimeout: (id) => clearTimeout(id as any),
  };

  // ---------- 对外辅助方法 ----------
  const preloadDirectory = async (
    dirName: string,
    maxDepth: number = Infinity,
  ): Promise<void> => {
    const key = normalize(dirName);
    const prev = requestedDepth.get(key) ?? -1;
    if (prev >= maxDepth) return;
    requestedDepth.set(key, Math.max(prev, maxDepth));
    await loadTree(key, maxDepth);
  };

  return {
    system,
    get pending() {
      return Array.from(pendingSet);
    },
    waitPending,
    preloadDirectory,

    setFile(fileName, content) {
      const key = normalize(fileName);
      fileCache.set(key, content);
      missing.delete(key);
      dirCache.delete(key);
      putFileEntry(key);
    },

    setMissing(fileName) {
      const key = normalize(fileName);
      missing.add(key);
      fileCache.delete(key);
      dirCache.delete(key);
      requestedDepth.delete(key);
    },

    invalidate(fileName) {
      const key = normalize(fileName);
      fileCache.delete(key);
      dirCache.delete(key);
      missing.delete(key);
      requestedDepth.delete(key);
    },

    fs: vfs,
    rootDir,
  };
}