import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { DatasetNFT, DistributionManager, FragmentNFT, TestToken } from '@typechained';
import { parseUnits } from 'ethers';
import { deployments, ethers } from 'hardhat';

export async function getTestTokenContract(
  beneficiary: HardhatEthersSigner,
  opts: {
    mint?: bigint;
  }
) {
  const { dtAdmin } = await ethers.getNamedSigners();

  const DeployedToken = await deployments.deploy('TestToken', {
    from: dtAdmin.address,
  });

  const token = (await ethers.getContractAt(
    'TestToken',
    DeployedToken.address,
    dtAdmin
  )) as unknown as TestToken;

  if (opts?.mint && opts.mint > 0) {
    await token.connect(dtAdmin).mint(beneficiary.address, opts.mint);
  }

  return token.connect(beneficiary);
}

interface DistributionManagerPayment {
  token: string;
  distributionAmount: bigint;
  snapshotId: bigint;
  tagWeightsVersion: bigint;
}

export async function verifyContributionPayoutIntegrity(
  datasetId: bigint,
  payments: DistributionManagerPayment[],
  account: string,
  tags: string[],
  tokenAddress: string,
  payout: bigint
): Promise<string> {
  // get contract instances
  const DatasetNFT = (await ethers.getContract('DatasetNFT')) as DatasetNFT;
  const DatasetFragment = (await ethers.getContractAt(
    'FragmentNFT',
    await DatasetNFT.fragments(datasetId)
  )) as unknown as FragmentNFT;
  const DatasetDistributionManager = (await ethers.getContractAt(
    'DistributionManager',
    await DatasetNFT.distributionManager(datasetId)
  )) as unknown as DistributionManager;

  let accountTagCountAtPayout = 0n;
  let accountTagPercentageAtPayout = 0n;

  // get values from contracts
  for (const payment of payments) {
    if (payment.token !== tokenAddress) continue;
    const weights = await DatasetDistributionManager.getTagWeights(tags);
    const tagCount = await DatasetFragment.tagCountAt(payment.snapshotId);
    const accountTagCount = await DatasetFragment.accountTagCountAt(payment.snapshotId, account);
    const accountTagPercentage = await DatasetFragment.accountTagPercentageAt(
      payment.snapshotId,
      account,
      tags
    );

    const totalAccountTags: { [tag: string]: bigint } = Object.assign(
      {},
      ...accountTagCount.tags_.map((tag, index) => ({ [tag]: accountTagCount.counts[index] }))
    );
    const totalTags: { [tag: string]: bigint } = Object.assign(
      {},
      ...tagCount.tags_.map((tag, index) => ({ [tag]: tagCount.counts[index] }))
    );

    accountTagCountAtPayout += getPayoutUsingTagCountAt(
      payment.distributionAmount,
      tags,
      weights,
      totalAccountTags,
      totalTags
    );

    accountTagPercentageAtPayout += getPayoutUsingAccountTagPercentageAt(
      payment.distributionAmount,
      weights,
      accountTagPercentage
    );
  }

  if (accountTagCountAtPayout !== payout)
    return `Error: accountTagCountAt() expected ${payout} - actual ${accountTagCountAtPayout}`;

  if (accountTagPercentageAtPayout !== payout)
    return `Error: accountTagPercentageAt() expected ${payout} - actual ${accountTagPercentageAtPayout}`;

  const calculatedPayout = await DatasetDistributionManager.calculatePayoutByToken(
    tokenAddress,
    account
  );

  if (calculatedPayout !== payout)
    return `Error: calculatePayoutByToken() expected ${payout} - actual ${calculatedPayout}`;

  return 'Success: checks passed';
}

function getPayoutUsingAccountTagPercentageAt(
  distributionAmount: bigint,
  weights: bigint[],
  percentages: bigint[]
): bigint {
  let totalPayout = 0n;
  for (const [index, weight] of weights.entries()) {
    if (index == percentages.length) break;
    totalPayout += (distributionAmount * weight * percentages[index]) / parseUnits('1', 36);
  }
  return totalPayout;
}

function getPayoutUsingTagCountAt(
  distributionAmount: bigint,
  tags: string[],
  weights: bigint[],
  tagCount: { [tag: string]: bigint },
  totalTagsCount: { [tag: string]: bigint }
) {
  const percentages: bigint[] = [];

  for (const tag of tags) {
    percentages.push(
      totalTagsCount[tag] > 0n
        ? (parseUnits('1', 18) * (tagCount[tag] ?? 0n)) / totalTagsCount[tag]
        : 0n
    );
  }

  return getPayoutUsingAccountTagPercentageAt(distributionAmount, weights, percentages);
}
