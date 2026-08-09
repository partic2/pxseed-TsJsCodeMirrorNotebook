import * as React from 'preact';
import { RpcExtendClient1 } from 'pxprpc/extend'
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import { SimpleFileSystem, TjsSfs } from 'partic2/CodeRunner/JsEnviron';
import { utf8conv } from 'partic2/CodeRunner/jsutils2';
import { future, requirejs } from 'partic2/jsutils1/base';
import * as codemirror from 'codemirror';
import * as cms from '@codemirror/state';
import * as cmjs from '@codemirror/lang-javascript';
import * as cmv from '@codemirror/view';
import * as cmlsp from 'partic2/codemirror2026/lsp-client/index';
import { NotebookViewer } from 'partic2/JsNotebook/notebook';
import { CodeMirrorCellList } from './CodeCell';
import { openNewWindow } from 'partic2/pComponentUi/workspace';
import { tjsFrom } from 'partic2/tjshelper/tjsonjserpc';
import { defaultFileSystem, defaultLspClient, serverSide } from './webuiutils';
import { DynamicPageCSSManager } from 'partic2/jsutils1/webutils';


let __name__=requirejs.getLocalRequireModule(require);

let cssPrefix=__name__.replace(/\//g,'-')
export let css={
    codemirrorContainer:cssPrefix+'-codemirrorContainer'
}

DynamicPageCSSManager.PutCss(`.${css.codemirrorContainer} .cm-editor`,['height:100%']);
DynamicPageCSSManager.PutCss(`.${css.codemirrorContainer} .cm-scroller`,['overflow:auto']);

export class TypeScriptCodeFileViewer extends React.Component<{
    path:string,initialSelect?:{
        anchor:number|{line:number,character:number},
        focus:number|{line:number,character:number}
    }}>{
    rref={
        codeMirrorDiv:new ReactRefEx<HTMLDivElement>()
    }
    async reloadFile(){
        let fs=await defaultFileSystem.get();
        let bindata=await fs.readAll(this.props.path);
        if(bindata!=null){
            let content=utf8conv(bindata);
            let cmev=await this.codemirrorEditorView.get();
            cmev.dispatch({changes:{from:0,to:cmev.state.doc.length,insert:content}});
        }
    }
    async saveFile(){
        let fs=await defaultFileSystem.get();
        let cmev=await this.codemirrorEditorView.get();
        let content=cmev.state.doc.toString();
        let bindata=utf8conv(content);
        await fs.writeAll(this.props.path,bindata);
    }
    codemirrorEditorView=new future<cmv.EditorView>();
    async componentDidMount(){
        let div1=await this.rref.codeMirrorDiv.waitValid();
        let extensions=[
            codemirror.basicSetup, cmjs.javascript({ typescript: true }), cms.Prec.high(cmv.keymap.of([
        ]))]
        
        let lsp=await defaultLspClient.get();
        let lspuri='file://'+this.props.path;
        extensions.push(lsp.cmclient.plugin(lspuri, 'typescript'));
        extensions.push(cmv.EditorView.domEventHandlers({
            click:(event,eview)=>{
                (async ()=>{
                    const isCtrlPressed = event.ctrlKey || event.metaKey;
                    if (isCtrlPressed && event.button === 0) {
                        const pos = eview.posAtCoords({ x: event.clientX, y: event.clientY });
                        if (pos === null) return;
                        const line=eview.state.doc.lineAt(pos);
                        const character=pos-line.from;
                        let def1=await lsp.lspproxy.getDefinition({line:line.number-1,character,textDocument:{uri:lspuri}});
                        for(let t1 of def1){
                            //Typescript language server issue.
                            t1.uri=decodeURIComponent(t1.uri);
                        }
                        let serverSideImpl=await serverSide.get();
                        let summary=await serverSideImpl.getSummaryOfLocations(def1);
                        openNewWindow(<div>{
                            summary.map(t1=><a href="javascript:;" onClick={async ()=>{
                                openNewWindow(<TypeScriptCodeFileViewer path={new URL(t1.location.uri).pathname}
                                initialSelect={{
                                    anchor:t1.location.range.start,
                                    focus:t1.location.range.end
                                }}
                                />,{title:t1.location.uri.substring(t1.location.uri.lastIndexOf('/'))})
                            }}>
                                <div>{t1.location.uri}</div>
                                <div>{t1.summary}</div>
                            </a>)
                        }</div>,{title:'definition'})
                    }
                })();
            }
        }));
        let eview=new codemirror.EditorView({
            state: cms.EditorState.create({
                extensions,
            }),
            parent: div1,
        });
        this.codemirrorEditorView.setResult(eview);
        
        await this.reloadFile();
        if(this.props.initialSelect!=null){
            if(typeof this.props.initialSelect.anchor!='number'){
                let line = eview.state.doc.line(Math.max(1, Math.min(eview.state.doc.lines, this.props.initialSelect.anchor.line+1)));
                this.props.initialSelect.anchor=line.from+this.props.initialSelect.anchor.character;
            }
            if(typeof this.props.initialSelect.focus!='number'){
                let line = eview.state.doc.line(Math.max(1, Math.min(eview.state.doc.lines, this.props.initialSelect.focus.line+1)));
                this.props.initialSelect.focus=line.from+this.props.initialSelect.focus.character;
            }
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
            <div ref={this.rref.codeMirrorDiv} class={css.codemirrorContainer} style={{flex:1,minHeight:'300px'}}></div>
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
        
        await openNewWindow(<TypeScriptCodeFileViewer path={path} {...opt}/>)
    }
}

