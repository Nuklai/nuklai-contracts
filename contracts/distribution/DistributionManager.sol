// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "../interfaces/IDistributionManager.sol";
import "../interfaces/IDatasetNFT.sol";
import "../interfaces/IFragmentNFT.sol";

contract DistributionManager is IDistributionManager, Initializable, Context {
    using SafeERC20 for IERC20;
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using Address for address payable;

    event PaymentReceived();
    event PayoutSent(address indexed to, address token, uint256 amount);

    struct Payment {
        address token;
        uint256 distributionAmount;
        uint256 snapshotId;
    }

    IDatasetNFT public dataset;
    uint256 public datasetId;
    IFragmentNFT public fragmentNFT;
    uint256 public datasetOwnerPercentage; // 100% = 1e18
    Payment[] public payments;
    EnumerableMap.Bytes32ToUintMap internal tagWeights;
    mapping(address => uint256) internal firstUnclaimed;

    modifier onlyDatasetOwner() {
        require(dataset.ownerOf(datasetId) == _msgSender(), "Not a Dataset owner");
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(address dataset_, uint256 datasetId_) external initializer() {
        dataset = IDatasetNFT(dataset_);
        datasetId = datasetId_;
        fragmentNFT = IFragmentNFT(dataset.fragmentNFT(datasetId));
    }

    /**
     * @notice Define how to distribute payment to different tags
     * The summ of weights should be 100%, and 100% is encoded as 1e18
     * @param tags tags participating in the payment distributions
     * @param weights weights of the tags
     */
    function setTagWeights(bytes32[] calldata tags, uint256[] calldata weights) external onlyDatasetOwner {
        uint256 weightSumm;
        _clear(tagWeights);
        for(uint256 i; i < weights.length; i++) {
            weightSumm += weights[i];
            tagWeights.set(tags[i], weights[i]);
        }
        require(weightSumm == 1e18, "Invalid weights summ");
    }

    /**
     * @notice Set percentage of each payment that should be sent to the Dataset Owner
     * @param percentage Percentage encoded in a way that 100% = 1e18
     */
    function setDatasetOwnerPercentage(uint256 percentage) external onlyDatasetOwner {
        require(percentage <= 1e18, "Can't be higher than 100%");
        datasetOwnerPercentage = percentage;
    }

    /**
     * @notice Called by SubscriptionManager to initiate payment
     * @dev if token is address(0) - native currency, the amount should match the msg.value
     * otherwise DistributionManager should call `transferFrom()` to transfer the amount from sender
     * @param token Payment token ERC20, address(0) means native currency
     * @param amount Payment amount
     */
    function receivePayment(address token, uint256 amount) external payable{
        if(address(token) == address(0)){
            require(amount == msg.value, "value missmatch");
        } else {
            IERC20(token).safeTransferFrom(_msgSender(), address(this), amount);
        }
        uint256 snapshotId = fragmentNFT.snapshot();
        
        uint256 ownerAmount = amount * datasetOwnerPercentage / 1e18;
        _sendPayout(token, ownerAmount, dataset.ownerOf(datasetId));

        payments.push(Payment({
            token: token,
            distributionAmount: amount - ownerAmount,
            snapshotId: snapshotId
        }));

        emit PaymentReceived();
    }

    /**
     * @notice Claim all payouts
     */
    function claimPayouts() external {
        uint256 firstUnclaimedPayout = firstUnclaimed[_msgSender()];
        if(firstUnclaimedPayout >= payments.length) return; // Nothing to claim
        address collectToken = payments[firstUnclaimedPayout].token;
        uint256 collectAmount;
        for(uint256 i = firstUnclaimedPayout; i < payments.length; i++) {
            Payment storage p = payments[i];
            if(collectToken != p.token) {
                // Payment token changed, send what we've already collected
                _sendPayout(p.token, collectAmount, _msgSender());
                collectToken = p.token;
                collectAmount = 0;
            }
            collectAmount += _calculatePayout(p, _msgSender());
        }
        // send collected and not sent yet
        _sendPayout(collectToken, collectAmount, _msgSender());
    }

    function calculatePayoutByToken(address token, address account) external view returns (uint256 collectAmount) {
        uint256 firstUnclaimedPayout = firstUnclaimed[account]; 
        
        if(firstUnclaimedPayout >= payments.length) return 0;

        for(uint256 i = firstUnclaimedPayout; i < payments.length; i++) {
            Payment storage p = payments[i];
            if(token == p.token) {
                collectAmount += _calculatePayout(p, account);
            }
        }
    }

    function _calculatePayout(Payment storage p, address account) internal view returns(uint256 payout) {
        uint256 paymentAmount = p.distributionAmount;
        bytes32[] memory tags = tagWeights.keys();
        uint256[] memory percentages = fragmentNFT.accountTagPercentageAt(p.snapshotId, account, tags);
        for(uint256 i; i < tags.length; i++) {
            bytes32 tag = tags[i];
            if(percentages[i] > 0){
                payout += paymentAmount * tagWeights.get(tag) * percentages[i] / 1e36;
            }
        }
    }

    function _sendPayout(address token, uint256 amount, address to) internal {
        if ( token == address(0) ) {
            payable(to).sendValue(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit PayoutSent(to, token, amount);
    }

    function _clear(EnumerableMap.Bytes32ToUintMap storage map) private {
        bytes32[] memory keys = map.keys();
        for(uint256 i; i < keys.length; i++) {
            map.remove(keys[i]);
        }
    }
}