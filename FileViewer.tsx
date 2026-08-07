import * as React from 'preact';
import { RpcExtendClient1 } from 'pxprpc/extend'
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import { SimpleFileSystem, TjsSfs } from 'partic2/CodeRunner/JsEnviron';
import { utf8conv } from 'partic2/CodeRunner/jsutils2';
import { future } from 'partic2/jsutils1/base';
import * as codemirror from 'codemirror';
import * as cms from '@codemirror/state';
import * as cmjs from '@codemirror/lang-javascript';
import * as cmv from '@codemirror/view';
import * as cmlsp from 'partic2/codemirror2026/lsp-client/index';
import { NotebookViewer } from 'partic2/JsNotebook/notebook';
import { CodeMirrorCellList } from './CodeCell';
import { openNewWindow } from 'partic2/pComponentUi/workspace';
import { tjsFrom } from 'partic2/tjshelper/tjsonjserpc';


export class TypeScriptCodeFileViewer extends React.Component<{context:{rpc:RpcExtendClient1,fs:SimpleFileSystem},
    path:string,languageServerClient?:cmlsp.LSPClient,initialSelect?:{anchor:number,focus:number}}>{
    rref={
        codeMirrorDiv:new ReactRefEx<HTMLDivElement>()
    }
    async reloadFile(){
        let bindata=await this.props.context.fs.readAll(this.props.path);
        if(bindata!=null){
            let content=utf8conv(bindata);
            let cmev=await this.codemirrorEditorView.get();
            cmev.dispatch({changes:{from:0,to:cmev.state.doc.length,insert:content}});
        }
    }
    async saveFile(){
        let cmev=await this.codemirrorEditorView.get();
        let content=cmev.state.doc.toString();
        let bindata=utf8conv(content);
        await this.props.context.fs.writeAll(this.props.path,bindata);
    }
    codemirrorEditorView=new future<cmv.EditorView>();
    async componentDidMount(){
        let div1=await this.rref.codeMirrorDiv.waitValid();
        let extensions=[
            codemirror.basicSetup, cmjs.javascript({ typescript: true }), cms.Prec.high(cmv.keymap.of([
        ]))]
        if(this.props.languageServerClient!=null){
            extensions.push(this.props.languageServerClient.plugin('file://'+this.props.path, 'typescript'));
        }
        let eview=new codemirror.EditorView({
            state: cms.EditorState.create({
                extensions,
            }),
            parent: div1,
        });
        this.codemirrorEditorView.setResult(eview);
        await this.reloadFile();
        if(this.props.initialSelect!=null){
            eview.dispatch({
                selection: { anchor: this.props.initialSelect.anchor,head:this.props.initialSelect.focus },
                effects: cmv.EditorView.scrollIntoView(this.props.initialSelect.focus, { y: 'center' }) // 'center' let the selected line be centered
            });
        }
    }
    render(): React.ComponentChildren {
        return <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
            <div style={{display:'flex',flexDirection:'row',flex:0}}>
                <a href="javascript:;" onClick={()=>this.saveFile()}>Save</a>
                <span style={{padding:'0 10px'}}></span>
                <a href="javascript:;" onClick={()=>this.reloadFile()}>Reload</a>
            </div>
            <div ref={this.rref.codeMirrorDiv} style={{flex:1,overflow:'auto',minHeight:'300px'}}></div>
        </div>
    }
}


export class CodeMirrorNotebook extends NotebookViewer{
    async useRpc(rpc?: { name: string | null; }): Promise<void> {
        await super.useRpc(rpc);
    }
    async doLoad(): Promise<void> {
        await super.doLoad();
    }
    protected renderCodeCellList(): React.JSX.Element {
        return <CodeMirrorCellList codeContext={this.codeContext!} ref={this.rref.ccl} cellProps={{
            onInputChange:(target)=>this.onCellInputChange(target)
        }}/>
    }
    async openTypescriptCodeFileViewer(path:string,opt?:{initialSelect?:{anchor:number,focus:number}}){
        let rpc=(await this.props.context.rpc.ensureConnected())!;
        let fs=new TjsSfs().from(await tjsFrom(rpc));
        notebookLspClien
        await openNewWindow(<TypeScriptCodeFileViewer context={{rpc,fs}} path={path} {...opt} languageServerClient={ls}/>)
    }
}

