import type ts from "typescript";
import { Annotation, StateEffect, StateField } from "@codemirror/state";
import { EditorView, type ViewUpdate, TooltipView, hoverTooltip, Tooltip, Decoration, type DecorationSet, ViewPlugin, WidgetType } from "@codemirror/view";
import { logger, mutex, requirejs } from "partic2/jsutils1/base";
import { TransactionSpec } from '@codemirror/state'
import { type Diagnostic, type LintSource, linter } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import type {
  CompletionContext, CompletionResult, CompletionSource, Completion
} from "@codemirror/autocomplete";
import { insertCompletionText, pickedCompletion } from '@codemirror/autocomplete'
import type { RawCompletion, RawCompletionItem } from './worker'

import { Facet, combineConfig } from "@codemirror/state";
import { TsServerWorker } from "./worker";

let __name__ = requirejs.getLocalRequireModule(require);
let log = logger.getLogger(__name__);

/**
 * Use this facet if you intend to run your TypeScript
 * virtual environment within a web worker.
 *
 * This is how the ts-related extensions are
 * configured: this facet sets the path of the file
 * and the environment to use, and the rest of
 * the extensions, like tsLint and tsAutocomplete,
 * pull those settings automatically from editor state.
 */
export const tsFacet = Facet.define<
  {
    path: string;
    worker: TsServerWorker;
    docOffset?:()=>number;
    log?: (...args: unknown[]) => void;
  },
  FacetConfig
>({
  combine(configs) {
    return combineConfig(configs, {});
  },
});

export type FacetConfig = {
  path: string;
  worker: TsServerWorker;
  log?: (...args: unknown[]) => void;
} | null;


let syncMutex=StateField.define<mutex>({
  create:(s)=>new mutex(),
  update:(v,tr)=>v
})

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


const tsSyncAnnotation = Annotation.define<{
  path: string;
}>();


/**
 * Configuration for the tsSync extension
 */
interface TsSyncConfig {
  /**
   * Given an update object decide whether to take it (true)
   * or to skip updating TypeScript with this.
   */
  filterUpdate: (update: ViewUpdate) => boolean;
}

/**
 * Sync updates from CodeMirror to the worker.
 */
function tsSync(
  { filterUpdate = () => true }: TsSyncConfig = {
    filterUpdate: () => true,
  },
) {
  // TODO: this is a weak solution to the cold start problem.
  // If you boot up a CodeMirror instance, we want the initial
  // value to get loaded into CodeMirror. We do get a change event,
  // but it surprisingly doesn't have `docChanged: true` on it,
  // so this is a rough heuristic to just accept the first event
  // regardless of whether it looks significant.
  let first = true;
  let snapshotSize=0;
  return [syncMutex,
    EditorView.updateListener.of(async (update) => {
    const config = update.view.state.facet(tsFacet);
    if (!config?.worker) return;
    if (!update.docChanged && !first) return;
    if (!filterUpdate(update)) {
      config.log?.("tsSync: update rejected by filterUpdate", { update });
      return;
    }
    first = false;
    config.log?.("tsSync: updating file", { path: config.path });
    let mtx=update.state.field(syncMutex)
    await mtx.exec(async ()=>{
      await config.worker
      .updateFile({
        path: config.path,
        code: update.state.doc.toString(),
      });
    })
    update.view.dispatch({
          annotations: [tsSyncAnnotation.of({ path: config.path })],
        });
  })];
}


const tsLintSource: LintSource = async (
  view,
): Promise<readonly Diagnostic[]> => {
  const config = view.state.facet(tsFacet);
  return config?.worker
    ? config.worker.getLints({
      path: config.path,
    })
    : [];
};



/**
 * Binds the TypeScript `lint()` method with TypeScript's
 * semantic and syntactic diagnostics. You can use
 * the `getLints` method for a lower-level interface
 * to the same data.
 */
export function tsLinter() {
  return linter(tsLintSource);
}

/**
 * The default for CodeMirror completions is that when you hit Tab or the other trigger,
 * it will replace the current 'word' (partially-written text) with the label of the completion.
 * TypeScript provides codeActions that let you import new modules when you accept
 * a completion. This checks whether we have any codeActions, and if we do,
 * lets you import them automatically.
 */
