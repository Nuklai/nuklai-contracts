import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
} from "@typechained";
import { expect } from "chai";
import { AddressLike, MaxUint256, Signer, parseUnits } from "ethers";
import { ethers, network } from "hardhat";
import { constants, signature } from "./utils";

describe("SubscriptionManager", () => {
  const datasetId = 1;

  let dataset: DatasetNFT;
  let fragmentImplementation: FragmentNFT;

  let admin: Signer;
  let subscriber: Signer;

  let datasetAddress: AddressLike;
  let adminAddress: AddressLike;
  let fragmentImplementationAddress: AddressLike;

  let datasetSubscriptionManager: ERC20LinearSingleDatasetSubscriptionManager;
  let datasetSubscriptionManagerAddress: AddressLike;

  let datasetDistributionManager: DistributionManager;
  let datasetDistributionManagerAddress: AddressLike;

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

  it("Should set ERC-20 token fee amount for data set subscription", async function () {
    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();

    const feeAmount = parseUnits("0.0000001", 18);

    await datasetSubscriptionManager.setFee(tokenAddress, feeAmount);

    expect(await datasetSubscriptionManager.token()).to.equal(tokenAddress);
    expect(await datasetSubscriptionManager.feePerConsumerPerSecond()).to.equal(
      feeAmount
    );
  });

  it("Should calculate fees for data set subscription (one week and 1 consumer)", async function () {
    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();

    const feeAmount = parseUnits("0.0000001", 18);

    await datasetSubscriptionManager.setFee(tokenAddress, feeAmount);

    const consumers = 1;

    const [subscriptionFeeToken, subscriptionFeeAmount] =
      await datasetSubscriptionManager.subscriptionFee(
        datasetId,
        constants.ONE_WEEK,
        consumers
      );

    const feePerConsumerPerSecond =
      await datasetSubscriptionManager.feePerConsumerPerSecond();

    expect(subscriptionFeeToken).to.equal(tokenAddress);
    expect(Number(subscriptionFeeAmount)).to.equal(
      Number(feePerConsumerPerSecond) * constants.ONE_WEEK * consumers
    );
  });

  it("Should user pay data set subscription with ERC-20 token - data set admin received payment", async function () {
    await datasetDistributionManager.setDatasetOwnerPercentage(
      ethers.parseUnits("0.01", 18)
    );

    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();
    await token
      .connect(subscriber)
      .approve(datasetSubscriptionManagerAddress, MaxUint256);

    const feeAmount = parseUnits("0.0000001", 18);

    await datasetSubscriptionManager.setFee(tokenAddress, feeAmount);

    const subscriptionStart = Date.now();

    const datasetOwner = await dataset.ownerOf(datasetId);

    await expect(
      datasetSubscriptionManager
        .connect(subscriber)
        .subscribe(datasetId, subscriptionStart, constants.ONE_DAY, 1)
    )
      .to.emit(datasetDistributionManager, "PayoutSent")
      .withArgs(datasetOwner, tokenAddress, "86400000000000")
      .to.emit(datasetSubscriptionManager, "SubscriptionPaid");
  });

  it("Should revert pay data set subscription with ERC-20 token if there is no enough allowance", async function () {
    await datasetDistributionManager.setDatasetOwnerPercentage(
      ethers.parseUnits("0.01", 18)
    );

    const token = await ethers.deployContract("TestToken", subscriber);
    const tokenAddress = await token.getAddress();

    const feeAmount = parseUnits("0.0000001", 18);

    await datasetSubscriptionManager.setFee(tokenAddress, feeAmount);

    const subscriptionStart = Date.now();

    await expect(
      datasetSubscriptionManager
        .connect(subscriber)
        .subscribe(datasetId, subscriptionStart, constants.ONE_DAY, 1)
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  describe("On Subscription", () => {
    const subscriptionId = 1;

    let consumer: Signer;
    let secondConsumer: Signer;

    beforeEach(async () => {
      await datasetDistributionManager.setDatasetOwnerPercentage(
        ethers.parseUnits("0.01", 18)
      );

      const token = await ethers.deployContract("TestToken", subscriber);
      const tokenAddress = await token.getAddress();
      await token
        .connect(subscriber)
        .approve(datasetSubscriptionManagerAddress, MaxUint256);

      const feeAmount = parseUnits("0.0000001", 18);

      await datasetSubscriptionManager.setFee(tokenAddress, feeAmount);

      const subscriptionStart = Date.now();
      const consumers = 1;
      consumer = (await ethers.getSigners())[2];
      secondConsumer = (await ethers.getSigners())[3];

      await datasetSubscriptionManager
        .connect(subscriber)
        .subscribe(datasetId, subscriptionStart, constants.ONE_DAY, consumers);
    });

    it("Should subscription owner add consumers to the subscription", async () => {
      const consumerAddress = await consumer.getAddress();

      await datasetSubscriptionManager
        .connect(subscriber)
        .addConsumers(subscriptionId, [consumerAddress]);

      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumerAddress
        )
      ).to.be.true;
    });

    it("Should revert add consumers to the subscription if not the subscription owner", async () => {
      const consumerAddress = await consumer.getAddress();

      await expect(
        datasetSubscriptionManager.addConsumers(subscriptionId, [
          consumerAddress,
        ])
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should revert add consumers to the subscription with wrong id", async function () {
      const wrongSubscriptionId = 112313;
      const consumerAddress = await consumer.getAddress();

      await expect(
        datasetSubscriptionManager
          .connect(subscriber)
          .addConsumers(wrongSubscriptionId, [consumerAddress])
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("Should revert add consumers if more consumers are added than set", async function () {
      const consumerAddress = await consumer.getAddress();

      await expect(
        datasetSubscriptionManager
          .connect(subscriber)
          .addConsumers(subscriptionId, [consumerAddress, consumerAddress])
      ).to.be.revertedWith("Too many consumers to add");
    });

    it("Should subscription owner remove consumers to the subscription", async () => {
      const consumerAddress = await consumer.getAddress();

      await datasetSubscriptionManager
        .connect(subscriber)
        .addConsumers(subscriptionId, [consumerAddress]);

      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumerAddress
        )
      ).to.be.true;

      await datasetSubscriptionManager
        .connect(subscriber)
        .removeConsumers(subscriptionId, [consumerAddress]);

      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumerAddress
        )
      ).to.be.false;
    });

    it("Should subscription owner remove consumers to the subscription", async () => {
      const consumerAddress = await consumer.getAddress();

      await expect(
        datasetSubscriptionManager.removeConsumers(subscriptionId, [
          consumerAddress,
        ])
      ).to.be.rejectedWith("Not a subscription owner");
    });

    it("Should subscription owner replace consumers to the subscription", async () => {
      const consumerAddress = await consumer.getAddress();
      const secondConsumerAddress = await secondConsumer.getAddress();

      await datasetSubscriptionManager
        .connect(subscriber)
        .addConsumers(subscriptionId, [consumerAddress]);

      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumerAddress
        )
      ).to.be.true;
      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          secondConsumerAddress
        )
      ).to.be.false;

      await datasetSubscriptionManager
        .connect(subscriber)
        .replaceConsumers(
          subscriptionId,
          [consumerAddress],
          [secondConsumerAddress]
        );

      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumerAddress
        )
      ).to.be.false;
      expect(
        await datasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          secondConsumerAddress
        )
      ).to.be.true;
    });

    it("Should subscription be paid if consumer was added", async function () {
      const consumerAddress = await consumer.getAddress();

      await datasetSubscriptionManager
        .connect(subscriber)
        .addConsumers(subscriptionId, [consumerAddress]);

      expect(
        await datasetSubscriptionManager
          .connect(subscriber)
          .isSubscriptionPaidFor(datasetId, consumerAddress)
      ).to.be.true;
    });

    it("Should subscription not be paid if consumer was not added", async function () {
      const consumerAddress = await consumer.getAddress();

      expect(
        await datasetSubscriptionManager
          .connect(subscriber)
          .isSubscriptionPaidFor(datasetId, consumerAddress)
      ).to.be.false;
    });

    it("Should subscriber extends his subscription if expired", async () => {
      await time.increase(constants.ONE_DAY * 3);

      await expect(
        datasetSubscriptionManager
          .connect(subscriber)
          .extendSubscription(subscriptionId, constants.ONE_WEEK, 0)
      ).to.emit(datasetSubscriptionManager, "SubscriptionPaid");
    });

    it("Should subscriber extends his subscription if not expired", async () => {
      await expect(
        datasetSubscriptionManager
          .connect(subscriber)
          .extendSubscription(subscriptionId, constants.ONE_WEEK, 0)
      ).to.emit(datasetSubscriptionManager, "SubscriptionPaid");
    });

    it("Should revert if subscriber tries to extend a wrong subscription", async () => {
      const wrongSubscriptionId = 112313;

      await expect(
        datasetSubscriptionManager
          .connect(subscriber)
          .extendSubscription(wrongSubscriptionId, constants.ONE_WEEK, 0)
      ).to.be.revertedWith("ERC721: invalid token ID");
    });
  });
});
