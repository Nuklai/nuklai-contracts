import {
  AcceptManuallyVerifier,
  DatasetFactory,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from "@typechained";
import { MaxUint256, ZeroHash, parseUnits, Contract } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { expect } from "chai";
import { v4 as uuidv4 } from "uuid";
import { constants, signature, utils } from "./utils";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getEvent } from "./utils/events";
import { setupUsers, Signer } from "./utils/users";

const setup = async () => {
  await deployments.fixture(["DatasetFactory", "DatasetVerifiers"]);

  const users = await setupUsers();

  const contracts = {
    DatasetFactory: (await ethers.getContract(
      "DatasetFactory"
    )) as DatasetFactory,
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract(
      "FragmentNFT"
    )) as FragmentNFT,
  };

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

  const fragmentAddress = await contracts.DatasetNFT.fragments(datasetId);
  const DatasetFragment = await ethers.getContractAt(
    "FragmentNFT",
    fragmentAddress
  );
  const lastFragmentPendingId = await DatasetFragment.lastFragmentPendingId();

  const proposeSignatureSchemas = await users.dtAdmin.signMessage(
    signature.getDatasetFragmentProposeMessage(
      network.config.chainId!,
      await contracts.DatasetNFT.getAddress(),
      datasetId,
      lastFragmentPendingId + 1n,
      users.datasetOwner.address,
      ZeroHash
    )
  );

  await contracts.DatasetNFT.connect(users.datasetOwner).proposeFragment(
    datasetId,
    users.datasetOwner.address,
    ZeroHash,
    proposeSignatureSchemas
  );

  const DatasetVerifierManager = (await ethers.getContractAt(
    "VerifierManager",
    await contracts.DatasetNFT.verifierManager(datasetId),
    users.datasetOwner
  )) as unknown as VerifierManager;

  const AcceptManuallyVerifier =
    await ethers.getContract<AcceptManuallyVerifier>("AcceptManuallyVerifier");

  await AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
    fragmentAddress,
    lastFragmentPendingId + 1n,
    true
  );

  return {
    datasetId,
    DatasetFragment,
    DatasetSubscriptionManager: (await ethers.getContractAt(
      "ERC20LinearSingleDatasetSubscriptionManager",
      await contracts.DatasetNFT.subscriptionManager(datasetId)
    )) as unknown as ERC20LinearSingleDatasetSubscriptionManager,
    DatasetDistributionManager: (await ethers.getContractAt(
      "DistributionManager",
      await contracts.DatasetNFT.distributionManager(datasetId),
      users.datasetOwner
    )) as unknown as DistributionManager,
    DatasetVerifierManager,
    users,
    ...contracts,
  };
};

