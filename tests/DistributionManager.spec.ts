import {
  AcceptManuallyVerifier,
  DatasetNFT,
  DistributionManager,
  ERC20LinearSingleDatasetSubscriptionManager,
  FragmentNFT,
  TestToken,
  VerifierManager,
} from "@typechained";
import {
  AddressLike,
  BytesLike,
  Signer,
  parseUnits,
  solidityPackedKeccak256,
} from "ethers";
import { ethers, network } from "hardhat";
import {
  getDatasetFragmentProposeMessage,
  getDatasetMintMessage,
} from "./utils/signature";
import { expect } from "chai";

describe("DistributionManager", () => {
  const datasetId = 1;
  const fragmentId = 1;
  const SIGNER_ROLE: BytesLike = solidityPackedKeccak256(
    ["string"],
    ["SIGNER_ROLE"]
  );

  let dataset: DatasetNFT;
  let fragmentImplementation: FragmentNFT;

  let admin: Signer;
  let user: Signer;

  let datasetDistributionManager: DistributionManager;
  let token: TestToken;

  let datasetAddress: AddressLike;
  let adminAddress: AddressLike;
  let userAddress: AddressLike;
  let fragmentImplementationAddress: AddressLike;
  let datasetDistributionManagerAddress: AddressLike;
  let tokenAddress: AddressLike;

  before(async () => {
    dataset = await ethers.deployContract("DatasetNFT");
    fragmentImplementation = await ethers.deployContract("FragmentNFT");

    admin = (await ethers.getSigners())[0];
    user = (await ethers.getSigners())[1];

    await dataset.grantRole(SIGNER_ROLE, await admin.getAddress());
    await dataset.grantRole(SIGNER_ROLE, await user.getAddress());

    token = await ethers.deployContract("TestToken", user);

    datasetAddress = await dataset.getAddress();
    adminAddress = await admin.getAddress();
    userAddress = await user.getAddress();
    fragmentImplementationAddress = await fragmentImplementation.getAddress();
    tokenAddress = await token.getAddress();

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

    await dataset.deployFragmentInstance(datasetId);

    const subscriptionManager = await ethers.deployContract(
      "ERC20LinearSingleDatasetSubscriptionManager"
    );
    const distributionManager = await ethers.deployContract(
      "DistributionManager"
    );
    const verifierManager = await ethers.deployContract("VerifierManager");

    await dataset.setManagers(datasetId, {
      subscriptionManager,
      distributionManager,
      verifierManager,
    });

    datasetDistributionManagerAddress = await dataset.distributionManager(
      datasetId
    );

    datasetDistributionManager = await ethers.getContractAt(
      "DistributionManager",
      datasetDistributionManagerAddress
    );
  });

  beforeEach(async () => {});

  it("Should set data set owner percentage to be sent on each payment", async function () {
    const percentage = parseUnits("0.01", 18);

    await datasetDistributionManager.setDatasetOwnerPercentage(percentage);

    expect(await datasetDistributionManager.datasetOwnerPercentage()).to.equal(
      percentage
    );
  });

  it("Should revert if data set owner percentage set is higher than 100%", async function () {
    const percentage = parseUnits("1.01", 18);

    await expect(
      datasetDistributionManager.setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Can't be higher than 100%");
  });

  it("Should revert set percentage if sender is not the data set owner", async function () {
    const percentage = parseUnits("1.01", 18);

    await expect(
      datasetDistributionManager
        .connect(user)
        .setDatasetOwnerPercentage(percentage)
    ).to.be.revertedWith("Not a Dataset owner");
  });

  it("Should set data set tag weights", async function () {});
  it("Should revert set tag weights if weights sum is not equal to 1^18", async function () {});
  it("Should user claim revenue", async function () {});
});
