import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-US',
  title: 'PiVo Craft',
  description:
    'A local-first browser pixel-art and animation editor. No account, no upload, no cloud.',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Tutorials', link: '/tutorials/' },
      { text: 'Guide', link: '/guide' },
      { text: 'Formats', link: '/formats' },
      { text: 'API', link: '/api' },
      {
        text: 'Verification',
        items: [
          { text: 'Overview', link: '/verification' },
          { text: 'Feature status', link: '/feature-status' },
          { text: 'Algorithm contracts', link: '/algorithm-contracts' },
          { text: 'Compatibility matrix', link: '/compatibility-matrix' },
        ],
      },
      { text: 'Limitations', link: '/limitations' },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Installation & running', link: '/getting-started' },
          { text: 'User guide', link: '/guide' },
        ],
      },
      {
        text: 'Tutorials',
        items: [
          { text: 'Overview', link: '/tutorials/' },
          { text: '1. Draw your first pixel face', link: '/tutorials/first-sprite' },
          { text: '2. Make the face blink', link: '/tutorials/blink' },
          { text: '3. Save and export your artwork', link: '/tutorials/save-export' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'File formats', link: '/formats' },
          { text: 'Headless API', link: '/api' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Verification', link: '/verification' },
          { text: 'Limitations', link: '/limitations' },
          { text: 'Feature status', link: '/feature-status' },
          { text: 'Algorithm contracts', link: '/algorithm-contracts' },
          { text: 'Compatibility matrix', link: '/compatibility-matrix' },
          { text: 'Workspace internals', link: '/workspace-guide' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'PiVo Craft is released under the MIT License.',
      copyright: 'Copyright © 2026 Bookklik Technologies',
    },
  },
})
