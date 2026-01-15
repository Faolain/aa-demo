import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'

const DEFAULT_RPC_URL = 'http://127.0.0.1:8545'
const HARDHAT_MNEMONIC =
  process.env.LOCAL_MNEMONIC ??
  'test test test test test test test test test test test junk'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')

const getArg = (flag) => {
  const index = process.argv.indexOf(flag)
  if (index === -1 || index + 1 >= process.argv.length) return undefined
  return process.argv[index + 1]
}

const main = async () => {
  const to = getArg('--to')
  if (!to) {
    throw new Error('Missing --to address')
  }

  const ethAmount = getArg('--eth') ?? '0.1'
  const usdcAmount = getArg('--usdc') ?? '1.0'

  const rawDeployments = await readFile(DEPLOYMENTS_PATH, 'utf-8')
  const deployments = JSON.parse(rawDeployments)
  const rpcUrl = deployments.rpcUrl ?? DEFAULT_RPC_URL
  const tokenAddress = deployments.contracts?.circlePaymasterToken

  if (!tokenAddress) {
    throw new Error('Missing circlePaymasterToken in deployments/local.json')
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const baseSigner = ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider)
  const signer = new ethers.NonceManager(baseSigner)

  const ethTx = await signer.sendTransaction({
    to,
    value: ethers.parseEther(ethAmount),
  })
  await ethTx.wait()

  const token = new ethers.Contract(tokenAddress, ['function mint(address,uint256)'], signer)
  const mintTx = await token.mint(to, ethers.parseUnits(usdcAmount, 6))
  await mintTx.wait()

  console.log(`Funded ${to} with ${ethAmount} ETH and ${usdcAmount} USDC`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
