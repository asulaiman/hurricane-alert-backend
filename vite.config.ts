import { defineConfig, loadEnv } from 'vite'
import { apiDevServerPlugin } from './api/_lib/devServer'

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [apiDevServerPlugin()],
    server: { host: '127.0.0.1' },
  }
})
