# AA Wallet Demo (Demo auth + wallet setup)

### tl;dr
This is a  Vite + React + TypeScript app that reproduces the Account Abstraction wallet/auth flow:

- Passkey-based Safe owners (WebAuthn)
- Account abstraction (Safe4337 + bundler routing)
- Injected wallet support (MetaMask/Rabby/etc) - Used in the demo but portable key can be with email via zkEmail, Lit Protocol, TaCo can be done. 
- WalletConnect fallback
- Social recovery module wiring
- Cross-origin isolation headers (COOP/COEP) for passkey + storage safety

**ACHTUNG | WARNING!!!** THIS CODEBASE IS VIBECODED AI SLOP SDK. THIS IS NOT PRODUCTION CODE. DO NOT USE THIS IN YOUR CODE. THIS IS JUST AN ILLUSTRATION OF WHAT YOU CAN DO (that said I welcome PRs)

Demo(using Metamask as a portable signer to load the wallet on another origin):

https://github.com/user-attachments/assets/1a97d70f-d599-480c-9c1a-708c5eca5cfd



## There is an idea of Account Abstraction...some kind of Abstraction
If you're like me, you've heard of **Account Abstraction(AA)** over the years and may have gotten the impression from X threads/Conference Talks that AA *finally solves* the normie user UX onboarding issue while keeping all the "good parts" of Web3 (e.g. **sovereign**, **decentralized**, **permissionless** etc etc).

Yet it's 2026, the year of our Lord, and **onboarding** for most **crypto** dApps(*do we still use the word dApp?*) remains **completely atrocious**. To this day, I have to juggle janky extensions which often break due to Browser updates and the wonderful user experience of random failed transactions (resulting from extension failures, not even submitting to the network). Since I, despite being a technical user, have a difficult time onboarding/navigating dApps, I cringe at the idea of trying to explain to a normal person what they have to do to buy the future of France.

One alternative I've seen dApp developers go for is to offer users a convenient wrapper which gives the impression of "AA", like **Privy**, because terms like "non-custodial" are tossed around and no one really understands what these words mean, but people assume they mean oh it's like Metamask but easier to use because "muh email login". I don't want to pick on Privy because they are amazing and have been instrumental in onboarding normal users into Web3, and the company I work at uses it (via my direction!) so I want to be very clear why I'm writing this. 

Crypto/Web3 promised its ideological adherents that through technology we could deliver *everyone* freedom from tyranny or coercion while making it so easy that anyone can be empowered. After working in this industry for 10 years I think crypto has fallen short of this. This is not meant to be an anti-crypto rant (there are enough of these) but I just wanted to highlight why we are here.  The whole raison d'etre of this industry was built was the cypherpunk ethos, to be resilient in the face of attack, whether nationstate or other. It is about Freedom. 

**Now let's get back to wallets.**

Given the above, let's define some goals. A wallet should have the following characteristics (if it's to be actually Web3 and not a larp while also being UX friendly):

- **Non-custodial** ("Not your keys not your coins")
    - A wallet is considered **custodial** if a third party can move funds without the user’s consent
- **Portable** [^1]:
    - I should be able to export my wallet to use elsewhere
    - Escape hatch shouldn't be gated by App Developer or Wallet 
- **No vendor coupling**
    - I shouldn't have to rely on any company's infrastructure to use the wallet
    - If the infrastructure my wallet depends on goes down I can point it to other infrastructure easily
    - Optionally run your own infra (rpc/bundler/paymaster, as App Developer or USER - Yes I know this is for normies but users should have the OPTION)
- **Availability**
    - Related to no vendor coupling: Transactions should be be able to blocked by a third party and the user should have the option, always available txs.
- **No need for Seed Phrases**
    - Passkey or Email Support
- **Recovery Support**
    - In the case of access loss (passkey/email lost) a backup method to regain access to the wallet (can be anything)
- **Embedded**
    - No need to install an external application or extension to be able to use it. It should *just work* from the webpage you're on.
- **Gas Abstraction**
    - Wallet should support paying in tokens like ERC-20s or even have fees covered by dApps (Gas Sponsorship), removing the need to hold native ETH for transactions. (Paymasters)

Honorable Mention
- **Pricing Methods/Price to Maintain???**
    - Dawg let's be serious most dApps don't make money but you want to price these at monthly active users?

This is not to mention privacy. I as a developer want my users to know they can use private rpcs if they wish, and I as a developer do not need to dox or provide a credit card (many nations do not have access to card payment systems) in order to launch a dApp. This is regressing not progressing. 

Given all of this I think it would make sense to create a table to compare the existing options:

