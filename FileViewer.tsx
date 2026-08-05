import * as React from 'preact';
import { RpcExtendClient1 } from 'pxprpc/extend'
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import { SimpleFileSystem } from 'partic2/CodeRunner/JsEnviron';
import { utf8conv } from 'partic2/CodeRunner/jsutils2';
import { future } from 'partic2/jsutils1/base';
import * as codemirror from 'codemirror';
import * as cms from '@codemirror/state';
import * as cmjs from '@codemirror/lang-javascript';
import * as cmv from '@codemirror/view';
import * as cmc from '@codemirror/commands';
import * as cmlsp from 'partic2/codemirror2026/lsp-client/index';



export class CodeFileViewer extends React.Component<{context:{rpc:RpcExtendClient1,fs:SimpleFileSystem},path:string,languageServerClient?:cmlsp.LSPClient}>{
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
    codemirrorEditorView=new future<cmv.EditorView>();
    async componentDidMount(){
        let div1=await this.rref.codeMirrorDiv.waitValid();
        let extensions=[
            codemirror.basicSetup, cmjs.javascript({ typescript: true }), cms.Prec.high(cmv.keymap.of([
        ]))]
        if(this.props.languageServerClient!=null){
            extensions.push(this.props.languageServerClient.plugin('file://'+this.props.path, 'typescript'));
        }
        this.codemirrorEditorView.setResult(new codemirror.EditorView({
            state: cms.EditorState.create({
                extensions,
            }),
            parent: div1,
        }));
    }
    render(): React.ComponentChildren {
        return <div>
            <div style={{display:'flex',flexDirection:'row'}}>
                <a href="javascript:;">Save</a>
                <a href="javascript:;">Reload</a>
            </div>
            <div ref={this.rref.codeMirrorDiv}></div>
        </div>
    }
}