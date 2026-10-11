import {it,expect} from 'vitest';import {zipSync,unzipSync} from 'fflate';import {createProject} from '../../core/src/index.ts';import {saveNative,loadNative} from '../src/index.ts';
function corrupt(change:(p:any)=>void){const files=unzipSync(saveNative(createProject(1,1))),manifest=JSON.parse(new TextDecoder().decode(files['pvc.json']));change(manifest.project);files['pvc.json']=new TextEncoder().encode(JSON.stringify(manifest));return zipSync(files);}
it('native identifiers cannot introduce HTML attribute syntax',()=>expect(()=>loadNative(corrupt(p=>p.frames[0].id='bad"identifier'))).toThrow(/unsafe identifier/));
it('native palette keys validate every color component before the editor uses them',()=>expect(()=>loadNative(corrupt(p=>p.paletteKeys=[{frameId:p.frames[0].id,colors:[['not-a-number',0,0,255]]}]))).toThrow(/paletteKey/));
it('native dimensions and indices must be integer fields',()=>expect(()=>loadNative(corrupt(p=>p.width=1.5))).toThrow(/range/));
