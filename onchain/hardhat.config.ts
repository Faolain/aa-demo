import '@nomicfoundation/hardhat-ethers'
import type { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      type: 'edr-simulated',
      chainId: 31337,
    },
    localhost: {
      type: 'http',
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
}

export default config
