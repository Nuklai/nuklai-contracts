// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "./interfaces/IFragmentNFT.sol";
import "./interfaces/IVerifierManager.sol";

contract FragmentNFT is IFragmentNFT, ERC721, Initializable {
    using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
    using Arrays for uint256[];

    string private constant NAME = "AllianceBlock DataTunnel Fragment";
    string private constant SYMBOL = "ABDTF";

    event FragmentPending(uint256 id, bytes32 tag);
    event FragmentAccepted(uint256 id);
    event FragmentRejected(uint256 id);
    event FragmentRemoved(uint256 id);

    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);
    error NOT_ADMIN(address account);
    error NOT_VERIFIER_MANAGER(address account);
    error NOT_DISTRIBUTION_MANAGER(address account);
    error NOT_DATASET_NFT(address account);

    struct Snapshot {
        EnumerableMap.Bytes32ToUintMap totalTagCount;
        mapping(address account => EnumerableMap.Bytes32ToUintMap) accountTagCount;
    }

    IDatasetNFT public dataset;
    uint256 public datasetId;
    uint256 internal mintCounter;
    mapping(uint256 id => address owner) public pendingFragmentOwners;
    mapping(uint256 id => bytes32 tag) public tags;
    Snapshot[] internal snapshots;
    mapping(address account => uint256[]) internal accountSnapshotIds; // ids of snapshots which contains account data

    modifier onlyAdmin() {
        if (dataset.ownerOf(datasetId) != _msgSender())
            revert NOT_ADMIN(_msgSender());
        _;
    }

    modifier onlyVerifierManager() {
        if (dataset.verifierManager(datasetId) != _msgSender())
            revert NOT_VERIFIER_MANAGER(_msgSender());
        _;
    }

    modifier onlyDistributionManager() {
        if (dataset.distributionManager(datasetId) != _msgSender())
            revert NOT_DISTRIBUTION_MANAGER(_msgSender());
        _;
    }

    modifier onlyDatasetNFT() {
        if (address(dataset) != _msgSender())
            revert NOT_DATASET_NFT(_msgSender());
        _;
    }

    constructor() ERC721(NAME, SYMBOL) {
        _disableInitializers();
    }

    function initialize(
        address dataset_,
        uint256 datasetId_
    ) external initializer {
        dataset = IDatasetNFT(dataset_);
        datasetId = datasetId_;
        snapshots.push();
    }

    //TODO handle metadata URI stuff

    function snapshot() external onlyDistributionManager returns (uint256) {
        snapshots.push();
        return snapshots.length - 1;
    }

    function currentSnapshotId() external view returns (uint256) {
        return snapshots.length - 1;
    }

    function tagCountAt(uint256 snapshotId) external view returns (bytes32[] memory tags_, uint256[] memory counts) {
        require(snapshotId < snapshots.length, "bad snapshot id");
        EnumerableMap.Bytes32ToUintMap storage tagCount = snapshots[snapshotId].totalTagCount;
        tags_ = tagCount.keys();

        uint256 length = tagCount.length();
        counts = new uint256[](length);

        for(uint256 i; i < length; i++) {
            counts[i] = tagCount.get(tags_[i]);
        }
    }

    function accountTagCountAt(uint256 snapshotId, address account) external view returns (bytes32[] memory tags_, uint256[] memory counts) {
        require(snapshotId < snapshots.length, "bad snapshot id");
        EnumerableMap.Bytes32ToUintMap storage tagCount = snapshots[_findAccountSnapshotId(account, snapshotId)].accountTagCount[account];
        tags_ = tagCount.keys();
        counts = new uint256[](tagCount.length());
        for(uint256 i; i < tagCount.length(); i++) {
            counts[i] = tagCount.get(tags_[i]);
        }
    }

    function accountTagPercentageAt(uint256 snapshotId, address account, bytes32[] calldata tags_) external view returns (uint256[] memory percentages) {
        require(snapshotId < snapshots.length, "bad snapshot id");
        uint256 latestAccountSnapshot = _findAccountSnapshotId(account, snapshotId);
        EnumerableMap.Bytes32ToUintMap storage totalTagCount = snapshots[latestAccountSnapshot].totalTagCount;
        EnumerableMap.Bytes32ToUintMap storage accountTagCount = snapshots[latestAccountSnapshot].accountTagCount[account];
        percentages = new uint256[](tags_.length);

        for(uint256 i; i<tags_.length; i++) {
            bytes32 tag = tags_[i];
            (, uint256 totalCount) = totalTagCount.tryGet(tag);
            if(totalCount != 0) {
                (, uint256 accountCount) = accountTagCount.tryGet(tag);
                percentages[i] = 1e18 * accountCount / totalCount;
            }
            // else:  percentages[i] = 0, but we skip it because percentages is initialized with zeroes
        }
    }

    /**
     * @notice Adds a Fragment as Pending
     * @param to Fragment owner
     * @param tag Hash of tag name of contribution
     * @param signature Signature from a DT service confirming creation of the Fragment
     */
    function propose(
        address to,
        bytes32 tag,
        bytes calldata signature
    ) external onlyDatasetNFT {
        uint256 id = ++mintCounter;
        bytes32 msgHash = _proposeMessageHash(id, to, tag);
        address signer = ECDSA.recover(msgHash, signature);
        if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);
        pendingFragmentOwners[id] = to;
        tags[id] = tag;
        emit FragmentPending(id, tag);

        // Here we call VeriferManager and EXPECT it to call accept()
        // during this call OR at any following transaction.
        // DO NOT do any state changes after this point!
        IVerifierManager(dataset.verifierManager(datasetId)).propose(id, tag);
    }

    /**
     * @notice Adds a batch of Fragments as Pending
     * @param owners Fragments owners
     * @param tags_ Hashes of tag name of contribution
     * @param signature Signature from a DT service confirming creation of the Fragment
     */
    function proposeMany(
        address[] memory owners,
        bytes32[] memory tags_,
        bytes calldata signature
    ) external onlyDatasetNFT {
        require(tags_.length == owners.length, "invalid length of fragments items");
        bytes32 msgHash = _proposeManyMessageHash(mintCounter + 1, owners, tags_);
        address signer = ECDSA.recover(msgHash, signature);
        if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);

        for (uint256 i; i < owners.length; i++) {
            uint256 id = ++mintCounter;
            bytes32 tag = tags_[i];
            pendingFragmentOwners[id] = owners[i];
            tags[id] = tag;
            emit FragmentPending(id, tag);

            // Here we call VeriferManager and EXPECT it to call accept()
            // during this call OR at any following transaction.
            // DO NOT do any state changes after this point!
            IVerifierManager(dataset.verifierManager(datasetId)).propose(id, tag);
        }
    }

    function lastFragmentPendingId() external view returns (uint256) {
        return mintCounter;
    }

    function accept(uint256 id) external onlyVerifierManager {
        address to = pendingFragmentOwners[id];
        require(!_exists(id) && to != address(0), "Not a pending fragment");
        delete pendingFragmentOwners[id];
        _safeMint(to, id);
        emit FragmentAccepted(id);
    }

    function reject(uint256 id) external onlyVerifierManager {
        address to = pendingFragmentOwners[id];
        require(!_exists(id) && to != address(0), "Not a pending fragment");
        delete pendingFragmentOwners[id];
        delete tags[id];
        emit FragmentRejected(id);
    }

    function remove(uint256 id) external onlyAdmin {
        delete pendingFragmentOwners[id]; // in case we are deleting pending one
        _burn(id);
        delete tags[id];
        emit FragmentRemoved(id);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(IERC165, ERC721) returns (bool) {
        return
            interfaceId == type(IFragmentNFT).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize) internal override {
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);

        // Update snapshot data
        if(from != address(0)) {
            _updateAccountSnapshot(from, firstTokenId, batchSize, false);
        } else { // Mint
            _updateTotalSnapshot(firstTokenId, batchSize, true);
        }

        if(to != address(0)) {
            _updateAccountSnapshot(to, firstTokenId, batchSize, true);
        } else { // Burn
            _updateTotalSnapshot(firstTokenId, batchSize, false);
        }

    }

    function _updateAccountSnapshot(address account, uint256 firstTokenId, uint256 batchSize, bool add) private {
        uint256 currentSnapshot = _currentSnapshot();
        EnumerableMap.Bytes32ToUintMap storage currentAccountTagCount = snapshots[currentSnapshot].accountTagCount[account];
        uint256 lastAccountSnapshot = _lastUint256ArrayElement(accountSnapshotIds[account]);
        if(lastAccountSnapshot < currentSnapshot) {
            _copy(snapshots[lastAccountSnapshot].accountTagCount[account], currentAccountTagCount);
            accountSnapshotIds[account].push(currentSnapshot);
        }
        for(uint256 i; i < batchSize; i++) {
            uint256 id = firstTokenId+i;
            bytes32 tag = tags[id];
            (, uint256 currentCount) = currentAccountTagCount.tryGet(tag);
            currentAccountTagCount.set(tag, add ? (currentCount+1):(currentCount-1));
        }
    }

    function _updateTotalSnapshot(uint256 firstTokenId, uint256 batchSize, bool add) private {
        uint256 currentSnapshot = _currentSnapshot();
        EnumerableMap.Bytes32ToUintMap storage totalTagCount = snapshots[currentSnapshot].totalTagCount;
        uint256 lastSnapshot = _lastUint256ArrayElement(accountSnapshotIds[address(this)]);
        if(lastSnapshot < currentSnapshot) {
            _copy(snapshots[lastSnapshot].totalTagCount, totalTagCount);
            accountSnapshotIds[address(this)].push(currentSnapshot);
        }        
        for(uint256 i; i < batchSize; i++) {
            uint256 id = firstTokenId+i;
            bytes32 tag = tags[id];
            (, uint256 currentCount) = totalTagCount.tryGet(tag);
            totalTagCount.set(tag, add ? (currentCount+1):(currentCount-1));
        }
    }

    function _findAccountSnapshotId(address account, uint256 targetSnapshotId) private view returns(uint256) {
        uint256[] storage snapshotIds = accountSnapshotIds[account];
        uint256 bound = snapshotIds.findUpperBound(targetSnapshotId);
        if(bound == snapshotIds.length) {
            // no snapshot id was found equal or greater to the targetSnapshotId
            // we need to return the last available
            // if there is no snapshot at all - return current,
            // otherwise return the last one
            return (bound == 0)?_currentSnapshot():snapshotIds[bound-1];
        } else {
            // found snapshot id which is greater or equal to the targetSnapshotId
            // if it is equal to target, we need to return it,
            // otherwise we need to return previous
            uint256 found = snapshotIds[bound];
            if (found == targetSnapshotId) {
                // we've found the exact snapshot we need
                return targetSnapshotId;
            } else {
                if (bound == 0) {
                    //there is no previous snapshot
                    return 0; // return empty snapshot
                } else {
                    // return last snapshot before the one we've found
                    return snapshotIds[bound - 1];
                }
            }
        }
    }

    function _currentSnapshot() private view returns(uint256) {
        return snapshots.length - 1;
    }

    function _proposeMessageHash(
        uint256 id,
        address to,
        bytes32 tag
    ) private view returns (bytes32) {
        return
            ECDSA.toEthSignedMessageHash(
                abi.encodePacked(
                    block.chainid,
                    address(dataset),
                    datasetId,
                    id,
                    to,
                    tag
                )
            );
    }

    function _proposeManyMessageHash(
        uint256 id,
        address[] memory owners,
        bytes32[] memory tags_
    ) private view returns (bytes32) {
        return
            ECDSA.toEthSignedMessageHash(
                abi.encodePacked(
                    block.chainid,
                    address(dataset),
                    datasetId,
                    id,
                    owners,
                    tags_
                )
            );
    }

    function _copy(EnumerableMap.Bytes32ToUintMap storage from, EnumerableMap.Bytes32ToUintMap storage to) private {
        require(to.length() == 0, "target should be empty");
        uint256 length = from.length();
        for(uint256 i; i < length; i++) {
            (bytes32 k, uint256 v) = from.at(i);
            to.set(k, v);
        }
    }

    function _lastUint256ArrayElement(uint256[] storage arr) private returns (uint256) {
        if (arr.length == 0) arr.push();
        return arr[arr.length-1];
    }
}
