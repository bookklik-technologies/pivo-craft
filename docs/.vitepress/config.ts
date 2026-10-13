import { defineConfig } from 'vitepress'

const base = process.env.DOCS_BASE || '/'
const appUrl = 'https://bookklik-technologies.github.io/pivo-craft/'
const docsUrl = appUrl + 'docs/'
const socialImage = docsUrl + 'screenshots/app.png'

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'PiVo Craft',
  titleTemplate: ':title | PiVo Craft Documentation',
  description:
    'A local-first browser pixel-art and animation editor. No account, no upload, no cloud.',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }]],
  sitemap: {
    hostname: docsUrl,
    transformItems: (items) => items.filter((item) => item.url !== '404.html'),
  },
  transformHead({ page }) {
    if (page === '404.md') return [['meta', { name: 'robots', content: 'noindex, follow' }]]
  },
  transformPageData(pageData) {
    pageData.frontmatter.head ??= []
    if (pageData.relativePath === '404.md') return
    const canonical = docsUrl + pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '.html')
    const title = pageData.frontmatter.layout === 'home' || pageData.title === 'PiVo Craft' || !pageData.title
      ? 'PiVo Craft Documentation'
      : pageData.title + ' | PiVo Craft Documentation'
    const description = pageData.description
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'PiVo Craft' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:locale', content: 'en_US' }],
      ['meta', { property: 'og:image', content: socialImage }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '1440' }],
      ['meta', { property: 'og:image:height', content: '1000' }],
      ['meta', { property: 'og:image:alt', content: 'PiVo Craft editor showing a pixel-art rocket and animation frames' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: socialImage }],
      ['meta', { name: 'twitter:image:alt', content: 'PiVo Craft editor showing a pixel-art rocket and animation frames' }],
    )
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Open app', link: appUrl, target: '_blank', rel: 'noopener' },
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
