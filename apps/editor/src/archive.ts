import type { Project } from '@pivo-craft/core';
import { runWorker, prepareWorker } from './suite-worker';
import workerURL from './archive.worker?worker&url';
if (!import.meta.env.DEV) void prepareWorker(workerURL).catch(() => {});

async function archive<T>(request: unknown, label?: string): Promise<T> {
  return runWorker<T>(workerURL, request, label);
}
export const saveProjectAsync = (project: Project, label?: string) => archive<Uint8Array>({ operation: 'save', project }, label);
export const openProjectAsync = (bytes: Uint8Array, name: string) => archive<Project>({ operation: 'open', bytes, name }, 'Opening project');
