import { DatasetNFT } from '../typechain-types';
import { Addressable } from 'ethers';
import {APPROVED_TOKEN_ROLE} from '../utils/constants';
import { task } from 'hardhat/config';

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  tokenAddress: Addressable;
}

task('approve_payment_token', 'Approves a specific token for subscription fee payments')
  .addParam('pk', 'Signer private key with ADMIN_ROLE')
  .addParam('contractAddress', 'Address of the DatasetNFT contract')
  .addParam('tokenAddress', 'Address of the token to approve')
  .setAction(async (taskArgs: TaskArgs) => {
    if (!taskArgs.contractAddress || !taskArgs.tokenAddress) throw new Error('No address provided');

    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      'DatasetNFT',
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    console.log('Approving token', taskArgs.tokenAddress);
    await (await dataset.grantRole(APPROVED_TOKEN_ROLE, taskArgs.tokenAddress)).wait();

    console.log('Token', taskArgs.tokenAddress, 'successfully approved');
  });
