import type { ChainConfig } from '../types'

export const localChainConfig = {
  chainId: 31337,
  name: 'Local Hardhat',
  rpcUrls: ['http://127.0.0.1:8545'],
  bundlerUrls: ['http://127.0.0.1:14337/rpc'],
  entryPoint: '0xE7C678e2af3215aBBA0dbF4B5F9b621A23bf0917',
  safeSingleton: '0x2f71B36e94d8CB676A64add750Ada095A1Fc200B',
  safeProxyFactory: '0xA246bBe321787435589dcaabc72C96d06F0e1792',
  multiSend: '0x35a26D3f77E50d22F3A76219598FfCD75B9FaA5F',
  multiSendCallOnly: '0x63A2Db3cec45585Ff03eB672c99cbbFC18C5ea5B',
  safe4337Module: '0xd83056ebab0Db8CdA471B4FD5Ffe96d773319F93',
  safe4337FallbackHandler: '0xd83056ebab0Db8CdA471B4FD5Ffe96d773319F93',
  safe4337SetupHelper: '0x7dE4cCFa51FD6F786007A9B3cB633f48DA527072',
  safe7579Adapter: '0x9a9B56c3920A5f4Cf3D71C707b59cc901c7f35c3',
  safeWebAuthnSignerFactory: '0xF8e1B96BA3A6a8B49B46B2d918FB3Fa437c77a72',
  safeWebAuthnSharedSigner: '0x555B317ac6189fcaC267C1576275eDBAE12C085c',
  passkeyVerifier: '0xC19e72bF79eA5FC6d9D90D09bBA257C5BF9ca77d',
  circlePaymaster: '0xaa75a5b739f67651E5a924154daD23410914788f',
  circlePaymasterToken: '0x1BA2DC10b14bEc463B21ca0d63040Cda78a65729',
  sponsorPaymaster: '0x800aaA5dF8b9c1fd6F8A8aBBe69A8728d1e9820B',
} satisfies ChainConfig
