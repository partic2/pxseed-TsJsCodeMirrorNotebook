
import { GenerateRandomString, GetCurrentTime, Ref2, assert, future, logger, mutex, requirejs, sleep, throwIfAbortError } from 'partic2/jsutils1/base';
import { FloatLayerComponent, ReactRefEx, css as css1 } from 'partic2/pComponentUi/domui';
import { CodeContextEvent, newCodeCellListData, RunCodeContext } from 'partic2/CodeRunner/CodeContext';
import {CodeCell, CodeCellControl, DefaultCodeCellList} from 'partic2/CodeRunner/WebUi'
import * as React from 'preact'
import { DynamicPageCSSManager, path } from 'partic2/jsutils1/webutils';
import { inspectCodeContextVariable,  ensureJavascriptInspectorForCodeContextInstalled, toSerializableObject } from 'partic2/CodeRunner/Inspector';
import { ObjectViewer } from 'partic2/CodeRunner/Component1';
import { openNewWindow } from 'partic2/pComponentUi/workspace';
import { TypescriptCodemirrorEditor } from './cmts/preact';
import type { TsServerNameDefinition, TsServerWorker } from './cmts/worker';

import * as cmv from 'partic2/codemirror2026/prebuilt/@codemirror-view';
import * as cmac from 'partic2/codemirror2026/prebuilt/@codemirror-autocomplete';
import ts from 'typescript';
import { defaultTypescriptLanguageServiec, serverSide } from './webuiutils';
import { NotebookViewer } from 'partic2/JsNotebook/notebook';
import { rootWindowGroup } from 'partic2/pComponentUi/window';

let __name__=requirejs.getLocalRequireModule(require);
let log=logger.getLogger(__name__);
export var css={
    inputCell:GenerateRandomString(),
    outputCell:GenerateRandomString(),
}



DynamicPageCSSManager.PutCss('.'+css.outputCell,['overflow:auto']);
DynamicPageCSSManager.PutCss('.'+css.inputCell,[
    'display:inline-block','border:solid black 2px','margin:2px','padding:2px','background-color:white',
    'font-family:monospace'
]);


class PlainTextCell{
    text:string='';
    languageServiceDocumentLength=0;
    onTextChange?:(cell:PlainTextCell,prev:string,curr:string)=>void;
    setText(text:string){
        let prev=this.text;
        this.text=text;
        this.onTextChange?.(this,prev,text);
        return this;
    }
}

export class TypescriptNotebookControl{
    remoteDocUpdating=new mutex();
    cells=new Array<{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:PlainTextCell}>();
    constructor(public tsFile:string,public tsserver:TsServerWorker){}
    languageServiceDocumentLengthFor(cell:{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:PlainTextCell}){
        if(cell.plainText!=undefined){
            return cell.plainText.languageServiceDocumentLength;
        }else if(cell.editor!=undefined){
            return cell.editor.languageServiceDocumentLength;
        }
        assert(false,'cell type error');
    }
    languageServiceDocumentOffsetFor(cell2:{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:PlainTextCell}):number{
        let currOffset=0;
        for(let t1=0;t1<this.cells.length;t1++){
            let cell=this.cells[t1];
            if((cell2.plainText!=undefined && cell2.plainText===cell.plainText) ||
                (cell2.editor!=undefined && cell2.editor==cell.editor)){
                return currOffset;
            }else{
                currOffset+=this.languageServiceDocumentLengthFor(cell);
            }
        }
        assert(false,'Cell not found');
    }
    onCellDocumentChange(change:{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:PlainTextCell}){
    }
    insertEditorCell(pos:number|'end',editor:NotebookCellTypescriptCodemirrorEditor){
        if(pos==='end'){
            this.cells.push({editor});
        }else{
            this.cells.splice(pos,0,{editor});
        }
        editor.notebookControl=this;
    }
    insertPlainTextCell(pos:number|'end',plainText:PlainTextCell){
        this.remoteDocUpdating.exec(async ()=>{
            if(pos==='end'){
                this.cells.push({plainText});
            }else{
                this.cells.splice(pos,0,{plainText});
            }
            plainText.onTextChange=(cell,prev,curr)=>{this.remoteDocUpdating.exec(async ()=>{
                let offset=this.languageServiceDocumentOffsetFor({plainText:cell});
                await this.tsserver.updateFile({uri:this.tsFile,code:curr,range:[offset,offset+prev.length]});
                cell.languageServiceDocumentLength=curr.length;
                this.onCellDocumentChange({plainText:cell});
            })}
        });
        plainText.setText(plainText.text);
    }
    deleteCell(pos:number){
        this.remoteDocUpdating.exec(async ()=>{
            let cell=this.cells[pos];
            let offset=this.languageServiceDocumentOffsetFor(cell);
            let end=offset+this.languageServiceDocumentLengthFor(cell);
            this.cells.splice(pos,1);
            await this.tsserver.updateFile({uri:this.tsFile,code:'',range:[offset,end]});
        })
    }
}