describe("DistributionManager", () => {
  let snap: string;
  let DatasetFactory_: DatasetFactory;
  let DatasetNFT_: DatasetNFT;
  let FragmentNFTImplementation_: FragmentNFT;
  let DatasetFragment_: Contract;
  let DatasetSubscriptionManager_: ERC20LinearSingleDatasetSubscriptionManager;
  let DatasetDistributionManager_: DistributionManager;
  let DatasetVerifierManager_: VerifierManager;
  let users_: Record<string, Signer>;
  let datasetId_: bigint;

  before(async () => {
    const {
      DatasetFactory,
      DatasetNFT,
      FragmentNFTImplementation,
      DatasetFragment,
      DatasetSubscriptionManager,
      DatasetDistributionManager,
      DatasetVerifierManager,
      users,
      datasetId,
    } = await setup();

    DatasetFactory_ = DatasetFactory;
    DatasetNFT_ = DatasetNFT;
    FragmentNFTImplementation_ = FragmentNFTImplementation;
    DatasetFragment_ = DatasetFragment;
    DatasetSubscriptionManager_ = DatasetSubscriptionManager;
    DatasetDistributionManager_ = DatasetDistributionManager;
    DatasetVerifierManager_ = DatasetVerifierManager;
    users_ = users;
    datasetId_ = datasetId;
  });

  beforeEach(async () => {
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
  });

  it("Should data set owner set its percentage to be sent on each payment", async function () {
    const percentage = parseUnits("0.01", 18);

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(percentage);

    expect(await DatasetDistributionManager_.datasetOwnerPercentage()).to.equal(
      percentage
    );
  });

  it("Should revert if data set owner percentage set is higher than 100%", async function () {
    const percentage = parseUnits("1.01", 18);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Can't be higher than 100%");
  });

  it("Should revert set percentage if sender is not the data set owner", async function () {
    const percentage = parseUnits("1.01", 18);

    await expect(
      DatasetDistributionManager_.connect(
        users_.user
      ).setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Not a Dataset owner");
  });

  it("Should data set owner set data set tag weights", async function () {
    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);
  });

  it("Should revert set tag weights if weights sum is not equal to 100%", async function () {
    const datasetSchemasTag = utils.encodeTag("dataset.schemas");
    const datasetRowsTag = utils.encodeTag("dataset.rows");

    await expect(
      DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [datasetSchemasTag, datasetRowsTag],
        [parseUnits("0.4", 18), parseUnits("0.8", 18)]
      )
    ).to.be.revertedWith("Invalid weights summ");
  });

  it("Should data set owner claim revenue after locking period (two weeks)", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.00000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    const claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    const validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    const validTill = validSince + constants.ONE_DAY;

    const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.datasetOwner.address,
        tokenAddress,
        parseUnits("0.000006048", 18)
      );
  });

  it("Should data set owner not be able to claim revenue twice", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.00000001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    let claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    let validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    let validTill = validSince + constants.ONE_DAY;

    let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.datasetOwner.address,
        tokenAddress,
        parseUnits("0.000006048", 18)
      );

    claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    expect(claimableAmount).to.be.equal(0);

    validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    validTill = validSince + constants.ONE_DAY;

    claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount + 1n,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    ).to.be.rejectedWith("not enough amount");
  });

  it("Should revert claim revenue if it's not the data set owner", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.1", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    const claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    const validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    const validTill = validSince + constants.ONE_DAY;

    const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.contributor
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    ).to.be.revertedWith("Not a Dataset owner");
  });

  it("Should revert data set owner from claiming revenue if signature is wrong", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.1", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    const claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    const validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    const validTill = validSince + constants.ONE_DAY;

    const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage("0x");

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.dtAdmin.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    ).to.be.revertedWithCustomError(
      DatasetDistributionManager_,
      "BAD_SIGNATURE"
    );
  });

  it("Should contributor claim revenue after two weeks", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    const validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    const validTill = validSince + constants.ONE_DAY;
    const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.contributor.address,
        tokenAddress,
        parseUnits("302.0976", 18)
      );
  });

  it("Should contributor claim revenue after two weeks, then new user subscribes (4 weeks) and contributor claims revenue again", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    let subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    let validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    let validTill = validSince + constants.ONE_DAY;
    let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.contributor.address,
        tokenAddress,
        parseUnits("302.0976", 18)
      );

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    ).to.not.emit(DatasetDistributionManager_, "PayoutSent");

    await users_.secondSubscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(
      users_.secondSubscriber
    ).subscribe(datasetId_, subscriptionStart, constants.ONE_WEEK * 4, 1);

    validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    validTill = validSince + constants.ONE_DAY;
    fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.contributor.address,
        tokenAddress,
        parseUnits("1208.3904", 18)
      );

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    ).to.not.emit(DatasetDistributionManager_, "PayoutSent");
  });

  it("Should data set owner claim revenue, then new user subscribes (4 weeks) and data set owner claims revenue again", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    let subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    let claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    let validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    let validTill = validSince + constants.ONE_DAY;

    let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.datasetOwner.address,
        tokenAddress,
        parseUnits("0.6048", 18)
      );

    await users_.secondSubscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(
      users_.secondSubscriber
    ).subscribe(datasetId_, subscriptionStart, constants.ONE_WEEK * 4, 1);

    claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    validTill = validSince + constants.ONE_DAY;

    claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.datasetOwner.address,
        tokenAddress,
        parseUnits("2.4192", 18)
      );

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    ).to.be.revertedWith("not enough amount");
  });

  it("Should data set owner and contributor claim revenue, then new user subscribes (4 weeks) and data set owner and contributor claim revenue again", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    let subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    let validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    let validTill = validSince + constants.ONE_DAY;
    let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.contributor.address,
        tokenAddress,
        parseUnits("302.0976", 18)
      );

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    ).to.not.emit(DatasetDistributionManager_, "PayoutSent");

    let claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    validTill = validSince + constants.ONE_DAY;

    let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.datasetOwner.address,
        tokenAddress,
        parseUnits("0.6048", 18)
      );

    await users_.secondSubscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(
      users_.secondSubscriber
    ).subscribe(datasetId_, subscriptionStart, constants.ONE_WEEK * 4, 1);

    validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    validTill = validSince + constants.ONE_DAY;
    fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.contributor.address,
        tokenAddress,
        parseUnits("1208.3904", 18)
      );

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    ).to.not.emit(DatasetDistributionManager_, "PayoutSent");

    claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(
      tokenAddress
    );

    validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    validTill = validSince + constants.ONE_DAY;

    claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerPayouts(
        tokenAddress,
        claimableAmount,
        users_.datasetOwner.address,
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.datasetOwner.address,
        tokenAddress,
        parseUnits("2.4192", 18)
      );
  });

  it("Should contributor not able to claim revenue after two weeks twice", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    const validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    const validTill = validSince + constants.ONE_DAY;
    const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await time.increase(constants.ONE_WEEK * 2);

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    )
      .to.emit(DatasetDistributionManager_, "PayoutSent")
      .withArgs(
        users_.contributor.address,
        tokenAddress,
        parseUnits("302.0976", 18)
      );

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    ).to.not.emit(DatasetDistributionManager_, "PayoutSent");
  });

  it("Should revert if contributor claims revenue before two weeks", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.1", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    const validSince =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) +
      1 +
      constants.ONE_WEEK * 2;
    const validTill = validSince + constants.ONE_DAY;
    const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
      signature.getFragmentOwnerClaimMessage(
        network.config.chainId!,
        await DatasetDistributionManager_.getAddress(),
        users_.contributor.address,
        BigInt(validSince),
        BigInt(validTill)
      )
    );

    await expect(
      DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
        validSince,
        validTill,
        fragmentOwnerSignature
      )
    ).to.be.revertedWith("signature overdue");
  });

  it("Should calculate contributor payout before claiming", async function () {
    const nextPendingFragmentId =
      (await DatasetFragment_.lastFragmentPendingId()) + 1n;

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        await DatasetNFT_.getAddress(),
        datasetId_,
        nextPendingFragmentId,
        users_.contributor.address,
        ZeroHash
      )
    );

    await DatasetNFT_.connect(users_.contributor).proposeFragment(
      datasetId_,
      users_.contributor.address,
      ZeroHash,
      proposeSignatureSchemas
    );

    const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

    const AcceptManuallyVerifier =
      await ethers.getContract<AcceptManuallyVerifier>(
        "AcceptManuallyVerifier"
      );

    await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
      datasetFragmentAddress,
      nextPendingFragmentId,
      true
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setDatasetOwnerPercentage(ethers.parseUnits("0.001", 18));

    const tokenAddress = await users_.subscriber.Token!.getAddress();

    await users_.subscriber.Token!.approve(
      await DatasetSubscriptionManager_.getAddress(),
      MaxUint256
    );

    await DatasetDistributionManager_.connect(
      users_.datasetOwner
    ).setTagWeights([ZeroHash], [parseUnits("1", 18)]);

    const feeAmount = parseUnits("0.001", 18);

    await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
      tokenAddress,
      feeAmount
    );

    const subscriptionStart =
      Number((await ethers.provider.getBlock("latest"))?.timestamp) + 1;

    await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
      datasetId_,
      subscriptionStart,
      constants.ONE_WEEK,
      1
    );

    expect(
      await DatasetDistributionManager_.calculatePayoutByToken(
        tokenAddress,
        users_.contributor.address
      )
    ).to.equal(parseUnits("302.0976", 18));
  });
});
