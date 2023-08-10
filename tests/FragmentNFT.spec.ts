import { AcceptManuallyVerifier, DatasetNFT, FragmentNFT } from "@typechained";
import { expect } from "chai";
import { ZeroAddress, ZeroHash } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { v4 as uuidv4 } from "uuid";
import { signature, utils } from "./utils";

const setup = async () => {
  await deployments.fixture(["DatasetNFT"]);

  const contracts = {
    DatasetNFT: (await ethers.getContract("DatasetNFT")) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract(
      "FragmentNFT"
    )) as FragmentNFT,
  };

  const { dtAdmin, datasetOwner, contributor } = await ethers.getNamedSigners();
  const datasetId = 1;
  const fragmentId = 1;
  const fragmentIds = [1, 2, 3];

  const datasetAddress = await contracts.DatasetNFT.getAddress();

  const signedMessage = await dtAdmin.signMessage(
    signature.getDatasetMintMessage(
      network.config.chainId!,
      datasetAddress,
      datasetId,
      datasetOwner.address
    )
  );

  const datasetUUID = uuidv4();

  await contracts.DatasetNFT.connect(dtAdmin).setUuidForDatasetId(datasetUUID);

  await contracts.DatasetNFT.connect(datasetOwner).mint(
    datasetOwner.address,
    signedMessage
  );

  await contracts.DatasetNFT.connect(datasetOwner).deployFragmentInstance(
    datasetId
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

  const SubscriptionManager =
    await factories.ERC20SubscriptionManagerFactory.connect(
      datasetOwner
    ).deploy();
  const DistributionManager =
    await factories.DistributionManagerFactory.connect(datasetOwner).deploy();
  const VerifierManager = await factories.VerifierManagerFactory.connect(
    datasetOwner
  ).deploy();

  await contracts.DatasetNFT.connect(datasetOwner).setManagers(datasetId, {
    subscriptionManager: await SubscriptionManager.getAddress(),
    distributionManager: await DistributionManager.getAddress(),
    verifierManager: await VerifierManager.getAddress(),
  });

  const datasetVerifierManagerAddress =
    await contracts.DatasetNFT.verifierManager(datasetId);

  const DatasetVerifierManager = await ethers.getContractAt(
    "VerifierManager",
    datasetVerifierManagerAddress,
    datasetOwner
  );

  const AcceptManuallyVerifier =
    (await factories.AcceptManuallyVerifierFactory.connect(
      datasetOwner
    ).deploy()) as unknown as AcceptManuallyVerifier;

  DatasetVerifierManager.setDefaultVerifier(
    await AcceptManuallyVerifier.getAddress()
  );

  const tag = utils.encodeTag("dataset.schemas");

  const fragmentAddress = await contracts.DatasetNFT.fragments(datasetId);
  const DatasetFragment = (await ethers.getContractAt(
    "FragmentNFT",
    fragmentAddress
  )) as unknown as FragmentNFT;

  for (const _ of [1, 1, 1]) {
    const totalFragments = await DatasetFragment.totalFragments();

    const proposeSignatureSchemas = await dtAdmin.signMessage(
      signature.getDatasetFragmentProposeMessage(
        network.config.chainId!,
        datasetAddress,
        datasetId,
        totalFragments + 1n,
        contributor.address,
        tag
      )
    );

    await contracts.DatasetNFT.connect(contributor).proposeFragment(
      datasetId,
      contributor.address,
      tag,
      proposeSignatureSchemas
    );
  }

  return {
    datasetId,
    fragmentId,
    fragmentIds,
    AcceptManuallyVerifier,
    ...contracts,
    ...factories,
  };
};

describe("FragmentNFT", () => {
  it("Should data set owner accept fragment propose", async function () {
    const { datasetId, fragmentId, DatasetNFT, AcceptManuallyVerifier } =
      await setup();
    const { datasetOwner, contributor } = await ethers.getNamedSigners();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(datasetOwner).resolve(
        fragmentAddress,
        fragmentId,
        true
      )
    )
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, contributor.address, fragmentId)
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentId);
  });

  it("Should data set owner accept multiple fragments proposes", async function () {
    const { datasetId, fragmentIds, DatasetNFT, AcceptManuallyVerifier } =
      await setup();
    const { datasetOwner, contributor } = await ethers.getNamedSigners();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(datasetOwner).resolveMany(
        fragmentAddress,
        fragmentIds,
        true
      )
    )
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, contributor.address, fragmentIds[0])
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, contributor.address, fragmentIds[1])
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, contributor.address, fragmentIds[2])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[0])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[1])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[2]);
  });

  it("Should data set owner reject fragment propose", async function () {
    const { datasetId, fragmentId, DatasetNFT, AcceptManuallyVerifier } =
      await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(datasetOwner).resolve(
        fragmentAddress,
        fragmentId,
        false
      )
    )
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentId);
  });

  it("Should data set owner reject multiple fragments proposes", async function () {
    const { datasetId, fragmentIds, DatasetNFT, AcceptManuallyVerifier } =
      await setup();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.resolveMany(fragmentAddress, fragmentIds, false)
    )
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[0])
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[1])
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[2]);
  });

  it("Should revert accept/reject fragment propose if fragment id does not exists", async function () {
    const { datasetId, DatasetNFT, AcceptManuallyVerifier } = await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const wrongFragmentId = 1232131231;

    await expect(
      AcceptManuallyVerifier.connect(datasetOwner).resolve(
        fragmentAddress,
        wrongFragmentId,
        false
      )
    ).to.be.revertedWith("Not a pending fragment");

    await expect(
      AcceptManuallyVerifier.connect(datasetOwner).resolve(
        fragmentAddress,
        wrongFragmentId,
        true
      )
    ).to.be.revertedWith("Not a pending fragment");
  });

  it("Should data set owner remove a fragment", async function () {
    const { datasetId, fragmentId, DatasetNFT, AcceptManuallyVerifier } =
      await setup();
    const { datasetOwner } = await ethers.getNamedSigners();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = (await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    )) as unknown as FragmentNFT;

    await AcceptManuallyVerifier.connect(datasetOwner).resolve(
      fragmentAddress,
      fragmentId,
      true
    );

    await expect(DatasetFragment.connect(datasetOwner).remove(fragmentId))
      .to.emit(DatasetFragment, "FragmentRemoved")
      .withArgs(fragmentId);

    expect(await DatasetFragment.tags(fragmentId)).to.equal(ZeroHash);
  });

  it("Should revert if user tries to remove a fragment", async function () {
    const { datasetId, fragmentId, DatasetNFT, AcceptManuallyVerifier } =
      await setup();
    const { datasetOwner, user } = await ethers.getNamedSigners();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = (await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    )) as unknown as FragmentNFT;

    await AcceptManuallyVerifier.connect(datasetOwner).resolve(
      fragmentAddress,
      fragmentId,
      true
    );

    await expect(
      DatasetFragment.connect(user).remove(fragmentId)
    ).to.be.revertedWithCustomError(DatasetFragment, "NOT_ADMIN");
  });
});
