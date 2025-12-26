import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedUSDT = await deploy("FHEUSDT", {
    from: deployer,
    log: true,
  });

  const deployedETH = await deploy("FHEETH", {
    from: deployer,
    log: true,
  });

  const deployedSwap = await deploy("EncryptedSwap", {
    from: deployer,
    args: [deployedUSDT.address, deployedETH.address],
    log: true,
  });

  console.log(`FHEUSDT contract: `, deployedUSDT.address);
  console.log(`FHEETH contract: `, deployedETH.address);
  console.log(`EncryptedSwap contract: `, deployedSwap.address);
};
export default func;
func.id = "deploy_encrypted_swap";
func.tags = ["FHEUSDT", "FHEETH", "EncryptedSwap"];
