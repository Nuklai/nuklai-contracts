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
import { setupUsers } from "./utils/users";

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
  it("Should data set owner set ERC-20 token fee amount for data set subscription", async function () {
    const { DatasetSubscriptionManager, users } = await setup();

    const DeployedToken = await deployments.deploy("TestToken_new", {
      contract: "TestToken",
      from: users.subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    expect(await DatasetSubscriptionManager.token()).to.equal(
      DeployedToken.address
    );
    expect(await DatasetSubscriptionManager.feePerConsumerPerSecond()).to.equal(
      feeAmount
    );
  });

  it("Should calculate fees for data set subscription (one week and 1 consumer)", async function () {
    const { DatasetSubscriptionManager, datasetId, users } = await setup();

    const DeployedToken = await deployments.deploy("TestToken_new", {
      contract: "TestToken",
      from: users.subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const consumers = 1;

    const [subscriptionFeeToken, subscriptionFeeAmount] =
      await DatasetSubscriptionManager.subscriptionFee(
        datasetId,
        constants.ONE_WEEK,
        consumers
      );

    const feePerConsumerPerSecond =
      await DatasetSubscriptionManager.feePerConsumerPerSecond();

    expect(subscriptionFeeToken).to.equal(DeployedToken.address);
    expect(subscriptionFeeAmount).to.equal(
      feePerConsumerPerSecond * BigInt(constants.ONE_WEEK) * BigInt(consumers)
    );
  });

  it("Should user pay data set subscription with ERC-20 token - data set admin received payment", async function () {
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

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
      await users.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(users.subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");
  });

  it("Should retrieve subscription id after subscription is paid", async function () {
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

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
      await users.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(users.subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");

    expect(
      await DatasetSubscriptionManager.tokenOfOwnerByIndex(
        users.subscriber.address,
        0
      )
    ).to.equal(1);
  });

  it("Should subscriber add consumers to the data set subscription", async function () {
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

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
      await users.datasetOwner.Token!.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(
        users.subscriber
      ).subscribeAndAddConsumers(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        [users.subscriber.address, users.datasetOwner.address]
      )
    ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");
  });

  it("Should revert if subscriber tries to subscribe to the same data set", async function () {
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

    await expect(
      DatasetSubscriptionManager.connect(users.subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.be.revertedWith("User already subscribed");
  });

  it("Should revert pay data set subscription with ERC-20 token if there is no enough allowance", async function () {
    const {
      DatasetSubscriptionManager,
      DatasetDistributionManager,
      datasetId,
      users,
    } = await setup();

    const DeployedToken = await deployments.deploy("TestToken", {
      from: users.subscriber.address,
    });

    await DatasetDistributionManager.connect(
      users.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(users.subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  describe("On Subscription", () => {
    it("Should subscription owner add consumers to the subscription", async () => {
      const { datasetId, subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await DatasetSubscriptionManager.connect(users.subscriber).addConsumers(
        subscriptionId,
        [users.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.consumer.address
        )
      ).to.be.true;
    });

    it("Should revert add consumers to the subscription if not the subscription owner", async () => {
      const { subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await expect(
        DatasetSubscriptionManager.connect(users.user).addConsumers(
          subscriptionId,
          [users.consumer.address]
        )
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should revert add consumers to the subscription with wrong id", async function () {
      const { DatasetSubscriptionManager, users } = await setupOnSubscribe();

      const wrongSubscriptionId = 112313;

      await expect(
        DatasetSubscriptionManager.connect(users.subscriber).addConsumers(
          wrongSubscriptionId,
          [users.consumer.address]
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("Should revert add consumers if more consumers are added than set", async function () {
      const { subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await expect(
        DatasetSubscriptionManager.connect(users.subscriber).addConsumers(
          subscriptionId,
          [users.consumer.address, users.secondConsumer.address]
        )
      ).to.be.revertedWith("Too many consumers to add");
    });

    it("Should subscription owner remove consumers to the subscription", async () => {
      const { datasetId, subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await DatasetSubscriptionManager.connect(users.subscriber).addConsumers(
        subscriptionId,
        [users.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.consumer.address
        )
      ).to.be.true;

      await DatasetSubscriptionManager.connect(
        users.subscriber
      ).removeConsumers(subscriptionId, [users.consumer.address]);

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.consumer.address
        )
      ).to.be.false;
    });

    it("Should revert if user tries to remove consumers from the subscription", async () => {
      const { subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await expect(
        DatasetSubscriptionManager.connect(users.user).removeConsumers(
          subscriptionId,
          [users.consumer.address]
        )
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should subscription owner replace consumers from the subscription", async () => {
      const { datasetId, subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await DatasetSubscriptionManager.connect(users.subscriber).addConsumers(
        subscriptionId,
        [users.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.consumer.address
        )
      ).to.be.true;
      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.secondConsumer.address
        )
      ).to.be.false;

      await DatasetSubscriptionManager.connect(
        users.subscriber
      ).replaceConsumers(
        subscriptionId,
        [users.consumer.address],
        [users.secondConsumer.address]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.consumer.address
        )
      ).to.be.false;
      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          users.secondConsumer.address
        )
      ).to.be.true;
    });

    it("Should subscription be paid if consumer was added", async function () {
      const { datasetId, subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await DatasetSubscriptionManager.connect(users.subscriber).addConsumers(
        subscriptionId,
        [users.consumer.address]
      );

      expect(
        await DatasetSubscriptionManager.connect(
          users.subscriber
        ).isSubscriptionPaidFor(datasetId, users.consumer.address)
      ).to.be.true;
    });

    it("Should subscription not be paid if consumer was not added", async function () {
      const { datasetId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      expect(
        await DatasetSubscriptionManager.connect(
          users.subscriber
        ).isSubscriptionPaidFor(datasetId, users.consumer.address)
      ).to.be.false;
    });

    it("Should subscriber extends his subscription if expired", async () => {
      const { subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await time.increase(constants.ONE_DAY * 3);

      await expect(
        DatasetSubscriptionManager.connect(users.subscriber).extendSubscription(
          subscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");
    });

    it("Should subscriber extends his subscription if not expired", async () => {
      const { subscriptionId, DatasetSubscriptionManager, users } =
        await setupOnSubscribe();

      await expect(
        DatasetSubscriptionManager.connect(users.subscriber).extendSubscription(
          subscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");
    });

    it("Should revert if subscriber tries to extend a wrong subscription", async () => {
      const { DatasetSubscriptionManager, users } = await setupOnSubscribe();
      const wrongSubscriptionId = 112313;

      await expect(
        DatasetSubscriptionManager.connect(users.subscriber).extendSubscription(
          wrongSubscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });
  });
});
