import { DatasetNFT } from "@typechained";
import { Addressable } from "ethers";

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  beneficiary: Addressable;
}

task("set-deploy-fee-beneficiary", "Sets the deployer fee beneficiary address")
  .addParam("pk", "Signer private key with ADMIN_ROLE")
  .addParam("contractAddress", "Address of the DatasetNFT contract")
  .addParam("beneficiary", "Address of the beneficiary wallet")
  .setAction(async (taskArgs: TaskArgs) => {
    console.log("taskArgs.beneficiary :>> ", taskArgs.beneficiary);
    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      "DatasetNFT",
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    if (!taskArgs.beneficiary) throw new Error("No beneficiary set");

    console.log("Setting deployer fee beneficiary...");
    await dataset.setDeployerFeeBeneficiary(taskArgs.beneficiary);

    const beneficiary = await dataset.deployerFeeBeneficiary();

    console.log("beneficiary was set successfully", beneficiary);
  });
