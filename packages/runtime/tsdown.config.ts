import { defineConfig } from 'tsdown'

// 宿主插件运行在 dsh 进程里：输出 ESM，把 pod-domain、pod-store 和 aibot-x-post（发推用，没有依赖）打进来，
// 不打包任何 dsh 包，dsh 的能力一律通过 ctx 上的服务拿。
export default defineConfig({
  // search-worker 是搜索索引的 worker 线程入口，convert-worker 是上传文件转文字版的 worker，都由 index 按相对路径启动。
  entry: { index: 'src/index.ts', agent: 'src/agent.ts', 'search-worker': 'src/search/worker.ts', 'convert-worker': 'src/convert/worker.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'lib',
  clean: true,
  dts: false,
  fixedExtension: false,
  deps: {
    alwaysBundle: ['pod-domain', 'pod-store', 'aibot-x-post'],
  },
})