| - | [Privy](https://www.privy.io/) | [Openfort](https://www.openfort.io/) | [Alchemy](https://www.alchemy.com/bundler) | [ZeroDev](https://zerodev.app/) | [Etherspot](https://etherspot.io/) | [Biconomy](https://www.biconomy.io/) | [Pimlico](https://www.pimlico.io/) - [permissionless](https://github.com/pimlicolabs/permissionless.js) | [Thirdweb](https://thirdweb.com/account-abstraction) | [Candide (AbstractionKit)](https://docs.candide.dev/wallet/abstractionkit/introduction/) ([Benchmark](https://aa-sdk-benchmark.on-fleek.app/)) | [Safe Relay Kit](https://docs.safe.global/sdk/relay-kit)
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
| Non-custodial | 🟢[^2] | 🟢[^8] | 🟢[^11] | 🟢[^16] | 🟢[^40] | 🟢[^40] | 🟢[^40] | 🟢[^34] | 🟢[^77] | 🟢[^87]
| Portable[^1] | ⚠️[^3] | ⚠️[^8] | ⚠️[^12] | ⚠️[^16] | ⚠️[^38] | ⚠️[^25] | ⚠️[^38] | ⚠️[^33][^34] | ⚠️[^78] | ⚠️[^88]
| No vendor coupling | 🟢[^41] | ⚠️[^42] | ⚠️[^13] | 🟢[^43] | 🟢[^47] | 🟢[^44] | 🟢[^45] | ⚠️[^46] | 🟢[^79] | 🟢[^89]
| External infra plug-and-play (1-5)[^48] | 4[^41] | 2[^42] | 3[^13] | 4[^43] | 5[^47] | 4[^44] | 5[^45] | 2[^46] | 5[^79] | 5[^89]
| SDK category[^67] | Wallet SDK | Wallet SDK | Infra-first SDK | Wallet SDK | Infra-first SDK | Infra-first SDK | Infra-first SDK | Wallet SDK | Wallet SDK | Infra-first SDK
| Passkey support[^68] | 🟢[^69] | 🟢[^70] | 🟢[^71] | 🟢[^72] | ⚠️[^73] | 🟢[^74] | ⚠️[^75] | 🟢[^76] | ⚠️[^78] | 🟢[^90]
| ERC-7579 modules | ⚠️[^49] | ⚠️[^50] | 🔴[^51] | 🟢[^52] | 🟢[^53] | 🟢[^54] | ⚠️[^55] | 🟢[^56] | 🟢[^81] | 🔴[^91]
| EntryPoint v0.8[^65] | ⚠️[^57] | ⚠️[^58] | 🔴[^59] | ⚠️[^60] | 🟢[^61] | 🔴[^62] | ⚠️[^63] | 🔴[^64] | ⚠️[^80] | 🔴[^92]
| Availability | 🔴[^2][^3] | ⚠️[^8][^9] | ⚠️[^11][^13] | ⚠️[^16] | 🟢[^21][^22] | 🟢[^25][^26] | 🟢[^29][^30] | 🔴[^34] | 🟢[^82] | 🟢[^89]
| Availability score (1-5)[^66] | 2[^2][^3] | 3[^8][^9] | 3[^11][^13] | 3[^16] | 5[^21][^22] | 4[^25][^26] | 4[^29][^30] | 2[^34] | 4[^82] | 4[^89]
| Recovery Support | ⚠️[^5] | ⚠️[^10] | ⚠️[^11] | ⚠️[^16] | ⚠️[^23] | ⚠️[^25] | ⚠️[^38] | ⚠️[^33][^34] | ⚠️[^83] | ⚠️[^94]
| Gas Abstraction | ⚠️[^7] | 🟢[^8] | 🟢[^14] | 🟢[^16] | 🟢[^21] | 🟢[^24] | 🟢[^28] | 🟢[^32] | 🟢[^79] | 🟢[^95]
| AA Native | ⚠️[^7] | 🟢[^8] | 🟢[^13] | 🟢[^16] | 🟢[^20][^22] | 🟢[^25] | 🟢[^29] | 🟢[^32] | 🟢[^79] | 🟢[^95]
| GitHub stars[^97] | N/A | 11[^98] | 295[^99] | 52[^100] | 131[^101] | 86[^102] | 239[^103] | 614[^104] | 31[^105] | 306[^106]
| Pricing | Free (0-499 MAU + 50k sig) -> $299 -> $499 + usage[^6] | Free (1k MAU) -> $99 -> $249 -> $599 + usage[^8] | Included in Alchemy plan + 8% gas admin fee[^14] | $0 -> $69 -> $399 + usage/credits[^18] | $0 (testnet) -> $49 -> $99 -> $299 + usage/credits[^20] | Pricing TBD; 5% gas surcharge[^24] | Free -> PAYG mainnet + credits + 10% paymaster surcharge[^28] | $5 -> $99 -> $499 -> $1,499+ /mo + MAU + gas fees[^32] | Free public endpoints (rate-limited) -> Dashboard for higher limits[^84] | Free (open-source SDK)[^96]
| Open Source | 🔴 | 🟢[^9] | ⚠️[^15] | 🟢[^19] | 🟢[^21][^22] | 🟢[^27] | 🟢[^31] | ⚠️[^35] | 🟢[^85] | 🟢[^96]
| Bring your own key[^37] | 🟢[^4] | 🟢[^8] | 🟢[^39] | 🟢[^16] | 🟢[^38] | 🟢[^25] | 🟢[^29] | ⚠️[^34] | 🟢[^79] | 🟢[^87]
| Crypto Payments[^36] | 🔴 | 🔴 | 🔴 | 🔴 | 🟢[^36] | 🔴 | 🔴 | 🔴 | 🔴 | N/A

> I know in some cases here it may look like I'm conflating wallet SDKs and infra providers but that's only because infra providers also provide wallet SDKs which happen(are supposed?) to make using Account Abstraction easier/interfaces to use.

> Also I know Github Stars aren't the best heuristic for popularity but it provides a good enough proxy for how likely it is for a library to come up in a search and be used by someone. See the GitHub stars row for a snapshot at the time of writing 14-1-2026.[^97]


> **External infra plug-and-play score legend** (used for the "No vendor coupling" row):[^48]
> - 5: swap bundler/paymaster/RPC via a simple config change, no vendor-specific RPC required
> - 4: easy swaps, but defaults or optional features bias toward vendor infra
> - 3: partial swaps or non-standard methods for key features
> - 2: heavy reliance on vendor infra or API keys
> - 1: tightly coupled with no clear override path

>**Availability score legend** (used for the "Availability" row):[^66]
> - 5: no vendor infra required for signing or submission; self-hostable or permissionless infra; easy fallback to public endpoints
> - 4: vendor infra not required, but defaults/tooling push you to vendor endpoints; still easy to swap
> - 3: partial independence; some components can be swapped but key paths require vendor services or API keys
> - 2: strong dependency on vendor services for signing or submission; limited fallback
> - 1: vendor-gated signing or submission with no viable external fallback

> **Portability in this repo/SDK** (what "portable" actually means here):
> - This demo exports/imports **wallet metadata**, not private keys. The backup file includes passkey metadata, owner config, recovery config, chain state, and deployment config so another client can recreate the same smart account state.
> - **Passkeys are still RP-bound** and cannot be exported; exporting metadata alone does not make the wallet usable on another origin.
> - **Portability comes from adding a portable signer** (injected wallet / WalletConnect / hardware) as an owner. That signer can control the Safe from another origin and re-register passkeys there.
> - This is the default flow this repo's SDK enables out of the box: a self-custodial AA wallet with exportable metadata and a portable signer escape hatch, rather than a hosted embedded-wallet model.

> **SDK categories for this comparison (not mutually exclusive):**
> - **Wallet SDKs (embedded or managed auth + AA lifecycle)**: Privy, Openfort, ZeroDev, Thirdweb, Candide. These provide end-to-end wallet UX (auth, keying, and account setup) in addition to AA.
> - **Infra-first SDKs (AA plumbing you wire to your own signer/auth)**: Etherspot, Biconomy, Pimlico, Alchemy, Relay Kit. These focus on bundlers/paymasters/accounts and assume you bring the signer/auth layer.
> - **This repo**: Wallet SDK (self-custodial) with passkey setup, recovery module wiring, metadata export/import, and a portable-signer escape hatch by default.

Of all of these, the 31 star (!??!?!) Candide AbstractionKit comes closest to hitting all the checks with some notable differences as summarized here by AI.

Candide AbstractionKit vs this repo (Safe-based) — migration gaps highlighted by the source review:[^86]
| - | Candide AbstractionKit (Safe-based) | This repo (Safe-based) |
| --- | --- | --- |
| EntryPoint target | Safe account classes are v0.7 (v0.8 only for Simple7702 + userop tooling). | Configured for v0.8 by default (EntryPoint address per chain). |
| Passkey creation | Formats WebAuthn signatures, but passkey credential creation + rpId handling are app-managed. | Passkey credential creation + rpId handling included. |
| Paymaster integration | Defaults to Candide paymaster; no Circle USDC adapter. | Circle USDC paymaster + sponsor paymaster configs included. |
| Bundler resilience | Single bundler endpoint in SDK; no built-in rotation/health checks. | Multiple default endpoints + health checks/failover in bundler client. |
| Recovery | Social recovery via legacy Safe module (not ERC-7579). | ERC-7579 module install for Rhinestone social recovery. |
| Storage/UX | Low-level SDK; app wiring + storage/export UI are DIY. | Built-in storage schema + encrypted export/import + UI panels. |

So this 31 star repo comes closest to hitting most of the checkmarks (Honorable mention of Etherspot too)? Companies I've never even heard of and you likely haven't either given the follower/star counts? Only one provider on this list which even accepts crypto payments? What the fuck is this industry even doing man. Hats off to both Etherspot and Candide who seem to be the only companies doing something "real" in this respective space (and of course h/t Gnosis Safe but they aren't the infra provider I'm focusing on). P.S. Pimlico add Crypto payments and update your SDK to support the newest features and you'll be a top contender here.

By the way, this is not even to get into the 10%(!!!) fee for using Circle's Paymaster, the others in the list are no better if you look into them. They mostly range from 8-15%. So much for "mUH VISA FEES". I thought we were supposed to be banking the unbanked and getting rid of unecessary intermedaries. 

Account Abstraction is great and has solved a very real problem, but the fact there isn't a reference implementation that's easy which has all the bells and whistles explains one facet of why adoption has been abysmal (and speaks to a much bigger problem...what is the focus? What is everyone doing instead?)

What was supposed to be a simple exercise in implementing the latest feature in Ethereum, one that was supposed to make onboarding easier, made me realize why no one actually showed up. The last mile to actually bring users on wasn't paved and instead VC funded corpos created walled garden SDKs with ridiculous fees while larping as crypto infra.

As with aything in crypto you overturn one stone and realize the whole thing is rotten. Anyway someone make this vibe coded slop better (with your own slop) so devs actually have useful library to integrate.

## My ASK
- Infra providers add crypto payments
- Wallet SDKs that add tight coupling to your SDKs remove them
- Etherspot/Candide/Pimlico update your SDKs to support the latest AA features/modules and make it stupidly easy for people to use them (everyone will end up using your infra as a result)
- Anyone reading this run paymasters/bundlers and undercut the insane extortion that's going on
- Do something other than complain 
- PRs welcome I guess. 

## Addendum / Outtakes
- I didn't mention porto.sh because last I saw (and I could be wrong) their sdk relies on their bundler alone which is a no-no on the vendor coupling side. No I'm not going to run my own infra (for now)
- Privy was sold for $1.1 Billion for what Ethereum now offers out of the box if you plug some things together *just right*
- Some of the vendor specific SDK AA wallets have dead telegrams/discords where no one from the team is even available, lolz. 

Some have open sourced their Bundler, Paymaster since this article was written https://medium.com/coinmonks/top-6-account-abstraction-providers-an-in-depth-review-3a09b9fc707c 

dApps Should have (Facilitated by Supporting Wallet Mechanics)
- Guarantee user‑controlled export
- Make export discoverable and safe
      - Put “Export / Backup” in settings, require explicit user confirmation, and provide UX warnings about consequences. (Design choice; no vendor‑specific constraint.)
- Persist migration metadata
      - Store the wallet address, chain config, and (for smart accounts) the initialization config and modules so another client can recreate or take over control.
- Provide a “break‑glass” recovery path

<details>
<summary>
An aside about passkeys:
</summary>

- Passkeys are RP‑bound (origin‑scoped). Exporting the app state doesn’t let you use the passkey on another domain/device unless that passkey is available there too.
- If the export includes a portable signer (EOA / external wallet key), then it’s portable because you can import that key and sign anywhere.
- If the export only includes passkey metadata (rawId + pubkey coords), it’s not portable. You still can’t sign without the actual passkey in the OS keychain for that origin.

**Note** a passkey created wallet is only portable if you have added a non‑passkey signer or you can add a new passkey for the new origin using an existing signer.

Passkeys are RP‑bound because WebAuthn deliberately scopes each credential to a specific Relying Party ID (RP ID). The authenticator will only sign if the current origin’s RP ID matches the.one the credential was created for. That’s a core security property of passkeys (anti‑phishing / origin‑binding), not a property of the App itself. The private key never leaves the authenticator, and the RP ID hash is baked into the signature flow, so the same passkey can’t be used from another unrelated origin even if you “export” app state.

  For portability when a **portable signer** exists:

  - The Safe’s **owner set** includes that portable key (EOA, hardware wallet, etc.).
  - You can **import that key into another wallet/app** (or connect a hardware wallet), and then use any client that can sign Safe ops/UserOps.
  - In the AA demo flow, you’d connect the portable signer, then:
      1. load the Safe address (counterfactual or deployed),
      2. sign UserOps with that owner,
      3. optionally add a **new passkey for the new origin** so you regain passkey UX there.

  Key point: **exporting app state ≠ portability** unless the export includes a signer that can actually produce signatures on another device/origin. Passkey metadata alone can’t do that.
</details>


[^1]: Short answer: exportable does not automatically mean portable. "Portable" means you can use the same wallet to sign from another device/origin without being locked to the original environment (passkeys are RP-bound).
[^2]: Privy documents key sharding and secure enclaves for embedded wallets and frames them as self-custodial user wallets with owner-controlled quorums. Because signing requires Privy infrastructure, liveness depends on Privy being available and willing to process the request (inference). https://docs.privy.io/security/wallet-infrastructure/architecture, https://docs.privy.io/security/wallet-infrastructure/secure-enclaves, https://docs.privy.io/controls/authorization-keys/owners/configuration/user
    - If Privy does not process a signing request and you have no alternative signing path, the transaction cannot be signed (liveness/availability risk, not custody).
    - This impacts apps that need guaranteed availability (consumer apps, DeFi, DAO tooling, payments, high-risk jurisdictions).
[^3]: Privy export: only web environments can export client-created wallets; apps can require a 2-of-2 quorum with an app auth key; export yields the signer private key (not the smart account). https://docs.privy.io/wallets/wallets/export
[^4]: Privy supports importing an existing private key (BYO key). https://docs.privy.io/wallets/wallets/import-a-wallet/private-key
[^5]: Privy recovery supports automatic or user-managed recovery (password or cloud backup) via recovery shares. https://docs.privy.io/security/wallet-infrastructure/advanced/user-device
[^6]: Privy pricing tiers and MAU/signature limits. https://www.privy.io/pricing
[^7]: Privy smart wallets (ERC-4337) and gas sponsorship are supported in the React SDK; native gas sponsorship requires supported chains and TEE execution. https://docs.privy.io/guide/react/wallets/smart-wallets, https://docs.privy.io/transaction-management/gas-management, https://docs.privy.io/transaction-management/chain-support, https://docs.privy.io/transaction-management/gas-management/setup
[^8]: Openfort pricing lists non-custodial wallets, private key export, wallet connector, BYO auth providers, Global Wallet, backend (custodial) wallets, and gas sponsorship fees (10% Starter/Growth, 5% Pro/Scale). For this comparison we assume the non-custodial embedded/global wallet mode. https://www.openfort.io/pricing
[^9]: Openfort security: OpenSigner is open-source/self-hostable; embedded/global wallets use Shamir 2-of-3; server-side wallets are custodial. https://www.openfort.io/security
[^10]: Openfort recovery methods are configurable via `setRecoveryMethod`. https://www.openfort.io/docs/products/embedded-wallet/javascript/signer/update-recovery
[^11]: Alchemy Signer is non-custodial (Turnkey secure enclaves); only the end user can access keys. https://www.alchemy.com/docs/wallets/signer/what-is-a-signer
[^12]: Alchemy export does not rely on Alchemy infra; `useExportAccount` returns a private key for passkey sessions or a seed phrase for email sessions. https://www.alchemy.com/docs/wallets/signer/export-private-key and https://www.alchemy.com/docs/wallets/reference/account-kit/react/hooks/useExportAccount
[^13]: Account Kit can split node RPC from bundler/paymaster traffic via the `alchemy` transport, but Gas Manager uses a custom `alchemy_requestGasAndPaymasterAndData` RPC method (non-standard), which creates coupling if you rely on it. https://www.alchemy.com/docs/wallets/reference/account-kit/infra/functions/alchemy and https://www.alchemy.com/docs/wallets/reference/account-kit/core
[^14]: Alchemy pricing and Gas Manager fees (8% admin fee on sponsored gas). https://www.alchemy.com/docs/reference/pricing-plans and https://www.alchemy.com/docs/wallets/reference/gas-manager-faqs
[^15]: Alchemy open-source components: aa-sdk (MIT), modular-account (GPL), and rundler (LGPL/GPL). https://github.com/alchemyplatform/aa-sdk, https://github.com/alchemyplatform/modular-account, https://github.com/alchemyplatform/rundler
[^16]: ZeroDev positions itself as embedded smart account infrastructure with passkeys, recovery options, gas sponsorship, and self-custody claims. https://docs-v4.zerodev.app/ and https://zerodev.app/
[^18]: ZeroDev pricing tiers. https://zerodev.app/pricing
[^19]: ZeroDev Kernel and SDK are open-source (MIT). https://github.com/zerodevapp/kernel and https://github.com/zerodevapp/sdk
[^20]: Etherspot pricing tiers and AA infra offering; enterprise supports payments in crypto/fiat. https://etherspot.io/pricing/
[^21]: Arka paymaster is open-source and sponsors user transactions. https://github.com/etherspot/arka
[^22]: Skandha bundler is open-source and self-hostable (Docker or source). https://etherspot.io/skandha/ and https://github.com/etherspot/skandha
[^23]: Etherspot guardians-based recovery (Prime SDK). https://etherspot.fyi/prime-sdk/guardians
[^24]: Biconomy pricing notes a 5% gas surcharge. https://docs.biconomy.io/pricing/
[^25]: Biconomy smart accounts are signer-agnostic and work with any paymaster and bundler; custody, seedless UX, portability, and recovery depend on the signer/module you integrate (inference). https://docs.biconomy.io/smartAccountsV2/overview/
[^26]: Biconomy SDK accepts `bundlerUrl` and paymaster configuration (URL or API key), and migration docs show providing `rpcUrl` when using custom signers; you can also build a bundler client from an API key or explicit bundler URL. https://docs.biconomy.io/smartAccountsV2/paymaster/integration, https://docs.biconomy.io/smartAccountsV2/tutorials/v4Migration, https://docs.biconomy.io/smartAccountsV2/sdk-reference/bundlerclient
[^27]: Biconomy smart account contracts are open-source (MIT). https://github.com/bcnmy/scw-contracts and https://github.com/bcnmy/nexus
[^28]: Pimlico pricing and paymaster surcharges (10% verifying and 10% ERC-20). https://docs.pimlico.io/guides/pricing
[^29]: Pimlico's permissionless examples show `bundlerTransport: http("...")`, so you can point to any bundler URL. https://docs.pimlico.io/references/bundler/public-endpoint
[^30]: Pimlico bundler usage requires an API key for production endpoints; a public endpoint is available without an API key. https://docs.pimlico.io/infra/bundler/usage and https://docs.pimlico.io/references/bundler/public-endpoint
[^31]: permissionless.js is open-source (MIT). https://github.com/pimlicolabs/permissionless.js/
[^32]: Thirdweb pricing tiers and gas sponsorship fees include a 2.5% mainnet gas surcharge. https://thirdweb.com/pricing
[^33]: Thirdweb only supports private key export via the Connect modal (no programmatic export). https://portal.thirdweb.com/wallets/export-private-key
[^34]: Thirdweb in-app wallet security: non-custodial secret sharing and app-scoped wallets; losing auth without export prevents recovery. https://portal.thirdweb.com/wallets/in-app-wallet/security
[^35]: Thirdweb SDKs/contracts are open-source; hosted infra is not. https://github.com/thirdweb-dev and https://github.com/thirdweb-dev/contracts
[^36]: Crypto Payments refers to whether the vendor explicitly accepts crypto for developer billing; Etherspot lists crypto/fiat payments. https://etherspot.io/pricing/
[^37]: Bring your own key means you can use your own signer/EOA/hardware key; embedded wallet providers may still manage embedded keys even if they allow external wallets.
[^38]: Etherspot and Pimlico primarily offer AA infra (bundlers, paymasters, SDKs) rather than embedded key management; custody/seedless UX/portability/recovery depend on the signer you integrate (inference). https://etherspot.io/pricing/ and https://docs.pimlico.io/permissionless
[^39]: Account Kit supports third-party signers; seed phrase requirements depend on the signer. https://www.alchemy.com/docs/wallets/third-party/signers
[^40]: Assuming a headless AA wallet with a BYO signer (the baseline in this repo), Etherspot/Biconomy/Pimlico provide AA infra and do not custody keys; custody depends on the signer you integrate. https://etherspot.io/pricing/ and https://docs.biconomy.io/smartAccountsV2/overview/ and https://docs.pimlico.io/permissionless
[^41]: Privy smart wallet configuration expects paymaster and bundler URLs (and RPC URL for custom chains); supported chains can omit custom URLs, while custom chains require explicit bundler/paymaster/RPC URLs. Embedded key shares live in Privy infrastructure, so signing still depends on Privy services even though infra endpoints are swappable. https://docs.privy.io/guide/react/wallets/smart-wallets/configuration and https://docs.privy.io/security/wallet-infrastructure/secure-enclaves
[^42]: Openfort says it handles the ERC-4337 infrastructure (so you don't manage bundlers/paymasters), but also supports external paymasters via API. https://www.openfort.io/docs/products/kit/react/wallets and https://www.openfort.io/docs/development/gas-sponsorship
[^43]: ZeroDev supports `bundlerUrl` and `rpcProviderUrl` overrides, so you can point to your own bundler and node RPC. https://v3-docs.zerodev.app/use-wallets/advanced/additional-settings
[^44]: Biconomy lets you supply a `bundlerUrl` or use an API key, and configure a paymaster via URL or API key; custom `rpcUrl` is shown in migration examples. https://docs.biconomy.io/smartAccountsV2/paymaster/integration, https://docs.biconomy.io/sdk-reference/bundler-client/, https://legacy-docs.biconomy.io/Account/integration
[^45]: Pimlico permissionless shows `bundlerTransport: http("...")`, and Pimlico's bundler docs note API key requirements for production plus a public endpoint without an API key. https://docs.pimlico.io/references/bundler/public-endpoint and https://docs.pimlico.io/infra/bundler/usage
[^46]: Thirdweb account abstraction requires a Thirdweb API key to use bundler/paymaster infrastructure, and Unity docs note you can override RPC, bundler, and paymaster URLs. https://portal.thirdweb.com/react/v5/account-abstraction/build-your-own-ui and https://portal.thirdweb.com/typescript/v5/account-abstraction/get-started and https://portal.thirdweb.com/changelog/unity-storage-and-more
[^47]: Etherspot's Skandha bundler is open-source and self-hostable (source/Docker/one-liner), and Arka paymaster is open-source with self-host instructions. https://etherspot.io/skandha/ and https://github.com/etherspot/skandha and https://github.com/etherspot/arka
[^48]: Plug-and-play score legend: 5 = swap bundler/paymaster/RPC via a simple config change, no vendor-specific RPC required; 4 = easy swaps, but defaults or optional features bias toward vendor infra; 3 = partial swaps or non-standard methods for key features; 2 = heavy reliance on vendor infra or API keys; 1 = tightly coupled with no clear override path.
[^49]: Privy lets apps choose the underlying ERC-4337 account implementation (Kernel, Safe, LightAccount, Biconomy, Thirdweb, Coinbase); ERC-7579 module support depends on the selected account, and Privy says it will add native ERC-7579 support as the standard matures. https://docs.privy.io/wallets/using-wallets/evm-smart-wallets/overview
[^50]: Openfort documents ERC-4337 smart wallets and modular logic but does not explicitly state ERC-7579 module standard support. https://www.openfort.io/docs/products/kit/react/wallets
[^51]: Alchemy Modular Account uses ERC-6900 plugins (not ERC-7579). For context on the ERC-7579 vs ERC-6900 tradeoffs, see ZeroDev's rationale. https://www.alchemy.com/docs/wallets/smart-contracts/other-accounts/modular-account and https://docs.zerodev.app/blog/why-7579-over-6900
[^52]: ZeroDev Kernel v3 is adopting the ERC-7579 standard and module types. https://github.com/zerodevapp/kernel/releases
[^53]: Etherspot's Modular SDK and Prime accounts are ERC-7579 compliant and support installing modules. https://etherspot.io/blog/etherspot-launches-erc-7579-modular-sdk/
[^54]: Biconomy Nexus and other modular smart accounts are based on ERC-7579 and accept ERC-7579-compliant modules. https://docs.biconomy.io/account-providers/overview/
[^55]: Pimlico's permissionless.js exposes ERC-7579 actions (e.g., supportsModule) and examples use EntryPoint v0.7; module support depends on the account you plug in. https://docs.pimlico.io/permissionless/reference/erc7579-actions/supportsModule and https://docs.pimlico.io/guides/how-to/accounts/use-erc7579-account
[^56]: Thirdweb has beta support for ERC-7579 modular smart accounts. https://portal.thirdweb.com/changelog/beta-support-for-erc-7579-modular-smart-accounts
[^57]: Privy does not specify an EntryPoint version; it depends on the chosen account implementation. https://docs.privy.io/wallets/using-wallets/evm-smart-wallets/overview
[^58]: Openfort does not specify an EntryPoint version in its smart wallet docs (only ERC-4337 compatibility). https://www.openfort.io/docs/products/kit/react/wallets
[^59]: Alchemy's bundler supports EntryPoint v0.6 and v0.7; v0.8 requires contacting Alchemy. https://www.alchemy.com/docs/reference/bundler-faqs
[^60]: ZeroDev Kernel v3 docs highlight ERC-7579 adoption but do not state EntryPoint v0.8 support. https://github.com/zerodevapp/kernel/releases
[^61]: Etherspot's Skandha bundler supports ERC-4337 EntryPoint v0.8.0. https://etherspot.io/blog/etherspots-skandha-bundler-now-supports-erc-4337-entrypoint-v0-8-0/
[^62]: Biconomy's docs list bundler/paymaster support for EntryPoint v6 and v7, with no v0.8 support noted. https://docs-devx.biconomy.io/
[^63]: Pimlico examples show EntryPoint v0.7 in permissionless.js configs; v0.8 is not documented. https://docs.pimlico.io/permissionless/reference/erc7579-actions/supportsModule
[^64]: Thirdweb smart wallet docs state support for EntryPoint v0.6 and v0.7 only. https://portal.thirdweb.com/typescript/v5/smartWallet
[^65]: This repo defaults to EntryPoint v0.8 by setting its address per-chain, but there is no separate rationale documented. v0.8 adds native EIP-7702 authorization handling (UserOp hash includes the delegation address and the EntryPoint validates it), ERC-712 UserOp signing for improved signer compatibility, lower penalties for unused gas when under 40k, and updates to ERC-7562 validation plus fixes (e.g., initCode front-running and paymaster postOp gas accounting). The tradeoff is infra compatibility: many bundlers and paymasters still target v0.7, so v0.8 can be blocked until your infra stack supports it. https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.8.0
[^66]: Availability score rubric: 5 = no vendor infra required for signing or submission; self-hostable or permissionless infra; easy fallback to public endpoints. 4 = vendor infra not required, but defaults/tooling push you to vendor endpoints; still easy to swap. 3 = partial independence; some components can be swapped but key paths require vendor services or API keys. 2 = strong dependency on vendor services for signing or submission; limited fallback. 1 = vendor-gated signing or submission with no viable external fallback.
[^67]: SDK category rubric: Wallet SDK = provides user auth/keying and smart account lifecycle as part of the SDK; Infra-first SDK = focuses on AA plumbing (bundlers/paymasters/accounts) and assumes you bring or integrate your own signer/auth layer. Categories are not mutually exclusive, but this row reflects each product's primary focus.
[^68]: Passkey support rubric: 🟢 = first-class passkey login in the vendor SDK or an official passkey validator/signer module; ⚠️ = passkeys possible via an external signer you integrate (no native passkey flow); 🔴 = no passkey support documented.
[^69]: Privy supports passkeys as an auth method. https://docs.privy.io/auth/methods/passkeys
[^70]: Openfort documents passkey signers (including cross-app passkey wallets). https://www.openfort.io/docs/guides/passkey-signer/cross-app-wallet
[^71]: Alchemy Account Kit supports passkeys for authentication. https://www.alchemy.com/docs/wallets/getting-started/sign-up
[^72]: ZeroDev supports login with passkeys for smart account UX. https://docs.zerodev.app/
[^73]: Etherspot Prime SDK is instantiated with a signer/private key; passkey UX depends on the signer you integrate (inference). https://etherspot.fyi/prime-sdk/instantiation
[^74]: Biconomy provides a passkey validator module for ERC-7579 accounts. https://docs.biconomy.io/erc-7579-modules/validator-modules/biconomy-passkey-validator-module
[^75]: Pimlico permissionless examples create accounts with an external signer; passkey UX depends on the signer you integrate (inference). https://docs.pimlico.io/permissionless/how-to/accounts/use-safe-account
[^76]: Thirdweb in-app wallets support passkey sign-in. https://portal.thirdweb.com/typescript/v5/in-app-wallet/auth
[^77]: Candide positions its SDK as enabling developers to build secure non-custodial digital wallets. https://www.candide.dev/
[^78]: Candide's passkeys guide treats passkeys as a seedless backup alternative, but AbstractionKit does not create WebAuthn credentials; credential creation + rpId handling are app-managed (per source review). https://docs.candide.dev/wallet/abstractionkit/quickstart/passkeys
[^79]: AbstractionKit is vendor-agnostic: it can plug into any bundler/paymaster provider, supports ERC-4337 UserOps, and includes gas sponsorship flows. https://docs.candide.dev/wallet/abstractionkit/introduction/
[^80]: AbstractionKit supports EntryPoint v0.8 for userop utilities and Simple7702Account, but Safe account classes in the SDK still target EntryPoint v0.7 (per source review). https://docs.candide.dev/wallet/abstractionkit/account-implementations/simple-7702-account
[^81]: ERC-4337 modular standards docs list ERC-7579 as deployed in production by Candide. https://docs.erc4337.io/modular-standards/
[^82]: Candide offers public bundler/paymaster endpoints without API keys and publishes open-source infra (Voltaire bundler and Candide paymaster RPC), enabling self-hosted fallbacks. The SDK uses a single bundler endpoint and does not provide built-in rotation/health checks (per source review). https://docs.candide.dev/wallet/bundler/public-endpoints/ and https://github.com/candidelabs/voltaire and https://github.com/candidelabs/Candide-Paymaster-RPC
[^83]: Candide provides recovery modules and guides for account recovery flows; their Safe-based social recovery is a legacy Safe module (not ERC-7579) per the source review. https://docs.candide.dev/wallet/abstractionkit/recovery/social-recovery
[^84]: Candide's public endpoints are free but rate-limited; higher limits require signing up in the dashboard. https://docs.candide.dev/wallet/bundler/public-endpoints/
[^85]: AbstractionKit is open-source (Candide GitHub org) and published as an MIT-licensed npm package. https://github.com/candidelabs and https://www.npmjs.com/package/abstractionkit
[^86]: Candide AbstractionKit details are based on the provided source review (e.g., UserOperationV8 utilities, Simple7702Account v0.8, Safe account classes v0.7, passkey creation handled by the app, single bundler endpoint, legacy Safe recovery module).
[^87]: Relay Kit is signer-agnostic: you provide a signer (EOA/private key or passkey signer) to control the Safe, so custody remains with the signer you integrate. https://docs.safe.global/sdk/relay-kit/reference/safe-4337-pack and https://docs.safe.global/sdk/signers/passkeys
[^88]: Relay Kit does not manage key export/import; portability and seedless UX depend on the signer you integrate (inference). https://docs.safe.global/sdk/relay-kit/reference/safe-4337-pack
[^89]: Relay Kit lets you specify bundler and paymaster endpoints via `bundlerUrl` and `paymasterOptions`; Safe docs show Pimlico in examples but note you can use any ERC-4337 provider. https://docs.safe.global/sdk/relay-kit/reference/safe-4337-pack and https://docs.safe.global/advanced/erc-4337/guides/safe-sdk
[^90]: Safe provides a passkey signer that can be used to initialize the Safe{Core} SDK kits (including Relay Kit). https://docs.safe.global/sdk/signers/passkeys
[^91]: Relay Kit uses the Safe 4337 Module for ERC-4337; ERC-7579 module support is not documented in Relay Kit. https://docs.safe.global/sdk/relay-kit/reference/safe-4337-pack
[^92]: Safe Relay Kit supports EntryPoint v0.6 by default (Safe 4337 Module v0.2.0) and v0.7 when `safeModulesVersion` is set to `0.3.0`; v0.8 is not documented. https://docs.safe.global/advanced/erc-4337/guides/safe-sdk
[^94]: Relay Kit does not include built-in recovery flows; recovery understanding is left to Safe modules you integrate (inference). https://docs.safe.global/sdk/relay-kit
[^95]: Relay Kit enables ERC-4337 on Safe and supports paying fees with native or ERC-20 tokens or via sponsorship/paymasters. https://github.com/safe-global/safe-core-sdk and https://docs.safe.global/advanced/erc-4337/guides/safe-sdk
[^96]: Safe Core SDK (including Relay Kit) is open-source under MIT. https://github.com/safe-global/safe-core-sdk
[^97]: GitHub stars snapshot (as of January 14, 2026) for each vendor's primary SDK repo; counts change over time. N/A indicates no canonical public SDK repo.
[^98]: Openfort JS SDK GitHub stars. https://github.com/openfort-xyz/openfort-js
[^99]: Alchemy AA SDK GitHub stars. https://github.com/alchemyplatform/aa-sdk
[^100]: ZeroDev SDK GitHub stars. https://github.com/zerodevapp/sdk
[^101]: Etherspot Prime SDK GitHub stars. https://github.com/etherspot/etherspot-prime-sdk
[^102]: Biconomy Client SDK GitHub stars. https://github.com/bcnmy/biconomy-client-sdk
[^103]: Pimlico permissionless.js GitHub stars. https://github.com/pimlicolabs/permissionless.js
[^104]: Thirdweb JS SDK GitHub stars. https://github.com/thirdweb-dev/js
[^105]: Candide AbstractionKit GitHub stars. https://github.com/candidelabs/abstractionkit
[^106]: Safe Core SDK GitHub stars. https://github.com/safe-global/safe-core-sdk

## Getting started

```bash
pnpm install
pnpm dev
```

The demo UI lets you:
- Create a passkey
- Compute and deploy a counterfactual Safe
- Connect injected wallets / WalletConnect signers
- Configure RPC + bundler endpoints
- Export/import wallet metadata (encrypted or plaintext)

## Local AA stack (standalone)

This repo includes a minimal `onchain/` workspace (Hardhat + deploy scripts + bundler helpers) so anyone can run the full passkey + local AA flow without any sibling repo.

```bash
pnpm install
pnpm -C onchain install
```

Terminal A (Hardhat + deploy + emit local chain config):
```bash
pnpm local:chain
```

Terminal B (local v0.8 bundler via Docker, Transeptor):
```bash
pnpm local:bundler
```

Terminal C (Vite app):
```bash
pnpm dev
```

Single-command launcher (chain + bundler + app):
```bash
pnpm local:dev
```

Use Skandha instead of Transeptor:
```bash
AA_DEMO_BUNDLER=skandha pnpm local:dev
```

Open `http://app.localhost:5173` (or `http://localhost:5173`) and create a passkey.

Notes:
- If you use `app.localhost`, add `127.0.0.1 app.localhost` to `/etc/hosts`.
- Passkeys are RP-bound; stick to the same hostname you created them on.
- Restarting Hardhat resets state, so rerun `pnpm local:chain` after a node restart.
- Optional: `pnpm local:bundler:skandha` runs Skandha (experimental) after generating a config.
- Smoke tests: `pnpm local:smoke:userop` (no bundler) and `pnpm local:smoke:bundler` (requires bundler).
- Docker is required for the Transeptor/Skandha bundler commands.

### How to test (UI walkthrough)

1) **Smoke tests (CLI sanity checks)**
   - Bundler‑free local test:
     ```bash
     pnpm local:smoke:userop
     ```
   - Bundler E2E test (requires the bundler running):
     ```bash
     pnpm local:smoke:bundler
     ```
   - Expected result: `Safe deployed: true` with a UserOp hash.

2) **Setup tab → Passkey-first onboarding**
   - Click **Create passkey**.
   - Click **Generate address**.
   - Copy the **Address** (top card has a copy button).

