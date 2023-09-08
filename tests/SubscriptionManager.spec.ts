import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DatasetFactory,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from "@typechained";
import { expect } from "chai";
import { MaxUint256, ZeroHash, parseUnits } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { v4 as uuidv4 } from "uuid";
import { constants, signature } from "./utils";
import { getEvent } from "./utils/events";
import { setupUsers, Signer } from "./utils/users";

const setup = async () => {
  await deployments.fixture(["DatasetFactory", "DatasetVerifiers"]);

  const contracts = {
    DatasetFactory: (await ethers.getContract(
      "DatasetFactory"
    )) as DatasetFactory,
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract(
      "FragmentNFT"
    )) as FragmentNFT,
  };

  const users = await setupUsers();

  const datasetUUID = uuidv4();

  const uuidSetTxReceipt = await (
    await contracts.DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(
      datasetUUID
    )
  ).wait();

  const [, datasetId] = getEvent(
    "DatasetUuidSet",
    uuidSetTxReceipt?.logs!,
    contracts.DatasetNFT
  )!.args as unknown as [string, bigint];

  const datasetAddress = await contracts.DatasetNFT.getAddress();
  const signedMessage = await users.dtAdmin.signMessage(
    signature.getDatasetMintMessage(
      network.config.chainId!,
      datasetAddress,
      datasetId
    )
  );
  const defaultVerifierAddress = await (
    await ethers.getContract("AcceptManuallyVerifier")
  ).getAddress();
  const feeAmount = parseUnits("0.1", 18);
  const dsOwnerPercentage = parseUnits("0.001", 18);

  await contracts.DatasetFactory.connect(
    users.datasetOwner
  ).mintAndConfigureDataset(
    users.datasetOwner.address,
    signedMessage,
    defaultVerifierAddress,
    await users.datasetOwner.Token!.getAddress(),
    feeAmount,
    dsOwnerPercentage,
    [ZeroHash],
    [parseUnits("1", 18)]
  );

  return {
    datasetId,
    users,
    DatasetSubscriptionManager: (await ethers.getContractAt(
      "ERC20LinearSingleDatasetSubscriptionManager",
      await contracts.DatasetNFT.subscriptionManager(datasetId)
    )) as unknown as ERC20LinearSingleDatasetSubscriptionManager,
    DatasetDistributionManager: (await ethers.getContractAt(
      "DistributionManager",
      await contracts.DatasetNFT.distributionManager(datasetId),
      users.datasetOwner
    )) as unknown as DistributionManager,
    DatasetVerifierManager: (await ethers.getContractAt(
      "VerifierManager",
      await contracts.DatasetNFT.verifierManager(datasetId),
      users.datasetOwner
    )) as unknown as VerifierManager,
    ...contracts,
  };
};

