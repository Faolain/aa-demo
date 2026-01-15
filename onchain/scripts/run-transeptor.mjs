#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cwd = path.resolve(__dirname, '..')

const envFile =
  process.env.TRANSEPTOR_ENV ?? path.resolve(cwd, 'bundler', 'transeptor.local.env')
const image = process.env.TRANSEPTOR_IMAGE ?? 'transeptorlabs/bundler:latest'
const hostPort = process.env.TRANSEPTOR_PORT ?? '14337'
const containerPort = process.env.TRANSEPTOR_CONTAINER_PORT ?? '4337'
const rpcUrl = process.env.LOCAL_RPC_URL ?? 'http://host.docker.internal:8545'
const deploymentsPath = path.resolve(cwd, 'deployments', 'local.json')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

let entryPointOverride = null
if (existsSync(deploymentsPath)) {
  try {
    const raw = readFileSync(deploymentsPath, 'utf-8')
    const deployments = JSON.parse(raw)
    const entryPoint = deployments?.contracts?.entryPoint
    if (entryPoint && entryPoint !== ZERO_ADDRESS) {
      entryPointOverride = entryPoint
    }
  } catch (error) {
    console.warn('[bundler] Failed to read deployments/local.json', error)
  }
}

if (!existsSync(envFile)) {
  console.error(`[bundler] Missing env file: ${envFile}`)
  console.error('[bundler] Expected at onchain/bundler/transeptor.local.env')
  process.exit(1)
}

const args = [
  'run',
  '--rm',
  '-p',
  `${hostPort}:${containerPort}`,
  '--env-file',
  envFile,
]

if (entryPointOverride) {
  args.push('-e', `TRANSEPTOR_ENTRYPOINT_ADDRESS=${entryPointOverride}`)
}

if (process.platform === 'linux') {
  args.push('--add-host=host.docker.internal:host-gateway')
}

args.push(
  image,
  '--unsafe',
  '--network',
  rpcUrl,
  '--port',
  containerPort,
  '--httpApi',
  'web3,eth,debug',
  '--auto',
)

const child = spawn('docker', args, { stdio: 'inherit' })
child.on('exit', (code) => {
  process.exit(code ?? 1)
})
