
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

interface CodeCellProps{
    codeContext:RunCodeContext,
    notebookControl?:TypescriptNotebookControl,
    customBtns?:{label:string,title?:string,cb:()=>Promise<any>}[];
    onRun?:()=>void,
    onRunResult?:()=>void
    onClearOutputs?:()=>void,
    onInputChange?:(target:CodeCellControl)=>void,
    //How to run code with key shortcut, default value:'Ctl+Ent'. use Ctrl+Enter for new line in 'Enter' mode.
    runCodeKey?:'Ctl+Ent'|'Enter'
    //To be used in code cell list.
    onFocusChange?:(focusin:boolean)=>void,
    divStyle?:React.CSSProperties,
    inputClass?:string[],
    divAttr?:React.HTMLAttributes<HTMLDivElement>,
    onPreviousCell?:()=>void,
    onNextCell?:()=>void
    onGotoDefinitionOpenView?:(def: TsServerNameDefinition)=>void
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

export class NotebookCellTypescriptCodemirrorEditor<P={}> extends TypescriptCodemirrorEditor<P&{control?:TypescriptNotebookControl}>{
    control?:TypescriptNotebookControl;
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.control=this.props.control;
        this.fileUri=this.control!.tsFile;
        this.tsserver=this.control!.tsserver;
        this.remoteDocUpdating=this.control!.remoteDocUpdating;
    }
    override async componentDidMount(): Promise<void> {
        await super.componentDidMount();
    }
    override getDocumentTextForLanguageService(): string {
        return this.getCurrentDocumentText()+'\n';
    }
    override languageServiceDocumentOffset(): number {
        let offset = this.control!.languageServiceDocumentOffsetFor({editor:this})??0;
        return offset
    }
    override async onDocumentChange(update: cmv.ViewUpdate): Promise<void> {
        this.control!.onCellDocumentChange({editor:this});
        await super.onDocumentChange(update);
    }
}

