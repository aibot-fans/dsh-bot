import { defineConfig } from 'tsdown'

/** 浏览器模块的身份必须等于包名，dsh 按它加载 ./client。 */
const MODULE_ID = 'pod-ui'

// dsh 的浏览器插件是一段注册到 window.__ModuleLoader__ 的惰性 CommonJS 工厂；
// react 等共享模块由 dsh web 外壳提供，通过工厂参数里的 require 拿到。
const LOADER_BANNER = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(MODULE_ID)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
].join('\n')

const LOADER_FOOTER = ['\t\treturn module.exports;', '\t}', '});'].join('\n')

export default defineConfig([
  {
    // 宿主半边：一个什么都不做的插件，让 Loader 能挂上这一行。
    entry: { index: 'src/host.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node24',
    outDir: 'lib',
    clean: false,
    dts: false,
    fixedExtension: false,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outDir: 'lib',
    clean: false,
    dts: false,
    // dsh 按 exports 里的 ./client 找 lib/client.js，后缀必须是 .js。
    outExtensions: () => ({ js: '.js' }),
    deps: {
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom'],
      alwaysBundle: ['pod-domain'],
    },
    outputOptions: {
      banner: LOADER_BANNER,
      footer: LOADER_FOOTER,
    },
  },
])