export class NotebookCellTypescriptCodemirrorEditor<P={}> extends TypescriptCodemirrorEditor<P&Partial<Pick<NotebookCellTypescriptCodemirrorEditor,'notebookControl'>>>{
    __notebookControl:TypescriptNotebookControl|undefined;
    set notebookControl(v:TypescriptNotebookControl|undefined){
        this.__notebookControl=v;
        if(v!=undefined){
            this.fileUri=v.tsFile;
            this.remoteDocUpdating=v.remoteDocUpdating;
            this.tsserver=v.tsserver;
        }
    }
    get notebookControl(){return this.__notebookControl}
    constructor(props:any,ctx:any){
        super(props,ctx);
    }
    
    override async componentDidMount(): Promise<void> {
        await super.componentDidMount();
    }
    override getDocumentTextForLanguageService(): string {
        return this.getCurrentDocumentText()+'\n';
    }
    override languageServiceDocumentRange(): [number, number] {
        assert(this.notebookControl!=undefined);
        let offset = this.notebookControl?.languageServiceDocumentOffsetFor({editor:this});
        let length = this.notebookControl?.languageServiceDocumentLengthFor({editor:this});
        return [offset,offset+length];
    }
    override async onDocumentChangeInClass(update: cmv.ViewUpdate): Promise<void> {
        this.notebookControl?.onCellDocumentChange({editor:this});
        await super.onDocumentChangeInClass(update);
    }

    /**
     * 把 worker 返回的 codeActions（FileTextChanges[]）应用到 notebook 的各个 cell 中。
     * 从后往前应用，避免前面的修改影响后面的位置偏移。
     */
    applyCodeActions(codeActions: readonly ts.FileTextChanges[]) {
        if (!codeActions || codeActions.length === 0) return;
        const nc = this.notebookControl;
        if (!nc) return;
        // 收集所有 textChanges，按 start 降序排列
        const allChanges: Array<{ span: ts.TextSpan, newText: string }> = [];
        for (const fileChanges of codeActions) {
            for (const tc of fileChanges.textChanges) {
                allChanges.push({ span: tc.span, newText: tc.newText });
            }
        }
        allChanges.sort((a, b) => b.span.start - a.span.start);
        for (const tc of allChanges) {
            const { start, length } = tc.span;
            const newText = tc.newText;
            let currOffset = 0;
            for (const cell of nc.cells) {
                const cellLen = nc.languageServiceDocumentLengthFor(cell);
                if (start >= currOffset && start <= currOffset + cellLen) {
                    const localStart = start - currOffset;
                    const localEnd = localStart + length;
                    if (cell.plainText) {
                        const newContent =
                            cell.plainText.text.slice(0, localStart) +
                            newText +
                            cell.plainText.text.slice(localEnd);
                        cell.plainText.setText(newContent);
                    } else if (cell.editor) {
                        const view = cell.editor.codemirrorEditorView;
                        if (view) {
                            view.dispatch({
                                changes: { from: localStart, to: localEnd, insert: newText },
                            });
                        }
                    }
                    break;
                }
                currOffset += cellLen;
            }
        }
    }

