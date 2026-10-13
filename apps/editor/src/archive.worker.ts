import { saveNative, loadNative } from '../../../packages/codecs/src/native';
import { decodeASE } from '../../../packages/codecs/src/ase';
import { decodePNG } from '../../../packages/codecs/src/png';
import { importGIF } from '../../../packages/codecs/src/gif-decode';
import { createProject } from '@pivo-craft/core';

self.onmessage = event => {
  try {
    const { operation, project, bytes, name } = event.data;
    let value;
    if (operation === 'save') value = saveNative(project);
    else if (/\.pvc$/i.test(name)) value = loadNative(bytes);
    else if (/\.ase(prite)?$/i.test(name)) value = decodeASE(bytes);
    else if (/\.gif$/i.test(name)) value = importGIF(bytes, name.replace(/\.gif$/i, ''));
    else {
      const image = decodePNG(bytes);
      value = createProject(image.width, image.height, name);
      value.images[value.cels[0].imageId].data = image.pixels;
      value.diagnostics = image.diagnostics;
    }
    self.postMessage({ ok: true, value });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
