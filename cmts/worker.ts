//worker.ts
import { RpcSerializeMagicMark } from "partic2/pxprpcClient/pxseedremotefuncs";
import ts from 'typescript'
import { type Diagnostic, type LintSource } from "partic2/codemirror2026/prebuilt/@codemirror-lint";
import { assert, GetCurrentTime, logger, requirejs } from "partic2/jsutils1/base";
import { getWWWRoot, path } from "partic2/jsutils1/webutils";
import { defaultFileSystem, ensureDefaultFileSystem, getSimpleFileSysteNormalizedWWWRoot } from "partic2/CodeRunner/JsEnviron";
import { buildTjs } from "partic2/tjshelper/tjsbuilder";
import { utf8conv } from "partic2/CodeRunner/jsutils2";
import { AsyncMemorySystem, createAsyncMemorySystem } from "./vfs";

let __name__ = requirejs.getLocalRequireModule(require);
let log = logger.getLogger(__name__);

// ---------- 路径工具 ----------
// webutils.path 兼容 Node path，优先用 posix 语义避免 Windows 分隔符
const P: {
    join: (...parts: string[]) => string;
    dirname: (p: string) => string;
    basename: (p: string) => string;
} = (path as any).posix ?? path;

/** 把 VFS 内的绝对路径转成传给 SimpleFileSystem 的路径（相对 dataDir） */
function absToFsPath(absPath: string, rootDir: string): string {
    const r = rootDir.replace(/\/+$/, '');
    if (absPath === r) return '';
    if (absPath.startsWith(r + '/')) return absPath.slice(r.length + 1);
    return absPath;
}

// ---------- 诊断转换 ----------
function isDiagnosticWithLocation(
    diagnostic: ts.Diagnostic,
): diagnostic is ts.DiagnosticWithLocation {
    return !!(
        diagnostic.file &&
        typeof diagnostic.start === "number" &&
        typeof diagnostic.length === "number"
    );
}

function tsDiagnosticMessage(
    diagnostic: Pick<ts.Diagnostic, "messageText">,
): string {
    if (typeof diagnostic.messageText === "string") {
        return diagnostic.messageText;
    }
    return diagnostic.messageText.messageText;
}

function convertTSDiagnosticToCM(
    d: ts.DiagnosticWithLocation,
): Diagnostic {
    const start = d.start;
    const message = tsDiagnosticMessage(d);

    return {
        from: start,
        to: start + d.length,
        message: message,
        severity: tsCategoryToSeverity(d),
    };
}

function tsCategoryToSeverity(
    diagnostic: Pick<ts.DiagnosticWithLocation, "category" | "code">,
): Diagnostic["severity"] {
    if (diagnostic.code === 7027) {
        return "warning";
    }
    switch (diagnostic.category) {
        case ts.DiagnosticCategory.Error:
            return "error";
        case ts.DiagnosticCategory.Message:
            return "info";
        case ts.DiagnosticCategory.Warning:
            return "warning";
        case ts.DiagnosticCategory.Suggestion:
            return "info";
    }
}

const ExternalLiteralMagicMark = '@@ExternalLiteralMagicMark@@';

type AsyncMethod<F> = F extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : F;

type AsyncProxy<T> = {
    [K in keyof T]: AsyncMethod<T[K]>;
};

type Invoker = (
    originalFn: (...args: any[]) => any,
    thisArg: any,
    args: any[]
) => Promise<any> | any;

export function createAsyncProxy<T extends object>(
    target: T,
    invoker: Invoker
): AsyncProxy<T> {
    return new Proxy(target, {
        get(t, prop, receiver) {
            const value = Reflect.get(t, prop, receiver);
            if (typeof value !== 'function') {
                return value;
            }
            return (...args: any[]) =>
                Promise.resolve(invoker(value as (...args: any[]) => any, t, args));
        },
    }) as AsyncProxy<T>;
}