    /** 懒解析自动 import 的 codeActions 并应用（apply 内部调用，fire-and-forget） */
    private async resolveAndApplyAutoImport(
        posInVirtualFile: number,
        entryName: string,
        source?: string,
        data?: unknown,
    ) {
        try {
            if (this.tsserver == undefined) return;
            const codeActions = await this.tsserver.resolveCompletionCodeActions({
                uri: this.fileUri!,
                pos: posInVirtualFile,
                entryName,
                source,
                data,
            });
            if (codeActions && codeActions.length > 0) {
                this.applyCodeActions(codeActions);
            }
        } catch (e) {
            log.warning('resolveAndApplyAutoImport failed', e);
        }
    }

    protected override async requestCompletion(context: cmac.CompletionContext): Promise<cmac.CompletionResult | null> {
        return await this.remoteDocUpdating.exec(async () => {
            if (this.tsserver == undefined) return null;
            let offset = this.languageServiceDocumentRange()[0];
            // 原始虚拟文件位置（补全请求时刻），apply 内部需要传给 getCompletionEntryDetails
            const originalPos = context.pos + offset;
            const cpinfo = await this.tsserver.getAutocompletion({
                uri: this.fileUri!,
                pos: originalPos,
                explicit: context.explicit,
            });
            if (cpinfo == null) return null;
            let cp = cpinfo.entries as Array<{
                label: string; kind: string; details?: string;
                source?: string;
                hasAction?: true;
                data?: unknown;
                replacementSpan?: ts.TextSpan;
            }>;
            let from = cpinfo.from - offset;
            const kindMap: Record<string, string> = {
                'var': 'variable',
                'module': 'namespace',
                'const': 'constant',
            };
            const self = this;
            const completionEntries = cp.map(t1 => {
                const needsAutoImport = !!(t1.source || t1.hasAction);
                const applyWithAutoImport = (dispatchChange: () => void) => {
                    dispatchChange();
                    if (needsAutoImport) {
                        void self.resolveAndApplyAutoImport(
                            originalPos, t1.label, t1.source, t1.data,
                        );
                    }
                };

                if (t1.replacementSpan) {
                    const rsFrom = t1.replacementSpan.start - offset;
                    const rsTo = rsFrom + t1.replacementSpan.length;
                    return {
                        label: t1.label,
                        type: kindMap[String(t1.kind)] ?? t1.kind,
                        detail: (t1.details ?? ''),
                        apply: (_view: cmv.EditorView, _completion: cmac.Completion, _from: number, _to: number) => {
                            applyWithAutoImport(() => _view.dispatch({
                                changes: { from: rsFrom, to: rsTo, insert: t1.label },
                            }));
                        },
                    } satisfies cmac.Completion;
                } else {
                    return {
                        label: t1.label,
                        type: kindMap[String(t1.kind)] ?? t1.kind,
                        detail: (t1.details ?? ''),
                        apply: (_view: cmv.EditorView, _completion: cmac.Completion, from2: number, to2: number) => {
                            applyWithAutoImport(() => _view.dispatch({
                                changes: { from: from2, to: to2, insert: t1.label },
                            }));
                        },
                    } satisfies cmac.Completion;
                }
            });
            let completionResult: cmac.CompletionResult = {
                from, options: completionEntries,
                validFor: /^\w*$/
            };
            return completionResult;
        });
    }
}



