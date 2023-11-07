// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IDistributionManager} from "../interfaces/IDistributionManager.sol";
import {IDatasetNFT} from "../interfaces/IDatasetNFT.sol";
import {IFragmentNFT} from "../interfaces/IFragmentNFT.sol";
import {
  ERC2771ContextExternalForwarderSourceUpgradeable
} from "../utils/ERC2771ContextExternalForwarderSourceUpgradeable.sol";

/**
 * @title DistributionManager contract
 * @author Data Tunnel
 * @notice Manages the distribution of fees to Dataset owner and contributors, and
 * provides configuration options for fee distribution percentages among parties.
 * This is the implementation contract, and each Dataset (represented by a Dataset NFT token) is associated
 * with a specific instance of this implementation.
 */
contract DistributionManager is
  IDistributionManager,
  ReentrancyGuardUpgradeable,
  ERC2771ContextExternalForwarderSourceUpgradeable
{
  using SafeERC20 for IERC20;
  using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
  using Address for address payable;

  event PaymentReceived();
  event PayoutSent(address indexed to, address token, uint256 amount);

  error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);
  error NOT_DATASET_OWNER(address account);
  error NOT_SUBSCRIPTION_MANAGER(address account);
  error MSG_VALUE_MISMATCH(uint256 msgValue, uint256 amount);
  error PERCENTAGE_VALUE_INVALID(uint256 maximum, uint256 current);
  error TAGS_NOT_PROVIDED();
  error TAG_WEIGHTS_NOT_INITIALIZED();
  error TAG_WEIGHTS_SUM_INVALID(uint256 maximum, uint256 current);
  error DEPLOYER_FEE_BENEFICIARY_ZERO_ADDRESS();
  error SIGNATURE_OVERDUE();
  error NO_UNCLAIMED_PAYMENTS_AVAILABLE();
  error UNSUPPORTED_MSG_VALUE();

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

  uint256 public constant BASE_100_PERCENT = 1e18;
  uint256 public constant MAX_DATASET_OWNER_PERCENTAGE = 0.5e18;
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

  modifier onlySubscriptionManager() {
    //Use msg.sender here instead of _msgSender() because this call should not go through trustedForwarder
    if (dataset.subscriptionManager(datasetId) != msg.sender) revert NOT_SUBSCRIPTION_MANAGER(msg.sender);
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
    __ERC2771ContextExternalForwarderSourceUpgradeable_init_unchained(dataset_);
    dataset = IDatasetNFT(dataset_);
    datasetId = datasetId_;
    fragmentNFT = IFragmentNFT(dataset.fragmentNFT(datasetId));
  }

  /**
   * @notice Sets the weights of the respective provided tags.
   * @dev Weights are encoded such that 100% is represented as 1e18.
   * The weights define how payments are distributed to the tags (contributions).
   * Tags are encodings used as labels to categorize different types of contributions.
   * Only callable by the Dataset owner
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function setTagWeights(bytes32[] calldata tags, uint256[] calldata weights) external onlyDatasetOwner {
    _setTagWeights(tags, weights);
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
    for (uint256 i; i < tagsLength; ) {
      bytes32 tag = tags[i];
      (, uint256 weight) = tagWeights.tryGet(tag);
      weights[i] = weight;
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Sets the percentage of each subcription payment that should be sent to the Dataset Owner.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @dev Only callable by the Dataset owner
   * @param percentage The percentage to set (must be less than or equal to 50%)
   */
  function setDatasetOwnerPercentage(uint256 percentage) external onlyDatasetOwner {
    _setDatasetOwnerPercentage(percentage);
  }

  /**
   * @notice Sets both the percentage of each subcription payment that should be sent to the Dataset Owner
   * and the weights of the respective provided tags. Percentages are encoded such that 100% is represented as 1e18.
   * @dev Only callable by the Dataset owner
   * @param percentage The percentage to set (must be less than or equal to 50%)
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function setDSOwnerPercentageAndTagWeights(
    uint256 percentage,
    bytes32[] calldata tags,
    uint256[] calldata weights
  ) external onlyDatasetOwner {
    _setDatasetOwnerPercentage(percentage);
    _setTagWeights(tags, weights);
  }

  /**
   * @notice Internal function that sets the percentage of each subcription payment that should be sent to the Dataset Owner.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @dev Called by `setDatasetOwnerPercentage()` and `setDSOwnerPercentageAndTagWeights()`
   * @param percentage The percentage to set (must be less than or equal to 50%)
   */
  function _setDatasetOwnerPercentage(uint256 percentage) internal {
    if (percentage > MAX_DATASET_OWNER_PERCENTAGE)
      revert PERCENTAGE_VALUE_INVALID(MAX_DATASET_OWNER_PERCENTAGE, percentage);
    datasetOwnerPercentage = percentage;
  }

  /**
   * @notice Internal function that sets the weights of the respective provided tags.
   * @dev Called by `setTagWeights()` and `setDSOwnerPercentageAndTagWeights`
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function _setTagWeights(bytes32[] calldata tags, uint256[] calldata weights) internal {
    EnumerableMap.Bytes32ToUintMap storage tagWeights = _versionedTagWeights.push();
    uint256 weightSum;
    for (uint256 i; i < weights.length; ) {
      weightSum += weights[i];
      tagWeights.set(tags[i], weights[i]);
      unchecked {
        i++;
      }
    }
    if (weightSum != BASE_100_PERCENT) revert TAG_WEIGHTS_SUM_INVALID(BASE_100_PERCENT, weightSum);
  }

  /**
   * @notice Receives a subscription payment, sends deployer fee to configured beneficiary, and
   * creates a record of the amounts eligible for claiming by the Dataset owner and contributors respectively.
   * @dev Called by SubscriptionManager when a subscription payment is initiated.
   * `token` must not contain fee-on-transfer mechanism.
   * If `token` is address(0) (indicating native currency), the `amount` should match the `msg.value`,
   * otherwise DistributionManager should call `transferFrom()` to transfer the amount from sender.
   * Emits {PaymentReceived} and {PayoutSent} events.
   * @param token The address of the ERC20 payment token, or address(0) indicating native currency
   * @param amount The provided payment amount
   */
  function receivePayment(address token, uint256 amount) external payable onlySubscriptionManager nonReentrant {
    if (_versionedTagWeights.length == 0) revert TAG_WEIGHTS_NOT_INITIALIZED();
    if (address(token) == address(0) && amount != msg.value) {
      revert MSG_VALUE_MISMATCH(msg.value, amount);
    } else {
      if (msg.value > 0) revert UNSUPPORTED_MSG_VALUE();
      IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
    }
    uint256 snapshotId = fragmentNFT.snapshot();

    // Deployer fee
    uint256 deployerFee = (amount * dataset.deployerFeePercentage(datasetId)) / BASE_100_PERCENT;
    if (deployerFee > 0) {
      address deployerFeeBeneficiary = dataset.deployerFeeBeneficiary();
      if (deployerFeeBeneficiary == address(0)) revert DEPLOYER_FEE_BENEFICIARY_ZERO_ADDRESS();
      _sendPayout(token, deployerFee, deployerFeeBeneficiary);
      amount -= deployerFee;
    }

    // Dataset owner fee
    if (amount > 0) {
      uint256 ownerAmount = (amount * datasetOwnerPercentage) / BASE_100_PERCENT;
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

    _claimOwnerPayouts();
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
    _claimOwnerPayouts();

    // Claim Fragment Fees
    _claimPayouts();
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
    _claimPayouts();
  }

  /**
   * @notice Calculates and returns a given account's total contribution-based unclaimed payouts for the given payment `token`
   * @param token The address of the target ERC20 token, or address(0) for native currency, that should be utilized for subscription payments
   * @param account The address of the account to inquire
   * @return collectAmount The account's total contribution-based unclaimed payout amount for `token`
   */
  function calculatePayoutByToken(address token, address account) external view returns (uint256 collectAmount) {
    uint256 firstUnclaimedPayout = _firstUnclaimedContribution[account];
    uint256 totalPayments = payments.length;

    if (firstUnclaimedPayout >= totalPayments) return 0;

    for (uint256 i = firstUnclaimedPayout; i < totalPayments; ) {
      Payment storage p = payments[i];
      if (token == p.token) {
        collectAmount += _calculatePayout(p, account);
      }
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Internal _claimOwnerPayouts for claiming all pending Dataset ownership fees
   * @dev Called by `claimDatasetOwnerPayouts()` & `claimDatasetOwnerAndFragmentPayouts()`.
   * Emits {PayoutSent} event(s).
   */
  function _claimOwnerPayouts() internal {
    uint256 totalPayments = payments.length;
    if (_firstUnclaimed >= totalPayments) return; // Nothing to claim

    uint256 firstUnclaimedPayout = _firstUnclaimed;
    _firstUnclaimed = totalPayments; // CEI pattern to prevent reentrancy

    address collectToken;
    uint256 pendingFeeToken;
    for (uint256 i = firstUnclaimedPayout; i < totalPayments; ) {
      collectToken = payments[i].token;
      pendingFeeToken = pendingOwnerFee[collectToken];

      if (pendingFeeToken == 0) continue;
      delete pendingOwnerFee[collectToken];

      _sendPayout(collectToken, pendingFeeToken, _msgSender());

      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Internal _claimPayouts for claiming all pending contribution fees (from fragments) for a specific contributor
   * @dev Called by `claimDatasetOwnerAndFragmentPayouts()`.
   * Emits {PayoutSent} event(s).
   */
  function _claimPayouts() internal {
    address beneficiary = _msgSender();
    // Claim payouts
    uint256 firstUnclaimedPayout = _firstUnclaimedContribution[beneficiary];
    uint256 totalPayments = payments.length;
    if (firstUnclaimedPayout >= totalPayments) return; // Nothing to claim
    _firstUnclaimedContribution[beneficiary] = totalPayments; // CEI pattern to prevent reentrancy

    address collectToken = payments[firstUnclaimedPayout].token;
    uint256 collectAmount;
    for (uint256 i = firstUnclaimedPayout; i < totalPayments; ) {
      Payment storage p = payments[i];
      if (collectToken != p.token) {
        // Payment token changed, send what we've already collected
        _sendPayout(collectToken, collectAmount, beneficiary);
        collectToken = p.token;
        collectAmount = 0;
      }
      collectAmount += _calculatePayout(p, beneficiary);
      unchecked {
        i++;
      }
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
    for (uint256 i; i < tags.length; ) {
      bytes32 tag = tags[i];
      if (percentages[i] > 0) {
        payout += (paymentAmount * tagWeights.get(tag) * percentages[i]) / 1e36;
      }
      unchecked {
        i++;
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
