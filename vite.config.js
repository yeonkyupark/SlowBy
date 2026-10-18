import { defineConfig } from 'vite'

// 배포마다 다른 값. 앱은 이 값과 배포된 version.json 을 비교해 옛 코드로 동기화하지 않는다(src/version.js).
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) || Date.now().toString(36)

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(command === 'build' ? BUILD_ID : 'dev'),
  },
  plugins: [
    {
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: BUILD_ID }) })
      },
    },
  ],
  build: {
    target: 'es2020',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
  },
}))