class NodeLanguageServerEnvironment {
    [RpcSerializeMagicMark] = {}
    lsHost?: ts.LanguageServiceHost
    languageService?: AsyncProxy<ts.LanguageService>
    openedScripts = new Map<string, { version: string, snapshot?: ts.IScriptSnapshot }>();
    compileSetting: ts.CompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        lib: ["lib.dom.d.ts", "lib.es2021.d.ts"],
        jsx: ts.JsxEmit.React,
        paths: {},
    }
    projectVersion = 0;
    pxseedLibBaseDir = '';
    sys!: ts.System;
    vfs?: AsyncMemorySystem

    async waitPending(): Promise<{ fileSystemChanged: boolean }> {
        if (this.vfs != undefined) {
            if (this.vfs.pending.length > 0) {
                await this.vfs.waitPending();
                this.projectVersion++;
                return { fileSystemChanged: true };
            }
        }
        return { fileSystemChanged: false };
    }

    async initializeVfs() {
        await ensureDefaultFileSystem();
        await defaultFileSystem!.ensureInited();
        this.vfs = await createAsyncMemorySystem({ fs: defaultFileSystem! })
        this.sys = this.vfs.system;
    }

    async initialize() {
        await this.initializeVfs();
        if (this.sys == undefined) {
            this.sys = ts.sys;
        }
        this.pxseedLibBaseDir = path.join(getSimpleFileSysteNormalizedWWWRoot(), '..', 'source');
        if (this.compileSetting.paths!['*'] == undefined) {
            this.compileSetting.paths!['*'] = [this.pxseedLibBaseDir + '/*'];
        }
        this.lsHost = {
            getProjectVersion: () => String(this.projectVersion),
            getScriptFileNames: () => Array.from(this.openedScripts.keys()),
            getScriptVersion: (fileName) => {
                let t1 = this.openedScripts.get(fileName);
                if (t1 == undefined) {
                    return '1';
                } else {
                    return t1.version;
                }
            },
            getScriptSnapshot: (fileName) => {
                let s = this.openedScripts.get(fileName);
                if (s != undefined) {
                    return s.snapshot
                }
                if (!this.sys.fileExists(fileName)) return undefined;
                return ts.ScriptSnapshot.fromString(this.sys.readFile(fileName) ?? '');
            },
            getCurrentDirectory: () => this.vfs?.rootDir ?? process.cwd(),
            getCompilationSettings: () => this.compileSetting,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: (path) => {
                if (this.openedScripts.has(path)) {
                    return true;
                }
                return this.sys.fileExists(path);
            },
            readFile: this.sys.readFile,
            readDirectory: (...argv: any[]) => {
                return (this.sys.readDirectory as any)(...argv);
            }
        };
        this.languageService = createAsyncProxy(ts.createLanguageService(this.lsHost), async (fn, thisArg, args) => {
            let result = undefined;
            do {
                result = await fn.apply(thisArg, args);
            } while ((await this.waitPending()).fileSystemChanged)
            return result;
        });
        return this;
    }

    async getSignaturesFromSymbol(
        path: string,
        pos: number,
    ): Promise<{ signature: string; documentation: string }[]> {
        const ls = this.languageService;
        const program = await ls?.getProgram();
        if (!ls || !program) return [];

        try {
            const sourceFile = program.getSourceFile(path);
            if (!sourceFile) return [];

            const checker = program.getTypeChecker();
            const node = this.findNodeAtPosition(sourceFile, pos);
            if (!node) return [];

            let target: ts.Node | undefined = node;
            if (ts.isCallExpression(node)) target = node.expression;
            else if (ts.isIdentifier(node)) target = node;
            else if (node.parent && ts.isCallExpression(node.parent))
                target = node.parent.expression;

            if (!target) return [];

            const symbol = checker.getSymbolAtLocation(target);
            if (!symbol) return [];

            const type = checker.getTypeOfSymbolAtLocation(symbol, target);
            const signatures = type.getCallSignatures();
            if (signatures.length === 0) return [];

            return signatures.map((sig) => {
                const sigText = checker.signatureToString(
                    sig,
                    target,
                    ts.TypeFormatFlags.NoTruncation |
                    ts.TypeFormatFlags.WriteArrowStyleSignature,
                );
                const docs = sig.getDocumentationComment(checker);
                const docText = ts.displayPartsToString(docs);
                return { signature: sigText, documentation: docText };
            });
        } catch (e) {
            log.error(e);
            return [];
        }
    }

    findNodeAtPosition(
        sourceFile: ts.SourceFile,
        pos: number,
    ): ts.Node | undefined {
        function find(node: ts.Node): ts.Node | undefined {
            if (pos < node.getFullStart() || pos >= node.getEnd()) return undefined;
            let result: ts.Node | undefined;
            node.forEachChild((child) => {
                const r = find(child);
                if (r) result = r;
            });
            return result ?? node;
        }
        return find(sourceFile);
    }

    async getSourceFile(fileName: string): Promise<ts.SourceFile | undefined> {
        let r = (await this.languageService?.getProgram())?.getSourceFile(fileName)
        return r;
    }

    updateFile(fileName: string, content: string, range?: [number, number]) {
        this.projectVersion++;
        let f = this.openedScripts.get(fileName);
        if (f == undefined) {
            let t1 = ts.ScriptSnapshot.fromString(content);
            this.openedScripts.set(fileName, { version: String(GetCurrentTime().getTime()), snapshot: t1 });
        } else if (range == undefined) {
            let t1 = ts.ScriptSnapshot.fromString(content);
            f.snapshot = t1;
            f.version = String(GetCurrentTime().getTime())
        } else {
            let text = f.snapshot!.getText(0, f.snapshot!.getLength());
            text = text.substring(0, range[0]) + content + text.substring(range[1])
            f.snapshot = ts.ScriptSnapshot.fromString(text);
            f.version = String(GetCurrentTime().getTime())
        }
    }

    deleteFile(fileName: string) {
        if (this.openedScripts.has(fileName)) {
            this.openedScripts.delete(fileName);
        }
        this.sys.deleteFile?.(fileName);
    }
}

