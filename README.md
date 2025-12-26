# EncryptedX

EncryptedX is a confidential swap and liquidity pool for eUSDT and eETH on FHEVM. It implements a fixed-price
Uniswap V2-style flow with encrypted balances, so users can add liquidity and swap while keeping amounts private.

## Project Goals

- Build a swap contract for eUSDT and eETH with an initial price of 2900 eUSDT = 1 eETH.
- Support encrypted add/remove liquidity and token swaps.
- Provide a frontend that shows encrypted balances and allows local decryption on demand.
- Use real on-chain data only (no mocks) and keep the UI aligned with the existing project structure.

## Problems Solved

- Confidential trading: swap amounts stay encrypted on-chain.
- Private balances: users can view encrypted balances and decrypt only on the client side.
- Simple price discovery: fixed price ratio simplifies early liquidity bootstrapping.
- Clear operator flow: ERC7984 operator approval is integrated for swap access.

## Advantages

- Privacy-first: balances and transfers are encrypted end-to-end.
- Predictable swaps: a fixed 2900:1 ratio reduces price ambiguity.
- Transparent UX: encrypted handles are shown and can be decrypted locally.
- Minimal trust: decryption happens on the client using the relayer SDK.

## Tech Stack

- Smart contracts: Solidity 0.8.27, Hardhat, @fhevm/solidity
- Confidential tokens: OpenZeppelin ERC7984
- Frontend: React + Vite + viem (read) + ethers (write) + RainbowKit
- Relayer: @zama-fhe/relayer-sdk

## Architecture Overview

- FHEUSDT and FHEETH are ERC7984-based confidential tokens with minting for test funds.
- EncryptedSwap maintains encrypted reserves and liquidity shares.
- Liquidity shares are measured in eUSDT units to keep the pool ratio fixed at 2900:1.
- Frontend reads encrypted balances via viem and decrypts them with the relayer SDK.

## Smart Contracts

- `contracts/FHEUSDT.sol`: ERC7984 token for eUSDT.
- `contracts/FHEETH.sol`: ERC7984 token for eETH.
- `contracts/EncryptedSwap.sol`: Fixed-price pool with encrypted liquidity and swaps.

Key behaviors:

- Add liquidity: amounts must match the fixed price ratio.
- Remove liquidity: user receives proportional eUSDT and eETH.
- Swap: eUSDT to eETH or eETH to eUSDT at a fixed ratio.
- All balances, reserves, and liquidity shares are stored as encrypted values.

## Frontend Features

- Wallet connect via RainbowKit.
- Encrypted balance display with local decryption.
- Token faucet for test minting.
- Operator approval flow for both tokens.
- Add/remove liquidity and swap flows using real on-chain data.

## Configuration

This repo uses `.env` for chain configuration. Ensure these are set:

- `INFURA_API_KEY`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY` (optional)

Do not use mnemonic-based accounts.

## Install

```bash
npm install
```

Frontend dependencies are in `ui/`.

```bash
cd ui
npm install
```

## Compile and Test

```bash
npm run compile
npm run test
```

To run only swap tests:

```bash
npx hardhat test test/EncryptedSwap.ts
```

## Deploy

Local deploy:

```bash
npx hardhat deploy --network hardhat
```

Sepolia deploy:

```bash
npx hardhat deploy --network sepolia
```

After Sepolia deployment, copy the ABI from `deployments/sepolia` into
`ui/src/config/contracts.ts`, and update the deployed addresses in that file.

## Frontend Usage

```bash
cd ui
npm run dev
```

Then:

1. Connect wallet.
2. Mint eUSDT/eETH.
3. Set operator approval for the swap contract.
4. Add liquidity or perform swaps.
5. Decrypt balances locally to view cleartext amounts.

## Project Structure

```
contracts/     Smart contracts
deploy/        Deployment script
tasks/         Hardhat tasks
test/          Hardhat tests
ui/            Frontend app (React + Vite)
```

## Security and Privacy Notes

- All balances and pool reserves are encrypted on-chain.
- Decryption happens on the client, never on-chain.
- View functions avoid relying on msg.sender for address selection.
- Operator approvals are time-limited and must be refreshed when needed.

## Future Plans

- Add invariant-based pricing with encrypted constant product math.
- Add fee and protocol revenue accounting under FHE.
- Improve liquidity share accounting and pool analytics.
- Extend to multi-pair routing and liquidity mining.
- Add advanced transaction status and audit tooling in the UI.
- Expand automated tests for edge cases and ACL handling.

## License

BSD-3-Clause-Clear
