import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { dtAdmin } = await getNamedAccounts();

  const deployedFragment = await deploy("FragmentNFT", {
    from: dtAdmin,
  });

  console.log("FragmentNFT deployed successfully at", deployedFragment.address);

  await hre.run("etherscan-verify");
};

export default func;
func.tags = ["FragmentNFT"];
