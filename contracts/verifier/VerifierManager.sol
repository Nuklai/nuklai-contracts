// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC165Upgradeable.sol";
import {IDatasetNFT} from "../interfaces/IDatasetNFT.sol";
import {IFragmentNFT} from "../interfaces/IFragmentNFT.sol";
import {IVerifierManager} from "../interfaces/IVerifierManager.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {
  ERC2771ContextExternalForwarderSourceUpgradeable
} from "../utils/ERC2771ContextExternalForwarderSourceUpgradeable.sol";

/**
 * @title VerifierManager contract
 * @author Nuklai
 * @notice Configures and coordinates verifiers for Dataset's proposed contributions,
 * handling approval or rejection operations based on the configured verifiers.
 * This is the implementation contract, and each Dataset (represented by a Dataset NFT token) is associated
 * with a specific instance of this implementation.
 */
contract VerifierManager is IVerifierManager, ERC165Upgradeable, ERC2771ContextExternalForwarderSourceUpgradeable {
  error NOT_DATASET_OWNER(address account);
  error NOT_FRAGMENT_NFT(address account);
  error VERIFIER_WRONG_SENDER(address account);
  error VERIFIER_NOT_SET(address account);
  error ARRAY_LENGTH_MISMATCH();
  error ZERO_ADDRESS();

  event FragmentPending(uint256 indexed id);
  event FragmentResolved(uint256 indexed id, bool accept);
  event FragmentTagDefaultVerifierSet(address indexed verifier);
  event FragmentTagVerifierSet(address indexed verifier, bytes32 indexed tag);

  IDatasetNFT public dataset;
  uint256 public datasetId;
  address public defaultVerifier;
  mapping(bytes32 tag => address verifier) public verifiers;
  mapping(uint256 id => bytes32 tag) internal _pendingFragmentTags;

  modifier onlyDatasetOwner() {
    address msgSender = _msgSender();
    if (dataset.ownerOf(datasetId) != msgSender) revert NOT_DATASET_OWNER(msgSender);
    _;
  }

  modifier onlyFragmentNFT() {
    //Use msg.sender here instead of _msgSender() because this call should not go through trustedForwarder
    if (dataset.fragmentNFT(datasetId) != msg.sender) revert NOT_FRAGMENT_NFT(msg.sender);
    _;
  }

  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the VerifierManager contract
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the target Dataset NFT token
   */
  function initialize(address dataset_, uint256 datasetId_) external initializer {
    __ERC2771ContextExternalForwarderSourceUpgradeable_init(dataset_);
    dataset = IDatasetNFT(dataset_);
    datasetId = datasetId_;
  }

  /**
   * @notice Sets the default verifier
   * @dev Only callable by the Dataset owner
   * The default verifier is invoked during `propose()` & `resolve()` operations targeting tags that have not been
   * explicitly configured by the Dataset Owner (see `setTagVerifier()` & `setTagVerifiers()`)
   * @param defaultVerifier_ The address of the verifier contract to set as the default verifier
   */
  function setDefaultVerifier(address defaultVerifier_) external onlyDatasetOwner {
    if (defaultVerifier_ == address(0)) revert ZERO_ADDRESS();
    defaultVerifier = defaultVerifier_;
    emit FragmentTagDefaultVerifierSet(defaultVerifier_);
  }

  /**
   * @notice Sets a verifier for the specified `tag`
   * @dev Only callable by the Dataset owner
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   * that the given verifier should target
   * @param verifier The address of the verifier contract
   */
  function setTagVerifier(bytes32 tag, address verifier) external onlyDatasetOwner {
    verifiers[tag] = verifier;
    emit FragmentTagVerifierSet(verifier, tag);
  }

  /**
   * @notice Sets the verifiers for the respective specified tags
   * @dev Only callable by the Dataset owner
   * @param tags Array with the tags (encoded labels indicating types of contribution) to configure
   * @param verifiers_ Array with the respective addresses of the verifier contracts to set for `tags`
   */
  function setTagVerifiers(bytes32[] calldata tags, address[] calldata verifiers_) external onlyDatasetOwner {
    if (tags.length != verifiers_.length) revert ARRAY_LENGTH_MISMATCH();

    uint256 totalTags = tags.length;
    for (uint256 i; i < totalTags; ) {
      verifiers[tags[i]] = verifiers_[i];
      emit FragmentTagVerifierSet(verifiers_[i], tags[i]);
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev Only callable by the respective FragmentNFT contract instance
   * Emits a {FragmentPending} event.
   * @param id The ID of the pending Fragment
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   */
  function propose(uint256 id, bytes32 tag) external onlyFragmentNFT {
    address verifier = _verifierForTag(tag);
    if (verifier == address(0)) revert VERIFIER_NOT_SET(verifier);

    _pendingFragmentTags[id] = tag;
    IVerifier(verifier).propose(_msgSender(), id, tag);
    emit FragmentPending(id);
  }

  /**
   * @notice Resolves a single contribution proposal
   * @dev Only callable by the configured Verifier for the associated tag.
   * Emits a {FragmentResolved} event.
   * @param id The ID of the pending Fragment associated with the contribution proposal
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolve(uint256 id, bool accept) external {
    bytes32 tag = _pendingFragmentTags[id];
    address verifier = _verifierForTag(tag);
    // Here we use _msgSender() because we allow verifier to be EOA (for example - offchain service)
    address msgSender = _msgSender();
    if (verifier != msgSender) revert VERIFIER_WRONG_SENDER(msgSender);
    IFragmentNFT fragmentNFT = IFragmentNFT(dataset.fragmentNFT(datasetId));
    delete _pendingFragmentTags[id];
    if (accept) {
      fragmentNFT.accept(id);
    } else {
      fragmentNFT.reject(id);
    }
    emit FragmentResolved(id, accept);
  }

  /**
   * @notice Retrieves the address of the verifier contract associated with the specified `tag`
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution,
   * to inquire about
   * @return verifier The address of the verifier contract associated with the specified `tag`
   */
  function _verifierForTag(bytes32 tag) internal view returns (address verifier) {
    verifier = verifiers[tag];
    if (verifier == address(0) && defaultVerifier != address(0)) {
      verifier = defaultVerifier;
    }
  }

  /**
   * @notice Checks whether the interface ID provided is supported by this Contract
   * @dev For more information, see `EIP-165`
   * @param interfaceId The interface ID to check
   * @return bool true if it is supported, false if it is not
   */
  function supportsInterface(
    bytes4 interfaceId
  ) public view virtual override(ERC165Upgradeable, IERC165Upgradeable) returns (bool) {
    return interfaceId == type(IVerifierManager).interfaceId || super.supportsInterface(interfaceId);
  }
}
