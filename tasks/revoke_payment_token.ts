import { DatasetNFT } from '../typechain-types';
import { Addressable } from 'ethers';
import {APPROVED_TOKEN_ROLE} from '../utils/constants';
import { task } from 'hardhat/config';

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  tokenAddress: Addressable;
}

task('revoke_payment_token', 'Revokes approval for a specific token')
  .addParam('pk', 'Signer private key with ADMIN_ROLE')
  .addParam('contractAddress', 'Address of the DatasetNFT contract')
  .addParam('tokenAddress', 'Address of the token to revoke approval for')
  .setAction(async (taskArgs: TaskArgs) => {
    if (!taskArgs.contractAddress || !taskArgs.tokenAddress) throw new Error('No address provided');

    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      'DatasetNFT',
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    console.log('Revoking approval for token', taskArgs.tokenAddress);
    await (await dataset.revokeRole(APPROVED_TOKEN_ROLE, taskArgs.tokenAddress)).wait();

    console.log('Token', taskArgs.tokenAddress, 'successfully revoked');
  });