export function codeActionToApplyFunction(codeActions: ts.CodeAction[]) {
  return (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => {
    const insTransaction: TransactionSpec = {
      ...insertCompletionText(view.state, completion.label, from, to),
      annotations: pickedCompletion.of(completion),
    };

    const actionTransactions: TransactionSpec[] = [];

    // Complete, but also implement code actions.
    // https://github.com/codemirror/autocomplete/blob/30307656e85c9e5911a69fe2432de05be1580958/src/state.ts#L322
    for (const action of codeActions) {
      for (const change of action.changes) {
        for (const textChange of change.textChanges) {
          // Note that this may be dangerous! We've had many problems
          // with trying to dispatch transactions on CodeMirror when the length
          // of the document is different than what it expects or needs. I think
          // that this will be safe in that case because we're combining
          // and only declaring the length once.
          //
          // NOTE: this has less than ideal history behavior! ideal this would
          // be composed with `insTransaction` and produce one history event.
          // But that is tough because the two need to perfectly agree on the document that
          // they're editing, and the length of the document changes.
          actionTransactions.push({
            changes: [
              {
                from: textChange.span.start,
                to: textChange.span.start + textChange.span.length,
                insert: textChange.newText,
              },
            ],
            annotations: pickedCompletion.of(completion),
          });
        }
      }
    }

    view.dispatch(...[insTransaction, ...actionTransactions]);
  };
}

const defaultAutocompleteRenderer: AutocompleteRenderer = (raw) => {
  return () => {
    const div = document.createElement("div");
    if (raw?.displayParts) {
      div.appendChild(renderDisplayParts(raw.displayParts));
    }
    return { dom: div };
  };
};


function deserializeCompletion(
  raw: RawCompletionItem,
  opts: AutocompleteOptions,
): Completion {
  const { codeActions, label, type } = raw;

  return {
    label,
    type,
    apply: codeActions ? codeActionToApplyFunction(codeActions) : raw.label,
    info: (opts?.renderAutocomplete ?? defaultAutocompleteRenderer)(raw),
  };
}
function deserializeCompletions(
  raw: RawCompletion | null,
  opts: AutocompleteOptions,
) {
  if (!raw) return raw;
  return {
    from: raw.from,
    options: raw.options.map((o) => deserializeCompletion(o, opts)),
  };
}

type AutocompleteRenderer = (
  arg0: RawCompletionItem,
) => Completion["info"];
type AutocompleteOptions = {
  renderAutocomplete?: AutocompleteRenderer;
};
export function tsAutocomplete(
  opts: AutocompleteOptions = {},
): CompletionSource {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const config = context.state.facet(tsFacet);
    if (!config?.worker) return null;
    const completion = deserializeCompletions(
      await config.worker.getAutocompletion({
        path: config.path,
        // Reduce this object so that it's serializable.
        context: {
          pos: context.pos,
          explicit: context.explicit,
        },
      }),
      opts,
    );

    return completion;
  };
}

/**
 * This information is passed to the API consumer to allow
 * them to create tooltips however they wish.
 */
export interface HoverInfo {
  start: number;
  end: number;
  /** Type definitions returned by ts.LanguageService.getTypeDefinitionAtPosition() */
  typeDef: readonly ts.DefinitionInfo[] | undefined;
  /** Definitions returned by ts.LanguageService.getDefinitionAtPosition() */
  def: readonly ts.DefinitionInfo[] | undefined;
  quickInfo: ts.QuickInfo | undefined;
}


export type TooltipRenderer = (
  arg0: HoverInfo,
  editorView: EditorView,
) => TooltipView;

const defaultRenderer: TooltipRenderer = (info: HoverInfo) => {
  const div = document.createElement("div");
  if (info.quickInfo?.displayParts) {
    div.appendChild(renderDisplayParts(info.quickInfo.displayParts));
  }
  return { dom: div };
};
/**
 * This binds the CodeMirror `hoverTooltip` method
 * with a code that pulls types and documentation
 * from the TypeScript environment.
 */
export function tsHover({
  renderTooltip = defaultRenderer,
}: {
  renderTooltip?: TooltipRenderer;
} = {}) {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const config = view.state.facet(tsFacet);
    if (!config?.worker) return null;
    const hoverData = await config.worker.getHover({
      path: config.path,
      pos,
    });

    if (!hoverData) {
      config.log?.("tsHover: no hover data found at location", { pos });
      return null;
    }

    return {
      pos: hoverData.start,
      end: hoverData.end,
      create: () => renderTooltip(hoverData, view),
    };
  });
}


/**
 * The default setting for the goto handler: this will
 * 'go to' code defined in the same file, and select it.
 * Returns true if it handled this case and the code
 * was in the same file.
 */
function defaultGotoHandler(
  currentPath: string,
  hoverData: HoverInfo,
  view: EditorView,
) {
  const definition = [
    ...(hoverData.typeDef ? hoverData.typeDef : []),
    ...(hoverData.def ? hoverData.def : [])
  ]?.at(0);

  if (definition && currentPath === definition.fileName) {
    const tr = view.state.update({
      selection: {
        anchor: definition.textSpan.start,
        head: definition.textSpan.start + definition.textSpan.length,
      },
    });
    view.dispatch(tr);
    return true;
  }
}

type ToGoOptions = {
  gotoHandler?: typeof defaultGotoHandler;
};

/**
 * Supports 'going to' a variable definition by meta or
 * ctrl-clicking on it.
 *
 * @example
 * tsGotoWorker()
 */
export function tsGoto(
  opts: ToGoOptions = { gotoHandler: defaultGotoHandler },
) {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      const config = view.state.facet(tsFacet);
      if (!config?.worker || !opts.gotoHandler) return false;

      // TODO: maybe this should be _just_ meta?
      // I think ctrl should probably be preserved.
      // Need to check what VS Code does
      if (!(event.metaKey || event.ctrlKey)) return false;

      const pos = view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });

      if (pos === null) return;

      config.worker
        .getHover({
          path: config.path,
          pos,
        })
        .then((hoverData) => {
          config.log?.("tsGoto: going to location", { hoverData });
          // In reality, we enforced that opts.gotoHandler
          // is non-nullable earlier, but TypeScript knows
          // that in this callback, that theoretically could
          // have changed.
          if (hoverData && opts.gotoHandler) {
            opts.gotoHandler(config.path, hoverData, view);
          }
        });

      return true;
    },
  });
}


