
import * as React from 'preact'
import { ReactRefEx } from 'partic2/pComponentUi/domui';
import * as cms from '@codemirror/state';
import * as cmjs from '@codemirror/lang-javascript';
import * as cmv from '@codemirror/view';
import * as cmac from '@codemirror/autocomplete';
import * as cml from '@codemirror/lint';
import type { TsServerWorker } from './worker';
import { CodeMirrorEditor } from 'partic2/codemirror2026/preact'
import { mutex, sleep } from 'partic2/jsutils1/base';
import ts from 'typescript'






/**
 * Shared method between the default tooltipRenderer
 * and default autocompleteRenderer. This renders TypeScript's
 * SymbolDisplayPart into HTML. You will probably swap this out with a
 * renderer of your own.
 */
const renderDisplayParts = (displayParts: ts.SymbolDisplayPart[]) => {
  const div = document.createElement("div");
  for (const part of displayParts) {
    const span = div.appendChild(document.createElement("span"));
    span.className = `quick-info-${part.kind}`;
    span.innerText = part.text;
  }
  return div;
};
interface HoverInfo {
  start: number;
  end: number;
  /** Type definitions returned by ts.LanguageService.getTypeDefinitionAtPosition() */
  typeDef: readonly ts.DefinitionInfo[] | undefined;
  /** Definitions returned by ts.LanguageService.getDefinitionAtPosition() */
  def: readonly ts.DefinitionInfo[] | undefined;
  quickInfo: ts.QuickInfo | undefined;
}

export class TypescriptCodemirrorEditor<P={}> extends CodeMirrorEditor<P&{worker?:TsServerWorker,path?:string,docOffset?:()=>number}>{
    remoteDocUpdating=new mutex();
    snapshotDocSize=0;
    getCurrentDocumentText(){
        let t1=this.codemirrorEditorView!.state.doc.toString();
        t1+='\n';
        return t1;
    }
    worker?:TsServerWorker;
    path?:string;
    docOffset?:()=>number;
    constructor(props:any,ctx:any){
        super(props,ctx);
        this.worker=props.worker
        this.path=props.path
        this.docOffset=props.docOffset
    }
    override async onDocumentChange(update: cmv.ViewUpdate): Promise<void> {
        await super.onDocumentChange(update);
        await this.remoteDocUpdating.exec(async ()=>{
            let docOffset=this.props.docOffset?.()??0;
            let code=this.getCurrentDocumentText();
            await this.worker!
                .updateFile({
                    path: this.path!,code,
                    range:[docOffset,this.snapshotDocSize]
                });
            this.snapshotDocSize=code.length;
        });
    }
    override async provideCompletion(context: cmac.CompletionContext): Promise<cmac.CompletionResult | null> {
        if (context.explicit) {
            return await this.requestCompletion(context);
        }
        const lastCharMatch = context.matchBefore(/./);
        const lastChar = lastCharMatch ? lastCharMatch.text : '';
        const isTriggerChar = ['', '.', ' ', '\n', '{'].includes(lastChar);
        if (!isTriggerChar) {
            return null;
        }
        if (isTriggerChar) {
            return await this.requestCompletion(context);
        }
        return null;
    }
    protected async requestCompletion(context: cmac.CompletionContext): Promise<cmac.CompletionResult | null> {
        return await this.remoteDocUpdating.exec(async () => {
            const cpinfo = await this.worker!.getAutocompletion({
                path: this.path!,
                pos: context.pos,
                explicit: context.explicit
            });
            if(cpinfo==null)return null;
            let cp=cpinfo.entries;
            let from=cpinfo.from
            const completionEntries = cp.map(t1=>({
                label:t1.label,
                type:String(t1.kind),
                detail:(t1.details??'')+(t1.description??'')
            } satisfies cmac.Completion))
            let completionResult:cmac.CompletionResult={
                from,options:completionEntries,
                validFor:/^\w*$/
            }
            return completionResult;
        });
    }
    override async provideLint(view: cmv.EditorView): Promise<cml.Diagnostic[]> {
        return this.props.worker
            ? this.props.worker.getLints({path: this.props.path!})
            : [];
    }
    tooltipRender(info: HoverInfo) {
        const div = document.createElement("div");
        if (info.quickInfo?.displayParts) {
            div.appendChild(renderDisplayParts(info.quickInfo.displayParts));
        }
        return { dom: div };
    };
    override async provideHoverTooltip(view: cmv.EditorView, pos: number, side: number): Promise<cmv.Tooltip | readonly cmv.Tooltip[] | null> {
        const hoverData = await this.worker!.getHover({
            path: this.path!,
            pos,
        });
        if (!hoverData) {
            return null;
        }
        return {
            pos: hoverData.start,
            end: hoverData.end,
            create: () => this.tooltipRender(hoverData),
        };
    }
}