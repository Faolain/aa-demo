import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChainConfig, HexAddress, HexData } from '../types'
import {
  ERC7579_ACCOUNT_ABI,
  SOCIAL_RECOVERY_MODULE_ADDRESS,
  encodeGuardianSignatures,
  encodeValidatorNonce,
} from '../recovery'
import { SafeWalletController } from './SafeWalletController'
import { decodeFunctionData, encodePacked, toHex } from 'viem'

const createPublicClientMock = vi.hoisted(() => vi.fn())
const getWalletStateMock = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const updateWalletStateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
  }
})

vi.mock('../storage', () => ({
  getWalletState: getWalletStateMock,
  setChainOverrides: vi.fn(),
  updateWalletState: updateWalletStateMock,
}))

vi.mock('../rpc', () => ({
  RpcClient: class {
    private readonly urls: string[]
    constructor(options: { urls: string[] }) {
      this.urls = options.urls
    }
    async selectEndpoint() {
      return this.urls[0]
    }
    getEndpointUrls() {
      return [...this.urls]
    }
  },
}))

const makeChain = (): ChainConfig => ({
  chainId: 1,
  name: 'Test',
  rpcUrls: ['http://rpc.local'],
  bundlerUrls: ['http://bundler.local'],
  entryPoint: '0x0000000000000000000000000000000000000001' as HexAddress,
  safeSingleton: '0x0000000000000000000000000000000000000002' as HexAddress,
  safeProxyFactory: '0x0000000000000000000000000000000000000003' as HexAddress,
  safe4337Module: '0x0000000000000000000000000000000000000004' as HexAddress,
  safe4337FallbackHandler: '0x0000000000000000000000000000000000000005' as HexAddress,
  safe4337SetupHelper: '0x0000000000000000000000000000000000000006' as HexAddress,
  safe7579Adapter: '0x0000000000000000000000000000000000000007' as HexAddress,
  moduleAllowlist: [
    {
      address: SOCIAL_RECOVERY_MODULE_ADDRESS,
      moduleType: 'validator',
      name: 'Rhinestone Social Recovery',
    },
  ],
})

const makePublicClient = () => ({
  readContract: vi.fn(),
  getBytecode: vi.fn().mockResolvedValue('0x1234'),
})

describe('SafeWalletController recovery flows', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('builds installModule call when recovery module is not installed', async () => {
    const publicClient = makePublicClient()
    publicClient.readContract.mockResolvedValue(false)
    createPublicClientMock.mockReturnValue(publicClient)

    const controller = new SafeWalletController({
      chain: makeChain(),
      provider: {},
      signer: {},
      safeAddress: '0x000000000000000000000000000000000000cafe' as HexAddress,
    })

    const sendCallsMock = vi
      .spyOn(controller, 'sendCalls')
      .mockResolvedValue({ chainId: 1, userOpHash: '0xdead' as HexData })

    const guardians = [
      '0x0000000000000000000000000000000000001001',
      '0x0000000000000000000000000000000000001002',
      '0x0000000000000000000000000000000000001003',
    ] as HexAddress[]

    await controller.setupRecovery({
      guardians,
      threshold: 2,
      allowUnsafeModule: true,
    })

    expect(sendCallsMock).toHaveBeenCalledTimes(1)
    const calls = sendCallsMock.mock.calls[0]?.[0] ?? []
    expect(calls).toHaveLength(1)

    const decoded = decodeFunctionData({
      abi: ERC7579_ACCOUNT_ABI,
      data: calls[0].data as HexData,
    })

    expect(decoded.functionName).toBe('installModule')
    expect(decoded.args?.[1]).toBe(SOCIAL_RECOVERY_MODULE_ADDRESS)
  })

  it('submits guardian-signed recovery userOp with validator nonce', async () => {
    const publicClient = makePublicClient()
    publicClient.readContract.mockResolvedValue(true)
    createPublicClientMock.mockReturnValue(publicClient)

    const controller = new SafeWalletController({
      chain: makeChain(),
      provider: {},
      signer: {},
      safeAddress: '0x000000000000000000000000000000000000babe' as HexAddress,
    })

    controller.setPaymasterMode('native')

    const bundlerClient = {
      sendUserOperation: vi.fn().mockResolvedValue('0xuserop' as HexData),
      getEndpointUrls: () => ['http://bundler.local'],
      selectEndpoint: async () => ({ url: 'http://bundler.local', entryPoints: [] }),
      markEndpointHealthy: vi.fn(),
      markEndpointFailure: vi.fn(),
    }

    const controllerAny = controller as unknown as {
      bundlerClient: typeof bundlerClient
      buildOwnerRotationCalls: (params: { owners: HexAddress[]; threshold: number }) => Promise<unknown>
      initSafe4337Pack: (bundlerUrl: string) => Promise<unknown>
    }

    controllerAny.bundlerClient = bundlerClient
    vi.spyOn(controllerAny, 'buildOwnerRotationCalls').mockResolvedValue([
      {
        to: '0x000000000000000000000000000000000000babe' as HexAddress,
        data: '0x' as HexData,
        value: 0n,
      },
    ])

    const baseUserOp = {
      sender: '0x000000000000000000000000000000000000babe',
      nonce: '0',
      callData: '0x',
      callGasLimit: 1n,
      verificationGasLimit: 1n,
      preVerificationGas: 1n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      signature: '0x',
    }

    vi.spyOn(controllerAny, 'initSafe4337Pack').mockResolvedValue({
      createTransaction: vi.fn().mockResolvedValue({
        options: { validAfter: 0, validUntil: 0 },
        getUserOperation: () => ({ ...baseUserOp }),
      }),
    })

    const guardianSignatures = [
      '0x' + '11'.repeat(65),
      '0x' + '22'.repeat(65),
    ] as HexData[]

    await controller.recover({
      newOwners: ['0x000000000000000000000000000000000000d00d'] as HexAddress[],
      newThreshold: 1,
      guardianSignatures,
      guardianThreshold: 2,
      allowUnsafeModule: true,
    })

    expect(bundlerClient.sendUserOperation).toHaveBeenCalledTimes(1)
    const [submittedUserOp] = bundlerClient.sendUserOperation.mock.calls[0]
    const expectedNonce = toHex(encodeValidatorNonce(SOCIAL_RECOVERY_MODULE_ADDRESS))
    const expectedSignature = encodePacked(
      ['uint48', 'uint48', 'bytes'],
      [0, 0, encodeGuardianSignatures(guardianSignatures, 2)],
    )

    expect(submittedUserOp.nonce).toBe(expectedNonce)
    expect(submittedUserOp.signature).toBe(expectedSignature)
  })
})
