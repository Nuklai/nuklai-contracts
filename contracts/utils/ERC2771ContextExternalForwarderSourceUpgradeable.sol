// SPDX-License-Identifier: MIT
// Based on: 
// https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/v4.9.3/contracts/metatx/ERC2771ContextUpgradeable.sol

pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../interfaces/IIsTrustedForwarderSource.sol";

/**
 * @dev Context variant with ERC2771 support.
 * @dev difference from OZ: 
 * - trusted forwarder is readed from IIsTrustedForwarderSource
 * - TrustedFrowarderSourceChanged event
 */
abstract contract ERC2771ContextExternalForwarderSourceUpgradeable is Initializable, ContextUpgradeable {
    event TrustedFrowarderSourceChanged(address newTrustedForwarder);

    IIsTrustedForwarderSource private _trustedForwarderSource;

    function __ERC2771ContextExternalForwarderSourceUpgradeable_init(address trustedForwarderSource_) internal onlyInitializing {
        __ERC2771ContextExternalForwarderSourceUpgradeable_init_unchained(trustedForwarderSource_);
    }

    function __ERC2771ContextExternalForwarderSourceUpgradeable_init_unchained(address trustedForwarderSource_) internal onlyInitializing {
        _setTrustedForwarderSource(trustedForwarderSource_);
    }

    /**
     * @dev This may be called by an external access-protected function
     * @param trustedForwarderSource_ new trusted forwarder source
     */
    function _setTrustedForwarderSource(address trustedForwarderSource_) internal {
        _trustedForwarderSource = IIsTrustedForwarderSource(trustedForwarderSource_);
        emit TrustedFrowarderSourceChanged(trustedForwarderSource_);
    }

    function isTrustedForwarder(address forwarder) public view virtual returns (bool) {
        return _trustedForwarderSource.isTrustedForwarder(forwarder);
    }

    function _msgSender() internal view virtual override returns (address sender) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            // The assembly code is more direct than the Solidity version using `abi.decode`.
            /// @solidity memory-safe-assembly
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            return super._msgSender();
        }
    }

    function _msgData() internal view virtual override returns (bytes calldata) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            return msg.data[:msg.data.length - 20];
        } else {
            return super._msgData();
        }
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}