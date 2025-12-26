import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

const DECIMALS = 1_000_000n;
const PRICE = 2900n;

async function deployFixture() {
  const usdtFactory = await ethers.getContractFactory("FHEUSDT");
  const ethFactory = await ethers.getContractFactory("FHEETH");
  const swapFactory = await ethers.getContractFactory("EncryptedSwap");

  const usdt = (await usdtFactory.deploy()) as Contract;
  const eth = (await ethFactory.deploy()) as Contract;
  const swap = (await swapFactory.deploy(await usdt.getAddress(), await eth.getAddress())) as Contract;

  return { usdt, eth, swap };
}

async function decryptEuint64(
  ciphertext: string,
  contractAddress: string,
  signer: HardhatEthersSigner,
) {
  return fhevm.userDecryptEuint(FhevmType.euint64, ciphertext, contractAddress, signer);
}

describe("EncryptedSwap", function () {
  let signers: Signers;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This hardhat test suite cannot run on Sepolia Testnet");
      this.skip();
    }
  });

  it("adds liquidity and swaps at fixed price", async function () {
    const { usdt, eth, swap } = await deployFixture();
    const swapAddress = await swap.getAddress();
    const usdtAddress = await usdt.getAddress();
    const ethAddress = await eth.getAddress();

    const mintUsdt = 10_000n * DECIMALS;
    const mintEth = 10n * DECIMALS;
    await usdt.mint(signers.alice.address, mintUsdt);
    await eth.mint(signers.alice.address, mintEth);

    const operatorUntil = 281474976710655;
    await usdt.connect(signers.alice).setOperator(swapAddress, operatorUntil);
    await eth.connect(signers.alice).setOperator(swapAddress, operatorUntil);

    const liquidityUsdt = 5_800n * DECIMALS;
    const liquidityEth = 2n * DECIMALS;
    const liquidityInput = await fhevm
      .createEncryptedInput(swapAddress, signers.alice.address)
      .add64(liquidityUsdt)
      .add64(liquidityEth)
      .encrypt();

    await swap
      .connect(signers.alice)
      .addLiquidity(liquidityInput.handles[0], liquidityInput.handles[1], liquidityInput.inputProof);

    const swapUsdt = 2_900n * DECIMALS;
    const swapInput = await fhevm
      .createEncryptedInput(swapAddress, signers.alice.address)
      .add64(swapUsdt)
      .encrypt();

    await swap.connect(signers.alice).swapUsdtForEth(swapInput.handles[0], swapInput.inputProof);

    const encryptedUsdtBalance = await usdt.confidentialBalanceOf(signers.alice.address);
    const encryptedEthBalance = await eth.confidentialBalanceOf(signers.alice.address);
    const encryptedLiquidity = await swap.liquidityOf(signers.alice.address);

    const clearUsdtBalance = await decryptEuint64(encryptedUsdtBalance, usdtAddress, signers.alice);
    const clearEthBalance = await decryptEuint64(encryptedEthBalance, ethAddress, signers.alice);
    const clearLiquidity = await decryptEuint64(encryptedLiquidity, swapAddress, signers.alice);

    const expectedUsdt = mintUsdt - liquidityUsdt - swapUsdt;
    const expectedEth = mintEth - liquidityEth + DECIMALS;

    expect(clearUsdtBalance).to.equal(expectedUsdt);
    expect(clearEthBalance).to.equal(expectedEth);
    expect(clearLiquidity).to.equal(liquidityUsdt);
  });

  it("removes liquidity and returns proportional assets", async function () {
    const { usdt, eth, swap } = await deployFixture();
    const swapAddress = await swap.getAddress();
    const usdtAddress = await usdt.getAddress();
    const ethAddress = await eth.getAddress();

    const mintUsdt = 10_000n * DECIMALS;
    const mintEth = 10n * DECIMALS;
    await usdt.mint(signers.alice.address, mintUsdt);
    await eth.mint(signers.alice.address, mintEth);

    const operatorUntil = 281474976710655;
    await usdt.connect(signers.alice).setOperator(swapAddress, operatorUntil);
    await eth.connect(signers.alice).setOperator(swapAddress, operatorUntil);

    const liquidityUsdt = 5_800n * DECIMALS;
    const liquidityEth = 2n * DECIMALS;
    const liquidityInput = await fhevm
      .createEncryptedInput(swapAddress, signers.alice.address)
      .add64(liquidityUsdt)
      .add64(liquidityEth)
      .encrypt();

    await swap
      .connect(signers.alice)
      .addLiquidity(liquidityInput.handles[0], liquidityInput.handles[1], liquidityInput.inputProof);

    const removeLiquidity = 2_900n * DECIMALS;
    const removeInput = await fhevm
      .createEncryptedInput(swapAddress, signers.alice.address)
      .add64(removeLiquidity)
      .encrypt();

    await swap.connect(signers.alice).removeLiquidity(removeInput.handles[0], removeInput.inputProof);

    const encryptedUsdtBalance = await usdt.confidentialBalanceOf(signers.alice.address);
    const encryptedEthBalance = await eth.confidentialBalanceOf(signers.alice.address);
    const encryptedLiquidity = await swap.liquidityOf(signers.alice.address);

    const clearUsdtBalance = await decryptEuint64(encryptedUsdtBalance, usdtAddress, signers.alice);
    const clearEthBalance = await decryptEuint64(encryptedEthBalance, ethAddress, signers.alice);
    const clearLiquidity = await decryptEuint64(encryptedLiquidity, swapAddress, signers.alice);

    const expectedUsdt = mintUsdt - liquidityUsdt + removeLiquidity;
    const expectedEth = mintEth - liquidityEth + (removeLiquidity / PRICE);

    expect(clearUsdtBalance).to.equal(expectedUsdt);
    expect(clearEthBalance).to.equal(expectedEth);
    expect(clearLiquidity).to.equal(liquidityUsdt - removeLiquidity);
  });
});