export class CodeMirrorCodeCell extends React.Component<CodeCellProps,CodeCellStats> implements CodeCellControl{
    rref={
        codemirrorInputEditor:new ReactRefEx<TypescriptCodemirrorEditor>(),
        container:new ReactRefEx<HTMLDivElement>(),
        tooltipsDiv:new ReactRefEx<HTMLDivElement>
    }
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.notebookControl=this.props.notebookControl;
        this.setState({focusin:false,errorCatched:null});
    }
    getContainerDiv(): HTMLDivElement | null {
        return this.rref.container.current
    }
    async runCode(){
        this.props.onRun?.();
        try{
            this.setState({cellOutput:'Running...'});
            let resultVariable=this.state.resultVariable??('__result_'+GenerateRandomString());
            let runStatus=await this.codeContext!.runCode(this.getCellInput(),resultVariable);
            if(runStatus.err===null && runStatus.stringResult!=null){
                let cellOutput=runStatus.stringResult;
                this.setState({cellOutput,resultVariable});
            }else{
                let cellOutput=await inspectCodeContextVariable(await ensureJavascriptInspectorForCodeContextInstalled(this.codeContext!),[resultVariable],{maxDepth:1});
                this.setState({cellOutput,resultVariable,errorCatched:runStatus.err});
            }
        }catch(e){
            let err=e as Error
            this.setState({cellOutput:{message:err.message,stack:err.stack}});
        }finally{
            this.props.onRunResult?.();
        }
    }
    protected getRunCodeKey(){
        return this.props.runCodeKey??'Ctl+Ent';
    }
    notebookControl?:TypescriptNotebookControl;
    async componentDidMount() {
    }
    async componentWillUnmount() {
    }
    getCellInput(){
        if(this.rref.codemirrorInputEditor.current==undefined)return '';
        let t1=this.rref.codemirrorInputEditor.current.getCurrentDocumentText();
        return t1;
    }
    getCellOutput():[any,string|null]{
        return [this.state.cellOutput,this.state.resultVariable??null];
    }
    async setCellInput(input:string){
        let editor=await this.rref.codemirrorInputEditor.waitValid();
        await editor.setCurrentDocumentText(input)
    }
    setCellOutput(output:any,resultVariable?:string|null){
        this.setState({cellOutput:output,resultVariable,errorCatched:null});
    }
    getCellInputHtml(){
        return this.rref.codemirrorInputEditor.current?.containerDiv.current?.innerHTML??null;
    }
    protected resetTooltips(){
    }
    protected __focusIn:'cell'|'blur'='blur';
    protected async doOnFocusChange(focusin:boolean,ev:React.TargetedFocusEvent<HTMLDivElement>){
        if(this.props.onFocusChange!=undefined){
            this.props.onFocusChange(focusin);
        }
        if(focusin){
            this.setState({focusin:true});
            this.__focusIn='cell';
        }else{
            //wait to check focus really move out
            this.__focusIn='blur';
            await sleep(100);
            if(this.__focusIn=='blur'){
                this.resetTooltips();
                this.setState({focusin:false})
            }
        }
    }
    protected async onBtnRun(){
        this.runCode();
    }
    protected async onBtnClearOutputs(){
        if(this.state.resultVariable!=null){
            this.codeContext!.callFunction('deleteVariables',[[this.state.resultVariable]]);
        }
        this.props.onClearOutputs?.();
        this.setCellOutput('',null);
    }
    protected renderActionButton(){
        let result=[]
        if(this.props.customBtns!=undefined){
            for(let t1 of this.props.customBtns){
                result.push(<a href="javascript:;" onClick={()=>t1.cb()} {...{title:t1.title}}>{t1.label}</a>)
            }
        }
        result.push(<a href="javascript:;" onClick={()=>this.onBtnRun()} title={`Run cell(${this.getRunCodeKey()})`}>Run</a>)
        result.push(<a href="javascript:;" onClick={()=>this.onBtnClearOutputs()} title={`Clear outputs`}>Clr</a>)
        result=result.map(v=>[<span>&nbsp;&nbsp;</span>,v,<span>&nbsp;&nbsp;</span>])
        return result
    }
    codeContext?:RunCodeContext
    codeContextCallMethodEvent=async (ev:CodeContextEvent)=>{
        let {module,functionName,argv}=ev.data;
        (await import(module))[functionName](...argv,{codeCell:this,codeContext:this.codeContext})
    }
    protected async checkState(){
        if(this.codeContext!=this.props.codeContext){
            if(this.codeContext!=undefined){
                this.codeContext.event.removeEventListener(`${__name__}.CodeCell.callWebuiFunction`,this.codeContextCallMethodEvent);
            }
            this.codeContext=this.props.codeContext;
            this.codeContext.event.addEventListener(`${__name__}.CodeCell.callWebuiFunction`,this.codeContextCallMethodEvent);
        }
        if(this.state.runCodeKey!=this.getRunCodeKey()){
            let current=this.state.runCodeKey;
            this.setState({runCodeKey:this.getRunCodeKey()});
            let codemirrorKeybindingMap={
                'Ctl+Ent':'Ctrl-Enter',
                'Enter':'Enter'
            }
            let editor=await this.rref.codemirrorInputEditor.waitValid();
            if(current!=undefined){
                editor.removeKeyBinding(codemirrorKeybindingMap[current]);
            }
            editor.addKeybinding({
                key:codemirrorKeybindingMap[this.getRunCodeKey()],
                run:(t)=>{this.runCode();return true}
            });
        }
    }
    renderCellInput(){
        return <NotebookCellTypescriptCodemirrorEditor ref={this.rref.codemirrorInputEditor} control={this.notebookControl} 
            onGotoDefinitionOpenView={(def)=>this.props.onGotoDefinitionOpenView?.(def)}/>
    }
    renderCellOutput(){
        return [
            <div>{this.state.errorCatched!=null?'THROW:':null}</div>,
            <div style={{overflow:'auto'}}>
                {this.state.cellOutput===undefined?null:<ObjectViewer 
                    object={this.state.cellOutput} name={''} codeContext={this.codeContext!} 
                    variableName={this.state.resultVariable??undefined} 
                />}
            </div>
        ]
    }
    render(props?: Readonly<React.Attributes & { children?: React.ComponentChildren; ref?: React.Ref<any> | undefined; }> | undefined, state?: Readonly<{}> | undefined, context?: any): React.ComponentChild {
        this.checkState();
        return <div style={{display:'flex',flexDirection:'column',position:'relative',...this.props.divStyle}} ref={this.rref.container} 
                {...this.props.divAttr}
                onFocusIn={(ev)=>{
                    this.props.divAttr?.onFocusIn?.(ev);
                    if(!ev.defaultPrevented){
                        this.doOnFocusChange(true,ev);
                    }
                }}
                onFocusOut={(ev)=>{
                    this.props.divAttr?.onFocusOut?.(ev);
                    if(!ev.defaultPrevented){
                        this.doOnFocusChange(false,ev);
                    }
                }}
            >
            {this.renderCellInput()}
            {this.state.focusin?<div style={{position:'relative',display:'flex',flexDirection:'row-reverse'}}>
            <div style={{position:'absolute',backgroundColor:'white',maxWidth:'50%',wordBreak:'break-all'}}>
                <div>{this.renderActionButton()}</div>
            </div></div>:null}
            {this.renderCellOutput()}
        </div>
    }
    async setAsEditTarget(){
        (await this.rref.codemirrorInputEditor.waitValid()).focus();
    }
    async close(){
        if(this.state.resultVariable!=null){
            try{
                this.codeContext!.callFunction('deleteVariables',[[this.state.resultVariable]]);
            }catch(e){};
        }
    }
}

