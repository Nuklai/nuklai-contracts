import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { DatasetNFT } from "@typechained";
import { constants } from "./../utils";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;

  const { dtAdmin } = await getNamedAccounts();

  const deployedDataset = await deploy("DatasetNFT", {
    from: dtAdmin,
  });

  console.log("DatasetNFT deployed successfully at", deployedDataset.address);

  const deployedFragment = await deploy("FragmentNFT", {
    from: dtAdmin,
  });

  console.log("FragmentNFT deployed successfully at", deployedFragment.address);

  const dataset: DatasetNFT = await ethers.getContractAtWithSignerAddress(
    "DatasetNFT",
    deployedDataset.address,
    dtAdmin
  );

  const grantedRole = await dataset.grantRole(constants.SIGNER_ROLE, dtAdmin);
  await grantedRole.wait();

  console.log("DatasetNFT granted role to", dtAdmin);

  const fragmentImplementationSet = await dataset.setFragmentImplementation(
    deployedFragment.address
  );
  await fragmentImplementationSet.wait();

  console.log(
    "DatasetNFT fragment implementation set successfully:",
    await dataset.fragmentImplementation()
  );
};

export default func;
func.tags = ["DatasetNFT"];
