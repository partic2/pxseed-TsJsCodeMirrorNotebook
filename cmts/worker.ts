

import { RpcSerializeMagicMark } from "partic2/pxprpcClient/pxseedremotefuncs";
import ts from 'typescript'
import { type Diagnostic, type LintSource } from "@codemirror/lint";
import { GetCurrentTime, logger, requirejs } from "partic2/jsutils1/base";
import { getWWWRoot,path } from "partic2/jsutils1/webutils";
import { getSimpleFileSysteNormalizedWWWRoot } from "partic2/CodeRunner/JsEnviron";

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
export function tsDiagnosticMessage(
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

function getLineAtPosition(code: string, position: number) {
    // lineStart is the index of line break or zero
    const from = code.lastIndexOf("\n", position - 1) + 1;
    let to = code.indexOf("\n", position);
    if (to === -1) {
        to = code.length;
    }
    const text = code.slice(from, to);
    return {
        from,
        to,
        text,
    };
}

const DEFAULT_CODEMIRROR_TYPE_ICONS = new Set([
    "class",
    "constant",
    "enum",
    "function",
    "interface",
    "keyword",
    "method",
    "namespace",
    "property",
    "text",
    "type",
    "variable",
]);

function ensureAnchor(expr: RegExp, start: boolean) {
    const { source } = expr;
    // biome-ignore lint/style/useSingleVarDeclarator: vendor
    // biome-ignore lint/suspicious/noDoubleEquals: vendor
    const addStart = start && source[0] != "^",
        // biome-ignore lint/suspicious/noDoubleEquals: vendor
        addEnd = source[source.length - 1] != "$";
    if (!addStart && !addEnd) return expr;
    return new RegExp(
        `${addStart ? "^" : ""}(?:${source})${addEnd ? "$" : ""}`,
        expr.flags ?? (expr.ignoreCase ? "i" : ""),
    );
}
function matchBefore(code: string, pos: number, expr: RegExp) {
    const line = getLineAtPosition(code, pos);
    const start = Math.max(line.from, pos - 250);
    const str = line.text.slice(start - line.from, pos - line.from);
    const found = str.search(ensureAnchor(expr, false));
    return found < 0
        ? null
        : { from: start + found, to: pos, text: str.slice(found) };
}


class NodeLanguageServerEnvironment {
    [RpcSerializeMagicMark] = {}
    lsHost?:ts.LanguageServiceHost
    languageService?:ts.LanguageService
    openedScripts=new Map<string,{version:string,snapshot?:ts.IScriptSnapshot}>();
    compileSetting:ts.CompilerOptions={
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.CommonJS,
        lib: ["lib.dom.d.ts", "lib.es2021.d.ts"],
        jsx:ts.JsxEmit.React,
        paths:{},
    }
    projectVersion=0;
    constructor(public sys:ts.System) {}
    async initialize(){
        let fs=await import('fs');
        if(this.compileSetting.baseUrl==undefined){
            this.compileSetting.baseUrl=path.join(getSimpleFileSysteNormalizedWWWRoot(),'..','source');
        }
        //For TS>=6.0
        //this.compileSetting.paths!['*']=[this.compileSetting.baseUrl+'/*'];
        this.lsHost = {
            getProjectVersion:()=>String(this.projectVersion),
            getScriptFileNames: () => Array.from(this.openedScripts.keys()),
            getScriptVersion: (fileName) => {
                let t1=this.openedScripts.get(fileName);
                if(t1==undefined){
                    return '1';
                }else{
                    return t1.version;
                }
            },
            getScriptSnapshot: (fileName) => {
                let s=this.openedScripts.get(fileName);
                if(s!=undefined){
                    return s.snapshot
                }
                if (!fs.existsSync(fileName)) return undefined;
                return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
            },
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => this.compileSetting,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: (path)=>{
                if(this.openedScripts.has(path)){
                    return true;
                }
                return this.sys.fileExists(path);
            },
            readFile: this.sys.readFile,
            readDirectory: this.sys.readDirectory,
        };
        this.languageService=await this.decorateLanguageService(ts.createLanguageService(this.lsHost));
        return this;
    }
    async decorateLanguageService(ls:ts.LanguageService){
        let fs=await import('fs');
        let path=await import('path');

        let decoratedLS = Object.create(ls);

        function getImportStringContext(
            fileName: string,
            position: number,
            ls: ts.LanguageService
        ): { partialPath: string } | null {
            const program = ls.getProgram();
            if (!program) return null;
            const sourceFile = program.getSourceFile(fileName);
            if (!sourceFile) return null;
            function findNodeAtPosition(node: ts.Node): ts.Node | undefined {
                if (position >= node.getStart() && position <= node.getEnd()) {
                    const children = node.getChildren();
                    for (const child of children) {
                        const found = findNodeAtPosition(child);
                        if (found) return found;
                    }
                    return node;
                }
                return undefined;
            }

            const node = findNodeAtPosition(sourceFile);
            if (!node || !ts.isStringLiteral(node)) return null;

            const parent = node.parent;
            if (!ts.isImportDeclaration(parent) && !ts.isExportDeclaration(parent)) {
                return null;
            }
            if (parent.moduleSpecifier !== node) return null;
            const text = node.text;
            const partialPath = text.slice(0, position - node.getStart() - 1);

            return { partialPath };
        }

        function getDirectoryCompletions(
            baseUrl: string,
            partialPath: string
        ): ts.CompletionEntry[] {
            const targetDir = path.join(baseUrl, partialPath);
            const entries: ts.CompletionEntry[] = [];

            const dirToList = partialPath.endsWith('/')
                ? targetDir
                : path.dirname(targetDir);

            if (!fs.existsSync(dirToList) || !fs.statSync(dirToList).isDirectory()) {
                return entries;
            }

            const files = fs.readdirSync(dirToList, { withFileTypes: true });
            for (const file of files) {
                if (!file.isDirectory()) continue;
                if (!partialPath.endsWith('/')) {
                    const lastSegment = partialPath.split('/').pop() || '';
                    if (!file.name.toLowerCase().startsWith(lastSegment.toLowerCase())) {
                        continue;
                    }
                }
                entries.push({
                    name: file.name + '/',
                    kind: ts.ScriptElementKind.moduleElement,
                    kindModifiers: '',
                    sortText: file.name,
                });
            }

            return entries;
        }
        let baseUrl=this.compileSetting.baseUrl!;

        decoratedLS.getCompletionsAtPosition = (
                fileName: string,
                position: number,
                options: ts.GetCompletionsAtPositionOptions | undefined
        ): ts.CompletionInfo | undefined => {
            const originalResult = ls.getCompletionsAtPosition.call(decoratedLS,fileName, position, options);
            const context = getImportStringContext(fileName, position, ls);
            if (!context) {
                return originalResult;
            }
            const directoryEntries = getDirectoryCompletions(
                baseUrl,
                context.partialPath
            );

            if (!originalResult) {
                return {
                    isGlobalCompletion: false,
                    isMemberCompletion: false,
                    isNewIdentifierLocation: true,
                    entries: directoryEntries,
                };
            }

            const mergedEntries = [
                ...directoryEntries.map(e => ({
                    ...e,
                    sortText: '0' + e.name, 
                })),
                ...originalResult.entries,
            ];

            return {
                ...originalResult,
                entries: mergedEntries,
            };
        };
        return decoratedLS as ts.LanguageService
    }
    getSourceFile(fileName: string): ts.SourceFile | undefined {
        let r=this.languageService?.getProgram()?.getSourceFile(fileName)
        return r;
    }
    updateFile(fileName: string, content: string ,range?:[number,number]) {
        this.projectVersion++;
        let f=this.openedScripts.get(fileName);
        if(f==undefined){
            let t1=ts.ScriptSnapshot.fromString(content);
            this.openedScripts.set(fileName,{version:String(GetCurrentTime().getTime()),snapshot:t1});
        }else if(range==undefined){
            let t1=ts.ScriptSnapshot.fromString(content);
            f.snapshot=t1;
            f.version=String(GetCurrentTime().getTime())
        }else{
            let text=f.snapshot!.getText(0,f.snapshot!.getLength());
            text=text.substring(0,range[0])+content+text.substring(range[1])
            f.snapshot=ts.ScriptSnapshot.fromString(text);
            f.version=String(GetCurrentTime().getTime())
        }
    }
    deleteFile(fileName: string) {
        if(this.openedScripts.has(fileName)){
            this.openedScripts.delete(fileName);
        }
        this.sys.deleteFile?.(fileName);
    }
}

export class TsServerWorker {
    [RpcSerializeMagicMark] = {};
    initialized = false;
    env?: NodeLanguageServerEnvironment;
    constructor(env:NodeLanguageServerEnvironment){
        this.env=env;
    }
    async initialize(){
        await this.env!.initialize();
        return this;
    }
    async updateFile({ path, code , range}: { path: string; code: string ,range?:[number,number]}) {
        let env = this.env;
        if (!env) return;
        const existing = env.getSourceFile(path);

        if (existing) {
            if (code === existing.getFullText()) return false;
            env.updateFile(path, code);
            // This should make initial linting etc faster by making
            // TypeScript eagerly create the source file object
            env.getSourceFile(path);
            return true;
        }

        env.updateFile(path, code,range);
        env.getSourceFile(path);
        return true;
    }
    async getLints({
        path,
    }: {
        path: string;
    }) {
        let env = this.env;
        if (!env) return [];
        // Don't crash if the relevant file isn't created yet.
        const exists = env.getSourceFile(path);
        if (!exists) return [];

        const syntaticDiagnostics = env.languageService!.getSyntacticDiagnostics(path);
        const semanticDiagnostics = env.languageService!.getSemanticDiagnostics(path);

        const diagnostics = [...syntaticDiagnostics, ...semanticDiagnostics].filter(
            (diagnostic): diagnostic is ts.DiagnosticWithLocation =>
                isDiagnosticWithLocation(diagnostic),
        );

        return diagnostics.map(convertTSDiagnosticToCM);
    }
    async getAutocompletion({path,pos,explicit}: { path: string; pos:number, explicit:boolean}) {
        let env = this.env;
        if (!env) return null;
        const rawContents = env.getSourceFile(path)?.getFullText();
        if (!rawContents) return null;
        let word = matchBefore(rawContents, pos, /\w*/);
        if (!word?.text) {
            word = matchBefore(rawContents, pos, /\./);
        }
        if (!word?.text && !explicit) return null;
        const completionInfo = env.languageService!.getCompletionsAtPosition(
            path,pos,
            {
                includeCompletionsForModuleExports: true,
                includeCompletionsForImportStatements: true,
            },
            {},
        );
        if (!completionInfo) return null;
        let entries=completionInfo.entries.map(t1=>({label:t1.name,kind:t1.kind,details:t1.labelDetails?.detail,description:t1.labelDetails?.description}))
        return {from:completionInfo.optionalReplacementSpan?.start??pos,entries,identity:{[RpcSerializeMagicMark]:completionInfo}};
    }
    async getHover({ path, pos }: { path: string; pos: number }) {
        let env = this.env;
        if (!env) return null;
        const sourcePos = pos;

        try {
            const quickInfo = env.languageService!.getQuickInfoAtPosition(
                path,
                sourcePos,
            );
            if (!quickInfo) {
                return null;
            }

            const start = quickInfo.textSpan.start;

            const typeDef =
                env.languageService!.getTypeDefinitionAtPosition(path, sourcePos);
            const def =
                env.languageService!.getDefinitionAtPosition(path, sourcePos);

            return {
                start,
                end: start + quickInfo.textSpan.length,
                typeDef,
                def,
                quickInfo,
            };
        } catch (e) {
            // biome-ignore lint/suspicious/noConsole: we want to tell users about this
            log.error(e);
            return null;
        }
    }
    async getEnv() {
        return this.env;
    }
}

export async function createTsServerWorker(){
    return new TsServerWorker(new NodeLanguageServerEnvironment(ts.sys)).initialize()
}