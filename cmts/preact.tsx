
import * as React from 'preact'
import { ReactRefEx } from 'partic2/pComponentUi/domui';

import * as cmv from 'partic2/codemirror2026/prebuilt/@codemirror-view';
import * as cmac from 'partic2/codemirror2026/prebuilt/@codemirror-autocomplete';
import * as cml from 'partic2/codemirror2026/prebuilt/@codemirror-lint';

import type { TsServerNameDefinition, TsServerWorker } from './worker';
import { CodeMirrorEditor } from 'partic2/codemirror2026/preact'
import { logger, mutex, requirejs, sleep } from 'partic2/jsutils1/base';
import ts from 'typescript'
import { openNewWindow } from 'partic2/pComponentUi/workspace';
import {alert} from 'partic2/pComponentUi/window'



let __name__=requirejs.getLocalRequireModule(require);
let log=logger.getLogger(__name__);



interface HoverInfo {
  start: number;
  end: number;
  /** Type definitions returned by ts.LanguageService.getTypeDefinitionAtPosition() */
  typeDef: readonly ts.DefinitionInfo[] | undefined;
  /** Definitions returned by ts.LanguageService.getDefinitionAtPosition() */
  def: readonly ts.DefinitionInfo[] | undefined;
  quickInfo: string | undefined;
}

