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
import { ZeroHash, parseUnits, Contract, formatUnits } from 'ethers';
import { deployments, ethers, network } from 'hardhat';
import { expect } from 'chai';
import { v4 as uuidv4 } from 'uuid';
import { constants, signature, utils } from './utils';
import * as models from '../utils';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { getEvent } from './utils/events';
import { setupUsers, Signer } from './utils/users';
import { encodeTag } from './utils/utils';

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

  const uuidSetTxReceipt = await (
    await contracts.DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID)
  ).wait();

  const [, datasetId] = getEvent('DatasetUuidSet', uuidSetTxReceipt?.logs!, contracts.DatasetNFT)!
    .args as unknown as [string, bigint];

  const datasetAddress = await contracts.DatasetNFT.getAddress();
  const signedMessage = await users.dtAdmin.signMessage(
    signature.getDatasetMintMessage(network.config.chainId!, datasetAddress, datasetId)
  );
  const defaultVerifierAddress = await (
    await ethers.getContract('AcceptManuallyVerifier')
  ).getAddress();
  const feeAmount = parseUnits('0.1', 18); // FeePerConsumerPerDay
  const dsOwnerPercentage = parseUnits('0.001', 18);

  await contracts.DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
    users.datasetOwner.address,
    signedMessage,
    defaultVerifierAddress,
    await users.datasetOwner.Token!.getAddress(),
    feeAmount,
    dsOwnerPercentage,
    [ZeroHash],
    [parseUnits('1', 18)]
  );

  const fragmentAddress = await contracts.DatasetNFT.fragments(datasetId);
  const DatasetFragment = await ethers.getContractAt('FragmentNFT', fragmentAddress);
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
    let DatasetFragment_: Contract;
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

    it('Should data set owner set its percentage to be sent on each payment', async function () {
      const percentage = parseUnits('0.01', 18);

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        percentage
      );

      expect(await DatasetDistributionManager_.datasetOwnerPercentage()).to.equal(percentage);
    });

    it('Should revert if data set owner percentage set is higher than 50%', async function () {
      const percentage = parseUnits('0.50001', 18);

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(percentage)
      ).to.be.revertedWith("Can't be higher than 50%");
    });

    it('Should revert set percentage if sender is not the data set owner', async function () {
      const percentage = parseUnits('0.4', 18);

      await expect(
        DatasetDistributionManager_.connect(users_.user).setDatasetOwnerPercentage(percentage)
      )
      .to.be.revertedWith("Only Dataset owner");
    });

    it('Should data set owner set data set tag weights', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );
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

    it('Should getTagWeights() revet if empty tags array is passed as input argument', async function () {
      await expect(
        DatasetDistributionManager_.connect(users_.user).getTagWeights([])
      ).to.be.revertedWith('No tags provided');
    });

    it('Should revert set tag weights if weights sum is not equal to 100%', async function () {
      const datasetSchemasTag = utils.encodeTag('dataset.schemas');
      const datasetRowsTag = utils.encodeTag('dataset.rows');

      await expect(
        DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
          [datasetSchemasTag, datasetRowsTag],
          [parseUnits('0.4', 18), parseUnits('0.8', 18)]
        )
      ).to.be.revertedWith('Invalid weights sum');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7, // 7 days
        1
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        7, // 7 days
        1
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
      ).to.be.revertedWith('No unclaimed payments available');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
      ).to.be.revertedWith('Only Dataset owner');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

    it('Should datasetOwner claim revenue from both contributing & being the owner via the `claimDatasetOwnerAndFragmentPayouts()`', async () => {
      const percentageForFeeModels = [parseUnits('0.1', 18), parseUnits('0.35', 18)];

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
        [
          models.constants.DeployerFeeModel.DATASET_OWNER_STORAGE,
          models.constants.DeployerFeeModel.DEPLOYER_STORAGE,
        ],
        percentageForFeeModels
      );

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModel(
        datasetId_,
        models.constants.DeployerFeeModel.DATASET_OWNER_STORAGE
      );

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
      await expect(
        DatasetDistributionManager_.connect(
          users_.datasetOwner
        ).claimDatasetOwnerAndFragmentPayouts(validSince, validTill, DatasetOwnerRevenue_Signature)
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, parseUnits('544.32', 18))
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.datasetOwner.address, tokenAddress, parseUnits('2449.44', 18));

      // contributor should be able to claim his revenue
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('3020.976', 18));
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await newFeeToken.getAddress(),
        parseUnits('86.4', 18)
      );

      await newFeeToken
        .connect(users_.secondSubscriber)
        .approve(await DatasetSubscriptionManager_.getAddress(), parseUnits('604.8', 18));

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        7,
        1
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await newFeeToken.getAddress(),
        parseUnits('86.4', 18)
      );

      await newFeeToken
        .connect(users_.secondSubscriber)
        .approve(await DatasetSubscriptionManager_.getAddress(), parseUnits('604.8', 18));

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        7,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        tokenAddress,
        parseUnits('8.64', 18)
      );

      await users_.user.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('60.48', 18)
      );

      await DatasetSubscriptionManager_.connect(users_.user).subscribe(datasetId_, 7, 1);

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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        28,
        1
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        28,
        1
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
      ).to.be.revertedWith('No unclaimed payments available');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('302.0976', 18));

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

      await DatasetSubscriptionManager_.connect(users_.secondSubscriber).subscribe(
        datasetId_,
        28,
        1
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

      await expect(
        DatasetDistributionManager_.connect(users_.contributor).claimPayouts(
          validSince,
          validTill,
          fragmentOwnerSignature
        )
      )
        .to.emit(DatasetDistributionManager_, 'PayoutSent')
        .withArgs(users_.contributor.address, tokenAddress, parseUnits('1208.3904', 18));

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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
      ).to.be.revertedWith('signature overdue');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
      ).to.be.revertedWith('signature overdue');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
      ).to.be.revertedWith('signature overdue');

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
      ).to.be.revertedWith('signature overdue');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

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
      ).to.be.revertedWith('signature overdue');

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
      ).to.be.revertedWith('signature overdue');
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

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(tokenAddress, feeAmount);

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 7, 1);

      // 2 contributors (dtOwner & contributor, thus payout for fragment owners will be split in half:
      // 6048(totalFee) - 6.048(ownerFee) = 6041.952 for contributors) ,two contributors thus, 6041.952/2 == 3020.976

      expect(
        await DatasetDistributionManager_.calculatePayoutByToken(
          tokenAddress,
          users_.contributor.address
        )
      ).to.equal(parseUnits('3020.976', 18));
    });
  });
}
