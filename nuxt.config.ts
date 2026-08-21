import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-12',
  ssr: false,
  devtools: { enabled: true },
  css: ['~/assets/style.css'],

  app: {
    head: {
      title: 'Claude Code Worktrees',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      script: [
        {
          innerHTML:
            "try{var t=localStorage.getItem('ccwt.theme');document.documentElement.classList.toggle('dark',t===null||t==='dark')}catch(e){document.documentElement.classList.add('dark')}",
          tagPosition: 'head',
        },
      ],
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  nitro: {
    experimental: { websocket: true },
  },

  devServer: {
    host: '127.0.0.1',
    port: 5600,
  },

  runtimeConfig: {
    token: '',
  },

  typescript: {
    strict: true,
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: true,
      },
    },
  },
})
