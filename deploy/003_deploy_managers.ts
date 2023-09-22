import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { dtAdmin } = await getNamedAccounts();

  const deployedErc20SubscriptionManager = await deploy(
    'ERC20LinearSingleDatasetSubscriptionManager',
    {
      from: dtAdmin,
    }
  );

  console.log(
    'ERC20LinearSingleDatasetSubscriptionManager deployed successfully at',
    deployedErc20SubscriptionManager.address
  );

  const deployedVerifierManager = await deploy('VerifierManager', {
    from: dtAdmin,
  });

  console.log('VerifierManager deployed successfully at', deployedVerifierManager.address);

  const deployedDistributionManager = await deploy('DistributionManager', {
    from: dtAdmin,
  });

  console.log('DistributionManager deployed successfully at', deployedDistributionManager.address);

  if (process.env.TEST !== 'true') await hre.run('etherscan-verify');
};

export default func;
func.tags = ['DatasetManagers'];