export class CodeMirrorCellList extends DefaultCodeCellList{
    protected remoteNotebookFile=new future<{id:string,uri:string}>();
    protected headCell=new Ref2<string>('');
    protected notebookControl?:TypescriptNotebookControl;
    protected initialized=new future<void>();
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.initialize().then(
            ()=>{this.initialized.setResult();this.setState({});},
            (err:any)=>{this.initialized.setException(err);this.setState({});}
        )
    }
    async initialize(){
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
            let editor=await (await list[found].ref.waitValid() as CodeMirrorCodeCell).rref.codemirrorInputEditor.waitValid();
            await this.notebookControl!.insertEditorCell(found<list.length-1?found+1:'end',editor);
        })
        this.initialized.get().then(()=>this.__syncNotebookControl);
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
        this.initialized.get().then(()=>this.__syncNotebookControl);
        await super.deleteCell(cellKey);
        
    }
    async changeHeadCell(content:string){
        await this.initialized.get()
        this.headCell.set(content+'\n');
    }
    protected onTypescriptDeclChange=async ()=>{
        if(this.state.codeContext==undefined)return;
        let decls=await this.state.codeContext!.callFunction('callModuleFunction',['partic2/TsJsCodeMirrorNotebook/notebookenv','getNotebookEnvAllTypeDecl',[]]) as Array<{uid:string,decl:string}>;
        await this.changeHeadCell(decls.map(t1=>t1.decl).join('\n\n'));
    }
    protected async attachCodeContext(codeContext: RunCodeContext) {
        await super.attachCodeContext(codeContext);
        codeContext.event.addEventListener(path.join(__name__,'../notebookenv')+'.declChange',this.onTypescriptDeclChange);
        await codeContext.callFunction('callModuleFunction',['partic2/TsJsCodeMirrorNotebook/notebookenv','initNotebookCodeEnv',[]]);
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
                codeContext={this.props.codeContext} notebookControl={this.notebookControl}
                customBtns={[
                    {label:'New',cb:()=>this.newCell(v.key)},
                    {label:'Del',cb:()=>this.deleteCell(v.key)}
                ]}
                onClearOutputs={()=>this.clearConsoleOutput(v.key)}
                onRun={async ()=>{
                    this.props.onRun?.(v.key);
                    this.lastRunCellKey=v.key;
                    if(v.key==this.state.list.at(-1)?.key){
                        await this.newCell(v.key);
                        let ccelem=this.state.list.at(-1)!;
                        let cc=await ccelem.ref.waitValid();
                        await cc.setAsEditTarget();
                    }
                }}
                onFocusChange={(focusin)=>{
                    this.props.onCellFocusChange?.({cellKey:v.key,focusIn:focusin});
                    if(focusin){
                        this.setState({lastFocusCellKey:v.key});
                        this.scrollToCell(index);
                    }
                }}
                onPreviousCell={async ()=>{
                    let cc=this.state.list.at(index-1);
                    if(cc!=undefined){
                        await cc.ref.current?.setAsEditTarget();
                    }
                }}
                onNextCell={async ()=>{
                    let cc=this.state.list.at(index+1);
                    if(cc!=undefined){
                        await cc.ref.current?.setAsEditTarget();
                    }
                }}
                onGotoDefinitionOpenView={(def)=>this.gotoDefinitionOpenView(def)}
                divStyle={cellCssStyle}
                {...this.props.cellProps}
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

