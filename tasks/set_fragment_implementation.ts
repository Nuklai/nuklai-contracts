import { DatasetNFT } from "@typechained";
import { Addressable } from "ethers";

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  fragment: Addressable;
}

task("set-fragment-implementation", "Sets the fragment implementation for a data set contract")
  .addParam("pk", "Signer private key with ADMIN_ROLE")
  .addParam("contractAddress", "Address of the DatasetNFT contract")
  .addParam("fragment", "Address of the fragment implementation")
  .setAction(async (taskArgs: TaskArgs) => {
    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      "DatasetNFT",
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    if (!taskArgs.fragment) throw new Error("No fragment implementation address set");

    console.log("Setting deployer fee beneficiary...");
    await dataset.setFragmentImplementation(taskArgs.fragment);

    const fragment = await dataset.fragmentImplementation();

    console.log("fragment implementation was set successfully", fragment);
  });