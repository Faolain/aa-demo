const pimlico = (chainId: number) => `https://public.pimlico.io/v2/${chainId}/rpc`
const candide = (chainId: number) => `https://api.candide.dev/public/v3/${chainId}`

export const DEFAULT_BUNDLER_URLS_BY_CHAIN_ID: Record<number, string[]> = {
  1: [candide(1), pimlico(1)],
  8453: [candide(8453), pimlico(8453)],
  11155111: [pimlico(11155111)],
  84532: [pimlico(84532)],
}

export const getDefaultBundlerUrls = (chainId: number): string[] =>
  DEFAULT_BUNDLER_URLS_BY_CHAIN_ID[chainId] ?? []
