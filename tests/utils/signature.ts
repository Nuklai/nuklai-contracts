import { AddressLike, getBytes, solidityPacked } from 'ethers';

export const getDatasetMintMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: bigint
): Uint8Array => {
  const message = solidityPacked(
    ['uint256', 'address', 'uint256'],
    [chainId, datasetAddress, datasetId]
  );

  return getBytes(message);
};

export const getDatasetFragmentProposeMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: bigint,
  counter: bigint,
  owner: AddressLike,
  tag: string
): Uint8Array => {
  const proposeMessage = solidityPacked(
    ['uint256', 'address', 'uint256', 'uint256', 'address', 'bytes32'],
    [chainId, datasetAddress, datasetId, counter, owner, tag]
  );

  return getBytes(proposeMessage);
};

export const getDatasetFragmentProposeBatchMessage = (
  chainId: number,
  datasetAddress: AddressLike,
  datasetId: bigint,
  fromId: bigint,
  toId: bigint,
  owners: AddressLike[],
  tags: string[]
): Uint8Array => {
  const proposeMessage = solidityPacked(
    ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'address[]', 'bytes32[]'],
    [chainId, datasetAddress, datasetId, fromId, toId, owners, tags]
  );

  return getBytes(proposeMessage);
};

export const getRevenueClaimMessage = (
  chainId: number,
  distributionAddress: AddressLike,
  beneficiary: AddressLike,
  signatureValidSince: bigint,
  signatureValidTill: bigint
): Uint8Array => {
  const revenueClaimMessage = solidityPacked(
    ['uint256', 'address', 'address', 'uint256', 'uint256'],
    [chainId, distributionAddress, beneficiary, signatureValidSince, signatureValidTill]
  );

  return getBytes(revenueClaimMessage);
};