type SetTwoSlashes = {
  /**
   * This should align with the end of the ^? comment
   */
  from: number;
  /**
   * This is the formatted displayParts that we get back
   * from the worker.
   */
  text: string;
};

/**
 * Generally based off of the playground version of this method.
 * Format displayParts into a short string with no linebreaks.
 */
function formatDisplayParts(displayParts: ts.SymbolDisplayPart[]) {
  let text = displayParts
    .map((d) => d.text)
    .join("")
    .replace(/\r?\n\s*/g, " ");
  if (text.length > 120) text = `${text.slice(0, 119)}...`;
  return text;
}

/**
 * We separate the phases of finding the places to show with the places
 * where twoslash annotations are shown, because getting the definitions
 * requires asynchronous work.
 * This StateEffect is how we communicate getting a new set of definitions.
 */
const setTwoSlashes = StateEffect.define<SetTwoSlashes[]>({
  map: (sets, change) => {
    return sets.map((set) => {
      return {
        from: change.mapPos(set.from),
        text: set.text,
      };
    });
  },
});

// https://github.com/microsoft/TypeScript-Website/blob/v2/packages/playground/src/twoslashInlays.ts
/**
 * Traverse the view trying to find twoslashes comments, and
 * once we've found one, asynchronously get its definition from the worker.
 * When we get all the definitions, trigger a StateEffect that produces
 * the new decorations.
 */
function twoslashes(view: EditorView, config: FacetConfig) {
  if (!config) return null;
  const promises: Promise<SetTwoSlashes | null>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "LineComment") {
          const doc = view.state.doc;
          const commentText = doc.sliceString(node.from, node.to);
          const queryRegex = /^\s*\/\/\s*\^\?$/gm;
          const isTwoslash = queryRegex.test(commentText);
          if (isTwoslash) {
            const nodeTo = node.to;
            // Taking one character off of ^? to position this.
            const targetChar = nodeTo - 2;
            const sourceLine = doc.lineAt(targetChar);
            // TODO: may want to use countColumn here to make this
            // work with tab indentation
            // I do care about the visual alignment here, if you have some
            // indented line with tabs, then the ^? should show what is
            // visually above it.
            const col = targetChar - sourceLine.from;

            // Now find the position of the node above.
            const targetLine = doc.line(sourceLine.number - 1);
            const targetPosition = targetLine.from + col;

            promises.push(
              config.worker
                .getHover({
                  path: config.path,
                  pos: targetPosition,
                })
                .then((hoverInfo) => {
                  const displayParts = hoverInfo?.quickInfo?.displayParts;
                  if (!displayParts) return null;
                  return {
                    from: nodeTo,
                    text: formatDisplayParts(displayParts),
                  };
                }),
            );
          } else {
            // Pass
          }
        }
      },
    });
  }
  Promise.all(promises).then((states) => {
    config.log?.("tsTwoslash: got data", { states });
    view.dispatch({
      effects: setTwoSlashes.of(states.filter((x) => x !== null)),
    });
  });
}

/**
 * By separating the state updates into this StateField, we're able
 * to safely asynchronously update the decorations.
 */
const twoslashField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(_widgets, tr) {
    let widgets = _widgets.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setTwoSlashes)) {
        const decorations = e.value.map((set) => {
          return Decoration.widget({
            widget: new TwoslashWidget(set.text),
            side: 1,
          }).range(set.from);
        });
        widgets = Decoration.set(decorations);
      }
    }
    return widgets;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * The widget itself is just a span with the definition inside.
 */
class TwoslashWidget extends WidgetType {
  constructor(readonly typesignature: string) {
    super();
  }

  eq(other: TwoslashWidget) {
    return other.typesignature === this.typesignature;
  }

  toDOM() {
    const wrap = document.createElement("span");
    wrap.setAttribute("aria-hidden", "true");
    wrap.className = "cm-twoslash";
    wrap.innerText = this.typesignature;
    return wrap;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * Essentially an update listener but it also runs on startup.
 */
const twoslashPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      const config = view.state.facet(tsFacet);
      // Because we asynchronously fetch definitions, this
      // does not directly hold or update decorations. Instead,
      // it triggers asynchronous updates in the twoslashField.
      twoslashes(view, config);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.transactions.some((tr) => tr.annotation(tsSyncAnnotation))
      ) {
        const config = update.state.facet(tsFacet);
        twoslashes(update.view, config);
      }
    }
  },
);


/**
 * The main twoslash plugin entry point: this bundles twoslashField
 * and the twoslashPlugin. This could be a non-function, but we expose
 * it as a function for consistency with the other methods.
 */
export const tsTwoslash = () => [twoslashField, twoslashPlugin];

