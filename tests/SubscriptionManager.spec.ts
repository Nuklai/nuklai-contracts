import { time } from '@nomicfoundation/hardhat-network-helpers';
import {
  DatasetFactory,
  DatasetNFT,
  DistributionManager,
  ERC20SubscriptionManager,
  FragmentNFT,
  VerifierManager,
} from '@typechained';
import { expect } from 'chai';
import { ZeroAddress, ZeroHash, parseEther, parseUnits } from 'ethers';
import { deployments, ethers, network } from 'hardhat';
import { v4 as uuidv4 } from 'uuid';
import { constants, signature } from './utils';
import { APPROVED_TOKEN_ROLE, SIGNER_ROLE } from '../utils/constants';
import { getUuidHash, getUint256FromBytes32 } from './utils/utils';
import { getEvent } from './utils/events';
import { setupUsers, Signer } from './utils/users';
import { ONE_DAY } from './utils/constants';

const setup = async () => {
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
    DatasetFactory: (await ethers.getContract('DatasetFactory')) as DatasetFactory,
    DatasetNFT: (await ethers.getContract('DatasetNFT')) as DatasetNFT,
    FragmentNFTImplementation: (await ethers.getContract('FragmentNFT')) as FragmentNFT,
  };

  const users = await setupUsers();

  const datasetUUID = uuidv4();

  const uuidHash = getUuidHash(datasetUUID);

  const datasetAddress = await contracts.DatasetNFT.getAddress();
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

  await contracts.DatasetNFT.grantRole(APPROVED_TOKEN_ROLE, testTokenAddress);

  const defaultVerifierAddress = await (
    await ethers.getContract('AcceptManuallyVerifier')
  ).getAddress();
  const feeAmount = parseUnits('0.1', 18); // feePerDayPerConsumer
  const dsOwnerPercentage = parseUnits('0.001', 18);

  const mintAndConfigureDatasetReceipt = await (
    await contracts.DatasetFactory.connect(users.datasetOwner).mintAndConfigureDataset(
      uuidHash,
      users.datasetOwner.address,
      signedMessage,
      defaultVerifierAddress,
      await users.datasetOwner.Token!.getAddress(),
      feeAmount,
      dsOwnerPercentage,
      [ZeroHash],
      [parseUnits('1', 18)],
      false
    )
  ).wait();

  const [from, to, datasetId] = getEvent(
    'Transfer',
    mintAndConfigureDatasetReceipt?.logs!,
    contracts.DatasetNFT
  )!.args as unknown as [string, string, bigint];

  return {
    datasetId,
    users,
    DatasetSubscriptionManager: (await ethers.getContractAt(
      'ERC20SubscriptionManager',
      await contracts.DatasetNFT.subscriptionManager(datasetId)
    )) as unknown as ERC20SubscriptionManager,
    DatasetDistributionManager: (await ethers.getContractAt(
      'DistributionManager',
      await contracts.DatasetNFT.distributionManager(datasetId),
      users.datasetOwner
    )) as unknown as DistributionManager,
    DatasetVerifierManager: (await ethers.getContractAt(
      'VerifierManager',
      await contracts.DatasetNFT.verifierManager(datasetId),
      users.datasetOwner
    )) as unknown as VerifierManager,
    ...contracts,
  };
};