export class CodeMirrorCodeCell<Props={}> extends CodeCell<Props&Partial<Pick<CodeMirrorCodeCell,'notebookControl'|'onGotoDefinitionOpenView'>>> implements CodeCellControl{
    constructor(props:any,ctx:any){
        super(props,ctx);
    }
    onGotoDefinitionOpenView?:(def:TsServerNameDefinition)=>void;
    notebookControl?:TypescriptNotebookControl;
    refCodeMirrorInputEditor=new ReactRefEx<NotebookCellTypescriptCodemirrorEditor>();
    getCellInput(){
        if(this.refCodeMirrorInputEditor.current==undefined)return '';
        let t1=this.refCodeMirrorInputEditor.current.getCurrentDocumentText();
        return t1;
    }
    async setCellInput(input:string){
        let editor=await this.refCodeMirrorInputEditor.waitValid();
        await editor.setCurrentDocumentText(input)
    }
    getCellInputHtml(){
        return this.refCodeMirrorInputEditor.current?.containerDiv.current?.innerHTML??null;
    }
    protected resetTooltips(){
    }
    protected override async requestCodeComplete(): Promise<void> {}
    protected override async requestTooltips(): Promise<void> {}
    protected __focusIn:'cell'|'blur'='blur';
    codeContextCallMethodEvent=async (ev:CodeContextEvent)=>{
        let {module,functionName,argv}=ev.data;
        (await import(module))[functionName](...argv,{codeCell:this,codeContext:this.codeContext})
    }
    override async componentDidMount() {
        //TODO:support Enter key?
        let editor=await this.refCodeMirrorInputEditor.waitValid();
        editor.addKeybinding({
            key:'Ctrl-Enter',
            run:(t)=>{this.runCode();return true}
        });
    }
    renderCellInput(){
        return <NotebookCellTypescriptCodemirrorEditor ref={this.refCodeMirrorInputEditor}
            divStyle={{border:'solid 1px grey'}}
            onGotoDefinitionOpenView={(def)=>this.onGotoDefinitionOpenView?.(def)}/>
    }
    async setAsEditTarget(){
        (await this.refCodeMirrorInputEditor.waitValid()).focus();
    }
}

