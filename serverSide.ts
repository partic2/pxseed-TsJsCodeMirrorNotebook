import { GenerateRandomString, requirejs } from "partic2/jsutils1/base";
import { path } from "partic2/jsutils1/webutils";
import { defaultFileSystem, ensureDefaultFileSystem, getSimpleFileSysteNormalizedWWWRoot } from "partic2/CodeRunner/JsEnviron";
import { utf8conv } from "partic2/CodeRunner/jsutils2";
import { PxseedExtendLanguageServer } from "partic2/typescriptLanguageServer2026/pxseedutils/lspproxy";
import { initNotebookCodeEnv } from "../JsNotebook/workerinit";



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

export async function getTypescriptProxyLsp(){
    let lspc=await import('partic2/typescriptLanguageServer2026/lsp-connection');
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


