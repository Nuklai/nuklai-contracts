import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { DatasetFactory, DatasetNFT } from '@typechained';
import { constants } from '../utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, fixture } = deployments;
  const { dtAdmin } = await getNamedAccounts();

  await fixture(['DatasetManagers', 'FragmentNFT']);

  console.log('DT admin: ', dtAdmin);

  const deployedDatasetFactory = await deploy('DatasetFactory', {
    from: dtAdmin,
  });

  console.log('DatasetFactory deployed successfully at', deployedDatasetFactory.address);

  const deployedDatasetNFT = await deploy('DatasetNFT', {
    contract: 'DatasetNFT',
    from: dtAdmin,
    log: true,
    proxy: {
      owner: dtAdmin,
      proxyContract: 'OptimizedTransparentProxy',
      execute: {
        init: {
          methodName: 'initialize',
          args: [dtAdmin],
        },
      },
    },
    nonce: 'pending',
    waitConfirmations: 1,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });

  console.log('DatasetNFT deployed successfully at', deployedDatasetNFT.address);

  const fragmentImplementation = await ethers.getContract('FragmentNFT');

  const dataset: DatasetNFT = await ethers.getContractAtWithSignerAddress(
    'DatasetNFT',
    deployedDatasetNFT.address,
    dtAdmin
  );

  const fragmentImplementationSet = await dataset.setFragmentImplementation(
    await fragmentImplementation.getAddress()
  );
  await fragmentImplementationSet.wait();

  const grantedRole = await dataset.grantRole(constants.SIGNER_ROLE, dtAdmin);
  await grantedRole.wait();

  console.log('DatasetNFT granted role to', dtAdmin);

  const subscriptionManager = await ethers.getContract('ERC20SubscriptionManager');
  const distributionManager = await ethers.getContract('DistributionManager');
  const verifierManager = await ethers.getContract('VerifierManager');

  const datasetFactory: DatasetFactory = await ethers.getContractAtWithSignerAddress(
    'DatasetFactory',
    deployedDatasetFactory.address,
    dtAdmin
  );

  const datasetConfigured = await datasetFactory.configure(
    deployedDatasetNFT.address,
    await subscriptionManager.getAddress(),
    await distributionManager.getAddress(),
    await verifierManager.getAddress()
  );
  await datasetConfigured.wait();

  if (process.env.TEST !== 'true') await hre.run('etherscan-verify');
};

export default func;
func.tags = ['DatasetFactory'];
