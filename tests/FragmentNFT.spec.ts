import {
  AcceptManuallyVerifier,
  DatasetFactory,
  DatasetNFT,
  FragmentNFT,
  VerifierManager,
} from "@typechained";
import { expect } from "chai";
import { ZeroAddress, ZeroHash, parseUnits, EventLog } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { v4 as uuidv4 } from "uuid";
import { signature, utils } from "./utils";
import { getEvent } from "./utils/events";
import { setupUsers, Signer } from "./utils/users";
import { encodeTag } from "./utils/utils";
import {
  IFragmentNFT_Interface_Id,
  IERC165_Interface_Id,
  IERC721_Interface_Id,
  IERC721Metadata_Interface_Id
} from "./utils/selectors";

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
    AcceptManuallyVerifier: (await ethers.getContract(
      "AcceptManuallyVerifier"
    )) as AcceptManuallyVerifier,
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
  
  const defaultVerifierAddress = await contracts.AcceptManuallyVerifier.getAddress();

  const feeAmount = parseUnits("0.1", 18);
  const dsOwnerPercentage = parseUnits("0.001", 18);

  const tag = utils.encodeTag("dataset.schemas");

  await contracts.DatasetFactory.connect(
    users.datasetOwner
  ).mintAndConfigureDataset(
    users.datasetOwner.address,
    signedMessage,
    defaultVerifierAddress,
    await users.subscriber.Token!.getAddress(),
    feeAmount,
    dsOwnerPercentage,
    [tag],
    [parseUnits("1", 18)]
  );

  //const tag = utils.encodeTag("dataset.schemas");

  const fragmentAddress = await contracts.DatasetNFT.fragments(datasetId);
  const DatasetFragment = (await ethers.getContractAt(
    "FragmentNFT",
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
      "FragmentPending",
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
    DatasetVerifierManager: (await ethers.getContractAt(
      "VerifierManager",
      await contracts.DatasetNFT.verifierManager(datasetId),
      users.datasetOwner
    )) as unknown as VerifierManager,
    ...contracts,
  };
};

