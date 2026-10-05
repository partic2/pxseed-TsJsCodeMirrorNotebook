import * as React from 'preact';
import { RpcExtendClient1 } from 'pxprpc/extend'
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import { SimpleFileSystem, TjsSfs } from 'partic2/CodeRunner/JsEnviron';
import { utf8conv } from 'partic2/CodeRunner/jsutils2';
import { future, requirejs, sleep } from 'partic2/jsutils1/base';


import { NotebookViewer } from 'partic2/JsNotebook/notebook';
import { CodeMirrorCellList } from './CodeCell';
import { openNewWindow } from 'partic2/pComponentUi/workspace';
import { tjsFrom } from 'partic2/tjshelper/tjsonjserpc';
import { DynamicPageCSSManager } from 'partic2/jsutils1/webutils';
import { defaultServerFileSystem, defaultTypescriptLanguageServiec } from './webuiutils';
import { TypescriptCodemirrorEditor } from './cmts/preact';
import type { TsServerNameDefinition, TsServerWorker } from './cmts/worker';
import { rootWindowGroup } from 'partic2/pComponentUi/window';


let __name__=requirejs.getLocalRequireModule(require);

let cssPrefix=__name__.replace(/\//g,'-')
export let css={
    codemirrorContainer:cssPrefix+'-codemirrorContainer'
}

DynamicPageCSSManager.PutCss(`.${css.codemirrorContainer} .cm-editor`,['height:100%']);
DynamicPageCSSManager.PutCss(`.${css.codemirrorContainer} .cm-scroller`,['overflow:auto']);

export class TypeScriptCodeFileViewer extends React.Component<{
    path:string,initialSelection?:{
        anchor:number,
        focus:number
    }}>{
    path?:string;
    initialSelection?:{anchor:number,focus:number}
    tsserver?:TsServerWorker
    protected initialized=new future<void>();
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.initialSelection=this.props.initialSelection;
        this.path=this.props.path;
        (async ()=>{
            this.tsserver=await defaultTypescriptLanguageServiec.get();
            this.initialized.setResult();
            this.setState({});
        })();
    }
    rref={
        editor:new ReactRefEx<TypescriptCodemirrorEditor>()
    }
    async reloadFile(){
        await this.initialized.get();
        let fs=await defaultServerFileSystem.get();
        let bindata=await fs.readAll(this.props.path);
        if(bindata!=null){
            let content=utf8conv(bindata);
            let cmev=await this.rref.editor.waitValid();
            cmev.setCurrentDocumentText(content);
        }
    }
    async saveFile(){
        let fs=await defaultServerFileSystem.get();
        let cmev=await this.rref.editor.waitValid();
        let content=cmev.getCurrentDocumentText();
        let bindata=utf8conv(content);
        await fs.writeAll(this.props.path,bindata);
    }
    async componentDidMount(){
        await this.reloadFile();
        if(this.initialSelection!=null){
            (async ()=>{
                await sleep(300);
                (await this.rref.editor.waitValid()).select({anchor:this.initialSelection!.anchor,focus:this.initialSelection!.focus,scrollTo:true});
            })();
        }
    }
    async gotoDefinitionOpenView(def: TsServerNameDefinition){
        let fileName=def.uri.substring(def.uri.lastIndexOf('/'));
        let newWindow=await openNewWindow(<TypeScriptCodeFileViewer path={def.uri.substring('file://'.length)} initialSelection={{anchor:def.span[0],focus:def.span[1]}} />,
            {title:fileName});
        let size=rootWindowGroup.get()!.getSize();
        if(size.width>500){
            size.width=size.width*0.8;
        }
        if(size.height>400){
            size.height=size.height*0.8;
        }
        (await newWindow.windowRef.waitValid()).layout({width:size.width,height:size.height})
    }
    render(): React.ComponentChildren {
        if(this.initialized.done){
            return <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:'400px',minWidth:'300px',overflow:'hidden',flexGrow:'1',flexShrink:'1',position:'relative'}}>
               <div style={{display:'flex',flexDirection:'row',justifyContent:'space-evenly'}}>
                <a href="javascript:;" onClick={()=>this.saveFile()}>Save</a>
                <a href="javascript:;" onClick={()=>this.reloadFile()}>Reload</a>
               </div>
               <div style={{flexGrow:'1',position:'relative'}}>
                <TypescriptCodemirrorEditor ref={this.rref.editor} tsserver={this.tsserver} fileUri={'file://'+this.path} 
                    layoutHeight={'fill parent'}
                    onGotoDefinitionOpenView={(def)=>{this.gotoDefinitionOpenView(def)}}/>
               </div>
            </div>
        }else{
            return <div>Initializing...</div>
        }
        
    }
}


