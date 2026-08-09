
import * as React from 'preact'
import { openNewWindow } from 'partic2/pComponentUi/workspace'
import { requirejs } from 'partic2/jsutils1/base';
import { GetJsEntry, path } from 'partic2/jsutils1/webutils';
import { setBaseWindowView } from 'partic2/pComponentUi/workspace';
import { ClientInfo, easyCallRemoteJsonFunction, getPersistentRegistered, importRemoteModule, ServerHostWorker1RpcName } from 'partic2/pxprpcClient/registry';
import { TaskLocalEnv } from 'partic2/CodeRunner/CodeContext';
import {ServerHostWorker1Rpc} from 'partic2/pxprpcClient/registry'
import { NotebookViewer } from 'partic2/JsNotebook/notebook';
import { Singleton } from 'partic2/CodeRunner/jsutils2';
import { CodeMirrorNotebook, TypeScriptCodeFileViewer } from './FileViewer';
import { getSimpleFileSysteNormalizedWWWRoot, TjsSfs } from 'partic2/CodeRunner/JsEnviron';


const __name__=requirejs.getLocalRequireModule(require);



export async function codeMirrorNotebookFactory(){
    return CodeMirrorNotebook
}

class NotebookViewerContainer extends React.Component<{context:{rpc:ClientInfo},path:string},{notebookViewerImpl?:{new(prop:any,ctx:any):NotebookViewer}}>{
    render(props?: Readonly<React.Attributes & { children?: React.ComponentChildren; ref?: React.Ref<any> | undefined; }> | undefined, state?: Readonly<{}> | undefined, context?: any): React.ComponentChildren {
        let Nbimpl=this.state.notebookViewerImpl??CodeMirrorNotebook;
        return <Nbimpl context={this.props.context} path={this.props.path} switchNotebookViewerImpl={(impl)=>this.setState({notebookViewerImpl:impl})}/> 
    }
}

let serverSide=new Singleton(async ()=>{
    return await importRemoteModule(ServerHostWorker1Rpc,'partic2/TsJsCodeMirrorNotebook/serverSide') as typeof import('partic2/TsJsCodeMirrorNotebook/serverSide')
})

//Open from packageManager.
export async function main(args:string){
    if(args=='webui'){
        let notebookFilePath=await (await serverSide.get()).getEntryNotebookFilePath();
        openNewWindow(<NotebookViewerContainer context={
            {rpc:(await getPersistentRegistered(ServerHostWorker1RpcName))!}} path={notebookFilePath} />,
            {title:'TS/JS Notebook',layoutHint:__name__+'TS/JS Notebook entry'});
        let wwwroot=await easyCallRemoteJsonFunction(ServerHostWorker1Rpc,'partic2/CodeRunner/JsEnviron','getSimpleFileSysteNormalizedWWWRoot',[])
        let thissource=path.join(wwwroot,'../source',__name__+'.tsx');
        openNewWindow(<TypeScriptCodeFileViewer 
            path={thissource} initialSelect={{anchor:1200,focus:1220}} />,
            {title:'webui.tsx'})
    }
}

//Optinal support when module is open from url directly. like http://xxxx/pxseed/index.html?__jsentry=<moduleName>
(async ()=>{
    if(__name__==GetJsEntry()){
        setBaseWindowView(<div>WebUI Demo</div>);
    }
})();
