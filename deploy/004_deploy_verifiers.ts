import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { dtAdmin } = await getNamedAccounts();

  const deployedAcceptManuallyVerifier = await deploy(
    "AcceptManuallyVerifier",
    {
      from: dtAdmin,
    }
  );

  console.log(
    "AcceptManuallyVerifier deployed successfully at",
    deployedAcceptManuallyVerifier.address
  );

  const deployedAcceptAllVerifier = await deploy("AcceptAllVerifier", {
    from: dtAdmin,
  });

  console.log(
    "AcceptAllVerifier deployed successfully at",
    deployedAcceptAllVerifier.address
  );

  await hre.run("etherscan-verify");
};

export default func;
func.tags = ["DatasetVerifiers"];
