import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, ShieldCheck, X } from 'lucide-react'

import type { HexAddress } from '../types'

type RecoverySetupPanelProps = {
  guardians: HexAddress[]
  threshold: number
  moduleAddress?: HexAddress
  allowCustomModule?: boolean
  onGuardiansChange?: (guardians: HexAddress[]) => void
  onThresholdChange?: (threshold: number) => void
  onModuleAddressChange?: (address: HexAddress) => void
  onAllowCustomModuleChange?: (enabled: boolean) => void
  error?: string
}

const glassyBase =
  'backdrop panel-surface relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-0'
const glassyMuted = 'panel-surface--muted'
const glassyNeutral = 'panel-surface--neutral'
const glassyActive = 'panel-surface--active'

export function RecoverySetupPanel({
  guardians,
  threshold,
  moduleAddress,
  allowCustomModule,
  onGuardiansChange,
  onThresholdChange,
  onModuleAddressChange,
  onAllowCustomModuleChange,
  error,
}: RecoverySetupPanelProps) {
  const [draftGuardian, setDraftGuardian] = useState('')

  const guardianOptions = useMemo(() => {
    if (guardians.length === 0) return [1]
    return Array.from({ length: guardians.length }, (_, index) => index + 1)
  }, [guardians.length])

  const handleAddGuardian = () => {
    const trimmed = draftGuardian.trim()
    if (!trimmed) return
    onGuardiansChange?.([...guardians, trimmed as HexAddress])
    setDraftGuardian('')
  }

  const handleRemoveGuardian = (address: HexAddress) => {
    onGuardiansChange?.(guardians.filter((guardian) => guardian !== address))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-emerald-300" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-100">Recovery Guardians</h3>
          <p className="text-sm text-gray-400">
            Add 2–3 guardians you trust to help you recover your wallet if you lose access.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Guardians</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={draftGuardian}
            onChange={(event) => setDraftGuardian(event.target.value)}
            placeholder="0x guardian address"
            className="flex-1 px-3 py-2 bg-gray-900/70 border border-white/10 rounded-xl text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
          />
          <button
            type="button"
            onClick={handleAddGuardian}
            className={`px-4 py-2 text-sm font-medium rounded-xl ${glassyBase} ${glassyActive} flex items-center gap-2`}
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {guardians.length === 0 && (
            <span className="text-xs text-gray-500">No guardians added yet.</span>
          )}
          {guardians.map((guardian) => (
            <span
              key={guardian}
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${glassyBase} ${glassyMuted}`}
            >
              <span className="font-mono text-gray-200">{guardian}</span>
              <button
                type="button"
                onClick={() => handleRemoveGuardian(guardian)}
                className="text-gray-400 hover:text-gray-200"
                aria-label="Remove guardian"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Threshold</label>
        <div className="flex items-center gap-3">
          <select
            value={threshold}
            onChange={(event) => onThresholdChange?.(Number(event.target.value))}
            className={`px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10 ${glassyBase} ${glassyNeutral}`}
          >
            {guardianOptions.map((value) => (
              <option key={value} value={value} className="text-gray-900">
                {value} guardian{value === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">
            Recommended: {Math.min(Math.max(guardians.length, 2), 3)} of {guardians.length || 3}
          </p>
        </div>
      </div>

      <div className={`p-4 rounded-2xl border border-amber-500/30 ${glassyBase} ${glassyNeutral}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5" />
          <div className="text-xs text-amber-100/80">
            Guardians can rotate owners and thresholds but should never be able to spend funds.
            Only pick people you trust with access to your wallet configuration.
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-xs uppercase tracking-[0.2em] text-gray-500">
          Advanced Module Install
        </label>
        <button
          type="button"
          onClick={() => onAllowCustomModuleChange?.(!allowCustomModule)}
          className={`px-3 py-2 rounded-xl text-sm font-medium ${glassyBase} ${
            allowCustomModule ? glassyActive : glassyNeutral
          }`}
        >
          {allowCustomModule ? 'Custom modules enabled' : 'Enable custom module'}
        </button>
        {allowCustomModule && (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={moduleAddress ?? ''}
              onChange={(event) => onModuleAddressChange?.(event.target.value as HexAddress)}
              placeholder="Custom module address (validator)"
              className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
            />
            <p className="text-xs text-amber-200/80">
              Custom modules bypass allowlist checks. Only use audited modules.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

