import { DatasetNFT } from '../typechain-types';
import { Addressable } from 'ethers';
import { task } from 'hardhat/config';

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  beneficiary: Addressable;
}

task('set-deploy-fee-beneficiary', 'Sets the deployer fee beneficiary address')
  .addParam('pk', 'Signer private key with ADMIN_ROLE')
  .addParam('contractAddress', 'Address of the DatasetNFT contract')
  .addParam('beneficiary', 'Address of the beneficiary wallet')
  .setAction(async (taskArgs: TaskArgs) => {
    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      'DatasetNFT',
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    if (!taskArgs.beneficiary) throw new Error('No beneficiary set');

    console.log('Setting deployer fee beneficiary...');
    await (await dataset.setDeployerFeeBeneficiary(taskArgs.beneficiary)).wait();

    const beneficiary = await dataset.deployerFeeBeneficiary();

    console.log('beneficiary was set successfully', beneficiary);
  });
