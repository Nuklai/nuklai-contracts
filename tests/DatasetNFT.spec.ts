import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  AcceptManuallyVerifier,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from "@typechained";
import {
  Signer,
  solidityPacked,
  getBytes,
  ZeroAddress,
  solidityPackedKeccak256,
  AddressLike,
} from "ethers";
import { SIGNER_ROLE } from "./utils/constants";
import {
  getDatasetFragmentProposeMessage,
  getDatasetMintMessage,
} from "./utils/signature";

describe("DatasetNFT", () => {
  const datasetId = 1;

  let dataset: DatasetNFT;
  let fragmentImplementation: FragmentNFT;

  let admin: Signer;
  let user: Signer;
  let userNotGranted: Signer;

  beforeEach(async () => {
    dataset = await ethers.deployContract("DatasetNFT");
    fragmentImplementation = await ethers.deployContract("FragmentNFT");

    admin = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];
    userNotGranted = (await ethers.getSigners())[2];

    await dataset.grantRole(SIGNER_ROLE, await admin.getAddress());
    await dataset.grantRole(SIGNER_ROLE, await user.getAddress());
  });

  it("Should dataset name be set on deploy", async function () {
    expect(await dataset.name()).to.equal("AllianceBlock DataTunel Dataset");
  });

  it("Should dataset symbol be set on deploy", async function () {
    expect(await dataset.symbol()).to.equal("ABDTDS");
  });

  it("Should admin be a signer", async function () {
    const adminAddress = await admin.getAddress();
    expect(await dataset.isSigner(adminAddress)).to.be.true;
  });

  it("Should mint dataset nft", async function () {
    const datasetAddress = await dataset.getAddress();
    const adminAddress = await admin.getAddress();

    const signature = await admin.signMessage(
      getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        adminAddress
      )
    );

    await expect(dataset.mint(datasetId, adminAddress, signature))
      .to.emit(dataset, "Transfer")
      .withArgs(ZeroAddress, adminAddress, datasetId);
  });

  it("Should not mint dataset nft twice", async function () {
    const datasetAddress = await dataset.getAddress();
    const adminAddress = await admin.getAddress();

    const signature = await admin.signMessage(
      getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        adminAddress
      )
    );

    await dataset.mint(datasetId, adminAddress, signature);

    expect(dataset.mint(datasetId, adminAddress, signature)).to.be.revertedWith(
      "ERC721: token already minted"
    );
  });

  it("Should revert mint dataset nft if signature is wrong", async function () {
    const adminAddress = await admin.getAddress();

    const signature = await admin.signMessage(getBytes("0x"));

    await expect(
      dataset.mint(datasetId, adminAddress, signature)
    ).to.be.revertedWithCustomError(dataset, "BAD_SIGNATURE");
  });

  it("Should revert mint dataset nft if signer role is not granted", async function () {
    const datasetAddress = await dataset.getAddress();
    const userAddress = await userNotGranted.getAddress();

    const signature = await userNotGranted.signMessage(
      getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        userAddress
      )
    );

    await expect(
      dataset.connect(userNotGranted).mint(datasetId, userAddress, signature)
    ).to.be.revertedWithCustomError(dataset, "BAD_SIGNATURE");
  });

  it("Should data set admin set fragment implementation", async function () {
    const fragmentAddress = await fragmentImplementation.getAddress();

    await dataset.setFragmentImplementation(fragmentAddress);

    expect(await dataset.fragmentImplementation()).to.equal(fragmentAddress);
  });

  it("Should revert if normal user tries to set fragment implementation address", async function () {
    const fragmentAddress = await fragmentImplementation.getAddress();
    const userAddress = await user.getAddress();

    await expect(
      dataset.connect(user).setFragmentImplementation(fragmentAddress)
    ).to.be.revertedWith(
      `AccessControl: account ${userAddress.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`
    );
  });

  it("Should revert on set fragment implementation if address is zero or non-contract", async function () {
    await expect(
      dataset.setFragmentImplementation(ZeroAddress)
    ).to.be.revertedWith("invalid fragment implementation address");

    const adminAddress = await admin.getAddress();
    await expect(
      dataset.setFragmentImplementation(adminAddress)
    ).to.be.revertedWith("invalid fragment implementation address");
  });

  describe("On mint", () => {
    const fragmentId = 1;

    let datasetAddress: AddressLike;
    let adminAddress: AddressLike;
    let userAddress: AddressLike;

    let fragmentImplementationAddress: AddressLike;

    let subscriptionManager: ERC20LinearSingleDatasetSubscriptionManager;
    let distributionManager: DistributionManager;
    let verifierManager: VerifierManager;

    let manuallyVerifier: AcceptManuallyVerifier;
    let manuallyVerifierAddress: AddressLike;

    beforeEach(async () => {
      datasetAddress = await dataset.getAddress();
      adminAddress = await admin.getAddress();
      userAddress = await user.getAddress();
      fragmentImplementationAddress = await fragmentImplementation.getAddress();

      await dataset.setFragmentImplementation(fragmentImplementationAddress);
      await dataset.fragmentImplementation();

      const signature = await admin.signMessage(
        getDatasetMintMessage(
          network.config.chainId!,
          datasetAddress,
          datasetId,
          adminAddress
        )
      );

      await dataset.mint(datasetId, adminAddress, signature);

      subscriptionManager = await ethers.deployContract(
        "ERC20LinearSingleDatasetSubscriptionManager"
      );
      distributionManager = await ethers.deployContract("DistributionManager");
      verifierManager = await ethers.deployContract("VerifierManager");

      manuallyVerifier = await ethers.deployContract("AcceptManuallyVerifier");
      manuallyVerifierAddress = await manuallyVerifier.getAddress();
    });

    it("Should deploy fragment instance", async function () {
      await expect(dataset.deployFragmentInstance(fragmentId)).to.emit(
        dataset,
        "FragmentInstanceDeployement"
      );
    });

    it("Should not deploy fragment instance if instance already exists", async function () {
      await dataset.deployFragmentInstance(fragmentId);
      await expect(
        dataset.deployFragmentInstance(fragmentId)
      ).to.be.revertedWith("fragment instance already deployed");
    });

    it("Should set dataset nft managers", async function () {
      await expect(
        dataset.setManagers(datasetId, {
          subscriptionManager,
          distributionManager,
          verifierManager,
        })
      )
        .to.emit(dataset, "ManagersConfigChange")
        .withArgs(datasetId);
    });

    it("Should revert set dataset nft managers if data set does not exists", async function () {
      const wrongDatasetId = 11231231;
      await expect(
        dataset.setManagers(wrongDatasetId, {
          subscriptionManager,
          distributionManager,
          verifierManager,
        })
      )
        .to.be.revertedWithCustomError(dataset, "NOT_OWNER")
        .withArgs(wrongDatasetId, adminAddress);
    });

    it("Should user propose a fragment", async function () {
      await dataset.deployFragmentInstance(datasetId);

      await dataset.setManagers(datasetId, {
        subscriptionManager,
        distributionManager,
        verifierManager,
      });

      const tag = solidityPackedKeccak256(["string"], ["dataset.schemas"]);

      const datasetVerifierManagerAddress = await dataset.verifierManager(
        datasetId
      );

      const datasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress
      );

      datasetVerifierManager.setTagVerifier(tag, manuallyVerifierAddress);

      const proposeSignature = await admin.signMessage(
        getDatasetFragmentProposeMessage(
          network.config.chainId!,
          datasetAddress,
          datasetId,
          fragmentId,
          userAddress,
          tag
        )
      );

      const fragmentAddress = await dataset.fragments(datasetId);
      const datasetFragment = await ethers.getContractAt(
        "FragmentNFT",
        fragmentAddress
      );

      await expect(
        dataset
          .connect(user)
          .proposeFragment(
            datasetId,
            fragmentId,
            userAddress,
            tag,
            proposeSignature
          )
      )
        .to.emit(datasetFragment, "FragmentPending")
        .withArgs(datasetId, tag);
    });

    it("Should revert a propose if fragment does not exists", async function () {
      await dataset.deployFragmentInstance(datasetId);

      await dataset.setManagers(datasetId, {
        subscriptionManager,
        distributionManager,
        verifierManager,
      });

      const tag = solidityPackedKeccak256(["string"], ["dataset.schemas"]);

      const datasetVerifierManagerAddress = await dataset.verifierManager(
        datasetId
      );

      const datasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress
      );

      datasetVerifierManager.setTagVerifier(tag, manuallyVerifierAddress);

      const proposeSignature = await admin.signMessage(
        getDatasetFragmentProposeMessage(
          network.config.chainId!,
          datasetAddress,
          datasetId,
          fragmentId,
          userAddress,
          tag
        )
      );

      const wrongFragmentId = 123123123;

      await expect(
        dataset
          .connect(user)
          .proposeFragment(
            datasetId,
            wrongFragmentId,
            userAddress,
            tag,
            proposeSignature
          )
      ).to.be.revertedWithCustomError(dataset, "BAD_SIGNATURE");
    });

    it("Should revert a propose if signature is wrong", async function () {
      await dataset.deployFragmentInstance(datasetId);

      await dataset.setManagers(datasetId, {
        subscriptionManager,
        distributionManager,
        verifierManager,
      });

      const tag = solidityPackedKeccak256(["string"], ["dataset.schemas"]);

      const datasetVerifierManagerAddress = await dataset.verifierManager(
        datasetId
      );

      const datasetVerifierManager = await ethers.getContractAt(
        "VerifierManager",
        datasetVerifierManagerAddress
      );

      datasetVerifierManager.setTagVerifier(tag, manuallyVerifierAddress);

      const proposeSignature = await admin.signMessage(getBytes("0x"));

      await expect(
        dataset
          .connect(user)
          .proposeFragment(
            datasetId,
            fragmentId,
            userAddress,
            tag,
            proposeSignature
          )
      ).to.be.revertedWithCustomError(dataset, "BAD_SIGNATURE");
    });
  });
});
