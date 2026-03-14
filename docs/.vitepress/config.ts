import { defineConfig } from 'vitepress'

export default defineConfig({
  title:       'leak-assert',
  description: 'Memory leak regression testing — write assertions, not profiler reports',
  base:        '/leak-assert/',

  head: [
    ['meta', { name: 'theme-color', content: '#38bdf8' }],
    ['link', { rel: 'icon', href: '/favicon.svg' }],
  ],

  themeConfig: {
    logo:    '/logo.svg',
    siteTitle: 'leak-assert',

    nav: [
      { text: 'Guide',     link: '/guide/getting-started' },
      { text: 'API',       link: '/guide/api' },
      { text: 'GitHub',    link: 'https://github.com/leak-assert/leak-assert' },
      { text: 'npm',       link: 'https://www.npmjs.com/package/leak-assert' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is leak-assert?', link: '/guide/what-is-leak-assert' },
          { text: 'Getting Started',      link: '/guide/getting-started' },
        ],
      },
      {
        text: 'SDKs',
        items: [
          { text: 'Node / TypeScript', link: '/guide/node' },
          { text: 'Python',            link: '/guide/python' },
          { text: 'Go',                link: '/guide/go' },
        ],
      },
      {
        text: 'Integrations',
        items: [
          { text: 'CLI',               link: '/guide/cli' },
          { text: 'HTTP Sidecar',      link: '/guide/sidecar' },
          { text: 'Jest / Vitest',     link: '/guide/jest' },
          { text: 'pytest',            link: '/guide/pytest' },
          { text: 'OpenTelemetry',     link: '/guide/otel' },
          { text: 'Docker',            link: '/guide/docker' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/leak-assert/leak-assert' },
    ],

    footer: {
      message:   'Released under the MIT License.',
      copyright: 'Copyright © 2025 leak-assert contributors',
    },
  },
})
