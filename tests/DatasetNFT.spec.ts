import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { DatasetFactory, DatasetNFT, DistributionManager, ERC20LinearSingleDatasetSubscriptionManager, FragmentNFT } from "@typechained";
import { Contract, ContractFactory, getBytes, parseUnits, uuidV4, ZeroAddress, ZeroHash, EventLog } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { signature, utils } from "./utils";
import { encodeTag } from "./utils/utils";
import { constants } from "../utils";
import { getEvent } from "./utils/events";
import { setupUsers } from "./utils/users";
import {Signer} from "./utils/users";
import {
  IDatasetNFT_Interface_Id,
  IERC165_Interface_Id,
  IERC721_Interface_Id,
  IAccessControl_Interface_Id,
  IERC721Metadata_Interface_Id
} from "./utils/selectors";

async function setup() {
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

  return {
    users,
    ...contracts,
  };
}

const setupOnMint = async () => {
  await deployments.fixture(["DatasetFactory"]);

  const contracts = {
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
  };

  const { DatasetNFT, DatasetFactory } = await setup();
  const users = await setupUsers();

  const datasetUUID = uuidv4();

  const uuidSetTxReceipt = await (
    await DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID)
  ).wait();

  const [uuid, datasetId] = getEvent(
    "DatasetUuidSet",
    uuidSetTxReceipt?.logs!,
    DatasetNFT
  )!.args as unknown as [string, bigint];

  const datasetAddress = await DatasetNFT.getAddress();
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

  await DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
    users.datasetOwner.address,
    signedMessage,
    defaultVerifierAddress,
    await users.datasetOwner.Token!.getAddress(),
    feeAmount,
    dsOwnerPercentage,
    [ZeroHash],
    [parseUnits("1", 18)]
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

  const fragmentAddress = await DatasetNFT.fragments(datasetId);
  const DatasetFragment = (await ethers.getContractAt(
    "FragmentNFT",
    fragmentAddress
  )) as unknown as FragmentNFT;

  return {
    datasetId,
    datasetUUID: uuid,
    DatasetFragment,
    users,
    ...contracts,
    ...factories,
  };
};

// ---------------------------------------------------------------------------------------------------

