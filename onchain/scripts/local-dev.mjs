#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const cwd = path.resolve(__dirname, '..')

const rpcUrl = process.env.LOCAL_RPC_URL ?? 'http://127.0.0.1:8545'
const rpcPayload = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'eth_chainId',
  params: [],
})

let nodeProc = null

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
      }
    })
  })

const isRpcReady = async () => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1000)
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rpcPayload,
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

const waitForRpc = async (maxAttempts = 30) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isRpcReady()) {
      return true
    }
    await delay(1000)
  }
  return false
}

const startNode = () => {
  nodeProc = spawn('pnpm', ['exec', 'hardhat', 'node'], {
    cwd,
    stdio: 'inherit',
  })
  nodeProc.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[local-dev] Hardhat node exited with code ${code}`)
    }
  })
}

const shutdown = () => {
  if (nodeProc && !nodeProc.killed) {
    nodeProc.kill('SIGINT')
  }
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

const main = async () => {
  const alreadyRunning = await isRpcReady()
  if (alreadyRunning) {
    console.log(`[local-dev] RPC already running at ${rpcUrl}`)
  } else {
    console.log('[local-dev] Starting Hardhat node...')
    startNode()
    const ready = await waitForRpc()
    if (!ready) {
      shutdown()
      throw new Error(`RPC did not become ready at ${rpcUrl}`)
    }
  }

  await run('pnpm', ['run', 'deploy:local'])
  await run('pnpm', ['run', 'emit:local'])

  console.log('[local-dev] Local chain ready.')

  if (nodeProc) {
    console.log('[local-dev] Hardhat node is running. Press Ctrl+C to stop.')
    await new Promise((resolve, reject) => {
      nodeProc.on('exit', (code) => {
        if (code && code !== 0) {
          reject(new Error(`Hardhat node exited with code ${code}`))
        } else {
          resolve()
        }
      })
    })
  }
}

main().catch((error) => {
  console.error(error)
  shutdown()
  process.exit(1)
})
