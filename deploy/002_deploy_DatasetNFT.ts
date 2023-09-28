import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { DatasetNFT } from '@typechained';
import { constants } from '../utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, fixture } = deployments;
  const { dtAdmin } = await getNamedAccounts();

  await fixture(['ProxyAdmin', 'FragmentNFT']);

  const proxyAdmin = await ethers.getContract('ProxyAdmin');
  const proxyAdminAddress = await proxyAdmin.getAddress();

  const fragmentImplementation = await ethers.getContract('FragmentNFT');
  const fragmentImplementationAddress = await fragmentImplementation.getAddress();

  console.log('ProxyAdmin: ', proxyAdminAddress);
  console.log('DT admin: ', dtAdmin);

  const deployedDatasetNFT = await deploy('DatasetNFT', {
    contract: 'DatasetNFT',
    from: dtAdmin,
    log: true,
    proxy: {
      owner: proxyAdminAddress,
      proxyContract: 'TransparentUpgradeableProxy',
      execute: {
        init: {
          methodName: 'initialize',
          args: [dtAdmin],
        },
      },
    },
  });

  console.log('DatasetNFT deployed successfully at', deployedDatasetNFT.address);

  const dataset: DatasetNFT = await ethers.getContractAtWithSignerAddress(
    'DatasetNFT',
    deployedDatasetNFT.address,
    dtAdmin
  );

  const fragmentImplementationSet = await dataset.setFragmentImplementation(
    fragmentImplementationAddress
  );
  await fragmentImplementationSet.wait();

  console.log('FragmentNFT Implementation sucessfully set', fragmentImplementationAddress);

  const proxyAdminSet = await dataset.setProxyAdminAddress(proxyAdminAddress);
  await proxyAdminSet.wait();

  console.log('ProxyAdmin address sucessfully set', proxyAdminAddress);

  const grantedRole = await dataset.grantRole(constants.SIGNER_ROLE, dtAdmin);
  await grantedRole.wait();

  console.log('DatasetNFT granted role to', dtAdmin);

  if (process.env.TEST !== 'true') await hre.run('etherscan-verify');
};

export default func;
func.tags = ['DatasetNFT'];
