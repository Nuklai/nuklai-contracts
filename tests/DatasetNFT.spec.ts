import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { DatasetFactory, DatasetNFT, FragmentNFT } from "@typechained";
import { Contract, ContractFactory, getBytes, parseUnits, ZeroAddress, ZeroHash } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { signature, utils } from "./utils";
import { constants } from "../utils";
import { getEvent } from "./utils/events";
import { setupUsers } from "./utils/users";
import {Signer} from "./utils/users";

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
      "AllianceBlock DataTunnel Dataset"
    );
  });

  it("Should dataset symbol be set on deploy", async function () {
    expect(await DatasetNFT_.symbol()).to.equal("ABDTDS");
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
        users
      } = await setupOnMint();

      DatasetNFT_ = DatasetNFT;
      DatasetFragment_ = DatasetFragment;
      ERC20SubscriptionManagerFactory_ = ERC20SubscriptionManagerFactory;
      DistributionManagerFactory_ = DistributionManagerFactory;
      VerifierManagerFactory_ = VerifierManagerFactory;
      AcceptAllVerifierFactory_ = AcceptAllVerifierFactory;
      AcceptManuallyVerifierFactory_ = AcceptManuallyVerifierFactory;
      datasetId_ = datasetId;
      users_ = users;
    });

    beforeEach(async () => {
      snap = await ethers.provider.send("evm_snapshot", []);
    });
  
    afterEach(async () => {
      await ethers.provider.send("evm_revert", [snap]);
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

      const lastFragmentPendingId =
        await DatasetFragment_.lastFragmentPendingId();

      const proposeManySignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          lastFragmentPendingId,
          [
            users_.contributor.address,
            users_.contributor.address,
            users_.contributor.address,
          ],
          [tagSchemas, tagRows, tagData]
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

      const lastFragmentPendingId =
        await DatasetFragment_.lastFragmentPendingId();

      const proposeManySignature = await users_.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT_.getAddress(),
          datasetId_,
          lastFragmentPendingId,
          [
            users_.contributor.address,
            users_.contributor.address,
            users_.contributor.address,
          ],
          [tagSchemas, tagRows, tagData]
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
  });
});