export interface TsServerNameDefinition {
    uri: string,
    name: string,
    span: [number, number],
    summary: string
}

interface CustomModuleExports {
    mtimeMs: number;
    getCompletions?: () => any[];
    validate?: (value: unknown) => string | null | undefined;
}


// ============================================================
// 外部字面量类型注册表
// ============================================================
export let externalLiteralTypeRegistry = new Map<string, {
    getAutocompletion?:(a0:{
        uri: string,
        pos: number,
        explicit: boolean,
        tsserver: TsServerWorker,
        node: ts.StringLiteral
    }) => Promise<Array<{label: string, kind?: string, details?: string}>>
}>();

/**
 * DefaultSimpleFileSystemPath：通过 defaultFileSystem.listdir 做文件/目录路径补全。
 *
 * 语义：
 *  - 光标前的路径片段按 `/` 切分为 dirPart + prefix
 *  - dirPart 为空 → 列当前文件所在目录
 *  - dirPart 以 `/` 开头 → 相对 VFS 根（rootDir）
 *  - dirPart 以 `./` / `../` 开头或其他 → 相对当前文件所在目录
 *  - 返回 label 是完整路径（因为主流程把替换范围设为字面量内部起点）
 */
externalLiteralTypeRegistry.set('DefaultSimpleFileSystemPath', {
    async getAutocompletion({ node, tsserver, pos }) {
        const env = tsserver.env;
        const vfs = env?.vfs;
        if (!env || !vfs || !defaultFileSystem) return [];

        const sourceFile = node.getSourceFile();
        const contentStart = node.getStart() + 1;
        const stringEnd = node.getEnd() - 1;
        // 钳制光标到字面量内部，避免落在引号外
        const cursorPos = Math.max(contentStart, Math.min(pos, stringEnd));
        // 直接从源码截取，避免 node.text 的 escape 解码导致偏移错位
        const partialPath = sourceFile.text
            .slice(contentStart, cursorPos)
            .replace(/\\/g, '/');

        const lastSep = partialPath.lastIndexOf('/');
        const dirPart = lastSep >= 0 ? partialPath.slice(0, lastSep + 1) : '';
        const prefix = partialPath.slice(lastSep + 1);

        const rootDir = vfs.rootDir.replace(/\/+$/, '');
        const currentDir = P.dirname(sourceFile.fileName.replace(/\\/g, '/'));

        // 计算要列出的绝对目录
        let absDir: string;
        if (dirPart === '') {
            absDir = currentDir;
        } else if (dirPart.startsWith('/')) {
            // 以 `/` 开头视为相对 VFS 根
            absDir = P.join(rootDir, dirPart.replace(/^\/+/, ''));
        } else {
            // 相对当前文件（含 ./ ../ 和普通相对）
            absDir = P.join(currentDir, dirPart);
        }
        // 规范化：去掉尾部分隔符，处理 .. 等
        absDir = P.dirname(P.join(absDir, '__placeholder__.tmp'));

        // 转成传给 SimpleFileSystem 的路径（相对 dataDir）
        const fsDir = absToFsPath(absDir, rootDir);

        let list: Array<{ name: string; type: 'dir' | 'file' }>;
        try {
            list = await defaultFileSystem.listdir(fsDir);
        } catch (e) {
            log.warning('DefaultSimpleFileSystemPath listdir failed', fsDir, e);
            return [];
        }

        const lowerPrefix = prefix.toLowerCase();
        const entries: Array<{ label: string; kind: string }> = [];

        for (const item of list) {
            if (lowerPrefix && !item.name.toLowerCase().startsWith(lowerPrefix)) continue;
            const isDir = item.type === 'dir';
            entries.push({
                // 完整路径：dirPart + 名字（目录带尾部斜杠，便于继续下钻）
                label: dirPart + item.name + (isDir ? '/' : ''),
                kind: isDir ? 'directory' : 'file',
            });
        }

        return entries;
    }
});

