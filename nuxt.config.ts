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
    public: {
      version: '0.1.0',
    },
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
