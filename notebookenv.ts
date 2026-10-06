import { CodeContextEvent, LocalRunCodeContext, TaskLocalEnv } from "partic2/CodeRunner/CodeContext";
import { GenerateRandomString, requirejs, WaitUntil } from "partic2/jsutils1/base";
import { getTypescriptModuleTjs } from "partic2/packageManager/nodecompat";

let __name__=requirejs.getLocalRequireModule(require);



export async function initNotebookCodeEnv(_ENV?:any){
    if(_ENV==undefined){
        _ENV=TaskLocalEnv.get();
    }
    let ts=await getTypescriptModuleTjs();
    await WaitUntil(()=>_ENV.jsnotebook!=undefined,100,1000);
    let codeContext=_ENV.__codeContext as LocalRunCodeContext;
    if(!codeContext.sourceProcessors.some((t1:any)=>t1.name==__name__)){
        codeContext.sourceProcessors.unshift({
            name:__name__,
            process:async (processContext:{source:string,_ENV:any,declVars:string[]})=>{
                let compiledCode=ts.transpile(
                    processContext.source,
                    {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,esModuleInterop:false},
                    '__anonymous__.ts',
                    [],
                    '__anonymous__'
                );
                compiledCode=compiledCode.replace(/export \{\};/,'');
                processContext.source=compiledCode;
            }
        })
    }
    if(_ENV.jsnotebook[__name__]==undefined){
        let nbexp={
            typeDecl:{
                __decl:new Map<string,{uid:string,decl:string}>(),
                add(a:{uid?:string,decl:string}){
                    let b={uid:a.uid??GenerateRandomString(),decl:a.decl}
                    this.__decl.set(b.uid,b);
                    _ENV.event.dispatchEvent(new CodeContextEvent(__name__+'.declChange'));
                    return b.uid;
                },
                del(uid:string){
                    this.__decl.delete(uid);
                    _ENV.event.dispatchEvent(new CodeContextEvent(__name__+'.declChange'));
                },
                getAll(){
                    return Array.from(this.__decl.values())
                }
            }
        }
        _ENV.jsnotebook[__name__]=nbexp;
        _ENV.jsnotebook.notebookViewer.openNotebookFileInWebui=(path:string)=>_ENV.jsnotebook.callMethodAttachedOnNotebookViewer('openNotebookFileInWebui',[path])
        nbexp.typeDecl.add({uid:__name__+'.ENV',decl:`
declare let _ENV:any
declare function deleteVariables(name: string[]): void;
import { Task,logger } from 'partic2/jsutils1/base';
declare let tasks:Record<string,Task>
interface __type__ENV_jsnotebook_notebookViewer {
    hasMethod(name: string): Promise<boolean>;
    reconnectCodeContextSoon():Promise<void>;
    openNotebookFileInWebui(path:string):Promise<void>
}
interface __type__ENV_jsnotebook {
    callMethodAttachedOnNotebookViewer(name: string, argv?: any[], waitResult?: boolean): Promise<any>;
    callFunctionInNotebookWebui(module:string,fnName:string,args:any[]):Promise<void>;
    notebookViewer: __type__ENV_jsnotebook_notebookViewer;
}
declare let jsnotebook: __type__ENV_jsnotebook
`})
    }
}





export async function getNotebookEnvAllTypeDecl(_ENV?:any):Promise<Array<{uid:string,decl:string}>>{
    if(_ENV==undefined){
        _ENV=TaskLocalEnv.get();
    }
    if(_ENV.jsnotebook[__name__]==undefined){
        await initNotebookCodeEnv(_ENV);
    }
    return _ENV.jsnotebook[__name__].typeDecl.getAll()
}

export async function addNotebookEnvTypeDecl(arg:{_ENV?:any,uid?:string,decl:string}){
    let _ENV=arg._ENV??TaskLocalEnv.get();
    if(_ENV.jsnotebook[__name__]==undefined){
        await initNotebookCodeEnv(_ENV);
    }
    _ENV.jsnotebook[__name__].typeDecl.add(arg);
}