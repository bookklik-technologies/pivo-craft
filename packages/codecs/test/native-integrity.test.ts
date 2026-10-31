import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createProject } from '@pivo-craft/core';
import { loadNative, saveNative } from '../src/native.ts';

describe('native archive validation', () => {
  it('rejects invalid saves without changing the source document', () => {
    const project = createProject();
    project.cels[0].frameId = 'missing';
    const before = structuredClone(project);
    expect(() => saveNative(project)).toThrow();
    expect(project).toEqual(before);
  });

  it('rejects duplicate image references rather than overwriting pixels', () => {
    const files = unzipSync(saveNative(createProject()));
    const envelope = JSON.parse(strFromU8(files['pvc.json']));
    envelope.imageRefs.push({ ...envelope.imageRefs[0] });
    files['pvc.json'] = strToU8(JSON.stringify(envelope));
    expect(() => loadNative(zipSync(files))).toThrow(/duplicate/);
  });

  it('rejects dangling model references in otherwise valid ZIPs', () => {
    const files = unzipSync(saveNative(createProject()));
    const envelope = JSON.parse(strFromU8(files['pvc.json']));
    envelope.project.cels[0].frameId = 'missing';
    files['pvc.json'] = strToU8(JSON.stringify(envelope));
    expect(() => loadNative(zipSync(files))).toThrow(/frame/i);
  });

  it('rejects malformed tile references with a readable validation error', () => {
    const files = unzipSync(saveNative(createProject()));
    const envelope = JSON.parse(strFromU8(files['pvc.json']));
    envelope.tileSetRefs = [null];
    files['pvc.json'] = strToU8(JSON.stringify(envelope));
    expect(() => loadNative(zipSync(files))).toThrow(/Invalid tileset/);
  });
});
