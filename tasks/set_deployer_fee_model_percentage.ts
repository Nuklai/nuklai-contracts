import { DatasetNFT } from "@typechained";
import { Addressable, parseUnits } from "ethers";
import { constants } from "../utils";

interface TaskArgs {
  pk: string;
  contractAddress: Addressable;
  models: string;
  percentages: string;
}

task(
  "set-deploy-fee-model-percentage",
  "Sets the deployer fee models percentages"
)
  .addParam("pk", "Signer private key with ADMIN_ROLE")
  .addParam("contractAddress", "Address of the DatasetNFT contract")
  .addParam("models", "Deployer fee models, separated by commas (1,2,3)")
  .addParam(
    "percentages",
    "Percentages of the deployer fee models, separated by commas (0.1,0.5,0.6)"
  )
  .setAction(async (taskArgs: TaskArgs) => {
    const wallet = new ethers.Wallet(taskArgs.pk, ethers.provider);

    const dataset = (await ethers.getContractAt(
      "DatasetNFT",
      taskArgs.contractAddress,
      wallet
    )) as unknown as DatasetNFT;

    const models = taskArgs.models.split(",");
    const percentages = taskArgs.percentages
      .split(",")
      .map((percentage) => parseUnits(String(percentage), 18));

    if (models.length !== percentages.length)
      throw new Error("args length mistmatch");

    console.log("Setting deployer fee models percentages...");
    await dataset.setDeployerFeeModelPercentages(models, percentages);

    console.log(
      "No fee model percentage:",
      await dataset.deployerFeeModelPercentage(
        constants.DeployerFeeModel.NO_FEE
      )
    );
    console.log(
      "Dataset Owner Storage model percentage:",
      await dataset.deployerFeeModelPercentage(
        constants.DeployerFeeModel.DATASET_OWNER_STORAGE
      )
    );
    console.log(
      "Deployer Storage model percentage:",
      await dataset.deployerFeeModelPercentage(
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      )
    );
  });
