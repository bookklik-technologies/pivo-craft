export type EditorTheme='light'|'dark';
export function resolveTheme(saved:unknown,prefersDark:boolean):EditorTheme{return saved==='light'||saved==='dark'?saved:prefersDark?'dark':'light';}
export function oppositeTheme(theme:EditorTheme):EditorTheme{return theme==='dark'?'light':'dark';}
/** Editor-only display colors; never used by project buffers, tools or codecs. */
export const VIEW_COLORS={dark:{background:'#0b1017',checkerA:'#303c4b',checkerB:'#232e3c',grid:'#ffffff18',selectionFill:'#6cacff33',selectionStroke:'#c5e1ff',border:'#607995'},light:{background:'#e8eef5',checkerA:'#c5d0dd',checkerB:'#e1e8f1',grid:'#21395724',selectionFill:'#176cc529',selectionStroke:'#115eaa',border:'#8193a9'}} as const;
