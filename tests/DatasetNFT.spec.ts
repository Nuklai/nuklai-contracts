import { expect } from "chai";
import { deployments, ethers, getNamedAccounts, network } from "hardhat";
import { DatasetNFT, FragmentNFT } from "@typechained";
import { getBytes, parseUnits, ZeroAddress, ZeroHash } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { constants, signature, utils } from "./utils";

async function setup() {
  await deployments.fixture(["DatasetNFT"]);

  const contracts = {
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract(
      "FragmentNFT"
    )) as FragmentNFT,
  };

  return {
    ...contracts,
  };
}

const setupOnMint = async () => {
  await deployments.fixture(["DatasetNFT"]);

  const contracts = {
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract(
      "FragmentNFT"
    )) as FragmentNFT,
  };

  const { DatasetNFT } = await setup();
  const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();

  const datasetAddress = await DatasetNFT.getAddress();

  const datasetUUID = uuidv4();

  await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

  const datasetId = 1;
  const signedMessage = await dtAdmin.signMessage(
    signature.getDatasetMintMessage(
      network.config.chainId!,
      datasetAddress,
      datasetId,
      datasetOwner.address
    )
  );

  await DatasetNFT.connect(datasetOwner).mint(
    datasetOwner.address,
    signedMessage
  );

  await DatasetNFT.connect(datasetOwner).deployFragmentInstance(datasetId);

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

  return {
    datasetId,
    datasetUUID,
    ...contracts,
    ...factories,
  };
};

