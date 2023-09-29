// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ContextUpgradeable} from '@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol';
import {ReentrancyGuardUpgradeable} from '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Address} from '@openzeppelin/contracts/utils/Address.sol';
import {EnumerableMap} from '@openzeppelin/contracts/utils/structs/EnumerableMap.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {IDistributionManager} from '../interfaces/IDistributionManager.sol';
import {IDatasetNFT} from '../interfaces/IDatasetNFT.sol';
import {IFragmentNFT} from '../interfaces/IFragmentNFT.sol';

/**
 * @title DistributionManager contract
 * @author Data Tunnel
 * @notice Manages the distribution of fees to Dataset owner and contributors, and
 * provides configuration options for fee distribution percentages among parties.
 * This is the implementation contract, and each Dataset (represented by a Dataset NFT token) is associated
 * with a specific instance of this implementation.
 * @dev Extends IDistributionManager, ReentrancyGuardUpgradeable, ContextUpgradeable
 */
contract DistributionManager is IDistributionManager, ReentrancyGuardUpgradeable, ContextUpgradeable {
  using SafeERC20 for IERC20;
  using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
  using Address for address payable;

  event PaymentReceived();
  event PayoutSent(address indexed to, address token, uint256 amount);

  error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);
  error NOT_DATASET_OWNER(address account);
  error NOT_SUBSCRIPTION_MANAGER(address account);
  error NOT_DATASET_NFT(address account);
  error MSG_VALUE_MISMATCH(uint256 msgValue, uint256 amount);
  error PERCENTAGE_VALUE_INVALID(uint256 maximum, uint256 current);
  error TAGS_NOT_PROVIDED();
  error TAG_WEIGHTS_NOT_INITIALIZED();
  error TAG_WEIGHTS_SUM_INVALID(uint256 maximum, uint256 current);
  error DEPLOYER_FEE_BENEFICIARY_ZERO_ADDRESS();
  error SIGNATURE_OVERDUE();
  error NO_UNCLAIMED_PAYMENTS_AVAILABLE();

  /**
   * @dev A Payment contains:
   *  - The address of the ERC20 payment token (or address(0) for native currency)
   *  - The amount to be distributed to contributors
   *  - The index of the snapshot associated with the respective payment (see `FragmentNFT.sol`)
   *  - The version (state) of the tag weights associated with the respective payment
   */
  struct Payment {
    address token;
    uint256 distributionAmount;
    uint256 snapshotId;
    uint256 tagWeightsVersion;
  }

  IDatasetNFT public dataset;
  uint256 public datasetId;
  IFragmentNFT public fragmentNFT;
  uint256 public datasetOwnerPercentage; // 100% = 1e18
  mapping(address token => uint256 amount) public pendingOwnerFee; // Amount available for claim by the owner
  Payment[] public payments;
  EnumerableMap.Bytes32ToUintMap[] internal _versionedTagWeights;
  mapping(address => uint256) internal _firstUnclaimedContribution; // from fragments revenue
  uint256 internal _firstUnclaimed; // from owner's revenue

  modifier onlyDatasetOwner() {
    if (dataset.ownerOf(datasetId) != _msgSender()) revert NOT_DATASET_OWNER(_msgSender());
    _;
  }

  modifier onlyDatasetNFT() {
    if (address(dataset) != _msgSender()) revert NOT_DATASET_NFT(_msgSender());
    _;
  }

  modifier onlySubscriptionManager() {
    if (dataset.subscriptionManager(datasetId) != _msgSender()) revert NOT_SUBSCRIPTION_MANAGER(_msgSender());
    _;
  }

  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the DistributionManager contract
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the target Dataset NFT token
   */
  function initialize(address dataset_, uint256 datasetId_) external initializer {
    __ReentrancyGuard_init();
    dataset = IDatasetNFT(dataset_);
    datasetId = datasetId_;
    fragmentNFT = IFragmentNFT(dataset.fragmentNFT(datasetId));
  }

  /**
   * @notice Sets the weights of the respective provided tags.
   * @dev Weights are encoded such that 100% is represented as 1e18.
   * The weights define how payments are distributed to the tags (contributions).
   * Tags are encodings used as labels to categorize different types of contributions.
   * Only callable by DatasetNFT
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function setTagWeights(bytes32[] calldata tags, uint256[] calldata weights) external onlyDatasetNFT {
    EnumerableMap.Bytes32ToUintMap storage tagWeights = _versionedTagWeights.push();
    uint256 weightSum;
    for (uint256 i; i < weights.length; i++) {
      weightSum += weights[i];
      tagWeights.set(tags[i], weights[i]);
    }
    if (weightSum > 1e18) revert TAG_WEIGHTS_SUM_INVALID(1e18, weightSum);
  }

  /**
   * @notice Retrieves the respective weights of the provided tags
   * @dev The weights define how payments are distributed to the tags (contributions).
   * Tags are encodings used as labels to categorize different types of contributions (see `FragmentNFT.sol`).
   * If a tag present in the `tags` array is not set by the Dataset onwer, its respective weight is 0.
   * @param tags An array with the tags to retrieve their weights
   * @return weights An array with the respective weights
   */
  function getTagWeights(bytes32[] calldata tags) external view returns (uint256[] memory weights) {
    if (tags.length == 0) revert TAGS_NOT_PROVIDED();
    EnumerableMap.Bytes32ToUintMap storage tagWeights = _versionedTagWeights[_versionedTagWeights.length - 1];
    uint256 tagsLength = tags.length;
    weights = new uint256[](tagsLength);
    for (uint256 i; i < tagsLength; i++) {
      bytes32 tag = tags[i];
      (, uint256 weight) = tagWeights.tryGet(tag);
      weights[i] = weight;
    }
  }

  /**
   * @notice Sets the percentage of each subcription payment that should be sent to the Dataset Owner.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @dev Only callable by DatasetNFT
   * @param percentage The percentage to set (must be less than or equal to 50%)
   */
  function setDatasetOwnerPercentage(uint256 percentage) external onlyDatasetNFT {
    if (percentage > 5e17) revert PERCENTAGE_VALUE_INVALID(5e17, percentage);
    datasetOwnerPercentage = percentage;
  }

  /**
   * @notice Receives a subscription payment, sends deployer fee to configured beneficiary, and
   * creates a record of the amounts eligible for claiming by the Dataset owner and contributors respectively.
   * @dev Called by SubscriptionManager when a subscription payment is initiated.
   * If `token` is address(0) (indicating native currency), the `amount` should match the `msg.value`,
   * otherwise DistributionManager should call `transferFrom()` to transfer the amount from sender.
   * Emits {PaymentReceived} and {PayoutSent} events.
   * @param token The address of the ERC20 payment token, or address(0) indicating native currency
   * @param amount The provided payment amount
   */
  function receivePayment(address token, uint256 amount) external payable onlySubscriptionManager nonReentrant {
    if (_versionedTagWeights.length == 0) revert TAG_WEIGHTS_NOT_INITIALIZED();
    if (address(token) == address(0)) {
      if (amount != msg.value) revert MSG_VALUE_MISMATCH(msg.value, amount);
    } else {
      IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
    }
    uint256 snapshotId = fragmentNFT.snapshot();

    // Deployer fee
    uint256 deployerFee = (amount * dataset.deployerFeePercentage(datasetId)) / 1e18;
    if (deployerFee > 0) {
      address deployerFeeBeneficiary = dataset.deployerFeeBeneficiary();
      if (deployerFeeBeneficiary == address(0)) revert DEPLOYER_FEE_BENEFICIARY_ZERO_ADDRESS();
      _sendPayout(token, deployerFee, deployerFeeBeneficiary);
      amount -= deployerFee;
    }

    // Dataset owner fee
    if (amount > 0) {
      uint256 ownerAmount = (amount * datasetOwnerPercentage) / 1e18;
      pendingOwnerFee[token] += ownerAmount;
      amount -= ownerAmount;
    }

    // Fragment contributors fee
    if (amount > 0) {
      payments.push(
        Payment({
          token: token,
          distributionAmount: amount,
          snapshotId: snapshotId,
          tagWeightsVersion: _versionedTagWeights.length - 1
        })
      );
    }

    emit PaymentReceived();
  }

  /**
   * @notice Sends all unclaimed ownership-fee payouts to the Dataset owner
   * @dev Only callable by the Dataset owner
   * @param sigValidSince The Unix timestamp after which claiming is enabled
   * @param sigValidTill The Unix timestamp until which claiming is enabled
   * @param signature Signature from a DT service confirming the claiming request
   */
  function claimDatasetOwnerPayouts(
    uint256 sigValidSince,
    uint256 sigValidTill,
    bytes calldata signature
  ) external onlyDatasetOwner nonReentrant {
    // Validate state & signature
    if (block.timestamp < sigValidSince || block.timestamp > sigValidTill) revert SIGNATURE_OVERDUE();
    if (_firstUnclaimed >= payments.length) revert NO_UNCLAIMED_PAYMENTS_AVAILABLE();
    bytes32 msgHash = _claimRevenueMessageHash(_msgSender(), sigValidSince, sigValidTill);
    address signer = ECDSA.recover(msgHash, signature);
    if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);

    _claimOwnerPayouts(_msgSender());
  }

  /**
   * @notice Sends all respective unclaimed ownership-fee and contribution-fee payouts to the Dataset owner
   * @dev The Dataset owner is able to contribute (own FragmentNFT tokens) to his own Dataset
   * and gain revenue from his contributions.
   * Only callable by the Dataset owner.
   * @param sigValidSince The Unix timestamp after which claiming is enabled
   * @param sigValidTill The Unix timestamp until which claiming is enabled
   * @param payoutSignature Signature from a DT service confirming the claiming request
   */
  function claimDatasetOwnerAndFragmentPayouts(
    uint256 sigValidSince,
    uint256 sigValidTill,
    bytes calldata payoutSignature
  ) external onlyDatasetOwner nonReentrant {
    // Validate signature
    if (block.timestamp < sigValidSince || block.timestamp > sigValidTill) revert SIGNATURE_OVERDUE();
    if (_firstUnclaimed >= payments.length) revert NO_UNCLAIMED_PAYMENTS_AVAILABLE();

    bytes32 msgHash = _claimRevenueMessageHash(_msgSender(), sigValidSince, sigValidTill);
    address signer = ECDSA.recover(msgHash, payoutSignature);
    if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);

    // Claim Pending Owner Fees
    _claimOwnerPayouts(_msgSender());

    // Claim Fragment Fees
    _claimPayouts(_msgSender());
  }

  /**
   * @notice Sends all respective unclaimed contribution-fee payouts to the contributor
   * @dev In the context of this function, the caller is the contributor (FragmentNFT token owner).
   * Emits {PayoutSent} event(s).
   * @param sigValidSince The Unix timestamp after which claiming is enabled
   * @param sigValidTill The Unix timestamp until which claiming is enabled
   * @param signature Signature from a DT service confirming the claiming request
   */
  function claimPayouts(uint256 sigValidSince, uint256 sigValidTill, bytes calldata signature) external nonReentrant {
    // Validate signature
    if (block.timestamp < sigValidSince || block.timestamp > sigValidTill) revert SIGNATURE_OVERDUE();
    bytes32 msgHash = _claimRevenueMessageHash(_msgSender(), sigValidSince, sigValidTill);
    address signer = ECDSA.recover(msgHash, signature);
    if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);

    // Claim payouts
    uint256 firstUnclaimedPayout = _firstUnclaimedContribution[_msgSender()];
    if (firstUnclaimedPayout >= payments.length) return; // Nothing to claim

    _firstUnclaimedContribution[_msgSender()] = payments.length; // CEI pattern to prevent reentrancy

    address collectToken = payments[firstUnclaimedPayout].token;
    uint256 collectAmount;
    for (uint256 i = firstUnclaimedPayout; i < payments.length; i++) {
      Payment storage p = payments[i];
      if (collectToken != p.token) {
        // Payment token changed, send what we've already collected
        _sendPayout(collectToken, collectAmount, _msgSender());
        collectToken = p.token;
        collectAmount = 0;
      }
      collectAmount += _calculatePayout(p, _msgSender());
    }

    // send collected and not sent yet
    _sendPayout(collectToken, collectAmount, _msgSender());
  }

  /**
   * @notice Calculates and returns a given account's total contribution-based unclaimed payouts for the given payment `token`
   * @param token The address of the target ERC20 token, or address(0) for native currency, that should be utilized for subscription payments
   * @param account The address of the account to inquire
   * @return collectAmount The account's total contribution-based unclaimed payout amount for `token`
   */
  function calculatePayoutByToken(address token, address account) external view returns (uint256 collectAmount) {
    uint256 firstUnclaimedPayout = _firstUnclaimedContribution[account];

    if (firstUnclaimedPayout >= payments.length) return 0;

    for (uint256 i = firstUnclaimedPayout; i < payments.length; i++) {
      Payment storage p = payments[i];
      if (token == p.token) {
        collectAmount += _calculatePayout(p, account);
      }
    }
  }

  /**
   * @notice Internal _claimOwnerPayouts for claiming all pending Dataset ownership fees
   * @dev Called by `claimDatasetOwnerPayouts()` & `claimDatasetOwnerAndFragmentPayouts()`.
   * Emits {PayoutSent} event(s).
   * @param owner the adress of the Dataset owner
   */
  function _claimOwnerPayouts(address owner) internal {
    if (_firstUnclaimed >= payments.length) return; // Nothing to claim
    uint256 firstUnclaimedPayout = _firstUnclaimed;
    _firstUnclaimed = payments.length; // CEI pattern to prevent reentrancy

    address collectToken;
    for (uint256 i = firstUnclaimedPayout; i < payments.length; i++) {
      collectToken = payments[i].token;

      if (pendingOwnerFee[collectToken] == 0) continue;

      _sendPayout(collectToken, pendingOwnerFee[collectToken], owner);
      delete pendingOwnerFee[collectToken];
    }
  }

  /**
   * @notice Internal _claimPayouts for claiming all pending contribution fees (from fragments) for a specific contributor
   * @dev Called by `claimDatasetOwnerAndFragmentPayouts()`.
   * Emits {PayoutSent} event(s).
   * @param beneficiary the contributor's address to receive the payout
   */
  function _claimPayouts(address beneficiary) internal {
    // Claim payouts
    uint256 firstUnclaimedPayout = _firstUnclaimedContribution[beneficiary];
    if (firstUnclaimedPayout >= payments.length) return; // Nothing to claim
    _firstUnclaimedContribution[beneficiary] = payments.length; // CEI pattern to prevent reentrancy

    address collectToken = payments[firstUnclaimedPayout].token;
    uint256 collectAmount;
    for (uint256 i = firstUnclaimedPayout; i < payments.length; i++) {
      Payment storage p = payments[i];
      if (collectToken != p.token) {
        // Payment token changed, send what we've already collected
        _sendPayout(collectToken, collectAmount, beneficiary);
        collectToken = p.token;
        collectAmount = 0;
      }
      collectAmount += _calculatePayout(p, beneficiary);
    }
    // send collected and not sent yet
    _sendPayout(collectToken, collectAmount, beneficiary);
  }

  /**
   * @notice Calculates and returns the contribution-based payout amount for `account`
   * based on the contribution percentages and tag weights.
   *
   * @dev Called by:
   *
   *  - `_claimPayouts()`
   *  - `claimPayouts()`
   *  - `calculatePayoutByToken()`
   *
   * @param p The Payment struct containing distribution and tags related information
   * @param account The address of the account for which the respective payout is calculated
   * @return payout The calculated contribution-based payout amount for `account`
   */
  function _calculatePayout(Payment storage p, address account) internal view returns (uint256 payout) {
    uint256 paymentAmount = p.distributionAmount;
    EnumerableMap.Bytes32ToUintMap storage tagWeights = _versionedTagWeights[p.tagWeightsVersion];
    bytes32[] memory tags = tagWeights.keys();
    uint256[] memory percentages = fragmentNFT.accountTagPercentageAt(p.snapshotId, account, tags);
    for (uint256 i; i < tags.length; i++) {
      bytes32 tag = tags[i];
      if (percentages[i] > 0) {
        payout += (paymentAmount * tagWeights.get(tag) * percentages[i]) / 1e36;
      }
    }
  }

  /**
   * @notice Internal function for sending a payout in either native currency or an ERC20 token
   *
   * @dev Called by:
   *
   *  - `receivePayment()`
   *  - `claimPayouts()`
   *  - `_claimOwnerPayouts()`
   *  - `_claimPayouts()`
   *
   * Emits a {PayoutSent} event.
   *
   * @param token The address of the ERC20 payment token, or address(0) for native currency
   * @param amount The amount of the payout to send
   * @param to The address of the recipient
   */
  function _sendPayout(address token, uint256 amount, address to) internal {
    if (token == address(0)) {
      payable(to).sendValue(amount);
    } else {
      IERC20(token).safeTransfer(to, amount);
    }
    emit PayoutSent(to, token, amount);
  }

  /**
   * @notice Returns an Ethereum Signed Message hash for revenue claiming
   * @dev Utilized for both revenue types (owneship-based and contribution-based)
   * @param beneficiary The address of the beneficiary
   * @param sigValidSince The Unix timestamp after which claiming is enabled
   * @param sigValidTill The Unix timestamp until which claiming is enabled
   * @return bytes32 The generated Ethereum signed message hash
   */
  function _claimRevenueMessageHash(
    address beneficiary,
    uint256 sigValidSince,
    uint256 sigValidTill
  ) private view returns (bytes32) {
    return
      ECDSA.toEthSignedMessageHash(
        abi.encodePacked(block.chainid, address(this), beneficiary, sigValidSince, sigValidTill)
      );
  }
}
