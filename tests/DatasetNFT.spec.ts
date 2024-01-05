import { expect } from 'chai';
import { deployments, ethers, network } from 'hardhat';
import {
  DatasetFactory,
  DatasetNFT,
  DistributionManager,
  ERC20SubscriptionManager,
  FragmentNFT,
} from '@typechained';
import {
  Contract,
  ContractFactory,
  getBytes,
  parseUnits,
  uuidV4,
  ZeroAddress,
  ZeroHash,
  EventLog,
} from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { signature, utils } from './utils';
import { encodeTag, getUuidHash, getUint256FromBytes32 } from './utils/utils';
import { constants } from '../utils';
import { getEvent } from './utils/events';
import { setupUsers } from './utils/users';
import { Signer } from './utils/users';
import {
  IDatasetNFT_Interface_Id,
  IERC165_Interface_Id,
  IERC721_Interface_Id,
  IAccessControl_Interface_Id,
  IERC721Metadata_Interface_Id,
} from './utils/selectors';
import { BASE_URI, DATASET_NFT_SUFFIX } from './utils/constants';
import { SIGNER_ROLE } from 'utils/constants';

async function setup() {
  await deployments.fixture([
    'ProxyAdmin',
    'FragmentNFT',
    'DatasetNFT',
    'DatasetManagers',
    'DatasetVerifiers',
    'DatasetFactory',
    'TestToken',
  ]);

  const users = await setupUsers();

  const contracts = {
    DatasetFactory: (await ethers.getContract('DatasetFactory')) as DatasetFactory,
    DatasetNFT: (await ethers.getContract('DatasetNFT')) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract('FragmentNFT')) as FragmentNFT,
  };

  return {
    users,
    ...contracts,
  };
}

const setupOnMint = async () => {
  await deployments.fixture([
    'ProxyAdmin',
    'FragmentNFT',
    'DatasetNFT',
    'DatasetManagers',
    'DatasetVerifiers',
    'DatasetFactory',
    'TestToken',
  ]);

  const contracts = {
    DatasetNFT: (await ethers.getContract('DatasetNFT')) as DatasetNFT,
  };

  const { DatasetNFT, DatasetFactory } = await setup();
  const users = await setupUsers();

  const datasetUUID = uuidv4();

  const uuidHash = getUuidHash(datasetUUID);

  const datasetAddress = await DatasetNFT.getAddress();
  const signedMessage = await users.dtAdmin.signMessage(
    signature.getDatasetMintMessage(
      network.config.chainId!,
      datasetAddress,
      uuidHash,
      users.datasetOwner.address
    )
  );

  const testToken = await ethers.getContract('TestToken');
  const testTokenAddress = await testToken.getAddress();

  await DatasetNFT.grantRole(constants.APPROVED_TOKEN_ROLE, testTokenAddress);

  const defaultVerifierAddress = await (
    await ethers.getContract('AcceptManuallyVerifier')
  ).getAddress();
  const feeAmount = parseUnits('0.1', 18);
  const dsOwnerPercentage = parseUnits('0.001', 18);

  const mintAndConfigureDatasetReceipt = await (
    await DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
      uuidHash,
      users.datasetOwner.address,
      signedMessage,
      defaultVerifierAddress,
      await users.datasetOwner.Token!.getAddress(),
      feeAmount,
      dsOwnerPercentage,
      [ZeroHash],
      [parseUnits('1', 18)]
    )
  ).wait();

  const [from, to, datasetId] = getEvent(
    'Transfer',
    mintAndConfigureDatasetReceipt?.logs!,
    DatasetNFT
  )!.args as unknown as [string, string, bigint];

  const factories = {
    DistributionManagerFactory: await ethers.getContractFactory('DistributionManager'),
    ERC20SubscriptionManagerFactory: await ethers.getContractFactory('ERC20SubscriptionManager'),
    VerifierManagerFactory: await ethers.getContractFactory('VerifierManager'),
    AcceptManuallyVerifierFactory: await ethers.getContractFactory('AcceptManuallyVerifier'),
    AcceptAllVerifierFactory: await ethers.getContractFactory('AcceptAllVerifier'),
  };

  const fragmentAddress = await DatasetNFT.fragments(datasetId);
  const DatasetFragment = (await ethers.getContractAt(
    'FragmentNFT',
    fragmentAddress
  )) as unknown as FragmentNFT;

  return {
    datasetId,
    datasetUuidHash: uuidHash,
    DatasetFragment,
    users,
    ...contracts,
    ...factories,
  };
};

