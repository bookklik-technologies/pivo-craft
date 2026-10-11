import {defineConfig} from 'vite';
export default defineConfig({root:'apps/editor',base:'./',resolve:{alias:{'@pivo-craft/core':new URL('./packages/core/src/index.ts',import.meta.url).pathname}},build:{outDir:'../../dist',emptyOutDir:true},server:{host:'0.0.0.0'}});