export class CodeMirrorCellList<Props={}> extends DefaultCodeCellList<Props>{
    protected remoteNotebookFile=new future<{id:string,uri:string}>();
    protected headCell=new PlainTextCell();
    protected notebookControl?:TypescriptNotebookControl;
    constructor(props:any,ctx:any){
        super(props,ctx);
    }
    async initialize(){
        await super.initialize();
        let defaultService=await defaultTypescriptLanguageServiec.get();
        let serverSide1=await serverSide.get();
        let nbPath=await serverSide1.newTempLspNotebookFile();
        this.notebookControl=new TypescriptNotebookControl(nbPath.uri,defaultService);
        this.notebookControl.insertPlainTextCell('end',this.headCell);
    }
    protected __pendingSyncNotebookControlFn=new Array<()=>Promise<void>>();
    protected async __syncNotebookControl(){
        await this.initialized.get();
        let snapshot=this.__pendingSyncNotebookControlFn;
        this.__pendingSyncNotebookControlFn=new Array();
        for(let t1 of snapshot){
            await t1();
        }
    }
    async newCell(afterCellKey?: string): Promise<string> {
        let k=await super.newCell(afterCellKey);
        let list=this.getCellList();
        let found=list.findIndex(t1=>t1.key===k);
        assert(found>=0);
        this.__pendingSyncNotebookControlFn.push(async ()=>{
            let editor=await (await list[found].ref.waitValid() as CodeMirrorCodeCell).refCodeMirrorInputEditor.waitValid();
            this.notebookControl!.insertEditorCell(found<list.length-1?found+1:'end',editor);
        })
        this.__syncNotebookControl();
        return k;
    }
    async deleteCell(cellKey: string): Promise<void> {
        let list=this.getCellList();
        let found=list.findIndex(t1=>t1.key===cellKey)!;
        if(found>=0){
            this.__pendingSyncNotebookControlFn.push(async ()=>{
                this.notebookControl!.deleteCell(found+1);
            })
        }
        this.__syncNotebookControl();
        await super.deleteCell(cellKey);
        
    }
    async changeHeadCell(content:string){
        await this.initialized.get()
        this.headCell.setText(content+'\n');
    }
    protected onTypescriptDeclChange=async ()=>{
        if(this.codeContext==undefined)return;
        let decls=await this.codeContext!.callFunction({module:'partic2/TsJsCodeMirrorNotebook/notebookenv',name:'getNotebookEnvAllTypeDecl'},[]) as Array<{uid:string,decl:string}>;
        await this.changeHeadCell(decls.map(t1=>t1.decl).join('\n\n'));
    }
    protected async attachCodeContext(codeContext: RunCodeContext) {
        await super.attachCodeContext(codeContext);
        codeContext.event.addEventListener(path.join(__name__,'../notebookenv')+'.declChange',this.onTypescriptDeclChange);
        await codeContext.callFunction({module:'partic2/TsJsCodeMirrorNotebook/notebookenv',name:'initNotebookCodeEnv'},[]);
        this.setState({},()=>this.onTypescriptDeclChange());
    }
    protected async detachCodeContext(codeContext: RunCodeContext): Promise<void> {
        await super.detachCodeContext(codeContext);
        codeContext.event.removeEventListener(path.join(__name__,'../notebookenv')+'.declChange',this.onTypescriptDeclChange);
    }
    async gotoDefinitionOpenView(def: TsServerNameDefinition){
        let {TypeScriptCodeFileViewer}=await import('./FileViewer')
        let fileName=def.uri.substring(def.uri.lastIndexOf('/'));
        let newWindow=await openNewWindow(<TypeScriptCodeFileViewer path={def.uri.substring('file://'.length)} initialSelection={{anchor:def.span[0],focus:def.span[1]}} />,
            {title:fileName})
        let size=rootWindowGroup.get()!.getSize();
        if(size.width>500){
            size.width=size.width*0.8;
        }
        if(size.height>400){
            size.height=size.height*0.8;
        }
        (await newWindow.windowRef.waitValid()).layout({width:size.width,height:size.height})
    }
    override render(): React.ComponentChild {
        if(this.initialized.done){
            return super.render()
        }else{
            return null;
        }
    }
    renderCodeCell(v: { ref: ReactRefEx<CodeCellControl>; key: string; }, index: number, cellCssStyle: React.AllCSSProperties): React.JSX.Element {
        if(this.notebookControl==undefined){
            return <div>Connecting to Language server...</div>
        }else{
            return <CodeMirrorCodeCell ref={v.ref} key={v.key} 
                codeContext={this.codeContext} notebookControl={this.notebookControl}
                customBtns={[
                    {label:'New',cb:()=>this.newCell(v.key)},
                    {label:'Del',cb:()=>this.deleteCell(v.key)}
                ]}
                onClearOutputs={()=>this.clearConsoleOutput(v.key)}
                onRun={async ()=>{
                    this.onRun?.(v.key);
                    this.lastRunCellKey=v.key;
                    if(v.key==this.list.at(-1)?.key){
                        await this.newCell(v.key);
                        let ccelem=this.list.at(-1)!;
                        let cc=await ccelem.ref.waitValid();
                        await cc.setAsEditTarget();
                    }
                }}
                onFocusChange={(focusin)=>{
                    this.onCellFocusChange?.({cellKey:v.key,focusIn:focusin});
                    if(focusin){
                        this.setState({lastFocusCellKey:v.key});
                        this.scrollToCell(index);
                    }
                }}
                onPreviousCell={async ()=>{
                    let cc=this.list.at(index-1);
                    if(cc!=undefined){
                        await cc.ref.current?.setAsEditTarget();
                    }
                }}
                onNextCell={async ()=>{
                    let cc=this.list.at(index+1);
                    if(cc!=undefined){
                        await cc.ref.current?.setAsEditTarget();
                    }
                }}
                onGotoDefinitionOpenView={(def)=>this.gotoDefinitionOpenView(def)}
                divStyle={cellCssStyle}
                {...this.cellProps}
            />
        }
    }
}

export class CodeMirrorNotebook extends NotebookViewer{
    async useRpc(rpc?: { name: string | null; }): Promise<void> {
        await super.useRpc(rpc);
    }
    async doLoad(): Promise<void> {
        await super.doLoad();
    }
    async openNotebookFileInWebui(path:string){
        await openNewWindow(<CodeMirrorNotebook contextRpc={this.props.contextRpc} notebookPath={path} />,{title:path,layoutHint:__name__+'.notebook'})
    }
    protected renderCodeCellList(): React.JSX.Element {
        return <CodeMirrorCellList codeContext={this.codeContext!} ref={this.reactCodeCellList} cellProps={{
            onInputChange:(target)=>this.onCellInputChange(target)
        }}/>
    }
}
