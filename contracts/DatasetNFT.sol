// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165} from '@openzeppelin/contracts/interfaces/IERC165.sol';
import {AccessControl} from '@openzeppelin/contracts/access/AccessControl.sol';
import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {Address} from '@openzeppelin/contracts/utils/Address.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {IDatasetLinkInitializable} from './interfaces/IDatasetLinkInitializable.sol';
import {IDistributionManager} from './interfaces/IDistributionManager.sol';
import {ISubscriptionManager} from './interfaces/ISubscriptionManager.sol';
import {IDatasetNFT} from './interfaces/IDatasetNFT.sol';
import {IFragmentNFT} from './interfaces/IFragmentNFT.sol';

/**
 * @title DatasetNFT contract
 * @author Data Tunnel
 * @notice This contract mints ERC721 tokens, each representing a unique Dataset integrated into the Data Tunnel Protocol.
 * It enables the configuration of Datasets, including their monetization, and maintains a record of these configurations.
 * @dev Extends IDatasetNFT, ERC721 & AccessControl
 */
contract DatasetNFT is IDatasetNFT, ERC721, AccessControl {
  string private constant NAME = 'Data Tunnel Dataset';
  string private constant SYMBOL = 'DTDS';

  bytes32 public constant SIGNER_ROLE = keccak256('SIGNER_ROLE');

  error NOT_OWNER(uint256 id, address account);
  error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);

  event ManagersConfigChange(uint256 id);
  event FragmentInstanceDeployment(uint256 id, address instance);
  event DatasetUuidSet(string uuid, uint256 ds);

  address public fragmentImplementation;
  address public deployerFeeBeneficiary;
  uint256 internal mintCounter;
  mapping(uint256 id => ManagersConfig config) public configurations;
  mapping(uint256 id => ManagersConfig proxy) public proxies;
  mapping(uint256 id => IFragmentNFT fragment) public fragments;
  mapping(uint256 => string) public uuids;
  mapping(DeployerFeeModel feeModel => uint256 feePercentage) public deployerFeeModelPercentage;
  mapping(uint256 id => DeployerFeeModel feeModel) public deployerFeeModels;

  modifier onlyTokenOwner(uint256 id) {
    if (_ownerOf(id) != _msgSender()) revert NOT_OWNER(id, _msgSender());
    _;
  }

  constructor() ERC721(NAME, SYMBOL) {
    _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  //TODO handle metadata URI stuff

  /**
   * @notice Mints a Dataset NFT token to `to`
   * @dev Emits a {Transfer} event
   * @param to Dataset owner
   * @param signature Signature from a DT service confirming creation of Dataset
   * @return uin256 ID of the minted token
   */
  function mint(address to, bytes calldata signature) external returns (uint256) {
    require(!Strings.equal(uuids[mintCounter], ''), 'No uuid set for data set id');
    bytes32 msgHash = _mintMessageHash(mintCounter);
    address signer = ECDSA.recover(msgHash, signature);

    if (!hasRole(SIGNER_ROLE, signer)) revert BAD_SIGNATURE(msgHash, signer);

    _mint(to, mintCounter);

    return mintCounter;
  }

  /**
   * @notice Sets a universally unique identifier (UUID) for the next Dataset NFT to be minted
   * @dev Only callable by DatasetNFT ADMIN.
   * Emits a {DatasetUuidSet} event.
   * @param uuid Unique identifier to set
   * @return ds The ID of the token for which the UUID was set
   */
  function setUuidForDatasetId(string memory uuid) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 ds) {
    ds = ++mintCounter;
    uuids[ds] = uuid;

    emit DatasetUuidSet(uuid, ds);
  }

  /**
   * @notice Sets and configures the Manager contracts for a specific Dataset NFT
   * @dev Each Dataset NFT token is linked to a unique set of Manager contracts (Distribution, Subscription, Verifier).
   * Only callable by the owner of the Dataset NFT token.
   * Emits a {ManagersConfigChange} event on condition.
   * @param id The ID of the target Dataset NFT token
   * @param config A struct containing the addresses of the Managers' implementation contracts
   */
  function setManagers(uint256 id, ManagersConfig calldata config) external onlyTokenOwner(id) {
    bool changed;
    if (configurations[id].subscriptionManager != config.subscriptionManager) {
      proxies[id].subscriptionManager = _cloneAndInitialize(config.subscriptionManager, id);
      changed = true;
    }
    if (configurations[id].distributionManager != config.distributionManager) {
      proxies[id].distributionManager = _cloneAndInitialize(config.distributionManager, id);
      changed = true;
    }
    if (configurations[id].verifierManager != config.verifierManager) {
      proxies[id].verifierManager = _cloneAndInitialize(config.verifierManager, id);
      changed = true;
    }
    if (changed) {
      configurations[id] = config;
      emit ManagersConfigChange(id);
    }
  }

  /**
   * @notice Sets the daily subscription fee for a single consumer of a specific Dataset
   * @dev Only callable by the owner of the Dataset NFT token
   * @param id The ID of the target Dataset NFT token
   * @param token The address of the ERC20 token used for the subscription payments, or address(0) for native currency
   * @param feePerConsumerPerDay The fee amount to set
   */
  function setFee(uint256 id, address token, uint256 feePerConsumerPerDay) external onlyTokenOwner(id) {
    ISubscriptionManager sm = ISubscriptionManager(proxies[id].subscriptionManager);
    sm.setFee(token, feePerConsumerPerDay);
  }

  /**
   * @notice Sets the percentage of each subcription payment that should be sent to the Dataset Owner.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @dev Only callable by the owner of the Dataset NFT token
   * @param id The ID of the target Dataset NFT token
   * @param percentage The percentage to set (must be less than or equal to 50%)
   */
  function setDatasetOwnerPercentage(uint256 id, uint256 percentage) external onlyTokenOwner(id) {
    IDistributionManager dm = IDistributionManager(proxies[id].distributionManager);
    dm.setDatasetOwnerPercentage(percentage);
  }

  /**
   * @notice Sets the weights of the respective provided tags.
   * The weights define how payments are distributed to the tags (contributions).
   * Tags are encodings used as labels to categorize different types of contributions.
   * @dev Only callable by the owner of the Dataset NFT token
   * @param id The ID of the target Dataset NFT token
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function setTagWeights(uint256 id, bytes32[] calldata tags, uint256[] calldata weights) external onlyTokenOwner(id) {
    IDistributionManager dm = IDistributionManager(proxies[id].distributionManager);
    dm.setTagWeights(tags, weights);
  }

  /**
   * @notice Sets the daily subscription fee per consumer of a specific Dataset, and the weights of the provided tags.
   * This function allows Dataset owners to configure both the subscription fee
   * and the distribution of payments among different tags in a single Tx.
   * Tags are encodings used as labels to categorize different types of contributions.
   * @dev Only callable by the owner of the Dataset NFT token
   * @param id The ID of the target Dataset NFT token
   * @param token The address of the ERC20 token used for the subscription payments, or address(0) for native currency
   * @param feePerConsumerPerDay The fee amount to set
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function setFeeAndTagWeights(
    uint256 id,
    address token,
    uint256 feePerConsumerPerDay,
    bytes32[] calldata tags,
    uint256[] calldata weights
  ) external onlyTokenOwner(id) {
    ISubscriptionManager sm = ISubscriptionManager(proxies[id].subscriptionManager);
    sm.setFee(token, feePerConsumerPerDay);

    IDistributionManager dm = IDistributionManager(proxies[id].distributionManager);
    dm.setTagWeights(tags, weights);
  }

  /**
   * @notice Sets the fee percentages for the provided Deployer Fee Models
   * @dev Only callable by DatasetNFT ADMIN.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @param models An array of Deployer Fee Models to set percentages for (see `IDatasetNFT.sol`)
   * @param percentages An array of corresponding fee percentages
   */
  function setDeployerFeeModelPercentages(
    DeployerFeeModel[] calldata models,
    uint256[] calldata percentages
  ) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(models.length == percentages.length, 'array length missmatch');
    for (uint256 i; i < models.length; i++) {
      DeployerFeeModel m = models[i];
      require(uint8(m) != 0, 'model 0 always has no fee');
      uint256 p = percentages[i];
      require(p <= 1e18, 'percentage can not be more than 100%');
      deployerFeeModelPercentage[m] = p;
    }
  }

  /**
   * @notice Sets the deployer fee model for a specific Dataset
   * @dev Only callable by DatasetNFT ADMIN
   * @param datasetId The ID of the target Dataset NFT token
   * @param model The Deployer Fee Model to set
   */
  function setDeployerFeeModel(uint256 datasetId, DeployerFeeModel model) external onlyRole(DEFAULT_ADMIN_ROLE) {
    deployerFeeModels[datasetId] = model;
  }

  /**
   * @notice Sets the address of the deployer fee beneficiary
   * @dev Only callable by DatasetNFT ADMIN
   * @param deployerFeeBeneficiary_  The address to set as the beneficiary
   */
  function setDeployerFeeBeneficiary(address deployerFeeBeneficiary_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(deployerFeeBeneficiary_ != address(0), 'invalid zero address provided');
    deployerFeeBeneficiary = deployerFeeBeneficiary_;
  }

  /**
   * @notice Sets the address of the FragmentNFT implementation contract
   * @dev FragmentNFT is an ERC721 extension enabling on-chain integration of contributions to Datasets
   * Only callable by DatasetNFT ADMIN
   * @param fragmentImplementation_ The address of the FragmentNFT implementation contract
   */
  function setFragmentImplementation(address fragmentImplementation_) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(
      fragmentImplementation_ == address(0) || Address.isContract(fragmentImplementation_),
      'invalid fragment implementation address'
    );
    fragmentImplementation = fragmentImplementation_;
  }

  /**
   * @notice Deploys a clone of the FragmentNFT implementation contract for a specific Dataset
   * @dev Only callable by the owner of the Dataset NFT token.
   * Emits a {FragmentInstanceDeployment} event.
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the deployed FragmentNFT instance
   */
  function deployFragmentInstance(uint256 id) external onlyTokenOwner(id) returns (address) {
    require(fragmentImplementation != address(0), 'fragment creation disabled');
    require(address(fragments[id]) == address(0), 'fragment instance already deployed');
    IFragmentNFT instance = IFragmentNFT(_cloneAndInitialize(fragmentImplementation, id));
    fragments[id] = instance;
    emit FragmentInstanceDeployment(id, address(instance));
    return address(instance);
  }

  /**
   * @notice Proposes a specific type of contribution for a particular Dataset
   * @param datasetId The ID of the target Dataset NFT token
   * @param to The address of the contributor
   * @param tag The encoded label indicating the type of contribution
   * @param signature Signature from a DT service confirming the proposal request
   */
  function proposeFragment(uint256 datasetId, address to, bytes32 tag, bytes calldata signature) external {
    IFragmentNFT fragmentInstance = fragments[datasetId];
    require(address(fragmentInstance) != address(0), 'No fragment instance deployed');
    fragmentInstance.propose(to, tag, signature);
  }

  /**
   * @notice Proposes multiple contributions for a specific Dataset
   * @param datasetId The ID of the target Dataset NFT token
   * @param owners An array with the respective contributors' addresses
   * @param tags An array with the respective encoded labels indicating the type of the contributions
   * @param signature Signature from a DT service confirming the proposal request
   */
  function proposeManyFragments(
    uint256 datasetId,
    address[] memory owners,
    bytes32[] memory tags,
    bytes calldata signature
  ) external {
    IFragmentNFT fragmentInstance = fragments[datasetId];
    require(address(fragmentInstance) != address(0), 'No fragment instance deployed');
    fragmentInstance.proposeMany(owners, tags, signature);
  }

  /**
   * @notice Checks whether the given account has the `SIGNER_ROLE`
   * @param account The address of the account to check
   * @return bool True if `account` has the role, false if not
   */
  function isSigner(address account) external view returns (bool) {
    return hasRole(SIGNER_ROLE, account);
  }

  /**
   * @notice Retrieves the address of the SubscriptionManager instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective SubscriptionManager instance
   */
  function subscriptionManager(uint256 id) external view returns (address) {
    return proxies[id].subscriptionManager;
  }

  /**
   * @notice Retrieves the address of the DistributionManager instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective DistributionManager instance
   */
  function distributionManager(uint256 id) external view returns (address) {
    return proxies[id].distributionManager;
  }

  /**
   * @notice Retrieves the address of the VerifierManager instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective VerifierManager instance
   */
  function verifierManager(uint256 id) public view returns (address) {
    return proxies[id].verifierManager;
  }

  /**
   * @notice Retrieves the address of the FragmentNFT instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective FragmentNFT instance
   */
  function fragmentNFT(uint256 id) external view returns (address) {
    return address(fragments[id]);
  }

  /**
   * @notice Retrieves the deployer fee percentage set for a specific Dataset
   * @dev Percentages are encoded such that 100% is represented as 1e18
   * @param id The ID of the target Dataset NFT token
   * @return uint256 The inquired percentage
   */
  function deployerFeePercentage(uint256 id) external view returns (uint256) {
    DeployerFeeModel m = deployerFeeModels[id];
    return deployerFeeModelPercentage[m];
  }

  /**
   * @notice Checks whether the interface ID provided is supported by this Contract
   * @dev For more information, see `ERC165`
   * @param interfaceId The interface ID to check
   * @return bool true if it is supported, false if it is not
   */
  function supportsInterface(
    bytes4 interfaceId
  ) public view virtual override(IERC165, ERC721, AccessControl) returns (bool) {
    return interfaceId == type(IDatasetNFT).interfaceId || super.supportsInterface(interfaceId);
  }

  /**
   * @notice Internal function for cloning, and initializing the given implementation contract
   * @dev The deployed proxy is linked to the specified Dataset
   * @param implementation The address of the target implementation contract
   * @param datasetId The ID of the target Dataset NFT token
   * @return proxy The address of the deployed proxy
   */
  function _cloneAndInitialize(address implementation, uint256 datasetId) internal returns (address proxy) {
    require(implementation != address(0), 'bad implementation address');
    proxy = Clones.clone(implementation);
    IDatasetLinkInitializable(proxy).initialize(address(this), datasetId);
  }

  /**
   * @notice Returns an Ethereum Signed Message hash for minting a Dataset NFT token
   * @dev See `ECDSA.sol`
   * @param id The ID of the target Dataset NFT token to mint
   * @return bytes32 The generated Ethereum signed message hash
   */
  function _mintMessageHash(uint256 id) private view returns (bytes32) {
    return ECDSA.toEthSignedMessageHash(abi.encodePacked(block.chainid, address(this), id));
  }
}