describe("DatasetNFT", () => {
  let snap: string;
  let users_: Record<string, Signer>;
  let DatasetNFT_: DatasetNFT;
  let DatasetFactory_: DatasetFactory;
  let FragmentNFTImplementation_: FragmentNFT;

  before(async () => {
    const {DatasetNFT, DatasetFactory, FragmentNFTImplementation, users} = await setup();

    users_ = users;
    DatasetNFT_ = DatasetNFT;
    DatasetFactory_ = DatasetFactory;
    FragmentNFTImplementation_ = FragmentNFTImplementation;

  });
  
  beforeEach(async () => {
    snap = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snap]);
  });


  it("Should dataset name be set on deploy", async function () {
    expect(await DatasetNFT_.name()).to.equal(
      "Data Tunnel Dataset"
    );
  });

  it("Should dataset symbol be set on deploy", async function () {
    expect(await DatasetNFT_.symbol()).to.equal("DTDS");
  });

  it("Should dataset fragment implementation be set on deploy", async function () {
    expect(await DatasetNFT_.fragmentImplementation()).to.equal(
      await FragmentNFTImplementation_.getAddress()
    );
  });

  it("Should DT admin be a signer", async function () {
    expect(await DatasetNFT_.isSigner(users_.dtAdmin)).to.be.true;
  });

  it("Should DT admin set a deployer beneficiary for fees", async function () {
    await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(
      users_.dtAdmin.address
    );

    expect(await DatasetNFT_.deployerFeeBeneficiary()).to.equal(
      users_.dtAdmin.address
    );
  });

  it("Should revert if non admin account tries to set deployer fee beneficiary address", async () => {
    await expect(DatasetNFT_.connect(users_.user).setDeployerFeeBeneficiary(
      users_.user.address
    )).to.be.revertedWith(`AccessControl: account ${users_.user.address.toLowerCase()} is missing role ${ZeroHash}`);
  });

  it("Should setDeployerFeeBeneficiary() revert if trying to set zeroAddress as the beneficiary", async () => {
    await expect(DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(
      ZeroAddress
    )).to.be.revertedWith("invalid zero address provided");
  });

  it("Should setDeployerFeeModelPercentages() revert if models and percentages length missmatch", async () => {
    const percentages = [parseUnits("0.1", 18), parseUnits("0.35", 18)];

    await expect(DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
      [
        constants.DeployerFeeModel.DATASET_OWNER_STORAGE,
        constants.DeployerFeeModel.DEPLOYER_STORAGE,
        constants.DeployerFeeModel.NO_FEE
      ],
      percentages)
    ).to.be.revertedWith("array length missmatch");
  });

  it("Should revert when trying to set feePercentage for NO_FEE model", async () => {
    const percentages = [parseUnits("0.35", 18), parseUnits("0.1", 18), parseUnits("0.05", 18)];

    await expect(DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
      [
        constants.DeployerFeeModel.DEPLOYER_STORAGE,
        constants.DeployerFeeModel.DATASET_OWNER_STORAGE,
        constants.DeployerFeeModel.NO_FEE
      ],
      percentages
    )).to.be.revertedWith("model 0 always has no fee");
  });

  it("Should DT admin set fee model percentage for deployer", async function () {
    const percentage = parseUnits("0.35", 18);

    await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
      [constants.DeployerFeeModel.DEPLOYER_STORAGE],
      [percentage]
    );

    expect(
      await DatasetNFT_.deployerFeeModelPercentage(
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      )
    ).to.equal(percentage);
  });

  it("Should DT admin set fee model percentage for data set owners", async function () {
    const percentage = parseUnits("0.1", 18);

    await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
      [constants.DeployerFeeModel.DATASET_OWNER_STORAGE],
      [percentage]
    );

    expect(
      await DatasetNFT_.deployerFeeModelPercentage(
        constants.DeployerFeeModel.DATASET_OWNER_STORAGE
      )
    ).to.equal(percentage);
  });

  it("Should revert set deployer fee model percentage if goes over 100%", async function () {
    const percentage = parseUnits("1.1", 18);

    await expect(
      DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DEPLOYER_STORAGE],
        [percentage]
      )
    ).to.be.revertedWith("percentage can not be more than 100%");
  });

  it("Should revert set deployer fee model percentage if not DT admin", async function () {
    const percentage = parseUnits("1", 18);

    await expect(
      DatasetNFT_.connect(users_.user).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DATASET_OWNER_STORAGE],
        [percentage]
      )
    ).to.be.revertedWith(
      `AccessControl: account ${users_.user.address.toLowerCase()} is missing role ${ZeroHash}`
    );
  });

  it("Should fee model percentage NO_FEE be zero", async function () {
    expect(
      await DatasetNFT_.deployerFeeModelPercentage(
        constants.DeployerFeeModel.NO_FEE
      )
    ).to.equal(0);
  });

  it("Should first DT admin set UUID before data set owner mints the data set", async function () {
    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT_
    )!.args as unknown as [string, bigint];

    expect(await DatasetNFT_.uuids(datasetId)).to.equal(datasetUUID);
    expect(datasetUUID).to.equal(uuid);

    const datasetAddress = await DatasetNFT_.getAddress();
    const signedMessage = await users_.dtAdmin.signMessage(
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

    await expect(
      DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
        users_.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    )
      .to.emit(DatasetNFT_, "ManagersConfigChange")
      .withArgs(datasetId)
      .to.emit(DatasetNFT_, "Transfer")
      .withArgs(ZeroAddress, await DatasetFactory_.getAddress(), datasetId)
      .to.emit(DatasetNFT_, "Transfer")
      .withArgs(
        await DatasetFactory_.getAddress(),
        users_.datasetOwner.address,
        datasetId
      );
  });

  it("Should revert when non admin account tries to setUuid for a dataset", async () => {
    const uuId_test = uuidV4("0xff00cc");

    await expect(DatasetNFT_.connect(users_.datasetOwner).setUuidForDatasetId(uuId_test))
    .to.be.revertedWith(
      `AccessControl: account ${(
      users_.datasetOwner.address
    ).toLowerCase()} is missing role ${ZeroHash}`);
  });

  it("Should revert if DT admin not set UUID before data set owner mints the data set", async function () {
    const datasetAddress = await DatasetNFT_.getAddress();
    const signedMessage = await users_.dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        1n
      )
    );
    const defaultVerifierAddress = await (
      await ethers.getContract("AcceptManuallyVerifier")
    ).getAddress();
    const feeAmount = parseUnits("0.1", 18);
    const dsOwnerPercentage = parseUnits("0.001", 18);

    await expect(
      DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
        users_.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    ).to.be.revertedWith("No uuid set for data set id");
  });

  it("Should a data set owner mint dataset", async function () {
    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT_
    )!.args as unknown as [string, bigint];

    expect(datasetUUID).to.equal(uuid);

    const datasetAddress = await DatasetNFT_.getAddress();
    const signedMessage = await users_.dtAdmin.signMessage(
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

    await expect(
      DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
        users_.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    )
      .to.emit(DatasetNFT_, "ManagersConfigChange")
      .withArgs(datasetId)
      .to.emit(DatasetNFT_, "Transfer")
      .withArgs(ZeroAddress, await DatasetFactory_.getAddress(), datasetId)
      .to.emit(DatasetNFT_, "Transfer")
      .withArgs(
        await DatasetFactory_.getAddress(),
        users_.datasetOwner.address,
        datasetId
      );
  });

  it("Should data set owner not mint a dataset twice", async function () {
    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT_
    )!.args as unknown as [string, bigint];

    expect(datasetUUID).to.equal(uuid);

    const datasetAddress = await DatasetNFT_.getAddress();
    const signedMessage = await users_.dtAdmin.signMessage(
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

    await DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
      users_.datasetOwner.address,
      signedMessage,
      defaultVerifierAddress,
      await users_.datasetOwner.Token!.getAddress(),
      feeAmount,
      dsOwnerPercentage,
      [ZeroHash],
      [parseUnits("1", 18)]
    );

    await expect(
      DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
        users_.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    ).to.be.revertedWith("ERC721: token already minted");
  });

  it("Should revert mint dataset if DT admin signature is wrong", async function () {
    const signedMessage = await users_.datasetOwner.signMessage(getBytes("0x"));

    const datasetUUID = uuidv4();

    await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(datasetUUID);

    await expect(
      DatasetNFT_.connect(users_.datasetOwner).mint(
        users_.datasetOwner.address,
        signedMessage
      )
    ).to.be.revertedWithCustomError(DatasetNFT_, "BAD_SIGNATURE");
  });

  it("Should revert mint dataset if DT admin signer role is not granted", async function () {
    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT_
    )!.args as unknown as [string, bigint];

    expect(datasetUUID).to.equal(uuid);

    const datasetAddress = await DatasetNFT_.getAddress();
    const signedMessage = await users_.user.signMessage(
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

    await expect(
      DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
        users_.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    ).to.be.revertedWithCustomError(DatasetNFT_, "BAD_SIGNATURE");
  });

  it("Should DatasetNFT admin contract set a new fragment implementation", async function () {
    const newFragmentImplementation = await deployments.deploy(
      "FragmentNFT_new",
      {
        contract: "FragmentNFT",
        from: users_.dtAdmin.address,
      }
    );

    await DatasetNFT_.connect(users_.dtAdmin).setFragmentImplementation(
      newFragmentImplementation.address
    );

    expect(await DatasetNFT_.fragmentImplementation()).to.equal(
      newFragmentImplementation.address
    );
  });

  it("Should revert if normal user tries to set fragment implementation address", async function () {
    const newFragmentImplementation = await deployments.deploy(
      "FragmentNFT_new2",
      {
        contract: "FragmentNFT",
        from: users_.user.address
      }
    );
    
    await expect(
      DatasetNFT_.connect(users_.user).setFragmentImplementation(
        newFragmentImplementation.address
      )
    ).to.be.revertedWith(
      `AccessControl: account ${(
        users_.user.address
      ).toLowerCase()} is missing role ${ZeroHash}`
    );
  });

  it("Should revert on set fragment implementation if address is a wallet", async function () {
    await expect(
      DatasetNFT_.connect(users_.dtAdmin).setFragmentImplementation(
        users_.user.address
      )
    ).to.be.revertedWith("invalid fragment implementation address");
  });

  it("Should supportsInterface() return true if id provided is either IDatasetNFT, IERC721, IAccessControl or IERC165", async () => {
    expect(await DatasetNFT_.supportsInterface(IDatasetNFT_Interface_Id)).to.be.true;
    expect(await DatasetNFT_.supportsInterface(IERC721_Interface_Id)).to.be.true;
    expect(await DatasetNFT_.supportsInterface(IERC165_Interface_Id)).to.be.true;
    expect(await DatasetNFT_.supportsInterface(IAccessControl_Interface_Id)).to.be.true;
    expect(await DatasetNFT_.supportsInterface(IERC721Metadata_Interface_Id)).to.be.true;
  });

  it("Should supportsInterface() return false if id provided is not supported", async () => {
    const mockInterfaceId = "0xff123456";
    expect(await DatasetNFT_.supportsInterface(mockInterfaceId)).to.be.false;
  });

  // ------------------------------------------------------------------------------------

  describe("On mint", () => {
    let snap: string;
    let DatasetNFT_: DatasetNFT;
    let DatasetFragment_: FragmentNFT;
    let ERC20SubscriptionManagerFactory_: ContractFactory<any[], Contract>;
    let DistributionManagerFactory_: ContractFactory<any[], Contract>;
    let VerifierManagerFactory_: ContractFactory<any[], Contract>;
    let AcceptAllVerifierFactory_: ContractFactory<any[], Contract>;
    let AcceptManuallyVerifierFactory_: ContractFactory<any[], Contract>;
    let datasetId_: bigint;
    let datasetUUID_: string;
    let users_: Record<string, Signer>;

    before(async () => {
      const {
        DatasetNFT,
        DatasetFragment,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptAllVerifierFactory,
        AcceptManuallyVerifierFactory,
        datasetId,
        datasetUUID,
        users,
      } = await setupOnMint();

      DatasetNFT_ = DatasetNFT;
      DatasetFragment_ = DatasetFragment;
      ERC20SubscriptionManagerFactory_ = ERC20SubscriptionManagerFactory;
      DistributionManagerFactory_ = DistributionManagerFactory;
      VerifierManagerFactory_ = VerifierManagerFactory;
      AcceptAllVerifierFactory_ = AcceptAllVerifierFactory;
      AcceptManuallyVerifierFactory_ = AcceptManuallyVerifierFactory;
      datasetId_ = datasetId;
      datasetUUID_ = datasetUUID;
      users_ = users;
    });

    beforeEach(async () => {
      snap = await ethers.provider.send("evm_snapshot", []);
    });
  
    afterEach(async () => {
      await ethers.provider.send("evm_revert", [snap]);
    });

    it("Should revert if non admin account tries to set deployer fee model for a dataset", async () => {
      await expect(DatasetNFT_.connect(users_.datasetOwner).setDeployerFeeModel(
        datasetId_,
        constants.DeployerFeeModel.DATASET_OWNER_STORAGE
      )).to.be.revertedWith(
        `AccessControl: account ${(
        users_.datasetOwner.address
      ).toLowerCase()} is missing role ${ZeroHash}`);
    });


    it("Should DT admin set deployer fee model for a data set", async function () {
      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModel(
        datasetId_,
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      );

      expect(await DatasetNFT_.deployerFeeModels(datasetId_)).to.equal(
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      );
    });

    it("Should DT admin disable fragment instance creation", async () => {
      const expected_2nd_DataSetId = datasetId_ + BigInt(1);
      const uuId_Dataset2nd = uuidv4();

      expect(uuId_Dataset2nd).to.not.equal(datasetUUID_);

      expect(await DatasetNFT_.fragmentImplementation()).to.not.equal(ZeroAddress);

      const tx = await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(uuId_Dataset2nd);
      const txReceipt = await tx.wait();

      expect(txReceipt?.logs.length).to.equal(1); // One event is emitted

      const txEvent = txReceipt?.logs[0] as EventLog;

      expect(txEvent).to.not.be.undefined;
      expect(txEvent.fragment.name).to.equal("DatasetUuidSet");
      expect(txEvent.args[0]).to.equal(uuId_Dataset2nd);
      expect(txEvent.args[1]).to.equal(expected_2nd_DataSetId);


      // Generate Signature for minting the 2nd dataset NFT
      const signedMintMessage = await users_.dtAdmin.signMessage(
        signature.getDatasetMintMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          expected_2nd_DataSetId
        )
      );
      
      await DatasetNFT_.connect(users_.dtAdmin).mint(users_.datasetOwner.address, signedMintMessage);

      // Now datasetOwner should be the owner of 2nd dataSetNFT
      expect(await DatasetNFT_.ownerOf(expected_2nd_DataSetId)).to.equal(users_.datasetOwner.address);

      // 2nd Dataset NFT owner should be able to deploy the fragment instance for his dataset
      await expect(DatasetNFT_.connect(users_.datasetOwner).deployFragmentInstance(
        expected_2nd_DataSetId
      )).to.not.be.reverted;

      // Admin sets fragment implementation to zeroAddress, thus disabling the creation of fragment instances
      await DatasetNFT_.connect(users_.dtAdmin).setFragmentImplementation(ZeroAddress);
      expect(await DatasetNFT_.fragmentImplementation()).to.equal(ZeroAddress);

      // 2nd Dataset NFT owner tries to deploy the fragment instance of his dataset
      // Should fail since it is currently disabled by admin
      await expect(DatasetNFT_.connect(users_.datasetOwner).deployFragmentInstance(
        expected_2nd_DataSetId
      )).to.be.revertedWith("fragment creation disabled");
    });

    it("Should deployFragmentInstance() revert if caller is not token owner", async () => {
      const uuId_Dataset2nd = uuidv4();
      const second_datasetId = datasetId_ + BigInt(1);

      const tx = await DatasetNFT_.connect(users_.dtAdmin).setUuidForDatasetId(uuId_Dataset2nd);
      const txReceipt = await tx.wait();

      expect(txReceipt?.logs.length).to.equal(1); // One event is emitted

      const txEvent = txReceipt?.logs[0] as EventLog;

      expect(txEvent).to.not.be.undefined;
      expect(txEvent.fragment.name).to.equal("DatasetUuidSet");
      expect(txEvent.args[0]).to.equal(uuId_Dataset2nd);
      expect(txEvent.args[1]).to.equal(second_datasetId);

      // Generate Signature for minting the 2nd dataset NFT
      const signedMintMessage = await users_.dtAdmin.signMessage(
        signature.getDatasetMintMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          second_datasetId
        )
      );

      await DatasetNFT_.connect(users_.dtAdmin).mint(users_.datasetOwner.address, signedMintMessage);

      // Now datasetOwner should be the owner of 2nd dataSetNFT
      expect(await DatasetNFT_.ownerOf(second_datasetId)).to.equal(users_.datasetOwner.address);

      await expect(DatasetNFT_.connect(users_.dtAdmin).deployFragmentInstance(
        second_datasetId
      )).to.be.revertedWithCustomError(DatasetNFT_, `NOT_OWNER`).withArgs(second_datasetId, users_.dtAdmin.address);
    });

    it("Should revert when token owner tries to set managers to the zeroAddress", async () => {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      const subscriptionManagerAddr = await SubscriptionManager.getAddress();
      const distributionManagerAddr = await DistributionManager.getAddress();
      const verifierManagerAddr = await VerifierManager.getAddress();

      // ManagersConfig :: {subscription, distribution, verifier}
      const config1 = {subscriptionManager: ZeroAddress, distributionManager: distributionManagerAddr, verifierManager: verifierManagerAddr};
      const config2 = {subscriptionManager: subscriptionManagerAddr, distributionManager: ZeroAddress, verifierManager: verifierManagerAddr};
      const config3 = {subscriptionManager: subscriptionManagerAddr, distributionManager: distributionManagerAddr, verifierManager: ZeroAddress};

      await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(
        datasetId_,
        config1
      )).to.be.revertedWith("bad implementation address");

      await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(
        datasetId_,
        config2
      )).to.be.revertedWith("bad implementation address");

      await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(
        datasetId_,
        config3
      )).to.be.revertedWith("bad implementation address");
    });

    it("Should not emit event if all managers provided are the same as currently set", async () => {
      const config = await DatasetNFT_.configurations(datasetId_);

      const currentSubscriptionManagerAddr = config[0];
      const currentDistributionManagerAddr = config[1];
      const currentVerifierManagerAddr = config[2];

      const sameConfig = {
        subscriptionManager: currentSubscriptionManagerAddr,
        distributionManager: currentDistributionManagerAddr,
        verifierManager: currentVerifierManagerAddr
      };

      await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(
        datasetId_,
        sameConfig
      )).to.not.emit(DatasetNFT_, "ManagersConfigChange");
    });

    it("Should data set owner not deploy fragment instance if already exists", async function () {
      await expect(
        DatasetNFT_.connect(users_.datasetOwner).deployFragmentInstance(datasetId_)
      ).to.be.revertedWith("fragment instance already deployed");
    });

    it("Should data set owner set managers", async function () {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await expect(
        DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        })
      )
        .to.emit(DatasetNFT_, "ManagersConfigChange")
        .withArgs(datasetId_);
    });

    it("Should revert set dataset nft managers if data set does not exists", async function () {
      const wrongDatasetId = 11231231;

      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await expect(
        DatasetNFT_.connect(users_.datasetOwner).setManagers(wrongDatasetId, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        })
      )
        .to.be.revertedWithCustomError(DatasetNFT_, "NOT_OWNER")
        .withArgs(wrongDatasetId, users_.datasetOwner.address);
    });

    it("Should contributor propose a fragment - default AcceptManuallyVerifier", async function () {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(
        datasetId_
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users_.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const lastFragmentPendingId =
        await DatasetFragment_.lastFragmentPendingId();

      const proposeSignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          lastFragmentPendingId + 1n,
          users_.contributor.address,
          tag
        )
      );

      await expect(
        DatasetNFT_.connect(users_.contributor).proposeFragment(
          datasetId_,
          users_.contributor.address,
          tag,
          proposeSignature
        )
      )
        .to.emit(DatasetFragment_, "FragmentPending")
        .withArgs(datasetId_, tag);
    });

    it("Should proposeFragment() revert if no FragmentInstance for dataset is deployed", async () => {
      // Currently only one dataSet is supported from the protocol  with `datasetId_` erc721 id
      await expect(DatasetNFT_.ownerOf(datasetId_ + BigInt(1))).to.be.revertedWith("ERC721: invalid token ID");
      expect(await DatasetNFT_.fragments(datasetId_ + BigInt(1))).to.equal(ZeroAddress);

      // Contributor tries to propose fragment for non existing dataset (thus no FragmentInstance deployed yet for such dataset)
      const nonExistentDatasetId = datasetId_ + BigInt(1);
      const tag = utils.encodeTag("dataset.metadata");
      const signatureMock = "0xff";

      await expect(DatasetNFT_.connect(users_.contributor).proposeFragment(
        nonExistentDatasetId,
        users_.contributor.address,
        tag,
        signatureMock
        )).to.be.revertedWith("No fragment instance deployed");
    });

    it("Should proposeManyFragments() revert if no FragmentInstance for dataset is deployed", async () => {
      // Currently only one dataSet is supported from the protocol  with `datasetId_` erc721 id
      await expect(DatasetNFT_.ownerOf(datasetId_ + BigInt(1))).to.be.revertedWith("ERC721: invalid token ID");
      expect(await DatasetNFT_.fragments(datasetId_ + BigInt(1))).to.equal(ZeroAddress);

      // Contributor tries to propose many fragments for non existing dataset (thus no FragmentInstance deployed yet for such dataset)
      const nonExistentDatasetId = datasetId_ + BigInt(1);
      const tags = [utils.encodeTag("dataset.metadata"), utils.encodeTag("dataset.schemas")];
      const signatureMock = "0xff";

      await expect(DatasetNFT_.connect(users_.contributor).proposeManyFragments(
        nonExistentDatasetId,
        [users_.contributor, users_.contributor],
        tags,
        signatureMock
      )).to.be.revertedWith("No fragment instance deployed");
    });

    it("Should contributor propose multiple fragments - default AcceptManuallyVerifier", async function () {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(
        datasetId_
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users_.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tagSchemas = utils.encodeTag("dataset.schemas");
      const tagRows = utils.encodeTag("dataset.rows");
      const tagData = utils.encodeTag("dataset.data");

      const tags = [tagSchemas, tagRows, tagData];

      const lastFragmentPendingId =
        await DatasetFragment_.lastFragmentPendingId();

      const proposeManySignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          lastFragmentPendingId + 1n,
          lastFragmentPendingId + BigInt(tags.length),
          [
            users_.contributor.address,
            users_.contributor.address,
            users_.contributor.address,
          ],
          tags
        )
      );

      await expect(
        DatasetNFT_.connect(users_.contributor).proposeManyFragments(
          datasetId_,
          [
            users_.contributor.address,
            users_.contributor.address,
            users_.contributor.address,
          ],
          [tagSchemas, tagRows, tagData],
          proposeManySignature
        )
      )
        .to.emit(DatasetFragment_, "FragmentPending")
        .withArgs(lastFragmentPendingId + 1n, tagSchemas)
        .to.emit(DatasetFragment_, "FragmentPending")
        .withArgs(lastFragmentPendingId + 2n, tagRows)
        .to.emit(DatasetFragment_, "FragmentPending")
        .withArgs(lastFragmentPendingId + 3n, tagData);
    });

    it("Should revert contributor propose multiple fragments if proposes length is not correct", async function () {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(
        datasetId_
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users_.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tagSchemas = utils.encodeTag("dataset.schemas");
      const tagRows = utils.encodeTag("dataset.rows");
      const tagData = utils.encodeTag("dataset.data");

      const tags = [tagSchemas, tagRows, tagData]

      const lastFragmentPendingId =
        await DatasetFragment_.lastFragmentPendingId();

      const proposeManySignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          lastFragmentPendingId + 1n,
          lastFragmentPendingId + BigInt(tags.length),
          [
            users_.contributor.address,
            users_.contributor.address,
            users_.contributor.address,
          ],
          tags
        )
      );

      await expect(
        DatasetNFT_.connect(users_.contributor).proposeManyFragments(
          datasetId_,
          [users_.contributor.address, users_.contributor.address],
          [tagSchemas],
          proposeManySignature
        )
      ).to.be.revertedWith("invalid length of fragments items");
    });

    it("Should contributor propose a fragment - default AcceptAllVerifier", async function () {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(
        datasetId_
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users_.datasetOwner
      );

      const AcceptAllVerifier = await AcceptAllVerifierFactory_.connect(
        users_.datasetOwner
      ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptAllVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const lastFragmentPendingId =
        await DatasetFragment_.lastFragmentPendingId();

      const proposeSignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          lastFragmentPendingId + 1n,
          users_.contributor.address,
          tag
        )
      );
          
      await expect(
        DatasetNFT_.connect(users_.contributor).proposeFragment(
          datasetId_,
          users_.contributor.address,
          tag,
          proposeSignature
        )
      )
        .to.emit(DatasetFragment_, "FragmentPending")
        .withArgs(datasetId_, tag);
        
    });

    it("Should revert a propose if signature is wrong", async function () {
      const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory_.connect(
        users_.datasetOwner
      ).deploy();

      await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(
        datasetId_
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users_.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const proposeSignature = await users_.dtAdmin.signMessage(getBytes("0x"));

      await expect(
        DatasetNFT_.connect(users_.contributor).proposeFragment(
          datasetId_,
          users_.contributor.address,
          tag,
          proposeSignature
        )
      ).to.be.revertedWithCustomError(DatasetNFT_, "BAD_SIGNATURE");
    });

    it("Should setFeeAndTagWeights() set the fee and tag weights", async () => {
      const datasetAddress = await DatasetNFT_.getAddress();
      const subscriptionAddress = await DatasetNFT_.subscriptionManager(datasetId_);
      const distributionAddress = await DatasetNFT_.distributionManager(datasetId_);
      const tokenAddress = await users_.datasetOwner.Token!.getAddress();

      const tags = [
        ZeroHash,
        encodeTag("shcema.metadata"),
        encodeTag("schema.rows"),
        encodeTag("schema.columns")
      ];

      const weights = [
        parseUnits("0.1", 18),
        parseUnits("0.2", 18),
        parseUnits("0.3", 18),
        parseUnits("0.4", 18)
      ];

      const fee = parseUnits("0.5", 18);

      // Currently (see `setup()`) fee is 0.1 & tags = [ZeroHash] with weight 100%
      const subscriptionManager = ERC20SubscriptionManagerFactory_.attach(subscriptionAddress) as unknown as ERC20LinearSingleDatasetSubscriptionManager;
      const distributionManager = DistributionManagerFactory_.attach(distributionAddress) as unknown as DistributionManager;

      // For 0.1 fee, 7 days and 3 consumers, subscription fee is :: 0.1 * 7 * 3 == 2.1
      let expectedFee = parseUnits("2.1", 18);

      let subscriptionFeeResult = await subscriptionManager.subscriptionFee(datasetId_, 7, 3);

      expect(subscriptionFeeResult[0]).to.equal(tokenAddress);
      expect(subscriptionFeeResult[1]).to.equal(expectedFee);

      const tagWeightsResultPre = await distributionManager.getTagWeights(tags);

      expect(tagWeightsResultPre.length).to.equal(4);
      expect(tagWeightsResultPre[0]).to.equal(parseUnits("1", 18)); // Since only tag ZeroHash is set (see `setup()`)
      expect(tagWeightsResultPre[1]).to.equal(0);
      expect(tagWeightsResultPre[2]).to.equal(0);
      expect(tagWeightsResultPre[3]).to.equal(0);
      

      // ------ Post setFeeAndTagWeights

      await DatasetNFT_.connect(users_.datasetOwner).setFeeAndTagWeights(
        datasetId_,
        tokenAddress,
        fee,
        tags,
        weights
      );
      
      // For 0.5 fee, 7 days and 3 consumers , subscription fee is:: 0.5 * 7 * 3 == 10.5
      expectedFee = parseUnits("10.5", 18);

      subscriptionFeeResult = await subscriptionManager.subscriptionFee(datasetId_, 7, 3);

      expect(subscriptionFeeResult[0]).to.equal(tokenAddress);
      expect(subscriptionFeeResult[1]).to.equal(expectedFee);

      const tagWeightsResultPost = await distributionManager.getTagWeights(tags);
      
      expect(tagWeightsResultPost.length).to.equal(4);
      expect(tagWeightsResultPost[0]).to.equal(weights[0]);
      expect(tagWeightsResultPost[1]).to.equal(weights[1]);
      expect(tagWeightsResultPost[2]).to.equal(weights[2]);
      expect(tagWeightsResultPost[3]).to.equal(weights[3]);
    });
  });
});
