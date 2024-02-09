import {
  AcceptManuallyVerifier,
  DatasetFactory,
  DatasetNFT,
  DistributionManager,
  ERC20SubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from '@typechained';
import { expect } from 'chai';
import { ZeroAddress, ZeroHash, parseUnits, EventLog } from 'ethers';
import { deployments, ethers, network } from 'hardhat';
import { v4 as uuidv4 } from 'uuid';
import { signature, utils } from './utils';
import { getEvent } from './utils/events';
import { setupUsers, Signer } from './utils/users';
import { encodeTag, getUuidHash, getUint256FromBytes32 } from './utils/utils';
import {
  IFragmentNFT_Interface_Id,
  IERC165_Interface_Id,
  IERC721_Interface_Id,
  IERC721Metadata_Interface_Id,
  IVerifierManager_Interface_Id,
  ISubscriptionManager_Interface_Id,
  IDistributionManager_Interface_Id,
} from './utils/selectors';
import { APPROVED_TOKEN_ROLE } from './../utils/constants';
import { BASE_URI, FRAGMENT_NFT_SUFFIX } from './utils/constants';

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
    AcceptManuallyVerifier: (await ethers.getContract(
      'AcceptManuallyVerifier'
    )) as AcceptManuallyVerifier,
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

  const defaultVerifierAddress = await contracts.AcceptManuallyVerifier.getAddress();

  const feeAmount = parseUnits('0.1', 18);
  const dsOwnerPercentage = parseUnits('0.001', 18);

  const tag = utils.encodeTag('dataset.schemas');

  const mintAndConfigureDatasetReceipt = await (
    await contracts.DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
      uuidHash,
      users.datasetOwner.address,
      signedMessage,
      defaultVerifierAddress,
      await users.subscriber.Token!.getAddress(),
      feeAmount,
      dsOwnerPercentage,
      [tag],
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

  let fragmentIds: bigint[] = [];

  // Propose 3 contributions of the tag `tag`
  for (const _ of [1, 1, 1]) {
    const lastFragmentPendingId = await DatasetFragment.lastFragmentPendingId();

    const proposeSignatureSchemas = await users.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        lastFragmentPendingId + 1n,
        users.contributor.address,
        tag
      )
    );

    const proposedFragmentTxReceipt = await (
      await contracts.DatasetNFT.connect(users.contributor).proposeFragment(
        datasetId,
        users.contributor.address,
        tag,
        proposeSignatureSchemas
      )
    ).wait();

    const [fragmentId] = getEvent(
      'FragmentPending',
      proposedFragmentTxReceipt?.logs!,
      DatasetFragment
    )!.args as unknown as [bigint, string];

    fragmentIds.push(fragmentId);
  }

  return {
    datasetId,
    fragmentIds,
    DatasetFragment,
    users,
    DatasetSubscriptionManager: (await ethers.getContractAt(
      'ERC20SubscriptionManager',
      await contracts.DatasetNFT.subscriptionManager(datasetId)
    )) as unknown as ERC20SubscriptionManager,
    DatasetDistributionManager: (await ethers.getContractAt(
      'DistributionManager',
      await contracts.DatasetNFT.distributionManager(datasetId),
      users.datasetOwner
    )) as unknown as DistributionManager,
    DatasetVerifierManager: (await ethers.getContractAt(
      'VerifierManager',
      await contracts.DatasetNFT.verifierManager(datasetId),
      users.datasetOwner
    )) as unknown as VerifierManager,
    ...contracts,
  };
};

