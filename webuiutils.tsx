import { Singleton } from 'partic2/CodeRunner/jsutils2';
import { importRemoteModule, easyCallRemoteJsonFunction } from 'partic2/pxprpcClient/pxseedremotefuncs';
import { getPersistentRegistered, ServerHostWorker1Rpc, ServerHostWorker1RpcName } from 'partic2/pxprpcClient/registry';
import { LanguageServerConnection } from 'partic2/typescriptLanguageServer2026/pxseedutils/lspproxy';
import { Transport } from 'partic2/codemirror2026/lsp-client/index';
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import * as cmlsp from 'partic2/codemirror2026/lsp-client/index'
import { throwIfAbortError } from 'partic2/jsutils1/base';
import { TjsSfs } from 'partic2/CodeRunner/JsEnviron';
import { tjsFrom } from 'partic2/tjshelper/tjsonjserpc';


let lspConsole=new ReactRefEx<{info:(a:{summary:string,detail:string})=>void,warn:(a:{summary:string,detail:string})=>void}>();

class CmLspTransport<T extends LanguageServerConnection> implements Transport {
    constructor(public lspconn: T) {}
    async send(message: string) {
        let request=JSON.parse(message);
        await this.lspconn.send(request);
        lspConsole.current?.info({summary:`SEND ${request.method}`,detail:message});
    }
    cb: ((value: string) => void) | null = null;
    protected async __poll() {
        if (this.cb == null) return;
        let cb = this.cb;
        while (this.cb == cb) {
            let msg = await this.lspconn.receive();
            let summary='undefined'
            if('method' in msg){
                summary=msg.method;
            }
            lspConsole.current?.info({summary:`RECV ${summary}`,detail:JSON.stringify(msg)});
            try{cb(JSON.stringify(msg));}catch(err:any){
                throwIfAbortError(err);
                lspConsole.current?.warn({summary:'LSP internal error:'+err,detail:err.stack})
            }
        }
    }
    subscribe(handler: (value: string) => void): void {
        this.cb = handler;
        this.__poll();
    }
    unsubscribe(handler: (value: string) => void): void {
        this.cb = null;
    }
}

export let defaultLspClient=new Singleton(async ()=>{
    let rpc1=await (await getPersistentRegistered(ServerHostWorker1RpcName))!.ensureConnected();
    let remoteLspConnection=await importRemoteModule(rpc1,'partic2/typescriptLanguageServer2026/lsp-connection') as typeof import('partic2/typescriptLanguageServer2026/lsp-connection')
    let remoteWWWRoot=await easyCallRemoteJsonFunction(rpc1,'partic2/jsutils1/webutils','getWWWRoot',[]) as string;
    let serverSide1=await serverSide.get();
    serverSide1.preparePxseedNotebookLspEnviron();
    let lspproxy=await serverSide1.getTypescriptProxyLsp()
    let lsptransport=new CmLspTransport(lspproxy);
    let cmclient = new cmlsp.LSPClient({ extensions: cmlsp.languageServerExtensions() }).connect(lsptransport);
    await cmclient.initializing;
    return {lsptransport,cmclient,lspproxy};
})

export let serverSide=new Singleton(async ()=>{
    let rpc1=await (await getPersistentRegistered(ServerHostWorker1RpcName))!.ensureConnected();
    return await importRemoteModule(rpc1,'partic2/TsJsCodeMirrorNotebook/serverSide') as typeof import('partic2/TsJsCodeMirrorNotebook/serverSide');
});

export let defaultFileSystem=new Singleton(async ()=>{
    let t1=new TjsSfs().from(await tjsFrom(await ServerHostWorker1Rpc.get()))
    await t1.ensureInited();
    return t1;
})