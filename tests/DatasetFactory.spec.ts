import { expect } from 'chai';
import { deployments, ethers } from 'hardhat';
import { DatasetFactory, DatasetNFT, FragmentNFT } from '@typechained';
import { ZeroAddress } from 'ethers';
import { setupUsers } from './utils/users';
import { Signer } from './utils/users';

async function setup() {
  await deployments.fixture([
    'ProxyAdmin',
    'FragmentNFT',
    'DatasetNFT',
    'DatasetManagers',
    'DatasetVerifiers',
    'DatasetFactory',
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
export default async function suite(): Promise<void> {
  describe('DatasetFactory', () => {
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

    it('configure() :: Should revert when msgSender is not owner', async () => {
      // Admin is the owner
      await expect(
        DatasetFactory_.connect(users_.user).configure(
          ZeroAddress,
          ZeroAddress,
          ZeroAddress,
          ZeroAddress
        )
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('configure() :: Should revert when provided dataset is zeroAddress', async () => {
      const nonZeroAddress = users_.user.address;

      await expect(
        DatasetFactory_.connect(users_.dtAdmin).configure(
          ZeroAddress,
          nonZeroAddress,
          nonZeroAddress,
          nonZeroAddress
        )
      )
        .to.be.revertedWithCustomError(DatasetFactory_, 'ZERO_ADDRESS')
        .withArgs('dataset');
    });

    it('configure() :: Should revert when provided subscriptionManager is zeroAddress', async () => {
      const nonZeroAddress = users_.user.address;

      await expect(
        DatasetFactory_.connect(users_.dtAdmin).configure(
          nonZeroAddress,
          ZeroAddress,
          nonZeroAddress,
          nonZeroAddress
        )
      )
        .to.be.revertedWithCustomError(DatasetFactory_, 'ZERO_ADDRESS')
        .withArgs('subscriptionManager');
    });

    it('configure() :: Should revert when provided distributionManager is zeroAddress', async () => {
      const nonZeroAddress = users_.user.address;

      await expect(
        DatasetFactory_.connect(users_.dtAdmin).configure(
          nonZeroAddress,
          nonZeroAddress,
          ZeroAddress,
          nonZeroAddress
        )
      )
        .to.be.revertedWithCustomError(DatasetFactory_, 'ZERO_ADDRESS')
        .withArgs('distributionManager');
    });

    it('configure() :: Should revert when provided verifierManager  is zeroAddress', async () => {
      const nonZeroAddress = users_.user.address;

      await expect(
        DatasetFactory_.connect(users_.dtAdmin).configure(
          nonZeroAddress,
          nonZeroAddress,
          nonZeroAddress,
          ZeroAddress
        )
      )
        .to.be.revertedWithCustomError(DatasetFactory_, 'ZERO_ADDRESS')
        .withArgs('verifierManager');
    });
  });
}
