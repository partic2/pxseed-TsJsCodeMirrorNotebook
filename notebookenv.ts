import { CodeContextEvent, TaskLocalEnv } from "../CodeRunner/CodeContext";
import { GenerateRandomString, requirejs } from "partic2/jsutils1/base";

let __name__=requirejs.getLocalRequireModule(require);

export async function initNotebookCodeEnv(_ENV?:any){
    if(_ENV==undefined){
        _ENV=TaskLocalEnv.get();
    }
    if(_ENV.jsnotebook[__name__]==undefined){
        _ENV.jsnotebook.typescript={
            headcell:{
                _decl:new Map<string,{uid:string,decl:string}>(),
                add(a:{uid?:string,decl:string}){
                    let b={uid:a.uid??GenerateRandomString(),decl:a.decl}
                    this._decl.set(b.uid,b);
                    _ENV.event.dispatchEvent(new CodeContextEvent(''))
                    return b.uid;
                },
                del(uid:string){
                    this._decl.delete(uid);
                }
            }
        }
    }

}