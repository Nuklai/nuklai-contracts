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
 * - trusted forwarder is mutable
 * - support of IIsTrustedForwarderSource interface
 * - TrustedFrowarderChanged event
 */
abstract contract ERC2771ContextMutableForwarderUpgradeable is
  IIsTrustedForwarderSource,
  Initializable,
  ContextUpgradeable
{
  event TrustedFrowarderChanged(address newTrustedForwarder);

  address private _trustedForwarder;

  function __ERC2771ContextMutableForwarderUpgradeable_init(address trustedForwarder_) internal onlyInitializing {
    __ERC2771ContextMutableForwarderUpgradeable_init_unchained(trustedForwarder_);
  }

  function __ERC2771ContextMutableForwarderUpgradeable_init_unchained(
    address trustedForwarder_
  ) internal onlyInitializing {
    _setTrustedForwarder(trustedForwarder_);
  }

  /**
   * @dev This may be called by an external access-protected function
   * @param trustedForwarder_ new trusted forwarder
   */
  function _setTrustedForwarder(address trustedForwarder_) internal {
    _trustedForwarder = trustedForwarder_;
    emit TrustedFrowarderChanged(trustedForwarder_);
  }

  function isTrustedForwarder(address forwarder) public view virtual returns (bool) {
    return forwarder == _trustedForwarder;
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