export default async function suite(): Promise<void> {
  describe('FragmentNFT', () => {
    let snap: string;
    let DatasetFactory_: DatasetFactory;
    let DatasetNFT_: DatasetNFT;
    let FragmentNFTImplementation_: FragmentNFT;
    let AcceptManuallyVerifier_: AcceptManuallyVerifier;
    let DatasetDistributionManager_: DistributionManager;
    let DatasetSubscriptionManager_: ERC20SubscriptionManager;
    let DatasetVerifierManager_: VerifierManager;
    let DatasetFragment_: FragmentNFT;
    let users_: Record<string, Signer>;
    let datasetId_: bigint;
    let fragmentIds_: bigint[];

    before(async () => {
      const {
        DatasetFactory,
        DatasetNFT,
        FragmentNFTImplementation,
        AcceptManuallyVerifier,
        DatasetSubscriptionManager,
        DatasetDistributionManager,
        DatasetVerifierManager,
        DatasetFragment,
        users,
        datasetId,
        fragmentIds,
      } = await setup();

      DatasetFactory_ = DatasetFactory;
      DatasetNFT_ = DatasetNFT;
      FragmentNFTImplementation_ = FragmentNFTImplementation;
      AcceptManuallyVerifier_ = AcceptManuallyVerifier;
      DatasetSubscriptionManager_ = DatasetSubscriptionManager;
      DatasetDistributionManager_ = DatasetDistributionManager;
      DatasetVerifierManager_ = DatasetVerifierManager;
      DatasetFragment_ = DatasetFragment;
      users_ = users;
      datasetId_ = datasetId;
      fragmentIds_ = fragmentIds;
    });

    beforeEach(async () => {
      snap = await ethers.provider.send('evm_snapshot', []);
    });

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [snap]);
    });

    it('Should FragmentNFT contract URI be set if base URI is set', async () => {
      await DatasetNFT_.connect(users_.dtAdmin).setBaseURI(BASE_URI);

      const datasetTokenURI = await DatasetNFT_.tokenURI(datasetId_);

      expect(await DatasetFragment_.contractURI()).to.equal(
        datasetTokenURI + '/' + FRAGMENT_NFT_SUFFIX
      );
    });

    it('Should FragmentNFT contract URI be empty if base URI is not set', async () => {
      expect(await DatasetFragment_.contractURI()).to.equal('');
    });

    it('Should retrieve token URI if fragment exists', async () => {
      await DatasetNFT_.connect(users_.dtAdmin).setBaseURI(BASE_URI);

      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        fragmentAddress,
        fragmentIds_[0],
        true
      );

      const datasetTokenURI = await DatasetNFT_.tokenURI(datasetId_);

      expect(await DatasetFragment_.tokenURI(fragmentIds_[0])).to.equal(
        datasetTokenURI + '/' + FRAGMENT_NFT_SUFFIX + '/' + fragmentIds_[0]
      );
    });

    it('Should token URI be empty if baseURI is not set', async () => {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        fragmentAddress,
        fragmentIds_[0],
        true
      );

      expect(await DatasetFragment_.tokenURI(fragmentIds_[0])).to.equal('');
    });

    it('Should revert retrieving token URI if dataset id does not exists', async () => {
      const wrongFragmentId = 2312312312321;
      await expect(DatasetFragment_.tokenURI(wrongFragmentId))
        .to.be.revertedWithCustomError(DatasetFragment_, 'TOKEN_ID_NOT_EXISTS')
        .withArgs(wrongFragmentId);
    });

    it('Should data set owner set verifiers for single tag', async function () {
      const acceptManuallyVerifierAddress = await AcceptManuallyVerifier_.getAddress();

      const schemaRowsTag = encodeTag('dataset.schema.rows');

      expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(ZeroAddress);

      await expect(
        DatasetVerifierManager_.connect(users_.datasetOwner).setTagVerifier(
          schemaRowsTag,
          acceptManuallyVerifierAddress
        )
      )
        .to.emit(DatasetVerifierManager_, 'FragmentTagVerifierSet')
        .withArgs(acceptManuallyVerifierAddress, schemaRowsTag);

      expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(
        acceptManuallyVerifierAddress
      );
    });

    it('Should revert set verifiers for single tag if it is not dataset owner', async function () {
      const acceptManuallyVerifierAddress = await AcceptManuallyVerifier_.getAddress();
      const schemaRowsTag = encodeTag('dataset.schema.rows');

      await expect(
        DatasetVerifierManager_.connect(users_.user).setTagVerifier(
          schemaRowsTag,
          acceptManuallyVerifierAddress
        )
      )
        .to.be.revertedWithCustomError(DatasetVerifierManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should data set owner set verifiers for multiple tags', async function () {
      const acceptManuallyVerifierAddress = await AcceptManuallyVerifier_.getAddress();

      const schemaRowsTag = encodeTag('dataset.schema.rows');
      const schemaColsTag = encodeTag('dataset.schema.cols');

      expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(ZeroAddress);
      expect(await DatasetVerifierManager_.verifiers(schemaColsTag)).to.be.equal(ZeroAddress);

      await expect(
        DatasetVerifierManager_.connect(users_.datasetOwner).setTagVerifiers(
          [schemaRowsTag, schemaColsTag],
          [acceptManuallyVerifierAddress, acceptManuallyVerifierAddress]
        )
      )
        .to.emit(DatasetVerifierManager_, 'FragmentTagVerifierSet')
        .withArgs(acceptManuallyVerifierAddress, schemaRowsTag)
        .to.emit(DatasetVerifierManager_, 'FragmentTagVerifierSet')
        .withArgs(acceptManuallyVerifierAddress, schemaColsTag);

      expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(
        acceptManuallyVerifierAddress
      );
      expect(await DatasetVerifierManager_.verifiers(schemaColsTag)).to.be.equal(
        acceptManuallyVerifierAddress
      );
    });

    it('Should revert set verifiers for multiple tags if it is not dataset owner', async function () {
      const acceptManuallyVerifierAddress = await AcceptManuallyVerifier_.getAddress();

      const schemaRowsTag = encodeTag('dataset.schema.rows');
      const schemaColsTag = encodeTag('dataset.schema.cols');

      await expect(
        DatasetVerifierManager_.connect(users_.user).setTagVerifiers(
          [schemaRowsTag, schemaColsTag],
          [acceptManuallyVerifierAddress, acceptManuallyVerifierAddress]
        )
      )
        .to.be.revertedWithCustomError(DatasetVerifierManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should currentSnapshotId() return the correct index of Snapshots array', async () => {
      // Currently only 1 element is pushed into the snapshots array (during initialize() call)
      const expectedIndex = 1;

      const idx = await DatasetFragment_.currentSnapshotId();
      expect(idx).to.equal(expectedIndex);
    });

    it('Should tagCountAt() revert when provided snapshotId is not valid', async () => {
      const lastSnapshotIdx = await DatasetFragment_.currentSnapshotId();
      const invalidSnapshotIdx = lastSnapshotIdx + BigInt(1);

      await expect(DatasetFragment_.tagCountAt(invalidSnapshotIdx)).to.be.revertedWithCustomError(
        DatasetFragment_,
        'BAD_SNAPSHOT_ID'
      );
    });

    it('Should accountTagCountAt() revert when provided snapshotId is not valid', async () => {
      const lastSnapshotIdx = await DatasetFragment_.currentSnapshotId();
      const invalidSnapshotIdx = lastSnapshotIdx + BigInt(1);

      await expect(
        DatasetFragment_.accountTagCountAt(invalidSnapshotIdx, ZeroAddress)
      ).to.be.revertedWithCustomError(DatasetFragment_, 'BAD_SNAPSHOT_ID');
    });

    it('Should accountTagPercentageAt() revert when provided snapshotId is not valid', async () => {
      const lastSnapshotIdx = await DatasetFragment_.currentSnapshotId();
      const invalidSnapshotIdx = lastSnapshotIdx + BigInt(1);
      const mockTag = encodeTag('mock');

      await expect(
        DatasetFragment_.accountTagPercentageAt(invalidSnapshotIdx, ZeroAddress, [mockTag])
      ).to.be.revertedWithCustomError(DatasetFragment_, 'BAD_SNAPSHOT_ID');
    });

    it('Should revert data set owner set verifiers for tags if length does not match', async function () {
      const acceptManuallyVerifierAddress = await AcceptManuallyVerifier_.getAddress();

      const schemaRowsTag = encodeTag('dataset.schema.rows');
      const schemaColsTag = encodeTag('dataset.schema.cols');

      await expect(
        DatasetVerifierManager_.connect(users_.datasetOwner).setTagVerifiers(
          [schemaRowsTag, schemaColsTag],
          [acceptManuallyVerifierAddress]
        )
      ).to.be.revertedWithCustomError(DatasetVerifierManager_, 'ARRAY_LENGTH_MISMATCH');
    });

    it('Should revert set default tag verifier if it is not data set owner', async function () {
      await expect(
        DatasetVerifierManager_.connect(users_.user).setDefaultVerifier(
          await AcceptManuallyVerifier_.getAddress()
        )
      )
        .to.be.revertedWithCustomError(DatasetVerifierManager_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should revert set default tag verifier if it is zero address', async function () {
      await expect(
        DatasetVerifierManager_.connect(users_.datasetOwner).setDefaultVerifier(ZeroAddress)
      ).to.be.revertedWithCustomError(DatasetVerifierManager_, 'ZERO_ADDRESS');
    });

    it('Should data set owner accept fragment propose', async function () {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const DatasetFragment = await ethers.getContractAt('FragmentNFT', fragmentAddress);

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
          fragmentAddress,
          fragmentIds_[0],
          true
        )
      )
        .to.emit(DatasetFragment, 'Transfer')
        .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[0])
        .to.emit(DatasetFragment, 'FragmentAccepted')
        .withArgs(fragmentIds_[0]);
    });

    it('Should revert data set owner resolve fragment propose if fragment address is incorrect - AcceptManuallyVerifier', async function () {
      const invalidFragmentAddress = await DatasetNFT_.fragmentImplementation();

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
          invalidFragmentAddress,
          fragmentIds_[0],
          true
        )
      ).to.be.revertedWithCustomError(AcceptManuallyVerifier_, 'INVALID_FRAGMENT_NFT');
    });

    it('Should data set owner accept multiple fragments proposes', async function () {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const DatasetFragment = await ethers.getContractAt('FragmentNFT', fragmentAddress);

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolveMany(
          fragmentAddress,
          fragmentIds_,
          true
        )
      )
        .to.emit(DatasetFragment, 'Transfer')
        .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[0])
        .to.emit(DatasetFragment, 'Transfer')
        .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[1])
        .to.emit(DatasetFragment, 'Transfer')
        .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[2])
        .to.emit(DatasetFragment, 'FragmentAccepted')
        .withArgs(fragmentIds_[0])
        .to.emit(DatasetFragment, 'FragmentAccepted')
        .withArgs(fragmentIds_[1])
        .to.emit(DatasetFragment, 'FragmentAccepted')
        .withArgs(fragmentIds_[2]);
    });

    it('Should data set owner reject fragment propose', async function () {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const DatasetFragment = await ethers.getContractAt('FragmentNFT', fragmentAddress);

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
          fragmentAddress,
          fragmentIds_[0],
          false
        )
      )
        .to.emit(DatasetFragment, 'FragmentRejected')
        .withArgs(fragmentIds_[0]);
    });

    it('Should data set owner reject multiple fragments proposes', async function () {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const DatasetFragment = await ethers.getContractAt('FragmentNFT', fragmentAddress);

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolveMany(
          fragmentAddress,
          fragmentIds_,
          false
        )
      )
        .to.emit(DatasetFragment, 'FragmentRejected')
        .withArgs(fragmentIds_[0])
        .to.emit(DatasetFragment, 'FragmentRejected')
        .withArgs(fragmentIds_[1])
        .to.emit(DatasetFragment, 'FragmentRejected')
        .withArgs(fragmentIds_[2]);
    });

    it('Should revert accept/reject fragment propose if fragment id does not exists', async function () {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
      const wrongFragmentId = 1232131231;

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
          fragmentAddress,
          wrongFragmentId,
          false
        )
      )
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_PENDING_FRAGMENT')
        .withArgs(wrongFragmentId);

      await expect(
        AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
          fragmentAddress,
          wrongFragmentId,
          true
        )
      )
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_PENDING_FRAGMENT')
        .withArgs(wrongFragmentId);
    });

    it('Should revert accept/reject fragment resolve if sender is incorrect', async function () {
      await expect(
        DatasetVerifierManager_.connect(users_.datasetOwner).resolve(fragmentIds_[0], false)
      )
        .to.be.revertedWithCustomError(DatasetVerifierManager_, 'VERIFIER_WRONG_SENDER')
        .withArgs(users_.datasetOwner.address);

      await expect(
        DatasetVerifierManager_.connect(users_.datasetOwner).resolve(fragmentIds_[0], true)
      )
        .to.be.revertedWithCustomError(DatasetVerifierManager_, 'VERIFIER_WRONG_SENDER')
        .withArgs(users_.datasetOwner.address);
    });

    it('Should revert accept/reject fragment propose if it is not data set owner', async function () {
      const fragmentAddress = await DatasetNFT_.fragments(datasetId_);

      await expect(
        AcceptManuallyVerifier_.connect(users_.user).resolve(
          fragmentAddress,
          fragmentIds_[0],
          false
        )
      )
        .to.be.revertedWithCustomError(AcceptManuallyVerifier_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);

      await expect(
        AcceptManuallyVerifier_.connect(users_.user).resolve(fragmentAddress, fragmentIds_[0], true)
      )
        .to.be.revertedWithCustomError(AcceptManuallyVerifier_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should data set owner remove a fragment', async function () {
      await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        await DatasetFragment_.getAddress(),
        fragmentIds_[0],
        true
      );

      await expect(DatasetFragment_.connect(users_.datasetOwner).remove(fragmentIds_[0]))
        .to.emit(DatasetFragment_, 'FragmentRemoved')
        .withArgs(fragmentIds_[0]);

      expect(await DatasetFragment_.tags(fragmentIds_[0])).to.equal(ZeroHash);
    });

    it('Should data set owner remove many fragments', async function () {
      await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        await DatasetFragment_.getAddress(),
        fragmentIds_[0],
        true
      );

      await expect(DatasetFragment_.connect(users_.datasetOwner).removeMany(fragmentIds_))
        .to.emit(DatasetFragment_, 'FragmentRemoved')
        .withArgs(fragmentIds_[0])
        .to.emit(DatasetFragment_, 'FragmentRemoved')
        .withArgs(fragmentIds_[1])
        .to.emit(DatasetFragment_, 'FragmentRemoved')
        .withArgs(fragmentIds_[2]);

      expect(await DatasetFragment_.tags(fragmentIds_[0])).to.equal(ZeroHash);
    });

    it('Should revert if user tries to remove a fragment', async function () {
      await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        await DatasetFragment_.getAddress(),
        fragmentIds_[0],
        true
      );

      await expect(DatasetFragment_.connect(users_.user).remove(fragmentIds_[0]))
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_DATASET_OWNER')
        .withArgs(users_.user.address);
    });

    it('Should tagCountAt() return the correct tags and their number of times approved for the snapshotId provided', async () => {
      const tag1 = encodeTag('dataset.schemas');
      const tag2 = encodeTag('dataset.rows');
      const tag3 = encodeTag('dataset.columns');
      const tag4 = encodeTag('dataset.metadata');
      const tags = [tag1, tag2, tag3, tag4];

      const datasetAddress = await DatasetNFT_.getAddress();
      const fragmentAddress = await DatasetFragment_.getAddress();
      const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

      expect(lastFragmentPendingId).to.equal(3); // Already 3 proposals have been made (during setup, but not resolved yet)

      const fragmentOwner = users_.contributor.address;

      const expectedFragmentIds = [
        lastFragmentPendingId + 1n,
        lastFragmentPendingId + 2n,
        lastFragmentPendingId + 3n,
        lastFragmentPendingId + 4n,
      ];

      const proposeFragmentsSig = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          datasetAddress,
          datasetId_,
          lastFragmentPendingId + 1n,
          lastFragmentPendingId + BigInt(tags.length),
          [fragmentOwner, fragmentOwner, fragmentOwner, fragmentOwner],
          [tag1, tag2, tag3, tag4]
        )
      );

      await expect(
        await DatasetNFT_.connect(users_.contributor).proposeManyFragments(
          datasetId_,
          [fragmentOwner, fragmentOwner, fragmentOwner, fragmentOwner],
          [tag1, tag2, tag3, tag4],
          proposeFragmentsSig
        )
      )
        .to.emit(DatasetFragment_, 'FragmentPending')
        .withArgs(expectedFragmentIds[0], tag1)
        .to.emit(DatasetFragment_, 'FragmentPending')
        .withArgs(expectedFragmentIds[1], tag2)
        .to.emit(DatasetFragment_, 'FragmentPending')
        .withArgs(expectedFragmentIds[2], tag3)
        .to.emit(DatasetFragment_, 'FragmentPending')
        .withArgs(expectedFragmentIds[3], tag4);

      // Only when fragments are approved will the respective snapshot struct be populated
      await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolveMany(
        fragmentAddress,
        expectedFragmentIds,
        true
      );

      let snapshotIdx = await DatasetFragment_.currentSnapshotId();

      const result = await DatasetFragment_.tagCountAt(snapshotIdx);

      const tagsReturned = result[0];
      const numberOfApprovalsForEachTag = result[1];

      // Currently only 4 tags have been approved-resolved, and a single fragment for each exists
      // (i.e only one fragment exists corresponding to tag1, only one fragment exists corresponding to tag2, etc..)
      expect(tagsReturned.length).to.equal(4);
      expect(numberOfApprovalsForEachTag.length).to.equal(4);

      expect(tagsReturned[0]).to.equal(tag1);
      expect(tagsReturned[1]).to.equal(tag2);
      expect(tagsReturned[2]).to.equal(tag3);
      expect(tagsReturned[3]).to.equal(tag4);

      expect(numberOfApprovalsForEachTag[0]).to.equal(1);
      expect(numberOfApprovalsForEachTag[1]).to.equal(1);
      expect(numberOfApprovalsForEachTag[2]).to.equal(1);
      expect(numberOfApprovalsForEachTag[3]).to.equal(1);
    });

    it('Should revert if someone tries to call propose() directly in AcceptManuallyVerifier', async () => {
      const tag = utils.encodeTag('dataset.metadata');
      const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

      await expect(
        AcceptManuallyVerifier_.connect(users_.contributor).propose(
          await DatasetFragment_.getAddress(),
          lastFragmentPendingId + 1n,
          tag
        )
      )
        .to.be.revertedWithCustomError(AcceptManuallyVerifier_, 'NOT_VERIFIER_MANAGER')
        .withArgs(users_.contributor.address);
    });

    it('Should revert if someone tries to call propose() directly in VerifierManager', async () => {
      const tag = utils.encodeTag('dataset.metadata');
      const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

      await expect(
        DatasetVerifierManager_.connect(users_.contributor).propose(lastFragmentPendingId + 1n, tag)
      )
        .to.be.revertedWithCustomError(DatasetVerifierManager_, 'NOT_FRAGMENT_NFT')
        .withArgs(users_.contributor.address);
    });

    it('Should snapshot() revert if msgSender is not the configured DistributionManager', async () => {
      await expect(DatasetFragment_.connect(users_.dtAdmin).snapshot())
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_DISTRIBUTION_MANAGER')
        .withArgs(users_.dtAdmin.address);

      await expect(DatasetFragment_.connect(users_.datasetOwner).snapshot())
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_DISTRIBUTION_MANAGER')
        .withArgs(users_.datasetOwner.address);
    });

    it('Should propose() revert if msgSender is not the DatasetNFT', async () => {
      const mockTag = encodeTag('mock');
      const datasetAddress = await DatasetNFT_.getAddress();
      const fragmentCnt = await DatasetFragment_.lastFragmentPendingId();

      const mockSignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          datasetAddress,
          datasetId_,
          fragmentCnt,
          users_.contributor.address,
          mockTag
        )
      );

      await expect(
        DatasetFragment_.connect(users_.dtAdmin).propose(
          users_.contributor.address,
          mockTag,
          mockSignature
        )
      )
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_DATASET_NFT')
        .withArgs(users_.dtAdmin.address);
    });

    it('Should proposeMany() revert if msgSender is not the DatasetNFT', async () => {
      const mockTag1 = encodeTag('mock1');
      const mockTag2 = encodeTag('mock2');
      const tags = [mockTag1, mockTag2];

      const datasetAddress = await DatasetNFT_.getAddress();
      const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

      const mockSignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          datasetAddress,
          datasetId_,
          lastFragmentPendingId + 1n,
          lastFragmentPendingId + BigInt(tags.length),
          [users_.contributor.address, users_.contributor.address],
          tags
        )
      );

      await expect(
        DatasetFragment_.connect(users_.dtAdmin).proposeMany(
          [users_.contributor.address, users_.contributor.address],
          [mockTag1, mockTag2],
          mockSignature
        )
      )
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_DATASET_NFT')
        .withArgs(users_.dtAdmin.address);
    });

    it('Should accept() revert if msgSender is not the configured VerifierManager', async () => {
      await expect(DatasetFragment_.connect(users_.dtAdmin).accept(0))
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_VERIFIER_MANAGER')
        .withArgs(users_.dtAdmin.address);
    });

    it('Should reject() revert if msgSender is not the configured VerifierManager', async () => {
      await expect(DatasetFragment_.connect(users_.dtAdmin).reject(0))
        .to.be.revertedWithCustomError(DatasetFragment_, 'NOT_VERIFIER_MANAGER')
        .withArgs(users_.dtAdmin.address);
    });

    it('Should supportsInterface() return true if id provided is either IFragmentNFT, IERC721 or IERC165', async () => {
      expect(await DatasetFragment_.supportsInterface(IERC165_Interface_Id)).to.be.true;
      expect(await DatasetFragment_.supportsInterface(IFragmentNFT_Interface_Id)).to.be.true;
      expect(await DatasetFragment_.supportsInterface(IERC721_Interface_Id)).to.be.true;
      expect(await DatasetFragment_.supportsInterface(IERC721Metadata_Interface_Id)).to.be.true;
    });

    it('Should supportsInterface() return false if provided id is not supported', async () => {
      const mockInterfaceId = '0xff123456';
      expect(await DatasetFragment_.supportsInterface(mockInterfaceId)).to.be.false;
    });

    it('Should VerifierManager supportsInterface() return true if id provided is either IVerifierManager or IERC165', async () => {
      expect(await DatasetVerifierManager_.supportsInterface(IERC165_Interface_Id)).to.be.true;
      expect(await DatasetVerifierManager_.supportsInterface(IVerifierManager_Interface_Id)).to.be
        .true;
    });

    it('Should VerifierManager supportsInterface() return false if provided id is not supported', async () => {
      const mockInterfaceId = '0xff123456';
      expect(await DatasetVerifierManager_.supportsInterface(mockInterfaceId)).to.be.false;
    });

    it('Should SubscriptionManager supportsInterface() return true if id provided is either ISubscriptionManager or IERC165', async () => {
      expect(await DatasetSubscriptionManager_.supportsInterface(IERC165_Interface_Id)).to.be.true;
      expect(await DatasetSubscriptionManager_.supportsInterface(ISubscriptionManager_Interface_Id))
        .to.be.true;
    });

    it('Should SubscriptionManager supportsInterface() return false if provided id is not supported', async () => {
      const mockInterfaceId = '0xff123456';
      expect(await DatasetSubscriptionManager_.supportsInterface(mockInterfaceId)).to.be.false;
    });

    it('Should DistributionManager supportsInterface() return true if id provided is either IDistributionManager or IERC165', async () => {
      expect(await DatasetDistributionManager_.supportsInterface(IERC165_Interface_Id)).to.be.true;
      expect(await DatasetDistributionManager_.supportsInterface(IDistributionManager_Interface_Id))
        .to.be.true;
    });

    it('Should DistributionManager supportsInterface() return false if provided id is not supported', async () => {
      const mockInterfaceId = '0xff123456';
      expect(await DatasetDistributionManager_.supportsInterface(mockInterfaceId)).to.be.false;
    });
  });
}
