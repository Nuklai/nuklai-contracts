// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IDistributionManager.sol";
import "../interfaces/IDatasetNFT.sol";
import "../interfaces/IFragmentNFT.sol";

contract DistributionManager is IDistributionManager, Initializable, Context {
    using SafeERC20 for IERC20;
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using Address for address payable;

    event PaymentReceived();
    event PayoutSent(address indexed to, address token, uint256 amount);

    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);

    struct Payment {
        address token;
        uint256 distributionAmount;
        uint256 snapshotId;
        uint256 tagWeightsVersion;
    }

    IDatasetNFT public dataset;
    uint256 public datasetId;
    IFragmentNFT public fragmentNFT;
    uint256 public datasetOwnerPercentage;      // 100% = 1e18
    mapping(address token => uint256 amount) public pendingOwnerFee; // Amount available for claim by the owner
    Payment[] public payments;
    EnumerableMap.Bytes32ToUintMap[] internal verisonedTagWeights;
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
        EnumerableMap.Bytes32ToUintMap storage tagWeights = verisonedTagWeights.push();
        uint256 weightSumm;
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
        
        // Deployer fee
        uint256 deployerFee = amount * dataset.deployerFeePercentage(datasetId);
        if(deployerFee > 0) {
            address deployerFeeBeneficiary = dataset.deployerFeeBeneficiary();
            require(deployerFeeBeneficiary != address(0), "bad deployer fee beneficiary");
            _sendPayout(token, deployerFee, deployerFeeBeneficiary);
            amount = amount - deployerFee;
        }

        // Dataset owner fee
        if(amount > 0) {
            uint256 ownerAmount = amount * datasetOwnerPercentage / 1e18;
            pendingOwnerFee[token] += ownerAmount;
            amount = amount - ownerAmount;
        }

        // Fragment contributors fee
        if(amount > 0) {
            payments.push(Payment({
                token: token,
                distributionAmount: amount,
                snapshotId: snapshotId,
                tagWeightsVersion: verisonedTagWeights.length-1
            }));
        }

        emit PaymentReceived();
    }

    function claimDatasetOwnerPayouts(address token, uint256 amount, address beneficiary, bytes calldata signature) external onlyDatasetOwner {
        require(pendingOwnerFee[token] >= amount, "not enough amount");
        bytes32 msgHash = _ownerClaimMessageHash(token, amount, beneficiary);
        address signer = ECDSA.recover(msgHash, signature);
        if(!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);
        pendingOwnerFee[token] -= amount;
         _sendPayout(token, amount, beneficiary);
    }

    /**
     * @notice Claim all payouts (for Fragment owners)
     */
    function claimPayouts(uint256 sigValidSince, uint256 sigValidTill, bytes calldata signature) external {
        // Validate signature
        require(block.timestamp >= sigValidSince && block.timestamp <= sigValidTill, "signature overdue");
        bytes32 msgHash = _fragmentClaimMessageHash(_msgSender(), sigValidSince, sigValidTill);
        address signer = ECDSA.recover(msgHash, signature);
        if(!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);

        // Claim payouts
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

    function _calculatePayout(Payment storage p, address account) internal view returns(uint256 payout) {
        uint256 paymentAmount = p.distributionAmount;
        EnumerableMap.Bytes32ToUintMap storage tagWeights = verisonedTagWeights[p.tagWeightsVersion];
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


    function _ownerClaimMessageHash(address token, uint256 amount, address beneficiary) private view returns(bytes32) {
        return ECDSA.toEthSignedMessageHash(abi.encodePacked(
            block.chainid,
            address(this),
            token,
            amount,
            beneficiary
        ));
    }

    function _fragmentClaimMessageHash(address beneficiary, uint256 sigValidSince, uint256 sigValidTill) private view returns(bytes32) {
        return ECDSA.toEthSignedMessageHash(abi.encodePacked(
            block.chainid,
            address(this),
            beneficiary,
            sigValidSince,
            sigValidTill
        ));
    }

}