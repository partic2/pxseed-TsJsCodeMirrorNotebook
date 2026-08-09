
import { GenerateRandomString, GetCurrentTime, assert, future, requirejs, sleep, throwIfAbortError } from 'partic2/jsutils1/base';
import { FloatLayerComponent, ReactRefEx, css as css1 } from 'partic2/pComponentUi/domui';
import { CodeContextEvent, newCodeCellListData, RunCodeContext } from 'partic2/CodeRunner/CodeContext';
import {CodeCellControl, DefaultCodeCellList} from 'partic2/CodeRunner/WebUi'
import * as React from 'preact'
import { DynamicPageCSSManager, path } from 'partic2/jsutils1/webutils';
import { fromSerializableObject, inspectCodeContextVariable, CodeCompletionItem, ConsoleDataEventData, RemoteCodeContextInspector, ensureJavascriptInspectorForCodeContextInstalled, toSerializableObject } from 'partic2/CodeRunner/Inspector';
import { ObjectViewer } from 'partic2/CodeRunner/Component1';
import { FlattenArraySync,DebounceCall, ThrottleCall, Singleton } from 'partic2/CodeRunner/jsutils2';
import { LanguageServerConnection, PxseedExtendLanguageServer } from 'partic2/typescriptLanguageServer2026/pxseedutils/lspproxy'

import * as cmlsp from 'partic2/codemirror2026/lsp-client/index'
import * as codemirror from 'codemirror';
import { defaultLspClient, serverSide } from './webuiutils';

let __name__=requirejs.getLocalRequireModule(require);

export var css={
    inputCell:GenerateRandomString(),
    outputCell:GenerateRandomString(),
}

interface CodeCellProps{
    codeContext:RunCodeContext,
    languageServer:{
        client:cmlsp.LSPClient,
        uri:string
    },
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
}
interface CodeCellStats{
    //Serializable object
    cellOutput:any,
    resultVariable:string|null,
    codeCompleteCandidate:(CodeCompletionItem[])|null,
    extraTooltips:string|null,
    focusin:boolean,
    errorCatched:string|null,
    focusingCompletionCandidate:number
}


DynamicPageCSSManager.PutCss('.'+css.outputCell,['overflow:auto']);
DynamicPageCSSManager.PutCss('.'+css.inputCell,[
    'display:inline-block','border:solid black 2px','margin:2px','padding:2px','background-color:white',
    'font-family:monospace'
]);


