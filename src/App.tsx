import { WalletPanel } from './wallet'

const auditHighlights = [
  {
    title: 'Passkey-native Safe ownership',
    detail: 'WebAuthn credentials map to Safe owners with RP ID scoping and on-device attestation.',
  },
  {
    title: 'Account abstraction flow',
    detail: 'Safe4337 pack, bundler routing, and userOp lifecycle tracked end-to-end.',
  },
  {
    title: 'Injected + WalletConnect fallback',
    detail: 'Portable signers can backstop passkeys and recover access across devices.',
  },
  {
    title: 'Cross-origin isolation headers',
    detail: 'COOP/COEP headers are enabled for secure passkey + storage surfaces.',
  },
  {
    title: 'Upgradeable recovery module',
    detail: 'Social recovery module wiring and guardian threshold management included.',
  },
]

const auditTargets = [
  'Bundler failover + fee estimation (Pimlico aware)',
  'Counterfactual Safe address derivation',
  'Passkey metadata persistence + encrypted exports',
  'Injected wallet signature validation',
  'Paymaster routing + sponsorship status',
]

export default function App() {
  return (
    <div className="relative">
      <div className="aa-backdrop" aria-hidden="true" />
      <div className="aa-noise" aria-hidden="true" />
      <main className="aa-shell">
        <header className="aa-header">
          <div className="relative">
            <div className="aa-orbit" aria-hidden="true" />
            <h1 className="aa-title">AA Demo Wallet</h1>
          </div>
          <p className="aa-subtitle">
            This Vite + React sandbox reproduces the full passkey + Safe account abstraction,  isolated for experimentation. Run it locally, inspect
            the wallet state, and validate every signer path.
          </p>
          <div className="aa-pill-row">
            <span className="aa-pill">Passkeys</span>
            <span className="aa-pill">Bundlers</span>
            <span className="aa-pill">Injected wallets</span>
            <span className="aa-pill">WalletConnect</span>
            <span className="aa-pill">Recovery module</span>
          </div>
        </header>

        <section className="aa-grid">
          <div className="flex flex-col gap-6">
            <div className="aa-card">
              <div className="aa-section-title">Highlights</div>
              <div className="aa-list">
                {auditHighlights.map((item) => (
                  <div key={item.title} className="aa-list-item">
                    <strong className="text-white/90">{item.title}</strong>
                    <span className="text-white/60 text-sm">{item.detail}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="aa-card">
              <div className="aa-section-title">What to probe</div>
              <ul className="mt-4 space-y-3 text-white/70 text-sm">
                {auditTargets.map((target) => (
                  <li key={target} className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-300/80 shadow-[0_0_12px_rgba(251,191,36,0.65)]" />
                    <span>{target}</span>
                  </li>
                ))}
              </ul>
              <p className="aa-footnote">
                Tip: run this demo with your own bundler + paymaster endpoints to validate
                every transaction path in isolation.
              </p>
            </div>
          </div>

          <div className="aa-wallet-frame">
            <WalletPanel />
          </div>
        </section>
      </main>
    </div>
  )
}