describe("FragmentNFT", () => {
  let snap: string;
  let DatasetFactory_: DatasetFactory;
  let DatasetNFT_: DatasetNFT;
  let FragmentNFTImplementation_: FragmentNFT;
  let AcceptManuallyVerifier_: AcceptManuallyVerifier;
  let DatasetVerifierManager_: VerifierManager;
  let DatasetFragment_: FragmentNFT;
  let users_: Record<string, Signer>;
  let datasetId_: bigint;
  let fragmentIds_ : bigint[];

  before(async () => {
    const {
      DatasetFactory,
      DatasetNFT,
      FragmentNFTImplementation,
      AcceptManuallyVerifier,
      DatasetVerifierManager,
      DatasetFragment,
      users,
      datasetId,
      fragmentIds
    } = await setup();

    DatasetFactory_ = DatasetFactory;
    DatasetNFT_ = DatasetNFT;
    FragmentNFTImplementation_ = FragmentNFTImplementation;
    AcceptManuallyVerifier_ = AcceptManuallyVerifier;
    DatasetVerifierManager_ = DatasetVerifierManager;
    DatasetFragment_ = DatasetFragment;
    users_ = users;
    datasetId_ = datasetId;
    fragmentIds_ = fragmentIds;
  });

  beforeEach(async () => {
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
  });

  it("Should data set owner set verifiers for single tag", async function () {
    const acceptManuallyVerifierAddress =
      await AcceptManuallyVerifier_.getAddress();

    const schemaRowsTag = encodeTag("dataset.schema.rows");

    expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(
      ZeroAddress
    );

    await DatasetVerifierManager_.connect(users_.datasetOwner).setTagVerifier(
      schemaRowsTag,
      acceptManuallyVerifierAddress
    );

    expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(
      acceptManuallyVerifierAddress
    );
  });

  it("Should data set owner set verifiers for multiple tags", async function () {
    const acceptManuallyVerifierAddress =
      await AcceptManuallyVerifier_.getAddress();

    const schemaRowsTag = encodeTag("dataset.schema.rows");
    const schemaColsTag = encodeTag("dataset.schema.cols");

    expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(
      ZeroAddress
    );
    expect(await DatasetVerifierManager_.verifiers(schemaColsTag)).to.be.equal(
      ZeroAddress
    );

    await DatasetVerifierManager_.connect(users_.datasetOwner).setTagVerifiers(
      [schemaRowsTag, schemaColsTag],
      [acceptManuallyVerifierAddress, acceptManuallyVerifierAddress]
    );

    expect(await DatasetVerifierManager_.verifiers(schemaRowsTag)).to.be.equal(
      acceptManuallyVerifierAddress
    );
    expect(await DatasetVerifierManager_.verifiers(schemaColsTag)).to.be.equal(
      acceptManuallyVerifierAddress
    );
  });

  it("Should currentSnapshotId() return the correct index of Snapshots array", async () => {
    // Currently only 1 element is pushed into the snapshots array (during initialize() call)
    const expectedIndex = 0; 

    const idx = await DatasetFragment_.currentSnapshotId();
    expect(idx).to.equal(expectedIndex);
  });

  it("Should tagCountAt() revert when provided snapshotId is not valid", async () => {
    const lastSnapshotIdx = await DatasetFragment_.currentSnapshotId();
    const invalidSnapshotIdx = lastSnapshotIdx + BigInt(1);

    await expect(DatasetFragment_.tagCountAt(invalidSnapshotIdx)).to.be.revertedWith("bad snapshot id");
  });

  it("Should accountTagCountAt() revert when provided snapshotId is not valid", async () => {
    const lastSnapshotIdx = await DatasetFragment_.currentSnapshotId();
    const invalidSnapshotIdx = lastSnapshotIdx + BigInt(1);

    await expect(DatasetFragment_.accountTagCountAt(invalidSnapshotIdx, ZeroAddress)).to.be.revertedWith("bad snapshot id");
  });

  it("Should accountTagPercentageAt() revert when provided snapshotId is not valid", async () => {
    const lastSnapshotIdx = await DatasetFragment_.currentSnapshotId();
    const invalidSnapshotIdx = lastSnapshotIdx + BigInt(1);
    const mockTag = encodeTag("mock");

    await expect(DatasetFragment_.accountTagPercentageAt(invalidSnapshotIdx, ZeroAddress, [mockTag])).to.be.revertedWith("bad snapshot id");
  });

  it("Should revert data set owner set verifiers for tags if length does not match", async function () {
    const acceptManuallyVerifierAddress =
      await AcceptManuallyVerifier_.getAddress();

    const schemaRowsTag = encodeTag("dataset.schema.rows");
    const schemaColsTag = encodeTag("dataset.schema.cols");

    await expect(
      DatasetVerifierManager_.connect(users_.datasetOwner).setTagVerifiers(
        [schemaRowsTag, schemaColsTag],
        [acceptManuallyVerifierAddress]
      )
    ).to.be.revertedWith("Array length missmatch");
  });

  it("Should revert fragment propose if verifier is not set", async function () {
    await DatasetVerifierManager_.connect(users_.datasetOwner).setDefaultVerifier(
      ZeroAddress
    );

    const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    const datasetAddress = await DatasetNFT_.getAddress();

    const lastFragmentPendingId = await DatasetFragment.lastFragmentPendingId();

    const proposeSignatureSchemas = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId_,
        lastFragmentPendingId + 1n,
        users_.contributor.address,
        ZeroHash
      )
    );

    await expect(
      DatasetNFT_.connect(users_.contributor).proposeFragment(
        datasetId_,
        users_.contributor.address,
        ZeroHash,
        proposeSignatureSchemas
      )
    ).to.be.revertedWith("verifier not set");
  });

  it("Should data set owner accept fragment propose", async function () {
    const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        fragmentAddress,
        fragmentIds_[0],
        true
      )
    )
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[0])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds_[0]);
  });

  it("Should data set owner accept multiple fragments proposes", async function () {
    const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier_.connect(users_.datasetOwner).resolveMany(
        fragmentAddress,
        fragmentIds_,
        true
      )
    )
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[0])
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[1])
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users_.contributor.address, fragmentIds_[2])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds_[0])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds_[1])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds_[2]);
  });

  it("Should data set owner reject fragment propose", async function () {
    const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        fragmentAddress,
        fragmentIds_[0],
        false
      )
    )
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds_[0]);
  });

  it("Should data set owner reject multiple fragments proposes", async function () {
    const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier_.connect(users_.datasetOwner).resolveMany(
        fragmentAddress,
        fragmentIds_,
        false
      )
    )
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds_[0])
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds_[1])
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds_[2]);
  });

  it("Should revert accept/reject fragment propose if fragment id does not exists", async function () {
    const fragmentAddress = await DatasetNFT_.fragments(datasetId_);
    const wrongFragmentId = 1232131231;

    await expect(
      AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        fragmentAddress,
        wrongFragmentId,
        false
      )
    ).to.be.revertedWith("Not a pending fragment");

    await expect(
      AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
        fragmentAddress,
        wrongFragmentId,
        true
      )
    ).to.be.revertedWith("Not a pending fragment");
  });

  it("Should data set owner remove a fragment", async function () {
    await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
      await DatasetFragment_.getAddress(),
      fragmentIds_[0],
      true
    );

    await expect(
      DatasetFragment_.connect(users_.datasetOwner).remove(fragmentIds_[0])
    )
      .to.emit(DatasetFragment_, "FragmentRemoved")
      .withArgs(fragmentIds_[0]);

    expect(await DatasetFragment_.tags(fragmentIds_[0])).to.equal(ZeroHash);
  });

  it("Should revert if user tries to remove a fragment", async function () {
    await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolve(
      await DatasetFragment_.getAddress(),
      fragmentIds_[0],
      true
    );

    await expect(
      DatasetFragment_.connect(users_.user).remove(fragmentIds_[0])
    ).to.be.revertedWithCustomError(DatasetFragment_, "NOT_ADMIN");
  });

  it("Should tagCountAt() return the correct tags and their number of times approved for the snapshotId provided", async () => {
    const tag1 = encodeTag("dataset.schemas");
    const tag2 = encodeTag("dataset.rows");
    const tag3 = encodeTag("dataset.columns");
    const tag4 = encodeTag("dataset.metadata");

    const datasetAddress = await DatasetNFT_.getAddress();
    const fragmentAddress = await DatasetFragment_.getAddress();
    const fragmentCnt = (await DatasetFragment_.lastFragmentPendingId());

    expect(fragmentCnt).to.equal(3); // Already 3 proposals have been made (during setup, but not resolved yet)

    const fragmentOwner = users_.contributor.address;

    const expectedFragmentIds = [fragmentCnt +1n, fragmentCnt + 2n, fragmentCnt + 3n, fragmentCnt + 4n];
    
    const proposeFragmentsSig = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeBatchMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId_,
        fragmentCnt + 1n,
        [fragmentOwner, fragmentOwner, fragmentOwner, fragmentOwner],
        [tag1, tag2, tag3, tag4]
      )
    );

    await expect(await DatasetNFT_.connect(users_.contributor).proposeManyFragments(
      datasetId_,
      [fragmentOwner, fragmentOwner, fragmentOwner, fragmentOwner],
      [tag1, tag2, tag3, tag4],
      proposeFragmentsSig
    ))
    .to.emit(DatasetFragment_, "FragmentPending")
    .withArgs(expectedFragmentIds[0], tag1)
    .to.emit(DatasetFragment_, "FragmentPending")
    .withArgs(expectedFragmentIds[1], tag2)
    .to.emit(DatasetFragment_, "FragmentPending")
    .withArgs(expectedFragmentIds[2], tag3)
    .to.emit(DatasetFragment_, "FragmentPending")
    .withArgs(expectedFragmentIds[3], tag4);
    
    // Only when fragments are approved will the respective snapshot struct be populated 
    await AcceptManuallyVerifier_.connect(users_.datasetOwner).resolveMany(fragmentAddress, expectedFragmentIds, true);
    
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

  it("Should snapshot() revert if msgSender is not the configured DistributionManager", async () => {
    await expect(DatasetFragment_.connect(users_.dtAdmin).snapshot())
    .to.be.revertedWithCustomError(DatasetFragment_, "NOT_DISTRIBUTION_MANAGER").withArgs(users_.dtAdmin.address);

    await expect(DatasetFragment_.connect(users_.datasetOwner).snapshot())
    .to.be.revertedWithCustomError(DatasetFragment_, "NOT_DISTRIBUTION_MANAGER").withArgs(users_.datasetOwner.address);
  });

  it("Should propose() revert if msgSender is not the DatasetNFT", async () => {
    const mockTag = encodeTag("mock");
    const datasetAddress = await DatasetNFT_.getAddress();
    const fragmentCnt = (await DatasetFragment_.lastFragmentPendingId());

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

    await expect(DatasetFragment_.connect(users_.dtAdmin).propose(users_.contributor.address, mockTag, mockSignature))
    .to.be.revertedWithCustomError(DatasetFragment_, "NOT_DATASET_NFT").withArgs(users_.dtAdmin.address);
  });

  it("Should proposeMany() revert if msgSender is not the DatasetNFT", async () => {
    const mockTag1 = encodeTag("mock1");
    const mockTag2 = encodeTag("mock2");
    const datasetAddress = await DatasetNFT_.getAddress();
    const fragmentCnt = (await DatasetFragment_.lastFragmentPendingId());

    const mockSignature = await users_.dtAdmin.signMessage(
      signature.getDatasetFragmentProposeBatchMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId_,
        fragmentCnt,
        [users_.contributor.address, users_.contributor.address],
        [mockTag1, mockTag2]
      )
    );

    await expect(DatasetFragment_.connect(users_.dtAdmin).proposeMany(
      [
        users_.contributor.address,
        users_.contributor.address
      ],
      [
        mockTag1,
        mockTag2
      ],
      mockSignature
    )).to.be.revertedWithCustomError(DatasetFragment_, "NOT_DATASET_NFT").withArgs(users_.dtAdmin.address);
  });

  it("Should accept() revert if msgSender is not the configured VerifierManager", async () => {
    await expect(DatasetFragment_.connect(users_.dtAdmin).accept(0))
      .to.be.revertedWithCustomError(DatasetFragment_, "NOT_VERIFIER_MANAGER").withArgs(users_.dtAdmin.address);
  });

  it("Should reject() revert if msgSender is not the configured VerifierManager", async () => {
    await expect(DatasetFragment_.connect(users_.dtAdmin).reject(0))
      .to.be.revertedWithCustomError(DatasetFragment_, "NOT_VERIFIER_MANAGER").withArgs(users_.dtAdmin.address);
  });

  it("Should supportsInterface() return true if id provided is either IFragmentNFT, IERC721 or IERC165", async () => {
    let val = await DatasetFragment_.supportsInterface(IERC165_Interface_Id);
    expect(val).to.be.true;

    val = await DatasetFragment_.supportsInterface(IFragmentNFT_Interface_Id);
    expect(val).to.be.true;

    val = await DatasetFragment_.supportsInterface(IERC721_Interface_Id);
    expect(val).to.be.true;

    val = await DatasetFragment_.supportsInterface(IERC721Metadata_Interface_Id);
    expect(val).to.be.true;
  });

  it("Should supportsInterface() return false if provided id is not supported", async () => {
    const mockInterfaceId = "0xff123456";
    let val = await DatasetFragment_.supportsInterface(mockInterfaceId);
    expect(val).to.be.false;
  });
});