export class CodeMirrorCodeCell extends React.Component<CodeCellProps,CodeCellStats> implements CodeCellControl{
    rref={
        codeMirrorContainer:new ReactRefEx<HTMLDivElement>(),
        container:new ReactRefEx<HTMLDivElement>(),
        focusingCompletionCandidateDiv:new ReactRefEx<HTMLDivElement>,
        tooltipsDiv:new ReactRefEx<HTMLDivElement>
    }
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.setState({codeCompleteCandidate:null,focusin:false,extraTooltips:null,errorCatched:null,focusingCompletionCandidate:0});
    }
    getContainerDiv(): HTMLDivElement | null {
        return this.rref.container.current
    }
    async runCode(){
        this.props.onRun?.();
        try{
            this.setState({cellOutput:'Running...',codeCompleteCandidate:[]});
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
    protected ensureCandidateScroll=new ThrottleCall(async ()=>{
        let focusDiv=await this.rref.focusingCompletionCandidateDiv.waitValid();
        let tooltips=await this.rref.tooltipsDiv.waitValid();
        if(focusDiv.offsetTop<tooltips.scrollTop || focusDiv.offsetTop>tooltips.scrollTop+tooltips.offsetHeight){
            tooltips.scrollTo({behavior:'smooth',top:focusDiv.offsetTop});
        }
    },300);
    protected getRunCodeKey(){
        return this.props.runCodeKey??'Ctl+Ent';
    }
    codemirrorEditorView=new future<codemirror.EditorView>();
    async componentDidMount() {
        let div1 = await this.rref.codeMirrorContainer.waitValid();
        let cms=await import('@codemirror/state');
        let cmjs=await import('@codemirror/lang-javascript');
        let cmv=await import('@codemirror/view');
        let cmc=await import('@codemirror/autocomplete');
        this.codemirrorEditorView.setResult(new codemirror.EditorView({
            state: cms.EditorState.create({
                extensions: [
                    codemirror.basicSetup, cmjs.javascript({ typescript: true }), cms.Prec.high(cmv.keymap.of([
                        {
                            key: 'Tab',
                            run: cmc.acceptCompletion,
                        },{
                            key:'Ctrl-Enter',
                            run:()=>{
                                if(this.props.runCodeKey=='Ctl+Ent' || this.props.runCodeKey==undefined){
                                    this.runCode();
                                    return true;
                                }else{
                                    return false;
                                }
                            }
                        },{
                            key:'Enter',
                            run:()=>{
                                if(this.props.runCodeKey=='Enter'){
                                    this.runCode();
                                    return true;
                                }else{
                                    return false;
                                }
                            }
                        }
                    ])),
                    this.props.languageServer.client.plugin(this.props.languageServer.uri, 'typescript')
                ],
            }),
            parent: div1
        }));
        
    }
    async componentWillUnmount() {
        (await this.codemirrorEditorView.get()).destroy();
    }
    protected async onCellKeyDown(ev: React.TargetedKeyboardEvent<HTMLDivElement>){
    }
    getCellInput(){
        if(this.codemirrorEditorView.result==undefined)return '';
        let t1=this.codemirrorEditorView.result.state.doc.toString();
        return t1;
    }
    getCellOutput():[any,string|null]{
        return [this.state.cellOutput,this.state.resultVariable??null];
    }
    async setCellInput(input:string){
        let view=await this.codemirrorEditorView.get();
        view.dispatch({
            changes:{from:0,to:this.getCellInput().length,insert:input}
        });
    }
    setCellOutput(output:any,resultVariable?:string|null){
        this.setState({cellOutput:output,resultVariable,errorCatched:null});
    }
    getCellInputHtml(){
        return this.rref.codeMirrorContainer.current?.innerHTML??null;
    }
    protected resetTooltips(){
        this.setState({focusingCompletionCandidate:0,codeCompleteCandidate:null,extraTooltips:null});
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
    protected beforeRender(){
        if(this.codeContext!=this.props.codeContext){
            if(this.codeContext!=undefined){
                this.codeContext.event.removeEventListener(`${__name__}.CodeCell.callWebuiFunction`,this.codeContextCallMethodEvent);
            }
            this.codeContext=this.props.codeContext;
            this.codeContext.event.addEventListener(`${__name__}.CodeCell.callWebuiFunction`,this.codeContextCallMethodEvent);
        }
    }
    render(props?: Readonly<React.Attributes & { children?: React.ComponentChildren; ref?: React.Ref<any> | undefined; }> | undefined, state?: Readonly<{}> | undefined, context?: any): React.ComponentChild {
        this.beforeRender();
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
            <div ref={this.rref.codeMirrorContainer}></div>
            {this.state.focusin?<div style={{position:'relative',display:'flex',flexDirection:'row-reverse'}}>
            <div style={{position:'absolute',backgroundColor:'white',maxWidth:'50%',wordBreak:'break-all'}}>
                <div>{this.renderActionButton()}</div>
            </div></div>:null}
            <div>{this.state.errorCatched!=null?'THROW:':null}</div>
            <div style={{overflow:'auto'}}>
                <ObjectViewer object={this.state.cellOutput} name={''} codeContext={this.codeContext!} variableName={this.state.resultVariable??undefined} />
            </div>
        </div>
    }
    async setAsEditTarget(){
        (await this.codemirrorEditorView.get()).focus();
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
    protected cellsLspInfo=new Map<string,{lspobj:{id:string,uri:string}}>();
    protected remoteNotebookFile=new future<{id:string,uri:string}>();
    protected headCell?:{id:string,uri:string}
    protected lspClient?:cmlsp.LSPClient;
    protected lspProxy?:PxseedExtendLanguageServer;
    constructor(props:any,ctx:any){
        super(props,ctx);
        (async ()=>{
            let t1=await defaultLspClient.get();
            this.lspClient=t1.cmclient;
            this.lspProxy=t1.lsptransport.lspconn;
            let notebookFile=await (await serverSide.get()).newTempNotebookFileForLsp();
            await this.lspProxy!.ensureFileDidOpen({uri:notebookFile.uri,languageId:'typescript'});
            this.headCell=await this.lspProxy!.allocateFilePart(notebookFile.uri);
            this.remoteNotebookFile.setResult(notebookFile);
            this.setState({});
        })();
    }
    async newCell(afterCellKey?: string): Promise<string> {
        let k=await super.newCell(afterCellKey);
        let {lsptransport}=await defaultLspClient.get();
        let filePart=await lsptransport.lspconn.allocateFilePart((await this.remoteNotebookFile.get()).uri)
        this.cellsLspInfo.set(k,{lspobj:{id:filePart.id,uri:filePart.uri}});
        this.setState({});
        return k;
    }
    async deleteCell(cellKey: string): Promise<void> {
        await super.deleteCell(cellKey);
    }
    async changeHeadCell(content:string){
        await this.remoteNotebookFile.get();
        await this.lspProxy!.sendDidChange({uri:this.headCell!.uri,change:{text:content}});
    }
    protected onTypescriptDeclChange=async ()=>{
        if(this.state.codeContext==undefined)return;
        let decls=await this.state.codeContext!.callFunction('callModuleFunction',['partic2/TsJsCodeMirrorNotebook/notebookenv','getNotebookEnvAllTypeDecl',[]]) as Array<{uid:string,decl:string}>;
        await this.changeHeadCell(decls.map(t1=>t1.decl).join('\n\n'));
    }
    protected async attachCodeContext(codeContext: RunCodeContext) {
        await super.attachCodeContext(codeContext);
        await codeContext.callFunction('callModuleFunction',['partic2/TsJsCodeMirrorNotebook/notebookenv','initNotebookCodeEnv',[]]);
        codeContext.event.addEventListener(path.join(__name__,'../notebookenv')+'.declChange',this.onTypescriptDeclChange);
        this.setState({},()=>this.onTypescriptDeclChange());
    }
    protected async detachCodeContext(codeContext: RunCodeContext): Promise<void> {
        await super.detachCodeContext(codeContext);
        codeContext.event.removeEventListener(path.join(__name__,'../notebookenv')+'.declChange',this.onTypescriptDeclChange);
    }
    renderCodeCell(v: { ref: ReactRefEx<CodeCellControl>; key: string; }, index: number, cellCssStyle: React.AllCSSProperties): React.JSX.Element {
        if(this.cellsLspInfo.get(v.key)==undefined||this.lspClient==undefined){
            return <div>Connecting to Language server...</div>
        }else{
            return <CodeMirrorCodeCell ref={v.ref} key={v.key} 
                codeContext={this.props.codeContext} languageServer={{
                    client:this.lspClient,uri:this.cellsLspInfo.get(v.key)!.lspobj.uri
                }}
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
                divStyle={cellCssStyle}
                {...this.props.cellProps}
            />
        }
    }
}

