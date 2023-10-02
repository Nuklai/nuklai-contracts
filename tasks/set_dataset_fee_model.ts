import { DatasetNFT } from '@typechained';
import { Addressable } from 'ethers';

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  datasetId: string;
  model: number;
}

task('set_dataset_fee_model', 'Sets the deployer fee model to a data set')
  .addParam('pk', 'Signer private key with ADMIN_ROLE')
  .addParam('contractAddress', 'Address of the DatasetNFT contract')
  .addParam('datasetId', 'Id of the data set')
  .addParam('model', 'Deployer fee model to be set')
  .setAction(async (taskArgs: TaskArgs) => {
    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      'DatasetNFT',
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    if (!taskArgs.datasetId || !taskArgs.model) throw new Error('No datasetId or model set');

    console.log('Setting deployer fee model', taskArgs.model, 'to data set', taskArgs.datasetId);
    await (await dataset.setDeployerFeeModel(taskArgs.datasetId, taskArgs.model)).wait();

    console.log('Deployer fee model', taskArgs.model, 'set successfully to', taskArgs.datasetId);
  });