const setupOnSubscribe = async () => {
  const {
    DatasetSubscriptionManager,
    DatasetDistributionManager,
    datasetId,
    users,
  } = await setup();

  await DatasetDistributionManager.connect(users.datasetOwner).setTagWeights(
    [ZeroHash],
    [parseUnits("1", 18)]
  );

  await users.subscriber.Token!.approve(
    await DatasetSubscriptionManager.getAddress(),
    MaxUint256
  );

  await DatasetDistributionManager.connect(
    users.datasetOwner
  ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

  await DatasetDistributionManager.connect(
    users.datasetOwner
  ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

  const feeAmount = parseUnits("0.0000001", 18);

  await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
    await users.datasetOwner.Token!.getAddress(),
    feeAmount
  );

  const subscriptionStart =
    Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

  await DatasetSubscriptionManager.connect(users.subscriber).subscribe(
    datasetId,
    subscriptionStart,
    constants.ONE_DAY,
    1
  );

  const subscriptionId = await DatasetSubscriptionManager.tokenOfOwnerByIndex(
    users.subscriber.address,
    0
  );

  return {
    datasetId,
    subscriptionId,
    users,
    DatasetSubscriptionManager,
    DatasetDistributionManager,
  };
};

describe("SubscriptionManager", () => {
  let snap: string;
  let DatasetFactory_: DatasetFactory;
  let DatasetNFT_: DatasetNFT;
  let FragmentNFTImplementation_: FragmentNFT;
  let DatasetSubscriptionManager_: ERC20LinearSingleDatasetSubscriptionManager;
  let DatasetDistributionManager_: DistributionManager;
  let DatasetVerifierManager_: VerifierManager;
  let datasetId_: bigint;
  let users_: Record<string, Signer>;

  before(async () => {
    const {
      DatasetFactory,
      DatasetNFT,
      FragmentNFTImplementation,
      DatasetSubscriptionManager,
      DatasetDistributionManager,
      DatasetVerifierManager,
      datasetId,
      users
    } = await setup();

    DatasetFactory_ = DatasetFactory;
    DatasetNFT_ = DatasetNFT;
    FragmentNFTImplementation_ = FragmentNFTImplementation;
    DatasetSubscriptionManager_ = DatasetSubscriptionManager;
    DatasetDistributionManager_ = DatasetDistributionManager;
    DatasetVerifierManager_ = DatasetVerifierManager;
    datasetId_ = datasetId;
    users_ = users;
  });

  beforeEach(async () => {
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
  });

  it("Should data set owner set ERC-20 token fee amount for data set subscription", async function () {
    const DeployedToken = await deployments.deploy("TestToken_new", {
      contract: "TestToken",
      from: users_.subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    expect(await DatasetSubscriptionManager_.token()).to.equal(
      DeployedToken.address
    );
    expect(await DatasetSubscriptionManager_.feePerConsumerPerSecond()).to.equal(
      feeAmount
    );
  });

  it("Should calculate fees for data set subscription (one week and 1 consumer)", async function () {
    const DeployedToken = await deployments.deploy("TestToken_new2", {
      contract: "TestToken",
      from: users_.subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const consumers = 1;

    const [subscriptionFeeToken, subscriptionFeeAmount] =
      await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        constants.ONE_WEEK,
        consumers
      );

    const feePerConsumerPerSecond =
      await DatasetSubscriptionManager_.feePerConsumerPerSecond();

    expect(subscriptionFeeToken).to.equal(DeployedToken.address);
    expect(subscriptionFeeAmount).to.equal(
      feePerConsumerPerSecond * BigInt(constants.ONE_WEEK) * BigInt(consumers)
    );
  });

  it("Should revert calculate fees for data set subscription if it's a wrong data set", async function () {
    const wrongDatasetId = 12312312n;

    const DeployedToken = await deployments.deploy("TestToken_new3", {
      contract: "TestToken",
      from: users_.subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const consumers = 1;

    await expect(
      DatasetSubscriptionManager_.subscriptionFee(
        wrongDatasetId,
        constants.ONE_WEEK,
        consumers
      )
    )
      .to.be.revertedWithCustomError(
        DatasetSubscriptionManager_,
        "UNSUPPORTED_DATASET"
      )
      .withArgs(wrongDatasetId);
  });

  it("Should user pay data set subscription with ERC-20 token - data set admin received payment", async function () {
    await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      await users_.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.emit(DatasetSubscriptionManager_, "SubscriptionPaid");
  });

  it("Should revert user pay data set subscription if wrong data set id is used", async function () {
    const wrongDatasetId = 123123123n;
    
    await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      await users_.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        wrongDatasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    )
      .to.be.revertedWithCustomError(
        DatasetSubscriptionManager_,
        "UNSUPPORTED_DATASET"
      )
      .withArgs(wrongDatasetId);
  });

  it("Should retrieve subscription id after subscription is paid", async function () {
    await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      await users_.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.emit(DatasetSubscriptionManager_, "SubscriptionPaid");

    expect(
      await DatasetSubscriptionManager_.tokenOfOwnerByIndex(
        users_.subscriber.address,
        0
      )
    ).to.equal(1);
  });

  it("Should subscriber add consumers to the data set subscription", async function () {
    await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      await users_.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager_.connect(
        users_.subscriber
      ).subscribeAndAddConsumers(
        datasetId_,
        subscriptionStart,
        constants.ONE_DAY,
        [users_.subscriber.address, users_.datasetOwner.address]
      )
    ).to.emit(DatasetSubscriptionManager_, "SubscriptionPaid");
  });

  it("Should revert if subscriber tries to subscribe to the same data set", async function () {
    await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      await users_.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_DAY,
      1
    );

    await expect(
      DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.be.revertedWith("User already subscribed");
  });

  it("Should revert pay data set subscription with ERC-20 token if there is no enough allowance", async function () {
    const DeployedToken = await deployments.deploy("TestToken", {
      from: users_.subscriber.address,
    });

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  // ----------------------------------------------------------------------------------------------

  describe("On Subscription", () => {
    let snap: string;
    let DatasetSubscriptionManager_: ERC20LinearSingleDatasetSubscriptionManager;
    let DatasetDistributionManager_: DistributionManager;
    let datasetId_: bigint;
    let subscriptionId_: bigint;
    let users_: Record<string, Signer>;

    before(async () => {
      const {
        DatasetSubscriptionManager,
        DatasetDistributionManager,
        datasetId,
        subscriptionId,
        users
      } = await setupOnSubscribe();

      DatasetSubscriptionManager_ = DatasetSubscriptionManager;
      DatasetDistributionManager_ = DatasetDistributionManager;
      datasetId_ = datasetId;
      subscriptionId_ = subscriptionId;
      users_ = users;
    });

    beforeEach(async () => {
      snap = await ethers.provider.send("evm_snapshot", []);
    });
  
    afterEach(async () => {
      await ethers.provider.send("evm_revert", [snap]);
    });

    it("Should subscription owner add consumers to the subscription", async () => {
      await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
        subscriptionId_,
        [users_.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.consumer.address
        )
      ).to.be.true;
    });

    it("Should subscription owner calculate extra fee for adding more consumers", async () => {
      const [, fee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        constants.ONE_DAY,
        1
      );

      const extraFee = await DatasetSubscriptionManager_.extraConsumerFee(
        subscriptionId_,
        1
      );

      expect(fee).to.equal(extraFee);
    });

    it("Should revert add consumers to the subscription if not the subscription owner", async () => {
      await expect(
        DatasetSubscriptionManager_.connect(users_.user).addConsumers(
          subscriptionId_,
          [users_.consumer.address]
        )
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should revert add consumers to the subscription with wrong id", async function () {
      const wrongSubscriptionId = 112313;

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
          wrongSubscriptionId,
          [users_.consumer.address]
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("Should revert add consumers if more consumers are added than set", async function () {
      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
          subscriptionId_,
          [users_.consumer.address, users_.secondConsumer.address]
        )
      ).to.be.revertedWith("Too many consumers to add");
    });

    it("Should subscription owner remove consumers to the subscription", async () => {
      await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
        subscriptionId_,
        [users_.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.consumer.address
        )
      ).to.be.true;

      await DatasetSubscriptionManager_.connect(
        users_.subscriber
      ).removeConsumers(subscriptionId_, [users_.consumer.address]);

      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.consumer.address
        )
      ).to.be.false;
    });

    it("Should revert subscription owner remove consumers if subscription does not exists", async () => {
      const wrongSubscriptionId = 12312312312n;
      
      await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
        subscriptionId_,
        [users_.consumer.address]
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).removeConsumers(
          wrongSubscriptionId,
          [users_.consumer.address]
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("Should revert if user tries to remove consumers from the subscription", async () => {
      await expect(
        DatasetSubscriptionManager_.connect(users_.user).removeConsumers(
          subscriptionId_,
          [users_.consumer.address]
        )
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should subscription owner replace consumers from the subscription", async () => {
      await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
        subscriptionId_,
        [users_.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.consumer.address
        )
      ).to.be.true;
      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.secondConsumer.address
        )
      ).to.be.false;

      await DatasetSubscriptionManager_.connect(
        users_.subscriber
      ).replaceConsumers(
        subscriptionId_,
        [users_.consumer.address],
        [users_.secondConsumer.address]
      );

      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.consumer.address
        )
      ).to.be.false;
      expect(
        await DatasetSubscriptionManager_.isSubscriptionPaidFor(
          datasetId_,
          users_.secondConsumer.address
        )
      ).to.be.true;
    });

    it("Should revert subscription owner consumers replace if one consumer to replace is not found", async () => {
      await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
        subscriptionId_,
        [users_.consumer.address]
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).replaceConsumers(
          subscriptionId_,
          [users_.user.address],
          [users_.secondConsumer.address]
        )
      )
        .to.be.revertedWithCustomError(
          DatasetSubscriptionManager_,
          "CONSUMER_NOT_FOUND"
        )
        .withArgs(subscriptionId_, users_.user.address);
    });

    it("Should subscription be paid if consumer was added", async function () {
      await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
        subscriptionId_,
        [users_.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager_.connect(
          users_.subscriber
        ).isSubscriptionPaidFor(datasetId_, users_.consumer.address)
      ).to.be.true;
    });

    it("Should subscription not be paid if consumer was not added", async function () {
      expect(
        await DatasetSubscriptionManager_.connect(
          users_.subscriber
        ).isSubscriptionPaidFor(datasetId_, users_.consumer.address)
      ).to.be.false;
    });

    it("Should revert check for subscription paid for consumer if wrong data set", async function () {
      const wrongDatasetId = 13412312n;

      await expect(
        DatasetSubscriptionManager_.connect(
          users_.subscriber
        ).isSubscriptionPaidFor(wrongDatasetId, users_.consumer.address)
      )
        .to.be.revertedWithCustomError(
          DatasetSubscriptionManager_,
          "UNSUPPORTED_DATASET"
        )
        .withArgs(wrongDatasetId);
    });

    it("Should subscriber extends his subscription if expired", async () => {
      await time.increase(constants.ONE_DAY * 3);

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
          subscriptionId_,
          constants.ONE_WEEK,
          0
        )
      ).to.emit(DatasetSubscriptionManager_, "SubscriptionPaid");
    });

    it("Should subscriber extends his subscription if not expired", async () => {
      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
          subscriptionId_,
          constants.ONE_WEEK,
          0
        )
      ).to.emit(DatasetSubscriptionManager_, "SubscriptionPaid");
    });

    it("Should revert if subscriber tries to extend a wrong subscription", async () => {
      const wrongSubscriptionId = 112313;

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
          wrongSubscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });
  });
});
