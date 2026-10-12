import logo from '../../../logo.svg?url';
import {action,menu,resize,tabKeys,installDisclosureMenus,installDockToggle} from './suite';

export function installSuiteCraft(env:{run:(name:string)=>void;recovery:()=>void;system:()=>void}):void {
  const q=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
  const header=q('.topbar');header.classList.add('suite-header');
  const brand=q('.brand');brand.className='brand suite-brand';brand.replaceChildren();
  const image=document.createElement('img');image.src=logo;image.alt='';brand.append(image,'PiVo Craft');
  q('.badge').hidden=true;q('.filename').hidden=true;q('.topbar .spacer').remove();
  const take=(id:string,label?:string)=>{const b=q<HTMLButtonElement>(`[data-action="${id}"]`);if(label){b.textContent=label;b.setAttribute('aria-label',label);b.removeAttribute('title');}return b;};
  const nav=document.createElement('nav');nav.className='suite-menus';nav.setAttribute('aria-label','Application menus');
  const undo=action('Undo',()=>env.run('undo')),redo=action('Redo',()=>env.run('redo'));undo.dataset.suiteCommand='undo';redo.dataset.suiteCommand='redo';
  nav.append(menu('File',[take('new','New project…'),take('open','Open project…'),action('Save project',()=>env.run('save')),action('Export…',()=>env.run('export')),action('Recovery…',env.recovery)]),
    menu('Edit',[undo,redo,action('Rename layer…',()=>q('.layer.selected .name')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})))]),
    menu('View',[take('layout','Workspace layout…'),action('Toggle panels',()=>q<HTMLButtonElement>('.suite-dock-toggle').click()),action('Fit artwork',()=>env.run('fit')),action('Left panels',()=>{q('.right-dock').classList.remove('suite-dock-open');q('.left-dock').classList.toggle('suite-dock-open');}),action('System appearance',env.system)]),
    menu('Help',[take('shortcuts','Keyboard shortcuts…'),take('help','About PiVo Craft')]) );
  brand.after(nav);
  const actions=document.createElement('div');actions.className='suite-header-actions';
  for(const id of ['undo','redo','save','export']){const b=take(id);if(id==='save'||id==='export'){b.classList.add('suite-file-action');const label=b.querySelector('.button-label');label?.classList.add('suite-action-label');}actions.append(b);}actions.append(q('#theme-toggle'));header.append(actions);
  const strip=document.createElement('div');strip.className='suite-document-strip';
  const tabs=q('#document-tabs');tabs.before(strip);strip.append(tabs);
  const state=q('#save-state');state.className='suite-save-state';state.setAttribute('role','status');strip.append(state);
  const toggle=action('Panels',()=>{});toggle.className='suite-dock-toggle';toggle.setAttribute('aria-controls','suite-craft-dock');toggle.setAttribute('aria-expanded','false');strip.append(toggle);
  const options=q('.options');options.classList.add('suite-context-toolbar');q('.tools').classList.add('suite-tool-rail');
  const brushDetails=document.createElement('details');brushDetails.className='suite-menu craft-brush-options';brushDetails.innerHTML='<summary>Brush options</summary><div class="suite-menu-popup"></div>';const brushPopup=brushDetails.lastElementChild!;
  for(const id of ['brush-opacity','ink','filled','pixelperfect','symmetry','wrap','grid'])brushPopup.append(q('#'+id).closest('label')!);options.insertBefore(brushDetails,q('[data-action=fit]'));
  const frameDetails=document.createElement('details');frameDetails.className='suite-menu';frameDetails.innerHTML='<summary>Frame options</summary><div class="suite-menu-popup"></div>';const framePopup=frameDetails.lastElementChild!;
  for(const id of ['frame-empty','frame-remove','link','unlink','tag'])framePopup.append(q('[data-action='+id+']'));for(const id of ['onion','show-preview','tags'])framePopup.append(q('#'+id).closest('label')??q('#'+id));framePopup.append(q('#duration').closest('label')!);q('.timelinebar').append(frameDetails);
  const viewDetails=document.createElement('details');viewDetails.className='suite-menu';viewDetails.innerHTML='<summary>View options</summary><div class="suite-menu-popup"></div>';
  const zoomRow=document.createElement('div');zoomRow.className='craft-zoom-row';zoomRow.append(q('#zoom').closest('label')!,q('#zoom-label'));
  viewDetails.lastElementChild!.append(q('[data-action=fit]'),zoomRow);options.append(viewDetails);
  installDisclosureMenus();

  const dock=q('.right-dock');dock.id='suite-craft-dock';dock.classList.add('suite-dock');installDockToggle(toggle,dock);
  const panelTabs=document.createElement('div');panelTabs.className='suite-tablist craft-panel-tabs';panelTabs.setAttribute('role','tablist');panelTabs.setAttribute('aria-label','Context panels');
  const handle=document.createElement('div');handle.className='suite-resize';handle.setAttribute('aria-label','Resize layers panel');
  let active='palette';const ids=['palette','advanced','transform','tilemap'];const names=['Color / Palette','Tool properties','Selection','Tilemap'];
  const buttons=ids.map((id,i)=>{const b=action(names[i],()=>{active=id;update();});b.setAttribute('role','tab');b.id='craft-tab-'+id;b.setAttribute('aria-controls','craft-panel-'+id);panelTabs.append(b);return b;});tabKeys(panelTabs);
  function update(){
    const standard=dock.dataset.suiteDefault==='true';dock.classList.toggle('craft-suite-default',standard);panelTabs.hidden=!standard;handle.hidden=!standard;
    const layers=q('[data-panel=layers]');if(standard){layers.after(handle);handle.after(panelTabs);}
    for(const [i,id] of ids.entries()){const panel=q('[data-panel='+id+']');panel.id='craft-panel-'+id;panel.hidden=standard&&active!==id;panel.setAttribute('role',standard?'tabpanel':'region');panel.setAttribute('aria-labelledby','craft-tab-'+id);buttons[i].setAttribute('aria-selected',String(active===id));buttons[i].tabIndex=active===id?0:-1;}
  }
  dock.append(handle,panelTabs);resize(handle,dock,'--pivo-hierarchy-height',160,100,400,'pivo-craft-hierarchy-v1');
  document.addEventListener('pivo-craft:layout',update);update();
  const rename=action('Rename layer…',()=>q('.layer.selected .name')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));q('[data-panel=layers] .mini-actions').append(rename);
  for(const paragraph of document.querySelectorAll<HTMLElement>('.section p.hint')){const details=document.createElement('details');details.className='suite-instructions';const summary=document.createElement('summary');summary.textContent='Usage help';paragraph.before(details);details.append(summary,paragraph);}
}
