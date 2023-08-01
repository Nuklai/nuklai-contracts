import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  AcceptManuallyVerifier,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
} from "@typechained";
import { expect } from "chai";
import {
  AddressLike,
  BytesLike,
  MaxUint256,
  Signer,
  ZeroAddress,
  parseUnits,
} from "ethers";
import { ethers, network } from "hardhat";
import { constants, signature } from "./utils";

describe("SubscriptionManager", () => {
  const datasetId = 1;

  const ONE_DAY = 60 * 60 * 24;
  const ONE_WEEK = 60 * 60 * 24 * 7;

  let dataset: DatasetNFT;
  let fragmentImplementation: FragmentNFT;

  let admin: Signer;
  let subscriber: Signer;

  let datasetAddress: AddressLike;
  let adminAddress: AddressLike;
  let fragmentImplementationAddress: AddressLike;

  let subscriptionManager: ERC20LinearSingleDatasetSubscriptionManager;
  let subscriptionManagerAddress: AddressLike;

  let distributionManager: DistributionManager;
  let distributionManagerAddress: AddressLike;

  beforeEach(async () => {
    dataset = await ethers.deployContract("DatasetNFT");
    fragmentImplementation = await ethers.deployContract("FragmentNFT");

    admin = (await ethers.getSigners())[0];
    adminAddress = await admin.getAddress();
    subscriber = (await ethers.getSigners())[1];

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

    const subscriptionManager_ = await ethers.deployContract(
      "ERC20LinearSingleDatasetSubscriptionManager"
    );
    const distributionManager_ = await ethers.deployContract(
      "DistributionManager"
    );
    const verifierManager = await ethers.deployContract("VerifierManager");
    await dataset.setManagers(datasetId, {
      subscriptionManager: subscriptionManager_,
      distributionManager: distributionManager_,
      verifierManager,
    });

    subscriptionManagerAddress = await dataset.subscriptionManager(datasetId);
    subscriptionManager = await ethers.getContractAt(
      "ERC20LinearSingleDatasetSubscriptionManager",
      subscriptionManagerAddress
    );

    distributionManagerAddress = await dataset.distributionManager(datasetId);
    distributionManager = await ethers.getContractAt(
      "DistributionManager",
      distributionManagerAddress
    );
  });

  it("Should set ERC-20 token fee amount for data set subscription", async function () {
    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();
    await token
      .connect(subscriber)
      .approve(subscriptionManagerAddress, MaxUint256);

    const feeAmount = parseUnits("0.0000001", 18);

    await subscriptionManager.setFee(tokenAddress, feeAmount);

    expect(await subscriptionManager.token()).to.equal(tokenAddress);
    expect(await subscriptionManager.feePerConsumerPerSecond()).to.equal(
      feeAmount
    );
  });

  it("Should calculate fees for data set subscription (one week and 1 consumer)", async function () {
    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();
    await token
      .connect(subscriber)
      .approve(subscriptionManagerAddress, MaxUint256);

    const feeAmount = parseUnits("0.0000001", 18);

    await subscriptionManager.setFee(tokenAddress, feeAmount);

    const consumers = 1;

    const [subscriptionFeeToken, subscriptionFeeAmount] =
      await subscriptionManager.subscriptionFee(datasetId, ONE_WEEK, consumers);

    const feePerConsumerPerSecond =
      await subscriptionManager.feePerConsumerPerSecond();

    expect(subscriptionFeeToken).to.equal(tokenAddress);
    expect(Number(subscriptionFeeAmount)).to.equal(
      Number(feePerConsumerPerSecond) * ONE_WEEK * consumers
    );
  });

  it("Should pay data set subscription with ERC-20 token", async function () {
    await distributionManager.setDatasetOwnerPercentage(
      ethers.parseUnits("0.01", 18)
    );

    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();
    await token
      .connect(subscriber)
      .approve(subscriptionManagerAddress, MaxUint256);

    const feeAmount = parseUnits("0.0000001", 18);

    await subscriptionManager.setFee(tokenAddress, feeAmount);

    const subscriptionStart = Date.now();

    await expect(
      subscriptionManager
        .connect(subscriber)
        .subscribe(datasetId, subscriptionStart, ONE_DAY, 1)
    ).to.emit(subscriptionManager, "SubscriptionPaid");
  });

  describe("On Subscription", () => {
    const subscriptionId = 1;

    let consumer: Signer;

    beforeEach(async () => {
      await distributionManager.setDatasetOwnerPercentage(
        ethers.parseUnits("0.01", 18)
      );

      const token = await ethers.deployContract("TestToken", subscriber);
      const tokenAddress = await token.getAddress();
      await token
        .connect(subscriber)
        .approve(subscriptionManagerAddress, MaxUint256);

      const feeAmount = parseUnits("0.0000001", 18);

      await subscriptionManager.setFee(tokenAddress, feeAmount);

      const subscriptionStart = Date.now();
      const consumers = 1;
      consumer = (await ethers.getSigners())[2];

      await subscriptionManager
        .connect(subscriber)
        .subscribe(datasetId, subscriptionStart, ONE_DAY, consumers);
    });

    it("Should add consumers to the subscription", async () => {
      const consumerAddress = await consumer.getAddress();

      await subscriptionManager
        .connect(subscriber)
        .addConsumers(subscriptionId, [consumerAddress]);
    });

    it("Should revert add consumers to the subscription with wrong id", async function () {
      const wrongSubscriptionId = 112313;
      const consumerAddress = await consumer.getAddress();

      await expect(
        subscriptionManager
          .connect(subscriber)
          .addConsumers(wrongSubscriptionId, [consumerAddress])
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("Should revert add consumers if more consumers are added than set", async function () {
      const consumerAddress = await consumer.getAddress();

      await expect(
        subscriptionManager
          .connect(subscriber)
          .addConsumers(subscriptionId, [consumerAddress, consumerAddress])
      ).to.be.revertedWith("Too many consumers to add");
    });

    it("Should subscription be paid if consumer was added", async function () {
      const consumerAddress = await consumer.getAddress();

      await subscriptionManager
        .connect(subscriber)
        .addConsumers(subscriptionId, [consumerAddress]);

      expect(
        await subscriptionManager
          .connect(subscriber)
          .isSubscriptionPaidFor(datasetId, consumerAddress)
      ).to.be.true;
    });

    it("Should subscription not be paid if consumer was not added", async function () {
      const consumerAddress = await consumer.getAddress();

      expect(
        await subscriptionManager
          .connect(subscriber)
          .isSubscriptionPaidFor(datasetId, consumerAddress)
      ).to.be.false;
    });

    it("Should subscriber extends his subscription if expired", async () => {
      await time.increase(ONE_DAY * 3);

      await expect(
        subscriptionManager
          .connect(subscriber)
          .extendSubscription(subscriptionId, ONE_WEEK, 0)
      ).to.emit(subscriptionManager, "SubscriptionPaid");
    });

    it("Should subscriber extends his subscription if not expired", async () => {
      await expect(
        subscriptionManager
          .connect(subscriber)
          .extendSubscription(subscriptionId, ONE_WEEK, 0)
      ).to.emit(subscriptionManager, "SubscriptionPaid");
    });

    it("Should revert if subscriber tries to extend a wrong subscription", async () => {
      const wrongSubscriptionId = 112313;

      await expect(
        subscriptionManager
          .connect(subscriber)
          .extendSubscription(wrongSubscriptionId, ONE_WEEK, 0)
      ).to.be.revertedWith("ERC721: invalid token ID");
    });
  });
});
