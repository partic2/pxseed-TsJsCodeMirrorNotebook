
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
import { defaultTypescriptLanguageServiec, serverSide } from './webuiutils';
import { NotebookViewer } from 'partic2/JsNotebook/notebook';
import { rootWindowGroup } from 'partic2/pComponentUi/window';

let __name__=requirejs.getLocalRequireModule(require);
let log=logger.getLogger(__name__);
export var css={
    inputCell:GenerateRandomString(),
    outputCell:GenerateRandomString(),
}


interface CodeCellStats{
    //Serializable object
    cellOutput:any,
    resultVariable:string|null,
    focusin:boolean,
    errorCatched:string|null,
    runCodeKey?:'Ctl+Ent'|'Enter'
}


DynamicPageCSSManager.PutCss('.'+css.outputCell,['overflow:auto']);
DynamicPageCSSManager.PutCss('.'+css.inputCell,[
    'display:inline-block','border:solid black 2px','margin:2px','padding:2px','background-color:white',
    'font-family:monospace'
]);


export class TypescriptNotebookControl{
    remoteDocUpdating=new mutex();
    cells=new Array<{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:Ref2<string>,offset?:number}>();
    constructor(public tsFile:string,public tsserver:TsServerWorker){}
    getDocumentLengthFor(cell:{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:Ref2<string>}){
        let len=0;
        if(cell.plainText!=undefined){
            len=cell.plainText.get().length;
        }else if(cell.editor!=undefined){
            len=cell.editor.getDocumentTextForLanguageService().length;
        }
        return len;
    }
    languageServiceDocumentOffsetFor(cell2:{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:Ref2<string>}){
        let currOffset=0;
        for(let t1=0;t1<this.cells.length;t1++){
            let cell=this.cells[t1];
            if(cell.offset==undefined){
                cell.offset=currOffset;
            }
            if((cell2.plainText!=undefined && cell2.plainText===cell.plainText) ||
                (cell2.editor!=undefined && cell2.editor==cell.editor)){
                return cell.offset;
            }
            let nextOffset=this.cells.at(t1+1)?.offset;
            if(nextOffset==undefined){
                nextOffset=currOffset+this.getDocumentLengthFor(cell);
            }
            currOffset=nextOffset;
        }
    }
    onCellDocumentChange(change:{editor?:NotebookCellTypescriptCodemirrorEditor,plainText?:Ref2<string>}){
        let t1=this.cells.findIndex((t2=>t2.editor==change.editor));
        if(t1>=0){this.invalidCellsStateSinceIndex(t1);}
    }
    invalidCellsStateSinceIndex(index:number){
        for(let t1=index;t1<this.cells.length;t1++){
            let cell=this.cells.at(t1);
            if(cell!=undefined){
                cell.offset=undefined;
            }
        }
    }
    insertEditorCell(pos:number|'end',editor:NotebookCellTypescriptCodemirrorEditor){
        if(pos==='end'){
            this.cells.push({editor});
        }else{
            this.cells.splice(pos,0,{editor});
            this.invalidCellsStateSinceIndex(pos);
        }
        editor.notebookControl=this;
    }
    insertPlainTextCell(pos:number|'end',plainText:Ref2<string>){
        if(pos==='end'){
            this.cells.push({plainText});
        }else{
            this.cells.splice(pos,0,{plainText});
            this.invalidCellsStateSinceIndex(pos);
        }
        plainText.watch(this.__plainTextOnChange)
    }
    __plainTextOnChange=(r:Ref2<string>,prev:string)=>{
        this.remoteDocUpdating.exec(async ()=>{
            let offset=this.languageServiceDocumentOffsetFor({plainText:r})??0;
            await this.tsserver.updateFile({uri:this.tsFile,code:r.get(),range:[offset,offset+prev.length]});
        }).then(()=>{
            this.onCellDocumentChange({plainText:r});
        })
    }
    deleteCell(pos:number){
        let cell=this.cells[pos];
        let offset=this.languageServiceDocumentOffsetFor(cell)??0;
        let end=offset+this.getDocumentLengthFor(cell);
        this.cells.splice(pos,1);
        if(cell.plainText!=undefined){
            cell.plainText.unwatch(this.__plainTextOnChange)
        }
        this.remoteDocUpdating.exec(async ()=>{
            await this.tsserver.updateFile({uri:this.tsFile,code:'',range:[offset,end]});
        })
        this.invalidCellsStateSinceIndex(pos);
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
    override languageServiceDocumentOffset(): number {
        let offset = this.notebookControl?.languageServiceDocumentOffsetFor({editor:this})??0;
        return offset
    }
    override async onDocumentChangeInClass(update: cmv.ViewUpdate): Promise<void> {
        this.notebookControl?.onCellDocumentChange({editor:this});
        await super.onDocumentChangeInClass(update);
    }
}



export class CodeMirrorCodeCell<Props={}> extends CodeCell<Props&Partial<Pick<CodeMirrorCodeCell,'notebookControl'|'onGotoDefinitionOpenView'>>> implements CodeCellControl{
    constructor(props:any,ctx:any){
        super(props,ctx);
    }
    onGotoDefinitionOpenView?:(def:TsServerNameDefinition)=>void;
    notebookControl?:TypescriptNotebookControl;
    refCodeMirrorInputEditor=new ReactRefEx<NotebookCellTypescriptCodemirrorEditor>();
    override set codeContext(cur:RunCodeContext|undefined){
        let prev=this.codeContext;
        super.codeContext=cur;
        prev?.event.removeEventListener(`${__name__}.CodeCell.callWebuiFunction`,this.codeContextCallMethodEvent);
        cur?.event.addEventListener(`${__name__}.CodeCell.callWebuiFunction`,this.codeContextCallMethodEvent);
        
    }
    override get codeContext(){return super.codeContext}
    getCellInput(){
        if(this.refCodeMirrorInputEditor.current==undefined)return '';
        let t1=this.refCodeMirrorInputEditor.current.getCurrentDocumentText();
        return t1;
    }
    async setCellInput(input:string){
        let editor=await this.refCodeMirrorInputEditor.waitValid();
        await editor.setCurrentDocumentText(input)
    }
    setCellOutput(output:any,resultVariable?:string|null){
        this.setState({cellOutput:output,resultVariable,errorCatched:null});
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
            onGotoDefinitionOpenView={(def)=>this.onGotoDefinitionOpenView?.(def)}/>
    }
    async setAsEditTarget(){
        (await this.refCodeMirrorInputEditor.waitValid()).focus();
    }
}

export class CodeMirrorCellList<Props={}> extends DefaultCodeCellList<Props>{
    protected remoteNotebookFile=new future<{id:string,uri:string}>();
    protected headCell=new Ref2<string>('');
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
        this.initialized.get().then(()=>this.__syncNotebookControl());
        return k;
    }
    async deleteCell(cellKey: string): Promise<void> {
        let list=this.getCellList();
        let found=list.findIndex(t1=>t1.key===cellKey)!;
        if(found>=0){
            this.__pendingSyncNotebookControlFn.push(async ()=>{
                await this.notebookControl!.deleteCell(found+1);
            })
        }
        this.initialized.get().then(()=>this.__syncNotebookControl());
        await super.deleteCell(cellKey);
        
    }
    async changeHeadCell(content:string){
        await this.initialized.get()
        this.headCell.set(content+'\n');
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
        await openNewWindow(<CodeMirrorNotebook context={this.props.context} path={path} />,{title:path,layoutHint:__name__+'.notebook'})
    }
    protected renderCodeCellList(): React.JSX.Element {
        return <CodeMirrorCellList codeContext={this.codeContext!} ref={this.rref.ccl} cellProps={{
            onInputChange:(target)=>this.onCellInputChange(target)
        }}/>
    }
}

