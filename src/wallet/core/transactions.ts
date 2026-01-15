import { encodeFunctionData, parseAbi } from 'viem'

import type { Call, HexAddress } from '../types'

const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender,uint256 amount)'])
const MAX_ERC20_APPROVAL = (1n << 256n) - 1n

export type ApproveAndCallParams = {
  token: HexAddress
  spender: HexAddress
  amount?: bigint
  call: Call
}

export const buildApproveCall = (
  token: HexAddress,
  spender: HexAddress,
  amount: bigint = MAX_ERC20_APPROVAL,
): Call => ({
  to: token,
  data: encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender, amount],
  }),
  value: 0n,
})

export const buildApproveAndCallBatch = ({ token, spender, amount, call }: ApproveAndCallParams) => [
  buildApproveCall(token, spender, amount),
  call,
]
