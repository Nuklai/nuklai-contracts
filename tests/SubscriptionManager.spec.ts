import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  TestToken,
  VerifierManager,
} from "@typechained";
import { expect } from "chai";
import { MaxUint256, ZeroHash, parseUnits } from "ethers";
import { deployments, ethers, getNamedAccounts, network } from "hardhat";
import { v4 as uuidv4 } from "uuid";
import { constants, signature } from "./utils";
import { getTestTokenContract } from "./utils/contracts";

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

  await contracts.DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

  await contracts.DatasetNFT.connect(datasetOwner).mint(
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

const setupOnSubscribe = async () => {
  const { DatasetSubscriptionManager, DatasetDistributionManager, datasetId } =
    await setup();
  const { subscriber, datasetOwner } = await ethers.getNamedSigners();

  await DatasetDistributionManager.connect(datasetOwner).setTagWeights(
    [ZeroHash],
    [parseUnits("1", 18)]
  );

  const Token = await getTestTokenContract(subscriber, {
    mint: parseUnits("100000000", 18),
  });

  await Token.connect(subscriber).approve(
    await DatasetSubscriptionManager.getAddress(),
    MaxUint256
  );

  await DatasetDistributionManager.connect(
    datasetOwner
  ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

  await DatasetDistributionManager.connect(
    datasetOwner
  ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

  const feeAmount = parseUnits("0.0000001", 18);

  await DatasetSubscriptionManager.connect(datasetOwner).setFee(
    await Token.getAddress(),
    feeAmount
  );

  const subscriptionStart =
    Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

  await DatasetSubscriptionManager.connect(subscriber).subscribe(
    datasetId,
    subscriptionStart,
    constants.ONE_DAY,
    1
  );

  const subscriptionId = await DatasetSubscriptionManager.tokenOfOwnerByIndex(
    subscriber.address,
    0
  );

  return {
    datasetId,
    subscriptionId,
    DatasetSubscriptionManager,
    DatasetDistributionManager,
  };
};

describe("SubscriptionManager", () => {
  it("Should data set owner set ERC-20 token fee amount for data set subscription", async function () {
    const { DatasetSubscriptionManager } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    const DeployedToken = await deployments.deploy("TestToken", {
      from: subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
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
    const { DatasetSubscriptionManager, datasetId } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    const DeployedToken = await deployments.deploy("TestToken", {
      from: subscriber.address,
    });

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
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
    expect(Number(subscriptionFeeAmount)).to.equal(
      Number(feePerConsumerPerSecond) * constants.ONE_WEEK * consumers
    );
  });

  it("Should user pay data set subscription with ERC-20 token - data set admin received payment", async function () {
    const {
      DatasetSubscriptionManager,
      DatasetDistributionManager,
      datasetId,
    } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    await DatasetDistributionManager.connect(datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    const Token = await getTestTokenContract(subscriber, {
      mint: parseUnits("100000000", 18),
    });

    const tokenAddress = await Token.getAddress();

    await Token.connect(subscriber).approve(
      await DatasetSubscriptionManager.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(subscriber).subscribe(
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
    } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    await DatasetDistributionManager.connect(datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    const Token = await getTestTokenContract(subscriber, {
      mint: parseUnits("100000000", 18),
    });

    const tokenAddress = await Token.getAddress();

    await Token.connect(subscriber).approve(
      await DatasetSubscriptionManager.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");

    expect(
      await DatasetSubscriptionManager.tokenOfOwnerByIndex(
        subscriber.address,
        0
      )
    ).to.equal(1);
  });

  it("Should if tags weights are not set", async function () {
    const {
      DatasetSubscriptionManager,
      DatasetDistributionManager,
      datasetId,
    } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    const Token = await getTestTokenContract(subscriber, {
      mint: parseUnits("100000000", 18),
    });

    const tokenAddress = await Token.getAddress();

    await Token.connect(subscriber).approve(
      await DatasetSubscriptionManager.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.be.revertedWith("tag weights not initialized");
  });

  it("Should revert if subscriber tries to subscribe to the same data set", async function () {
    const {
      DatasetSubscriptionManager,
      DatasetDistributionManager,
      datasetId,
    } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    await DatasetDistributionManager.connect(datasetOwner).setTagWeights(
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    const Token = await getTestTokenContract(subscriber, {
      mint: parseUnits("100000000", 18),
    });

    await Token.connect(subscriber).approve(
      await DatasetSubscriptionManager.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
      await Token.getAddress(),
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager.connect(subscriber).subscribe(
      datasetId,
      subscriptionStart,
      constants.ONE_DAY,
      1
    );

    await expect(
      DatasetSubscriptionManager.connect(subscriber).subscribe(
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
    } = await setup();
    const { subscriber, datasetOwner } = await ethers.getNamedSigners();

    const DeployedToken = await deployments.deploy("TestToken", {
      from: subscriber.address,
    });

    await DatasetDistributionManager.connect(
      datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.01", 18));

    const feeAmount = parseUnits("0.0000001", 18);

    await DatasetSubscriptionManager.connect(datasetOwner).setFee(
      DeployedToken.address,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await expect(
      DatasetSubscriptionManager.connect(subscriber).subscribe(
        datasetId,
        subscriptionStart,
        constants.ONE_DAY,
        1
      )
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  describe("On Subscription", () => {
    it("Should subscription owner add consumers to the subscription", async () => {
      const { datasetId, subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      await DatasetSubscriptionManager.connect(subscriber).addConsumers(
        subscriptionId,
        [consumer]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumer
        )
      ).to.be.true;
    });

    it("Should revert add consumers to the subscription if not the subscription owner", async () => {
      const { subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { user } = await ethers.getNamedSigners();

      await expect(
        DatasetSubscriptionManager.connect(user).addConsumers(subscriptionId, [
          consumer,
        ])
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should revert add consumers to the subscription with wrong id", async function () {
      const { DatasetSubscriptionManager } = await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      const wrongSubscriptionId = 112313;

      await expect(
        DatasetSubscriptionManager.connect(subscriber).addConsumers(
          wrongSubscriptionId,
          [consumer]
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("Should revert add consumers if more consumers are added than set", async function () {
      const { subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer, secondConsumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      await expect(
        DatasetSubscriptionManager.connect(subscriber).addConsumers(
          subscriptionId,
          [consumer, secondConsumer]
        )
      ).to.be.revertedWith("Too many consumers to add");
    });

    it("Should subscription owner remove consumers to the subscription", async () => {
      const { datasetId, subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      await DatasetSubscriptionManager.connect(subscriber).addConsumers(
        subscriptionId,
        [consumer]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumer
        )
      ).to.be.true;

      await DatasetSubscriptionManager.connect(subscriber).removeConsumers(
        subscriptionId,
        [consumer]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumer
        )
      ).to.be.false;
    });

    it("Should revert if user tries to remove consumers from the subscription", async () => {
      const { subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { user } = await ethers.getNamedSigners();

      await expect(
        DatasetSubscriptionManager.connect(user).removeConsumers(
          subscriptionId,
          [consumer]
        )
      ).to.be.revertedWith("Not a subscription owner");
    });

    it("Should subscription owner replace consumers from the subscription", async () => {
      const { datasetId, subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer, secondConsumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      await DatasetSubscriptionManager.connect(subscriber).addConsumers(
        subscriptionId,
        [consumer]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumer
        )
      ).to.be.true;
      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          secondConsumer
        )
      ).to.be.false;

      await DatasetSubscriptionManager.connect(subscriber).replaceConsumers(
        subscriptionId,
        [consumer],
        [secondConsumer]
      );

      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          consumer
        )
      ).to.be.false;
      expect(
        await DatasetSubscriptionManager.isSubscriptionPaidFor(
          datasetId,
          secondConsumer
        )
      ).to.be.true;
    });

    it("Should subscription be paid if consumer was added", async function () {
      const { datasetId, subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      await DatasetSubscriptionManager.connect(subscriber).addConsumers(
        subscriptionId,
        [consumer]
      );

      expect(
        await DatasetSubscriptionManager.connect(
          subscriber
        ).isSubscriptionPaidFor(datasetId, consumer)
      ).to.be.true;
    });

    it("Should subscription not be paid if consumer was not added", async function () {
      const { datasetId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { consumer } = await getNamedAccounts();
      const { subscriber } = await ethers.getNamedSigners();

      expect(
        await DatasetSubscriptionManager.connect(
          subscriber
        ).isSubscriptionPaidFor(datasetId, consumer)
      ).to.be.false;
    });

    it("Should subscriber extends its subscription if expired", async () => {
      const { subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { subscriber } = await ethers.getNamedSigners();

      await time.increase(constants.ONE_DAY * 3);

      await expect(
        DatasetSubscriptionManager.connect(subscriber).extendSubscription(
          subscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");
    });

    it("Should subscriber extends his subscription if not expired", async () => {
      const { subscriptionId, DatasetSubscriptionManager } =
        await setupOnSubscribe();
      const { subscriber } = await ethers.getNamedSigners();

      await expect(
        DatasetSubscriptionManager.connect(subscriber).extendSubscription(
          subscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.emit(DatasetSubscriptionManager, "SubscriptionPaid");
    });

    it("Should revert if subscriber tries to extend a wrong subscription", async () => {
      const { DatasetSubscriptionManager } = await setupOnSubscribe();
      const { subscriber } = await ethers.getNamedSigners();
      const wrongSubscriptionId = 112313;

      await expect(
        DatasetSubscriptionManager.connect(subscriber).extendSubscription(
          wrongSubscriptionId,
          constants.ONE_WEEK,
          0
        )
      ).to.be.revertedWith("ERC721: invalid token ID");
    });
  });
});
