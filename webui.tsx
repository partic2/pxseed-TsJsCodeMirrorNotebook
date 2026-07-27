
import * as React from 'preact'
import { openNewWindow } from 'partic2/pComponentUi/workspace'
import { requirejs } from 'partic2/jsutils1/base';
import { GetJsEntry } from 'partic2/jsutils1/webutils';
import { setBaseWindowView } from 'partic2/pComponentUi/workspace';
import { setCodeCellListImpl } from 'partic2/CodeRunner/WebUi';
import { CodeMirrorCellList } from './CodeCell';
import { alert } from 'partic2/pComponentUi/window';
import {openWorkspaceWindowFor} from 'partic2/JsNotebook/workspace'
import { getPersistentRegistered, ServerHostWorker1RpcName } from 'partic2/pxprpcClient/registry';
import { TaskLocalEnv } from 'partic2/CodeRunner/CodeContext';
import { NotebookViewer } from 'partic2/JsNotebook/notebook';

const __name__=requirejs.getLocalRequireModule(require);

//Open from packageManager.
export async function main(args:string){
    if(args=='webui'){
        setCodeCellListImpl(CodeMirrorCellList);
        openWorkspaceWindowFor((await getPersistentRegistered(ServerHostWorker1RpcName))!)
    }
}


class CodeMirrorNotebook extends NotebookViewer{
    async useRpc(rpc?: { name: string | null; }): Promise<void> {
        await super.useRpc(rpc);
    }
    protected renderCodeCellList(): React.JSX.Element {
        return <CodeMirrorCellList codeContext={this.codeContext!} ref={this.rref.ccl} cellProps={{
            onInputChange:(target)=>this.onCellInputChange(target)
        }}/>
    }
}

export async function codeMirrorNotebookFactory(){
    return CodeMirrorNotebook
}



//Optinal support when module is open from url directly. like http://xxxx/pxseed/index.html?__jsentry=<moduleName>
(async ()=>{
    if(__name__==GetJsEntry()){
        setBaseWindowView(<div>WebUI Demo</div>);
    }
})();
