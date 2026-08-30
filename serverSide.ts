import { GenerateRandomString, requirejs } from "partic2/jsutils1/base";
import { path } from "partic2/jsutils1/webutils";
import { defaultFileSystem, ensureDefaultFileSystem, getSimpleFileSysteNormalizedWWWRoot } from "partic2/CodeRunner/JsEnviron";
import { Singleton, utf8conv } from "partic2/CodeRunner/jsutils2";
import { PxseedExtendLanguageServer } from "partic2/typescriptLanguageServer2026/pxseedutils/lspproxy";
import type * as lspt from 'vscode-languageserver-types'
import { RpcExtendClient1 } from "pxprpc/extend";
import { Client } from "pxprpc/base";
import { getAttachedRemoteRigstryFunction, importRemoteModule, RpcWorker } from "partic2/pxprpcClient/pxseedremotefuncs";


let __name__ = requirejs.getLocalRequireModule(require);


export async function preparePxseedNotebookLspEnviron() {
    await ensureDefaultFileSystem();
    let wwwroot = getSimpleFileSysteNormalizedWWWRoot();
    let nblspenvdir = path.join(wwwroot, __name__, '..', 'nblspenv');
    await defaultFileSystem!.mkdir(nblspenvdir);
    if (await defaultFileSystem!.filetype(nblspenvdir + '/tsconfig.json') == 'none') {
        await defaultFileSystem!.writeAll(nblspenvdir + '/tsconfig.json', utf8conv(JSON.stringify(
{
    "compilerOptions": {
        "paths": {
            "*": [
                "../../../../source/*",
                "../../../../npmdeps/node_modules/*"
            ]
        },
        "target": "ESNext", 
        "module":"ESNext",
        "lib": ["dom","es2021"], 
        "jsx": "react", 
        "moduleResolution": "node", 
        "typeRoots": ["../../../../npmdeps/node_modules/@types"],
        "rootDir":"./src",
        "allowJs": false,
        "checkJs": false,
        "allowSyntheticDefaultImports":true,
        "forceConsistentCasingInFileNames": true,  
        "strict": true, 
        "skipLibCheck": true ,
        "sourceMap": true
    },
    "include": [
        "./src/**/*.ts",
        "./src/**/*.tsx"
    ],
}
)))
    }
    await defaultFileSystem!.mkdir(nblspenvdir+'/src');
}

let tempNotebookFile=new Map<string,{id:string,path:string,uri:string}>();

export async function newTempNotebookFileForLsp(){
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

async function languageServerThreadFactory(){
    let worker=new RpcWorker(__name__+'.languageServerThread');
    let conn=await worker.ensureConnection();
    let client=new RpcExtendClient1(new Client(conn));
    await client.init();
    return client;
}
export let languageServerThread=new Singleton(languageServerThreadFactory)


export async function closeLanguageServerThread(){
    if(languageServerThread.done){
        let lst=await languageServerThread.get();
        let func=await getAttachedRemoteRigstryFunction(lst);
        await func.jsExec(`globalThis.close()`,null).catch(()=>{});
        languageServerThread=new Singleton(languageServerThreadFactory);
    }
}

export async function getTypescriptProxyLsp(){
    let lspc=await importRemoteModule(languageServerThread,'partic2/typescriptLanguageServer2026/lsp-connection') as typeof import('partic2/typescriptLanguageServer2026/lsp-connection')
    let conn=await lspc.createLspConnection({showMessageLevel:2});
    return new PxseedExtendLanguageServer({
        async send(message: any): Promise<void> {
            let encmsg=JSON.stringify(message);
            await conn.writeMessage(encmsg);
        },
        async receive(): Promise<any> {
            let encmsg=await conn.readMessage();
            return JSON.parse(encmsg)
        },
        close(){conn.close();}
    })
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

export async function getSummaryOfLocations(location:lspt.Location[]){
    let result=new Array<{location:lspt.Location,summary:string}>();
    await ensureDefaultFileSystem();
    for(let t1 of location){
        let path=new URL(t1.uri).pathname;
        let t2=await defaultFileSystem!.readAll(path);
        if(t2!=null){
            let summary=utf8conv(t2).split(/\n/g).at(t1.range.start.line);
            if(summary!=undefined){
                result.push({summary,location:t1});
            }
        }
    }
    return result;
}