const setupOnSubscribe = async () => {
  const { DatasetNFT, DatasetSubscriptionManager, DatasetDistributionManager, datasetId, users } =
    await setup();

  await DatasetDistributionManager.connect(users.datasetOwner).setTagWeights(
    [ZeroHash],
    [parseUnits('1', 18)]
  );

  await users.subscriber.Token!.approve(
    await DatasetSubscriptionManager.getAddress(),
    parseUnits('0.00864', 18)
  );

  await DatasetDistributionManager.connect(users.datasetOwner).setDatasetOwnerPercentage(
    ethers.parseUnits('0.01', 18)
  );

  const feeAmount = parseUnits('0.00864', 18); // totalSubscriptionFee for 1 day & 1 consumer :: 0.00864 * 1 * 1 = 0.00864

  await DatasetSubscriptionManager.connect(users.datasetOwner).setFee(
    await users.datasetOwner.Token!.getAddress(),
    feeAmount
  );

  const [, maxSubscriptionFee] = await DatasetSubscriptionManager.subscriptionFee(datasetId, 1, 1);

  await DatasetSubscriptionManager.connect(users.subscriber).subscribe(
    datasetId,
    1, // 1 day
    1,
    maxSubscriptionFee
  );

  const subscriptionId = await DatasetSubscriptionManager.tokenOfOwnerByIndex(
    users.subscriber.address,
    0
  );

  return {
    datasetId,
    subscriptionId,
    users,
    DatasetSubscriptionManager,
    DatasetDistributionManager,
  };
};

