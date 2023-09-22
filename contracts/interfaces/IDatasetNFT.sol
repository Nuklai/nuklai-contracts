// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IDistributionManager.sol";
import "./ISubscriptionManager.sol";
import "./IVerifierManager.sol";

/**
 * @title Interface of DatsetNFT
 * @notice Defines functions available for Dataset Owners and FragmentNFT contract
 */
interface IDatasetNFT is IERC721 {

    ///@dev Defines the model for the deployer (ALlianceblock/Nexera) fee
    enum DeployerFeeModel {
        NO_FEE,                     // No Fee wii
        DATASET_OWNER_STORAGE,      // Using Owner's Storage, 10% fee
        DEPLOYER_STORAGE            // Deployer's Storage 35% fee
    }

    ///@dev Managers' implementation contracts addresses
    struct ManagersConfig {
        address subscriptionManager;
        address distributionManager;
        address verifierManager;
    }

    /**
     * @notice Mints a Dataset NFT token
     * @param to Dataset owner
     * @param signature Signature from a DT service confirming creation of Dataset
     * @return uin256 ID of the minted token
     */
    function mint(address to, bytes calldata signature) external returns(uint256);

    /**
     * @notice Sets a universally unique identifier (UUID) for the next Dataset NFT to be minted
     * @param uuid Unique identifier to set
     * @return uint256 The ID of the token for which the UUID was set
     */
    function setUuidForDatasetId(string memory uuid) external returns(uint256);

    /**
     * @notice Sets and configures the Manager contracts for a specific Dataset NFT
     * @dev Each Dataset NFT token is linked to a unique set of Manager contracts (Distribution, Subscription, Verifier)
     * @param id The ID of the target DatasetNFT token
     * @param config A struct containing the addresses of the Managers' implementation contracts
     */
    function setManagers(uint256 id, ManagersConfig calldata config) external;

    /**
     * @notice Deploys a clone of the FragmentNFT implementation contract for a specific Dataset
     * @param id The ID of the target Dataset NFT token
     * @return address The address of the deployed FragmentNFT instance
     */
    function deployFragmentInstance(uint256 id) external returns(address);

    /**
     * @notice Sets the daily subscription fee for a single consumer of a specific Dataset
     * @param id The ID of the target Dataset NFT token 
     * @param token The address of the ERC20 token used for the subscription payments, or the zero address for native currency
     * @param feePerConsumerPerDay The fee amount to set
     */
    function setFee(uint256 id, address token, uint256 feePerConsumerPerDay) external;

    /**
     * @notice Sets the percentage of each subcription payment that should be sent to the Dataset Owner.
     * Percentages are encoded such that 100% is represented as 1e18.
     * @param id The ID of the target Dataset NFT token
     * @param percentage The percentage to set (must be less than or equal to 50%)
     */
    function setDatasetOwnerPercentage(uint256 id, uint256 percentage) external;

    /**
     * @notice Sets the weights of the respective provided tags.
     * The weights define how payments are distributed to the tags (contributions).
     * Tags are encodings used as labels to categorize different types of contributions.
     * @param id The ID of the target Dataset NFT token
     * @param tags The tags participating in the payment distributions
     * @param weights The weights of the respective tags to set
     */
    function setTagWeights(uint256 id, bytes32[] calldata tags, uint256[] calldata weights) external;

    /**
     * @notice Sets the daily subscription fee per consumer of a specific Dataset, and the weights of the provided tags.
     * This function enables the configuration of both the subscription fee
     * and the distribution of payments among different tags in a single Tx.
     * Tags are encodings used as labels to categorize different types of contributions.
     * @param id The ID of the target Dataset NFT token
     * @param token The address of the ERC20 token used for the subscription payments, or the zero address for native currency
     * @param feePerConsumerPerDay The fee amount to set
     * @param tags The tags participating in the payment distributions
     * @param weights The weights of the respective tags to set
     */
    function setFeeAndTagWeights(uint256 id, address token, uint256 feePerConsumerPerDay, bytes32[] calldata tags, uint256[] calldata weights) external;

    /**
     * @notice Proposes a specific type of contribution for a particular Dataset
     * @param datasetId The ID of the target Dataset NFT token
     * @param to The address of the contributor
     * @param tag The encoded label indicating the type of contribution
     * @param signature Signature from a DT service confirming the proposal request
     */
    function proposeFragment(uint256 datasetId, address to, bytes32 tag, bytes calldata signature) external;

    /**
     * @notice Proposes multiple contributions for a specific Dataset
     * @param datasetId The ID of the target Dataset NFT token
     * @param owners An array with the respective contributors' addresses
     * @param tags An array with the respective encoded labels indicating the type of the contributions
     * @param signature Signature from a DT service confirming the proposal request
     */
    function proposeManyFragments(uint256 datasetId, address[] memory owners, bytes32[] memory tags, bytes calldata signature) external;

    /**
     * @notice Retrieves the address of the SubscriptionManager instance that is deployed for a specific Dataset
     * @param id The ID of the target Dataset NFT token
     * @return address The address of the respective SubscriptionManager instance
     */
    function subscriptionManager(uint256 id) external view returns(address);

    /**
     * @notice Retrieves the address of the VerifierManager instance that is deployed for a specific Dataset
     * @param id The ID of the target Dataset NFT token
     * @return address The address of the respective VerifierManager instance
     */
    function verifierManager(uint256 id) external view returns(address);

    /**
     * @notice Retrieves the address of the DistributionManager instance that is deployed for a specific Dataset
     * @param id The ID of the target Dataset NFT token
     * @return address The address of the respective DistributionManager instance
     */
    function distributionManager(uint256 id) external view returns(address);

    /**
     * @notice Retrieves the address of the FragmentNFT instance that is deployed for a specific Dataset
     * @param id The ID of the target Dataset NFT token
     * @return address The address of the respective FragmentNFT instance
     */
    function fragmentNFT(uint256 id) external view returns(address);

    /**
     * @notice Retrieves the deployer fee percentage set for a specific Dataset
     * @dev Percentages are encoded such that 100% is represented as 1e18
     * @param id The ID of the target Dataset NFT token
     * @return uint256 The inquired percentage
     */
    function deployerFeePercentage(uint256 id) external view returns(uint256);

    /**
     * @notice Retrieves the deployer fee beneficiary address
     * @return address The address set as the beneficiary of the deployer fee
     */
    function deployerFeeBeneficiary() external view returns(address);

    /**
     * @notice Checks whether the given account has the `SIGNER_ROLE`
     * @param account The address of the account to check
     * @return bool True if `account` has the role, false if not
     */
    function isSigner(address account) external view returns(bool);
}
