import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { DatasetFactory, DatasetNFT, FragmentNFT } from "@typechained";
import { getBytes, parseUnits, ZeroAddress, ZeroHash } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { signature, utils } from "./utils";
import { constants } from "../utils";
import { getEvent } from "./utils/events";
import { setupUsers } from "./utils/users";

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
  it("Should dataset name be set on deploy", async function () {
    const { DatasetNFT } = await setup();
    expect(await DatasetNFT.name()).to.equal(
      "AllianceBlock DataTunnel Dataset"
    );
  });

  it("Should dataset symbol be set on deploy", async function () {
    const { DatasetNFT } = await setup();
    expect(await DatasetNFT.symbol()).to.equal("ABDTDS");
  });

  it("Should dataset fragment implementation be set on deploy", async function () {
    const { DatasetNFT, FragmentNFTImplementation } = await setup();
    expect(await DatasetNFT.fragmentImplementation()).to.equal(
      await FragmentNFTImplementation.getAddress()
    );
  });

  it("Should DT admin be a signer", async function () {
    const { DatasetNFT, users } = await setup();
    expect(await DatasetNFT.isSigner(users.dtAdmin)).to.be.true;
  });

  it("Should DT admin set a deployer beneficiary for fees", async function () {
    const { DatasetNFT, users } = await setup();

    await DatasetNFT.connect(users.dtAdmin).setDeployerFeeBeneficiary(
      users.dtAdmin.address
    );

    expect(await DatasetNFT.deployerFeeBeneficiary()).to.equal(
      users.dtAdmin.address
    );
  });

  it("Should DT admin set fee model percentage for deployer", async function () {
    const { DatasetNFT, users } = await setup();

    const percentage = parseUnits("0.35", 18);

    await DatasetNFT.connect(users.dtAdmin).setDeployerFeeModelPercentages(
      [constants.DeployerFeeModel.DEPLOYER_STORAGE],
      [percentage]
    );

    expect(
      await DatasetNFT.deployerFeeModelPercentage(
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      )
    ).to.equal(percentage);
  });

  it("Should DT admin set fee model percentage for data set owners", async function () {
    const { DatasetNFT, users } = await setup();

    const percentage = parseUnits("0.1", 18);

    await DatasetNFT.connect(users.dtAdmin).setDeployerFeeModelPercentages(
      [constants.DeployerFeeModel.DATASET_OWNER_STORAGE],
      [percentage]
    );

    expect(
      await DatasetNFT.deployerFeeModelPercentage(
        constants.DeployerFeeModel.DATASET_OWNER_STORAGE
      )
    ).to.equal(percentage);
  });

  it("Should revert set deployer fee model percentage if goes over 100%", async function () {
    const { DatasetNFT, users } = await setup();

    const percentage = parseUnits("1.1", 18);

    await expect(
      DatasetNFT.connect(users.dtAdmin).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DEPLOYER_STORAGE],
        [percentage]
      )
    ).to.be.revertedWith("percentage can not be more than 100%");
  });

  it("Should revert set deployer fee model percentage if not DT admin", async function () {
    const { DatasetNFT, users } = await setup();

    const percentage = parseUnits("1", 18);

    await expect(
      DatasetNFT.connect(users.user).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DATASET_OWNER_STORAGE],
        [percentage]
      )
    ).to.be.revertedWith(
      `AccessControl: account ${users.user.address.toLowerCase()} is missing role ${ZeroHash}`
    );
  });

  it("Should fee model percentage NO_FEE be zero", async function () {
    const { DatasetNFT } = await setup();

    expect(
      await DatasetNFT.deployerFeeModelPercentage(
        constants.DeployerFeeModel.NO_FEE
      )
    ).to.equal(0);
  });

  it("Should first DT admin set UUID before data set owner mints the data set", async function () {
    const { DatasetNFT, DatasetFactory, users } = await setup();

    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT
    )!.args as unknown as [string, bigint];

    expect(await DatasetNFT.uuids(datasetId)).to.equal(datasetUUID);
    expect(datasetUUID).to.equal(uuid);

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

    await expect(
      DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
        users.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    )
      .to.be.emit(DatasetNFT, "ManagersConfigChange")
      .withArgs(datasetId)
      .to.be.emit(DatasetNFT, "Transfer")
      .withArgs(ZeroAddress, await DatasetFactory.getAddress(), datasetId)
      .to.be.emit(DatasetNFT, "Transfer")
      .withArgs(
        await DatasetFactory.getAddress(),
        users.datasetOwner.address,
        datasetId
      );
  });

  it("Should revert if DT admin not set UUID before data set owner mints the data set", async function () {
    const { DatasetNFT, DatasetFactory, users } = await setup();

    const datasetAddress = await DatasetNFT.getAddress();
    const signedMessage = await users.dtAdmin.signMessage(
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
      DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
        users.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    ).to.be.revertedWith("No uuid set for data set id");
  });

  it("Should a data set owner mint dataset", async function () {
    const { DatasetNFT, DatasetFactory, users } = await setup();

    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT
    )!.args as unknown as [string, bigint];

    expect(datasetUUID).to.equal(uuid);

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

    await expect(
      DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
        users.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    )
      .to.be.emit(DatasetNFT, "ManagersConfigChange")
      .withArgs(datasetId)
      .to.be.emit(DatasetNFT, "Transfer")
      .withArgs(ZeroAddress, await DatasetFactory.getAddress(), datasetId)
      .to.be.emit(DatasetNFT, "Transfer")
      .withArgs(
        await DatasetFactory.getAddress(),
        users.datasetOwner.address,
        datasetId
      );
  });

  it("Should data set owner not mint a dataset twice", async function () {
    const { DatasetNFT, DatasetFactory, users } = await setup();

    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT
    )!.args as unknown as [string, bigint];

    expect(datasetUUID).to.equal(uuid);

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

    await expect(
      DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
        users.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    ).to.be.revertedWith("ERC721: token already minted");
  });

  it("Should revert mint dataset if DT admin signature is wrong", async function () {
    const { DatasetNFT, users } = await setup();

    const signedMessage = await users.datasetOwner.signMessage(getBytes("0x"));

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID);

    await expect(
      DatasetNFT.connect(users.datasetOwner).mint(
        users.datasetOwner.address,
        signedMessage
      )
    ).to.be.revertedWithCustomError(DatasetNFT, "BAD_SIGNATURE");
  });

  it("Should revert mint dataset if DT admin signer role is not granted", async function () {
    const { DatasetNFT, DatasetFactory, users } = await setup();

    const datasetUUID = uuidv4();

    const uuidSetTxReceipt = await (
      await DatasetNFT.connect(users.dtAdmin).setUuidForDatasetId(datasetUUID)
    ).wait();

    const [uuid, datasetId] = getEvent(
      "DatasetUuidSet",
      uuidSetTxReceipt?.logs!,
      DatasetNFT
    )!.args as unknown as [string, bigint];

    expect(datasetUUID).to.equal(uuid);

    const datasetAddress = await DatasetNFT.getAddress();
    const signedMessage = await users.user.signMessage(
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
      DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
        users.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits("1", 18)]
      )
    ).to.be.revertedWithCustomError(DatasetNFT, "BAD_SIGNATURE");
  });

  it("Should DatasetNFT admin contract set a new fragment implementation", async function () {
    const { DatasetNFT, users } = await setup();

    const newFragmentImplementation = await deployments.deploy(
      "FragmentNFT_new",
      {
        contract: "FragmentNFT",
        from: await users.dtAdmin.getAddress(),
      }
    );

    await DatasetNFT.connect(users.dtAdmin).setFragmentImplementation(
      newFragmentImplementation.address
    );

    expect(await DatasetNFT.fragmentImplementation()).to.equal(
      newFragmentImplementation.address
    );
  });

  it("Should revert if normal user tries to set fragment implementation address", async function () {
    const { DatasetNFT, users } = await setup();

    const newFragmentImplementation = await deployments.deploy(
      "FragmentNFT_new",
      {
        contract: "FragmentNFT",
        from: await users.user.getAddress(),
      }
    );

    await expect(
      DatasetNFT.connect(users.user).setFragmentImplementation(
        newFragmentImplementation.address
      )
    ).to.be.revertedWith(
      `AccessControl: account ${(
        await users.user.getAddress()
      ).toLowerCase()} is missing role ${ZeroHash}`
    );
  });

  it("Should revert on set fragment implementation if address is a wallet", async function () {
    const { DatasetNFT, users } = await setup();

    await expect(
      DatasetNFT.connect(users.dtAdmin).setFragmentImplementation(
        users.user.address
      )
    ).to.be.revertedWith("invalid fragment implementation address");
  });

  describe("On mint", () => {
    it("Should DT admin set deployer fee model for a data set", async function () {
      const { DatasetNFT, datasetId, users } = await setupOnMint();

      await DatasetNFT.connect(users.dtAdmin).setDeployerFeeModel(
        datasetId,
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      );

      expect(await DatasetNFT.deployerFeeModels(datasetId)).to.equal(
        constants.DeployerFeeModel.DEPLOYER_STORAGE
      );
    });

    it("Should data set owner not deploy fragment instance if already exists", async function () {
      const { DatasetNFT, datasetId, users } = await setupOnMint();

      await expect(
        DatasetNFT.connect(users.datasetOwner).deployFragmentInstance(datasetId)
      ).to.be.revertedWith("fragment instance already deployed");
    });

    it("Should data set owner set managers", async function () {
      const {
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await expect(
        DatasetNFT.connect(users.datasetOwner).setManagers(datasetId, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        })
      )
        .to.emit(DatasetNFT, "ManagersConfigChange")
        .withArgs(datasetId);
    });

    it("Should revert set dataset nft managers if data set does not exists", async function () {
      const wrongDatasetId = 11231231;
      const {
        DatasetNFT,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await expect(
        DatasetNFT.connect(users.datasetOwner).setManagers(wrongDatasetId, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        })
      )
        .to.be.revertedWithCustomError(DatasetNFT, "NOT_OWNER")
        .withArgs(wrongDatasetId, users.datasetOwner.address);
    });

    it("Should contributor propose a fragment - default AcceptManuallyVerifier", async function () {
      const {
        datasetId,
        DatasetNFT,
        DatasetFragment,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await DatasetNFT.connect(users.datasetOwner).setManagers(datasetId, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT.verifierManager(
        datasetId
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(
          users.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeSignature = await users.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId + 1n,
          users.contributor.address,
          tag
        )
      );

      await expect(
        DatasetNFT.connect(users.contributor).proposeFragment(
          datasetId,
          users.contributor.address,
          tag,
          proposeSignature
        )
      )
        .to.emit(DatasetFragment, "FragmentPending")
        .withArgs(datasetId, tag);
    });

    it("Should contributor propose multiple fragments - default AcceptManuallyVerifier", async function () {
      const {
        datasetId,
        DatasetNFT,
        DatasetFragment,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await DatasetNFT.connect(users.datasetOwner).setManagers(datasetId, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT.verifierManager(
        datasetId
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(
          users.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tagSchemas = utils.encodeTag("dataset.schemas");
      const tagRows = utils.encodeTag("dataset.rows");
      const tagData = utils.encodeTag("dataset.data");

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeManySignature = await users.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId,
          [
            users.contributor.address,
            users.contributor.address,
            users.contributor.address,
          ],
          [tagSchemas, tagRows, tagData]
        )
      );

      await expect(
        DatasetNFT.connect(users.contributor).proposeManyFragments(
          datasetId,
          [
            users.contributor.address,
            users.contributor.address,
            users.contributor.address,
          ],
          [tagSchemas, tagRows, tagData],
          proposeManySignature
        )
      )
        .to.emit(DatasetFragment, "FragmentPending")
        .withArgs(lastFragmentPendingId + 1n, tagSchemas)
        .to.emit(DatasetFragment, "FragmentPending")
        .withArgs(lastFragmentPendingId + 2n, tagRows)
        .to.emit(DatasetFragment, "FragmentPending")
        .withArgs(lastFragmentPendingId + 3n, tagData);
    });

    it("Should revert contributor propose multiple fragments if proposes length is not correct", async function () {
      const {
        datasetId,
        DatasetNFT,
        DatasetFragment,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await DatasetNFT.connect(users.datasetOwner).setManagers(datasetId, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT.verifierManager(
        datasetId
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(
          users.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tagSchemas = utils.encodeTag("dataset.schemas");
      const tagRows = utils.encodeTag("dataset.rows");
      const tagData = utils.encodeTag("dataset.data");

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeManySignature = await users.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId,
          [
            users.contributor.address,
            users.contributor.address,
            users.contributor.address,
          ],
          [tagSchemas, tagRows, tagData]
        )
      );

      await expect(
        DatasetNFT.connect(users.contributor).proposeManyFragments(
          datasetId,
          [users.contributor.address, users.contributor.address],
          [tagSchemas],
          proposeManySignature
        )
      ).to.be.revertedWith("invalid length of fragments items");
    });

    it("Should contributor propose a fragment - default AcceptAllVerifier", async function () {
      const {
        datasetId,
        DatasetNFT,
        DatasetFragment,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptAllVerifierFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await DatasetNFT.connect(users.datasetOwner).setManagers(datasetId, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT.verifierManager(
        datasetId
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users.datasetOwner
      );

      const AcceptAllVerifier = await AcceptAllVerifierFactory.connect(
        users.datasetOwner
      ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptAllVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeSignature = await users.dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId + 1n,
          users.contributor.address,
          tag
        )
      );

      await expect(
        DatasetNFT.connect(users.contributor).proposeFragment(
          datasetId,
          users.contributor.address,
          tag,
          proposeSignature
        )
      )
        .to.emit(DatasetFragment, "FragmentPending")
        .withArgs(datasetId, tag);
    });

    it("Should revert a propose if signature is wrong", async function () {
      const {
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
        users,
      } = await setupOnMint();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        users.datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        users.datasetOwner
      ).deploy();

      await DatasetNFT.connect(users.datasetOwner).setManagers(datasetId, {
        subscriptionManager: await SubscriptionManager.getAddress(),
        distributionManager: await DistributionManager.getAddress(),
        verifierManager: await VerifierManager.getAddress(),
      });

      const datasetVerifierManagerAddress = await DatasetNFT.verifierManager(
        datasetId
      );

      const DatasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress,
        users.datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(
          users.datasetOwner
        ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const proposeSignature = await users.dtAdmin.signMessage(getBytes("0x"));

      await expect(
        DatasetNFT.connect(users.contributor).proposeFragment(
          datasetId,
          users.contributor.address,
          tag,
          proposeSignature
        )
      ).to.be.revertedWithCustomError(DatasetNFT, "BAD_SIGNATURE");
    });
  });
});
