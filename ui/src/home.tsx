import { useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract } from 'wagmi';
import { Contract, formatUnits, parseUnits, ZeroHash } from 'ethers';

import {
  EETH_ABI,
  EETH_ADDRESS,
  EUSDT_ABI,
  EUSDT_ADDRESS,
  SWAP_ABI,
  SWAP_ADDRESS,
} from './config/contracts';
import { useEthersSigner } from './hooks/useEthersSigner';
import { useZamaInstance } from './hooks/useZamaInstance';
import './styles/home.css';

const DECIMALS = 6;
const PRICE = 2900n;
const OPERATOR_WINDOW_SECONDS = 60 * 60 * 24 * 30;

type DecryptedBalances = {
  usdt?: string;
  eth?: string;
  liquidity?: string;
};

function toAddress(value: string) {
  return value as `0x${string}`;
}

function parseAmount(value: string) {
  if (!value) return null;
  try {
    return parseUnits(value, DECIMALS);
  } catch (error) {
    return null;
  }
}

function formatAmount(value?: bigint) {
  if (value === undefined) return '0.000000';
  return formatUnits(value, DECIMALS);
}

function parseDecrypted(value: unknown) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return 0n;
}

function truncateHandle(handle?: string) {
  if (!handle) return '—';
  if (handle === ZeroHash) return '0x0000…0000';
  return `${handle.slice(0, 10)}…${handle.slice(-6)}`;
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const signer = useEthersSigner();
  const { instance, isLoading: isZamaLoading, error: zamaError } = useZamaInstance();

  const [usdtMintInput, setUsdtMintInput] = useState('');
  const [ethMintInput, setEthMintInput] = useState('');
  const [usdtSwapInput, setUsdtSwapInput] = useState('');
  const [ethSwapInput, setEthSwapInput] = useState('');
  const [liquidityUsdtInput, setLiquidityUsdtInput] = useState('');
  const [liquidityEthInput, setLiquidityEthInput] = useState('');
  const [liquidityRemoveInput, setLiquidityRemoveInput] = useState('');

  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [decrypted, setDecrypted] = useState<DecryptedBalances>({});
  const [isDecrypting, setIsDecrypting] = useState(false);

  const swapAddress = useMemo(() => toAddress(SWAP_ADDRESS), []);
  const usdtAddress = useMemo(() => toAddress(EUSDT_ADDRESS), []);
  const ethAddress = useMemo(() => toAddress(EETH_ADDRESS), []);

  const { data: usdtBalance } = useReadContract({
    address: usdtAddress,
    abi: EUSDT_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: ethBalance } = useReadContract({
    address: ethAddress,
    abi: EETH_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: liquidityBalance } = useReadContract({
    address: swapAddress,
    abi: SWAP_ABI,
    functionName: 'liquidityOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: reserves } = useReadContract({
    address: swapAddress,
    abi: SWAP_ABI,
    functionName: 'getReserves',
  });

  const { data: totalLiquidity } = useReadContract({
    address: swapAddress,
    abi: SWAP_ABI,
    functionName: 'totalLiquidity',
  });

  const handleError = (error: unknown, fallback: string) => {
    console.error(error);
    setStatusMessage(fallback);
  };

  const runTx = async (action: () => Promise<void>, successMessage: string) => {
    if (!isConnected) {
      setStatusMessage('Connect your wallet to continue.');
      return;
    }
    if (!signer) {
      setStatusMessage('Wallet signer not available.');
      return;
    }
    try {
      setIsBusy(true);
      setStatusMessage('Waiting for confirmation...');
      await action();
      setStatusMessage(successMessage);
    } catch (error) {
      handleError(error, 'Transaction failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const mintToken = async (token: 'usdt' | 'eth') => {
    const amount = parseAmount(token === 'usdt' ? usdtMintInput : ethMintInput);
    if (!amount || amount <= 0n) {
      setStatusMessage('Enter a valid mint amount.');
      return;
    }

    await runTx(async () => {
      const resolvedSigner = await signer;
      if (!resolvedSigner || !address) return;
      const contract = new Contract(
        token === 'usdt' ? usdtAddress : ethAddress,
        token === 'usdt' ? EUSDT_ABI : EETH_ABI,
        resolvedSigner,
      );
      const tx = await contract.mint(address, amount);
      await tx.wait();
      if (token === 'usdt') setUsdtMintInput('');
      if (token === 'eth') setEthMintInput('');
    }, 'Minted tokens successfully.');
  };

  const setOperator = async (token: 'usdt' | 'eth') => {
    await runTx(async () => {
      const resolvedSigner = await signer;
      if (!resolvedSigner) return;
      const contract = new Contract(
        token === 'usdt' ? usdtAddress : ethAddress,
        token === 'usdt' ? EUSDT_ABI : EETH_ABI,
        resolvedSigner,
      );
      const until = Math.floor(Date.now() / 1000) + OPERATOR_WINDOW_SECONDS;
      const tx = await contract.setOperator(swapAddress, until);
      await tx.wait();
    }, 'Swap operator enabled.');
  };

  const addLiquidity = async () => {
    if (!instance) {
      setStatusMessage('Encryption service not ready.');
      return;
    }
    const usdtAmount = parseAmount(liquidityUsdtInput);
    const ethAmount = parseAmount(liquidityEthInput);
    if (!usdtAmount || !ethAmount || usdtAmount <= 0n || ethAmount <= 0n) {
      setStatusMessage('Enter valid liquidity amounts.');
      return;
    }

    const expectedUsdt = ethAmount * PRICE;
    if (usdtAmount !== expectedUsdt) {
      setStatusMessage(`Amounts must match the 1 eETH = ${PRICE.toString()} eUSDT ratio.`);
      return;
    }

    await runTx(async () => {
      const resolvedSigner = await signer;
      if (!resolvedSigner) return;
      const input = await instance.createEncryptedInput(swapAddress, address);
      input.add64(usdtAmount);
      input.add64(ethAmount);
      const encrypted = await input.encrypt();

      const contract = new Contract(swapAddress, SWAP_ABI, resolvedSigner);
      const tx = await contract.addLiquidity(
        encrypted.handles[0],
        encrypted.handles[1],
        encrypted.inputProof,
      );
      await tx.wait();
      setLiquidityUsdtInput('');
      setLiquidityEthInput('');
    }, 'Liquidity added.');
  };

  const removeLiquidity = async () => {
    if (!instance) {
      setStatusMessage('Encryption service not ready.');
      return;
    }
    const amount = parseAmount(liquidityRemoveInput);
    if (!amount || amount <= 0n) {
      setStatusMessage('Enter a valid liquidity amount.');
      return;
    }

    await runTx(async () => {
      const resolvedSigner = await signer;
      if (!resolvedSigner) return;
      const input = await instance.createEncryptedInput(swapAddress, address);
      input.add64(amount);
      const encrypted = await input.encrypt();

      const contract = new Contract(swapAddress, SWAP_ABI, resolvedSigner);
      const tx = await contract.removeLiquidity(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
      setLiquidityRemoveInput('');
    }, 'Liquidity removed.');
  };

  const swapUsdtForEth = async () => {
    if (!instance) {
      setStatusMessage('Encryption service not ready.');
      return;
    }
    const amount = parseAmount(usdtSwapInput);
    if (!amount || amount <= 0n) {
      setStatusMessage('Enter a valid eUSDT amount.');
      return;
    }

    await runTx(async () => {
      const resolvedSigner = await signer;
      if (!resolvedSigner) return;
      const input = await instance.createEncryptedInput(swapAddress, address);
      input.add64(amount);
      const encrypted = await input.encrypt();

      const contract = new Contract(swapAddress, SWAP_ABI, resolvedSigner);
      const tx = await contract.swapUsdtForEth(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
      setUsdtSwapInput('');
    }, 'Swap completed.');
  };

  const swapEthForUsdt = async () => {
    if (!instance) {
      setStatusMessage('Encryption service not ready.');
      return;
    }
    const amount = parseAmount(ethSwapInput);
    if (!amount || amount <= 0n) {
      setStatusMessage('Enter a valid eETH amount.');
      return;
    }

    await runTx(async () => {
      const resolvedSigner = await signer;
      if (!resolvedSigner) return;
      const input = await instance.createEncryptedInput(swapAddress, address);
      input.add64(amount);
      const encrypted = await input.encrypt();

      const contract = new Contract(swapAddress, SWAP_ABI, resolvedSigner);
      const tx = await contract.swapEthForUsdt(encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
      setEthSwapInput('');
    }, 'Swap completed.');
  };

  const decryptBalances = async () => {
    if (!instance || !address || !signer) {
      setStatusMessage('Missing encryption tools for decryption.');
      return;
    }
    if (!usdtBalance && !ethBalance && !liquidityBalance) {
      setStatusMessage('No encrypted balances available.');
      return;
    }

    setIsDecrypting(true);
    try {
      const resolvedSigner = await signer;
      if (!resolvedSigner) return;

      const keypair = instance.generateKeypair();
      const handleContractPairs = [] as Array<{ handle: string; contractAddress: string }>;

      if (typeof usdtBalance === 'string' && usdtBalance !== ZeroHash) {
        handleContractPairs.push({ handle: usdtBalance, contractAddress: usdtAddress });
      }
      if (typeof ethBalance === 'string' && ethBalance !== ZeroHash) {
        handleContractPairs.push({ handle: ethBalance, contractAddress: ethAddress });
      }
      if (typeof liquidityBalance === 'string' && liquidityBalance !== ZeroHash) {
        handleContractPairs.push({ handle: liquidityBalance, contractAddress: swapAddress });
      }

      if (!handleContractPairs.length) {
        setStatusMessage('Encrypted balances are empty.');
        return;
      }

      const contractAddresses = Array.from(
        new Set(handleContractPairs.map((item) => item.contractAddress)),
      );
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays,
      );

      const signature = await resolvedSigner.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      setDecrypted({
        usdt:
          typeof usdtBalance === 'string'
            ? formatAmount(parseDecrypted(result[usdtBalance]))
            : undefined,
        eth:
          typeof ethBalance === 'string'
            ? formatAmount(parseDecrypted(result[ethBalance]))
            : undefined,
        liquidity:
          typeof liquidityBalance === 'string'
            ? formatAmount(parseDecrypted(result[liquidityBalance]))
            : undefined,
      });

      setStatusMessage('Balances decrypted locally.');
    } catch (error) {
      handleError(error, 'Failed to decrypt balances.');
    } finally {
      setIsDecrypting(false);
    }
  };

  const poolUsdtHandle = Array.isArray(reserves) ? (reserves[0] as string) : undefined;
  const poolEthHandle = Array.isArray(reserves) ? (reserves[1] as string) : undefined;

  return (
    <div className="home">
      <header className="hero">
        <div>
          <p className="hero-kicker">EncryptedX Swap</p>
          <h1>Private liquidity, public confidence.</h1>
          <p className="hero-subtitle">
            Swap eUSDT and eETH at a fixed 1 eETH = 2900 eUSDT price. Encrypted balances stay private until
            you decrypt locally.
          </p>
          <div className="hero-meta">
            <div>
              <span className="label">Network</span>
              <strong>Sepolia FHEVM</strong>
            </div>
            <div>
              <span className="label">Pool Ratio</span>
              <strong>1 eETH = 2900 eUSDT</strong>
            </div>
          </div>
        </div>
        <div className="hero-connect">
          <ConnectButton showBalance={false} chainStatus="icon" />
          <p className="hero-note">
            {isZamaLoading ? 'Connecting to the relayer...' : zamaError ? zamaError : 'Relayer ready.'}
          </p>
        </div>
      </header>

      <section className="grid">
        <div className="column">
          <div className="card">
            <div className="card-header">
              <h2>Encrypted Balances</h2>
              <button
                className="button ghost"
                onClick={decryptBalances}
                disabled={!isConnected || isDecrypting || isBusy}
              >
                {isDecrypting ? 'Decrypting…' : 'Decrypt Locally'}
              </button>
            </div>
            <div className="balance-list">
              <div className="balance-row">
                <div>
                  <span className="label">eUSDT</span>
                  <span className="handle">Handle {truncateHandle(usdtBalance as string | undefined)}</span>
                </div>
                <div className="balance-value">
                  <span>{decrypted.usdt ?? '••••••'}</span>
                </div>
              </div>
              <div className="balance-row">
                <div>
                  <span className="label">eETH</span>
                  <span className="handle">Handle {truncateHandle(ethBalance as string | undefined)}</span>
                </div>
                <div className="balance-value">
                  <span>{decrypted.eth ?? '••••••'}</span>
                </div>
              </div>
              <div className="balance-row">
                <div>
                  <span className="label">Liquidity Share</span>
                  <span className="handle">Handle {truncateHandle(liquidityBalance as string | undefined)}</span>
                </div>
                <div className="balance-value">
                  <span>{decrypted.liquidity ?? '••••••'}</span>
                </div>
              </div>
            </div>
            <div className="card-footer">
              <div>
                <span className="label">Pool Reserves (encrypted)</span>
                <p className="handle">
                  eUSDT {truncateHandle(poolUsdtHandle)} · eETH {truncateHandle(poolEthHandle)}
                </p>
              </div>
              <div>
                <span className="label">Total Liquidity (encrypted)</span>
                <p className="handle">{truncateHandle(totalLiquidity as string | undefined)}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Token Faucet</h2>
              <span className="pill">Test assets</span>
            </div>
            <div className="form">
              <label>
                <span>Mint eUSDT</span>
                <input
                  value={usdtMintInput}
                  onChange={(event) => setUsdtMintInput(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button
                className="button"
                onClick={() => mintToken('usdt')}
                disabled={!isConnected || isBusy}
              >
                Mint eUSDT
              </button>
            </div>
            <div className="form">
              <label>
                <span>Mint eETH</span>
                <input
                  value={ethMintInput}
                  onChange={(event) => setEthMintInput(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button
                className="button"
                onClick={() => mintToken('eth')}
                disabled={!isConnected || isBusy}
              >
                Mint eETH
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Grant Swap Operator</h2>
              <span className="pill muted">Required once</span>
            </div>
            <p className="card-text">
              The pool uses encrypted transfers, so your wallet must approve the swap contract as an operator
              for both tokens.
            </p>
            <div className="button-row">
              <button
                className="button ghost"
                onClick={() => setOperator('usdt')}
                disabled={!isConnected || isBusy}
              >
                Enable eUSDT Operator
              </button>
              <button
                className="button ghost"
                onClick={() => setOperator('eth')}
                disabled={!isConnected || isBusy}
              >
                Enable eETH Operator
              </button>
            </div>
          </div>
        </div>

        <div className="column">
          <div className="card">
            <div className="card-header">
              <h2>Swap</h2>
              <span className="pill">Fixed price</span>
            </div>
            <div className="swap-grid">
              <div className="form">
                <label>
                  <span>Swap eUSDT → eETH</span>
                  <input
                    value={usdtSwapInput}
                    onChange={(event) => setUsdtSwapInput(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <p className="helper">Output ≈ {usdtSwapInput ? formatAmount(parseAmount(usdtSwapInput) ? (parseAmount(usdtSwapInput) as bigint) / PRICE : 0n) : '0.000000'} eETH</p>
                <button
                  className="button"
                  onClick={swapUsdtForEth}
                  disabled={!isConnected || isBusy}
                >
                  Swap to eETH
                </button>
              </div>
              <div className="form">
                <label>
                  <span>Swap eETH → eUSDT</span>
                  <input
                    value={ethSwapInput}
                    onChange={(event) => setEthSwapInput(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <p className="helper">Output ≈ {ethSwapInput ? formatAmount(parseAmount(ethSwapInput) ? (parseAmount(ethSwapInput) as bigint) * PRICE : 0n) : '0.000000'} eUSDT</p>
                <button
                  className="button"
                  onClick={swapEthForUsdt}
                  disabled={!isConnected || isBusy}
                >
                  Swap to eUSDT
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Liquidity</h2>
              <span className="pill">1 eETH = 2900 eUSDT</span>
            </div>
            <div className="form">
              <label>
                <span>eUSDT Amount</span>
                <input
                  value={liquidityUsdtInput}
                  onChange={(event) => setLiquidityUsdtInput(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label>
                <span>eETH Amount</span>
                <input
                  value={liquidityEthInput}
                  onChange={(event) => setLiquidityEthInput(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button
                className="button"
                onClick={addLiquidity}
                disabled={!isConnected || isBusy}
              >
                Add Liquidity
              </button>
            </div>
            <div className="divider" />
            <div className="form">
              <label>
                <span>Remove Liquidity (shares in eUSDT units)</span>
                <input
                  value={liquidityRemoveInput}
                  onChange={(event) => setLiquidityRemoveInput(event.target.value)}
                  placeholder="0.00"
                />
              </label>
              <button
                className="button ghost"
                onClick={removeLiquidity}
                disabled={!isConnected || isBusy}
              >
                Remove Liquidity
              </button>
            </div>
          </div>

          <div className="status card">
            <div>
              <span className="label">Status</span>
              <p>{statusMessage || 'Ready for encrypted swaps.'}</p>
            </div>
            <div>
              <span className="label">Wallet</span>
              <p>{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Not connected'}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