export default async function suite(): Promise<void> {
  describe('SubscriptionManager', () => {
    let snap: string;
    let DatasetFactory_: DatasetFactory;
    let DatasetNFT_: DatasetNFT;
    let FragmentNFTImplementation_: FragmentNFT;
    let DatasetSubscriptionManager_: ERC20SubscriptionManager;
    let DatasetDistributionManager_: DistributionManager;
    let DatasetVerifierManager_: VerifierManager;
    let datasetId_: bigint;
    let users_: Record<string, Signer>;

    before(async () => {
      const {
        DatasetFactory,
        DatasetNFT,
        FragmentNFTImplementation,
        DatasetSubscriptionManager,
        DatasetDistributionManager,
        DatasetVerifierManager,
        datasetId,
        users,
      } = await setup();

      DatasetFactory_ = DatasetFactory;
      DatasetNFT_ = DatasetNFT;
      FragmentNFTImplementation_ = FragmentNFTImplementation;
      DatasetSubscriptionManager_ = DatasetSubscriptionManager;
      DatasetDistributionManager_ = DatasetDistributionManager;
      DatasetVerifierManager_ = DatasetVerifierManager;
      datasetId_ = datasetId;
      users_ = users;
    });

    beforeEach(async () => {
      snap = await ethers.provider.send('evm_snapshot', []);
    });

    afterEach(async () => {
      await ethers.provider.send('evm_revert', [snap]);
    });

    it('Should dataset subscription name be set on deploy', async function () {
      expect(await DatasetSubscriptionManager_.name()).to.equal('Nuklai Subscription');
    });

    it('Should dataset subscription symbol be set on deploy', async function () {
      expect(await DatasetSubscriptionManager_.symbol()).to.equal('NAISUB');
    });

    it('Should maximum subscription duration in days to be 365 days', async function () {
      expect(await DatasetSubscriptionManager_.MAX_SUBSCRIPTION_DURATION_IN_DAYS()).to.equal(365);
    });

    it('Should maximum subscription extension duration in days to be 30 days', async function () {
      expect(await DatasetSubscriptionManager_.MAX_SUBSCRIPTION_EXTENSION_IN_DAYS()).to.equal(30);
    });

    it('Should revert if someone tries to re-initialize contract', async function () {
      await expect(
        DatasetSubscriptionManager_.initialize(users_.dtAdmin.address, ZeroAddress)
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Should data set owner set ERC-20 token fee amount for data set subscription', async function () {
      const DeployedToken = await deployments.deploy('TestToken_new', {
        contract: 'TestToken',
        from: users_.subscriber.address,
      });

      const feeAmount = parseUnits('0.0000001', 18);

      // Set DeployedToken as approved for payments
      await DatasetNFT_.connect(users_.dtAdmin).grantRole(
        APPROVED_TOKEN_ROLE,
        DeployedToken.address
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        DeployedToken.address,
        feeAmount
      );

      expect(await DatasetSubscriptionManager_.token()).to.equal(DeployedToken.address);
      expect(await DatasetSubscriptionManager_.feePerConsumerPerDay()).to.equal(feeAmount);
    });

    it('Should revert set ERC-20 fee for data set subscription if token is zero address', async function () {
      const feeAmount = parseUnits('0.0000001', 18);

      await expect(
        DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(ZeroAddress, feeAmount)
      ).to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'UNSUPPORTED_NATIVE_CURRENCY');
    });

    it('Should revert set ERC-20 fee for data set subscription if token is not approved', async function () {
      const feeAmount = parseUnits('0.0000001', 18);

      await expect(
        DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
          users_.datasetOwner.address,
          feeAmount
        )
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'NOT_APPROVED_TOKEN')
        .withArgs(users_.datasetOwner.address);
    });

    it('Should calculate fees for data set subscription (one week and 1 consumer)', async function () {
      const DeployedToken = await deployments.deploy('TestToken_new2', {
        contract: 'TestToken',
        from: users_.subscriber.address,
      });

      const feeAmount = parseUnits('0.0000001', 18); //feePerDayPerConsumer

      // Set DeployedToken as approved for payments
      await DatasetNFT_.connect(users_.dtAdmin).grantRole(
        APPROVED_TOKEN_ROLE,
        DeployedToken.address
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        DeployedToken.address,
        feeAmount
      );

      const consumers = 1;

      const [subscriptionFeeToken, subscriptionFeeAmount] =
        await DatasetSubscriptionManager_.subscriptionFee(datasetId_, 7, consumers);

      const feePerConsumerPerDay = await DatasetSubscriptionManager_.feePerConsumerPerDay();

      expect(subscriptionFeeToken).to.equal(DeployedToken.address);
      expect(subscriptionFeeAmount).to.equal(feePerConsumerPerDay * BigInt(7) * BigInt(consumers));
    });

    it("Should revert calculate fees for data set subscription if it's a wrong data set", async function () {
      const wrongDatasetId = 12312312n;

      const DeployedToken = await deployments.deploy('TestToken_new3', {
        contract: 'TestToken',
        from: users_.subscriber.address,
      });

      const feeAmount = parseUnits('0.0000001', 18);

      // Set DeployedToken as approved for payments
      await DatasetNFT_.connect(users_.dtAdmin).grantRole(
        APPROVED_TOKEN_ROLE,
        DeployedToken.address
      );

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        DeployedToken.address,
        feeAmount
      );

      const consumers = 1;

      await expect(
        DatasetSubscriptionManager_.subscriptionFee(wrongDatasetId, constants.ONE_WEEK, consumers)
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'UNSUPPORTED_DATASET')
        .withArgs(wrongDatasetId);
    });

    it('Should revert calculate fees for data set subscription if duration is wrong', async function () {
      const consumers = 1;

      const maxDurationInDays =
        await DatasetSubscriptionManager_.MAX_SUBSCRIPTION_DURATION_IN_DAYS();

      const MORE_THAN_ONE_YEAR = 365 + 50;

      await expect(
        DatasetSubscriptionManager_.subscriptionFee(datasetId_, MORE_THAN_ONE_YEAR, consumers)
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'SUBSCRIPTION_DURATION_INVALID')
        .withArgs(1, maxDurationInDays, MORE_THAN_ONE_YEAR);

      await expect(DatasetSubscriptionManager_.subscriptionFee(datasetId_, 0, consumers))
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'SUBSCRIPTION_DURATION_INVALID')
        .withArgs(1, maxDurationInDays, 0);
    });

    it('Should user pay data set subscription with ERC-20 token - data set admin received payment', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18); // totalFee for 1 day & 1 consumer :: 0.00864 * 1 * 1 = 0.00864

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        1
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          1, // 1 day
          1,
          maxSubscriptionFee
        )
      ).to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid');
    });

    it('Should revert data set subscription if max fee is too low', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18); // totalFee for 1 day & 1 consumer :: 0.00864 * 1 * 1 = 0.00864

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const maxSubscriptionFee = 1;

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          1, // 1 day
          1,
          maxSubscriptionFee
        )
      ).to.be.revertedWithCustomError(
        DatasetSubscriptionManager_,
        'SUBSCRIPTION_FEE_EXCEEDS_LIMIT'
      );
    });

    it('Should revert if user tries to pay data set with ERC-20 and in addition sending native currency in msg.value', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18); // totalFee for 1 day & 1 consumer :: 0.00864 * 1 * 1 = 0.00864

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        1
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          1, // 1 day
          1,
          maxSubscriptionFee,
          { value: parseEther('0.0001') }
        )
      ).to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'UNSUPPORTED_MSG_VALUE');
    });

    it('Should revert if user tries to subscribe for duration == 0 days OR duration > 365 days', async () => {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(datasetId_, 0, 1, 1)
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'SUBSCRIPTION_DURATION_INVALID')
        .withArgs(1, 365, 0);

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          BigInt(365) + BigInt(1),
          1,
          1
        )
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'SUBSCRIPTION_DURATION_INVALID')
        .withArgs(1, 365, 365 + 1);
    });

    it('Should revert if user tries to subscribe for 0 consumers', async () => {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        30,
        1
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          30,
          0,
          maxSubscriptionFee
        )
      ).to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'CONSUMER_ZERO');
    });

    it('Should revert user pay data set subscription if wrong data set id is used', async function () {
      const wrongDatasetId = 123123123n;

      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.0000001', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(wrongDatasetId, 1, 1, 1)
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'UNSUPPORTED_DATASET')
        .withArgs(wrongDatasetId);
    });

    it('Should retrieve subscription id after subscription is paid', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        1
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          BigInt(1), // 1 day
          1,
          maxSubscriptionFee
        )
      ).to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid');

      expect(
        await DatasetSubscriptionManager_.tokenOfOwnerByIndex(users_.subscriber.address, 0)
      ).to.equal(1);
    });

    it('Should subscriber add consumers to the data set subscription', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.01728', 18)
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18); // totalSubscriptionFee for 1 day & 2 consumers ::  0.00864 * 1 * 2 = 0.01728d

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        2
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribeAndAddConsumers(
          datasetId_,
          1,
          [users_.subscriber.address, users_.datasetOwner.address],
          maxSubscriptionFee
        )
      ).to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid');
    });

    it('Should revert if subscriber tries to subscribe to the same data set', async function () {
      await DatasetDistributionManager_.connect(users_.datasetOwner).setTagWeights(
        [ZeroHash],
        [parseUnits('1', 18)]
      );

      await users_.subscriber.Token!.approve(
        await DatasetSubscriptionManager_.getAddress(),
        parseUnits('0.00864')
      );

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.00864', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        await users_.datasetOwner.Token!.getAddress(),
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        1
      );

      await DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
        datasetId_,
        1, // 1 day
        1,
        maxSubscriptionFee
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          1,
          1,
          maxSubscriptionFee
        )
      )
        .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'CONSUMER_ALREADY_SUBSCRIBED')
        .withArgs(users_.subscriber.address);
    });

    it('Should revert pay data set subscription with ERC-20 token if there is no enough allowance', async function () {
      const DeployedToken = await deployments.deploy('TestToken', {
        from: users_.subscriber.address,
      });

      await DatasetDistributionManager_.connect(users_.datasetOwner).setDatasetOwnerPercentage(
        ethers.parseUnits('0.01', 18)
      );

      const feeAmount = parseUnits('0.0000001', 18);

      await DatasetSubscriptionManager_.connect(users_.datasetOwner).setFee(
        DeployedToken.address,
        feeAmount
      );

      const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
        datasetId_,
        1,
        1
      );

      await expect(
        DatasetSubscriptionManager_.connect(users_.subscriber).subscribe(
          datasetId_,
          1, // 1 day
          1,
          maxSubscriptionFee
        )
      ).to.be.revertedWith('ERC20: insufficient allowance');
    });

    // ----------------------------------------------------------------------------------------------

    describe('On Subscription', () => {
      let snap: string;
      let DatasetSubscriptionManager_: ERC20SubscriptionManager;
      let DatasetDistributionManager_: DistributionManager;
      let datasetId_: bigint;
      let subscriptionId_: bigint;
      let users_: Record<string, Signer>;

      before(async () => {
        const {
          DatasetSubscriptionManager,
          DatasetDistributionManager,
          datasetId,
          subscriptionId,
          users,
        } = await setupOnSubscribe();

        DatasetSubscriptionManager_ = DatasetSubscriptionManager;
        DatasetDistributionManager_ = DatasetDistributionManager;
        datasetId_ = datasetId;
        subscriptionId_ = subscriptionId;
        users_ = users;
      });

      beforeEach(async () => {
        snap = await ethers.provider.send('evm_snapshot', []);
      });

      afterEach(async () => {
        await ethers.provider.send('evm_revert', [snap]);
      });

      it('Should consumer be added multiple times to a subscription', async () => {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        await time.increase(ONE_DAY * 4);

        await users_.secondConsumer.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('0.01728', 18)
        );

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          1,
          2
        );

        await DatasetSubscriptionManager_.connect(users_.secondConsumer).subscribeAndAddConsumers(
          datasetId_,
          1, // 1 day
          [users_.secondConsumer.address, users_.consumer.address],
          maxSubscriptionFee
        );

        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.true;
      });

      it('Should subscription owner add consumers to the subscription', async () => {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.true;
      });

      it('Should subscription owner calculate extra fee for adding more consumers', async () => {
        const [, fee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          1, // 1 day
          1 // 1 consumer
        );

        const extraFee = await DatasetSubscriptionManager_.extraConsumerFee(
          subscriptionId_,
          2 // 2 extra consumers
        );

        expect(extraFee).to.equal(fee * BigInt(2));
      });

      it('Should revert add consumers to the subscription if not the subscription owner', async () => {
        await expect(
          DatasetSubscriptionManager_.connect(users_.user).addConsumers(subscriptionId_, [
            users_.consumer.address,
          ])
        )
          .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'NOT_SUBSCRIPTION_OWNER')
          .withArgs(users_.user.address);
      });

      it('Should revert add consumers to the subscription with wrong id', async function () {
        const wrongSubscriptionId = 112313;

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(wrongSubscriptionId, [
            users_.consumer.address,
          ])
        ).to.be.revertedWith('ERC721: invalid token ID');
      });

      it('Should revert add consumers if more consumers are added than set', async function () {
        const totalConsumers = 1;
        const consumers = [users_.consumer.address, users_.secondConsumer.address];
        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(
            subscriptionId_,
            consumers
          )
        )
          .to.be.revertedWithCustomError(
            DatasetSubscriptionManager_,
            'MAX_CONSUMERS_ADDITION_REACHED'
          )
          .withArgs(totalConsumers, consumers.length);
      });

      it('Should subscription owner remove consumers to the subscription', async () => {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.true;

        await DatasetSubscriptionManager_.connect(users_.subscriber).removeConsumers(
          subscriptionId_,
          [users_.consumer.address]
        );

        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.false;
      });

      it('Should revert subscription owner remove consumers if subscription does not exists', async () => {
        const wrongSubscriptionId = 12312312312n;

        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).removeConsumers(
            wrongSubscriptionId,
            [users_.consumer.address]
          )
        ).to.be.revertedWith('ERC721: invalid token ID');
      });

      it('Should revert if user tries to remove consumers from the subscription', async () => {
        await expect(
          DatasetSubscriptionManager_.connect(users_.user).removeConsumers(subscriptionId_, [
            users_.consumer.address,
          ])
        )
          .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'NOT_SUBSCRIPTION_OWNER')
          .withArgs(users_.user.address);
      });

      it('Should subscription owner replace consumers from the subscription', async () => {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.true;
        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.secondConsumer.address
          )
        ).to.be.false;

        await DatasetSubscriptionManager_.connect(users_.subscriber).replaceConsumers(
          subscriptionId_,
          [users_.consumer.address],
          [users_.secondConsumer.address]
        );

        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.false;
        expect(
          await DatasetSubscriptionManager_.isSubscriptionPaidFor(
            datasetId_,
            users_.secondConsumer.address
          )
        ).to.be.true;
      });

      it('Should revert subscription owner consumers replace if old consumers and new consumers does not match length', async () => {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).replaceConsumers(
            subscriptionId_,
            [users_.user.address],
            [users_.secondConsumer.address, users_.consumer.address]
          )
        ).to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'ARRAY_LENGTH_MISMATCH');
      });

      it('Should revert subscription owner consumers replace if one consumer to replace is not found', async () => {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).replaceConsumers(
            subscriptionId_,
            [users_.user.address],
            [users_.secondConsumer.address]
          )
        )
          .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'CONSUMER_NOT_FOUND')
          .withArgs(subscriptionId_, users_.user.address);
      });

      it('Should subscription be paid if consumer was added', async function () {
        await DatasetSubscriptionManager_.connect(users_.subscriber).addConsumers(subscriptionId_, [
          users_.consumer.address,
        ]);

        expect(
          await DatasetSubscriptionManager_.connect(users_.subscriber).isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.true;
      });

      it('Should subscription not be paid if consumer was not added', async function () {
        expect(
          await DatasetSubscriptionManager_.connect(users_.subscriber).isSubscriptionPaidFor(
            datasetId_,
            users_.consumer.address
          )
        ).to.be.false;
      });

      it('Should revert check for subscription paid for consumer if wrong data set', async function () {
        const wrongDatasetId = 13412312n;

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).isSubscriptionPaidFor(
            wrongDatasetId,
            users_.consumer.address
          )
        )
          .to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'UNSUPPORTED_DATASET')
          .withArgs(wrongDatasetId);
      });

      it('Should subscriber extend his subscription if expired', async () => {
        await time.increase(constants.ONE_DAY * 3);

        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('0.7', 18) // oneweek and 1 subscriber :: 0.1 * 7 * 1 = 0.7
        );

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          7,
          1
        );

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            7,
            0,
            maxSubscriptionFee
          )
        ).to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid');
      });

      it('Should subscriber extend his subscription and add consumers if expired', async () => {
        await time.increase(constants.ONE_DAY * 3);

        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('1.4', 18) // oneweek and 1 subscriber :: 0.1 * 7 * 1 = 0.7
        );

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          7,
          2
        );

        await expect(
          DatasetSubscriptionManager_.connect(
            users_.subscriber
          ).extendSubscriptionAndAddExtraConsumers(
            subscriptionId_,
            7,
            [users_.secondSubscriber.address],
            maxSubscriptionFee
          )
        )
          .to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid')
          .to.emit(DatasetSubscriptionManager_, 'ConsumerAdded')
          .withArgs(subscriptionId_, users_.secondSubscriber.address);
      });

      it('Should revert if subscriber tries to extend non expired subscription with extraDuration > 365 days', async () => {
        const remainingDuration = BigInt(1);

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          BigInt(365),
          1
        );

        const daysInYear = BigInt(365);
        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            daysInYear + BigInt(1),
            0,
            maxSubscriptionFee
          )
        )
          .to.be.revertedWithCustomError(
            DatasetSubscriptionManager_,
            'SUBSCRIPTION_DURATION_INVALID'
          )
          .withArgs(1, 365, daysInYear + BigInt(1) + remainingDuration);
      });

      it('Should revert if subscriber tries to extend non expired subscription when remaining duration < 30 days', async () => {
        // Currently subscriber has subscription with remaining duration == 1 days

        // For 4 months and 1 consumer :: 0.1 * 30 * 4 * 1 = 12
        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('12')
        );

        let [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          BigInt(30) * BigInt(4),
          1
        );

        // Subscriber extends the subscription for 4 months (should pass since remaining <= 30 days)
        await DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
          subscriptionId_,
          BigInt(30) * BigInt(4),
          0,
          maxSubscriptionFee
        );

        const daysInYear = BigInt(365);

        [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          daysInYear,
          1
        );

        //remaining duration :: 4months +1day > 30days (extension should revert)
        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            daysInYear,
            0,
            maxSubscriptionFee
          )
        )
          .to.be.revertedWithCustomError(
            DatasetSubscriptionManager_,
            'SUBSCRIPTION_REMAINING_DURATION'
          )
          .withArgs(30 * constants.ONE_DAY, 10454397);

        // Current remaining duration == 4 months + 1 day, increase time so that remaining < 30 days
        await time.increase(constants.ONE_MONTH * 3 + (constants.ONE_DAY + 400));

        // For 1 Year and 1 subscriber :: 0.1 * 200 * 1 = 20
        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('20')
        );

        [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          200,
          1
        );

        // Now extension should not revert since remaining duration < 30 days
        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            200,
            0,
            maxSubscriptionFee
          )
        ).to.not.be.reverted;
      });

      it('Should revert if subscriber tries to extend with 0 extraDuration & 0 extraConsumers', async () => {
        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            0,
            0,
            1
          )
        ).to.be.revertedWithCustomError(DatasetSubscriptionManager_, 'NOTHING_TO_PAY');
      });

      it('Should subscriber extends his subscription if not expired', async () => {
        // Has 1 day left < 30 days thus he should be able to extend

        // subscriptionFee for oneWeek and 1 consumer :: 0.1 * 7 * 1 = 0.7
        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('0.7')
        );

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          7,
          1
        );

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            7, // 7 days
            0,
            maxSubscriptionFee
          )
        ).to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid');
      });

      it('Should subscriber extends his subscription and add consumers in one function if not expired', async () => {
        // Has 1 day left < 30 days thus he should be able to extend

        // subscriptionFee for oneWeek and 2 consumer :: 0.1 * 7 * 2 = 1.4
        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('1.4')
        );

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          7,
          2
        );

        await expect(
          DatasetSubscriptionManager_.connect(
            users_.subscriber
          ).extendSubscriptionAndAddExtraConsumers(
            subscriptionId_,
            7, // 7 days
            [users_.secondSubscriber.address],
            maxSubscriptionFee + parseUnits('0.1')
          )
        )
          .to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid')
          .to.emit(DatasetSubscriptionManager_, 'ConsumerAdded')
          .withArgs(subscriptionId_, users_.secondSubscriber.address);
      });

      it('Should subscriber extends his subscription with extendSubscriptionAndAddExtraConsumers() if not expired', async () => {
        // Has 1 day left < 30 days thus he should be able to extend

        // subscriptionFee for oneWeek and 2 consumer :: 0.1 * 7 * 2 = 1.4
        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('1.4')
        );

        const [, maxSubscriptionFee] = await DatasetSubscriptionManager_.subscriptionFee(
          datasetId_,
          7,
          1
        );

        await expect(
          DatasetSubscriptionManager_.connect(
            users_.subscriber
          ).extendSubscriptionAndAddExtraConsumers(
            subscriptionId_,
            7, // 7 days
            [],
            maxSubscriptionFee
          )
        ).to.emit(DatasetSubscriptionManager_, 'SubscriptionPaid');
      });

      it('Should revert subscription extension if max fee is too low', async () => {
        await users_.subscriber.Token!.approve(
          await DatasetSubscriptionManager_.getAddress(),
          parseUnits('0.7')
        );

        const maxSubscriptionFee = 1;

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            subscriptionId_,
            7, // 7 days
            0,
            maxSubscriptionFee
          )
        ).to.be.revertedWithCustomError(
          DatasetSubscriptionManager_,
          'SUBSCRIPTION_FEE_EXCEEDS_LIMIT'
        );
      });

      it('Should revert if subscriber tries to extend a wrong subscription', async () => {
        const wrongSubscriptionId = 112313;

        await expect(
          DatasetSubscriptionManager_.connect(users_.subscriber).extendSubscription(
            wrongSubscriptionId,
            7,
            0,
            1
          )
        ).to.be.revertedWith('ERC721: invalid token ID');
      });
    });
  });
}