// ---------------------------------------------------------------------------------------------------
export default async function suite(): Promise<void> {
  describe('DatasetNFT', () => {
    let snap: string;
    let users_: Record<string, Signer>;
    let DatasetNFT_: DatasetNFT;
    let DatasetFactory_: DatasetFactory;
    let FragmentNFTImplementation_: FragmentNFT;

    before(async () => {
      const { DatasetNFT, DatasetFactory, FragmentNFTImplementation, users } = await setup();

      users_ = users;
      DatasetNFT_ = DatasetNFT;
      DatasetFactory_ = DatasetFactory;
      FragmentNFTImplementation_ = FragmentNFTImplementation;
    });

    beforeEach(async () => {
      snap = await ethers.provider.send('evm_snapshot', []);
    });

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [snap]);
    });

    it('Should dataset name be set on deploy', async function () {
      expect(await DatasetNFT_.name()).to.equal('Nuklai Dataset');
    });

    it('Should dataset symbol be set on deploy', async function () {
      expect(await DatasetNFT_.symbol()).to.equal('NAIDS');
    });

    it('Should dataset fragment implementation be set on deploy', async function () {
      expect(await DatasetNFT_.fragmentImplementation()).to.equal(
        await FragmentNFTImplementation_.getAddress()
      );
    });

    it('Should dataset factory be set on deploy', async function () {
      const datasetFactory = await ethers.getContract('DatasetFactory');
      expect(await DatasetNFT_.datasetFactory()).to.equal(await datasetFactory.getAddress());
    });

    it('Should DT admin be able to set dataset factory address', async function () {
      const NewDatasetFactory = await deployments.deploy('DatasetFactory_new', {
        contract: 'DatasetFactory',
        from: users_.dtAdmin.address,
      });

      await DatasetNFT_.connect(users_.dtAdmin).setDatasetFactory(NewDatasetFactory.address);

      expect(await DatasetNFT_.datasetFactory()).to.equal(NewDatasetFactory.address);
    });

    it('Should revert to set dataset factory address if zero address', async function () {
      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setDatasetFactory(ZeroAddress)
      ).to.be.revertedWithCustomError(DatasetNFT_, 'DATASET_FACTORY_ZERO_ADDRESS');
    });

    it('Should DT admin be a signer', async function () {
      expect(await DatasetNFT_.isSigner(users_.dtAdmin)).to.be.true;
    });

    it('Should TestToken be approved', async function () {
      const testToken = await ethers.getContract('TestToken');
      const testTokenAddress = await testToken.getAddress();

      await DatasetNFT_.grantRole(constants.APPROVED_TOKEN_ROLE, testTokenAddress);
      expect(await DatasetNFT_.isApprovedToken(testTokenAddress)).to.be.true;
    });

    it('Should DT admin set a forwarder address for meta transactions', async function () {
      await expect(DatasetNFT_.connect(users_.dtAdmin).setTrustedForwarder(users_.dtAdmin.address))
        .to.emit(DatasetNFT_, 'TrustedForwarderChanged')
        .withArgs(users_.dtAdmin.address);

      expect(await DatasetNFT_.isTrustedForwarder(users_.dtAdmin.address)).to.be.true;
    });

    it('Should DT admin set a deployer beneficiary for fees', async function () {
      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

      expect(await DatasetNFT_.deployerFeeBeneficiary()).to.equal(users_.dtAdmin.address);
    });

    it('Should revert if non admin account tries to set deployer fee beneficiary address', async () => {
      await expect(
        DatasetNFT_.connect(users_.user).setDeployerFeeBeneficiary(users_.user.address)
      ).to.be.revertedWith(
        `AccessControl: account ${users_.user.address.toLowerCase()} is missing role ${ZeroHash}`
      );
    });

    it('Should setDeployerFeeBeneficiary() revert if trying to set zeroAddress as the beneficiary', async () => {
      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(ZeroAddress)
      ).to.be.revertedWithCustomError(DatasetNFT_, 'ZERO_ADDRESS');
    });

    it('Should setDeployerFeeModelPercentages() revert if models and percentages length mismatch', async () => {
      const percentages = [parseUnits('0.1', 18), parseUnits('0.35', 18)];

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
          [
            constants.DeployerFeeModel.DATASET_OWNER_STORAGE,
            constants.DeployerFeeModel.DEPLOYER_STORAGE,
            constants.DeployerFeeModel.NO_FEE,
          ],
          percentages
        )
      ).to.be.revertedWithCustomError(DatasetNFT_, 'ARRAY_LENGTH_MISMATCH');
    });

    it('Should setDeployerFeeModelPercentages() revert if beneficiary is zero address', async () => {
      const percentages = [parseUnits('0.1', 18), parseUnits('0.35', 18)];

      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
          [
            constants.DeployerFeeModel.DATASET_OWNER_STORAGE,
            constants.DeployerFeeModel.DEPLOYER_STORAGE,
            constants.DeployerFeeModel.NO_FEE,
          ],
          percentages
        )
      ).to.be.revertedWithCustomError(DatasetNFT_, 'BENEFICIARY_ZERO_ADDRESS');
    });

    it('Should DT admin set proxy admin address', async function () {
      const ProxyAdmin = await ethers.getContract('ProxyAdmin');

      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setFragmentProxyAdminAddress(
          await ProxyAdmin.getAddress()
        )
      ).to.not.be.reverted;
    });

    it('Should revert set proxy admin address if it is not a contract', async function () {
      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setFragmentProxyAdminAddress(users_.user.address)
      ).to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_PROXY_ADDRESS_INVALID');
    });

    it('Should DT admin set fee model percentage for deployer', async function () {
      const percentage = parseUnits('0.35', 18);

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
        [constants.DeployerFeeModel.DEPLOYER_STORAGE],
        [percentage]
      );

      expect(
        await DatasetNFT_.deployerFeeModelPercentage(constants.DeployerFeeModel.DEPLOYER_STORAGE)
      ).to.equal(percentage);
    });

    it('Should DT admin set fee model percentage for data set owners', async function () {
      const percentage = parseUnits('0.1', 18);

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

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

    it('Should revert set deployer fee model percentage if goes over 100%', async function () {
      const percentage100Percent = parseUnits('1', 18);
      const percentage = parseUnits('1.1', 18);

      await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeBeneficiary(users_.dtAdmin.address);

      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModelPercentages(
          [constants.DeployerFeeModel.DEPLOYER_STORAGE],
          [percentage]
        )
      )
        .to.be.revertedWithCustomError(DatasetNFT_, 'PERCENTAGE_VALUE_INVALID')
        .withArgs(percentage100Percent, percentage);
    });

    it('Should revert set deployer fee model percentage if not DT admin', async function () {
      const percentage = parseUnits('1', 18);

      await expect(
        DatasetNFT_.connect(users_.user).setDeployerFeeModelPercentages(
          [constants.DeployerFeeModel.DATASET_OWNER_STORAGE],
          [percentage]
        )
      ).to.be.revertedWith(
        `AccessControl: account ${users_.user.address.toLowerCase()} is missing role ${ZeroHash}`
      );
    });

    it('Should fee model percentage NO_FEE be zero', async function () {
      expect(
        await DatasetNFT_.deployerFeeModelPercentage(constants.DeployerFeeModel.NO_FEE)
      ).to.equal(0);
    });

    it('Should revert if someone tries to re-initialize contract', async function () {
      await expect(DatasetNFT_.initialize(users_.dtAdmin.address, ZeroAddress)).to.be.revertedWith(
        'Initializable: contract is already initialized'
      );
    });

    it('Should a data set owner mint dataset', async function () {
      const datasetUUID = uuidv4();

      const uuidHash = getUuidHash(datasetUUID);

      const dt_Id = getUint256FromBytes32(uuidHash);

      const datasetAddress = await DatasetNFT_.getAddress();
      const signedMessage = await users_.dtAdmin.signMessage(
        signature.getDatasetMintMessage(
          network.config.chainId!,
          datasetAddress,
          uuidHash,
          users_.datasetOwner.address
        )
      );

      const testToken = await ethers.getContract('TestToken');
      const testTokenAddress = await testToken.getAddress();

      await DatasetNFT_.grantRole(constants.APPROVED_TOKEN_ROLE, testTokenAddress);

      const defaultVerifierAddress = await (
        await ethers.getContract('AcceptManuallyVerifier')
      ).getAddress();
      const feeAmount = parseUnits('0.1', 18);
      const dsOwnerPercentage = parseUnits('0.001', 18);

      await expect(
        DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        )
      )
        .to.emit(DatasetNFT_, 'ManagersConfigChange')
        .withArgs(dt_Id)
        .to.emit(DatasetNFT_, 'Transfer')
        .withArgs(ZeroAddress, await DatasetFactory_.getAddress(), dt_Id)
        .to.emit(DatasetNFT_, 'Transfer')
        .withArgs(await DatasetFactory_.getAddress(), users_.datasetOwner.address, dt_Id);
    });

    it('Should revert mint dataset if dataset factory is zero address', async function () {
      const proxyAdmin = await ethers.getContract('ProxyAdmin');
      const proxyAdminAddress = await proxyAdmin.getAddress();

      const deployedDatasetNFT = await deployments.deploy('DatasetNFT_new', {
        contract: 'DatasetNFT',
        from: users_.dtAdmin.address,
        log: true,
        proxy: {
          owner: proxyAdminAddress,
          proxyContract: 'TransparentUpgradeableProxy',
          execute: {
            init: {
              methodName: 'initialize',
              args: [users_.dtAdmin.address, ZeroAddress],
            },
          },
        },
      });

      const DatasetNFT = (await ethers.getContractAt(
        'DatasetNFT',
        deployedDatasetNFT.address
      )) as unknown as DatasetNFT;

      await DatasetNFT.connect(users_.dtAdmin).grantRole(
        constants.SIGNER_ROLE,
        users_.dtAdmin.address
      );

      const datasetUUID = uuidv4();

      const uuidHash = getUuidHash(datasetUUID);

      const datasetId = getUint256FromBytes32(uuidHash);

      const signedMessage = await users_.dtAdmin.signMessage(
        signature.getDatasetMintMessage(
          network.config.chainId!,
          deployedDatasetNFT.address,
          uuidHash,
          users_.datasetOwner.address
        )
      );

      const testToken = await ethers.getContract('TestToken');
      const testTokenAddress = await testToken.getAddress();

      await DatasetNFT.connect(users_.dtAdmin).grantRole(
        constants.APPROVED_TOKEN_ROLE,
        testTokenAddress
      );

      const defaultVerifierAddress = await (
        await ethers.getContract('AcceptManuallyVerifier')
      ).getAddress();
      const feeAmount = parseUnits('0.1', 18);
      const dsOwnerPercentage = parseUnits('0.001', 18);

      const subscriptionManager = await ethers.getContract('ERC20SubscriptionManager');
      const distributionManager = await ethers.getContract('DistributionManager');
      const verifierManager = await ethers.getContract('VerifierManager');

      await DatasetFactory_.connect(users_.dtAdmin).configure(
        deployedDatasetNFT.address,
        await subscriptionManager.getAddress(),
        await distributionManager.getAddress(),
        await verifierManager.getAddress()
      );

      await expect(
        DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        )
      ).to.be.revertedWithCustomError(DatasetNFT_, 'DATASET_FACTORY_ZERO_ADDRESS');
    });

    it('Should data set owner not mint a dataset twice', async function () {
      const datasetUUID = uuidv4();

      const uuidHash = getUuidHash(datasetUUID);

      const datasetAddress = await DatasetNFT_.getAddress();
      const signedMessage = await users_.dtAdmin.signMessage(
        signature.getDatasetMintMessage(
          network.config.chainId!,
          datasetAddress,
          uuidHash,
          users_.datasetOwner.address
        )
      );

      const testToken = await ethers.getContract('TestToken');
      const testTokenAddress = await testToken.getAddress();

      await DatasetNFT_.grantRole(constants.APPROVED_TOKEN_ROLE, testTokenAddress);

      const defaultVerifierAddress = await (
        await ethers.getContract('AcceptManuallyVerifier')
      ).getAddress();
      const feeAmount = parseUnits('0.1', 18);
      const dsOwnerPercentage = parseUnits('0.001', 18);

      await DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
        uuidHash,
        users_.datasetOwner.address,
        signedMessage,
        defaultVerifierAddress,
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount,
        dsOwnerPercentage,
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      // Same uuidHash used --> should revert since the same tokenId (uint256(uuidHash)) cannot be minted again
      await expect(
        DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        )
      ).to.be.revertedWith('ERC721: token already minted');
    });

    it('Should revert mint dataset if DT admin signature is wrong', async function () {
      const signedMessage = await users_.datasetOwner.signMessage(getBytes('0x'));

      const datasetUUID = uuidv4();

      const uuidHash = getUuidHash(datasetUUID);

      const defaultVerifierAddress = await (
        await ethers.getContract('AcceptManuallyVerifier')
      ).getAddress();
      const feeAmount = parseUnits('0.1', 18);
      const dsOwnerPercentage = parseUnits('0.001', 18);

      await expect(
        DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        )
      ).to.be.revertedWithCustomError(DatasetNFT_, 'BAD_SIGNATURE');
    });

    it('Should revert mint dataset if DT admin signer role is not granted', async function () {
      const datasetUUID = uuidv4();

      const uuidHash = getUuidHash(datasetUUID);

      const datasetAddress = await DatasetNFT_.getAddress();
      const signedMessage = await users_.user.signMessage(
        signature.getDatasetMintMessage(
          network.config.chainId!,
          datasetAddress,
          uuidHash,
          users_.datasetOwner.address
        )
      );
      const defaultVerifierAddress = await (
        await ethers.getContract('AcceptManuallyVerifier')
      ).getAddress();
      const feeAmount = parseUnits('0.1', 18);
      const dsOwnerPercentage = parseUnits('0.001', 18);

      await expect(
        DatasetFactory_.connect(users_.datasetOwner).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        )
      ).to.be.revertedWithCustomError(DatasetNFT_, 'BAD_SIGNATURE');
    });

    it('Should DatasetNFT admin contract set a new fragment implementation', async function () {
      const newFragmentImplementation = await deployments.deploy('FragmentNFT_new', {
        contract: 'FragmentNFT',
        from: users_.dtAdmin.address,
      });

      await DatasetNFT_.connect(users_.dtAdmin).setFragmentImplementation(
        newFragmentImplementation.address
      );

      expect(await DatasetNFT_.fragmentImplementation()).to.equal(
        newFragmentImplementation.address
      );
    });

    it('Should revert if normal user tries to set fragment implementation address', async function () {
      const newFragmentImplementation = await deployments.deploy('FragmentNFT_new2', {
        contract: 'FragmentNFT',
        from: users_.user.address,
      });

      await expect(
        DatasetNFT_.connect(users_.user).setFragmentImplementation(
          newFragmentImplementation.address
        )
      ).to.be.revertedWith(
        `AccessControl: account ${users_.user.address.toLowerCase()} is missing role ${ZeroHash}`
      );
    });

    it('Should revert on set fragment implementation if address is a wallet', async function () {
      await expect(
        DatasetNFT_.connect(users_.dtAdmin).setFragmentImplementation(users_.user.address)
      )
        .to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_IMPLEMENTATION_INVALID')
        .withArgs(users_.user.address);
    });

    it('Should supportsInterface() return true if id provided is either IDatasetNFT, IERC721, IAccessControl or IERC165', async () => {
      expect(await DatasetNFT_.supportsInterface(IDatasetNFT_Interface_Id)).to.be.true;
      expect(await DatasetNFT_.supportsInterface(IERC721_Interface_Id)).to.be.true;
      expect(await DatasetNFT_.supportsInterface(IERC165_Interface_Id)).to.be.true;
      expect(await DatasetNFT_.supportsInterface(IAccessControl_Interface_Id)).to.be.true;
      expect(await DatasetNFT_.supportsInterface(IERC721Metadata_Interface_Id)).to.be.true;
    });

    it('Should supportsInterface() return false if id provided is not supported', async () => {
      const mockInterfaceId = '0xff123456';
      expect(await DatasetNFT_.supportsInterface(mockInterfaceId)).to.be.false;
    });

    // ------------------------------------------------------------------------------------

    describe('On mint', () => {
      let snap: string;
      let DatasetNFT_: DatasetNFT;
      let DatasetFragment_: FragmentNFT;
      let ERC20SubscriptionManagerFactory_: ContractFactory<any[], Contract>;
      let DistributionManagerFactory_: ContractFactory<any[], Contract>;
      let VerifierManagerFactory_: ContractFactory<any[], Contract>;
      let AcceptAllVerifierFactory_: ContractFactory<any[], Contract>;
      let AcceptManuallyVerifierFactory_: ContractFactory<any[], Contract>;
      let datasetId_: bigint;
      let datasetUuidHash_: string;
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
          datasetUuidHash,
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
        datasetUuidHash_ = datasetUuidHash;
        users_ = users;
      });

      beforeEach(async () => {
        snap = await ethers.provider.send('evm_snapshot', []);
      });

      afterEach(async () => {
        await ethers.provider.send('evm_revert', [snap]);
      });

      it('Should get deployer fee percentage by dataset id', async () => {
        expect(
          await DatasetNFT_.connect(users_.datasetOwner).deployerFeePercentage(datasetId_)
        ).to.be.equal(0);
      });

      it('Should revert if non signer account tries to set deployer fee model for a dataset', async () => {
        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setDeployerFeeModel(
            datasetId_,
            constants.DeployerFeeModel.DATASET_OWNER_STORAGE
          )
        ).to.be.revertedWith(
          `AccessControl: account ${users_.datasetOwner.address.toLowerCase()} is missing role ${
            constants.SIGNER_ROLE
          }`
        );
      });

      it('Should DT admin set base URI for handle metadata', async () => {
        await DatasetNFT_.connect(users_.dtAdmin).setBaseURI(BASE_URI);

        expect(await DatasetNFT_.baseURI()).to.equal(BASE_URI);
      });

      it('Should base URI be empty if not set', async () => {
        expect(await DatasetNFT_.baseURI()).to.equal('');
      });

      it('Should DatasetNFT contract URI be set if base URI is set', async () => {
        await DatasetNFT_.connect(users_.dtAdmin).setBaseURI(BASE_URI);

        expect(await DatasetNFT_.contractURI()).to.equal(BASE_URI + DATASET_NFT_SUFFIX);
      });

      it('Should DatasetNFT contract URI be empty if base URI is not set', async () => {
        expect(await DatasetNFT_.contractURI()).to.equal('');
      });

      it('Should retrieve token URI if dataset id exists', async () => {
        await DatasetNFT_.connect(users_.dtAdmin).setBaseURI(BASE_URI);

        expect(await DatasetNFT_.tokenURI(datasetId_)).to.equal(
          BASE_URI + DATASET_NFT_SUFFIX + '/' + datasetId_
        );
      });

      it('Should token URI be empty if baseURI is not set', async () => {
        expect(await DatasetNFT_.tokenURI(datasetId_)).to.equal('');
      });

      it('Should revert retrieving token URI if dataset id does not exists', async () => {
        const wrongDatasetId = 2312312312321;
        await expect(DatasetNFT_.tokenURI(wrongDatasetId))
          .to.be.revertedWithCustomError(DatasetNFT_, 'TOKEN_ID_NOT_EXISTS')
          .withArgs(wrongDatasetId);
      });

      it('Should DT admin set deployer fee model for a data set', async function () {
        await DatasetNFT_.connect(users_.dtAdmin).setDeployerFeeModel(
          datasetId_,
          constants.DeployerFeeModel.DEPLOYER_STORAGE
        );

        expect(await DatasetNFT_.deployerFeeModels(datasetId_)).to.equal(
          constants.DeployerFeeModel.DEPLOYER_STORAGE
        );
      });

      it('Should DT admin add managers to whitelist', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        expect(await DatasetNFT_.isWhitelistedManager(await SubscriptionManager.getAddress())).to.be
          .true;
        expect(await DatasetNFT_.isWhitelistedManager(await DistributionManager.getAddress())).to.be
          .true;
        expect(await DatasetNFT_.isWhitelistedManager(await VerifierManager.getAddress())).to.be
          .true;
      });

      it('Should DT admin disable fragment instance creation', async () => {
        const uuId_Dataset2nd = uuidv4();

        const uuidHash = getUuidHash(uuId_Dataset2nd);

        const expected_2nd_DataSetId = getUint256FromBytes32(uuidHash);

        // Generate Signature for minting the 2nd dataset NFT
        const signedMintMessage = await users_.dtAdmin.signMessage(
          signature.getDatasetMintMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            uuidHash,
            users_.datasetOwner.address
          )
        );

        const defaultVerifierAddress = await (
          await ethers.getContract('AcceptManuallyVerifier')
        ).getAddress();
        const feeAmount = parseUnits('0.1', 18);
        const dsOwnerPercentage = parseUnits('0.001', 18);

        await DatasetFactory_.connect(users_.dtAdmin).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMintMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        );

        // Now datasetOwner should be the owner of 2nd dataSetNFT
        expect(await DatasetNFT_.ownerOf(expected_2nd_DataSetId)).to.equal(
          users_.datasetOwner.address
        );

        // 2nd Dataset NFT owner should not be able to deploy the fragment instance if already called mintAndConfigureDataset()
        await expect(
          DatasetNFT_.connect(users_.datasetOwner).deployFragmentInstance(expected_2nd_DataSetId)
        ).to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_INSTANCE_ALREADY_DEPLOYED');

        // Admin sets fragment implementation to zeroAddress, thus disabling the creation of fragment instances
        await DatasetNFT_.connect(users_.dtAdmin).setFragmentImplementation(ZeroAddress);
        expect(await DatasetNFT_.fragmentImplementation()).to.equal(ZeroAddress);

        // 2nd Dataset NFT owner tries to deploy the fragment instance of his dataset
        // Should fail since it is currently disabled by admin
        await expect(
          DatasetNFT_.connect(users_.datasetOwner).deployFragmentInstance(expected_2nd_DataSetId)
        ).to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_CREATION_DISABLED');
      });

      it('Should deployFragmentInstance() revert if caller is not token owner', async () => {
        const uuId_Dataset2nd = uuidv4();

        const uuidHash = getUuidHash(uuId_Dataset2nd);

        const second_datasetId = getUint256FromBytes32(uuidHash);

        // Generate Signature for minting the 2nd dataset NFT
        const signedMintMessage = await users_.dtAdmin.signMessage(
          signature.getDatasetMintMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            uuidHash,
            users_.datasetOwner.address
          )
        );

        const defaultVerifierAddress = await (
          await ethers.getContract('AcceptManuallyVerifier')
        ).getAddress();
        const feeAmount = parseUnits('0.1', 18);
        const dsOwnerPercentage = parseUnits('0.001', 18);

        await DatasetFactory_.connect(users_.dtAdmin).mintAndConfigureDataset(
          uuidHash,
          users_.datasetOwner.address,
          signedMintMessage,
          defaultVerifierAddress,
          await users_.datasetOwner.Token!.getAddress(),
          feeAmount,
          dsOwnerPercentage,
          [ZeroHash],
          [parseUnits('1', 18)]
        );

        // Now datasetOwner should be the owner of 2nd dataSetNFT
        expect(await DatasetNFT_.ownerOf(second_datasetId)).to.equal(users_.datasetOwner.address);

        await expect(DatasetNFT_.connect(users_.dtAdmin).deployFragmentInstance(second_datasetId))
          .to.be.revertedWithCustomError(DatasetNFT_, 'NOT_OWNER')
          .withArgs(second_datasetId, users_.dtAdmin.address);
      });

      it('Should revert when token owner tries to set managers to the zeroAddress', async () => {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          ZeroAddress
        );

        const subscriptionManagerAddr = await SubscriptionManager.getAddress();
        const distributionManagerAddr = await DistributionManager.getAddress();
        const verifierManagerAddr = await VerifierManager.getAddress();

        // ManagersConfig :: {subscription, distribution, verifier}
        const config1 = {
          subscriptionManager: ZeroAddress,
          distributionManager: distributionManagerAddr,
          verifierManager: verifierManagerAddr,
        };
        const config2 = {
          subscriptionManager: subscriptionManagerAddr,
          distributionManager: ZeroAddress,
          verifierManager: verifierManagerAddr,
        };
        const config3 = {
          subscriptionManager: subscriptionManagerAddr,
          distributionManager: distributionManagerAddr,
          verifierManager: ZeroAddress,
        };

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config1)
        ).to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_ZERO_ADDRESS');

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config2)
        ).to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_ZERO_ADDRESS');

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config3)
        ).to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_ZERO_ADDRESS');
      });

      it('Should revert when data set owner tries to set managers with invalid interface id', async () => {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        const subscriptionManagerAddr = await SubscriptionManager.getAddress();
        const distributionManagerAddr = await DistributionManager.getAddress();
        const verifierManagerAddr = await VerifierManager.getAddress();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        // ManagersConfig :: {subscription, distribution, verifier}
        let config = {
          distributionManager: verifierManagerAddr,
          subscriptionManager: distributionManagerAddr,
          verifierManager: subscriptionManagerAddr,
        };

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config))
          .to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_INTERFACE_INVALID')
          .withArgs(verifierManagerAddr);

        config = {
          distributionManager: distributionManagerAddr,
          subscriptionManager: distributionManagerAddr,
          verifierManager: subscriptionManagerAddr,
        };

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config))
          .to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_INTERFACE_INVALID')
          .withArgs(distributionManagerAddr);

        config = {
          distributionManager: distributionManagerAddr,
          subscriptionManager: subscriptionManagerAddr,
          verifierManager: subscriptionManagerAddr,
        };

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config))
          .to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_INTERFACE_INVALID')
          .withArgs(subscriptionManagerAddr);

        config = {
          distributionManager: distributionManagerAddr,
          subscriptionManager: subscriptionManagerAddr,
          verifierManager: verifierManagerAddr,
        };

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config)).to
          .not.be.reverted;
      });

      it('Should revert when data set owner tries to set non-whitelisted managers', async () => {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();

        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        const subscriptionManagerAddr = await SubscriptionManager.getAddress();
        const distributionManagerAddr = await DistributionManager.getAddress();
        const verifierManagerAddr = await VerifierManager.getAddress();

        // ManagersConfig :: {subscription, distribution, verifier}
        const config = {
          distributionManager: distributionManagerAddr,
          subscriptionManager: subscriptionManagerAddr,
          verifierManager: verifierManagerAddr,
        };

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config))
          .to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_NOT_WHITELISTED')
          .withArgs(distributionManagerAddr);

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config))
          .to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_NOT_WHITELISTED')
          .withArgs(subscriptionManagerAddr);

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config))
          .to.be.revertedWithCustomError(DatasetNFT_, 'MANAGER_NOT_WHITELISTED')
          .withArgs(verifierManagerAddr);

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await expect(DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, config)).to
          .not.be.reverted;
      });

      it('Should not emit event if all managers provided are the same as currently set', async () => {
        const config = await DatasetNFT_.configurations(datasetId_);

        const currentSubscriptionManagerAddr = config[0];
        const currentDistributionManagerAddr = config[1];
        const currentVerifierManagerAddr = config[2];

        const sameConfig = {
          subscriptionManager: currentSubscriptionManagerAddr,
          distributionManager: currentDistributionManagerAddr,
          verifierManager: currentVerifierManagerAddr,
        };

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, sameConfig)
        ).to.not.emit(DatasetNFT_, 'ManagersConfigChange');
      });

      it('Should data set owner not deploy fragment instance if already exists', async function () {
        await expect(
          DatasetNFT_.connect(users_.datasetOwner).deployFragmentInstance(datasetId_)
        ).to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_INSTANCE_ALREADY_DEPLOYED');
      });

      it('Should data set owner set managers', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
            subscriptionManager: await SubscriptionManager.getAddress(),
            distributionManager: await DistributionManager.getAddress(),
            verifierManager: await VerifierManager.getAddress(),
          })
        )
          .to.emit(DatasetNFT_, 'ManagersConfigChange')
          .withArgs(datasetId_);
      });

      it('Should revert set dataset nft managers if data set does not exists', async function () {
        const wrongDatasetId = 11231231;

        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).setManagers(wrongDatasetId, {
            subscriptionManager: await SubscriptionManager.getAddress(),
            distributionManager: await DistributionManager.getAddress(),
            verifierManager: await VerifierManager.getAddress(),
          })
        )
          .to.be.revertedWithCustomError(DatasetNFT_, 'NOT_OWNER')
          .withArgs(wrongDatasetId, users_.datasetOwner.address);
      });

      it('Should contributor propose a fragment - default AcceptManuallyVerifier', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        });

        const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(datasetId_);

        const DatasetVerifierManager = await ethers.getContractAt(
          'VerifierManager',
          datasetVerifierManagerAddress,
          users_.datasetOwner
        );

        const AcceptManuallyVerifier = await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy(await DatasetNFT_.getAddress());

        DatasetVerifierManager.setDefaultVerifier(await AcceptManuallyVerifier.getAddress());

        const tag = utils.encodeTag('dataset.schemas');

        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

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
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 1n, tag);
      });

      it('Should data set owner to be exempt when adding a fragment - default AcceptManuallyVerifier', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        });

        const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(datasetId_);

        const DatasetVerifierManager = await ethers.getContractAt(
          'VerifierManager',
          datasetVerifierManagerAddress,
          users_.datasetOwner
        );

        const AcceptManuallyVerifier = await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy(await DatasetNFT_.getAddress());

        await DatasetVerifierManager.setDefaultVerifier(await AcceptManuallyVerifier.getAddress());

        const tag = utils.encodeTag('dataset.schemas');

        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

        const proposeSignature = await users_.dtAdmin.signMessage(
          signature.getDatasetFragmentProposeMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            datasetId_,
            lastFragmentPendingId + 1n,
            users_.datasetOwner.address,
            tag
          )
        );

        await expect(
          DatasetNFT_.connect(users_.datasetOwner).proposeFragment(
            datasetId_,
            users_.datasetOwner.address,
            tag,
            proposeSignature
          )
        )
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 1n, tag)
          .to.emit(DatasetVerifierManager, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 1n)
          .to.emit(DatasetVerifierManager, 'FragmentResolved')
          .withArgs(lastFragmentPendingId + 1n, true)
          .to.emit(DatasetFragment_, 'FragmentAccepted')
          .withArgs(lastFragmentPendingId + 1n);
      });

      it('Should proposeFragment() revert if contributor is address zero', async () => {
        const tag = utils.encodeTag('dataset.metadata');
        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

        const proposeSignature = await users_.dtAdmin.signMessage(
          signature.getDatasetFragmentProposeMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            datasetId_,
            lastFragmentPendingId + 1n,
            ZeroAddress,
            tag
          )
        );

        await expect(
          DatasetNFT_.connect(users_.contributor).proposeFragment(
            datasetId_,
            ZeroAddress,
            tag,
            proposeSignature
          )
        ).to.be.revertedWithCustomError(DatasetFragment_, 'ZERO_ADDRESS');
      });

      it('Should proposeFragment() revert if no FragmentInstance for dataset is deployed', async () => {
        // Currently only one dataSet is supported from the protocol  with `datasetId_` erc721 id
        await expect(DatasetNFT_.ownerOf(datasetId_ + BigInt(1))).to.be.revertedWith(
          'ERC721: invalid token ID'
        );
        expect(await DatasetNFT_.fragments(datasetId_ + BigInt(1))).to.equal(ZeroAddress);

        // Contributor tries to propose fragment for non existing dataset (thus no FragmentInstance deployed yet for such dataset)
        const nonExistentDatasetId = datasetId_ + BigInt(1);
        const tag = utils.encodeTag('dataset.metadata');
        const signatureMock = '0xff';

        await expect(
          DatasetNFT_.connect(users_.contributor).proposeFragment(
            nonExistentDatasetId,
            users_.contributor.address,
            tag,
            signatureMock
          )
        ).to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_INSTANCE_NOT_DEPLOYED');
      });

      it('Should proposeManyFragments() revert if no FragmentInstance for dataset is deployed', async () => {
        // Currently only one dataSet is supported from the protocol  with `datasetId_` erc721 id
        await expect(DatasetNFT_.ownerOf(datasetId_ + BigInt(1))).to.be.revertedWith(
          'ERC721: invalid token ID'
        );
        expect(await DatasetNFT_.fragments(datasetId_ + BigInt(1))).to.equal(ZeroAddress);

        // Contributor tries to propose many fragments for non existing dataset (thus no FragmentInstance deployed yet for such dataset)
        const nonExistentDatasetId = datasetId_ + BigInt(1);
        const tags = [utils.encodeTag('dataset.metadata'), utils.encodeTag('dataset.schemas')];
        const signatureMock = '0xff';

        await expect(
          DatasetNFT_.connect(users_.contributor).proposeManyFragments(
            nonExistentDatasetId,
            [users_.contributor, users_.contributor],
            tags,
            signatureMock
          )
        ).to.be.revertedWithCustomError(DatasetNFT_, 'FRAGMENT_INSTANCE_NOT_DEPLOYED');
      });

      it('Should contributor propose multiple fragments - default AcceptManuallyVerifier', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        });

        const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(datasetId_);

        const DatasetVerifierManager = await ethers.getContractAt(
          'VerifierManager',
          datasetVerifierManagerAddress,
          users_.datasetOwner
        );

        const AcceptManuallyVerifier = await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy(await DatasetNFT_.getAddress());

        DatasetVerifierManager.setDefaultVerifier(await AcceptManuallyVerifier.getAddress());

        const tagSchemas = utils.encodeTag('dataset.schemas');
        const tagRows = utils.encodeTag('dataset.rows');
        const tagData = utils.encodeTag('dataset.data');

        const tags = [tagSchemas, tagRows, tagData];

        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

        const proposeManySignature = await users_.dtAdmin.signMessage(
          signature.getDatasetFragmentProposeBatchMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            datasetId_,
            lastFragmentPendingId + 1n,
            lastFragmentPendingId + BigInt(tags.length),
            [users_.contributor.address, users_.contributor.address, users_.contributor.address],
            tags
          )
        );

        await expect(
          DatasetNFT_.connect(users_.contributor).proposeManyFragments(
            datasetId_,
            [users_.contributor.address, users_.contributor.address, users_.contributor.address],
            [tagSchemas, tagRows, tagData],
            proposeManySignature
          )
        )
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 1n, tagSchemas)
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 2n, tagRows)
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 3n, tagData);
      });

      it('Should proposeManyFragments() skip contributor if it is the zero address and continue', async () => {
        const tagSchemas = utils.encodeTag('dataset.schemas');
        const tagRows = utils.encodeTag('dataset.rows');
        const tagData = utils.encodeTag('dataset.data');

        const tags = [tagSchemas, tagRows, tagData];

        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

        const proposeManySignature = await users_.dtAdmin.signMessage(
          signature.getDatasetFragmentProposeBatchMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            datasetId_,
            lastFragmentPendingId + 1n,
            lastFragmentPendingId + BigInt(tags.length),
            [users_.contributor.address, ZeroAddress, users_.contributor.address],
            tags
          )
        );

        await expect(
          DatasetNFT_.connect(users_.contributor).proposeManyFragments(
            datasetId_,
            [users_.contributor.address, ZeroAddress, users_.contributor.address],
            tags,
            proposeManySignature
          )
        )
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 1n, tagSchemas)
          .to.emit(DatasetFragment_, 'FragmentPending')
          // tagData fragment id should be lastFragmentPendingId + 3n, but it's lastFragmentPendingId + 2n
          .withArgs(lastFragmentPendingId + 2n, tagData);
      });

      it('Should revert contributor propose multiple fragments if proposes length is not correct', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        });

        const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(datasetId_);

        const DatasetVerifierManager = await ethers.getContractAt(
          'VerifierManager',
          datasetVerifierManagerAddress,
          users_.datasetOwner
        );

        const AcceptManuallyVerifier = await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy(await DatasetNFT_.getAddress());

        DatasetVerifierManager.setDefaultVerifier(await AcceptManuallyVerifier.getAddress());

        const tagSchemas = utils.encodeTag('dataset.schemas');
        const tagRows = utils.encodeTag('dataset.rows');
        const tagData = utils.encodeTag('dataset.data');

        const tags = [tagSchemas, tagRows, tagData];

        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

        const proposeManySignature = await users_.dtAdmin.signMessage(
          signature.getDatasetFragmentProposeBatchMessage(
            network.config.chainId!,
            await DatasetNFT_.getAddress(),
            datasetId_,
            lastFragmentPendingId + 1n,
            lastFragmentPendingId + BigInt(tags.length),
            [users_.contributor.address, users_.contributor.address, users_.contributor.address],
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
        ).to.be.revertedWithCustomError(DatasetNFT_, 'ARRAY_LENGTH_MISMATCH');
      });

      it('Should contributor propose a fragment - default AcceptAllVerifier', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        });

        const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(datasetId_);

        const DatasetVerifierManager = await ethers.getContractAt(
          'VerifierManager',
          datasetVerifierManagerAddress,
          users_.datasetOwner
        );

        const AcceptAllVerifier = await AcceptAllVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy();

        DatasetVerifierManager.setDefaultVerifier(await AcceptAllVerifier.getAddress());

        const tag = utils.encodeTag('dataset.schemas');

        const lastFragmentPendingId = await DatasetFragment_.lastFragmentPendingId();

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
          .to.emit(DatasetFragment_, 'FragmentPending')
          .withArgs(lastFragmentPendingId + 1n, tag);
      });

      it('Should revert a propose if signature is wrong', async function () {
        const SubscriptionManager = await ERC20SubscriptionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const DistributionManager = await DistributionManagerFactory_.connect(
          users_.datasetOwner
        ).deploy();
        const VerifierManager = await VerifierManagerFactory_.connect(users_.datasetOwner).deploy();

        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await SubscriptionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await DistributionManager.getAddress()
        );
        await DatasetNFT_.connect(users_.dtAdmin).grantRole(
          constants.WHITELISTED_MANAGER_ROLE,
          await VerifierManager.getAddress()
        );

        await DatasetNFT_.connect(users_.datasetOwner).setManagers(datasetId_, {
          subscriptionManager: await SubscriptionManager.getAddress(),
          distributionManager: await DistributionManager.getAddress(),
          verifierManager: await VerifierManager.getAddress(),
        });

        const datasetVerifierManagerAddress = await DatasetNFT_.verifierManager(datasetId_);

        const DatasetVerifierManager = await ethers.getContractAt(
          'VerifierManager',
          datasetVerifierManagerAddress,
          users_.datasetOwner
        );

        const AcceptManuallyVerifier = await AcceptManuallyVerifierFactory_.connect(
          users_.datasetOwner
        ).deploy(await DatasetNFT_.getAddress());

        DatasetVerifierManager.setDefaultVerifier(await AcceptManuallyVerifier.getAddress());

        const tag = utils.encodeTag('dataset.schemas');

        const proposeSignature = await users_.dtAdmin.signMessage(getBytes('0x'));

        await expect(
          DatasetNFT_.connect(users_.contributor).proposeFragment(
            datasetId_,
            users_.contributor.address,
            tag,
            proposeSignature
          )
        ).to.be.revertedWithCustomError(DatasetNFT_, 'BAD_SIGNATURE');
      });
    });
  });
}
