// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

contract EncryptedSwap is ZamaEthereumConfig {
    uint64 public constant PRICE = 2900;

    IERC7984 public immutable usdt;
    IERC7984 public immutable eth;

    euint64 private _reserveUsdt;
    euint64 private _reserveEth;
    euint64 private _totalLiquidity;

    mapping(address provider => euint64) private _liquidity;

    event LiquidityAdded(address indexed provider, euint64 usdtAmount, euint64 ethAmount, euint64 liquidityMinted);
    event LiquidityRemoved(address indexed provider, euint64 usdtAmount, euint64 ethAmount, euint64 liquidityBurned);
    event SwapExecuted(
        address indexed trader,
        address indexed tokenIn,
        euint64 amountIn,
        address indexed tokenOut,
        euint64 amountOut
    );

    error InvalidToken(address token);
    error IdenticalTokens();

    constructor(address usdtAddress, address ethAddress) {
        if (usdtAddress == address(0) || ethAddress == address(0)) {
            revert InvalidToken(address(0));
        }
        if (usdtAddress == ethAddress) {
            revert IdenticalTokens();
        }

        usdt = IERC7984(usdtAddress);
        eth = IERC7984(ethAddress);

        _reserveUsdt = FHE.asEuint64(0);
        _reserveEth = FHE.asEuint64(0);
        _totalLiquidity = FHE.asEuint64(0);

        FHE.allowThis(_reserveUsdt);
        FHE.allowThis(_reserveEth);
        FHE.allowThis(_totalLiquidity);
    }

    function getReserves() external view returns (euint64 usdtReserve, euint64 ethReserve) {
        return (_reserveUsdt, _reserveEth);
    }

    function totalLiquidity() external view returns (euint64) {
        return _totalLiquidity;
    }

    function liquidityOf(address provider) external view returns (euint64) {
        return _liquidity[provider];
    }

    function addLiquidity(
        externalEuint64 usdtAmount,
        externalEuint64 ethAmount,
        bytes calldata inputProof
    ) external {
        euint64 usdtIn = FHE.fromExternal(usdtAmount, inputProof);
        euint64 ethIn = FHE.fromExternal(ethAmount, inputProof);

        ebool ratioOk = FHE.eq(usdtIn, FHE.mul(ethIn, PRICE));

        euint64 zero = FHE.asEuint64(0);
        euint64 usdtToTransfer = FHE.select(ratioOk, usdtIn, zero);
        euint64 ethToTransfer = FHE.select(ratioOk, ethIn, zero);

        FHE.allowThis(usdtToTransfer);
        FHE.allowThis(ethToTransfer);
        FHE.allowTransient(usdtToTransfer, address(usdt));
        FHE.allowTransient(ethToTransfer, address(eth));

        euint64 usdtTransferred = usdt.confidentialTransferFrom(msg.sender, address(this), usdtToTransfer);
        euint64 ethTransferred = eth.confidentialTransferFrom(msg.sender, address(this), ethToTransfer);

        _reserveUsdt = FHE.add(_reserveUsdt, usdtTransferred);
        _reserveEth = FHE.add(_reserveEth, ethTransferred);

        euint64 liquidityMinted = usdtTransferred;
        _totalLiquidity = FHE.add(_totalLiquidity, liquidityMinted);
        _setLiquidity(msg.sender, FHE.add(_liquidity[msg.sender], liquidityMinted));

        FHE.allowThis(_reserveUsdt);
        FHE.allowThis(_reserveEth);
        FHE.allowThis(_totalLiquidity);

        emit LiquidityAdded(msg.sender, usdtTransferred, ethTransferred, liquidityMinted);
    }

    function removeLiquidity(externalEuint64 liquidityAmount, bytes calldata inputProof) external {
        euint64 liquidityIn = FHE.fromExternal(liquidityAmount, inputProof);
        ebool hasBalance = FHE.le(liquidityIn, _liquidity[msg.sender]);

        euint64 zero = FHE.asEuint64(0);
        euint64 liquidityToBurn = FHE.select(hasBalance, liquidityIn, zero);

        euint64 usdtOut = liquidityToBurn;
        euint64 ethOut = FHE.div(liquidityToBurn, PRICE);

        ebool hasUsdt = FHE.le(usdtOut, _reserveUsdt);
        ebool hasEth = FHE.le(ethOut, _reserveEth);
        ebool canWithdraw = FHE.and(hasUsdt, hasEth);

        euint64 finalLiquidity = FHE.select(canWithdraw, liquidityToBurn, zero);
        euint64 finalUsdt = FHE.select(canWithdraw, usdtOut, zero);
        euint64 finalEth = FHE.select(canWithdraw, ethOut, zero);

        _reserveUsdt = FHE.sub(_reserveUsdt, finalUsdt);
        _reserveEth = FHE.sub(_reserveEth, finalEth);

        _totalLiquidity = FHE.sub(_totalLiquidity, finalLiquidity);
        _setLiquidity(msg.sender, FHE.sub(_liquidity[msg.sender], finalLiquidity));

        FHE.allowThis(finalUsdt);
        FHE.allowThis(finalEth);
        FHE.allowTransient(finalUsdt, address(usdt));
        FHE.allowTransient(finalEth, address(eth));
        FHE.allowThis(_reserveUsdt);
        FHE.allowThis(_reserveEth);
        FHE.allowThis(_totalLiquidity);

        euint64 usdtTransferred = usdt.confidentialTransfer(msg.sender, finalUsdt);
        euint64 ethTransferred = eth.confidentialTransfer(msg.sender, finalEth);

        emit LiquidityRemoved(msg.sender, usdtTransferred, ethTransferred, finalLiquidity);
    }

    function swapUsdtForEth(externalEuint64 usdtAmount, bytes calldata inputProof) external {
        euint64 usdtIn = FHE.fromExternal(usdtAmount, inputProof);
        euint64 ethOut = FHE.div(usdtIn, PRICE);

        ebool hasLiquidity = FHE.le(ethOut, _reserveEth);
        euint64 zero = FHE.asEuint64(0);

        euint64 usdtToTransfer = FHE.select(hasLiquidity, usdtIn, zero);
        euint64 ethToTransfer = FHE.select(hasLiquidity, ethOut, zero);

        FHE.allowThis(usdtToTransfer);
        FHE.allowThis(ethToTransfer);
        FHE.allowTransient(usdtToTransfer, address(usdt));
        FHE.allowTransient(ethToTransfer, address(eth));

        euint64 usdtTransferred = usdt.confidentialTransferFrom(msg.sender, address(this), usdtToTransfer);
        euint64 ethTransferred = eth.confidentialTransfer(msg.sender, ethToTransfer);

        _reserveUsdt = FHE.add(_reserveUsdt, usdtTransferred);
        _reserveEth = FHE.sub(_reserveEth, ethTransferred);

        FHE.allowThis(_reserveUsdt);
        FHE.allowThis(_reserveEth);

        emit SwapExecuted(msg.sender, address(usdt), usdtTransferred, address(eth), ethTransferred);
    }

    function swapEthForUsdt(externalEuint64 ethAmount, bytes calldata inputProof) external {
        euint64 ethIn = FHE.fromExternal(ethAmount, inputProof);
        euint64 usdtOut = FHE.mul(ethIn, PRICE);

        ebool hasLiquidity = FHE.le(usdtOut, _reserveUsdt);
        euint64 zero = FHE.asEuint64(0);

        euint64 ethToTransfer = FHE.select(hasLiquidity, ethIn, zero);
        euint64 usdtToTransfer = FHE.select(hasLiquidity, usdtOut, zero);

        FHE.allowThis(ethToTransfer);
        FHE.allowThis(usdtToTransfer);
        FHE.allowTransient(ethToTransfer, address(eth));
        FHE.allowTransient(usdtToTransfer, address(usdt));

        euint64 ethTransferred = eth.confidentialTransferFrom(msg.sender, address(this), ethToTransfer);
        euint64 usdtTransferred = usdt.confidentialTransfer(msg.sender, usdtToTransfer);

        _reserveEth = FHE.add(_reserveEth, ethTransferred);
        _reserveUsdt = FHE.sub(_reserveUsdt, usdtTransferred);

        FHE.allowThis(_reserveEth);
        FHE.allowThis(_reserveUsdt);

        emit SwapExecuted(msg.sender, address(eth), ethTransferred, address(usdt), usdtTransferred);
    }

    function _setLiquidity(address provider, euint64 balance) internal {
        _liquidity[provider] = balance;
        FHE.allowThis(balance);
        FHE.allow(balance, provider);
    }
}