// ============================================================
// TsServerWorker
// ============================================================
export class TsServerWorker {
    [RpcSerializeMagicMark] = {};
    initialized = false;
    env?: NodeLanguageServerEnvironment;

    constructor(env: NodeLanguageServerEnvironment) {
        this.env = env;
    }

    async initialize() {
        await this.env!.initialize();
        this.initialized = true;
        return this;
    }

    protected convertUriToPath(uri: string) {
        assert(uri.startsWith('file:///'));
        if (!getWWWRoot().startsWith('/')) {
            //on Windows?
            uri = uri.substring(8);
        } else {
            uri = uri.substring(7);
        }
        return uri;
    }

    protected convertPathBacktoUri(path: string) {
        if (!path.startsWith('/')) {
            path = '/' + path;
            path = path.replace(/\\/g, '/');
        }
        return 'file://' + path;
    }

    // ---------------------------------------------------------------------
    // 上下文分析
    // ---------------------------------------------------------------------

    protected async getImportStringContext(fileName: string, position: number) {
        const env = this.env;
        if (!env) return null;
        const program = await env.languageService?.getProgram();
        if (!program) return null;
        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) return null;

        const node = env.findNodeAtPosition(sourceFile, position);
        if (!node || !ts.isStringLiteral(node)) return null;