describe("DatasetNFT", () => {
  it("Should dataset name be set on deploy", async function () {
    const { DatasetNFT } = await setup();
    expect(await DatasetNFT.name()).to.equal("AllianceBlock DataTunel Dataset");
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
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await getNamedAccounts();
    expect(await DatasetNFT.isSigner(dtAdmin)).to.be.true;
  });

  it("Should DT admin set a deployer beneficiary for fees", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await ethers.getNamedSigners();

    await DatasetNFT.connect(dtAdmin).setDeployerFeeBeneficiary(
      dtAdmin.address
    );

    expect(await DatasetNFT.deployerFeeBeneficiary()).to.equal(dtAdmin.address);
  });

  it("Should DT admin set fee model percentage for deployer", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await ethers.getNamedSigners();

    const percentage = parseUnits("0.35", 18);

    await DatasetNFT.connect(dtAdmin).setDeployerFeeModelPercentages(
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
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await ethers.getNamedSigners();

    const percentage = parseUnits("0.1", 18);

    await DatasetNFT.connect(dtAdmin).setDeployerFeeModelPercentages(
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
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await ethers.getNamedSigners();

    const percentage = parseUnits("1.1", 18);

    await expect(
      DatasetNFT.connect(dtAdmin).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DEPLOYER_STORAGE],
        [percentage]
      )
    ).to.be.revertedWith("percentage can not be more than 100%");
  });

  it("Should revert set deployer fee model percentage if not DT admin", async function () {
    const { DatasetNFT } = await setup();
    const { user } = await ethers.getNamedSigners();

    const percentage = parseUnits("1", 18);

    await expect(
      DatasetNFT.connect(user).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DATASET_OWNER_STORAGE],
        [percentage]
      )
    ).to.be.revertedWith(
      `AccessControl: account ${user.address.toLowerCase()} is missing role ${ZeroHash}`
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
    const { DatasetNFT } = await setup();
    const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    expect(await DatasetNFT.uuids(datasetId)).to.equal(datasetUUID);

    await expect(
      DatasetNFT.connect(datasetOwner).mint(datasetOwner.address, signedMessage)
    )
      .to.emit(DatasetNFT, "Transfer")
      .withArgs(ZeroAddress, datasetOwner.address, datasetId);
  });

  it("Should revert if DT admin not set UUID before data set owner mints the data set", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    await expect(
      DatasetNFT.connect(datasetOwner).mint(datasetOwner.address, signedMessage)
    ).to.be.revertedWith("No uuid set for data set id");
  });

  it("Should a data set owner mint dataset", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    await expect(
      DatasetNFT.connect(datasetOwner).mint(datasetOwner.address, signedMessage)
    )
      .to.emit(DatasetNFT, "Transfer")
      .withArgs(ZeroAddress, datasetOwner.address, datasetId);
  });

  it("Should data set owner not mint a dataset twice", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    await DatasetNFT.connect(datasetOwner).mint(
      datasetOwner.address,
      signedMessage
    );

    await expect(
      DatasetNFT.connect(datasetOwner).mint(datasetOwner.address, signedMessage)
    ).to.be.revertedWith("ERC721: token already minted");
  });

  it("Should revert mint dataset if DT admin signature is wrong", async function () {
    const { DatasetNFT } = await setup();
    const { datasetOwner, dtAdmin } = await ethers.getNamedSigners();

    const signedMessage = await datasetOwner.signMessage(getBytes("0x"));

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    await expect(
      DatasetNFT.connect(datasetOwner).mint(datasetOwner.address, signedMessage)
    ).to.be.revertedWithCustomError(DatasetNFT, "BAD_SIGNATURE");
  });

  it("Should revert mint dataset if DT admin signer role is not granted", async function () {
    const { DatasetNFT } = await setup();
    const { datasetOwner, user, dtAdmin } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await user.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    await expect(
      DatasetNFT.connect(datasetOwner).mint(datasetOwner.address, signedMessage)
    ).to.be.revertedWithCustomError(DatasetNFT, "BAD_SIGNATURE");
  });

  it("Should DatasetNFT admin contract set a new fragment implementation", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await ethers.getNamedSigners();

    const newFragmentImplementation = await deployments.deploy("FragmentNFT", {
      from: await dtAdmin.getAddress(),
    });

    await DatasetNFT.connect(dtAdmin).setFragmentImplementation(
      newFragmentImplementation.address
    );

    expect(await DatasetNFT.fragmentImplementation()).to.equal(
      newFragmentImplementation.address
    );
  });

  it("Should revert if normal user tries to set fragment implementation address", async function () {
    const { DatasetNFT } = await setup();
    const { user } = await ethers.getNamedSigners();

    const newFragmentImplementation = await deployments.deploy("FragmentNFT", {
      from: await user.getAddress(),
    });

    await expect(
      DatasetNFT.connect(user).setFragmentImplementation(
        newFragmentImplementation.address
      )
    ).to.be.revertedWith(
      `AccessControl: account ${(
        await user.getAddress()
      ).toLowerCase()} is missing role ${ZeroHash}`
    );
  });

  it("Should revert on set fragment implementation if address is a wallet", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin } = await ethers.getNamedSigners();
    const { user } = await getNamedAccounts();

    await expect(
      DatasetNFT.connect(dtAdmin).setFragmentImplementation(user)
    ).to.be.revertedWith("invalid fragment implementation address");
  });

  it("Should data set owner deploy fragment instance for minted data set", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    await DatasetNFT.connect(datasetOwner).mint(
      datasetOwner.address,
      signedMessage
    );

    await expect(
      DatasetNFT.connect(datasetOwner).deployFragmentInstance(datasetId)
    ).to.emit(DatasetNFT, "FragmentInstanceDeployement");
  });

  it("Should data set owner not deploy fragment instance if already exists", async function () {
    const { DatasetNFT } = await setup();
    const { dtAdmin, datasetOwner } = await ethers.getNamedSigners();
    const datasetId = 1;

    const datasetAddress = await DatasetNFT.getAddress();

    const signedMessage = await dtAdmin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        datasetOwner.address
      )
    );

    const datasetUUID = uuidv4();

    await DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

    await DatasetNFT.connect(datasetOwner).mint(
      datasetOwner.address,
      signedMessage
    );

    await DatasetNFT.connect(datasetOwner).deployFragmentInstance(datasetId);

    await expect(
      DatasetNFT.connect(datasetOwner).deployFragmentInstance(datasetId)
    ).to.be.revertedWith("fragment instance already deployed");
  });

  describe("On mint", () => {
    it("Should data set owner set managers", async function () {
      const {
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
      } = await setupOnMint();
      const { datasetOwner } = await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await expect(
        DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
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
      } = await setupOnMint();
      const { datasetOwner } = await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await expect(
        DatasetNFT.connect(datasetOwner).setManagers(wrongDatasetId, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        })
      )
        .to.be.revertedWithCustomError(DatasetNFT, "NOT_OWNER")
        .withArgs(wrongDatasetId, datasetOwner.address);
    });

    it("Should contributor propose a fragment - default AcceptManuallyVerifier", async function () {
      const {
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
      } = await setupOnMint();
      const { dtAdmin, datasetOwner, contributor } =
        await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
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
        datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(datasetOwner).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const fragmentAddress = await DatasetNFT.fragments(datasetId);
      const DatasetFragment = (await ethers.getContractAt(
        "FragmentNFT",
        fragmentAddress
      )) as unknown as FragmentNFT;

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeSignature = await dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId + 1n,
          contributor.address,
          tag
        )
      );

      await expect(
        DatasetNFT.connect(contributor).proposeFragment(
          datasetId,
          contributor.address,
          tag,
          proposeSignature
        )
      )
        .to.emit(DatasetFragment, "FragmentPending")
        .withArgs(datasetId, tag);
    });

    it("Should contributor propose multiple fragments - default AcceptManuallyVerifier", async function () {
      const {
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
      } = await setupOnMint();
      const { dtAdmin, datasetOwner, contributor } =
        await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
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
        datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(datasetOwner).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const fragmentAddress = await DatasetNFT.fragments(datasetId);
      const DatasetFragment = (await ethers.getContractAt(
        "FragmentNFT",
        fragmentAddress
      )) as unknown as FragmentNFT;

      const tagSchemas = utils.encodeTag("dataset.schemas");
      const tagRows = utils.encodeTag("dataset.rows");
      const tagData = utils.encodeTag("dataset.data");

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeManySignature = await dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId,
          [contributor.address, contributor.address, contributor.address],
          [tagSchemas, tagRows, tagData]
        )
      );

      await expect(
        DatasetNFT.connect(contributor).proposeManyFragments(
          datasetId,
          [contributor.address, contributor.address, contributor.address],
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
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptManuallyVerifierFactory,
      } = await setupOnMint();
      const { dtAdmin, datasetOwner, contributor } =
        await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
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
        datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(datasetOwner).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const fragmentAddress = await DatasetNFT.fragments(datasetId);
      const DatasetFragment = (await ethers.getContractAt(
        "FragmentNFT",
        fragmentAddress
      )) as unknown as FragmentNFT;

      const tagSchemas = utils.encodeTag("dataset.schemas");
      const tagRows = utils.encodeTag("dataset.rows");
      const tagData = utils.encodeTag("dataset.data");

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeManySignature = await dtAdmin.signMessage(
        signature.getDatasetFragmentProposeBatchMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId,
          [contributor.address, contributor.address, contributor.address],
          [tagSchemas, tagRows, tagData]
        )
      );

      await expect(
        DatasetNFT.connect(contributor).proposeManyFragments(
          datasetId,
          [contributor.address, contributor.address],
          [tagSchemas],
          proposeManySignature
        )
      ).to.be.revertedWith("invalid length of fragments items");
    });

    it("Should contributor propose a fragment - default AcceptAllVerifier", async function () {
      const {
        DatasetNFT,
        datasetId,
        ERC20SubscriptionManagerFactory,
        DistributionManagerFactory,
        VerifierManagerFactory,
        AcceptAllVerifierFactory,
      } = await setupOnMint();
      const { dtAdmin, datasetOwner, contributor } =
        await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
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
        datasetOwner
      );

      const AcceptAllVerifier = await AcceptAllVerifierFactory.connect(
        datasetOwner
      ).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptAllVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const fragmentAddress = await DatasetNFT.fragments(datasetId);
      const DatasetFragment = (await ethers.getContractAt(
        "FragmentNFT",
        fragmentAddress
      )) as unknown as FragmentNFT;

      const lastFragmentPendingId =
        await DatasetFragment.lastFragmentPendingId();

      const proposeSignature = await dtAdmin.signMessage(
        signature.getDatasetFragmentProposeMessage(
          network.config.chainId!,
          await DatasetNFT.getAddress(),
          datasetId,
          lastFragmentPendingId + 1n,
          contributor.address,
          tag
        )
      );

      await expect(
        DatasetNFT.connect(contributor).proposeFragment(
          datasetId,
          contributor.address,
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
      } = await setupOnMint();
      const { dtAdmin, datasetOwner, contributor } =
        await ethers.getNamedSigners();

      const SubscriptionManager = await ERC20SubscriptionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const DistributionManager = await DistributionManagerFactory.connect(
        datasetOwner
      ).deploy();
      const VerifierManager = await VerifierManagerFactory.connect(
        datasetOwner
      ).deploy();

      await DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
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
        datasetOwner
      );

      const AcceptManuallyVerifier =
        await AcceptManuallyVerifierFactory.connect(datasetOwner).deploy();

      DatasetVerifierManager.setDefaultVerifier(
        await AcceptManuallyVerifier.getAddress()
      );

      const tag = utils.encodeTag("dataset.schemas");

      const proposeSignature = await dtAdmin.signMessage(getBytes("0x"));

      await expect(
        DatasetNFT.connect(contributor).proposeFragment(
          datasetId,
          contributor.address,
          tag,
          proposeSignature
        )
      ).to.be.revertedWithCustomError(DatasetNFT, "BAD_SIGNATURE");
    });
  });
});
