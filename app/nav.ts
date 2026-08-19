import { Activity, FolderGit2, Settings, SwatchBook } from 'lucide-vue-next'
import type { Component } from 'vue'

export interface NavPage {
  name: string
  path: string
  title: string
  blurb: string
  nav: 'page' | 'pinned' | 'hidden'
  icon: Component
}

export const NAV: NavPage[] = [
  {
    name: 'overview',
    path: '/overview',
    title: 'Overview',
    blurb: 'Every worktree, every port, every service — across all the projects at once.',
    nav: 'page',
    icon: Activity,
  },
  {
    name: 'index',
    path: '/',
    title: 'Projects',
    blurb: 'Every repository ccwt knows how to build a worktree for.',
    nav: 'page',
    icon: FolderGit2,
  },
  {
    name: 'settings',
    path: '/settings',
    title: 'Settings',
    blurb: 'The accounts, hosts and tools ccwt talks to on your behalf.',
    nav: 'pinned',
    icon: Settings,
  },
  {
    name: 'preview',
    path: '/preview',
    title: 'Console preview',
    blurb: 'Every primitive in every state, so the shell cannot drift unseen.',
    nav: 'hidden',
    icon: SwatchBook,
  },
]

export const DETAIL_PAGES: Record<string, { title: string; blurb: string }> = {
  'project-id': {
    title: 'Worktrees',
    blurb: 'What exists, what is running, and which ports it holds.',
  },
}
