import {
  AcceptManuallyVerifier,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from "@typechained";
import { expect } from "chai";
import { AddressLike, Signer, ZeroAddress, ZeroHash } from "ethers";
import { ethers, network } from "hardhat";
import { constants, signature, utils } from "./utils";

describe("FragmentNFT", () => {
  const datasetId = 1;
  const fragmentId = 1;

  let dataset: DatasetNFT;
  let fragmentImplementation: FragmentNFT;

  let admin: Signer;
  let user: Signer;

  let subscriptionManager: ERC20LinearSingleDatasetSubscriptionManager;
  let distributionManager: DistributionManager;
  let verifierManager: VerifierManager;
  let manuallyVerifierManager: AcceptManuallyVerifier;

  let datasetAddress: AddressLike;
  let adminAddress: AddressLike;
  let userAddress: AddressLike;
  let fragmentImplementationAddress: AddressLike;

  beforeEach(async () => {
    dataset = await ethers.deployContract("DatasetNFT");
    fragmentImplementation = await ethers.deployContract("FragmentNFT");

    admin = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    await dataset.grantRole(constants.SIGNER_ROLE, await admin.getAddress());
    await dataset.grantRole(constants.SIGNER_ROLE, await user.getAddress());

    subscriptionManager = await ethers.deployContract(
      "ERC20LinearSingleDatasetSubscriptionManager"
    );
    distributionManager = await ethers.deployContract("DistributionManager");
    verifierManager = await ethers.deployContract("VerifierManager");

    datasetAddress = await dataset.getAddress();
    adminAddress = await admin.getAddress();
    userAddress = await user.getAddress();
    fragmentImplementationAddress = await fragmentImplementation.getAddress();

    await dataset.setFragmentImplementation(fragmentImplementationAddress);

    const signedMessage = await admin.signMessage(
      signature.getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        adminAddress
      )
    );

    await dataset.mint(datasetId, adminAddress, signedMessage);

    await dataset.deployFragmentInstance(datasetId);

    await dataset.setManagers(datasetId, {
      subscriptionManager,
      distributionManager,
      verifierManager,
    });

    manuallyVerifierManager = await ethers.deployContract(
      "AcceptManuallyVerifier"
    );

    const manuallyVerifierAddress = await manuallyVerifierManager.getAddress();

    const verifierManagerAddress = await dataset.verifierManager(datasetId);

    const verifier = await ethers.getContractAt(
      "VerifierManager",
      verifierManagerAddress
    );

    const datasetSchemasTag = utils.encodeTag("dataset.schemas");

    verifier.setTagVerifier(datasetSchemasTag, manuallyVerifierAddress);

    const proposeSignatureSchemas = await admin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        fragmentId,
        userAddress,
        datasetSchemasTag
      )
    );

    await dataset
      .connect(user)
      .proposeFragment(
        datasetId,
        fragmentId,
        userAddress,
        datasetSchemasTag,
        proposeSignatureSchemas
      );
  });

  it("Should accept fragment propose", async function () {
    const fragmentAddress = await dataset.fragments(datasetId);
    const datasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      manuallyVerifierManager.resolve(fragmentAddress, fragmentId, true)
    )
      .to.emit(datasetFragment, "Transfer")
      .withArgs(ZeroAddress, userAddress, fragmentId)
      .to.emit(datasetFragment, "FragmentAccepted")
      .withArgs(fragmentId);
  });

  it("Should reject fragment propose", async function () {
    const fragmentAddress = await dataset.fragments(datasetId);
    const datasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      manuallyVerifierManager.resolve(fragmentAddress, fragmentId, false)
    )
      .to.emit(datasetFragment, "FragmentRejected")
      .withArgs(fragmentId);
  });

  it("Should revert accept/reject fragment propose if fragment id does not exists", async function () {
    const fragmentAddress = await dataset.fragments(datasetId);
    const wrongFragmentId = 1232131231;

    await expect(
      manuallyVerifierManager.resolve(fragmentAddress, wrongFragmentId, false)
    ).to.be.revertedWith("Wrong verifier");

    await expect(
      manuallyVerifierManager.resolve(fragmentAddress, wrongFragmentId, true)
    ).to.be.revertedWith("Wrong verifier");
  });

  it("Should admin remove a fragment", async function () {
    const fragmentAddress = await dataset.fragments(datasetId);
    const datasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await manuallyVerifierManager.resolve(fragmentAddress, fragmentId, true);

    await expect(datasetFragment.remove(fragmentId))
      .to.emit(datasetFragment, "FragmentRemoved")
      .withArgs(fragmentId);

    expect(await datasetFragment.tags(fragmentId)).to.equal(ZeroHash);
  });

  it("Should revert if user tries to remove a fragment", async function () {
    const fragmentAddress = await dataset.fragments(datasetId);
    const datasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await manuallyVerifierManager.resolve(fragmentAddress, fragmentId, true);

    await expect(
      datasetFragment.connect(user).remove(fragmentId)
    ).to.be.revertedWithCustomError(datasetFragment, "NOT_ADMIN");
  });
});
