import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { TestToken } from '@typechained';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy } = deployments;

  const { dtAdmin } = await getNamedAccounts();

  const deployedTestToken = await deploy('TestToken', {
    from: dtAdmin,
  });

  console.log('TestToken deployed successfully at', deployedTestToken.address);

  const token: TestToken = await ethers.getContractAtWithSignerAddress(
    'TestToken',
    deployedTestToken.address,
    dtAdmin
  );

  const tokenDecimals = await token.decimals();
  const amountToMint = ethers.parseUnits('1000000000', tokenDecimals);

  await token.mint(dtAdmin, amountToMint);

  console.log(
    'TestToken minted successfully to wallet address',
    dtAdmin,
    'with',
    ethers.formatUnits(amountToMint, tokenDecimals)
  );
};

export default func;
func.tags = ['TestToken'];
