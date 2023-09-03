import {
  AcceptManuallyVerifier,
  DatasetFactory,
  DatasetNFT,
  FragmentNFT,
} from "@typechained";
import { expect } from "chai";
import { ZeroAddress, ZeroHash, parseUnits } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { v4 as uuidv4 } from "uuid";
import { signature, utils } from "./utils";
import { getEvent } from "./utils/events";
import { setupUsers } from "./utils/users";

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
  const defaultVerifierAddress = await (
    await ethers.getContract("AcceptManuallyVerifier")
  ).getAddress();
  const feeAmount = parseUnits("0.1", 18);
  const dsOwnerPercentage = parseUnits("0.001", 18);

  await contracts.DatasetFactory.connect(
    users.datasetOwner
  ).mintAndConfigureDataset(
    users.datasetOwner.address,
    signedMessage,
    defaultVerifierAddress,
    await users.subscriber.Token!.getAddress(),
    feeAmount,
    dsOwnerPercentage,
    [ZeroHash],
    [parseUnits("1", 18)]
  );

  const tag = utils.encodeTag("dataset.schemas");

  const fragmentAddress = await contracts.DatasetNFT.fragments(datasetId);
  const DatasetFragment = (await ethers.getContractAt(
    "FragmentNFT",
    fragmentAddress
  )) as unknown as FragmentNFT;

  let fragmentIds: bigint[] = [];

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
    ...contracts,
  };
};

describe("FragmentNFT", () => {
  it("Should data set owner accept fragment propose", async function () {
    const {
      datasetId,
      fragmentIds,
      DatasetNFT,
      AcceptManuallyVerifier,
      users,
    } = await setup();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
        fragmentAddress,
        fragmentIds[0],
        true
      )
    )
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users.contributor.address, fragmentIds[0])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[0]);
  });

  it("Should data set owner accept multiple fragments proposes", async function () {
    const {
      datasetId,
      fragmentIds,
      DatasetNFT,
      AcceptManuallyVerifier,
      users,
    } = await setup();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(users.datasetOwner).resolveMany(
        fragmentAddress,
        fragmentIds,
        true
      )
    )
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users.contributor.address, fragmentIds[0])
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users.contributor.address, fragmentIds[1])
      .to.emit(DatasetFragment, "Transfer")
      .withArgs(ZeroAddress, users.contributor.address, fragmentIds[2])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[0])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[1])
      .to.emit(DatasetFragment, "FragmentAccepted")
      .withArgs(fragmentIds[2]);
  });

  it("Should data set owner reject fragment propose", async function () {
    const {
      datasetId,
      fragmentIds,
      DatasetNFT,
      AcceptManuallyVerifier,
      users,
    } = await setup();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
        fragmentAddress,
        fragmentIds[0],
        false
      )
    )
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[0]);
  });

  it("Should data set owner reject multiple fragments proposes", async function () {
    const {
      datasetId,
      fragmentIds,
      DatasetNFT,
      AcceptManuallyVerifier,
      users,
    } = await setup();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const DatasetFragment = await ethers.getContractAt(
      "FragmentNFT",
      fragmentAddress
    );

    await expect(
      AcceptManuallyVerifier.connect(users.datasetOwner).resolveMany(
        fragmentAddress,
        fragmentIds,
        false
      )
    )
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[0])
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[1])
      .to.emit(DatasetFragment, "FragmentRejected")
      .withArgs(fragmentIds[2]);
  });

  it("Should revert accept/reject fragment propose if fragment id does not exists", async function () {
    const { datasetId, DatasetNFT, AcceptManuallyVerifier, users } =
      await setup();

    const fragmentAddress = await DatasetNFT.fragments(datasetId);
    const wrongFragmentId = 1232131231;

    await expect(
      AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
        fragmentAddress,
        wrongFragmentId,
        false
      )
    ).to.be.revertedWith("Not a pending fragment");

    await expect(
      AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
        fragmentAddress,
        wrongFragmentId,
        true
      )
    ).to.be.revertedWith("Not a pending fragment");
  });

  it("Should data set owner remove a fragment", async function () {
    const { fragmentIds, DatasetFragment, AcceptManuallyVerifier, users } =
      await setup();

    await AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
      await DatasetFragment.getAddress(),
      fragmentIds[0],
      true
    );

    await expect(
      DatasetFragment.connect(users.datasetOwner).remove(fragmentIds[0])
    )
      .to.emit(DatasetFragment, "FragmentRemoved")
      .withArgs(fragmentIds[0]);

    expect(await DatasetFragment.tags(fragmentIds[0])).to.equal(ZeroHash);
  });

  it("Should revert if user tries to remove a fragment", async function () {
    const { fragmentIds, DatasetFragment, AcceptManuallyVerifier, users } =
      await setup();

    await AcceptManuallyVerifier.connect(users.datasetOwner).resolve(
      await DatasetFragment.getAddress(),
      fragmentIds[0],
      true
    );

    await expect(
      DatasetFragment.connect(users.user).remove(fragmentIds[0])
    ).to.be.revertedWithCustomError(DatasetFragment, "NOT_ADMIN");
  });
});
