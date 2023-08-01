import {
  AcceptManuallyVerifier,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from "@typechained";
import { expect } from "chai";
import {
  AddressLike,
  BytesLike,
  Signer,
  solidityPackedKeccak256,
} from "ethers";
import { ethers, network } from "hardhat";
import {
  getDatasetFragmentProposeMessage,
  getDatasetMintMessage,
} from "./utils/signature";
import { SIGNER_ROLE } from "./utils/constants";

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

    await dataset.grantRole(SIGNER_ROLE, await admin.getAddress());
    await dataset.grantRole(SIGNER_ROLE, await user.getAddress());

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

    const signature = await admin.signMessage(
      getDatasetMintMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        adminAddress
      )
    );

    await dataset.mint(datasetId, adminAddress, signature);

    await dataset.deployFragmentInstance(datasetId);

    await dataset.setManagers(datasetId, {
      subscriptionManager,
      distributionManager,
      verifierManager,
    });

    const tag = solidityPackedKeccak256(["string"], ["dataset.schemas"]);

    manuallyVerifierManager = await ethers.deployContract(
      "AcceptManuallyVerifier"
    );

    const manuallyVerifierAddress = await manuallyVerifierManager.getAddress();

    const verifierManagerAddress = await dataset.verifierManager(datasetId);

    const verifier = await ethers.getContractAt(
      "VerifierManager",
      verifierManagerAddress
    );

    verifier.setTagVerifier(tag, manuallyVerifierAddress);

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

    await dataset
      .connect(user)
      .proposeFragment(
        datasetId,
        fragmentId,
        userAddress,
        tag,
        proposeSignature
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
});
