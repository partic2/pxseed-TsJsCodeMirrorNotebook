import { RpcSerializeMagicMark } from "partic2/pxprpcClient/pxseedremotefuncs";
import ts from 'typescript'
import { type Diagnostic, type LintSource } from "partic2/codemirror2026/prebuilt/@codemirror-lint";
import { assert, GetCurrentTime, logger, requirejs } from "partic2/jsutils1/base";
import { getWWWRoot, path } from "partic2/jsutils1/webutils";
import { getSimpleFileSysteNormalizedWWWRoot } from "partic2/CodeRunner/JsEnviron";
import { buildTjs } from "partic2/tjshelper/tjsbuilder";
import { utf8conv } from "partic2/CodeRunner/jsutils2";

let __name__ = requirejs.getLocalRequireModule(require);
let log = logger.getLogger(__name__);

function isDiagnosticWithLocation(
    diagnostic: ts.Diagnostic,
): diagnostic is ts.DiagnosticWithLocation {
    return !!(
        diagnostic.file &&
        typeof diagnostic.start === "number" &&
        typeof diagnostic.length === "number"
    );
}

/**
 * Get the message for a diagnostic. TypeScript
 * is kind of weird: messageText might have the message,
 * or a pointer to the message. This follows the chain
 * to get a string, regardless of which case we're in.
 */
function tsDiagnosticMessage(
    diagnostic: Pick<ts.Diagnostic, "messageText">,
): string {
    if (typeof diagnostic.messageText === "string") {
        return diagnostic.messageText;
    }
    // TODO: go through linked list
    return diagnostic.messageText.messageText;
}

/**
 * TypeScript and CodeMirror have slightly different
 * ways of representing diagnostics. This converts
 * from one to the other.
 */
function convertTSDiagnosticToCM(
    d: ts.DiagnosticWithLocation,
): Diagnostic {
    // We add some code at the end of the document, but we can't have a
    // diagnostic in an invalid range
    const start = d.start;
    const message = tsDiagnosticMessage(d);

    return {
        from: start,
        to: start + d.length,
        message: message,
        severity: tsCategoryToSeverity(d),
    };
}

/**
 * TypeScript has a set of diagnostic categories,
 * which maps roughly onto CodeMirror's categories.
 * Here, we do the mapping.
 */
