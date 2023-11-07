import { BytesLike, solidityPackedKeccak256 } from 'ethers';

export const SIGNER_ROLE: BytesLike = solidityPackedKeccak256(['string'], ['SIGNER_ROLE']);
export const APPROVED_TOKEN_ROLE: BytesLike = solidityPackedKeccak256(
  ['string'],
  ['APPROVED_TOKEN_ROLE']
);
export const WHITELISTED_MANAGER_ROLE: BytesLike = solidityPackedKeccak256(
  ['string'],
  ['WHITELISTED_MANAGER_ROLE']
);

export enum DeployerFeeModel {
  NO_FEE, // No Fee wii
  DATASET_OWNER_STORAGE, // Using Owner's Storage, 10% fee
  DEPLOYER_STORAGE, // Deployer's Storage 35% fee
}
