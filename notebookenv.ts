import { CodeContextEvent, TaskLocalEnv } from "partic2/CodeRunner/CodeContext";
import { GenerateRandomString, requirejs, WaitUntil } from "partic2/jsutils1/base";

let __name__=requirejs.getLocalRequireModule(require);



export async function initNotebookCodeEnv(_ENV?:any){
    if(_ENV==undefined){
        _ENV=TaskLocalEnv.get();
    }
    await WaitUntil(()=>_ENV.jsnotebook!=undefined,100,1000);
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
        nbexp.typeDecl.add({uid:__name__+'.ENV',decl:`
declare function deleteVariables(name:string[]):void;
import {Task} from 'partic2/jsutils1/base';

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