function tsCategoryToSeverity(
    diagnostic: Pick<ts.DiagnosticWithLocation, "category" | "code">,
): Diagnostic["severity"] {
    if (diagnostic.code === 7027) {
        // Unreachable code detected
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

const ExternalLiteralMagicMark='@@ExternalLiteralMagicMark@@'

class NodeLanguageServerEnvironment {
    [RpcSerializeMagicMark] = {}
    lsHost?: ts.LanguageServiceHost
    languageService?: ts.LanguageService
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
    constructor(public sys: ts.System) { }

    async initialize() {
        let fs = await import('fs');
        let path = await import('path');
        this.pxseedLibBaseDir = path.join(getWWWRoot(), '..', 'source');
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
                if (!fs.existsSync(fileName)) return undefined;
                return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
            },
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => this.compileSetting,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: (path) => {
                if (this.openedScripts.has(path)) {
                    return true;
                }
                return this.sys.fileExists(path);
            },
            readFile: this.sys.readFile,
            readDirectory: this.sys.readDirectory,
        };
        // 不再装饰，直接使用原生 LanguageService
        this.languageService = ts.createLanguageService(this.lsHost);
        return this;
    }

    getSignaturesFromSymbol(
        path: string,
        pos: number,
    ): { signature: string; documentation: string }[] {
        const ls = this.languageService;
        const program = ls?.getProgram();
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

    getSourceFile(fileName: string): ts.SourceFile | undefined {
        let r = this.languageService?.getProgram()?.getSourceFile(fileName)
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

export interface TsServerNameDefinition {
    uri: string,
    name: string,
    span: [number, number],
    summary: string
}

/**
 * 缓存一个自定义 JS 补全模块的导出内容。
 *  - getSync() 同步返回，miss 时返回空数组并触发后台异步加载
 *  - getValidatorSync() 类似，用于 TypeCustom 值校验
 */
interface CustomModuleExports {
    mtimeMs: number;
    getCompletions?: () => any[];
    validate?: (value: unknown) => string | null | undefined;
}

class CustomCompletionCache {
    private cache = new Map<string, CustomModuleExports>();
    private pending = new Map<string, Promise<void>>();

    private loadModule(absPath: string): Promise<CustomModuleExports> {
        return import(/* @vite-ignore */ absPath + '?t=' + Date.now())
            .then(mod => ({
                mtimeMs: 0,
                getCompletions: typeof mod.getCompletions === 'function' ? mod.getCompletions : undefined,
                validate: typeof mod.validate === 'function' ? mod.validate : undefined,
            }))
            .catch(err => {
                log.warning(`load custom completion module failed: ${absPath}`, err);
                return { mtimeMs: 0 } as CustomModuleExports;
            });
    }

    private ensureFresh(absPath: string, mtimeMs: number) {
        if (this.pending.has(absPath)) return;
        const hit = this.cache.get(absPath);
        if (hit && hit.mtimeMs === mtimeMs) return;
        const p = this.loadModule(absPath)
            .then(mod => {
                mod.mtimeMs = mtimeMs;
                this.cache.set(absPath, mod);
            })
            .finally(() => this.pending.delete(absPath));
        this.pending.set(absPath, p);
    }

    getSync(absPath: string, mtimeMs: number): CustomModuleExports | undefined {
        this.ensureFresh(absPath, mtimeMs);
        return this.cache.get(absPath);
    }
}

export let externalLiteralTypeRegistry=new Map<string,{
    getAutocompletion?:(a0:{uri:string, pos:number, explicit:boolean,tsserver:TsServerWorker})=>
        Promise<Array<{label:string,kind?:string,details?:string}>>
}>();



externalLiteralTypeRegistry

export class TsServerWorker {
    [RpcSerializeMagicMark] = {};
    initialized = false;
    env?: NodeLanguageServerEnvironment;
    private customCache = new CustomCompletionCache();

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

    /**
     * 判断光标是否位于模块说明符字符串字面量内（静态 import/export 或动态 import()），
     * 返回用于路径补全的上下文：
     *  - partialPath: 字符串内容中光标前的部分
     *  - segmentStart: 最后一个 '/' 之后的绝对位置
     */
    protected getImportStringContext(fileName: string, position: number) {
        const env = this.env;
        if (!env) return null;
        const program = env.languageService?.getProgram();
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

    /**
     * 目录补全：逐段替换语义，只替换最后一个 '/' 之后的部分。
     */
    protected async getImportCompletions(partialPath: string) {
        const fs = await import('fs');
        const path = await import('path');
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
        if (!fs.existsSync(dirToList) || !fs.statSync(dirToList).isDirectory()) {
            return entries;
        }

        const lastSegment = endsWithSlash ? '' : (normalized.split('/').pop() || '');
        const files = fs.readdirSync(dirToList, { withFileTypes: true });
        for (const file of files) {
            if (!file.isDirectory()) continue;
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
        const existing = env.getSourceFile(path);
        if (existing) {
            if (code === existing.getFullText()) return false;
            env.updateFile(path, code, range);
            return true;
        }
        env.updateFile(path, code, range);
        env.getSourceFile(path);
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
        const exists = env.getSourceFile(path);
        if (!exists) return [];

        const syntaticDiagnostics = env.languageService!.getSyntacticDiagnostics(path);
        const semanticDiagnostics = env.languageService!.getSemanticDiagnostics(path);

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
        let path = this.convertUriToPath(uri);
        let env = this.env;
        if (!env) return null;

        const program = env.languageService?.getProgram();
        const sourceFile = program?.getSourceFile(path);
        if (!sourceFile) return null;
        const rawContents = sourceFile.getFullText();
        if (!rawContents) return null;

       
        // 1. import 目录补全
        const importCtx = this.getImportStringContext(path, pos);
        if (importCtx) {
            const dirEntries = await this.getImportCompletions(importCtx.partialPath);
            const segmentStart = Math.min(importCtx.segmentStart, pos);

            // 与 TS 自身的模块说明符补全合并
            const baseInfo = env.languageService!.getCompletionsAtPosition(
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

        // 2. 默认
        const completionInfo = env.languageService!.getCompletionsAtPosition(
            path, pos,
            {
                includeCompletionsForModuleExports: true,
                includeCompletionsForImportStatements: true,
            },
            {},
        );
        if (!completionInfo) return null;
        let entries=new Array<{label:string,kind:string,details?:string}>();
        for(let t1 of completionInfo.entries){
            if(t1.name.startsWith(ExternalLiteralMagicMark)){
                let literalSourceName=t1.name.substring(ExternalLiteralMagicMark.length);
                let source=externalLiteralTypeRegistry.get(literalSourceName);
                if(source?.getAutocompletion!=undefined){
                    for(let t2 of await source.getAutocompletion({uri, pos, explicit,tsserver:this})){
                        if(t2.kind==undefined){
                            t2.kind='literal';
                        }
                        entries.push(t2 as any)
                    }
                }
            }else{
                entries.push({
                    label: t1.name,
                    kind: t1.kind,
                    details: t1.labelDetails?.detail,
                })
            }
        }
        log.debug(entries);
        return { from: completionInfo.optionalReplacementSpan?.start ?? pos, entries };
    }

    async getHover({ uri, pos }: { uri: string; pos: number }) {
        const path = this.convertUriToPath(uri);
        const env = this.env;
        if (!env) return null;
        const sourcePos = pos;

        try {
            const ls = env.languageService!;

            const quickInfo = ls.getQuickInfoAtPosition(path, sourcePos);
            if (!quickInfo) {
                return null;
            }

            const start = quickInfo.textSpan.start;

            const typeDef = ls.getTypeDefinitionAtPosition(path, sourcePos);
            const def = ls.getDefinitionAtPosition(path, sourcePos);

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
        let defs = env.languageService!.getDefinitionAtPosition(path, pos);
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
    lastCreateTsServerWorker = await new TsServerWorker(new NodeLanguageServerEnvironment(ts.sys)).initialize();
    return lastCreateTsServerWorker;
}