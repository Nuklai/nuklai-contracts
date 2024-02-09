import {
  AcceptManuallyVerifier,
  DatasetFactory,
  DatasetNFT,
  DistributionManager,
  ERC20SubscriptionManager,
  FragmentNFT,
  TestToken,
  VerifierManager,
} from '@typechained';
import { ZeroHash, parseUnits } from 'ethers';
import { deployments, ethers, network } from 'hardhat';
import { expect } from 'chai';
import { v4 as uuidv4 } from 'uuid';
import { constants, signature, utils } from './utils';
import {
  DeployerFeeModel as models,
  APPROVED_TOKEN_ROLE,
  DeployerFeeModel,
} from '../utils/constants';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { getEvent } from './utils/events';
import { setupUsers, Signer } from './utils/users';
import { encodeTag, getUuidHash } from './utils/utils';
import { verifyContributionPayoutIntegrity } from './utils/contracts';

const setup = async () => {
  await deployments.fixture([
    'ProxyAdmin',
    'FragmentNFT',
    'DatasetNFT',
    'DatasetManagers',
    'DatasetVerifiers',
    'DatasetFactory',
    'TestToken',
  ]);

  const users = await setupUsers();

  const contracts = {
    DatasetFactory: (await ethers.getContract('DatasetFactory')) as DatasetFactory,
    DatasetNFT: (await ethers.getContract('DatasetNFT')) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract('FragmentNFT')) as FragmentNFT,
  };

  const datasetUUID = uuidv4();

  const uuidHash = getUuidHash(datasetUUID);

  const datasetAddress = await contracts.DatasetNFT.getAddress();
  const signedMessage = await users.dtAdmin.signMessage(
    signature.getDatasetMintMessage(
      network.config.chainId!,
      datasetAddress,
      uuidHash,
      users.datasetOwner.address
    )
  );

  const testToken = await ethers.getContract('TestToken');
  const testTokenAddress = await testToken.getAddress();

  await contracts.DatasetNFT.grantRole(APPROVED_TOKEN_ROLE, testTokenAddress);

  const defaultVerifierAddress = await (
    await ethers.getContract('AcceptManuallyVerifier')
  ).getAddress();
  const feeAmount = parseUnits('0.1', 18); // FeePerConsumerPerDay
  const dsOwnerPercentage = parseUnits('0.001', 18);

  const mintAndConfigureDatasetReceipt = await (
    await contracts.DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
      uuidHash,
      users.datasetOwner.address,
      signedMessage,
      defaultVerifierAddress,
      await users.datasetOwner.Token!.getAddress(),
      feeAmount,
      dsOwnerPercentage,
      [ZeroHash],
      [parseUnits('1', 18)],
      false
    )
  ).wait();

  const [from, to, datasetId] = getEvent(
    'Transfer',
    mintAndConfigureDatasetReceipt?.logs!,
    contracts.DatasetNFT
  )!.args as unknown as [string, string, bigint];

  const fragmentAddress = await contracts.DatasetNFT.fragments(datasetId);
  const DatasetFragment = (await ethers.getContractAt(
    'FragmentNFT',
    fragmentAddress
  )) as unknown as FragmentNFT;
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
    'VerifierManager',
    await contracts.DatasetNFT.verifierManager(datasetId),
    users.datasetOwner
  )) as unknown as VerifierManager;

  return {
    datasetId,
    DatasetFragment,
    DatasetSubscriptionManager: (await ethers.getContractAt(
      'ERC20SubscriptionManager',
      await contracts.DatasetNFT.subscriptionManager(datasetId)
    )) as unknown as ERC20SubscriptionManager,
    DatasetDistributionManager: (await ethers.getContractAt(
      'DistributionManager',
      await contracts.DatasetNFT.distributionManager(datasetId),
      users.datasetOwner
    )) as unknown as DistributionManager,
    DatasetVerifierManager,
    users,
    ...contracts,
  };
};

