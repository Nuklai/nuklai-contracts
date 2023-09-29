import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { DatasetFactory, DatasetNFT } from '@typechained';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;
  const { dtAdmin } = await getNamedAccounts();

  const dataset = await ethers.getContract('DatasetNFT');
  const datasetAddress = await dataset.getAddress();

  console.log('DT admin: ', dtAdmin);

  const deployedDatasetFactory = await deploy('DatasetFactory', {
    from: dtAdmin,
  });

  console.log('DatasetFactory deployed successfully at', deployedDatasetFactory.address);

  const subscriptionManager = await ethers.getContract('ERC20SubscriptionManager');
  const distributionManager = await ethers.getContract('DistributionManager');
  const verifierManager = await ethers.getContract('VerifierManager');

  const datasetFactory: DatasetFactory = await ethers.getContractAtWithSignerAddress(
    'DatasetFactory',
    deployedDatasetFactory.address,
    dtAdmin
  );

  const datasetConfigured = await datasetFactory.configure(
    datasetAddress,
    await subscriptionManager.getAddress(),
    await distributionManager.getAddress(),
    await verifierManager.getAddress()
  );
  await datasetConfigured.wait();

  if (process.env.TEST !== 'true') await hre.run('etherscan-verify');
};

export default func;
func.tags = ['DatasetFactory'];
