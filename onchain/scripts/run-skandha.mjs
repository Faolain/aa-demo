#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cwd = path.resolve(__dirname, '..')

const configPath =
  process.env.SKANDHA_CONFIG ?? path.resolve(cwd, 'bundler', 'skandha.local.json')
const runtimeConfigPath = path.resolve(cwd, 'bundler', 'skandha.local.runtime.json')
const image = process.env.SKANDHA_IMAGE ?? 'etherspot/skandha:latest'
const hostPort = process.env.SKANDHA_PORT ?? '14337'
const containerPort = process.env.SKANDHA_CONTAINER_PORT ?? '14337'
const enableLogging = process.env.SKANDHA_LOG_REQUESTS === '1'

if (!existsSync(configPath)) {
  console.error(`[bundler] Missing Skandha config: ${configPath}`)
  console.error('[bundler] Run `pnpm bundler:skandha:config` first.')
  process.exit(1)
}

let configToMount = configPath
try {
  const raw = readFileSync(configPath, 'utf-8')
  const config = JSON.parse(raw)
  const rpcEndpoint = String(config?.rpcEndpoint ?? '')
  if (rpcEndpoint.includes('127.0.0.1') || rpcEndpoint.includes('localhost')) {
    const override = process.env.SKANDHA_RPC_URL ?? 'http://host.docker.internal:8545'
    const nextConfig = { ...config, rpcEndpoint: override }
    writeFileSync(runtimeConfigPath, JSON.stringify(nextConfig, null, 2))
    configToMount = runtimeConfigPath
  }
} catch (error) {
  console.warn('[bundler] Failed to inspect Skandha config, using it as-is', error)
}

const args = [
  'run',
  '--rm',
  '-p',
  `${hostPort}:${containerPort}`,
  '-v',
  `${configToMount}:/usr/app/config.json`,
  image,
  'standalone',
  '--unsafeMode',
]

if (process.platform === 'linux') {
  args.push('--add-host=host.docker.internal:host-gateway')
}

if (enableLogging) {
  args.push('--api.enableRequestLogging')
}

const child = spawn('docker', args, { stdio: 'inherit' })
child.on('exit', (code) => {
  process.exit(code ?? 1)
})
