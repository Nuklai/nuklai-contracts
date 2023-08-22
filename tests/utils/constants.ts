export const ONE_DAY = 60 * 60 * 24;
export const ONE_WEEK = ONE_DAY * 7;

export enum DeployerFeeModel {
    NO_FEE,                     // No Fee wii
    DATASET_OWNER_STORAGE,      // Using Owner's Storage, 10% fee
    DEPLOYER_STORAGE            // Deployer's Storage 35% fee
}
