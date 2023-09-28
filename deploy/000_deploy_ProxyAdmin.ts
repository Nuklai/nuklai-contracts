import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { dtAdmin } = await getNamedAccounts();

  const deployedProxyAdmin = await deploy('ProxyAdmin', {
    from: dtAdmin,
  });

  console.log('ProxyAdmin deployed successfully at', deployedProxyAdmin.address);

  if (process.env.TEST !== 'true') await hre.run('etherscan-verify');
};

export default func;
func.tags = ['ProxyAdmin'];
