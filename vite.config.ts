import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const repository = env.GITHUB_REPOSITORY || env.VITE_GITHUB_REPOSITORY || ''
  const repositoryName = repository.split('/').pop()
  const base = env.VITE_BASE_PATH || (mode === 'pages' && repositoryName ? `/${repositoryName}/` : '/')
  const requireAuth = mode !== 'development' || env.VITE_REQUIRE_AUTH_CONFIG === 'true'
  if (requireAuth && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error('缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY，生产登录门禁无法构建。')
  }
  return {
    base,
    plugins: [react()],
    build: {
      outDir: mode === 'desktop' ? 'dist-desktop' : 'dist',
      sourcemap: false,
    },
  }
})
