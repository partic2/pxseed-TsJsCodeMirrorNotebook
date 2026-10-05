import { GenerateRandomString, requirejs } from "partic2/jsutils1/base";
import { path } from "partic2/jsutils1/webutils";
import { defaultFileSystem, ensureDefaultFileSystem, getSimpleFileSysteNormalizedWWWRoot } from "partic2/CodeRunner/JsEnviron";
import { Singleton, utf8conv } from "partic2/CodeRunner/jsutils2";
import { PxseedExtendLanguageServer } from "partic2/typescriptLanguageServer2026/pxseedutils/lspproxy";
import { RpcExtendClient1 } from "pxprpc/extend";
import { Client } from "pxprpc/base";
import { getAttachedRemoteRigstryFunction, importRemoteModule, RpcWorker } from "partic2/pxprpcClient/pxseedremotefuncs";


let __name__ = requirejs.getLocalRequireModule(require);


export async function preparePxseedNotebookLspEnviron() {
    await ensureDefaultFileSystem();
    let wwwroot = getSimpleFileSysteNormalizedWWWRoot();
    let nblspenvdir = path.join(wwwroot, __name__, '..', 'nblspenv');
    await defaultFileSystem!.mkdir(nblspenvdir);
    await defaultFileSystem!.mkdir(nblspenvdir+'/src');
}

let tempNotebookFile=new Map<string,{id:string,path:string,uri:string}>();

export async function newTempLspNotebookFile(){
    await ensureDefaultFileSystem();
    let wwwroot = getSimpleFileSysteNormalizedWWWRoot();
    let nblspenvdir = path.join(wwwroot, __name__, '..', 'nblspenv');
    if(tempNotebookFile.size==0){
        for(let t1 of await defaultFileSystem!.listdir(`${nblspenvdir}/src`)){
            if(t1.name.startsWith('nb')){
                defaultFileSystem!.delete2(`${nblspenvdir}/src/${t1.name}`)
            }
        }
    }
    let fileId=GenerateRandomString();
    let path1=`${nblspenvdir}/src/nb${fileId}.ts`;
    tempNotebookFile.set(fileId,{id:fileId,path:path1,uri:'file://'+path1});
    await defaultFileSystem!.writeAll(path1,utf8conv(''));
    return tempNotebookFile.get(fileId)!
}

export async function delTempNotebookFileForLsp(file:{id:string}){
    await ensureDefaultFileSystem();
    let wwwroot = getSimpleFileSysteNormalizedWWWRoot();
    let nblspenvdir = path.join(wwwroot, __name__, '..', 'nblspenv');
    let t1=tempNotebookFile.get(file.id);
    if(t1!=undefined){
        defaultFileSystem!.delete2(t1.path);
        tempNotebookFile.delete(file.id);
    }
}

export async function getEntryNotebookFilePath(){
    await ensureDefaultFileSystem();
    let dataDir=path.join(getSimpleFileSysteNormalizedWWWRoot(),__name__,'..','data');
    let notebookFilePath=path.join(dataDir,'__entry.ijsnb');
    if(await defaultFileSystem!.filetype(notebookFilePath)=='none'){
        await defaultFileSystem!.writeAll(notebookFilePath,new Uint8Array(0));
    }
    await defaultFileSystem!.mkdir(dataDir);
    return notebookFilePath;
}