        const parent = node.parent;
        let isModuleSpecifier = false;
        if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
            if (parent.moduleSpecifier !== node) return null;
            isModuleSpecifier = true;
        } else if (
            ts.isCallExpression(parent) &&
            parent.expression.kind === ts.SyntaxKind.ImportKeyword &&
            parent.arguments.length > 0 &&
            parent.arguments[0] === node
        ) {
            isModuleSpecifier = true;
        }
        if (!isModuleSpecifier) return null;

        const text = node.text;
        const contentStart = node.getStart() + 1;
        const partialPath = text.slice(0, Math.max(0, position - contentStart));
        const lastSlashInContent = partialPath.lastIndexOf('/');
        const segmentStart = contentStart + lastSlashInContent + 1;

        return { nodeStart: node.getStart(), partialPath, segmentStart };
    }

    protected async getImportCompletions(partialPath: string) {
        const baseDir = this.env!.pxseedLibBaseDir;

        const entries: ts.CompletionEntry[] = [];
        const normalized = partialPath.replace(/\\/g, '/');
        const endsWithSlash = normalized.endsWith('/');

        let dirToList: string;
        if (normalized.length === 0) {
            dirToList = baseDir;
        } else {
            const target = path.join(
                baseDir,
                endsWithSlash ? normalized + '_' : normalized
            );
            dirToList = path.dirname(target);
        }
        if (await defaultFileSystem!.filetype(dirToList) !== 'dir') {
            return entries;
        }

        const lastSegment = endsWithSlash ? '' : (normalized.split('/').pop() || '');
        const files = await defaultFileSystem!.listdir(dirToList);
        for (const file of files) {
            if (file.type != 'dir') continue;
            if (lastSegment && !file.name.toLowerCase().startsWith(lastSegment.toLowerCase())) {
                continue;
            }
            entries.push({
                name: file.name + '/',
                kind: ts.ScriptElementKind.moduleElement,
                kindModifiers: '',
                sortText: '0' + file.name,
            });
        }
        return entries;
    }

    // ---------------------------------------------------------------------
    // 对外 RPC
    // ---------------------------------------------------------------------

    async updateFile({ uri, code, range }: { uri: string; code: string, range?: [number, number] }) {
        let path = this.convertUriToPath(uri);
        let env = this.env;
        if (!env) return;
        const existing = await env.getSourceFile(path);
        if (existing) {
            if (code === existing.getFullText()) return false;
            env.updateFile(path, code, range);
            return true;
        }
        env.updateFile(path, code, range);
        await env.getSourceFile(path);
        return true;
    }

    async getLints({
        uri, range
    }: {
        uri: string; range?: [number, number]
    }) {
        let path = this.convertUriToPath(uri);
        let env = this.env;
        if (!env) return [];
        const exists = await env.getSourceFile(path);
        if (!exists) return [];

        const syntaticDiagnostics = await env.languageService!.getSyntacticDiagnostics(path);
        const semanticDiagnostics = await env.languageService!.getSemanticDiagnostics(path);

        let diagnostics = [...syntaticDiagnostics, ...semanticDiagnostics].filter(
            (diagnostic): diagnostic is ts.DiagnosticWithLocation =>
                isDiagnosticWithLocation(diagnostic),
        );

        if (range != undefined) {
            diagnostics = diagnostics.filter(t1 => t1.start >= range[0] && t1.start <= range[1]);
        }

        return diagnostics.map(convertTSDiagnosticToCM);
    }

    async getAutocompletion({ uri, pos, explicit }: { uri: string; pos: number, explicit: boolean }) {
        const path = this.convertUriToPath(uri);
        const env = this.env;
        if (!env) return null;

        const program = await env.languageService?.getProgram();
        const sourceFile = program?.getSourceFile(path);
        if (!sourceFile) return null;
        const rawContents = sourceFile.getFullText();
        if (rawContents === undefined) return null;

        // 光标处节点：import 路径补全和外部字面量补全共用
        const node = env.findNodeAtPosition(sourceFile, pos);

        // 1. import 模块说明符：目录补全
        const importCtx = await this.getImportStringContext(path, pos);
        if (importCtx) {
            const dirEntries = await this.getImportCompletions(importCtx.partialPath);
            const segmentStart = Math.min(importCtx.segmentStart, pos);

            const baseInfo = await env.languageService!.getCompletionsAtPosition(
                path, pos,
                {
                    includeCompletionsForModuleExports: true,
                    includeCompletionsForImportStatements: true,
                },
                {},
            );
            const baseEntries = baseInfo?.entries ?? [];

            const merged: ts.CompletionEntry[] = [...dirEntries, ...baseEntries];
            if (merged.length > 0) {
                return {
                    from: segmentStart,
                    entries: merged.map(t1 => ({
                        label: t1.name,
                        kind: t1.kind,
                        details: (t1 as any).labelDetails?.detail
                    })),
                };
            }
            // 继续走默认逻辑
        }

        // 2. 默认补全 + 外部字面量补全
        const completionInfo = await env.languageService!.getCompletionsAtPosition(
            path, pos,
            {
                includeCompletionsForModuleExports: true,
                includeCompletionsForImportStatements: true,
            },
            {},
        );
        if (!completionInfo) return null;

        const entries = new Array<{ label: string; kind: string; details?: string }>();
        // 若产生外部字面量补全，from 必须锚定到字面量内部起点，
        // 否则 label（完整路径）会被插到光标位置导致路径重复。
        let magicLiteralFrom: number | undefined = undefined;

        for (let t1 of completionInfo.entries) {
            if (
                t1.name.startsWith(ExternalLiteralMagicMark) &&
                node != undefined &&
                ts.isStringLiteral(node)
            ) {
                if (magicLiteralFrom === undefined) {
                    magicLiteralFrom = node.getStart() + 1;
                }
                const literalSourceName = t1.name.substring(ExternalLiteralMagicMark.length);
                const source = externalLiteralTypeRegistry.get(literalSourceName);
                if (source?.getAutocompletion != undefined) {
                    for (const t2 of await source.getAutocompletion({
                        uri, pos, explicit, tsserver: this, node,
                    })) {
                        if (t2.kind == undefined) t2.kind = 'literal';
                        entries.push(t2 as any);
                    }
                }
            } else {
                entries.push({
                    label: t1.name,
                    kind: t1.kind,
                    details: t1.labelDetails?.detail,
                });
            }
        }

        const from =
            magicLiteralFrom !== undefined
                ? magicLiteralFrom
                : completionInfo.optionalReplacementSpan?.start ?? pos;

        return { from, entries };
    }

    async getHover({ uri, pos }: { uri: string; pos: number }) {
        const path = this.convertUriToPath(uri);
        const env = this.env;
        if (!env) return null;
        const sourcePos = pos;

        try {
            const ls = env.languageService!;

            let quickInfo = await ls.getQuickInfoAtPosition(path, sourcePos);
            if (!quickInfo) {
                return null;
            }

            const start = quickInfo.textSpan.start;

            let typeDef = await ls.getTypeDefinitionAtPosition(path, sourcePos);
            let def = await ls.getDefinitionAtPosition(path, sourcePos);

            const html = this.renderQuickInfoHtml(quickInfo);

            return {
                start,
                end: start + quickInfo.textSpan.length,
                typeDef,
                def,
                quickInfo: html,
            };
        } catch (e) {
            log.error(e);
            return null;
        }
    }

    protected escapeHtml(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    protected partsToText(parts: ts.SymbolDisplayPart[] | undefined): string {
        if (!parts) return '';
        return parts.map((p) => p.text).join('');
    }

    renderQuickInfoHtml(quickInfo: ts.QuickInfo): string {
        const esc = (s: string) => this.escapeHtml(s);

        const mainSignature = this.partsToText(quickInfo.displayParts);
        const mainDoc = quickInfo.documentation
            ? this.partsToText(quickInfo.documentation)
            : '';

        const codeStyle =
            'font-family: var(--cm-font-monospace, ui-monospace, SFMono-Regular, Menlo, monospace);' +
            'white-space: pre-wrap;' +
            'word-break: break-word;' +
            'margin: 0;';

        const docStyle =
            'font-family: inherit;' +
            'font-size: 0.9em;' +
            'opacity: 0.85;' +
            'margin-top: 4px;' +
            'white-space: pre-wrap;' +
            'word-break: break-word;';

        let html = `<div style="display:block;max-width:560px;">`;
        html += `<div style="display:block;margin:0;"><pre style="${codeStyle}"><code style="${codeStyle}">${esc(
            mainSignature,
        )}</code></pre></div>`;
        if (mainDoc) {
            html += `<div style="${docStyle}">${esc(mainDoc).replace(/\n/g, '<br/>')}</div>`;
        }
        html += `</div>`;
        return html;
    }

    async getDefinition({ uri, pos }: { uri: string, pos: number }): Promise<TsServerNameDefinition[] | null> {
        let path = this.convertUriToPath(uri);
        let env = this.env;
        if (!env) return null;
        let defs = await env.languageService!.getDefinitionAtPosition(path, pos);
        if (defs == undefined) return null;
        let result = new Array<TsServerNameDefinition>();
        let tjs = await buildTjs();
        for (let t1 of defs) {
            let fileContent = utf8conv(await tjs.readFile(t1.fileName));
            let start = fileContent.lastIndexOf('\n', t1.textSpan.start);
            start = start < 0 ? 0 : start;
            let end = fileContent.indexOf('\n', t1.textSpan.start + t1.textSpan.length);
            end = end < 0 ? fileContent.length : end;
            result.push({
                uri: this.convertPathBacktoUri(t1.fileName),
                span: [t1.textSpan.start, t1.textSpan.start + t1.textSpan.length],
                name: t1.name,
                summary: fileContent.substring(start, end).trim()
            })
        }
        return result;
    }

    async getEnv() {
        return this.env;
    }
}

export let lastCreateTsServerWorker: TsServerWorker | null = null;
export async function createTsServerWorker() {
    lastCreateTsServerWorker = await new TsServerWorker(new NodeLanguageServerEnvironment()).initialize();
    return lastCreateTsServerWorker;
}