export default async function suite(): Promise<void> {
  describe('DistributionManager', () => {
    let snap: string;
    let DatasetFactory_: DatasetFactory;
    let DatasetNFT_: DatasetNFT;
    let FragmentNFTImplementation_: FragmentNFT;
    let DatasetFragment_: FragmentNFT;
    let DatasetSubscriptionManager_: ERC20SubscriptionManager;
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
      snap = await ethers.provider.send('evm_snapshot', []);
    });

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [snap]);
    });

    it('Should base 100% percent be set', async function () {
      const percentage = parseUnits('1', 18);

      const basePercentage = await DatasetDistributionManager_.BASE_100_PERCENT();

      expect(basePercentage).to.equal(percentage);
    });

    it('Should maximum data set owner percentage be set', async function () {
      const percentage = parseUnits('0.5', 18);

      const maxDsOwnerPercentage = await DatasetDistributionManager_.MAX_DATASET_OWNER_PERCENTAGE();

      expect(maxDsOwnerPercentage).to.equal(percentage);
    });

    it('Should data set owner set its percentage to be sent on each payment', async function () {
      const percentage = parseUnits('0.01', 18);

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        percentage
      );

      expect(await DatasetDistributionManager_.datasetOwnerPercentage()).to.equal(percentage);
    });

    it('Should revert if someones tries to re-initialize DistributionManager', async function () {
      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).initialize(
          await DatasetNFT_.getAddress(),
          datasetId_
        )
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Should revert if data set owner percentage set is higher than 50%', async function () {
      const percentage = parseUnits('0.50001', 18);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
          percentage
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'PERCENTAGE_VALUE_INVALID')
        .withArgs(parseUnits('0.5', 18), percentage);
    });

    it('Should revert set percentage if sender is not the data set owner', async function () {
      const percentage = parseUnits('0.4', 18);

      await expect(
        DatasetDistributionManager_.connect(users_.user).setDatasetOwnerPercentage(percentage)
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should data set owner set data set tag weights', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );
    });

    it('Should revert if someone set data set tag weights', async function () {
      await expect(
        DatasetDistributionManager_.connect(users_.user).setTagWeights(
          [ZeroHash],
          [parseUnits('1', 18)]
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should user be able to get tag weights', async function () {
      const tags = [ZeroHash, encodeTag('metadata')];
      const weights = [parseUnits('0.3', 18), parseUnits('0.7', 18)];
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(tags, weights);

      const tagWeights = await DatasetDistributionManager_.connect(users_.user).getTagWeights(tags);

      expect(tagWeights.length).to.be.equal(weights.length);
      expect(tagWeights[0]).to.be.equal(weights[0]);
      expect(tagWeights[1]).to.be.equal(weights[1]);
    });

    it('Should tag weight be zero if does not exists', async function () {
      const tagWeights = await DatasetDistributionManager_.connect(users_.user).getTagWeights([
        encodeTag('unknown.tag'),
      ]);

      expect(tagWeights[0]).to.be.equal(0n);
    });

    it('Should getTagWeights() revert if empty tags array is passed as input argument', async function () {
      await expect(
        DatasetDistributionManager_.connect(users_.user).getTagWeights([])
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'TAGS_NOT_PROVIDED');
    });

    it('Should revert set tag weights if weights sum is not equal to 100%', async function () {
      const datasetSchemasTag = utils.encodeTag('dataset.schemas');
      const datasetRowsTag = utils.encodeTag('dataset.rows');

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
          [datasetSchemasTag, datasetRowsTag],
          [parseUnits('0.4', 18), parseUnits('0.8', 18)]
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'TAG_WEIGHTS_SUM_INVALID')
        .withArgs(parseUnits('1', 18), parseUnits('0.4', 18) + parseUnits('0.8', 18));
    });

    it('Should data set owner set data set tag weights and data set owner percentage in one function', async function () {
      const percentage = parseUnits('0.01', 18);
      const tags = [ZeroHash];
      const weights = [parseUnits('1', 18)];

      await DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).setDSOwnerPercentageAndTagWeights(percentage, tags, weights);

      expect(await DatasetDistributionManager_.datasetOwnerPercentage()).equal(percentage);
      expect((await DatasetDistributionManager_.getTagWeights(tags))[0]).equal(weights[0]);
    });

    it('Should revert setDSOwnerPercentageAndTagWeights() if sender is not the data set owner', async function () {
      const percentage = parseUnits('0.01', 18);
      const tags = [ZeroHash];
      const weights = [parseUnits('1', 18)];

      await expect(
        DatasetDistributionManager_.connect(users_.user).setDSOwnerPercentageAndTagWeights(
          percentage,
          tags,
          weights
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should revert trying to call receivePayment() externally', async function () {
      await expect(
        DatasetDistributionManager_.connect(users_.user).receivePayment(
          await users_.user.Token!.getAddress(),
          parseUnits('1')
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_SUBSCRIPTION_MANAGER')
        .withArgs(users_.user.address);
    });

    it('Should revert trying to call claimDatasetOwnerPayouts() if sender is not data set owner', async function () {
      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should revert trying to call claimDatasetOwnerAndFragmentPayouts() if sender is not data set owner', async function () {
      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimDatasetOwnerAndFragmentPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should data set owner claim revenue after locking period (two weeks)', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.006048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('0.000864', 18); // totalFee for one week & 1 consumer :: 0.000864 * 7 * 1  = 0.006048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7, // 7 days
        1,
        maxSubscriptionFee
      );

      const claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      expect(claimableAmount).to.equal(parseUnits('0.000006048', 18)); // dtOwner percentage is 0.1%, thus :: 0.006048 * 0.001 = 0.000006048

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.datasetOwner.address,
          tokenAddress,
          parseUnits('0.000006048', 18) // dtOwner percentage is 0.1%, thus :: 0.006048 * 0.001 = 0.000006048
        );
    });

    it('Should data set owner not be able to claim revenue twice', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.006048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('0.000864', 18); // totalFee for one week & 1 consumer:: 0.000864 * 7 * 1 = 0.006048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7, // 7 days
        1,
        maxSubscriptionFee
      );

      let claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;

      let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.datasetOwner.address,
          tokenAddress,
          parseUnits('0.000006048', 18) // dtOwner percentage is 0.1%, thus :: 0.006048 * 0.001 = 0.000006048
        );

      claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      expect(claimableAmount).to.be.equal(0);

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;

      claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(
        DatasetDistributionManager_,
        'NO_UNCLAIMED_PAYMENTS_AVAILABLE'
      );
    });

    it("Should revert claim revenue if it's not the data set owner", async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60480', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('8640', 18); // totalFee for one week & 1 consumer:: 8640 * 7 * 1 = 60480

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.be.revertedWithCustomError(DatasetDistributionManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.contributor.address);
    });

    it('Should revert data set owner from claiming revenue if signature is wrong', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60480', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('8640', 18); // totalFee for one week & 1 consumer:: 8640 * 7 * 1 = 60480

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );
      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage('0x');

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'BAD_SIGNATURE');
    });

    it('Should revert data set owner from claiming all revenue if signature is wrong', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60480', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('8640', 18); // totalFee for one week & 1 consumer:: 8640 * 7 * 1 = 60480

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );
      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage('0x');

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(
          users_.datasetOwner
        ).claimDatasetOwnerAndFragmentPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'BAD_SIGNATURE');
    });

    it('Should revert data set owner from claiming all revenue if no claims available', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60480', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('8640', 18); // totalFee for one week & 1 consumer:: 8640 * 7 * 1 = 60480

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );
      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await DatasetDistributionManager_.connect(
        users_.datasetOwner
      ).claimDatasetOwnerAndFragmentPayouts(
        BigInt(validSince),
        BigInt(validTill),
        claimDatasetOwnerSignature
      );

      await expect(
        DatasetDistributionManager_.connect(
          users_.datasetOwner
        ).claimDatasetOwnerAndFragmentPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(
        DatasetDistributionManager_,
        'NO_UNCLAIMED_PAYMENTS_AVAILABLE'
      );
    });

    it('Should datasetOwner claim revenue from both contributing & being the owner via the `claimDatasetOwnerAndFragmentPayouts()`', async () => {
      const percentageForFeeModels = [parseUnits('0.1', 18), parseUnits('0.35', 18)];

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
        [models.DATASET_OWNER_STORAGE, models.DEPLOYER_STORAGE],
        percentageForFeeModels
      );

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModel(
        datasetId_,
        models.DATASET_OWNER_STORAGE
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);

      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Currently 2 contributions are made of the same tag (one from dtOwner & one from contributor)
      // tag weight is 100% (see `setup()`)

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.1', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      // feePerDayPerConsumer
      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;

      const validTill = validSince + constants.ONE_DAY;

      const fragmentOwner_Contributor_Signature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      let claimableAmountForOwningDt = await DatasetDistributionManager_.pendingOwnerFee(
        tokenAddress
      );

      expect(claimableAmountForOwningDt).to.equal(parseUnits('544.32', 18));

      const DatasetOwnerRevenue_Signature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      // DeployerBeneficiary is set as dtAdmin with 10% feePercentage, thus 6048 * 0.1 = 604.8
      // Amount Left for Owner and Contributors is *** 5443.2 ****
      // Dt Owner has 10% feePercentage thus :: 5443.2 * 0.1 = 544.32
      // Amount Left for contributors is 5443.2 - (544.32) = 4898.88
      // Currently two contributors (the dtOwner himself (from setUp) & contributor from this test case)
      // Contributor will take half since they have both proposed a fragment of the same tag, with tagWeight == 100%
      // Contributor Fee:: 4898.88/2 == 2449.44
      // dtOwner will get 4898.88/2 + 544.32 = 2449.44 + 544.32 = 2993.76

      // dtOwner should be able to claim the amount (2993.76) through `claimDatasetOwnerAndFragmentPayouts()`
      let contributorPayout = parseUnits('2449.44', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.datasetOwner.address,
          [ZeroHash],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(
          users_.datasetOwner
        ).claimDatasetOwnerAndFragmentPayouts(validSince, validTill, DatasetOwnerRevenue_Signature)
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, parseUnits('544.32', 18))
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, contributorPayout);

      // contributor should be able to claim his revenue
      contributorPayout = parseUnits('2449.44', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          [ZeroHash],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwner_Contributor_Signature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('2449.44', 18));
    });

    it('Should contributor claim revenue after two weeks', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      // DeployerBeneficiary is not set currently, thus 0 fee fordeployerBeneficiary
      // Dt Owner has 0.1% feePercentage thus :: 6048* 0.001 = 6.048
      // Amount Left for contributors is 60480 - 6.048 = 6041.9520
      // Currently two contributors (the dtOwner himself (from setUp) & contributor from this test case)
      // Contributor will take half since they have both proposed a fragment of the same tag, with tagWeight == 100%
      // Contributor Fee:: 6041.9520/2 == 3020.976

      const contributorPayout = parseUnits('3020.976', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          [ZeroHash],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);
    });

    it('Should revert contributor from claiming revenue if signature is wrong', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage('0x');

      await time.increase(constants.ONE_WEEK * 2);

      // DeployerBeneficiary is not set currently, thus 0 fee fordeployerBeneficiary
      // Dt Owner has 0.1% feePercentage thus :: 6048* 0.001 = 6.048
      // Amount Left for contributors is 60480 - 6.048 = 6041.9520
      // Currently two contributors (the dtOwner himself (from setUp) & contributor from this test case)
      // Contributor will take half since they have both proposed a fragment of the same tag, with tagWeight == 100%
      // Contributor Fee:: 6041.9520/2 == 3020.976

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'BAD_SIGNATURE');
    });

    it('Should contributor claim revenue if payment token has changed', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      const NewDeployedFeeToken = await deployments.deploy('TestToken_new', {
        contract: 'TestToken',
        from: users_.secondSubscriber.address,
      });

      const newFeeToken = (await ethers.getContractAt(
        'TestToken',
        NewDeployedFeeToken.address,
        users_.secondSubscriber
      )) as unknown as TestToken;

      await newFeeToken
        .connect(users_.secondSubscriber)
        .mint(users_.secondSubscriber.address, ethers.parseUnits('100000000', 18));

      // Set new token as approved for payments
      await DatasetNFT_.connect(users_.dtAdmin).grantRole(
        APPROVED_TOKEN_ROLE,
        await newFeeToken.getAddress()
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await newFeeToken.getAddress(),
        parseUnits('86.4', 18)
      );

      await newFeeToken
        .connect(users_.secondSubscriber)
        .approve(await DatasetSubscriptionManager_.getAddress(), parseUnits('604.8', 18));

      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('3020.976', 18))
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.contributor.address,
          await newFeeToken.getAddress(),
          parseUnits('302.0976', 18)
        );
    });

    it('Should contributor claim revenue if payment token has changed and then changed back to first payment token', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      const NewDeployedFeeToken = await deployments.deploy('TestToken_new2', {
        contract: 'TestToken',
        from: users_.secondSubscriber.address,
      });

      const newFeeToken = (await ethers.getContractAt(
        'TestToken',
        NewDeployedFeeToken.address,
        users_.secondSubscriber
      )) as unknown as TestToken;

      await newFeeToken
        .connect(users_.secondSubscriber)
        .mint(users_.secondSubscriber.address, ethers.parseUnits('100000000', 18));

      // Set newFeeToken as approved for payments
      await DatasetNFT_.connect(users_.dtAdmin).grantRole(
        APPROVED_TOKEN_ROLE,
        await newFeeToken.getAddress()
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await newFeeToken.getAddress(),
        parseUnits('86.4', 18)
      );

      await newFeeToken
        .connect(users_.secondSubscriber)
        .approve(await DatasetSubscriptionManager_.getAddress(), parseUnits('604.8', 18));

      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        parseUnits('8.64', 18)
      );

      await users_.user.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60.48', 18)
      );

      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);

      await DatasetSubscriptionManager_.connect(users_.user).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('3020.976', 18))
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.contributor.address,
          await newFeeToken.getAddress(),
          parseUnits('302.0976', 18)
        )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('30.20976', 18));
    });

    it('Should contributor claim revenue after two weeks, then new user subscribes (4 weeks) and contributor claims revenue again', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
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
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('3020.976', 18));

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // For 4 weeks (28 days) & 1 consumer totalSubscriptionFee :: 864 * 28 * 1 = 24192
      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('24192', 18)
      );

      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 28, 1);

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        28,
        1,
        maxSubscriptionFee
      );

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      // DeployerBeneficiary is not set currently, thus 0 fee fordeployerBeneficiary
      // Dt Owner has 0.1% feePercentage thus :: 24192* 0.001 = 24.192
      // Amount Left for contributors is 24192 - 24.192 = 24167.808
      // Currently two contributors (the dtOwner himself (from setUp) & contributor from this test case)
      // Contributor will take half since they have both proposed a fragment of the same tag, with tagWeight == 100%
      // Contributor Fee:: 24167.808/2 == 12083.904

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('12083.904', 18));

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');
    });

    it('Should data set owner claim revenue, then new user subscribes (4 weeks) and data set owner claims revenue again', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalFee for one week & 1 consumer:: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      let claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;

      let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.datasetOwner.address,
          tokenAddress,
          parseUnits('6.048', 18) // 0.1% as ownerPercentageFee :: 6048 * 0.001 = 6.048
        );

      // For 4 weeks (28 days) & 1 consumer totalSubscriptionFee :: 864 * 28 * 1 = 24192
      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('24192', 18)
      );

      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 28, 1);

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        28,
        1,
        maxSubscriptionFee
      );

      claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;

      claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.datasetOwner.address,
          tokenAddress,
          parseUnits('24.192', 18) // 0.1% ownerPercentageFee :: 24192 * 0.001 = 24.192
        );

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(
        DatasetDistributionManager_,
        'NO_UNCLAIMED_PAYMENTS_AVAILABLE'
      );
    });

    it('Should data set owner and contributor claim revenue, then new user subscribes (4 weeks) and data set owner and contributor claim revenue again', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('604.8', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('86.4', 18); // totalFee for one week & 1 consumer:: 86.4 * 7 * 1 = 604.8

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      let contributorPayout = parseUnits('302.0976', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          [ZeroHash],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      let claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;

      let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, parseUnits('0.6048', 18));

      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('2419.2')
      );

      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 28, 1);

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        28,
        1,
        maxSubscriptionFee
      );

      const secondPayment = await DatasetDistributionManager_.payments(1);

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      contributorPayout = parseUnits('1208.3904', 18);
      /* expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.contributor.address,
          [ZeroHash],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed'); */
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      claimableAmount = await DatasetDistributionManager_.pendingOwnerFee(tokenAddress);

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;

      claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, parseUnits('2.4192', 18));
    });

    it('Should contributor not able to claim revenue after two weeks twice', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('604.8')
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('86.4', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
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
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('302.0976', 18));

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');
    });

    it('Should revert if data set owner claims revenue before locking period (two weeks)', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.006048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('0.000864', 18); // totalFee for one week & 1 consumer:: 0.000864 * 7 * 1 = 0.006048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');
    });

    it('Should revert if data set owner claims revenue before locking period (two weeks)', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.006048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('0.000864', 18); // totalFee for one week & 1 consumer:: 0.000864 * 7 * 1 = 0.006048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');
    });

    it('Should revert if data set owner claims all revenue before locking period (two weeks)', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.006048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('0.000864', 18); // totalFee for one week & 1 consumer:: 0.000864 * 7 * 1 = 0.006048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;

      const claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await expect(
        DatasetDistributionManager_.connect(
          users_.datasetOwner
        ).claimDatasetOwnerAndFragmentPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');
    });

    it('Should revert if contributor claims revenue before two weeks', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60480', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('8640', 18); // totalSubscriptionFee for 1 week with 1 consumer :: 8640 * 7 * 1 = 60480

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
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
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');
    });

    it('Should revert every time that data set owner claims revenue and signature for locking period is expired', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.006048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('0.000864', 18); // totalFee for one week & 1 consumer:: 0.000864 * 7 * 1 = 0.006048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;

      let claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2 + constants.ONE_DAY * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK;
      validTill = validSince + constants.ONE_DAY;

      claimDatasetOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).claimDatasetOwnerPayouts(
          BigInt(validSince),
          BigInt(validTill),
          claimDatasetOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');
    });

    it('Should revert every time that fragment owner claims revenue and signature for locking period is expired', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60480', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('8640', 18); // totalFee for one week & 1 consumer:: 8640 * 7 * 1 = 60480

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await time.increase(constants.ONE_WEEK * 2 + constants.ONE_DAY * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');

      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
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
      ).to.be.revertedWithCustomError(DatasetDistributionManager_, 'SIGNATURE_OVERDUE');
    });

    it('Should calculate contributor payout before claiming', async function () {
      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      // 2 contributors (dtOwner & contributor, thus payout for fragment owners will be split in half:
      // 6048(totalFee) - 6.048(ownerFee) = 6041.952 for contributors) ,two contributors thus, 6041.952/2 == 3020.976

      const contributorPayout = parseUnits('3020.976', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          [ZeroHash],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      expect(
        await DatasetDistributionManager_.calculatePayoutByToken(
          tokenAddress,
          users_.contributor.address
        )
      ).to.equal(contributorPayout);
    });

    it('Should 2 contributors be able to claim revenue from 2 subscription payments', async function () {
      await DatasetNFT_.setDeployerFeeBeneficiary(users_.dtAdmin.address);
      await DatasetNFT_.setDeployerFeeModelPercentages(
        [DeployerFeeModel.DEPLOYER_STORAGE],
        [parseUnits('0.35')]
      );
      await DatasetNFT_.setDeployerFeeModel(datasetId_, DeployerFeeModel.DEPLOYER_STORAGE);

      const dataTag = encodeTag('data');
      const metadataTag = encodeTag('metadata');
      const tags = [dataTag, metadataTag];
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.5', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [dataTag, metadataTag],
        [parseUnits('0.9', 18), parseUnits('0.1', 18)]
      );

      const feeAmount = parseUnits('100', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Contributor 1: proposes a fragment
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Approval 1: DS owner approves fragment proposal from Contributor 1
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('3000', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        30,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        30,
        1,
        maxSubscriptionFee
      );

      // Contributor 1 should be able to claim some revenue
      const firstPayment = await DatasetDistributionManager_.payments(0);
      let contributorPayout = parseUnits('877.5', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('3000', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 30, 1);
      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        30,
        1,
        maxSubscriptionFee
      );

      const secondPayment = await DatasetDistributionManager_.payments(1);

      // Contributor 1 should be able to claim some revenue again
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      contributorPayout = parseUnits('438.75', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.contributor.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2 should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('438.75', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.user.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');
    });

    it('Should 2 contributors be able to claim revenue from 2 subscription payments, dataset owner claims revenue at the end', async function () {
      await DatasetNFT_.setDeployerFeeBeneficiary(users_.dtAdmin.address);
      await DatasetNFT_.setDeployerFeeModelPercentages(
        [DeployerFeeModel.DEPLOYER_STORAGE],
        [parseUnits('0.35')]
      );
      await DatasetNFT_.setDeployerFeeModel(datasetId_, DeployerFeeModel.DEPLOYER_STORAGE);

      const dataTag = encodeTag('data');
      const metadataTag = encodeTag('metadata');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.5', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [dataTag, metadataTag],
        [parseUnits('0.9', 18), parseUnits('0.1', 18)]
      );

      const feeAmount = parseUnits('100', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Ds owner: proposes a fragment
      const tags = [dataTag, metadataTag];
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          nextPendingFragmentId + BigInt(tags.length) - 1n,
          [users_.datasetOwner.address, users_.datasetOwner.address],
          tags
        )
      );
      await DatasetNFT_.connect(users_.datasetOwner).proposeManyFragments(
        datasetId_,
        [users_.datasetOwner.address, users_.datasetOwner.address],
        tags,
        proposeSignatureSchemas
      );

      // Contributor 1: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Approval 1: DS owner approves fragment proposal from Contributor 1
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('3000', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        30,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        30,
        1,
        maxSubscriptionFee
      );

      // Contributor 1 should be able to claim some revenue
      const firstPayment = await DatasetDistributionManager_.payments(0);
      let contributorPayout = parseUnits('438.75', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('3000', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 30, 1);
      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        30,
        1,
        maxSubscriptionFee
      );

      const secondPayment = await DatasetDistributionManager_.payments(1);

      // Contributor 1 should be able to claim some revenue again
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      contributorPayout = parseUnits('292.499999999999999707', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.contributor.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(
          users_.contributor.address,
          tokenAddress,
          parseUnits('292.499999999999999707', 18)
        );

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2 should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('292.499999999999999707', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.user.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, parseUnits('292.499999999999999707', 18));

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Ds owner should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.datasetOwner.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      contributorPayout = parseUnits('926.249999999999999707', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment, secondPayment],
          users_.datasetOwner.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await expect(
        DatasetDistributionManager_.connect(
          users_.datasetOwner
        ).claimDatasetOwnerAndFragmentPayouts(validSince, validTill, fragmentOwnerSignature)
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, parseUnits('1950', 18))
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, contributorPayout);
    });

    it('Should 2 metadata contributions be claimable from 2 subscription payments', async function () {
      await DatasetNFT_.setDeployerFeeBeneficiary(users_.dtAdmin.address);
      await DatasetNFT_.setDeployerFeeModelPercentages(
        [DeployerFeeModel.DEPLOYER_STORAGE],
        [parseUnits('0.35')]
      );
      await DatasetNFT_.setDeployerFeeModel(datasetId_, DeployerFeeModel.DEPLOYER_STORAGE);

      const dataTag = encodeTag('data');
      const metadataTag = encodeTag('metadata');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.5', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [dataTag, metadataTag],
        [parseUnits('0.9', 18), parseUnits('0.1', 18)]
      );

      const feeAmount = parseUnits('100', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Ds owner: proposes a fragment
      const tags = [dataTag, metadataTag];
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.datasetOwner.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.datasetOwner).proposeFragment(
        datasetId_,
        users_.datasetOwner.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Contributor 1: proposes a data fragment 1
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Approval 1: DS owner approves fragment proposal from Contributor 1
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 1: proposes a data fragment 2
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          dataTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        dataTag,
        proposeSignatureSchemas
      );

      // Approval 2: DS owner approves fragment proposal from Contributor 1
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 2: proposes a metadata fragment 1
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          metadataTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        metadataTag,
        proposeSignatureSchemas
      );

      // Approval 3: DS owner approves fragment proposal from Contributor 2
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('100', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        1,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      // Contributor 2 should be able to metadata claim some revenue
      let contributorPayout = parseUnits('3.25', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.user.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2: proposes a metadata fragment 2
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          metadataTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        metadataTag,
        proposeSignatureSchemas
      );

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('3000', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 1, 1);
      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        1,
        1,
        maxSubscriptionFee
      );

      const secondPayment = await DatasetDistributionManager_.payments(1);

      // Contributor 2 should be able to claim some revenue again
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      contributorPayout = parseUnits('3.25', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.user.address,
          tags,
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');

      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, parseUnits('3.25', 18));

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');
    });

    it('Should 3 contributors be able to claim revenue from 2 subscription payments', async function () {
      const schemaTag = encodeTag('dataset.schema');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.1', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [schemaTag],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('1', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 1 * 7 * 1 = 7

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Ds owner: proposes a fragment
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.datasetOwner.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.datasetOwner).proposeFragment(
        datasetId_,
        users_.datasetOwner.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Contributor 1: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Approval 1: DS owner approves fragment proposal from Contributor 1
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 2: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      // Contributor 1 should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      let contributorPayout = parseUnits('2.099999999999999997', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.contributor.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2 should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('2.099999999999999997', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [firstPayment],
          users_.user.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 3: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.consumer.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.consumer).proposeFragment(
        datasetId_,
        users_.consumer.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Approval 3: DS owner approves fragment proposal from Contributor 3 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.consumer.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.secondSubscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('10', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 10, 1);
      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        10,
        1,
        maxSubscriptionFee
      );

      const secondPayment = await DatasetDistributionManager_.payments(1);

      // Contributor 1 should be able to claim some revenue again
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('2.25', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.user.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 2 should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('2.25', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.user.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, contributorPayout);

      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');

      // Contributor 3 should be able to claim some revenue
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.consumer.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('2.25', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.consumer.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.consumer).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.consumer.address, tokenAddress, parseUnits('2.25'));

      await expect(
        DatasetDistributionManager_.connect(users_.consumer).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      ).to.not.emit(DatasetDistributionManager_, 'PayoutSent');
    });

    it('Should contributor not able to claim revenue if the contribution has not been approved', async function () {
      const schemaTag = encodeTag('dataset.schema');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [schemaTag],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

      const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          schemaTag
        )
      );

      // Contributor proposes a fragment
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        schemaTag,
        proposeSignatureSchemas
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      // Someone subscribes to the dataset
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      // DS owner approves fragments after someone subscribes to dataset
      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );
      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, 0n);
    });

    it('Should contributor not able to claim revenue if the contribution has been rejected', async function () {
      const schemaTag = encodeTag('dataset.schema');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [schemaTag],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

      const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          schemaTag
        )
      );

      // Contributor proposes a fragment
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        schemaTag,
        proposeSignatureSchemas
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      // Someone subscribes to the dataset
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      const validTill = validSince + constants.ONE_DAY;
      const fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      // DS owner approves fragments after someone subscribes to dataset
      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );
      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        false
      );

      await time.increase(constants.ONE_WEEK * 2);

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, 0n);
    });

    it('Should 2 contributors not able to claim revenue from 2 subscription payments if contributions have not been approved, only after', async function () {
      const schemaTag = encodeTag('dataset.schema');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.1', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [schemaTag],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('1', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 1 * 7 * 1 = 7

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Contributor 1: proposes a fragment
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      // Approval 1: DS owner approves fragment proposal from Contributor 1 after someone subscribes to dataset
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 1 should not be able to claim revenue, e.g. claimed 0
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, 0n);

      // Contributor 2: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.user.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);
      await DatasetSubscriptionManager_.connect(users_.user).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      // Contributor 1 now should be able to claim some revenue, someone subscribed after the fragment approval
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('6.3', 18));

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 2 should not be able to claim revenue, e.g. claimed 0
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, 0n);
    });

    it('Should 2 contributors not able to claim revenue from 3 subscription payments if contributions have not been approved, only after', async function () {
      const schemaTag = encodeTag('dataset.schema');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.1', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [schemaTag],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('1', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 1 * 7 * 1 = 7

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Contributor 1: proposes a fragment
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const firstPayment = await DatasetDistributionManager_.payments(0);

      // Approval 1: DS owner approves fragment proposal from Contributor 1 after someone subscribes to dataset
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 1 should not be able to claim revenue, e.g. claimed 0
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, 0n);

      // Contributor 2: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.user.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);
      await DatasetSubscriptionManager_.connect(users_.user).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const secondPayment = await DatasetDistributionManager_.payments(1);

      // Contributor 1 now should be able to claim some revenue, someone subscribed after the fragment approval
      let contributorPayout = parseUnits('6.3', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [secondPayment],
          users_.contributor.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 2 should not be able to claim revenue, e.g. claimed 0
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, 0n);

      // Subscription 3: someone subscribes to the dataset
      await users_.consumer.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);
      await DatasetSubscriptionManager_.connect(users_.consumer).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      const thirdPayment = await DatasetDistributionManager_.payments(2);

      // Contributor 1 now should be able to claim some revenue again
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('3.15', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [thirdPayment],
          users_.contributor.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, contributorPayout);

      // Contributor 2 now should be able to claim some revenue, someone subscribed after the fragment approval
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );
      contributorPayout = parseUnits('3.15', 18);
      expect(
        await verifyContributionPayoutIntegrity(
          datasetId_,
          [thirdPayment],
          users_.user.address,
          [schemaTag],
          tokenAddress,
          contributorPayout
        )
      ).to.equal('Success: checks passed');
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, contributorPayout);
    });

    it('Should 2 contributors (one approval, one rejection) not able to claim revenue from 2 subscription payments if contributions have not been approved/rejected, only after', async function () {
      const schemaTag = encodeTag('dataset.schema');
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.1', 18)
      );

      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [schemaTag],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('1', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 1 * 7 * 1 = 7

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const datasetFragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      // Contributor 1: proposes a fragment
      let nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      let proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.contributor.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Subscription 1: someone subscribes to the dataset
      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );
      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      // Approval 1: DS owner approves fragment proposal from Contributor 1 after someone subscribes to dataset
      let validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      let validTill = validSince + constants.ONE_DAY;
      let fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.contributor.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        false
      );

      // Contributor 1 should not be able to claim revenue, e.g. claimed 0
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, 0n);

      // Contributor 2: proposes a fragment
      nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;
      proposeSignatureSchemas = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          nextPendingFragmentId,
          users_.user.address,
          schemaTag
        )
      );
      await DatasetNFT_.connect(users_.user).proposeFragment(
        datasetId_,
        users_.user.address,
        schemaTag,
        proposeSignatureSchemas
      );

      // Subscription 2: someone subscribes to the dataset
      await users_.user.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('7', 18)
      );
      [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, 1);
      await DatasetSubscriptionManager_.connect(users_.user).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      // Contributor 1 should not be able to claim revenue because fragment proposal was rejected even if there are more subscriptions
      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, 0n);

      // Approval 2: DS owner approves fragment proposal from Contributor 2 after someone subscribes to dataset
      validSince =
        Number((await ethers.provider.getBlock('latest'))?.timestamp) + 1 + constants.ONE_WEEK * 2;
      validTill = validSince + constants.ONE_DAY;
      fragmentOwnerSignature = await users_.dtAdmin.signMessage(
        signature.getRevenueClaimMessage(
          network.config.chainId!,
          await DatasetDistributionManager_.getAddress(),
          users_.user.address,
          BigInt(validSince),
          BigInt(validTill)
        )
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      // Contributor 2 should not be able to claim revenue, e.g. claimed 0
      await time.increase(constants.ONE_WEEK * 2);
      await expect(
        DatasetDistributionManager_.connect(users_.user).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.user.address, tokenAddress, 0n);
    });

    it('Should contributor payout calculation be 0 if contribution is approved after payment subscription', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.001', 18)
      );

      const tokenAddress = await users_.subscriber.Token!.getAddress();

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      const feeAmount = parseUnits('864', 18); // totalSubscriptionFee for 1 week & 1 consumer :: 864 * 7 * 1 = 6048

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        feeAmount
      );

      const nextPendingFragmentId = (await DatasetFragment_.lastFragmentPendingId()) + 1n;

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

      const AcceptManuallyVerifier = await ethers.getContract<AcceptManuallyVerifier>(
        'AcceptManuallyVerifier'
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('6048', 18)
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7,
        1,
        maxSubscriptionFee
      );

      await AcceptManuallyVerifier.connect(users_.datasetOwner).resolve(
        datasetFragmentAddress,
        nextPendingFragmentId,
        true
      );

      expect(
        await DatasetDistributionManager_.calculatePayoutByToken(
          tokenAddress,
          users_.contributor.address
        )
      ).to.equal(0n);
    });
  });
}
