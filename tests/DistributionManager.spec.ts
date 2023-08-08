import {
  AcceptManuallyVerifier,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  TestToken,
  VerifierManager,
} from "@typechained";
import { MaxUint256, parseUnits } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { expect } from "chai";
import { v4 as uuidv4 } from "uuid";
import { constants, signature, utils } from "./utils";

const setup = async () => {
  await deployments.fixture(["DatasetNFT"]);

  const contracts = {
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract(
      "FragmentNFT"
    )) as FragmentNFT,
  };

  const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
  const datasetId = 1;
  const fragmentId = 1;

  const datasetAddress = await contracts.DatasetNFT.getAddress();

  const signedMessage = await dtAdmin.signMessage(
    signature.getDatasetMintMessage(
      network.config.chainId!,
      datasetAddress,
      datasetId,
      datasetOwner.address
    )
  );

  const datasetUUID = uuidv4();

  await contracts.DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetId, datasetUUID);

  await contracts.DatasetNFT.connect(datasetOwner).mint(
    datasetId,
    datasetOwner.address,
    signedMessage
  );

  await contracts.DatasetNFT.connect(datasetOwner).deployFragmentInstance(
    datasetId
  );

  const factories = {
    DistributionManagerFactory: await ethers.getContractFactory(
      "DistributionManager"
    ),
    ERC20SubscriptionManagerFactory: await ethers.getContractFactory(
      "ERC20LinearSingleDatasetSubscriptionManager"
    ),
    VerifierManagerFactory: await ethers.getContractFactory("VerifierManager"),
    AcceptManuallyVerifierFactory: await ethers.getContractFactory(
      "AcceptManuallyVerifier"
    ),
    AcceptAllVerifierFactory: await ethers.getContractFactory(
      "AcceptAllVerifier"
    ),
  };

  const SubscriptionManager =
    await factories.ERC20SubscriptionManagerFactory.connect(
      datasetOwner
    ).deploy();
  const DistributionManager =
    await factories.DistributionManagerFactory.connect(datasetOwner).deploy();
  const VerifierManager = await factories.VerifierManagerFactory.connect(
    datasetOwner
  ).deploy();

  await contracts.DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
    subscriptionManager: await SubscriptionManager.getAddress(),
    distributionManager: await DistributionManager.getAddress(),
    verifierManager: await VerifierManager.getAddress(),
  });

  return {
    datasetId,
    fragmentId,
    DatasetSubscriptionManager: (await ethers.getContractAt(
      "ERC20LinearSingleDatasetSubscriptionManager",
      await contracts.DatasetNFT.subscriptionManager(datasetId)
    )) as unknown as ERC20LinearSingleDatasetSubscriptionManager,
    DatasetDistributionManager: (await ethers.getContractAt(
      "DistributionManager",
      await contracts.DatasetNFT.distributionManager(datasetId),
      datasetOwner
    )) as unknown as DistributionManager,
    DatasetVerifierManager: (await ethers.getContractAt(
      "VerifierManager",
      await contracts.DatasetNFT.verifierManager(datasetId),
      datasetOwner
    )) as unknown as VerifierManager,
    ...contracts,
    ...factories,
  };
};

describe("DistributionManager", () => {
  it("Should data set owner set its percentage to be sent on each payment", async function () {
    const { DatasetDistributionManager } = await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const percentage = parseUnits("0.01", 18);

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(percentage);

    expect(await DatasetDistributionManager.datasetOwnerPercentage()).to.equal(
      percentage
    );
  });

  it("Should revert if data set owner percentage set is higher than 100%", async function () {
    const { DatasetDistributionManager } = await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const percentage = parseUnits("1.01", 18);

    await expect(
      DatasetDistributionManager.connect(
        datasetOwner
      ).setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Can't be higher than 100%");
  });

  it("Should revert set percentage if sender is not the data set owner", async function () {
    const { DatasetDistributionManager } = await setup();
    const { user } = await ethers.getNamedSigners();

    const percentage = parseUnits("1.01", 18);

    await expect(
      (DatasetDistributionManager as unknown as DistributionManager)
        .connect(user)
        .setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Not a Dataset owner");
  });

  it("Should data set owner set data set tag weights", async function () {
    const { DatasetDistributionManager } = await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    await DatasetDistributionManager.connect(datasetOwner).setTagWeights(
      [datasetSchemasTag, datasetRowsTag],
      [parseUnits("0.4", 18), parseUnits("0.6", 18)]
    );
  });

  it("Should revert set tag weights if weights sum is not equal to 100%", async function () {
    const { DatasetDistributionManager } = await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    await expect(
      DatasetDistributionManager.connect(datasetOwner).setTagWeights(
        [datasetSchemasTag, datasetRowsTag],
        [parseUnits("0.4", 18), parseUnits("0.8", 18)]
      )
    ).to.be.revertedWith("Invalid weights summ");
  });

  it("Should contributor claim revenue", async function () {
    const {
      DatasetDistributionManager,
      DatasetSubscriptionManager,
      DatasetVerifierManager,
      AcceptManuallyVerifierFactory,
      DatasetNFT,
      datasetId,
      fragmentId,
    } = await setup();
    const { datasetOwner, dtAdmin, contributor, subscriber } =
      await ethers.getNamedSigners();

    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    const DeployedAcceptManuallyVerifier =
      await AcceptManuallyVerifierFactory.connect(datasetOwner).deploy();

    DatasetVerifierManager.setDefaultVerifier(
      await DeployedAcceptManuallyVerifier.getAddress()
    );

    const proposeSignatureSchemas = await dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT.getAddress(),
        datasetId,
        fragmentId,
        contributor.address,
        datasetSchemasTag
      )
    );

    await DatasetNFT.connect(contributor).proposeFragment(
      datasetId,
      fragmentId,
      contributor.address,
      datasetSchemasTag,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT.fragments(datasetId);

    const AcceptManuallyVerifier = (await ethers.getContractAt(
      "AcceptManuallyVerifier",
      await DeployedAcceptManuallyVerifier.getAddress()
    )) as unknown as AcceptManuallyVerifier;

    await AcceptManuallyVerifier.connect(datasetOwner).resolve(
      datasetFragmentAddress,
      fragmentId,
      true
    );

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const DeployedToken = await deployments.deploy("TestToken", {
      from: subscriber.address,
    });

    const Token = (await ethers.getContractAt(
      "TestToken",
      DeployedToken.address
    )) as unknown as TestToken;

    await Token.connect(subscriber).approve(
      await DatasetSubscriptionManager.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager.connect(datasetOwner).setTagWeights(
      [datasetSchemasTag, datasetRowsTag],
      [parseUnits("0.4", 18), parseUnits("0.6", 18)]
    );

    const feeAmount = parseUnits("0.1", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const subscriptionStart = Date.now();

    await DatasetSubscriptionManager.connect(subscriber).subscribe(
      datasetId,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    await expect(DatasetDistributionManager.connect(contributor).claimPayouts())
      .to.emit(DatasetDistributionManager, "PayoutSent")
      .withArgs(
        contributor.address,
        DeployedToken.address,
        parseUnits("24167.808", 18)
      );
  });
});
