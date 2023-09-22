// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/access/Ownable.sol';
import './interfaces/IDatasetNFT.sol';
import './verifier/VerifierManager.sol';

/**
 * @title DatasetFactory contract
 * @author Data Tunnel
 * @notice This contract facilitates the streamlined integration and configuration of Datasets
 * in the Data Tunnel protocol in a single transaction.
 * @dev Extends Ownable
 */
contract DatasetFactory is Ownable {
  ///@dev address of the DatasetNFT contract
  IDatasetNFT public datasetNFT;
  ///@dev address of deployed SubscriptionManager implementation contract (ERC20LinearSingleDatasetSubscriptionManager)
  address public subscriptionManagerImpl;
  ///@dev address of deployed DistributionManager implementation contract
  address public distributionManagerImpl;
  ///@dev  address of deployed VerifierManager implementation contract
  address public verifierManagerImpl;

  /**
   * @notice Configures the Factory by setting the addresses of the Managers and DatasetNFT contracts
   * @dev Only callable by the owner of this contract (see `Ownable.sol`)
   * @param dataset The address of the DatasetNFT contract
   * @param subscriptionManager The address of the SubscriptionManager implementation contract
   * @param distributionManager The address of the DistributionManager implementation contract
   * @param verifierManager The address of the VerifierManager implementation contract
   */
  function configure(
    address dataset,
    address subscriptionManager,
    address distributionManager,
    address verifierManager
  ) external onlyOwner {
    require(dataset != address(0), 'incorrect dataset address');
    require(subscriptionManager != address(0), 'incorect subscriptionManager address');
    require(distributionManager != address(0), 'incorect distributionManager address');
    require(verifierManager != address(0), 'incorect verifierManager address');
    datasetNFT = IDatasetNFT(dataset);
    subscriptionManagerImpl = subscriptionManager;
    distributionManagerImpl = distributionManager;
    verifierManagerImpl = verifierManager;
  }

  /**
   * @notice Mints a Dataset NFT token and configures the Managers associated with the minted Dataset NFT token.
   * @dev Percentages are encoded such that 100% is represented as 1e18.
   * The sum of weights should be 100%, and 100% is encoded as 1e18.
   * @param to The address of the beneficiary (Dataset owner)
   * @param mintSignature Signature from a DT service confirming creation of Dataset
   * @param defaultVerifier The address of the Verifier contract to set as the Default Verifier
   * @param feeToken The address of the ERC20 token used for subscription payments, or zero address for native currency
   * @param feePerConsumerPerDay The daily subscription fee for a single consumer to set
   * @param dsOwnerFeePercentage The percentage of each subcription payment that should be sent to the Dataset Owner
   * @param tags The tags (labels for contribution types) participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function mintAndConfigureDataset(
    address to,
    bytes calldata mintSignature,
    address defaultVerifier,
    address feeToken,
    uint256 feePerConsumerPerDay,
    uint256 dsOwnerFeePercentage,
    bytes32[] calldata tags,
    uint256[] calldata weights
  ) external {
    uint256 id = datasetNFT.mint(address(this), mintSignature);

    _deployProxies(id);
    _configureVerifierManager(id, defaultVerifier);
    _configureSubscriptionManager(id, feeToken, feePerConsumerPerDay);
    _configureDistributionManager(id, dsOwnerFeePercentage, tags, weights);

    datasetNFT.safeTransferFrom(address(this), to, id);
  }

  /**
   * @notice Deploys and intializes the instances of the following implementation contracts associated with `id` Dataset NFT token:
   *  - The FragmentNFT contract, responsible for representing contributions to the Dataset.
   *  - The SubscriptionManager contract, managing subscription-related operations.
   *  - The DistributionManager contract, managing the distribution of fees to dataset owner and contributors
   *  - The VerifierManager contract, providing verification services for contributions.
   * @dev See `deployFragmentInstance()` and `setManagers()` of `DatasetNFT.sol`
   * @param id The ID of the target Dataset NFT token
   */
  function _deployProxies(uint256 id) internal {
    datasetNFT.deployFragmentInstance(id);
    datasetNFT.setManagers(
      id,
      IDatasetNFT.ManagersConfig({
        subscriptionManager: subscriptionManagerImpl,
        distributionManager: distributionManagerImpl,
        verifierManager: verifierManagerImpl
      })
    );
  }

  /**
   * @notice Configures the VerifierManager contract instance associated with `id` Dataset NFT token
   * @dev This function sets the Default Verifier contract address in the associated VerifierManager
   * @param id The ID of the target Dataset NFT token
   * @param defaultVerifier The address of the Verifier contract to set as the Default Verifier
   */
  function _configureVerifierManager(uint256 id, address defaultVerifier) internal {
    VerifierManager vm = VerifierManager(datasetNFT.verifierManager(id));
    vm.setDefaultVerifier(defaultVerifier);
  }

  /**
   * @notice Configures the SubscriptionManager contract instance associated with `id` Dataset NFT token
   * @param id The ID of the target Dataset NFT token
   * @param feeToken The address of the ERC20 token used for subscription payments, or zero address for native currency
   * @param feePerConsumerPerDay The daily subscription fee for a single consumer
   */
  function _configureSubscriptionManager(uint256 id, address feeToken, uint256 feePerConsumerPerDay) internal {
    datasetNFT.setFee(id, feeToken, feePerConsumerPerDay);
  }

  /**
   * @notice Configures the DistributionManager contract instance associated with `id` Dataset NFT token
   * @param id The ID of the target Dataset NFT token
   * @param dsOwnerFeePercentage The percentage of each subcription payment that should be sent to the Dataset Owner
   * @param tags The tags (labels for contribution types) participating in the payment distributions
   * @param weights The weights of the respective tags
   */
  function _configureDistributionManager(
    uint256 id,
    uint256 dsOwnerFeePercentage,
    bytes32[] calldata tags,
    uint256[] calldata weights
  ) internal {
    datasetNFT.setDatasetOwnerPercentage(id, dsOwnerFeePercentage);
    datasetNFT.setTagWeights(id, tags, weights);
  }
}
