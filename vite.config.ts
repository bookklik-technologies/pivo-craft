import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {readFileSync} from 'node:fs';
const standalone = process.env.PIVO_STANDALONE === '1';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {version: string; description: string};
export default defineConfig({root:'apps/editor',base:'./',resolve:{alias:{'@pivo-craft/core':new URL('./packages/core/src/index.ts',import.meta.url).pathname}},build:{assetsInlineLimit:standalone?100000000:4096,outDir:'../../dist',emptyOutDir:true},server:{host:'0.0.0.0'},define:{__STANDALONE__:JSON.stringify(standalone),__APP_VERSION__:JSON.stringify(pkg.version),__APP_DESCRIPTION__:JSON.stringify(pkg.description)},plugins:standalone?[]:[VitePWA({
  registerType:'prompt',
  injectRegister:false,
  manifestFilename:'manifest.webmanifest',
  manifest:{
    name:'PiVo Craft',
    short_name:'PiVo Craft',
    description:pkg.description,
    id:'./',
    start_url:'./',
    scope:'./',
    display:'standalone',
    orientation:'any',
    theme_color:'#111720',
    background_color:'#111720',
    icons:[
      {src:'pwa-192x192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'pwa-512x512.png',sizes:'512x512',type:'image/png',purpose:'any'},
      {src:'maskable-icon-512x512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}
    ]
  },
  workbox:{
    globPatterns:['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
    maximumFileSizeToCacheInBytes:10*1024*1024,
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/\/docs(?:\/|$)/, /\/(?:pivo-(?:craft|ortho|plate)-standalone|standalone)\.html$/]
  }
})]});
