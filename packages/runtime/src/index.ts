import { join } from 'node:path'
import { openDatabase } from 'pod-store'
import { browserMediaRoutes, browserRoutes } from './api/browser.ts'
import { evolutionRoutes } from './api/evolution.ts'
import { fileRoute } from './api/files.ts'
import { pageRoutes, pageViewRoutes } from './api/pages.ts'
import { botIconRoute } from './api/icons.ts'
import { baseRoutes, workRoutes } from './api/routes.ts'
import { toFetchRoutes, type RouteSpec } from './api/router.ts'
import { sidebarRoutes } from './api/sidebar.ts'
import { eventStreamRoute } from './api/stream.ts'
import { avatarRoute, v2Routes } from './api/v2.ts'
import { aibotRoutes } from './api/aibot.ts'
import { checkCompat } from './core/compat.ts'
import { every } from './core/timers.ts'
import { resolveConfig } from './config.ts'
import type { HostContext } from './dsh.ts'
import { PodRuntime } from './pod.ts'

/**
 * DeepSeek Pod 的宿主插件。
 * 打开 Pod 的数据库，建好各个服务，作为 `pod` 服务提供出去（agent 预设靠它取人设），
 * 并在 /api/pod 下注册页面用的接口和实时事件流。
 */
export const name = 'pod-runtime'

export const inject = ['connection', 'sessionController', 'workspaceRegistry', 'agents']

const HOUR = 3_600_000

export function apply(ctx: HostContext, rawConfig: unknown): void {
  const config = resolveConfig(rawConfig)
  const db = openDatabase(join(config.dataRoot, 'pod.db'))
  ctx.effect(() => () => db.close(), 'pod: database')

  const compat = checkCompat(ctx)
  if (compat.readOnly) ctx.logger.warn(`DeepSeek Pod 进入只读模式，缺少接口：${compat.problems.join('、')}`)

  const pod = new PodRuntime({ ctx, db, dataRoot: config.dataRoot, workspaceRoot: config.workspaceRoot, dshHome: config.dshHome, compat })
  ctx.effect(() => ctx.provide('pod', pod), 'pod: service')
  if (!compat.readOnly) ctx.effect(() => pod.start(), 'pod: runtime')

  const gate = { readOnly: () => pod.readOnlyReason }
  const routes: readonly RouteSpec[] = [...baseRoutes(pod), ...workRoutes(pod), ...browserRoutes(pod), ...evolutionRoutes(pod), ...v2Routes(pod), ...sidebarRoutes(pod), ...pageRoutes(pod), ...aibotRoutes(pod)]
  for (const route of toFetchRoutes(routes, ctx.logger, gate)) {
    ctx.effect(() => ctx.connection.fetch.register(route), `pod: route ${route.path}`)
  }
  ctx.effect(() => ctx.connection.fetch.register(eventStreamRoute(pod.bus)), 'pod: event stream')
  for (const route of [...browserMediaRoutes(pod), fileRoute(pod), ...pageViewRoutes(pod), avatarRoute(pod), botIconRoute()]) {
    ctx.effect(() => ctx.connection.fetch.register(route), `pod: route ${route.path}`)
  }

  const warn = (error: unknown): void => ctx.logger.warn('Pod 每日维护出错', error)
  every(ctx, 'pod: daily maintenance', HOUR, () => pod.maintenance.tick(pod.now()).then(() => undefined), warn)
  // 启动后稍等再做第一次检查，避开 dsh 启动时的忙碌期。
  ctx.effect(() => {
    const timer = setTimeout(() => void pod.maintenance.tick(pod.now()).catch(warn), 60_000)
    timer.unref()
    return () => clearTimeout(timer)
  }, 'pod: first maintenance')

  ctx.logger.info(`DeepSeek Pod 已启动：数据在 ${config.dataRoot}，工作区在 ${config.workspaceRoot}`)
}
