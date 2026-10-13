import {it,expect} from 'vitest';
import {createProject,History} from '../src/index';
import {projectBytes} from '../src/util';

it('discarding redo releases its accounted snapshots',()=>{
 const history=new History(createProject(2,2));
 history.execute('A',p=>{p.name='A';});history.execute('B',p=>{p.name='B';});
 history.undo();history.execute('C',p=>{p.name='C';});
 expect(history.canRedo).toBe(false);
 const retained=history.retainedBytes;
 history.execute('D',p=>{p.name='D';});expect(history.retainedBytes-retained).toBe(projectBytes(history.project)*2);
});
it('a rejected memory-budget edit rolls back without adding history',()=>{
 const project=createProject(2,2),history=new History(project,1024,p=>{if(p.name.length>10)throw Error('budget');});
 const originalName=project.name;
 expect(()=>history.execute('Oversize',p=>{p.name='x'.repeat(100);})).toThrow('budget');
 expect(history.project.name).toBe(originalName);expect(history.canUndo).toBe(false);
});
