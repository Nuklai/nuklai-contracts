import {
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
} from "@typechained";
import { AddressLike, MaxUint256, Signer, parseUnits } from "ethers";
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { constants, signature, utils } from "./utils";

describe("DistributionManager", () => {
  const datasetId = 1;
  const fragmentId = 1;

  let dataset: DatasetNFT;
  let fragmentImplementation: FragmentNFT;

  let admin: Signer;
  let user: Signer;
  let subscriber: Signer;

  let datasetDistributionManager: DistributionManager;
  let datasetSubscriptionManager: ERC20LinearSingleDatasetSubscriptionManager;

  let datasetAddress: AddressLike;
  let adminAddress: AddressLike;
  let userAddress: AddressLike;
  let fragmentImplementationAddress: AddressLike;
  let datasetDistributionManagerAddress: AddressLike;
  let datasetSubscriptionManagerAddress: AddressLike;

  beforeEach(async () => {
    dataset = await ethers.deployContract("DatasetNFT");
    fragmentImplementation = await ethers.deployContract("FragmentNFT");

    admin = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    subscriber = (await ethers.getSigners())[2];

    adminAddress = await admin.getAddress();
    userAddress = await user.getAddress();

    await dataset.grantRole(constants.SIGNER_ROLE, adminAddress);

    datasetAddress = await dataset.getAddress();

    fragmentImplementationAddress = await fragmentImplementation.getAddress();
    await dataset.setFragmentImplementation(fragmentImplementationAddress);

    const signedMessage = await admin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        adminAddress
      )
    );

    await dataset.mint(datasetId, adminAddress, signedMessage);

    await dataset.deployFragmentInstance(datasetId);

    const subscriptionManager = await ethers.deployContract(
      "ERC20LinearSingleDatasetSubscriptionManager"
    );
    const distributionManager = await ethers.deployContract(
      "DistributionManager"
    );
    const verifierManager = await ethers.deployContract("VerifierManager");
    await dataset.setManagers(datasetId, {
      subscriptionManager,
      distributionManager,
      verifierManager,
    });

    datasetSubscriptionManagerAddress = await dataset.subscriptionManager(
      datasetId
    );
    datasetSubscriptionManager = await ethers.getContractAt(
      "ERC20LinearSingleDatasetSubscriptionManager",
      datasetSubscriptionManagerAddress
    );

    datasetDistributionManagerAddress = await dataset.distributionManager(
      datasetId
    );
    datasetDistributionManager = await ethers.getContractAt(
      "DistributionManager",
      datasetDistributionManagerAddress
    );
  });

  it("Should set data set owner percentage to be sent on each payment", async function () {
    const percentage = parseUnits("0.01", 18);

    await datasetDistributionManager.setDatasetOwnerPercentage(percentage);

    expect(await datasetDistributionManager.datasetOwnerPercentage()).to.equal(
      percentage
    );
  });

  it("Should revert if data set owner percentage set is higher than 100%", async function () {
    const percentage = parseUnits("1.01", 18);

    await expect(
      datasetDistributionManager.setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Can't be higher than 100%");
  });

  it("Should revert set percentage if sender is not the data set owner", async function () {
    const percentage = parseUnits("1.01", 18);

    await expect(
      datasetDistributionManager
        .connect(user)
        .setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Not a Dataset owner");
  });

  it("Should set data set tag weights", async function () {
    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    await datasetDistributionManager.setTagWeights(
      [datasetSchemasTag, datasetRowsTag],
      [parseUnits("0.4", 18), parseUnits("0.6", 18)]
    );
  });

  it("Should revert set tag weights if weights sum is not equal to 100%", async function () {
    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    await expect(
      datasetDistributionManager.setTagWeights(
        [datasetSchemasTag, datasetRowsTag],
        [parseUnits("0.4", 18), parseUnits("0.8", 18)]
      )
    ).to.be.revertedWith("Invalid weights summ");
  });

  it("Should user claim revenue", async function () {
    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    const manuallyVerifierManager = await ethers.deployContract(
      "AcceptManuallyVerifier"
    );

    const manuallyVerifierAddress = await manuallyVerifierManager.getAddress();

    const verifierManagerAddress = await dataset.verifierManager(datasetId);

    const verifier = await ethers.getContractAt(
      "VerifierManager",
      verifierManagerAddress
    );

    verifier.setTagVerifier(datasetSchemasTag, manuallyVerifierAddress);

    const proposeSignatureSchemas = await admin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        fragmentId,
        userAddress,
        datasetSchemasTag
      )
    );
    
    await dataset
      .connect(user)
      .proposeFragment(
        datasetId,
        fragmentId,
        userAddress,
        datasetSchemasTag,
        proposeSignatureSchemas
      );

    const fragmentAddress = await dataset.fragments(datasetId);

    await manuallyVerifierManager.resolve(fragmentAddress, fragmentId, true);

    await datasetDistributionManager.setDatasetOwnerPercentage(
      ethers.parseUnits("0.001", 18)
    );

    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();
    await token
      .connect(subscriber)
      .approve(datasetSubscriptionManager, MaxUint256);

    await datasetDistributionManager.setTagWeights(
      [datasetSchemasTag, datasetRowsTag],
      [parseUnits("0.4", 18), parseUnits("0.6", 18)]
    );

    const feeAmount = parseUnits("0.1", 18);

    await datasetSubscriptionManager.setFee(tokenAddress, feeAmount);

    const subscriptionStart = Date.now();

    await datasetSubscriptionManager
      .connect(subscriber)
      .subscribe(datasetId, subscriptionStart, constants.ONE_WEEK, 1);

    await expect(datasetDistributionManager.connect(user).claimPayouts())
      .to.emit(datasetDistributionManager, "PayoutSent")
      .withArgs(userAddress, tokenAddress, "24167808000000000000000");
  });
});
