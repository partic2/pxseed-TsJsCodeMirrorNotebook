import { EventBuffer, Singleton } from 'partic2/CodeRunner/jsutils2';
import { importRemoteModule, easyCallRemoteJsonFunction, openConnectionFromUrl, IoOverPxprpc } from 'partic2/pxprpcClient/pxseedremotefuncs';
import { getPersistentRegistered, ServerHostRpc, ServerHostWorker1Rpc, ServerHostWorker1RpcName } from 'partic2/pxprpcClient/registry';
import { LanguageServerConnection } from 'partic2/typescriptLanguageServer2026/pxseedutils/lspproxy';
import { Transport } from 'partic2/codemirror2026/lsp-client/index';
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import * as cmlsp from 'partic2/codemirror2026/lsp-client/index'
import { GenerateRandomString, requirejs, Task, throwIfAbortError } from 'partic2/jsutils1/base';
import { TjsSfs } from 'partic2/CodeRunner/JsEnviron';
import { tjsFrom } from 'partic2/tjshelper/tjsonjserpc';
import * as React from 'preact'
import { RpcExtendClient1 } from 'pxprpc/extend';
import { Client } from 'pxprpc/base';
import { buildTjs } from '../tjshelper/tjsbuilder';

let __name__=requirejs.getLocalRequireModule(require);

export class SimpleLogViewer extends React.Component<
    {logSource:EventBuffer<{level:'info'|'warning',summary:string,detail:string}>},
    {history:Array<{ level: 'info' | 'warning', summary:string,detail?:string }>,filter: string,expanded:Set<number>}>{
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.setState({expanded:new Set(),filter:'',history:[]})
    }
    onFilterChange = (ev: React.TargetedInputEvent<HTMLInputElement>) => {
        this.setState({ filter: (ev.target as any).value })
    }
    clearHistory() {
        this.setState({ history: [],expanded:new Set() })
    }
    consumerId=GenerateRandomString()
    pollTask:Task<any>|null=null;
    componentDidMount(){
        this.pollTask=Task.fork(function *(this:SimpleLogViewer){
            while(this.pollTask===Task.currentTask){
                let logmsg=yield *Task.yieldWrap(this.props.logSource.take(this.consumerId));
                this.state.history.push(...logmsg.map(t1=>t1.event));
                this.setState({});
            }
        }.bind(this));
        this.pollTask.run();
    }
    componentWillUnmount(){
        if(this.pollTask!=null){
            this.pollTask.abort();
            this.pollTask=null;
        }
    }
    render(props?: Readonly<React.Attributes & { children?: React.ComponentChildren; ref?: React.Ref<any> | undefined; }> | undefined, state?: Readonly<{}> | undefined, context?: any): React.ComponentChildren {
        return <div style={{ display: 'flex', flexDirection: 'column', height: '100%' ,minWidth:'400px',minHeight:'300px'}}>
            <div style={{ flexGrow: '1', flexShrink: '1', overflow: 'auto' }}>{this.state.history.filter(t1 => t1.summary.includes(this.state.filter) || t1.detail?.includes(this.state.filter)).map((t1,t2) => {
                return <div style={{ whiteSpace: 'pre-wrap' }}>
                <a onClick={()=>{
                    if(this.state.expanded.has(t2)){this.state.expanded.delete(t2);}else{this.state.expanded.add(t2);}
                    this.setState({})
                }} href="javascript:;">[{t1.level}]:{t1.summary}</a>
                {this.state.expanded.has(t2)?<div style={{whiteSpace:'pre-wrap'}}>{t1.detail}</div>:null}</div>
            })}</div>
            <div style={{ flexShrink: '0', display: 'flex', flexDirection: 'row' }}>
                <input type='button' style={{ flexGrow: '0' }} value='clear' onClick={() => this.clearHistory()} />
                <input type='text' onChange={this.onFilterChange} style={{ flexGrow: '1' }} placeholder='filter' />
            </div>
        </div>
    }
}

async function TypescriptServerWorkerFactory(){
    return new RpcExtendClient1(new Client(
        (await openConnectionFromUrl(
            `iooverpxprpc:server host/${encodeURIComponent('webworker:'+__name__+'.TypescriptServerWorker')}`)
        )!)).init();
}

export let TypescriptServerWorker=new Singleton(TypescriptServerWorkerFactory)
export let defaultTypescriptLanguageServiec=new Singleton(async ()=>{
    let t=await importRemoteModule(TypescriptServerWorker,'partic2/TsJsCodeMirrorNotebook/cmts/worker') as typeof import('partic2/TsJsCodeMirrorNotebook/cmts/worker')
    return await t.createTsServerWorker()
})
export let serverSide=new Singleton(async ()=>{
    let t=await importRemoteModule(ServerHostWorker1Rpc,'partic2/TsJsCodeMirrorNotebook/serverSide') as typeof import('partic2/TsJsCodeMirrorNotebook/serverSide')
    await t.preparePxseedNotebookLspEnviron();
    return t
})

export let defaultServerFileSystem=new Singleton(async ()=>{
    let tjs=await buildTjs();
    let fs=new TjsSfs().from(tjs);
    fs.ensureInited();
    return fs;
})