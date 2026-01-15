#!/usr/bin/env node
import { spawn } from 'node:child_process'

const children = new Set()
let started = false
let shuttingDown = false

const spawnCommand = (label, command, args) => {
  const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] })
  children.add(child)

  const prefix = `[${label}]`
  const pipe = (stream, target, onChunk) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      const text = chunk.toString()
      if (onChunk) onChunk(text)
      buffer += text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        target.write(line.length ? `${prefix} ${line}\n` : '\n')
      }
    })
    stream.on('end', () => {
      if (buffer) {
        target.write(`${prefix} ${buffer}\n`)
      }
    })
  }

  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)

  child.on('exit', (code) => {
    children.delete(child)
    if (!shuttingDown && code && code !== 0) {
      console.error(`${prefix} exited with code ${code}`)
      shutdown(code)
    }
  })

  return child
}

const shutdown = (code = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    child.kill('SIGINT')
  }
  setTimeout(() => {
    for (const child of children) {
      child.kill('SIGKILL')
    }
    process.exit(code)
  }, 2000)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const startBundlerAndApp = () => {
  if (started) return
  started = true
  const useSkandha = process.env.AA_DEMO_BUNDLER === 'skandha'
  const bundlerScript = useSkandha ? 'local:bundler:skandha' : 'local:bundler'
  spawnCommand('bundler', 'pnpm', [bundlerScript])
  spawnCommand('app', 'pnpm', ['dev'])
}

const chain = spawn('pnpm', ['local:chain'], { stdio: ['inherit', 'pipe', 'pipe'] })
children.add(chain)

const readySignals = ['Local chain ready.']
const handleChainOutput = (text) => {
  if (started) return
  if (readySignals.some((signal) => text.includes(signal))) {
    startBundlerAndApp()
  }
}

let chainBuffer = ''
const pipeChain = (stream, target) => {
  stream.on('data', (chunk) => {
    const text = chunk.toString()
    handleChainOutput(text)
    chainBuffer += text
    const lines = chainBuffer.split(/\r?\n/)
    chainBuffer = lines.pop() ?? ''
    for (const line of lines) {
      target.write(line.length ? `[chain] ${line}\n` : '\n')
    }
  })
  stream.on('end', () => {
    if (chainBuffer) {
      target.write(`[chain] ${chainBuffer}\n`)
    }
  })
}

pipeChain(chain.stdout, process.stdout)
pipeChain(chain.stderr, process.stderr)

chain.on('exit', (code) => {
  children.delete(chain)
  if (!started && !shuttingDown) {
    console.error('[chain] exited before startup completed')
    shutdown(code ?? 1)
  } else if (!shuttingDown && code && code !== 0) {
    console.error(`[chain] exited with code ${code}`)
    shutdown(code)
  }
})