3) **Fund the counterfactual Safe (recommended for first send)**
   - In a terminal:
     ```bash
     pnpm -C onchain fund:safe --to 0xYOUR_SAFE_ADDRESS --eth 0.1 --usdc 10
     ```
   - This gives the Safe ETH (for Native gas) and USDC (for transfers).

4) **Portable signer (backup)**
   - Click **Connect injected wallet** (MetaMask/Rabby).
   - Click **Add owner** to add it as a Safe owner.
   - If you imported a wallet on a *different* origin (e.g. `localhost` → `app.localhost`), deploy the Safe first, then click **Add passkey for {origin}** to register a new passkey on the new origin.

5) **Send tab**
   - Enter **USDC amount** and **Recipient**.
   - (Optional) open **Advanced** → **Paymaster mode** and select `NATIVE`, `USDC`, or `SPONSORED`.
   - Click **Review transaction**.
   - Click **Submit UserOp**.

6) **Activity tab**
   - Confirm the UserOp and transfers appear.

7) **Export / Import (prove portability)**
   - Back on the original origin (where the first passkey was created), click **Advanced** → **Export** and download the wallet JSON.
   - Open the other origin (e.g. `http://app.localhost:5173` if you started on `http://localhost:5173`).
   - Click **Advanced** → **Import** and select the exported JSON.
   - In **Setup** → **Portable signer (backup)**, click **Connect injected wallet** and ensure it’s the **same wallet you added as an owner**.
   - If the Safe is already deployed, click **Add passkey for {origin}** to register a passkey for the new origin.
   - Go to **Send** and submit a UserOp from the new origin. This proves the imported wallet can control the Safe.
   - Expected result: a new UserOp hash is shown and the **Activity** tab lists the transfer.

Tip: If you skip adding a portable owner before export, the imported wallet can’t sign on the new origin because passkeys are RP‑bound.

## Optional environment variables

Create a `.env.local` if you want to hardcode values:

```
# Passkey RP ID override (optional)
VITE_WALLET_PASSKEY_RP_ID=app.localhost
# Alternate env name supported by the wallet module
VITE_PASSKEY_RP_ID=app.localhost
# COEP mode for cross-origin isolation (credentialless | require-corp)
VITE_COEP_MODE=credentialless
```

## Notes

- Bundler and RPC endpoints can be overridden from the Wallet Settings panel.
- The local chain config in `src/wallet/chain/local.generated.ts` mirrors the Demo setup.