export class TypescriptCodemirrorEditor<P={}> extends CodeMirrorEditor<P&{
    tsserver?:TsServerWorker,fileUri?:string,onGotoDefinitionOpenView?:(def:TsServerNameDefinition)=>void
}>{
    snapshotDocSize=0;
    getDocumentTextForLanguageService(){
        let t1=this.codemirrorEditorView!.state.doc.toString();
        return t1;
    }
    languageServiceDocumentOffset(){
        return 0;
    }
    remoteDocUpdating=new mutex();
    tsserver?:TsServerWorker;
    fileUri?:string;
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.tsserver=this.props.tsserver;
        this.fileUri=this.props.fileUri;
        this.setDomEventHandlers({
            mousedown: (event, view) => {
            const isModKey = event.ctrlKey || event.metaKey;
            if (isModKey && event.button === 0) {
                return true;
            }
            return false;
        },
        click: (event, view) => {
            const isModKey = event.ctrlKey || event.metaKey;
            if (isModKey && event.button === 0 ) {
                (async ()=>{
                    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                    if(pos!=null && this.tsserver!=undefined){
                        let defs=await this.tsserver.getDefinition({uri:this.fileUri!,pos:pos+this.languageServiceDocumentOffset()});
                        if(defs!=null){
                            this.onGotoDefinitionRequest(defs);
                        }
                    }
                })();
                return true;
            }
            return false;
        },
        })
    }
    override async componentDidMount(){
        await super.componentDidMount();
        this.addKeybinding({
            key:'Tab',
            run:(v)=>cmac.acceptCompletion(v)
        });
        await this.remoteDocUpdating.exec(async ()=>{
            let docOffset=this.languageServiceDocumentOffset();
            let code=this.getDocumentTextForLanguageService();
            await this.tsserver!
                .updateFile({
                    uri: this.fileUri!,code,
                    range:[docOffset,docOffset+this.snapshotDocSize]
                });
            this.snapshotDocSize=code.length;
        });
    }
    override async onDocumentChange(update: cmv.ViewUpdate): Promise<void> {
        await super.onDocumentChange(update);
        if(this.tsserver!=undefined){
            await this.remoteDocUpdating.exec(async ()=>{
                let docOffset=this.languageServiceDocumentOffset();
                let code=this.getDocumentTextForLanguageService();
                await this.tsserver!
                    .updateFile({
                        uri: this.fileUri!,code,
                        range:[docOffset,docOffset+this.snapshotDocSize]
                    });
                this.snapshotDocSize=code.length;
            });
        }
        let insertedText = "";
        update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            insertedText += inserted.toString();
        });
        if (['(','()'].includes(insertedText)) {
            this.activateHover(update.state.selection.main.head-1,1)
        }
    }
    async onGotoDefinitionRequest(defs: TsServerNameDefinition[]){
        if(defs.length==1){
            this.props.onGotoDefinitionOpenView?.(defs[0]);
        }else{
            let wnd=await openNewWindow(<div>{defs.map(t1=><div>
                <div><a href="javascript:;" onClick={()=>{
                    wnd.close();
                    this.props.onGotoDefinitionOpenView?.(t1);
                }}>{t1.uri}:{t1.span[0]}-{t1.span[1]}</a></div>
                <div style={{whiteSpace:'pre-wrap'}}>{t1.summary}</div>
            </div>)}</div>)
            
        }
    }
    override async provideCompletion(context: cmac.CompletionContext): Promise<cmac.CompletionResult | null> {
        if (context.explicit) {
            return await this.requestCompletion(context);
        }
        const lastChars = context.matchBefore(/..?/);
        if (lastChars?.text==undefined) {return null;}
        if (/[./"']$/.test(lastChars.text) || /[\s({]?\w$/.test(lastChars.text)) {
            return await this.requestCompletion(context);
        }
        return null;
    }
    protected async requestCompletion(context: cmac.CompletionContext): Promise<cmac.CompletionResult | null> {
        if(this.tsserver!=null){
            return await this.remoteDocUpdating.exec(async () => {
                let offset=this.languageServiceDocumentOffset();
                const cpinfo = await this.tsserver!.getAutocompletion({
                    uri: this.fileUri!,
                    pos: context.pos+offset,
                    explicit: context.explicit,
                });
                if(cpinfo==null)return null;
                let cp=cpinfo.entries;
                let from=cpinfo.from-offset
                const kindMap:Record<string,string>={
                    'var':'variable',
                    'module':'namespace',
                    'const':'constant',
                }
                const completionEntries = cp.map(t1=>({
                    label:t1.label,
                    type:kindMap[String(t1.kind)]??t1.kind,
                    detail:(t1.details??'')+(t1.description??''),
                } satisfies cmac.Completion))
                let completionResult:cmac.CompletionResult={
                    from,options:completionEntries,
                    validFor:/^\w*$/
                }
                return completionResult;
            });
        }else{
            return null;
        }
    }
    override async provideLint(view: cmv.EditorView): Promise<cml.Diagnostic[]> {
        if(this.tsserver==null)return [];
        let offset=this.languageServiceDocumentOffset();
        let rangeEnd=offset+this.getDocumentTextForLanguageService().length;
        let lintResult:cml.Diagnostic[];
        lintResult=await this.tsserver!.getLints({uri:this.fileUri!,range:[offset,offset+rangeEnd]});
        let codemirrorDocLength=this.getCurrentDocumentText().length;
        for(let t1 of lintResult){
            t1.from-=offset;
            t1.to-=offset;
            if(t1.to>codemirrorDocLength){
                t1.to=codemirrorDocLength;
            }
        }
        return lintResult;
    }
    tooltipRender(info: HoverInfo) {
        const div = document.createElement("div");
        if (info.quickInfo) {
            div.innerHTML=info.quickInfo
        }
        return { dom: div };
    };
    override async provideHoverTooltip(view: cmv.EditorView, pos: number, side: number): Promise<cmv.Tooltip | readonly cmv.Tooltip[] | null> {
        if(this.tsserver==null)return null;
        let offset=this.languageServiceDocumentOffset();
        const hoverData = await this.tsserver!.getHover({
            uri: this.fileUri!,
            pos:pos+offset,
        });
        if (!hoverData) {
            return null;
        }
        return {
            pos: hoverData.start-offset,
            end: hoverData.end-offset,
            create: () => this.tooltipRender(hoverData),
        };
    }
}
